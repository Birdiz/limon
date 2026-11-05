/* Lien de projet : les réglages qui diffèrent de l'exemple, en paramètres d'URL (après le #). */
import { BOOLEAN_KEYS, DEFAULTS, NUMERIC_KEYS, TEXT_KEYS, sanitizeParams, type Params } from "./params";

const KEYS = [...TEXT_KEYS, ...NUMERIC_KEYS, ...BOOLEAN_KEYS] as const;

/** Valeurs recalculées quand leur case « automatique » est cochée : inutiles dans le lien. */
const autoKey = (p: Params, k: (typeof KEYS)[number]) =>
  (k === "n" && p.nAuto) || (k === "f" && p.fAuto) || (k === "hlj" && p.hljAuto);

export function paramsToHash(p: Params): string {
  const q = new URLSearchParams();
  for (const k of KEYS) if (p[k] !== DEFAULTS[k] && !autoKey(p, k)) q.set(k, String(p[k]));
  return q.toString();
}

/** Mêmes réglages une fois écrits dans un lien : les valeurs recalculées n'y comptent pas. */
export const sameLink = (a: Params, b: Params): boolean => paramsToHash(a) === paramsToHash(b);

/** Un lien devient un nouvel escalier, sauf s'il redonne les réglages de l'escalier ouvert (l'adresse les suit). */
export const linkOpensNew = (link: Params, open: Params | null): boolean => !open || !sameLink(link, open);

/** Réglages lus dans un lien ; null si le lien n'en porte aucun. Les valeurs passent par sanitizeParams. */
export function paramsFromHash(hash: string): Params | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const raw: Record<string, unknown> = {};
  q.forEach((v, k) => {
    raw[k] = (TEXT_KEYS as readonly string[]).includes(k) ? v : v === "true" ? true : v === "false" ? false : Number(v);
  });
  return Object.keys(raw).some((k) => (KEYS as readonly string[]).includes(k)) ? sanitizeParams(raw) : null;
}

/** Adresse qui rouvre ces réglages dans l'outil en ligne (code QR de la fiche) ; la forme y est toujours. */
export function projectUrl(p: Params): string {
  return `https://quart-de-tour.fr/app/#${paramsToHash(p) || `forme=${p.forme}`}`;
}
