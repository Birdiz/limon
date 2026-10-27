export type Forme = "droit" | "quart-g" | "quart-d";
export type Essence = "chene" | "hetre" | "frene" | "sapin" | "noyer";
/** Remplissage du garde-corps côté jour. */
export type GardeCorps = "aucun" | "balustres" | "lisses";
/** Pose des balustres ou montants : dans le chant haut du limon, ou sur son flanc côté vide. */
export type Pose = "chant" | "anglaise";

/** Réglages saisis par l'utilisateur. Longueurs en millimètres. */
export interface Params {
  forme: Forme;
  /** Hauteur à monter, sol fini à sol fini. */
  H: number;
  /** Reculement (escalier droit). */
  L: number;
  /** Longueur côté départ (quart tournant). */
  A: number;
  /** Longueur côté arrivée (quart tournant). */
  B: number;
  /** Emmarchement, entre limons. */
  W: number;
  fAuto: boolean;
  /** Ligne de foulée, distance depuis le jour. */
  f: number;
  nAuto: boolean;
  /** Nombre de hauteurs. */
  n: number;
  /** Marches balancées. */
  mb: number;
  /** Progressivité du balancement, en %. */
  prog: number;
  ess: Essence;
  /** Épaisseur de marche. */
  et: number;
  /** Débord de nez. */
  deb: number;
  /** Rayon du nez, dessus et dessous ; 0 = vif. */
  rn: number;
  /** Avec contremarches. */
  cm: boolean;
  /** Épaisseur de contremarche. */
  ecm: number;
  /** Épaisseur de limon. */
  el: number;
  /** Hauteur de limon (limon de mur en quart tournant). */
  hl: number;
  hljAuto: boolean;
  /** Hauteur du limon de jour (quart tournant). */
  hlj: number;
  /** Section du poteau (quart tournant), carrée. */
  ps: number;
  gc: GardeCorps;
  gcPose: Pose;
  /** Largeur et hauteur de la main courante. */
  mcL: number;
  mcH: number;
  /** Section des balustres, montants et lisses. */
  bs: number;
  /** Longueur de trémie (droit). */
  tL: number;
  /** Trémie côté arrivée (quart). */
  tX: number;
  /** Trémie côté départ (quart). */
  tY: number;
  /** Épaisseur du plancher. */
  ep: number;
  /** Encastrement des marches et contremarches dans les limons. */
  enc: number;
  /** Jeu d'assemblage par côté, sur les logements. */
  jeu: number;
  /** Longueur des plateaux disponibles, dans le fil. */
  pL: number;
  /** Largeur des plateaux disponibles. */
  pW: number;
}

export const DEFAULTS: Readonly<Params> = {
  forme: "quart-d",
  H: 2700,
  L: 3650,
  A: 2900,
  B: 1800,
  W: 850,
  fAuto: true,
  f: 425,
  nAuto: true,
  n: 15,
  mb: 7,
  prog: 60,
  ess: "chene",
  et: 40,
  deb: 30,
  rn: 10,
  cm: true,
  ecm: 22,
  el: 45,
  hl: 340,
  hljAuto: true,
  hlj: 470,
  ps: 100,
  gc: "aucun",
  gcPose: "chant",
  mcL: 50,
  mcH: 70,
  bs: 30,
  tL: 3200,
  tX: 1850,
  tY: 2550,
  ep: 200,
  enc: 15,
  jeu: 0.5,
  pL: 5000,
  pW: 600,
};

export const FORMES: readonly Forme[] = ["droit", "quart-g", "quart-d"];
export const ESSENCES: readonly Essence[] = ["chene", "hetre", "frene", "sapin", "noyer"];
export const GARDE_CORPS: readonly GardeCorps[] = ["aucun", "balustres", "lisses"];
export const POSES: readonly Pose[] = ["chant", "anglaise"];

/** Masse volumique moyenne à 12 % d'humidité, en kg/m³ (ordre de grandeur pour le poids). */
export const DENSITE: Record<Essence, number> = { chene: 710, hetre: 720, frene: 700, sapin: 450, noyer: 650 };

export const NUMERIC_KEYS = [
  "H",
  "L",
  "A",
  "B",
  "W",
  "f",
  "n",
  "mb",
  "prog",
  "et",
  "deb",
  "rn",
  "ecm",
  "el",
  "hl",
  "hlj",
  "ps",
  "mcL",
  "mcH",
  "bs",
  "tL",
  "tX",
  "tY",
  "ep",
  "enc",
  "jeu",
  "pL",
  "pW",
] as const satisfies readonly (keyof Params)[];
export type NumericKey = (typeof NUMERIC_KEYS)[number];

export const BOOLEAN_KEYS = ["fAuto", "nAuto", "hljAuto", "cm"] as const satisfies readonly (keyof Params)[];

/** Fusionne des réglages enregistrés (non fiables) avec les valeurs par défaut, champ par champ. */
export function sanitizeParams(raw: unknown): Params {
  const p: Params = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return p;
  const r = raw as Record<string, unknown>;
  if (FORMES.includes(r.forme as Forme)) p.forme = r.forme as Forme;
  if (ESSENCES.includes(r.ess as Essence)) p.ess = r.ess as Essence;
  if (GARDE_CORPS.includes(r.gc as GardeCorps)) p.gc = r.gc as GardeCorps;
  if (POSES.includes(r.gcPose as Pose)) p.gcPose = r.gcPose as Pose;
  for (const k of NUMERIC_KEYS) if (typeof r[k] === "number" && Number.isFinite(r[k])) p[k] = r[k];
  for (const k of BOOLEAN_KEYS) if (typeof r[k] === "boolean") p[k] = r[k];
  return p;
}
