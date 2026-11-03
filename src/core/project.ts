import { sanitizeDevis, type DevisProjet } from "./devis";
import { DEFAULTS, sanitizeParams, type Params } from "./params";
import type { ComputeResult } from "./stair";
import { sansControles, textesPropres } from "./texte";

/** Guidé : réglage étape par étape ; complet : toutes les sections. */
export type Mode = "guide" | "complet";

/** Brouillon tant que l'artisan ne l'a pas dit fini ; la fiche d'un brouillon le porte en filigrane. */
export type Etat = "brouillon" | "fini";

/** Un escalier enregistré. Dates en millisecondes depuis 1970. */
export interface Project {
  id: string;
  /** Version du contenu : voir `SCHEMA`. 0 pour une copie d'avant ce numéro. */
  schema: number;
  nom: string;
  cree: number;
  modifie: number;
  mode: Mode;
  /** Étape en cours du mode guidé, à partir de 0. */
  etape: number;
  etat: Etat;
  /** Date du passage à « fini », 0 en brouillon. */
  finiLe: number;
  params: Params;
  /** Devis de l'escalier, null tant qu'il n'y en a pas. */
  devis: DevisProjet | null;
}

export const NOM_PAR_DEFAUT = "Mon escalier";
const FORMAT = "limon-projet";
const VERSION = 1;
/**
 * Numéro du contenu d'un projet, à monter à chaque champ ou valeur d'énumération ajoutés. Les mises à jour étant
 * silencieuses, deux versions de l'outil coexistent : celle qui relit un projet oublie ce qu'elle ne connaît pas, et ce
 * numéro l'empêche de le faire disparaître du compte.
 */
export const SCHEMA = 1;

/** Numéro d'un projet non fiable ; 0 s'il n'en a pas, ou pas un vrai. */
function schemaOf(raw: unknown): number {
  const s = (raw as { schema?: unknown } | null)?.schema;
  return typeof s === "number" && Number.isSafeInteger(s) && s > 0 ? s : 0;
}

/** Projet écrit par une version de l'outil plus récente que celle-ci : le relire lui ferait perdre des champs. */
export function fromNewerVersion(raw: unknown): boolean {
  return schemaOf(raw) > SCHEMA;
}

export function newProject(id: string, nom: string, mode: Mode, now: number, params: Params = DEFAULTS): Project {
  const base = { id, schema: SCHEMA, nom: nom.trim() || NOM_PAR_DEFAUT, cree: now, modifie: now, mode, etape: 0 };
  return { ...base, etat: "brouillon", finiLe: 0, params: { ...params }, devis: null };
}

/** Le format de `newId` : un identifiant venu d'ailleurs finit dans des attributs HTML et en base. */
export function isProjectId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id);
}

/**
 * Projet relu (stockage ou fichier, non fiable) ; null si son identifiant manque ou sort du format.
 * Il garde son numéro : le relire ne lui rend pas ce qu'une ancienne version a perdu, seule une modification le monte.
 */
export function sanitizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isProjectId(r.id)) return null;
  const date = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const etape = typeof r.etape === "number" && Number.isFinite(r.etape) ? Math.max(0, Math.round(r.etape)) : 0;
  // Les escaliers d'avant l'état sont des brouillons.
  const fini = r.etat === "fini";
  const nom = typeof r.nom === "string" ? sansControles(r.nom).trim() : "";
  return {
    id: r.id,
    schema: Math.min(schemaOf(r), SCHEMA),
    nom: nom || NOM_PAR_DEFAUT,
    cree: date(r.cree),
    modifie: date(r.modifie),
    mode: r.mode === "guide" ? "guide" : "complet",
    etape,
    etat: fini ? "fini" : "brouillon",
    finiLe: fini ? date(r.finiLe) : 0,
    params: sanitizeParams(r.params),
    devis: textesPropres(sanitizeDevis(r.devis)),
  };
}

/** Contenu d'un fichier .escalier (format nommé avant le renommage, gardé pour relire les fichiers .limon). */
export function projectFile(p: Project): string {
  const { nom, cree, modifie, mode, etape, etat, finiLe, params, devis } = p;
  return JSON.stringify(
    { format: FORMAT, version: VERSION, projet: { nom, cree, modifie, mode, etape, etat, finiLe, params, devis } },
    null,
    2,
  );
}

const PAS_UN_PROJET = "Ce fichier n'est pas un projet Quart de tour.";
const ABIME = "Ce fichier est abîmé : les cotes de l'escalier ne s'y lisent pas.";

const isObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Relit un fichier .escalier ou .limon ; le projet reçoit l'identifiant donné (un import est toujours un nouveau projet).
    `ignores` : les clés du fichier que `sanitizeParams` n'a pas reprises, remplacées par l'exemple. Une clé absente
    n'y figure pas : les fichiers d'avant un réglage ne l'ont pas. Sans aucune cote reprise, le fichier est refusé. */
export function parseProjectFile(
  text: string,
  id: string,
): { projet: Project; ignores: string[] } | { erreur: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { erreur: PAS_UN_PROJET };
  }
  const r = raw as Record<string, unknown> | null;
  if (!r || r.format !== FORMAT) return { erreur: PAS_UN_PROJET };
  if (!Number.isInteger(r.version) || (r.version as number) < 1) return { erreur: ABIME };
  if ((r.version as number) > VERSION)
    return { erreur: "Ce projet vient d'une version plus récente de Quart de tour." };
  if (!isObjet(r.projet) || !isObjet(r.projet.params)) return { erreur: ABIME };
  const lus = r.projet.params;
  // Un import est un nouveau projet, sans version en ligne à abîmer.
  const p = sanitizeProject({ ...r.projet, id, schema: SCHEMA })!;
  const ignores = Object.keys(lus).filter((k) => p.params[k as keyof Params] !== lus[k]);
  if (ignores.length === Object.keys(lus).length) return { erreur: ABIME };
  // Une cote remplacée : la fiche ne peut plus passer pour celle qui a été validée.
  return { projet: ignores.length ? { ...p, etat: "brouillon", finiLe: 0 } : p, ignores };
}

/** Nom de fichier sans caractères interdits sous Windows ou macOS. */
export function fileBase(nom: string): string {
  const s = nom
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return s || "escalier";
}

/** Date d'une modification (escalier ou profil de l'atelier) : toujours après la version qu'elle remplace, même
    reçue d'un appareil à l'horloge en avance. Sinon l'échange avec le compte reprendrait l'ancienne version.
    Entière : le serveur refuse une date à virgule, venue d'un fichier. */
export function stamped(remplacee: { modifie: number }, now: number): number {
  return Math.max(now, Math.floor(remplacee.modifie) + 1);
}

/** Ce que change toute modification d'un escalier : sa date, et son numéro, celui de la version qui l'a écrit. */
export function touched(p: Project, now: number): Pick<Project, "modifie" | "schema"> {
  return { modifie: stamped(p, now), schema: SCHEMA };
}

/** Escalier avec son devis changé ; la date de modification avance, pour l'échange avec le compte. */
export function withDevis(p: Project, devis: DevisProjet | null, now: number): Project {
  return { ...p, devis, ...touched(p, now) };
}

/** Escalier passé à l'état donné ; la date de modification avance, pour l'échange avec le compte. */
export function withEtat(p: Project, etat: Etat, now: number): Project {
  return { ...p, etat, finiLe: etat === "fini" ? now : 0, ...touched(p, now) };
}

/** Escalier avec ces réglages ; le même objet s'ils n'ont pas changé. Un escalier terminé qu'on modifie redevient
    un brouillon : sa fiche n'est plus celle qui a été validée. */
export function edited(p: Project, params: Params, now: number): Project {
  if (JSON.stringify(params) === JSON.stringify(p.params)) return p;
  return { ...(p.etat === "fini" ? withEtat(p, "brouillon", now) : p), params, ...touched(p, now) };
}

/** Passage à « fini » : impossible tant que le calcul échoue, à confirmer si un contrôle n'est pas respecté. */
export function canFinish(result: ComputeResult | null): "oui" | "confirmer" | "non" {
  if (!result?.ok) return "non";
  return result.stair.notes.some(([st]) => st === "bad") ? "confirmer" : "oui";
}
