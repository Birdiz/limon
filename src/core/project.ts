import { DEFAULTS, sanitizeParams, type Params } from "./params";

/** Guidé : réglage étape par étape ; complet : toutes les sections. */
export type Mode = "guide" | "complet";

/** Un escalier enregistré. Dates en millisecondes depuis 1970. */
export interface Project {
  id: string;
  nom: string;
  cree: number;
  modifie: number;
  mode: Mode;
  /** Étape en cours du mode guidé, à partir de 0. */
  etape: number;
  params: Params;
}

export const NOM_PAR_DEFAUT = "Mon escalier";
const FORMAT = "limon-projet";
const VERSION = 1;

export function newProject(id: string, nom: string, mode: Mode, now: number, params: Params = DEFAULTS): Project {
  return { id, nom: nom.trim() || NOM_PAR_DEFAUT, cree: now, modifie: now, mode, etape: 0, params: { ...params } };
}

/** Projet relu (stockage ou fichier, non fiable) ; null s'il n'a pas d'identifiant. */
export function sanitizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const date = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const etape = typeof r.etape === "number" && Number.isFinite(r.etape) ? Math.max(0, Math.round(r.etape)) : 0;
  return {
    id: r.id,
    nom: typeof r.nom === "string" && r.nom.trim() ? r.nom.trim() : NOM_PAR_DEFAUT,
    cree: date(r.cree),
    modifie: date(r.modifie),
    mode: r.mode === "guide" ? "guide" : "complet",
    etape,
    params: sanitizeParams(r.params),
  };
}

/** Contenu d'un fichier .limon. */
export function projectFile(p: Project): string {
  const { nom, cree, modifie, mode, etape, params } = p;
  return JSON.stringify(
    { format: FORMAT, version: VERSION, projet: { nom, cree, modifie, mode, etape, params } },
    null,
    2,
  );
}

/** Relit un fichier .limon ; le projet reçoit l'identifiant donné (un import est toujours un nouveau projet). */
export function parseProjectFile(text: string, id: string): Project | { erreur: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { erreur: "Ce fichier n'est pas un projet Limon." };
  }
  const r = raw as Record<string, unknown> | null;
  if (!r || r.format !== FORMAT || typeof r.projet !== "object")
    return { erreur: "Ce fichier n'est pas un projet Limon." };
  if (typeof r.version !== "number" || r.version > VERSION)
    return { erreur: "Ce projet vient d'une version plus récente de Limon." };
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
