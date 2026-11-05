import {
  mergeAtelier,
  sameAtelier,
  sanitizeAtelier,
  type Atelier,
  type AtelierDates,
  type AtelierDefauts,
} from "../../src/core/atelier";
import { isProjectId } from "../../src/core/project";
import type { Entreprise, Tarifs } from "../../src/core/tarifs";
import type { Db } from "../db";
import { validDate } from "../fusion";
import { body, err, type App, type Contexte } from "./contexte";

/* Profil de l'atelier (`/atelier`) et numéros de devis (`/devis/numero`), deux services réservés à un niveau. */

const ATELIER_REFUSE = "Les réglages de l'atelier viennent avec l'abonnement : ils restent gardés sur cet appareil.";
const DEVIS_REFUSE = "Le devis vient avec l'offre « Pour vendre ». Ce qui est déjà écrit reste gardé.";
const PAS_ARRIVE =
  "Cet escalier n'a pas encore rejoint votre compte, qui donne les numéros. Réessayez dans un instant : le brouillon reste enregistré.";

async function atelierRow(db: Db, compte: string) {
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
export async function atelierOf(db: Db, compte: string): Promise<Atelier | null> {
  const row = await atelierRow(db, compte);
  return row ? atelierFrom(row) : null;
}

export function routesAtelier(app: App, { db, auth, exige, debit }: Contexte): void {
  app.get("/atelier", auth, async (c) => c.json(await atelierOf(db, c.get("compte"))));

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
      const row = await atelierRow(db, compte);
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
}
