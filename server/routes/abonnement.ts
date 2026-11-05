import { bodyLimit } from "hono/body-limit";
import { ESSAI_RESTE_MIN, isOffre, isRythme, statutReel } from "../../src/core/niveaux";
import { body, err, type App, type Contexte } from "./contexte";

/* Abonnement : pages de paiement et de gestion de Stripe, et ses nouvelles (`/stripe`). */

const PAIEMENT_FERME = "Le paiement en ligne n'est pas encore ouvert.";
const PAIEMENT_EN_PANNE = "Le paiement ne répond pas pour l'instant : rien n'a été prélevé. Réessayez dans un instant.";

/**
 * Nouvelles de Stripe, avant le contrôle de l'origine : la seule route qui n'en a pas, la signature en tient lieu. Le
 * corps se lit brut, la signature porte sur lui. L'événement et son effet s'écrivent ensemble : rejoué, il ne change
 * rien, et un échec le laisse à redire par Stripe. Les événements n'arrivent pas toujours dans l'ordre : un plus ancien
 * que le dernier pris en compte, ou la fin d'un autre abonnement que celui du compte, n'y touche pas.
 */
export function routeStripe(app: App, { cfg, db }: Contexte): void {
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
}

export function routesAbonnement(app: App, { cfg, db, auth, preuve, debit }: Contexte): void {
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
}
