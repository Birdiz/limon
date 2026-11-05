import { DEFAULTS, sanitizeParams, type Params } from "./params";
import {
  ENTREPRISE_VIDE,
  TARIFS_VIDES,
  sanitizeEntreprise,
  sanitizeTarifs,
  type Entreprise,
  type Tarifs,
} from "./tarifs";
import { textesPropres } from "./texte";

/**
 * Profil de l'atelier : les réglages qui tiennent à l'habitude de l'artisan, repris par chaque nouvel
 * escalier, marche palière comprise. Les cotes du chantier (hauteur, reculement, emmarchement, trémie,
 * nombre de marches) n'en font pas partie : elles changent à chaque escalier.
 */
export const ATELIER_KEYS = [
  "ess",
  "et",
  "deb",
  "rn",
  "nez",
  "rai",
  "raiN",
  "raiL",
  "raiP",
  "raiD",
  "raiE",
  "cm",
  "ecm",
  "cmPose",
  "cmEmb",
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
  "mp",
  "mpP",
  "mpE",
] as const satisfies readonly (keyof Params)[];

export type AtelierKey = (typeof ATELIER_KEYS)[number];
export type AtelierDefauts = Pick<Params, AtelierKey>;

/** Les parties du profil, datées chacune : un appareil ne remplace que ce qu'il a changé. */
export const ATELIER_PARTS = ["defauts", "tarifs", "entreprise"] as const;

export type AtelierPart = (typeof ATELIER_PARTS)[number];
/** Dernière modification de chaque partie ; 0 pour une partie jamais remplie sur cet appareil. */
export type AtelierDates = Record<AtelierPart, number>;

/** Réglages de l'atelier, avec les dates qui départagent deux appareils. */
export interface Atelier {
  defauts: AtelierDefauts;
  /** Pour les devis : tarifs et fiche de l'entreprise. */
  tarifs: Tarifs;
  entreprise: Entreprise;
  dates: AtelierDates;
  /** Dernière modification de tout le profil, en millisecondes depuis 1970. Jamais avant celle d'une partie. */
  modifie: number;
}

/** Les réglages d'atelier d'un escalier. */
export function atelierDefauts(p: Params): AtelierDefauts {
  return Object.fromEntries(ATELIER_KEYS.map((k) => [k, p[k]])) as AtelierDefauts;
}

/** Réglages de départ d'un nouvel escalier : ceux de l'atelier, le reste comme l'exemple. */
export function atelierParams(a: Atelier | null): Params {
  return a ? { ...DEFAULTS, ...a.defauts } : { ...DEFAULTS };
}

/** Vrai si le profil ne dit rien de plus que l'exemple. */
export function isDefaultAtelier(d: AtelierDefauts): boolean {
  return ATELIER_KEYS.every((k) => d[k] === DEFAULTS[k]);
}

/** Profil sans tarifs ni fiche de l'entreprise, comme avant les devis. */
export function newAtelier(defauts: AtelierDefauts, modifie: number): Atelier {
  return {
    defauts,
    tarifs: TARIFS_VIDES,
    entreprise: ENTREPRISE_VIDE,
    dates: { defauts: modifie, tarifs: 0, entreprise: 0 },
    modifie,
  };
}

const memeTexte = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Réunit deux profils : pour chaque partie la plus récente, celle de `b` à date égale. */
export function mergeAtelier(a: Atelier, b: Atelier): Atelier {
  const de = (k: AtelierPart) => (a.dates[k] > b.dates[k] ? a : b);
  return {
    defauts: de("defauts").defauts,
    tarifs: de("tarifs").tarifs,
    entreprise: de("entreprise").entreprise,
    dates: {
      defauts: de("defauts").dates.defauts,
      tarifs: de("tarifs").dates.tarifs,
      entreprise: de("entreprise").dates.entreprise,
    },
    modifie: Math.max(a.modifie, b.modifie),
  };
}

/**
 * Profil d'un appareil qui n'a encore jamais échangé avec le compte, réuni avec celui-ci. Sa partie « réglages » n'a
 * qu'une date, posée sur tout dès la première cote gardée : seuls les réglages qui s'écartent de l'exemple sont les
 * choix de l'artisan, les autres ne remplacent pas ceux du compte. Une date plus ancienne ne remplace rien.
 */
export function joinAtelier(mine: Atelier, compte: Atelier): Atelier {
  const merged = mergeAtelier(mine, compte);
  if (mine.dates.defauts <= compte.dates.defauts) return merged;
  const choisis = ATELIER_KEYS.filter((k) => mine.defauts[k] !== DEFAULTS[k]).map((k) => [k, mine.defauts[k]]);
  return { ...merged, defauts: { ...compte.defauts, ...Object.fromEntries(choisis) } };
}

/**
 * Profil daté plus loin que `now` par une horloge en avance, remise à l'heure depuis : ce qui dépasse prend `now`,
 * le reste garde sa date. Sans cela, `stamped` daterait encore chaque version suivante après l'impossible.
 */
export function redatedAtelier(a: Atelier, now: number): Atelier {
  const date = (k: AtelierPart) => Math.min(a.dates[k], now);
  return {
    ...a,
    dates: { defauts: date("defauts"), tarifs: date("tarifs"), entreprise: date("entreprise") },
    modifie: now,
  };
}

/** Vrai si les deux profils disent la même chose, dates comprises, dans quelque ordre que soient leurs clés. */
export function sameAtelier(a: Atelier, b: Atelier): boolean {
  return memeTexte(sanitizeAtelier(a), sanitizeAtelier(b));
}

/**
 * Dates relues, jamais après celle du profil, que le serveur borne. Un profil d'avant ces dates (ou écrit par une
 * version qui les ignore) donne sa date à ce qu'il a de rempli. Ce qu'il a de vide n'a pas de date : il ne dit rien
 * de cette partie, et ne vide pas celle du compte.
 */
function sanitizeDates(raw: unknown, a: Omit<Atelier, "dates">): AtelierDates {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const date = (k: AtelierPart, vide: boolean) => {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.min(Math.max(Math.round(v), 0), a.modifie);
    return vide ? 0 : a.modifie;
  };
  return {
    defauts: date("defauts", isDefaultAtelier(a.defauts)),
    tarifs: date("tarifs", memeTexte(a.tarifs, TARIFS_VIDES)),
    entreprise: date("entreprise", memeTexte(a.entreprise, ENTREPRISE_VIDE)),
  };
}

/** Profil relu (stockage ou serveur, non fiable) ; null s'il n'a pas de date. Un profil d'avant les devis
    revient sans tarifs ni fiche de l'entreprise. */
export function sanitizeAtelier(raw: unknown): Atelier | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.modifie !== "number" || !Number.isFinite(r.modifie)) return null;
  const a = {
    defauts: atelierDefauts(sanitizeParams(r.defauts)),
    tarifs: textesPropres(sanitizeTarifs(r.tarifs)),
    entreprise: textesPropres(sanitizeEntreprise(r.entreprise)),
    modifie: Math.round(r.modifie),
  };
  return { ...a, dates: sanitizeDates(r.dates, a) };
}
