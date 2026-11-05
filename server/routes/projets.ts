import type { Entree, Refus } from "../../src/core/account";
import type { Project } from "../../src/core/project";
import type { Db } from "../db";
import { fusionne, ILLISIBLE, lisEnvoi, type Ligne } from "../fusion";
import { body, err, isDataError, type App, type Contexte } from "./contexte";

/* Projets du compte : index, envoi des versions (`PUT /projets`) et lecture. */

/** Projets ou identifiants par requête. */
const MAX_BATCH = 1000;
/** Lignes par compte, traces de suppression comprises. */
const MAX_PROJETS = 2000;

const COMPTE_PLEIN = `Votre compte garde au plus ${MAX_PROJETS} escaliers, supprimés compris : celui-ci n'y entre plus.`;
const OCCUPE = "Il a changé sur un autre appareil au même moment : il repartira au prochain chargement de la page.";

/** Range une version ; renvoie la raison de son refus, ou null. Qui gagne se décide dans `fusionne` (`server/fusion.ts`). */
async function rangeProjet(db: Db, compte: string, raw: unknown): Promise<string | null> {
  const envoi = lisEnvoi(raw);
  if (typeof envoi === "string") return envoi;
  const { id } = envoi;
  try {
    // Deux envois en même temps : celui qui ne retrouve pas la ligne qu'il a lue n'écrit rien et recommence.
    for (let essai = 0; essai < 5; essai++) {
      const [ligne] = await db.query<Ligne>("select modifie, donnees from projets where compte = $1 and id = $2", [
        compte,
        id,
      ]);
      const f = fusionne(ligne, envoi);
      if (f.geste === "repondre") return f.raison;
      if (f.geste === "completer") {
        const ecrit = await db.query(
          `update projets set modifie = $3::bigint, donnees = $4::jsonb
           where compte = $1 and id = $2 and modifie = $5::bigint returning id`,
          [compte, id, f.donnees.modifie, JSON.stringify(f.donnees), ligne!.modifie],
        );
        if (ecrit.length) return f.raison;
        continue;
      }
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
        [
          compte,
          id,
          f.modifie,
          !f.donnees,
          f.donnees ? JSON.stringify(f.donnees) : null,
          f.partie ? JSON.stringify(f.partie) : null,
          ligne?.modifie ?? null,
        ],
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

export function routesProjets(app: App, { db, auth, debit }: Contexte): void {
  const index = (compte: string) =>
    db.query<Entree>("select id, modifie, supprime from projets where compte = $1", [compte]);

  app.get("/projets", auth, async (c) => c.json(await index(c.get("compte"))));

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
      const raison = await rangeProjet(db, compte, raw);
      if (raison) {
        const id = (raw as { id?: unknown } | null)?.id;
        refus.push({ id: typeof id === "string" ? id : "", raison });
      }
    }
    const idx = await index(compte);
    return c.json(b.detail === true ? { index: idx, refus } : idx);
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
}
