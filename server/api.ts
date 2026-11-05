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
import {
  DATE_REFUSEE,
  cleanEmail,
  type Compte,
  type CompteDetail,
  type Entree,
  type Appareil,
  type Passkey,
  type Refus,
  type Statut,
} from "../src/core/account";
import {
  mergeAtelier,
  sameAtelier,
  sanitizeAtelier,
  type Atelier,
  type AtelierDates,
  type AtelierDefauts,
} from "../src/core/atelier";
import { MAX_OCTETS, sanitizeDevis } from "../src/core/devis";
import type { Entreprise, Tarifs } from "../src/core/tarifs";
import { avecRemis, fromNewerVersion, isProjectId, sanitizeProject, schemaOf, type Project } from "../src/core/project";
import { DROITS, ESSAI_RESTE_MIN, LIMITES_ACTIVES, isOffre, isRythme, niveauDe, statutReel } from "../src/core/niveaux";
import { sansControles } from "../src/core/texte";
import type { Db } from "./db";
import type { SendAdresseChangee, SendCode, SendPasskeyAjoutee } from "./mail";
import type { Paiements } from "./stripe";

export interface ApiConfig {
  db: Db;
  /** Adresse du site, seule origine acceptée : https://quart-de-tour.fr en ligne. */
  origin: string;
  sendCode: SendCode;
  /** Code envoyé à la nouvelle adresse d'un compte. */
  sendCodeAdresse: SendCode;
  /** Avis à son ancienne adresse, une fois changée. */
  sendAdresseChangee: SendAdresseChangee;
  /** Code envoyé à l'adresse du compte, pour prouver que c'est bien la personne avant un geste qui l'engage. */
  sendCodePreuve: SendCode;
  /** Tables des limites de débit, pour qui doit les balayer ; neuves sinon. */
  limites?: Limites;
  /** Avis à l'adresse du compte, une passkey ajoutée. */
  sendPasskeyAjoutee: SendPasskeyAjoutee;
  /** Stripe ; sans lui, le paiement en ligne reste fermé. */
  paiements?: Paiements;
  /** Les services du serveur suivent le niveau du compte ; `LIMITES_ACTIVES` sinon. */
  limitesActives?: boolean;
}

type Env = { Variables: { compte: string; session: string; droits: Pick<Compte, "statut" | "droitsJusquA"> } };

const COOKIE = "limon-session";
/** Une session sans usage pendant cette durée se ferme ; un usage, une fois par jour au plus, la prolonge d'autant. */
const SESSION_DAYS = 90;
/** Aucune ne dépasse cette durée après son ouverture, même utilisée chaque jour. */
const SESSION_MAX_DAYS = 365;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
/** Chiffres d'un code envoyé par e-mail. Les champs de code de `app/index.html` (`pattern`, `maxlength`) le suivent. */
const CODE_CHIFFRES = 8;
const CODE_FORME = new RegExp(`^\\d{${CODE_CHIFFRES}}$`);
const CODE_MAL_FORME = `Le code a ${CODE_CHIFFRES} chiffres.`;
const nouveauCode = () =>
  randomInt(0, 10 ** CODE_CHIFFRES)
    .toString()
    .padStart(CODE_CHIFFRES, "0");
/** Codes de connexion par heure, pour une adresse IP et un e-mail : qui ne reçoit rien réessaie, sans plus. */
const CODES_PAR_IP_EMAIL = 3;
/** Codes par heure à un même e-mail, d'où qu'ils viennent : la protection de sa boîte, pas une limite pour la personne. */
export const CODES_PAR_EMAIL = 20;
/** Codes de connexion valables à la fois pour un e-mail : les plus récents, chacun multiplie les chances d'un essai. */
export const CODES_VALABLES = 3;
/** Essais par heure sur un e-mail, d'où qu'ils viennent : avec `CODES_VALABLES`, ce plafond borne ce qu'on peut deviner. */
export const ESSAIS_PAR_EMAIL = 30;
/** Codes de changement d'adresse par heure : un compte peut se tromper en la tapant. */
const CODES_ADRESSE_PAR_COMPTE = 5;
/** Codes de preuve par heure et par compte : chacun arrive dans la boîte de la personne. */
const CODES_PREUVE_PAR_COMPTE = 5;
/** Codes par heure, tous envois et toutes personnes confondus. Un compte en demande rarement : passkey, session longue. */
export const CODES_PAR_HEURE = 100;
/** Vérifications de code par heure et par adresse IP : 5 essais pour chacune de quelques personnes, un atelier à plusieurs. */
export const VERIFICATIONS_PAR_IP = 60;
/** Une connexion, une passkey ou un code de moins de cette durée permet les gestes qui engagent le compte. */
const PREUVE_MINUTES = 5;
const HOUR = 3_600_000;
/** Projets ou identifiants par requête. */
const MAX_BATCH = 1000;
/** Lignes par compte, traces de suppression comprises. */
const MAX_PROJETS = 2000;
/** Avance tolérée sur l'heure du serveur pour une date de modification : une horloge d'appareil peut se tromper. */
const MAX_AVANCE = 732 * 24 * HOUR;
/** Envois ou lectures par minute, par compte et par route : largement au-dessus d'un échange toutes les 3 s. */
const MAX_ENVOIS = 120;
/** Clés gardées par limite. */
const MAX_CLES = 10_000;
/** Longueur gardée d'une clé, assez pour une adresse e-mail : la mémoire d'une table reste bornée. */
const LONGUEUR_CLE = 320;

/** Lu par un onglet ouvert depuis avant la preuve, qui ne sait pas la demander : se reconnecter en est une. */
const PREUVE_DEMANDEE = `Par sécurité, ce geste demande une connexion de moins de ${PREUVE_MINUTES} minutes : déconnectez-vous, puis reconnectez-vous.`;
const TROP_DE_CODES = "Trop de codes demandés. Réessayez dans une heure.";
const TROP_D_ESSAIS = "Trop d'essais. Réessayez dans une heure.";
const ESSAIS_EPUISES = "Trop d'essais sur cette adresse e-mail, pas forcément les vôtres. Réessayez dans une heure.";
const CODES_EPUISES =
  "Trop de codes sont partis cette heure-ci, pour tout le monde et pas seulement pour vous. Réessayez dans une heure.";
const PASSKEY_REFUSEE = "La passkey n'a pas pu être vérifiée : connectez-vous avec un code par e-mail.";
const ILLISIBLE = "Cet escalier ne peut pas être relu.";
const SCHEMA_PLUS_HAUT =
  "Il a été changé sur un autre appareil, avec une version plus récente de l'outil : votre compte garde celle-là.";
const SCHEMA_INCONNU = "Il vient d'une version de l'outil que votre compte ne connaît pas encore.";
const COMPTE_PLEIN = `Votre compte garde au plus ${MAX_PROJETS} escaliers, supprimés compris : celui-ci n'y entre plus.`;
const TROP_LOURD = "Il est trop lourd pour votre compte, avec les versions remises de son devis. Aucune n'est perdue.";
const OCCUPE = "Il a changé sur un autre appareil au même moment : il repartira au prochain chargement de la page.";
const PAS_ARRIVE =
  "Cet escalier n'a pas encore rejoint votre compte, qui donne les numéros. Réessayez dans un instant : le brouillon reste enregistré.";

const PAIEMENT_FERME = "Le paiement en ligne n'est pas encore ouvert.";
const PAIEMENT_EN_PANNE = "Le paiement ne répond pas pour l'instant : rien n'a été prélevé. Réessayez dans un instant.";
const ATELIER_REFUSE = "Les réglages de l'atelier viennent avec l'abonnement : ils restent gardés sur cet appareil.";
const DEVIS_REFUSE = "Le devis vient avec l'offre « Pour vendre ». Ce qui est déjà écrit reste gardé.";

const pese = (p: Project) => Buffer.byteLength(JSON.stringify(p));

/**
 * Ce qu'un envoi sans numéro de schéma contient vraiment : `sanitizeProject` a rempli le reste, qu'une version de
 * l'outil d'avant ce numéro ne connaissait peut-être pas. Un réglage illisible compte comme absent.
 */
function sent(raw: Record<string, unknown>, p: Project): Partial<Project> {
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(p).filter(([k]) => k in raw && k !== "schema" && k !== "params"),
  );
  if (raw.params && typeof raw.params === "object") {
    const params = raw.params as Record<string, unknown>;
    out.params = Object.fromEntries(Object.entries(p.params).filter(([k, v]) => params[k] === v));
  }
  return out;
}

/**
 * Une limite : au plus `max` essais par clé dans la fenêtre, en mémoire, un seul serveur tournant, et rien n'est
 * conservé. La table est rangée du dernier essai le plus ancien au plus récent : ce qui a expiré est toujours devant.
 */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly capacite = MAX_CLES,
  ) {}

  get taille(): number {
    return this.hits.size;
  }

  private limitee(essais: number[], now: number): boolean {
    return essais.length >= this.max && now - essais[0]! < this.windowMs;
  }

  /** Vrai si `key` est à sa limite, sans compter d'essai. */
  atteinte(key: string): boolean {
    const essais = this.hits.get(key.slice(0, LONGUEUR_CLE));
    return !!essais && this.limitee(essais, Date.now());
  }

  /** Vrai si l'essai passe ; faux au-delà de `max` dans la fenêtre, ou si la table est pleine de clés limitées. */
  hit(key: string): boolean {
    const cle = key.slice(0, LONGUEUR_CLE);
    const now = Date.now();
    const essais = this.hits.get(cle) ?? [];
    if (this.limitee(essais, now)) return false;
    this.hits.delete(cle);
    if (this.hits.size >= this.capacite && !this.evince(now)) return false;
    this.hits.set(cle, [...essais.filter((t) => now - t < this.windowMs), now]);
    return true;
  }

  /** Fait une place en retirant la clé la plus ancienne qui n'est pas limitée : une expirée s'il y en a. */
  private evince(now: number): boolean {
    for (const [cle, essais] of this.hits) {
      if (this.limitee(essais, now)) continue;
      this.hits.delete(cle);
      return true;
    }
    return false;
  }

  /** Oublie les clés expirées. Ne parcourt que celles-là. */
  balaye(): void {
    const now = Date.now();
    for (const [cle, essais] of this.hits) {
      if (now - essais.at(-1)! < this.windowMs) return;
      this.hits.delete(cle);
    }
  }
}

/** Une table par limite : aucune ne peut pousser dehors les clés d'une autre. */
export function nouvellesLimites() {
  return {
    codesParIp: new Limiter(20, HOUR),
    codesParIpEmail: new Limiter(CODES_PAR_IP_EMAIL, HOUR),
    verificationsParIp: new Limiter(VERIFICATIONS_PAR_IP, HOUR),
    essaisParIpEmail: new Limiter(CODE_TRIES, HOUR),
    essaisParEmail: new Limiter(ESSAIS_PAR_EMAIL, HOUR),
    passkeysParIp: new Limiter(60, HOUR),
    codesParEmail: new Limiter(CODES_PAR_EMAIL, HOUR),
    codesAdresseParEmail: new Limiter(CODES_PAR_EMAIL, HOUR),
    codesAdresseParCompte: new Limiter(CODES_ADRESSE_PAR_COMPTE, HOUR),
    codesPreuveParCompte: new Limiter(CODES_PREUVE_PAR_COMPTE, HOUR),
    envoisParCompte: new Limiter(MAX_ENVOIS, 60_000),
    codesEnvoyes: new Limiter(CODES_PAR_HEURE, HOUR),
  };
}
export type Limites = ReturnType<typeof nouvellesLimites>;
export const balayeLimites = (limites: Limites) => Object.values(limites).forEach((l) => l.balaye());

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const ms = (d: unknown) => (d ? new Date(d as string).getTime() : null);
/** Ce que la page sait du compte, depuis sa ligne en base. */
const COMPTE_COLONNES = "id, email, statut, droits_jusqu_a";
type CompteLigne = { id: string; email: string; statut: Statut; droits_jusqu_a: Date | null };
const compteDe = (r: CompteLigne): Compte => ({
  id: r.id,
  email: r.email,
  statut: r.statut,
  droitsJusquA: ms(r.droits_jusqu_a),
});
/** Moyens de joindre une passkey, en base séparés par des virgules. */
const transportsOf = (p: { transports: string }) => (p.transports ? p.transports.split(",") : []);
const err = (c: Context, status: ContentfulStatusCode, erreur: string) => c.json({ erreur }, status);
/** Erreur de Postgres qui tient à la donnée reçue, pas à la base (classe 22). */
const isDataError = (e: unknown) => /^22/.test(String((e as { code?: unknown } | null)?.code));
/** Nom donné par la page à l'appareil qu'elle connecte, ou à sa passkey. */
const nomAppareil = (nom: unknown) => (typeof nom === "string" && sansControles(nom).trim().slice(0, 40)) || "Appareil";
const validDate = (m: unknown): m is number =>
  Number.isInteger(m) && (m as number) >= 0 && (m as number) <= Date.now() + MAX_AVANCE;
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

/** La seule clé du plafond commun. */
const TOUS = "tous";

/** Routes /api : connexion, compte et projets. */
export function api(cfg: ApiConfig): Hono<Env> {
  const { db, origin } = cfg;
  const rpID = new URL(origin).hostname;
  const secure = origin.startsWith("https:");
  // Les codes sont gardés hachés avec ce sel, propre au processus : une copie de la base ne les révèle pas.
  const pepper = randomBytes(32);
  const codeHash = (email: string, code: string) => createHmac("sha256", pepper).update(`${email}:${code}`).digest();
  const limites = cfg.limites ?? nouvellesLimites();
  const ip = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  const app = new Hono<Env>().basePath("/api");

  /**
   * Nouvelles de Stripe, avant le contrôle de l'origine : la seule route qui n'en a pas, la signature en tient lieu. Le
   * corps se lit brut, la signature porte sur lui. L'événement et son effet s'écrivent ensemble : rejoué, il ne change
   * rien, et un échec le laisse à redire par Stripe. Les événements n'arrivent pas toujours dans l'ordre : un plus ancien
   * que le dernier pris en compte, ou la fin d'un autre abonnement que celui du compte, n'y touche pas.
   */
  app.post("/stripe", bodyLimit({ maxSize: 4 << 20, onError: (c) => err(c, 413, "Envoi trop gros.") }), async (c) => {
    if (!cfg.paiements) return err(c, 503, PAIEMENT_FERME);
    const ev = cfg.paiements.evenement(await c.req.text(), c.req.header("stripe-signature"));
    if (!ev) return err(c, 400, "Signature refusée.");
    if (ev.etat) {
      const e = ev.etat;
      await db.query(
        `with nouveau as (insert into paiements_evenements (id) values ($1) on conflict do nothing returning id)
           update comptes set statut = $3, droits_jusqu_a = to_timestamp($4::bigint / 1000.0),
             abonnement = case when $3 = 'expire' then null else $5 end, resilie = $6, abonnement_evenement = $7
           where client_stripe = $2 and statut <> 'testeur' and exists (select 1 from nouveau)
             and coalesce(abonnement_evenement, 0) <= $7
             and ($3 <> 'expire' or abonnement is null or abonnement = $5)`,
        [ev.id, e.client, e.statut, e.droitsJusquA, e.abonnement, e.resilie, e.date],
      );
    }
    return c.json({ recu: true });
  });

  app.use(async (c, next) => {
    // Une requête qui modifie quelque chose doit venir du site lui-même.
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("origin") !== origin)
      return err(c, 403, "Origine refusée.");
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use(bodyLimit({ maxSize: 4 << 20, onError: (c) => err(c, 413, "Envoi trop gros.") }));
  app.onError((e, c) => {
    if (isDataError(e)) return err(c, 400, "Demande mal formée.");
    console.error(e);
    return err(c, 500, "Le serveur ne répond pas. Réessayez dans un instant.");
  });

  /** Le compte a servi : son effacement recule, et un avertissement déjà parti ne compte plus. */
  const vu = (compte: string) => db.query("update comptes set vu = now(), averti = null where id = $1", [compte]);

  async function startSession(c: Context, compte: string, appareil: unknown): Promise<void> {
    await vu(compte);
    const token = randomBytes(32).toString("base64url");
    await db.query(
      `insert into sessions (hash, compte, appareil, expire, preuve)
       values ($1, $2, $3, now() + interval '${SESSION_DAYS} days', now())`,
      [sha256(token), compte, nomAppareil(appareil)],
    );
    setSessionCookie(c, token, SESSION_DAYS * 86400);
  }
  function setSessionCookie(c: Context, token: string, maxAge: number): void {
    setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/api", maxAge });
  }
  async function compteOf(id: string): Promise<Compte | null> {
    const [r] = await db.query<CompteLigne>(`select ${COMPTE_COLONNES} from comptes where id = $1`, [id]);
    return r ? compteDe(r) : null;
  }

  /** Session valable, prolongée au plus une fois par jour jusqu'à son plafond, avec la dernière activité du compte. */
  const auth = createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, COOKIE);
    const hash = token && sha256(token);
    const [s] = hash
      ? await db.query<{ compte: string; renew: boolean; revu: boolean; statut: Statut; droits_jusqu_a: Date | null }>(
          `select s.compte, s.utilise < now() - interval '1 day' as renew,
             c.vu < now() - interval '1 day' as revu, c.statut, c.droits_jusqu_a
           from sessions s join comptes c on c.id = s.compte where s.hash = $1 and s.expire > now()`,
          [hash],
        )
      : [];
    if (!s) return err(c, 401, "Vous n'êtes plus connecté.");
    if (s.revu) await vu(s.compte);
    if (s.renew) {
      const [r] = await db.query<{ reste: number }>(
        `update sessions set utilise = now(),
           expire = least(now() + interval '${SESSION_DAYS} days', cree + interval '${SESSION_MAX_DAYS} days')
         where hash = $1 returning extract(epoch from expire - now())::int as reste`,
        [hash],
      );
      if (r) setSessionCookie(c, token!, r.reste);
    }
    c.set("compte", s.compte);
    c.set("session", hash!);
    const droitsJusquA = ms(s.droits_jusqu_a);
    c.set("droits", { statut: s.statut, droitsJusquA });
    await next();
    // Sans requête de plus : la page voit le statut à chaque échange.
    c.header("X-Statut", `${s.statut};${droitsJusquA ?? ""}`);
  });

  /** Service du serveur réservé à un niveau. 402 : la page y reconnaît l'offre, ni une panne ni le réseau. */
  const limitesActives = cfg.limitesActives ?? LIMITES_ACTIVES;
  const exige = (droit: "atelier" | "devis", refus: string) =>
    createMiddleware<Env>(async (c, next) => {
      if (limitesActives && !DROITS[niveauDe(statutReel(c.get("droits"), Date.now()))][droit])
        return err(c, 402, refus);
      await next();
    });

  /**
   * Geste qui engage le compte, après `auth` : une session ne suffit pas, il faut une connexion ou une preuve récente.
   * Déconnecter un appareil et retirer une passkey n'en demandent pas : c'est ce qu'on fait quand un téléphone est perdu,
   * souvent avec la boîte mail dessus, et cela ne donne aucun accès.
   */
  const preuve = createMiddleware<Env>(async (c, next) => {
    const [s] = await db.query<{ recente: boolean | null }>(
      `select preuve > now() - interval '${PREUVE_MINUTES} minutes' as recente from sessions where hash = $1`,
      [c.get("session")],
    );
    if (!s?.recente) return c.json({ erreur: PREUVE_DEMANDEE, preuve: true }, 403);
    await next();
  });

  /** Limite de débit par compte, après `auth`. */
  const debit = createMiddleware<Env>(async (c, next) => {
    if (!limites.envoisParCompte.hit(`${c.req.path}:${c.get("compte")}`))
      return err(c, 429, "Trop d'envois en peu de temps. Réessayez dans une minute.");
    await next();
  });

  /**
   * Le refus à rendre avant d'envoyer un code, ou null si le code peut partir. Le plafond commun est regardé d'abord et
   * compté en dernier : une demande refusée n'use ni les limites de la personne, ni le plafond de tout le monde.
   */
  function refusCode(c: Context, ...siennes: [Limiter, string][]) {
    if (limites.codesEnvoyes.atteinte(TOUS)) return err(c, 429, CODES_EPUISES);
    if (siennes.some(([limite, cle]) => limite.atteinte(cle))) return err(c, 429, TROP_DE_CODES);
    if (!siennes.every(([limite, cle]) => limite.hit(cle))) return err(c, 429, TROP_DE_CODES);
    limites.codesEnvoyes.hit(TOUS);
    return null;
  }

  app.get("/sante", async (c) => {
    await db.query("select 1");
    return c.text("ok");
  });

  /* ---------- Code par e-mail ---------- */

  app.post("/code", async (c) => {
    const email = cleanEmail((await body(c)).email);
    if (!email) return err(c, 400, "Cette adresse e-mail n'est pas valable.");
    const refus = refusCode(
      c,
      [limites.codesParIpEmail, `${ip(c)}:${email}`],
      [limites.codesParIp, ip(c)],
      [limites.codesParEmail, email],
    );
    if (refus) return refus;
    const code = nouveauCode();
    await db.query(
      `insert into codes (email, hash, expire) values ($1, $2, now() + interval '${CODE_MINUTES} minutes')`,
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
    if (!email || !CODE_FORME.test(code)) return err(c, 400, CODE_MAL_FORME);
    if (!limites.verificationsParIp.hit(ip(c))) return err(c, 429, TROP_D_ESSAIS);
    const valables = await db.query<{ hash: string }>(
      `select hash from codes where email = $1 and expire > now() order by id desc limit ${CODES_VALABLES}`,
      [email],
    );
    if (!valables.length) return err(c, 400, "Ce code a expiré : demandez-en un nouveau.");
    // Comptés seulement là où un code attend, donc pour peu d'e-mails : ces tables ne se remplissent pas. Le plafond de
    // l'e-mail est regardé d'abord : pendant qu'il est atteint, la personne n'use pas ses propres essais.
    if (limites.essaisParEmail.atteinte(email)) return err(c, 429, ESSAIS_EPUISES);
    if (!limites.essaisParIpEmail.hit(`${ip(c)}:${email}`)) return err(c, 429, TROP_D_ESSAIS);
    if (!limites.essaisParEmail.hit(email)) return err(c, 429, ESSAIS_EPUISES);
    const attendu = codeHash(email, code);
    const bon = valables.find((v) => timingSafeEqual(Buffer.from(v.hash, "hex"), attendu));
    if (!bon) return err(c, 400, "Code incorrect.");
    // Un code ne sert qu'une fois, même demandé deux fois au même instant ; les autres tombent avec la connexion.
    const [pris] = await db.query("delete from codes where email = $1 and hash = $2 returning id", [email, bon.hash]);
    if (!pris) return err(c, 400, "Ce code a expiré : demandez-en un nouveau.");
    await db.query("delete from codes where email = $1", [email]);
    await db.query("insert into comptes (id, email) values ($1, $2) on conflict (email) do nothing", [
      randomUUID(),
      email,
    ]);
    const [compte] = await db.query<CompteLigne>(`select ${COMPTE_COLONNES} from comptes where email = $1`, [email]);
    await startSession(c, compte!.id, b.appareil);
    return c.json(compteDe(compte!));
  });

  /* ---------- Passkeys ---------- */

  /** Signature de la passkey, visage, empreinte ou code de l'appareil compris ; note son usage. */
  async function verifiePasskey(
    reponse: AuthenticationResponseJSON,
    defi: string,
    pk: { cle: string; compteur: number; transports: string },
  ): Promise<boolean> {
    let newCounter: number;
    try {
      const v = await verifyAuthenticationResponse({
        response: reponse,
        expectedChallenge: defi,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: reponse.id,
          publicKey: Buffer.from(pk.cle, "base64url"),
          counter: pk.compteur,
          transports: transportsOf(pk),
        },
        requireUserVerification: true,
      });
      if (!v.verified) throw new Error("non vérifiée");
      newCounter = v.authenticationInfo.newCounter;
    } catch (e) {
      console.error(e);
      return false;
    }
    await db.query("update passkeys set compteur = $2, utilise = now() where id = $1", [reponse.id, newCounter]);
    return true;
  }

  app.post("/passkey/options", async (c) => {
    if (!limites.passkeysParIp.hit(ip(c))) return err(c, 429, "Trop d'essais. Réessayez dans une heure.");
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    await db.query("insert into defis (defi, expire) values ($1, now() + interval '5 minutes')", [options.challenge]);
    return c.json(options);
  });

  app.post("/passkey/connexion", async (c) => {
    const b = await body(c);
    const reponse = b.reponse as AuthenticationResponseJSON | undefined;
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
    if (!(await verifiePasskey(reponse, defi!, pk))) return err(c, 400, PASSKEY_REFUSEE);
    await startSession(c, pk.compte, b.appareil);
    return c.json(await compteOf(pk.compte));
  });

  app.post("/passkey/ajout/options", auth, preuve, async (c) => {
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
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: transportsOf(p) })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    await db.query("insert into defis (defi, compte, expire) values ($1, $2, now() + interval '5 minutes')", [
      options.challenge,
      compte.id,
    ]);
    return c.json(options);
  });

  app.post("/passkey/ajout", auth, preuve, async (c) => {
    const b = await body(c);
    const reponse = b.reponse as RegistrationResponseJSON | undefined;
    const nom = nomAppareil(b.nom);
    const defi = challengeOf(reponse);
    const [ok] = defi
      ? await db.query("delete from defis where defi = $1 and compte = $2 and expire > now() returning defi", [
          defi,
          c.get("compte"),
        ])
      : [];
    if (!ok || !reponse) return err(c, 400, "La demande a expiré : recommencez.");
    let ajoutee: unknown[];
    try {
      const v = await verifyRegistrationResponse({
        response: reponse,
        expectedChallenge: defi!,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!v.verified) throw new Error("non vérifiée");
      const cred = v.registrationInfo.credential;
      ajoutee = await db.query(
        `insert into passkeys (id, compte, cle, compteur, transports, nom) values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing returning id`,
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
    // Sans le nom donné par la page, qui n'a rien à faire dans un message reçu par la personne. L'ajout est fait : un avis
    // qui ne part pas n'y revient pas.
    if (ajoutee.length) await cfg.sendPasskeyAjoutee((await compteOf(c.get("compte")))!.email).catch(console.error);
    return c.json(await detail(c));
  });

  app.delete("/passkeys/:id", auth, async (c) => {
    await db.query("delete from passkeys where id = $1 and compte = $2", [c.req.param("id"), c.get("compte")]);
    return c.json(await detail(c));
  });

  /* ---------- Preuve récente ---------- */

  const prouve = (c: Context<Env>) =>
    db.query("update sessions set preuve = now() where hash = $1", [c.get("session")]);

  /** Seulement les passkeys du compte : le navigateur ne propose pas celle d'un autre. */
  app.post("/preuve/passkey/options", auth, debit, async (c) => {
    const compte = c.get("compte");
    const cles = await db.query<{ id: string; transports: string }>(
      "select id, transports from passkeys where compte = $1",
      [compte],
    );
    if (!cles.length) return err(c, 400, "Votre compte n'a pas de passkey : demandez un code par e-mail.");
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: cles.map((p) => ({ id: p.id, transports: transportsOf(p) })),
    });
    await db.query("insert into defis (defi, compte, expire) values ($1, $2, now() + interval '5 minutes')", [
      options.challenge,
      compte,
    ]);
    return c.json(options);
  });

  app.post("/preuve/passkey", auth, async (c) => {
    const compte = c.get("compte");
    const reponse = (await body(c)).reponse as AuthenticationResponseJSON | undefined;
    const defi = challengeOf(reponse);
    const [ok] = defi
      ? await db.query("delete from defis where defi = $1 and compte = $2 and expire > now() returning defi", [
          defi,
          compte,
        ])
      : [];
    if (!ok || !reponse) return err(c, 400, "La demande a expiré : recommencez.");
    const [pk] = await db.query<{ cle: string; compteur: number; transports: string }>(
      "select cle, compteur, transports from passkeys where id = $1 and compte = $2",
      [reponse.id, compte],
    );
    if (!pk || !(await verifiePasskey(reponse, defi!, pk)))
      return err(c, 400, "La passkey n'a pas pu être vérifiée : demandez un code par e-mail.");
    await prouve(c);
    return c.body(null, 204);
  });

  /** Le code part à l'adresse du compte. À part des codes de connexion : l'un ne sert pas à l'autre et ne le remplace pas. */
  app.post("/preuve/code", auth, async (c) => {
    const compte = c.get("compte");
    const refus = refusCode(c, [limites.codesPreuveParCompte, compte]);
    if (refus) return refus;
    const code = nouveauCode();
    await db.query(
      `insert into codes_preuve (compte, hash, expire, essais)
       values ($1, $2, now() + interval '${CODE_MINUTES} minutes', 0)
       on conflict (compte) do update set hash = excluded.hash, expire = excluded.expire, essais = 0`,
      [compte, codeHash(`preuve:${compte}`, code).toString("hex")],
    );
    try {
      await cfg.sendCodePreuve((await compteOf(compte))!.email, code);
    } catch (e) {
      console.error(e);
      return err(c, 502, "L'e-mail n'a pas pu partir. Réessayez dans un instant.");
    }
    return c.body(null, 204);
  });

  app.post("/preuve/code/verifier", auth, async (c) => {
    const b = await body(c);
    const code = typeof b.code === "string" ? b.code.replace(/\s/g, "") : "";
    if (!CODE_FORME.test(code)) return err(c, 400, CODE_MAL_FORME);
    const compte = c.get("compte");
    const [row] = await db.query<{ hash: string; essais: number }>(
      "update codes_preuve set essais = essais + 1 where compte = $1 and expire > now() returning hash, essais",
      [compte],
    );
    if (!row) return err(c, 400, "Ce code a expiré : demandez-en un nouveau.");
    if (row.essais > CODE_TRIES) {
      await db.query("delete from codes_preuve where compte = $1", [compte]);
      return err(c, 400, "Trop d'essais : demandez un nouveau code.");
    }
    if (!timingSafeEqual(Buffer.from(row.hash, "hex"), codeHash(`preuve:${compte}`, code)))
      return err(c, 400, "Code incorrect.");
    await db.query("delete from codes_preuve where compte = $1", [compte]);
    await prouve(c);
    return c.body(null, 204);
  });

  /* ---------- Compte ---------- */

  /**
   * Changer l'adresse : un code part à la nouvelle, sans dire si elle a déjà un compte, puis `PUT /compte/email` la
   * prend. Le code ne vaut que pour ce compte et cette adresse, et une adresse déjà prise n'est dite qu'à qui prouve
   * qu'elle est à lui. L'adresse ouvre le compte : la demande exige une preuve récente. Pas `PUT`, qui ne vaut que pour
   * une demande faite ainsi, et laisse les 10 minutes du code pour aller lire ses messages.
   */
  app.post("/compte/email/code", auth, preuve, async (c) => {
    const email = cleanEmail((await body(c)).email);
    if (!email) return err(c, 400, "Cette adresse e-mail n'est pas valable.");
    const compte = c.get("compte");
    if (email === (await compteOf(compte))!.email) return err(c, 400, "C'est déjà l'adresse de votre compte.");
    const refus = refusCode(c, [limites.codesAdresseParCompte, compte], [limites.codesAdresseParEmail, email]);
    if (refus) return refus;
    const code = nouveauCode();
    await db.query(
      `insert into changements_adresse (compte, email, hash, expire, essais)
       values ($1, $2, $3, now() + interval '${CODE_MINUTES} minutes', 0)
       on conflict (compte) do update set email = excluded.email, hash = excluded.hash, expire = excluded.expire, essais = 0`,
      [compte, email, codeHash(`${compte}:${email}`, code).toString("hex")],
    );
    try {
      await cfg.sendCodeAdresse(email, code);
    } catch (e) {
      console.error(e);
      return err(c, 502, "L'e-mail n'a pas pu partir. Réessayez dans un instant.");
    }
    return c.body(null, 204);
  });

  app.put("/compte/email", auth, async (c) => {
    const b = await body(c);
    const email = cleanEmail(b.email);
    const code = typeof b.code === "string" ? b.code.replace(/\s/g, "") : "";
    if (!email || !CODE_FORME.test(code)) return err(c, 400, CODE_MAL_FORME);
    const compte = c.get("compte");
    const [row] = await db.query<{ hash: string; essais: number }>(
      `update changements_adresse set essais = essais + 1
       where compte = $1 and email = $2 and expire > now() returning hash, essais`,
      [compte, email],
    );
    if (!row) return err(c, 400, "Ce code a expiré : demandez-en un nouveau.");
    if (row.essais > CODE_TRIES) {
      await db.query("delete from changements_adresse where compte = $1", [compte]);
      return err(c, 400, "Trop d'essais : demandez un nouveau code.");
    }
    if (!timingSafeEqual(Buffer.from(row.hash, "hex"), codeHash(`${compte}:${email}`, code)))
      return err(c, 400, "Code incorrect.");
    await db.query("delete from changements_adresse where compte = $1", [compte]);
    const ancienne = (await compteOf(compte))!.email;
    try {
      // Sans lecture avant : l'unicité de la base tranche, même si un compte se crée à cette adresse au même instant.
      const [r] = await db.query<{ client_stripe: string | null }>(
        "update comptes set email = $2, essai = null where id = $1 returning client_stripe",
        [compte, email],
      );
      // Les factures suivent l'adresse ; un échec n'y revient pas.
      if (r?.client_stripe) await cfg.paiements?.changerAdresse(r.client_stripe, email).catch(console.error);
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code !== "23505") throw e;
      return err(c, 409, "Cette adresse a déjà son propre compte. Votre compte garde son adresse actuelle.");
    }
    // L'adresse a changé : un avis qui ne part pas n'y revient pas.
    await cfg.sendAdresseChangee(ancienne).catch(console.error);
    return c.json(await detail(c));
  });

  async function detail(c: Context<Env>): Promise<CompteDetail> {
    const id = c.get("compte");
    const compte = (await compteOf(id))!;
    const rows = await db.query<{ id: string; nom: string; cree: Date; utilise: Date | null }>(
      "select id, nom, cree, utilise from passkeys where compte = $1 order by cree",
      [id],
    );
    const passkeys: Passkey[] = rows.map((r) => ({ id: r.id, nom: r.nom, cree: ms(r.cree)!, utilise: ms(r.utilise) }));
    const sessions = await db.query<{ id: string; appareil: string; cree: Date; utilise: Date; actuel: boolean }>(
      `select id, appareil, cree, utilise, hash = $2 as actuel from sessions
       where compte = $1 and expire > now() order by actuel desc, utilise desc, cree desc`,
      [id, c.get("session")],
    );
    const appareils: Appareil[] = sessions.map((r) => ({
      id: r.id,
      nom: r.appareil,
      cree: ms(r.cree)!,
      utilise: ms(r.utilise)!,
      actuel: r.actuel,
    }));
    const [a] = await db.query<{ client_stripe: string | null; resilie: boolean }>(
      "select client_stripe, resilie from comptes where id = $1",
      [id],
    );
    return {
      ...compte,
      passkeys,
      appareils,
      paiement: !!cfg.paiements,
      gestion: !!a?.client_stripe,
      resilie: !!a?.resilie,
    };
  }

  app.get("/compte", auth, async (c) => c.json(await detail(c)));

  /** Déconnecte un autre appareil. Pas celui-ci : « Se déconnecter » envoie d'abord ce qui attend. */
  app.delete("/sessions/:id", auth, async (c) => {
    await db.query("delete from sessions where id = $1 and compte = $2 and hash <> $3", [
      c.req.param("id"),
      c.get("compte"),
      c.get("session"),
    ]);
    return c.json(await detail(c));
  });

  /** Déconnecte tous les autres appareils. */
  app.delete("/sessions", auth, async (c) => {
    await db.query("delete from sessions where compte = $1 and hash <> $2", [c.get("compte"), c.get("session")]);
    return c.json(await detail(c));
  });

  /* ---------- Abonnement ---------- */

  /** Adresse de la page de paiement de Stripe, pour une offre. */
  app.post("/abonnement/paiement", auth, preuve, debit, async (c) => {
    const p = cfg.paiements;
    if (!p) return err(c, 503, PAIEMENT_FERME);
    const { offre, rythme } = await body(c);
    if (!isOffre(offre) || !isRythme(rythme)) return err(c, 400, "Demande mal formée.");
    const id = c.get("compte");
    const [r] = await db.query<{ email: string; client_stripe: string | null }>(
      "select email, client_stripe from comptes where id = $1",
      [id],
    );
    const droits = c.get("droits");
    const statut = statutReel(droits, Date.now());
    if (statut === "testeur") return err(c, 409, "Votre compte a déjà tout, sans limite de durée.");
    if (statut === "abonne" || statut === "premium")
      return err(c, 409, "Vous êtes déjà abonné : « Gérer mon abonnement » permet de changer d'offre.");
    const reste = droits.droitsJusquA && statut === "essai" ? droits.droitsJusquA - Date.now() : 0;
    try {
      const client = r!.client_stripe ?? (await p.creerClient(id, r!.email));
      if (!r!.client_stripe) await db.query("update comptes set client_stripe = $2 where id = $1", [id, client]);
      const finEssai = reste > ESSAI_RESTE_MIN ? droits.droitsJusquA! : null;
      return c.json({ url: await p.ouvrirPaiement(client, offre, rythme, finEssai) });
    } catch (e) {
      console.error(e);
      return err(c, 502, PAIEMENT_EN_PANNE);
    }
  });

  /** Adresse de la page de Stripe où changer d'offre ou de carte, retrouver ses factures, arrêter. */
  app.post("/abonnement/gestion", auth, preuve, debit, async (c) => {
    const p = cfg.paiements;
    if (!p) return err(c, 503, PAIEMENT_FERME);
    const [r] = await db.query<{ client_stripe: string | null }>("select client_stripe from comptes where id = $1", [
      c.get("compte"),
    ]);
    if (!r?.client_stripe) return err(c, 409, "Vous n'avez pas encore d'abonnement.");
    try {
      return c.json({ url: await p.ouvrirGestion(r.client_stripe) });
    } catch (e) {
      console.error(e);
      return err(c, 502, PAIEMENT_EN_PANNE);
    }
  });

  app.delete("/compte", auth, preuve, async (c) => {
    // L'abonnement s'arrête d'abord : un compte parti ne doit plus être prélevé.
    const [r] = await db.query<{ client_stripe: string | null }>("select client_stripe from comptes where id = $1", [
      c.get("compte"),
    ]);
    if (r?.client_stripe) {
      const arret = "Votre abonnement n'a pas pu être arrêté : rien n'est supprimé. Réessayez dans un instant.";
      if (!cfg.paiements) return err(c, 503, arret);
      try {
        await cfg.paiements.effacerClient(r.client_stripe);
      } catch (e) {
        console.error(e);
        return err(c, 502, arret);
      }
    }
    await db.query("delete from comptes where id = $1", [c.get("compte")]);
    deleteCookie(c, COOKIE, { path: "/api" });
    return c.body(null, 204);
  });

  /** Tout ce que le compte garde. Une colonne ajoutée à la base entre ici ou dans `HORS_EXPORT` (`tests/api.test.ts`). */
  app.get("/compte/donnees", auth, async (c) => {
    const id = c.get("compte");
    const [compte] = await db.query(
      `select id, email, cree, statut, droits_jusqu_a, vu, averti, essai,
         client_stripe, abonnement, abonnement_evenement, resilie
       from comptes where id = $1`,
      [id],
    );
    const passkeys = await db.query(
      "select id, nom, cle, compteur, transports, cree, utilise from passkeys where compte = $1 order by cree",
      [id],
    );
    // Sans l'empreinte, qui ne sort jamais.
    const sessions = await db.query(
      "select id, appareil, cree, utilise, expire, preuve from sessions where compte = $1 order by cree",
      [id],
    );
    const projets = await db.query<{ donnees: Project }>(
      "select donnees from projets where compte = $1 and not supprime order by modifie desc",
      [id],
    );
    const suppressions = await db.query(
      "select id, modifie from projets where compte = $1 and supprime order by modifie desc",
      [id],
    );
    // Un numéro reste après la suppression de son escalier.
    const numerosDevis = await db.query(
      "select projet, annee, rang, cree from devis_numeros where compte = $1 order by annee, rang",
      [id],
    );
    c.header("Content-Disposition", 'attachment; filename="quart-de-tour-donnees.json"');
    return c.json({
      format: "quart-de-tour-donnees",
      compte,
      passkeys,
      sessions,
      atelier: await atelierOf(id),
      projets: projets.map((p) => p.donnees),
      suppressions,
      numerosDevis,
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

  /** Range une version ; renvoie la raison de son refus, ou null. */
  async function rangeProjet(compte: string, raw: unknown): Promise<string | null> {
    const ch = (raw ?? {}) as Record<string, unknown>;
    const id = ch.id;
    if (!isProjectId(id)) return "Cet escalier a un identifiant que le compte ne peut pas garder.";
    // Sans numéro, l'envoi est fusionné dans la ligne ; avec, il la remplace, sauf si elle a un numéro plus haut.
    // Une suppression n'en a pas : elle est un geste voulu, et ne dépend pas des champs connus.
    let recu: Project | null = null;
    let recuBrut: Record<string, unknown> | null = null;
    if (ch.supprime === true) {
      if (!validDate(ch.modifie)) return DATE_REFUSEE;
    } else {
      if (fromNewerVersion(ch.projet)) return SCHEMA_INCONNU;
      recuBrut = ch.projet && typeof ch.projet === "object" ? { ...ch.projet, id } : null;
      recu = recuBrut && sanitizeProject(recuBrut);
      if (!recu) return ILLISIBLE;
      if (!validDate(recu.modifie)) return DATE_REFUSEE;
      recu.nom = sansControles(recu.nom.slice(0, 80));
      if (pese(recu) > MAX_OCTETS) return TROP_LOURD;
    }
    try {
      // Deux envois en même temps : celui qui ne retrouve pas la ligne qu'il a lue n'écrit rien et recommence.
      for (let essai = 0; essai < 5; essai++) {
        const [ligne] = await db.query<{ modifie: number; donnees: Project | null }>(
          "select modifie, donnees from projets where compte = $1 and id = $2",
          [compte, id],
        );
        const schema = recu?.schema ?? 0;
        const passe = !ligne || ligne.modifie < (recu?.modifie ?? (ch.modifie as number));
        // Une ligne de schéma plus haut que ce serveur n'est pas relue : elle y perdrait des champs.
        const lue =
          ligne?.donnees && !fromNewerVersion(ligne.donnees)
            ? { ...ligne.donnees, modifie: ligne.modifie, devis: sanitizeDevis(ligne.donnees.devis) }
            : null;
        const schemaHaut = !!recu && !!schema && schemaOf(ligne?.donnees) > schema;
        if (recu && (!passe || schemaHaut)) {
          // Cette version ne remplace pas la ligne : ce qu'elle a remis la rejoint quand même.
          const reprise = lue && avecRemis(lue, recu.devis);
          if (reprise && reprise !== lue) {
            if (pese(reprise) > MAX_OCTETS) return TROP_LOURD;
            const ecrit = await db.query(
              `update projets set modifie = $3::bigint, donnees = $4::jsonb
               where compte = $1 and id = $2 and modifie = $5::bigint returning id`,
              [compte, id, reprise.modifie, JSON.stringify(reprise), ligne!.modifie],
            );
            if (!ecrit.length) continue;
          }
          return passe ? SCHEMA_PLUS_HAUT : null;
        }
        if (!passe) return null;
        // Elle remplace la ligne : ce que seule la ligne a remis reste.
        const p = recu && avecRemis(recu, lue?.devis ?? null);
        if (p && pese(p) > MAX_OCTETS) return TROP_LOURD;
        const partie = p && !schema ? JSON.stringify(sent(recuBrut!, p)) : null;
        // Le plafond est relu à chaque ligne : deux envois en même temps ne le dépassent que de quelques lignes.
        const rows = await db.query(
          `insert into projets (compte, id, modifie, supprime, donnees)
           select $1::uuid, $2, $3::bigint, $4::boolean, $5::jsonb
           where exists (select 1 from projets where compte = $1::uuid and id = $2)
             or (select count(*) from projets where compte = $1::uuid) < ${MAX_PROJETS}
           on conflict (compte, id) do update
             set modifie = excluded.modifie, supprime = excluded.supprime,
               donnees = case when $6::jsonb is null or projets.donnees is null then excluded.donnees
                 else projets.donnees || $6::jsonb || jsonb_build_object('params',
                   coalesce(projets.donnees->'params', '{}'::jsonb) || coalesce($6::jsonb->'params', '{}'::jsonb)) end
             where projets.modifie is not distinct from $7::bigint
           returning id`,
          [compte, id, p?.modifie ?? ch.modifie, !p, p ? JSON.stringify(p) : null, partie, ligne?.modifie ?? null],
        );
        if (rows.length) return null;
        if (!ligne) {
          // Rien de rangé : le compte est plein, ou un autre envoi vient de créer la ligne.
          const [la] = await db.query("select 1 from projets where compte = $1 and id = $2", [compte, id]);
          if (!la) return COMPTE_PLEIN;
        }
      }
      return OCCUPE;
    } catch (e) {
      if (!isDataError(e)) throw e;
      return ILLISIBLE;
    }
  }

  /**
   * Range les versions reçues, une par une : chacune ne remplace que plus ancienne qu'elle et de schéma pas plus haut,
   * et un refus n'arrête pas les suivantes. Renvoie l'index à jour, avec les refus si l'envoi les demande par `detail`.
   * Un onglet ouvert depuis avant les refus lit encore un tableau.
   */
  app.put("/projets", auth, debit, async (c) => {
    const b = await body(c);
    const list = b.changements;
    if (!Array.isArray(list) || list.length > MAX_BATCH) return err(c, 400, "Envoi mal formé.");
    const compte = c.get("compte");
    const refus: Refus[] = [];
    for (const raw of list as unknown[]) {
      const raison = await rangeProjet(compte, raw);
      if (raison) {
        const id = (raw as { id?: unknown } | null)?.id;
        refus.push({ id: typeof id === "string" ? id : "", raison });
      }
    }
    const idx = await index(compte);
    return c.json(b.detail === true ? { index: idx, refus } : idx);
  });

  /* ---------- Atelier ---------- */

  async function atelierRow(compte: string) {
    const [row] = await db.query<{
      modifie: number;
      donnees: AtelierDefauts;
      tarifs: Tarifs | null;
      entreprise: Entreprise | null;
      dates: AtelierDates | null;
    }>("select modifie, donnees, tarifs, entreprise, dates from ateliers where compte = $1", [compte]);
    return row;
  }

  /** Profil d'une ligne ; celles d'avant les devis reviennent sans tarifs ni fiche de l'entreprise. */
  const atelierFrom = (row: NonNullable<Awaited<ReturnType<typeof atelierRow>>>): Atelier | null =>
    sanitizeAtelier({ ...row, defauts: row.donnees });

  /** Profil du compte. */
  async function atelierOf(compte: string): Promise<Atelier | null> {
    const row = await atelierRow(compte);
    return row ? atelierFrom(row) : null;
  }

  app.get("/atelier", auth, async (c) => c.json(await atelierOf(c.get("compte"))));

  /** Le profil reçu ne remplace que plus ancien que lui, partie par partie ; renvoie le résultat. */
  app.put("/atelier", auth, exige("atelier", ATELIER_REFUSE), debit, async (c) => {
    const raw = (await body(c)).atelier;
    const a = sanitizeAtelier(raw);
    if (!a) return err(c, 400, "Envoi mal formé.");
    if (!validDate((raw as { modifie: unknown }).modifie))
      return err(
        c,
        400,
        "Votre profil de l'atelier n'a pas rejoint votre compte : sa date de modification est impossible.",
      );
    const compte = c.get("compte");
    // Une version d'avant les devis envoie son profil sans tarifs ni fiche : sans date, ils ne remplacent pas ceux du compte.
    for (let essai = 0; essai < 5; essai++) {
      const row = await atelierRow(compte);
      const avant = row ? atelierFrom(row) : null;
      const apres = avant ? mergeAtelier(a, avant) : a;
      if (avant && sameAtelier(avant, apres)) return c.json(avant);
      // Deux envois en même temps : celui qui ne retrouve pas la ligne qu'il a lue n'écrit rien et recommence.
      const ecrit = await db.query(
        `insert into ateliers (compte, modifie, donnees, tarifs, entreprise, dates)
         values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
         on conflict (compte) do update set modifie = excluded.modifie, donnees = excluded.donnees,
           tarifs = excluded.tarifs, entreprise = excluded.entreprise, dates = excluded.dates
           where ateliers.modifie = $7 and ateliers.dates is not distinct from $8::jsonb
         returning compte`,
        [
          compte,
          apres.modifie,
          JSON.stringify(apres.defauts),
          JSON.stringify(apres.tarifs),
          JSON.stringify(apres.entreprise),
          JSON.stringify(apres.dates),
          row?.modifie ?? null,
          row?.dates ? JSON.stringify(row.dates) : null,
        ],
      );
      if (ecrit.length) return c.json(apres);
    }
    return err(c, 503, "Votre profil de l'atelier n'a pas pu être enregistré. Réessayez dans un instant.");
  });

  /* ---------- Devis ---------- */

  /**
   * Numéro du devis d'un escalier, donné à sa première remise au client : le suivant de l'année pour le compte,
   * sans trou. Redemandé (nouvelle version, envoi répété après une coupure), c'est le même, même l'escalier supprimé
   * depuis. Un premier numéro demande que l'escalier soit dans le compte : la page l'y envoie avant de le demander.
   */
  app.post("/devis/numero", auth, exige("devis", DEVIS_REFUSE), debit, async (c) => {
    const projet = (await body(c)).projet;
    if (!isProjectId(projet)) return err(c, 400, "Demande mal formée.");
    const compte = c.get("compte");
    for (let essai = 0; essai < 5; essai++) {
      const [n] = await db.query<{ annee: number; rang: number }>(
        "select annee, rang from devis_numeros where compte = $1 and projet = $2",
        [compte, projet],
      );
      if (n) return c.json({ numero: `${n.annee}-${String(n.rang).padStart(4, "0")}` });
      const [la] = await db.query("select 1 from projets where compte = $1 and id = $2 and not supprime", [
        compte,
        projet,
      ]);
      if (!la) return err(c, 409, PAS_ARRIVE);
      // Deux demandes en même temps pour le même rang : l'une n'insère rien et recommence.
      await db.query(
        `insert into devis_numeros (compte, projet, annee, rang)
         select $1, $2, y, coalesce((select max(rang) from devis_numeros where compte = $1 and annee = y), 0) + 1
         from (select extract(year from now() at time zone 'Europe/Paris')::int as y) a
         on conflict do nothing`,
        [compte, projet],
      );
    }
    return err(c, 503, "Le numéro n'a pas pu être donné. Réessayez dans un instant.");
  });

  app.post("/projets/lire", auth, debit, async (c) => {
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
