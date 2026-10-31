import { sanitizeDevis, type DevisProjet } from "./devis";
import { DEFAULTS, sanitizeParams, type Params } from "./params";

/** Guidé : réglage étape par étape ; complet : toutes les sections. */
export type Mode = "guide" | "complet";

/** Brouillon tant que l'artisan ne l'a pas dit fini ; la fiche d'un brouillon le porte en filigrane. */
export type Etat = "brouillon" | "fini";

/** Un escalier enregistré. Dates en millisecondes depuis 1970. */
export interface Project {
  id: string;
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

export function newProject(id: string, nom: string, mode: Mode, now: number, params: Params = DEFAULTS): Project {
  const base = { id, nom: nom.trim() || NOM_PAR_DEFAUT, cree: now, modifie: now, mode, etape: 0 };
  return { ...base, etat: "brouillon", finiLe: 0, params: { ...params }, devis: null };
}

/** Projet relu (stockage ou fichier, non fiable) ; null s'il n'a pas d'identifiant. */
export function sanitizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const date = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const etape = typeof r.etape === "number" && Number.isFinite(r.etape) ? Math.max(0, Math.round(r.etape)) : 0;
  // Les escaliers d'avant l'état sont des brouillons.
  const fini = r.etat === "fini";
  return {
    id: r.id,
    nom: typeof r.nom === "string" && r.nom.trim() ? r.nom.trim() : NOM_PAR_DEFAUT,
    cree: date(r.cree),
    modifie: date(r.modifie),
    mode: r.mode === "guide" ? "guide" : "complet",
    etape,
    etat: fini ? "fini" : "brouillon",
    finiLe: fini ? date(r.finiLe) : 0,
    params: sanitizeParams(r.params),
    devis: sanitizeDevis(r.devis),
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

/** Relit un fichier .escalier ou .limon ; le projet reçoit l'identifiant donné (un import est toujours un nouveau projet). */
export function parseProjectFile(text: string, id: string): Project | { erreur: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { erreur: "Ce fichier n'est pas un projet Quart de tour." };
  }
  const r = raw as Record<string, unknown> | null;
  if (!r || r.format !== FORMAT || typeof r.projet !== "object")
    return { erreur: "Ce fichier n'est pas un projet Quart de tour." };
  if (typeof r.version !== "number" || r.version > VERSION)
    return { erreur: "Ce projet vient d'une version plus récente de Quart de tour." };
  return sanitizeProject({ ...(r.projet as object), id })!;
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

/** Escalier avec son devis changé ; la date de modification avance, pour l'échange avec le compte. */
export function withDevis(p: Project, devis: DevisProjet | null, now: number): Project {
  return { ...p, devis, modifie: now };
}

/** Escalier passé à l'état donné ; la date de modification avance, pour l'échange avec le compte. */
export function withEtat(p: Project, etat: Etat, now: number): Project {
  return { ...p, etat, finiLe: etat === "fini" ? now : 0, modifie: now };
}
