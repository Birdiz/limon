import { timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie } from "hono/cookie";
import { cleanEmail } from "../../src/core/account";
import type { Project } from "../../src/core/project";
import { CODE_TRIES } from "../limites";
import { atelierOf } from "./atelier";
import {
  body,
  CODE_FORME,
  CODE_MAL_FORME,
  CODE_MINUTES,
  codeRecu,
  COOKIE,
  err,
  nouveauCode,
  sha256,
  type App,
  type Contexte,
} from "./contexte";

/* Compte et sessions : adresse e-mail, détail, appareils connectés, export des données, suppression, déconnexion. */

export function routesCompte(app: App, ctx: Contexte): void {
  const { cfg, db, limites, codeHash, compteOf, detail, auth, preuve, refusCode } = ctx;

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
    const code = codeRecu(b.code);
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
      atelier: await atelierOf(db, id),
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
}
