import { DATE_REFUSEE } from "../src/core/account";
import { MAX_OCTETS, sanitizeDevis } from "../src/core/devis";
import { avecRemis, fromNewerVersion, isProjectId, sanitizeProject, schemaOf, type Project } from "../src/core/project";
import { sansControles } from "../src/core/texte";

/*
 * Ce que `PUT /projets` décide pour chaque version reçue, sans la base : la relire, puis, la ligne du compte lue, dire
 * qui gagne et ce qui s'écrit. La boucle de `rangeProjet` (`server/routes/projets.ts`) écrit, et relit si la ligne a
 * changé entre-temps.
 */

const HOUR = 3_600_000;
/** Avance tolérée sur l'heure du serveur pour une date de modification : une horloge d'appareil peut se tromper. */
const MAX_AVANCE = 732 * 24 * HOUR;

export const ILLISIBLE = "Cet escalier ne peut pas être relu.";
export const SCHEMA_PLUS_HAUT =
  "Il a été changé sur un autre appareil, avec une version plus récente de l'outil : votre compte garde celle-là.";
export const SCHEMA_INCONNU = "Il vient d'une version de l'outil que votre compte ne connaît pas encore.";
export const TROP_LOURD =
  "Il est trop lourd pour votre compte, avec les versions remises de son devis. Aucune n'est perdue.";
export const ID_REFUSE = "Cet escalier a un identifiant que le compte ne peut pas garder.";

/** Date de modification acceptée, d'un projet, d'une trace de suppression ou du profil de l'atelier. */
export const validDate = (m: unknown): m is number =>
  Number.isInteger(m) && (m as number) >= 0 && (m as number) <= Date.now() + MAX_AVANCE;

export const pese = (p: Project) => Buffer.byteLength(JSON.stringify(p));

/**
 * Ce qu'un envoi sans numéro de schéma contient vraiment : `sanitizeProject` a rempli le reste, qu'une version de
 * l'outil d'avant ce numéro ne connaissait peut-être pas. Un réglage illisible compte comme absent.
 */
export function sent(raw: Record<string, unknown>, p: Project): Partial<Project> {
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(p).filter(([k]) => k in raw && k !== "schema" && k !== "params"),
  );
  if (raw.params && typeof raw.params === "object") {
    const params = raw.params as Record<string, unknown>;
    out.params = Object.fromEntries(Object.entries(p.params).filter(([k, v]) => params[k] === v));
  }
  return out;
}

/** Version reçue, relue : un escalier, avec ce qui a vraiment été envoyé (`brut`), ou la trace de sa suppression. */
export type Envoi =
  | { id: string; supprime: true; modifie: number }
  | { id: string; supprime: false; projet: Project; brut: Record<string, unknown> };

/** Ligne du compte telle que lue en base : `donnees` est nul sur une trace de suppression. */
export interface Ligne {
  modifie: number;
  donnees: Project | null;
}

/** Ce qui s'écrit, la ligne lue. */
export type Fusion =
  /** Rien : la réponse est `raison`, un refus ou null. */
  | { geste: "repondre"; raison: string | null }
  /** La ligne reste, avec ce que la version reçue a remis : `donnees` la remplace si elle n'a pas changé, puis `raison`. */
  | { geste: "completer"; donnees: Project; raison: string | null }
  /**
   * La version reçue remplace la ligne, ou la crée : `donnees` nul pour une suppression. Sans numéro de schéma, seule
   * `partie` est fusionnée dans une ligne qui a des données, réglages à part.
   */
  | { geste: "remplacer"; modifie: number; donnees: Project | null; partie: Partial<Project> | null };

/** Relit une version reçue ; renvoie la raison de son refus si elle ne peut pas être rangée. */
export function lisEnvoi(raw: unknown): Envoi | string {
  const ch = (raw ?? {}) as Record<string, unknown>;
  const id = ch.id;
  if (!isProjectId(id)) return ID_REFUSE;
  // Une suppression n'a pas de numéro : elle est un geste voulu, et ne dépend pas des champs connus.
  if (ch.supprime === true) return validDate(ch.modifie) ? { id, supprime: true, modifie: ch.modifie } : DATE_REFUSEE;
  if (fromNewerVersion(ch.projet)) return SCHEMA_INCONNU;
  const brut = ch.projet && typeof ch.projet === "object" ? { ...ch.projet, id } : null;
  const projet = brut && sanitizeProject(brut);
  if (!projet) return ILLISIBLE;
  if (!validDate(projet.modifie)) return DATE_REFUSEE;
  projet.nom = sansControles(projet.nom.slice(0, 80));
  if (pese(projet) > MAX_OCTETS) return TROP_LOURD;
  return { id, supprime: false, projet, brut };
}

/**
 * Qui gagne entre la ligne et la version reçue. La plus récente, sur `modifie` ; une version plus récente mais de
 * schéma plus bas que la ligne ne la remplace pas, et le refus est nommé. Les versions remises d'un devis échappent à
 * la règle (`avecRemis`) : ce que le perdant a remis rejoint le gagnant. Sans numéro, l'envoi est fusionné dans la
 * ligne ; avec, il la remplace.
 */
export function fusionne(ligne: Ligne | undefined, envoi: Envoi): Fusion {
  if (envoi.supprime) {
    // Plus récente, une suppression passe, quel que soit le schéma de la ligne.
    return !ligne || ligne.modifie < envoi.modifie
      ? { geste: "remplacer", modifie: envoi.modifie, donnees: null, partie: null }
      : { geste: "repondre", raison: null };
  }
  const recu = envoi.projet;
  const passe = !ligne || ligne.modifie < recu.modifie;
  // Une ligne de schéma plus haut que ce serveur n'est pas relue : elle y perdrait des champs.
  const lue =
    ligne?.donnees && !fromNewerVersion(ligne.donnees)
      ? { ...ligne.donnees, modifie: ligne.modifie, devis: sanitizeDevis(ligne.donnees.devis) }
      : null;
  const schemaHaut = !!recu.schema && schemaOf(ligne?.donnees) > recu.schema;
  if (!passe || schemaHaut) {
    // Cette version ne remplace pas la ligne : ce qu'elle a remis la rejoint quand même.
    const raison = passe ? SCHEMA_PLUS_HAUT : null;
    const reprise = lue && avecRemis(lue, recu.devis);
    if (!reprise || reprise === lue) return { geste: "repondre", raison };
    if (pese(reprise) > MAX_OCTETS) return { geste: "repondre", raison: TROP_LOURD };
    return { geste: "completer", donnees: reprise, raison };
  }
  // Elle remplace la ligne : ce que seule la ligne a remis reste.
  const p = avecRemis(recu, lue?.devis ?? null);
  if (pese(p) > MAX_OCTETS) return { geste: "repondre", raison: TROP_LOURD };
  return { geste: "remplacer", modifie: p.modifie, donnees: p, partie: recu.schema ? null : sent(envoi.brut, p) };
}
