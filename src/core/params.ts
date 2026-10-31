export type Forme = "droit" | "quart-g" | "quart-d" | "dq-g" | "dq-d" | "demi-g" | "demi-d";
export type Essence = "chene" | "hetre" | "frene" | "sapin" | "noyer";
/** Remplissage du garde-corps côté jour. */
export type GardeCorps = "aucun" | "balustres" | "lisses";
/** Pose des balustres ou montants : dans le chant haut du limon, ou sur son flanc côté vide. */
export type Pose = "chant" | "anglaise";
/** Contour de la trémie : rectangle, ou en L qui suit le quart tournant. */
export type FormeTremie = "rect" | "L";
/** Passage des tournants : marches balancées, ou palier (le même pour tous les tournants). */
export type Tournant = "balance" | "palier";

/** Réglages saisis par l'utilisateur. Longueurs en millimètres. */
export interface Params {
  forme: Forme;
  /** Hauteur à monter, sol fini à sol fini. */
  H: number;
  /** Reculement (escalier droit). */
  L: number;
  /** Longueur côté départ (quart tournant). */
  A: number;
  /** Longueur côté arrivée (quart tournant, double quart, demi-tournant). */
  B: number;
  /** Longueur côté fond, entre les deux tournants (double quart). */
  C: number;
  /** Jour du demi-tournant, entre les faces côté marches des limons de jour : le côté fond vaut 2 W + J. */
  J: number;
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
  tournant: Tournant;
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
  /** Trémie à calculer : la plus petite qui donne l'échappée visée. */
  tAuto: boolean;
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
  /** Trémie côté arrivée (quart), côté fond en travers (double quart). */
  tX: number;
  /** Trémie côté départ (quart), côté arrivée (double quart). */
  tY: number;
  /** Contour de la trémie (le L ne sert qu'en quart tournant). */
  tForme: FormeTremie;
  /** Trémie en L : largeur de la branche côté départ, depuis le mur du départ. */
  tbD: number;
  /** Trémie en L : largeur de la branche côté arrivée, depuis le mur face à la montée. */
  tbA: number;
  /** Marche palière : dans le prolongement du plancher d'arrivée, logée dans les limons. */
  mp: boolean;
  /** Profondeur de la marche palière, depuis le nez. */
  mpP: number;
  /** Épaisseur de la marche palière. */
  mpE: number;
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
  C: 2400,
  J: 200,
  W: 850,
  fAuto: true,
  f: 425,
  nAuto: true,
  n: 15,
  mb: 7,
  prog: 60,
  tournant: "balance",
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
  tAuto: false,
  ps: 100,
  gc: "aucun",
  gcPose: "chant",
  mcL: 50,
  mcH: 70,
  bs: 30,
  tL: 3200,
  tX: 1845,
  tY: 2550,
  tForme: "rect",
  tbD: 950,
  tbA: 950,
  mp: false,
  mpP: 300,
  mpE: 40,
  ep: 200,
  enc: 15,
  jeu: 0.5,
  pL: 5000,
  pW: 600,
};

export const FORMES: readonly Forme[] = ["droit", "quart-g", "quart-d", "dq-g", "dq-d", "demi-g", "demi-d"];
/** Nombre de tournants de chaque forme, tous du même sens. */
export const TOURS: Record<Forme, number> = {
  droit: 0,
  "quart-g": 1,
  "quart-d": 1,
  "dq-g": 2,
  "dq-d": 2,
  "demi-g": 2,
  "demi-d": 2,
};
/** Demi-tournant : la forme en U saisie par son jour, avec un seul poteau quand le jour est étroit. */
export const isDemi = (f: Forme): boolean => f.startsWith("demi-");
/** Jour au-dessous duquel le demi-tournant n'a qu'un poteau, de la largeur du jour : deux poteaux
    y laisseraient moins de 100 mm de limon de jour entre eux. */
export const jourUnPoteau = (p: Pick<Params, "ps">): number => 2 * p.ps + 100;
/** Forme qui tourne à gauche : calculée à droite, puis vue en miroir. */
export const isLeft = (f: Forme): boolean => f.endsWith("-g");
/** Cotes de l'exemple pour une forme en U, reprises en passant d'une autre forme au double quart :
    celles du quart tournant donneraient une ligne de foulée bien trop longue. */
export const EXEMPLE_U: Readonly<Pick<Params, "A" | "B" | "C" | "tX" | "tY">> = {
  A: 2000,
  B: 1900,
  C: 2400,
  tX: 2500,
  tY: 1950,
};

/** Cotes de l'exemple du demi-tournant : deux volées côte à côte autour d'un jour étroit. */
export const EXEMPLE_DEMI: Readonly<Pick<Params, "A" | "B" | "J" | "tX" | "tY">> = {
  A: 2600,
  B: 2600,
  J: 200,
  tX: 1990,
  tY: 2650,
};

/** Réglages après un changement de forme : en entrant dans une forme en U, ses cotes d'exemple.
    Du double quart au demi-tournant et retour, le même escalier : le jour suit le côté fond. */
export function changeForme(prev: Params, next: Params): Params {
  if (TOURS[next.forme] !== 2) return next;
  if (TOURS[prev.forme] !== 2) return { ...next, ...(isDemi(next.forme) ? EXEMPLE_DEMI : EXEMPLE_U) };
  if (isDemi(next.forme) === isDemi(prev.forme)) return next;
  return isDemi(next.forme)
    ? { ...next, J: next.C - 2 * next.W }
    : { ...next, C: 2 * next.W + Math.max(next.J, jourUnPoteau(next)) };
}
export const ESSENCES: readonly Essence[] = ["chene", "hetre", "frene", "sapin", "noyer"];
export const GARDE_CORPS: readonly GardeCorps[] = ["aucun", "balustres", "lisses"];
export const POSES: readonly Pose[] = ["chant", "anglaise"];
export const FORMES_TREMIE: readonly FormeTremie[] = ["rect", "L"];
export const TOURNANTS: readonly Tournant[] = ["balance", "palier"];

/** Masse volumique moyenne à 12 % d'humidité, en kg/m³ (ordre de grandeur pour le poids). */
export const DENSITE: Record<Essence, number> = { chene: 710, hetre: 720, frene: 700, sapin: 450, noyer: 650 };

export const NUMERIC_KEYS = [
  "H",
  "L",
  "A",
  "B",
  "C",
  "J",
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
  "tbD",
  "tbA",
  "mpP",
  "mpE",
  "ep",
  "enc",
  "jeu",
  "pL",
  "pW",
] as const satisfies readonly (keyof Params)[];
export type NumericKey = (typeof NUMERIC_KEYS)[number];

export const BOOLEAN_KEYS = [
  "fAuto",
  "nAuto",
  "hljAuto",
  "cm",
  "tAuto",
  "mp",
] as const satisfies readonly (keyof Params)[];

/** Fusionne des réglages enregistrés (non fiables) avec les valeurs par défaut, champ par champ. */
export function sanitizeParams(raw: unknown): Params {
  const p: Params = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return p;
  const r = raw as Record<string, unknown>;
  if (FORMES.includes(r.forme as Forme)) p.forme = r.forme as Forme;
  if (ESSENCES.includes(r.ess as Essence)) p.ess = r.ess as Essence;
  if (GARDE_CORPS.includes(r.gc as GardeCorps)) p.gc = r.gc as GardeCorps;
  if (POSES.includes(r.gcPose as Pose)) p.gcPose = r.gcPose as Pose;
  if (FORMES_TREMIE.includes(r.tForme as FormeTremie)) p.tForme = r.tForme as FormeTremie;
  if (TOURNANTS.includes(r.tournant as Tournant)) p.tournant = r.tournant as Tournant;
  for (const k of NUMERIC_KEYS) if (typeof r[k] === "number" && Number.isFinite(r[k])) p[k] = r[k];
  for (const k of BOOLEAN_KEYS) if (typeof r[k] === "boolean") p[k] = r[k];
  return p;
}
