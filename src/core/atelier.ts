import { DEFAULTS, sanitizeParams, type Params } from "./params";

/**
 * Profil de l'atelier : les réglages qui tiennent à l'habitude de l'artisan, repris par chaque nouvel
 * escalier. Les cotes du chantier (hauteur, reculement, emmarchement, trémie, nombre de marches) n'en
 * font pas partie : elles changent à chaque escalier.
 */
export const ATELIER_KEYS = [
  "ess",
  "et",
  "deb",
  "rn",
  "cm",
  "ecm",
  "el",
  "hl",
  "hljAuto",
  "ps",
  "enc",
  "jeu",
  "pL",
  "pW",
  "gc",
  "gcPose",
  "mcL",
  "mcH",
  "bs",
] as const satisfies readonly (keyof Params)[];

export type AtelierKey = (typeof ATELIER_KEYS)[number];
export type AtelierDefauts = Pick<Params, AtelierKey>;

/** Réglages de l'atelier, avec la date qui départage deux appareils. */
export interface Atelier {
  defauts: AtelierDefauts;
  /** Dernière modification, en millisecondes depuis 1970. */
  modifie: number;
}

/** Les réglages d'atelier d'un escalier. */
export function atelierDefauts(p: Params): AtelierDefauts {
  const { ess, et, deb, rn, cm, ecm, el, hl, hljAuto, ps, enc, jeu, pL, pW, gc, gcPose, mcL, mcH, bs } = p;
  return { ess, et, deb, rn, cm, ecm, el, hl, hljAuto, ps, enc, jeu, pL, pW, gc, gcPose, mcL, mcH, bs };
}

/** Réglages de départ d'un nouvel escalier : ceux de l'atelier, le reste comme l'exemple. */
export function atelierParams(a: Atelier | null): Params {
  return a ? { ...DEFAULTS, ...a.defauts } : { ...DEFAULTS };
}

/** Vrai si le profil ne dit rien de plus que l'exemple. */
export function isDefaultAtelier(d: AtelierDefauts): boolean {
  return ATELIER_KEYS.every((k) => d[k] === DEFAULTS[k]);
}

/** Profil relu (stockage ou serveur, non fiable) ; null s'il n'a pas de date. */
export function sanitizeAtelier(raw: unknown): Atelier | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.modifie !== "number" || !Number.isFinite(r.modifie)) return null;
  return { defauts: atelierDefauts(sanitizeParams(r.defauts)), modifie: Math.round(r.modifie) };
}
