import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Appareil, Compte, CompteDetail, Passkey, Statut } from "../../src/core/account";
import { ABONNEMENT_OUVERT, DROITS, niveauDe, statutReel } from "../../src/core/niveaux";
import { sansControles } from "../../src/core/texte";
import type { Db } from "../db";
import { nouvellesLimites, type Limiter, type Limites } from "../limites";
import type { SendAdresseChangee, SendCode, SendPasskeyAjoutee } from "../mail";
import type { Paiements } from "../stripe";

/* Ce que partagent les routes de /api : configuration, outils, session et middlewares. */

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
  /** Les services du serveur suivent le niveau du compte ; `ABONNEMENT_OUVERT` sinon. */
  limitesActives?: boolean;
}

export type Env = { Variables: { compte: string; session: string; droits: Pick<Compte, "statut" | "droitsJusquA"> } };
/** L'application de /api, sur laquelle chaque domaine déclare ses routes. */
export const nouvelleApp = () => new Hono<Env>().basePath("/api");
export type App = ReturnType<typeof nouvelleApp>;

export const COOKIE = "limon-session";
/** Une session sans usage pendant cette durée se ferme ; un usage, une fois par jour au plus, la prolonge d'autant. */
const SESSION_DAYS = 90;
/** Aucune ne dépasse cette durée après son ouverture, même utilisée chaque jour. */
const SESSION_MAX_DAYS = 365;
export const CODE_MINUTES = 10;
/** Chiffres d'un code envoyé par e-mail. Les champs de code de `app/index.html` (`pattern`, `maxlength`) le suivent. */
const CODE_CHIFFRES = 8;
export const CODE_FORME = new RegExp(`^\\d{${CODE_CHIFFRES}}$`);
export const CODE_MAL_FORME = `Le code a ${CODE_CHIFFRES} chiffres.`;
export const nouveauCode = () =>
  randomInt(0, 10 ** CODE_CHIFFRES)
    .toString()
    .padStart(CODE_CHIFFRES, "0");
/** Une connexion, une passkey ou un code de moins de cette durée permet les gestes qui engagent le compte. */
const PREUVE_MINUTES = 5;

/** Lu par un onglet ouvert depuis avant la preuve, qui ne sait pas la demander : se reconnecter en est une. */
const PREUVE_DEMANDEE = `Par sécurité, ce geste demande une connexion de moins de ${PREUVE_MINUTES} minutes : déconnectez-vous, puis reconnectez-vous.`;
const TROP_DE_CODES = "Trop de codes demandés. Réessayez dans une heure.";
const CODES_EPUISES =
  "Trop de codes sont partis cette heure-ci, pour tout le monde et pas seulement pour vous. Réessayez dans une heure.";

/** La seule clé du plafond commun. */
const TOUS = "tous";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const ms = (d: unknown) => (d ? new Date(d as string).getTime() : null);
/** Ce que la page sait du compte, depuis sa ligne en base. */
export const COMPTE_COLONNES = "id, email, statut, droits_jusqu_a";
export type CompteLigne = { id: string; email: string; statut: Statut; droits_jusqu_a: Date | null };
export const compteDe = (r: CompteLigne): Compte => ({
  id: r.id,
  email: r.email,
  statut: r.statut,
  droitsJusquA: ms(r.droits_jusqu_a),
});
/** Moyens de joindre une passkey, en base séparés par des virgules. */
export const transportsOf = (p: { transports: string }) => (p.transports ? p.transports.split(",") : []);
export const err = (c: Context, status: ContentfulStatusCode, erreur: string) => c.json({ erreur }, status);
/** Erreur de Postgres qui tient à la donnée reçue, pas à la base (classe 22). */
export const isDataError = (e: unknown) => /^22/.test(String((e as { code?: unknown } | null)?.code));
/** Nom donné par la page à l'appareil qu'elle connecte, ou à sa passkey. */
export const nomAppareil = (nom: unknown) =>
  (typeof nom === "string" && sansControles(nom).trim().slice(0, 40)) || "Appareil";
export const body = async (c: Context): Promise<Record<string, unknown>> => {
  const b: unknown = await c.req.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
};
/** Code reçu, sans les espaces qu'on y tape pour le lire. */
export const codeRecu = (code: unknown) => (typeof code === "string" ? code.replace(/\s/g, "") : "");
/** Défi signé par la passkey, lu dans la réponse du navigateur. */
export function challengeOf(r: { response?: { clientDataJSON?: unknown } } | undefined): string | null {
  try {
    const data: unknown = JSON.parse(Buffer.from(String(r?.response?.clientDataJSON), "base64url").toString());
    const ch = (data as { challenge?: unknown }).challenge;
    return typeof ch === "string" ? ch : null;
  } catch {
    return null;
  }
}

/** Le contexte de /api pour une configuration : ce dont les routes de chaque domaine ont besoin. */
export function contexte(cfg: ApiConfig) {
  const { db, origin } = cfg;
  const rpID = new URL(origin).hostname;
  const secure = origin.startsWith("https:");
  // Les codes sont gardés hachés avec ce sel, propre au processus : une copie de la base ne les révèle pas.
  const pepper = randomBytes(32);
  const codeHash = (email: string, code: string) => createHmac("sha256", pepper).update(`${email}:${code}`).digest();
  const limites = cfg.limites ?? nouvellesLimites();
  const ip = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  /** Le compte a servi : son effacement recule, et un avertissement déjà parti ne compte plus. */
  const vu = (compte: string) => db.query("update comptes set vu = now(), averti = null where id = $1", [compte]);

  function setSessionCookie(c: Context, token: string, maxAge: number): void {
    setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/api", maxAge });
  }
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
  const limitesActives = cfg.limitesActives ?? ABONNEMENT_OUVERT;
  const exige = (droit: "atelier" | "devis", refus: string): MiddlewareHandler<Env> =>
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

  /** Le compte tel que le montre Mon compte : passkeys, appareils connectés, abonnement. */
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

  return {
    cfg,
    db,
    origin,
    rpID,
    limites,
    codeHash,
    ip,
    startSession,
    compteOf,
    detail,
    auth,
    exige,
    preuve,
    debit,
    refusCode,
  };
}
export type Contexte = ReturnType<typeof contexte>;
