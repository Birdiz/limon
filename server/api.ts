import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { cleanEmail, type Compte, type CompteDetail, type Entree, type Passkey } from "../src/core/account";
import { sanitizeAtelier, type Atelier, type AtelierDefauts } from "../src/core/atelier";
import type { Entreprise, Tarifs } from "../src/core/tarifs";
import { sanitizeProject, type Project } from "../src/core/project";
import type { Db } from "./db";
import type { SendCode } from "./mail";

export interface ApiConfig {
  db: Db;
  /** Adresse du site, seule origine acceptée : https://quart-de-tour.fr en ligne. */
  origin: string;
  sendCode: SendCode;
}

type Env = { Variables: { compte: string } };

const COOKIE = "limon-session";
const SESSION_DAYS = 365;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const HOUR = 3_600_000;
/** Projets ou identifiants par requête. */
const MAX_BATCH = 1000;

/** Compteur d'essais en mémoire : un seul serveur tourne, et rien n'est conservé. */
class Limiter {
  private hits = new Map<string, number[]>();
  /** Vrai si l'essai passe ; faux au-delà de `max` dans la fenêtre. */
  hit(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return false;
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const ms = (d: unknown) => (d ? new Date(d as string).getTime() : null);
const err = (c: Context, status: ContentfulStatusCode, erreur: string) => c.json({ erreur }, status);
const body = async (c: Context): Promise<Record<string, unknown>> => {
  const b: unknown = await c.req.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
};
/** Défi signé par la passkey, lu dans la réponse du navigateur. */
function challengeOf(r: { response?: { clientDataJSON?: unknown } } | undefined): string | null {
  try {
    const data: unknown = JSON.parse(Buffer.from(String(r?.response?.clientDataJSON), "base64url").toString());
    const ch = (data as { challenge?: unknown }).challenge;
    return typeof ch === "string" ? ch : null;
  } catch {
    return null;
  }
}

/** Routes /api : connexion, compte et projets. */
export function api(cfg: ApiConfig): Hono<Env> {
  const { db, origin } = cfg;
  const rpID = new URL(origin).hostname;
  const secure = origin.startsWith("https:");
  // Les codes sont gardés hachés avec ce sel, propre au processus : une copie de la base ne les révèle pas.
  const pepper = randomBytes(32);
  const codeHash = (email: string, code: string) => createHmac("sha256", pepper).update(`${email}:${code}`).digest();
  const limiter = new Limiter();
  const ip = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  const app = new Hono<Env>().basePath("/api");

  app.use(async (c, next) => {
    // Une requête qui modifie quelque chose doit venir du site lui-même.
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("origin") !== origin)
      return err(c, 403, "Origine refusée.");
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use(bodyLimit({ maxSize: 4 << 20, onError: (c) => err(c, 413, "Envoi trop gros.") }));

  async function startSession(c: Context, compte: string): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    await db.query(
      `insert into sessions (hash, compte, expire) values ($1, $2, now() + interval '${SESSION_DAYS} days')`,
      [sha256(token), compte],
    );
    setSessionCookie(c, token);
  }
  function setSessionCookie(c: Context, token: string): void {
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api",
      maxAge: SESSION_DAYS * 86400,
    });
  }
  async function compteOf(id: string): Promise<Compte | null> {
    const [r] = await db.query<Compte>("select id, email, statut from comptes where id = $1", [id]);
    return r ?? null;
  }

  /** Session valable, prolongée d'un an au plus une fois par jour. */
  const auth = createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, COOKIE);
    const hash = token && sha256(token);
    const [s] = hash
      ? await db.query<{ compte: string; renew: boolean }>(
          `select compte, expire < now() + interval '${SESSION_DAYS - 1} days' as renew
           from sessions where hash = $1 and expire > now()`,
          [hash],
        )
      : [];
    if (!s) return err(c, 401, "Vous n'êtes plus connecté.");
    if (s.renew) {
      await db.query(`update sessions set expire = now() + interval '${SESSION_DAYS} days' where hash = $1`, [hash]);
      setSessionCookie(c, token!);
    }
    c.set("compte", s.compte);
    await next();
  });

  app.get("/sante", async (c) => {
    await db.query("select 1");
    return c.text("ok");
  });

  /* ---------- Code par e-mail ---------- */

  app.post("/code", async (c) => {
    const email = cleanEmail((await body(c)).email);
    if (!email) return err(c, 400, "Cette adresse e-mail n'est pas valable.");
    if (!limiter.hit(`ip:${ip(c)}`, 20, HOUR) || !limiter.hit(`email:${email}`, 3, HOUR))
      return err(c, 429, "Trop de codes demandés. Réessayez dans une heure.");
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await db.query(
      `insert into codes (email, hash, expire, essais) values ($1, $2, now() + interval '${CODE_MINUTES} minutes', 0)
       on conflict (email) do update set hash = excluded.hash, expire = excluded.expire, essais = 0`,
      [email, codeHash(email, code).toString("hex")],
    );
    try {
      await cfg.sendCode(email, code);
    } catch (e) {
      console.error(e);
      return err(c, 502, "L'e-mail n'a pas pu partir. Réessayez dans un instant.");
    }
    // Même réponse, que l'adresse ait déjà un compte ou non.
    return c.body(null, 204);
  });

  app.post("/code/verifier", async (c) => {
    const b = await body(c);
    const email = cleanEmail(b.email);
    const code = typeof b.code === "string" ? b.code.replace(/\s/g, "") : "";
    if (!email || !/^\d{6}$/.test(code)) return err(c, 400, "Le code a 6 chiffres.");
    const [row] = await db.query<{ hash: string; essais: number }>(
      "update codes set essais = essais + 1 where email = $1 and expire > now() returning hash, essais",
      [email],
    );
    if (!row) return err(c, 400, "Ce code a expiré : demandez-en un nouveau.");
    if (row.essais > CODE_TRIES) {
      await db.query("delete from codes where email = $1", [email]);
      return err(c, 400, "Trop d'essais : demandez un nouveau code.");
    }
    if (!timingSafeEqual(Buffer.from(row.hash, "hex"), codeHash(email, code))) return err(c, 400, "Code incorrect.");
    await db.query("delete from codes where email = $1", [email]);
    await db.query("insert into comptes (id, email) values ($1, $2) on conflict (email) do nothing", [
      randomUUID(),
      email,
    ]);
    const [compte] = await db.query<Compte>("select id, email, statut from comptes where email = $1", [email]);
    await startSession(c, compte!.id);
    return c.json(compte!);
  });

  /* ---------- Passkeys ---------- */

  app.post("/passkey/options", async (c) => {
    if (!limiter.hit(`pk:${ip(c)}`, 60, HOUR)) return err(c, 429, "Trop d'essais. Réessayez dans une heure.");
    const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
    await db.query("insert into defis (defi, expire) values ($1, now() + interval '5 minutes')", [options.challenge]);
    return c.json(options);
  });

  app.post("/passkey/connexion", async (c) => {
    const reponse = (await body(c)).reponse as AuthenticationResponseJSON | undefined;
    const defi = challengeOf(reponse);
    const [ok] = defi
      ? await db.query("delete from defis where defi = $1 and compte is null and expire > now() returning defi", [defi])
      : [];
    if (!ok || !reponse) return err(c, 400, "La demande a expiré : recommencez.");
    const [pk] = await db.query<{ compte: string; cle: string; compteur: number; transports: string }>(
      "select compte, cle, compteur, transports from passkeys where id = $1",
      [reponse.id],
    );
    if (!pk) return err(c, 404, "Cette passkey ne correspond à aucun compte : connectez-vous avec un code par e-mail.");
    let newCounter: number;
    try {
      const v = await verifyAuthenticationResponse({
        response: reponse,
        expectedChallenge: defi!,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: reponse.id,
          publicKey: Buffer.from(pk.cle, "base64url"),
          counter: pk.compteur,
          transports: pk.transports ? pk.transports.split(",") : [],
        },
        requireUserVerification: false,
      });
      if (!v.verified) throw new Error("non vérifiée");
      newCounter = v.authenticationInfo.newCounter;
    } catch (e) {
      console.error(e);
      return err(c, 400, "La passkey n'a pas pu être vérifiée.");
    }
    await db.query("update passkeys set compteur = $2, utilise = now() where id = $1", [reponse.id, newCounter]);
    await startSession(c, pk.compte);
    return c.json(await compteOf(pk.compte));
  });

  app.post("/passkey/ajout/options", auth, async (c) => {
    const compte = (await compteOf(c.get("compte")))!;
    const existing = await db.query<{ id: string; transports: string }>(
      "select id, transports from passkeys where compte = $1",
      [compte.id],
    );
    const options = await generateRegistrationOptions({
      rpName: "Quart de tour",
      rpID,
      userName: compte.email,
      userDisplayName: compte.email,
      userID: new TextEncoder().encode(compte.id),
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports ? p.transports.split(",") : [] })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    await db.query("insert into defis (defi, compte, expire) values ($1, $2, now() + interval '5 minutes')", [
      options.challenge,
      compte.id,
    ]);
    return c.json(options);
  });

  app.post("/passkey/ajout", auth, async (c) => {
    const b = await body(c);
    const reponse = b.reponse as RegistrationResponseJSON | undefined;
    const nom = typeof b.nom === "string" && b.nom.trim() ? b.nom.trim().slice(0, 40) : "Appareil";
    const defi = challengeOf(reponse);
    const [ok] = defi
      ? await db.query("delete from defis where defi = $1 and compte = $2 and expire > now() returning defi", [
          defi,
          c.get("compte"),
        ])
      : [];
    if (!ok || !reponse) return err(c, 400, "La demande a expiré : recommencez.");
    try {
      const v = await verifyRegistrationResponse({
        response: reponse,
        expectedChallenge: defi!,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
      if (!v.verified) throw new Error("non vérifiée");
      const cred = v.registrationInfo.credential;
      await db.query(
        `insert into passkeys (id, compte, cle, compteur, transports, nom) values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing`,
        [
          cred.id,
          c.get("compte"),
          Buffer.from(cred.publicKey).toString("base64url"),
          cred.counter,
          (cred.transports ?? []).join(","),
          nom,
        ],
      );
    } catch (e) {
      console.error(e);
      return err(c, 400, "La passkey n'a pas pu être enregistrée.");
    }
    return c.json(await detail(c.get("compte")));
  });

  app.delete("/passkeys/:id", auth, async (c) => {
    await db.query("delete from passkeys where id = $1 and compte = $2", [c.req.param("id"), c.get("compte")]);
    return c.json(await detail(c.get("compte")));
  });

  /* ---------- Compte ---------- */

  async function detail(id: string): Promise<CompteDetail> {
    const compte = (await compteOf(id))!;
    const rows = await db.query<{ id: string; nom: string; cree: Date; utilise: Date | null }>(
      "select id, nom, cree, utilise from passkeys where compte = $1 order by cree",
      [id],
    );
    const passkeys: Passkey[] = rows.map((r) => ({ id: r.id, nom: r.nom, cree: ms(r.cree)!, utilise: ms(r.utilise) }));
    return { ...compte, passkeys };
  }

  app.get("/compte", auth, async (c) => c.json(await detail(c.get("compte"))));

  app.delete("/compte", auth, async (c) => {
    await db.query("delete from comptes where id = $1", [c.get("compte")]);
    deleteCookie(c, COOKIE, { path: "/api" });
    return c.body(null, 204);
  });

  app.get("/compte/donnees", auth, async (c) => {
    const id = c.get("compte");
    const [compte] = await db.query<{ email: string; cree: Date; statut: string }>(
      "select email, cree, statut from comptes where id = $1",
      [id],
    );
    const passkeys = await db.query<{ nom: string; cree: Date }>("select nom, cree from passkeys where compte = $1", [
      id,
    ]);
    const projets = await db.query<{ donnees: Project }>(
      "select donnees from projets where compte = $1 and not supprime order by modifie desc",
      [id],
    );
    c.header("Content-Disposition", 'attachment; filename="quart-de-tour-donnees.json"');
    return c.json({
      format: "quart-de-tour-donnees",
      compte: { email: compte!.email, cree: compte!.cree, statut: compte!.statut },
      passkeys,
      atelier: await atelierOf(id),
      projets: projets.map((p) => p.donnees),
    });
  });

  app.post("/deconnexion", async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await db.query("delete from sessions where hash = $1", [sha256(token)]);
    deleteCookie(c, COOKIE, { path: "/api" });
    return c.body(null, 204);
  });

  /* ---------- Projets ---------- */

  const index = (compte: string) =>
    db.query<Entree>("select id, modifie, supprime from projets where compte = $1", [compte]);

  app.get("/projets", auth, async (c) => c.json(await index(c.get("compte"))));

  /** Range les versions reçues : chacune ne remplace que plus ancienne qu'elle. Renvoie l'index à jour. */
  app.put("/projets", auth, async (c) => {
    const list = (await body(c)).changements;
    if (!Array.isArray(list) || list.length > MAX_BATCH) return err(c, 400, "Envoi mal formé.");
    const compte = c.get("compte");
    for (const raw of list as unknown[]) {
      const ch = (raw ?? {}) as Record<string, unknown>;
      const id = typeof ch.id === "string" && ch.id.length <= 100 ? ch.id : null;
      if (!id) continue;
      let modifie: number, supprime: boolean, donnees: string | null;
      if (ch.supprime === true) {
        if (typeof ch.modifie !== "number" || !Number.isFinite(ch.modifie)) continue;
        [modifie, supprime, donnees] = [ch.modifie, true, null];
      } else {
        const p = sanitizeProject({ ...(ch.projet as object), id });
        if (!p) continue;
        p.nom = p.nom.slice(0, 80);
        [modifie, supprime, donnees] = [p.modifie, false, JSON.stringify(p)];
      }
      await db.query(
        `insert into projets (compte, id, modifie, supprime, donnees) values ($1, $2, $3, $4, $5::jsonb)
         on conflict (compte, id) do update
           set modifie = excluded.modifie, supprime = excluded.supprime, donnees = excluded.donnees
           where projets.modifie < excluded.modifie`,
        [compte, id, Math.round(modifie), supprime, donnees],
      );
    }
    return c.json(await index(compte));
  });

  /* ---------- Atelier ---------- */

  /** Profil du compte ; les lignes d'avant les devis reviennent sans tarifs ni fiche de l'entreprise. */
  async function atelierOf(compte: string): Promise<Atelier | null> {
    const [row] = await db.query<{
      modifie: number;
      donnees: AtelierDefauts;
      tarifs: Tarifs | null;
      entreprise: Entreprise | null;
    }>("select modifie, donnees, tarifs, entreprise from ateliers where compte = $1", [compte]);
    return row
      ? sanitizeAtelier({ defauts: row.donnees, tarifs: row.tarifs, entreprise: row.entreprise, modifie: row.modifie })
      : null;
  }

  app.get("/atelier", auth, async (c) => c.json(await atelierOf(c.get("compte"))));

  /** Le profil reçu ne remplace que plus ancien que lui ; renvoie celui qui l'emporte. */
  app.put("/atelier", auth, async (c) => {
    const raw = (await body(c)).atelier;
    const a = sanitizeAtelier(raw);
    if (!a) return err(c, 400, "Envoi mal formé.");
    // Une version de l'outil d'avant les devis envoie son profil sans tarifs ni fiche : on garde ceux du compte.
    const has = (k: string) => typeof raw === "object" && raw !== null && k in raw;
    const compte = c.get("compte");
    await db.query(
      `insert into ateliers (compte, modifie, donnees, tarifs, entreprise) values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
       on conflict (compte) do update set modifie = excluded.modifie, donnees = excluded.donnees,
         tarifs = coalesce(excluded.tarifs, ateliers.tarifs),
         entreprise = coalesce(excluded.entreprise, ateliers.entreprise)
         where ateliers.modifie < excluded.modifie`,
      [
        compte,
        a.modifie,
        JSON.stringify(a.defauts),
        has("tarifs") ? JSON.stringify(a.tarifs) : null,
        has("entreprise") ? JSON.stringify(a.entreprise) : null,
      ],
    );
    return c.json(await atelierOf(compte));
  });

  app.post("/projets/lire", auth, async (c) => {
    const ids = (await body(c)).ids;
    if (!Array.isArray(ids) || ids.length > MAX_BATCH || ids.some((i) => typeof i !== "string"))
      return err(c, 400, "Demande mal formée.");
    const rows = await db.query<{ donnees: Project }>(
      "select donnees from projets where compte = $1 and id = any($2) and not supprime",
      [c.get("compte"), ids],
    );
    return c.json(rows.map((r) => r.donnees));
  });

  return app;
}
