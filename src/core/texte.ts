/** Caractères de contrôle (sauf tabulation et retours à la ligne) et moitiés de caractère : Postgres en refuse. */
const INVISIBLES = /\p{Cs}|[^\P{Cc}\t\n\r]/gu;

/** Texte sans ces caractères. */
export const sansControles = (s: string): string => s.replace(INVISIBLES, "");

/** Valeur relue (objets, tableaux, textes) dont tous les textes et toutes les clés sont passés par `sansControles`. */
export function textesPropres<T>(v: T): T {
  if (typeof v === "string") return sansControles(v) as T;
  if (Array.isArray(v)) return v.map(textesPropres) as T;
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [sansControles(k), textesPropres(x)])) as T;
}
