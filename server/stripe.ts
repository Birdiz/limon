import { createHmac, timingSafeEqual } from "node:crypto";
import { isOffre, isRythme, type Offre, type Rythme } from "../src/core/niveaux";

/* Stripe, par son API : le paiement et la gestion de l'abonnement se font sur ses pages, le site ne voit aucune carte.
   Les prix se créent avec `scripts/stripe-prix.ts`, qui donne les valeurs à régler. */

const API = "https://api.stripe.com/v1";
/** Écart accepté avec la date d'un événement signé : un événement copié ne se rejoue pas plus tard. */
const TOLERANCE_S = 300;
/** États d'un abonnement qui donnent ses droits. `past_due` : Stripe réessaie encore la carte. */
const ACTIFS = new Set(["active", "trialing", "past_due"]);
/** États sans droits. `incomplete` n'y est pas : un paiement en cours ne change rien au compte. */
const FINIS = new Set(["canceled", "unpaid", "incomplete_expired", "paused"]);

/** Ce qu'un événement dit de l'abonnement d'un compte. */
export interface EtatAbonnement {
  client: string;
  abonnement: string;
  statut: "abonne" | "premium" | "expire";
  /** Fin de la période payée, en millisecondes ; null une fois fini. */
  droitsJusquA: number | null;
  resilie: boolean;
  /** Date de l'événement, en secondes : Stripe ne garantit pas l'ordre d'arrivée. */
  date: number;
}

export interface Evenement {
  id: string;
  /** Null pour un événement qui ne touche pas à un abonnement. */
  etat: EtatAbonnement | null;
}

export interface Paiements {
  /** L'événement reçu, ou null si sa signature est fausse. */
  evenement(corps: string, signature: string | undefined): Evenement | null;
  creerClient(compte: string, email: string): Promise<string>;
  /** Adresse de la page de paiement. `finEssai` : le premier prélèvement attend cette date. */
  ouvrirPaiement(client: string, offre: Offre, rythme: Rythme, finEssai: number | null): Promise<string>;
  /** Adresse de la page qui gère factures, carte, changement d'offre et arrêt. */
  ouvrirGestion(client: string): Promise<string>;
  changerAdresse(client: string, email: string): Promise<void>;
  /** Efface le client : l'abonnement s'arrête aussitôt, les factures restent chez Stripe. */
  effacerClient(client: string): Promise<void>;
}

/** Vrai si l'en-tête `Stripe-Signature` signe ce corps avec ce secret, depuis moins de 5 minutes. */
export function signatureValable(corps: string, entete: string | undefined, secret: string, now = Date.now()): boolean {
  if (!entete) return false;
  const parts = entete.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  if (!t || !/^\d+$/.test(t) || Math.abs(now / 1000 - Number(t)) > TOLERANCE_S) return false;
  const attendue = createHmac("sha256", secret).update(`${t}.${corps}`).digest();
  return parts.some(([k, v]) => {
    if (k !== "v1") return false;
    const recue = Buffer.from(v ?? "", "hex");
    return recue.length === attendue.length && timingSafeEqual(recue, attendue);
  });
}

interface StripeAbonnement {
  id: string;
  status: string;
  customer: string | { id: string };
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  /** Ici dans les anciennes versions de l'API, sur la ligne de l'abonnement dans les nouvelles. */
  current_period_end?: number;
  items?: { data?: { current_period_end?: number; price?: { id?: string } }[] };
}

/** État d'un abonnement d'après un événement, avec `prix` : offre de chaque prix, par identifiant Stripe. */
export function etatDe(
  ev: { type?: string; created?: number; data?: { object?: unknown } },
  prix: Record<string, Offre>,
): EtatAbonnement | null {
  if (!ev.type?.startsWith("customer.subscription.")) return null;
  const a = ev.data?.object as StripeAbonnement | undefined;
  if (!a?.id || !a.customer) return null;
  const client = typeof a.customer === "string" ? a.customer : a.customer.id;
  const commun = { client, abonnement: a.id, date: ev.created ?? 0 };
  if (FINIS.has(a.status) || ev.type === "customer.subscription.deleted")
    return { ...commun, statut: "expire", droitsJusquA: null, resilie: false };
  if (!ACTIFS.has(a.status)) return null;
  const ligne = a.items?.data?.[0];
  const offre = prix[ligne?.price?.id ?? ""];
  const fin = ligne?.current_period_end ?? a.current_period_end;
  if (!offre || !fin) {
    console.error(`[stripe] abonnement ${a.id} : prix inconnu ou période absente`);
    return null;
  }
  return {
    ...commun,
    statut: offre === "premium" ? "premium" : "abonne",
    droitsJusquA: fin * 1000,
    resilie: !!a.cancel_at_period_end || !!a.cancel_at,
  };
}

export interface StripeConfig {
  cle: string;
  /** Secret de signature des événements. */
  secret: string;
  /** Identifiant Stripe de chaque prix, par « offre-rythme ». */
  prix: Partial<Record<`${Offre}-${Rythme}`, string>>;
  /** Configuration de la page de gestion ; sinon celle par défaut du compte Stripe. */
  portail?: string;
  /** Adresse du site, pour le retour depuis les pages de Stripe. */
  origin: string;
}

/** Client de l'API de Stripe. `f` se remplace dans les tests. */
export function stripe(cfg: StripeConfig, f: typeof fetch = (...a) => fetch(...a), delai = 10_000): Paiements {
  const offres: Record<string, Offre> = {};
  for (const [k, id] of Object.entries(cfg.prix)) offres[id] = k.split("-")[0] as Offre;

  async function appel<T>(methode: string, chemin: string, champs: Record<string, string> = {}, cle?: string) {
    const res = await f(`${API}/${chemin}`, {
      method: methode,
      headers: {
        authorization: `Bearer ${cfg.cle}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(cle ? { "idempotency-key": cle } : {}),
      },
      ...(methode === "POST" ? { body: new URLSearchParams(champs).toString() } : {}),
      signal: AbortSignal.timeout(delai),
    });
    const r = (await res.json().catch(() => null)) as { error?: { code?: string; type?: string } } | null;
    if (!res.ok)
      throw new StripeRefus(res.status, r?.error?.code ?? r?.error?.type ?? "inconnu", chemin.split("/")[0]!);
    return r as T;
  }

  return {
    evenement(corps, signature) {
      if (!signatureValable(corps, signature, cfg.secret)) return null;
      const ev = JSON.parse(corps) as Parameters<typeof etatDe>[0] & { id: string };
      return { id: ev.id, etat: etatDe(ev, offres) };
    },
    async creerClient(compte, email) {
      // Deux demandes en même temps ne créent qu'un client.
      const r = await appel<{ id: string }>(
        "POST",
        "customers",
        { email, "metadata[compte]": compte },
        `client-${compte}`,
      );
      return r.id;
    },
    async ouvrirPaiement(client, offre, rythme, finEssai) {
      const prix = cfg.prix[`${offre}-${rythme}`];
      if (!prix) throw new Error(`[stripe] prix non réglé : ${offre}-${rythme}`);
      const r = await appel<{ url: string }>("POST", "checkout/sessions", {
        mode: "subscription",
        customer: client,
        "line_items[0][price]": prix,
        "line_items[0][quantity]": "1",
        locale: "fr",
        billing_address_collection: "required",
        "customer_update[address]": "auto",
        "customer_update[name]": "auto",
        "tax_id_collection[enabled]": "true",
        success_url: `${cfg.origin}/app/?compte=paye`,
        cancel_url: `${cfg.origin}/app/?compte`,
        ...(finEssai ? { "subscription_data[trial_end]": String(Math.floor(finEssai / 1000)) } : {}),
      });
      return r.url;
    },
    async ouvrirGestion(client) {
      const r = await appel<{ url: string }>("POST", "billing_portal/sessions", {
        customer: client,
        return_url: `${cfg.origin}/app/?compte`,
        ...(cfg.portail ? { configuration: cfg.portail } : {}),
      });
      return r.url;
    },
    async changerAdresse(client, email) {
      await appel("POST", `customers/${encodeURIComponent(client)}`, { email });
    },
    async effacerClient(client) {
      try {
        await appel("DELETE", `customers/${encodeURIComponent(client)}`);
      } catch (e) {
        // Déjà effacé chez Stripe : il n'y a plus rien à arrêter.
        if (!(e instanceof StripeRefus && e.status === 404)) throw e;
      }
    },
  };
}

/** Refus de Stripe, sans rien de la personne pour le journal. */
export class StripeRefus extends Error {
  constructor(
    readonly status: number,
    code: string,
    objet: string,
  ) {
    super(`[stripe] ${objet} : ${status} ${code}`);
  }
}

/** « payant-mois:price_x,payant-an:price_y,… » : les quatre prix, ou null si l'un manque ou se lit mal. */
export function lirePrix(brut: string | undefined): StripeConfig["prix"] | null {
  const prix: StripeConfig["prix"] = {};
  for (const part of (brut ?? "").split(",")) {
    const [cle, id] = part.split(":").map((s) => s.trim());
    const [offre, rythme] = (cle ?? "").split("-");
    if (!id || !isOffre(offre) || !isRythme(rythme)) return null;
    prix[`${offre}-${rythme}`] = id;
  }
  return Object.keys(prix).length === 4 ? prix : null;
}

/** Stripe d'après les variables d'environnement ; rien tant qu'il en manque : le paiement reste fermé, sans panne. */
export function stripeDepuis(env: NodeJS.ProcessEnv, origin: string): Paiements | undefined {
  const cle = env.STRIPE_SECRET_KEY;
  const secret = env.STRIPE_WEBHOOK_SECRET;
  const prix = lirePrix(env.STRIPE_PRIX);
  if (!cle && !secret && !env.STRIPE_PRIX) return undefined;
  if (!cle || !secret || !prix) {
    console.error("[stripe] STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET ou STRIPE_PRIX manque : paiement fermé.");
    return undefined;
  }
  return stripe({ cle, secret, prix, origin, ...(env.STRIPE_PORTAIL ? { portail: env.STRIPE_PORTAIL } : {}) });
}
