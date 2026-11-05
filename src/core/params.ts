export type Forme = "droit" | "quart-g" | "quart-d" | "dq-g" | "dq-d" | "demi-g" | "demi-d";
export type Essence =
  | "chene"
  | "hetre"
  | "frene"
  | "chataignier"
  | "erable"
  | "merisier"
  | "noyer"
  | "sapin"
  | "epicea"
  | "douglas"
  | "meleze";
/** Remplissage du garde-corps côté jour. */
export type GardeCorps = "aucun" | "balustres" | "lisses";
/** Pose des balustres ou montants : dans le chant haut du limon, ou sur son flanc côté vide. */
export type Pose = "chant" | "anglaise";
/** Contour de la trémie : rectangle, ou en L qui suit le quart tournant. */
export type FormeTremie = "rect" | "L";
/** Passage des tournants : marches balancées, ou palier (le même pour tous les tournants). */
export type Tournant = "balance" | "palier";
/** Profil du nez de marche : arrondi dessus et dessous (demi-rond au plus), quart-de-rond ou chanfrein sur l'arête
    du dessus (dessous vif), ou droit aux arêtes cassées. */
export type ProfilNez = "arrondi" | "quart" | "chanfrein" | "casse";
/** Pose de la contremarche : sur la marche du bas, ou derrière elle (vissée dans son chant arrière). */
export type PoseCm = "sur" | "derriere";

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
  /** Rayon du nez (côte du chanfrein pour ce profil) ; 0 = vif. Sans effet aux arêtes cassées. */
  rn: number;
  /** Profil du nez. */
  nez: ProfilNez;
  /** Rainures antidérapantes près du nez. */
  rai: boolean;
  /** Nombre de rainures. */
  raiN: number;
  /** Largeur d'une rainure. */
  raiL: number;
  /** Profondeur des rainures. */
  raiP: number;
  /** Distance du nez à l'axe de la première rainure. */
  raiD: number;
  /** Entraxe des rainures. */
  raiE: number;
  /** Avec contremarches. */
  cm: boolean;
  /** Épaisseur de contremarche. */
  ecm: number;
  /** Pose de la contremarche par rapport à la marche du bas. */
  cmPose: PoseCm;
  /** Embrèvement de la contremarche sous la marche du haut, profondeur de la rainure de logement ; 0 = sans. */
  cmEmb: number;
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
  nez: "arrondi",
  rai: false,
  raiN: 2,
  raiL: 6,
  raiP: 3,
  raiD: 25,
  raiE: 15,
  cm: true,
  ecm: 22,
  cmPose: "sur",
  cmEmb: 0,
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
/** Feuillus puis résineux, dans l'ordre des listes. */
export const ESSENCES: readonly Essence[] = [
  "chene",
  "hetre",
  "frene",
  "chataignier",
  "erable",
  "merisier",
  "noyer",
  "sapin",
  "epicea",
  "douglas",
  "meleze",
];
export const GARDE_CORPS: readonly GardeCorps[] = ["aucun", "balustres", "lisses"];
export const POSES: readonly Pose[] = ["chant", "anglaise"];
export const FORMES_TREMIE: readonly FormeTremie[] = ["rect", "L"];
export const TOURNANTS: readonly Tournant[] = ["balance", "palier"];
export const PROFILS_NEZ: readonly ProfilNez[] = ["arrondi", "quart", "chanfrein", "casse"];
export const POSES_CM: readonly PoseCm[] = ["sur", "derriere"];

/** Masse volumique moyenne à 12 % d'humidité, en kg/m³ (ordre de grandeur pour le poids). */
export const DENSITE: Record<Essence, number> = {
  chene: 710,
  hetre: 720,
  frene: 700,
  chataignier: 590,
  erable: 650,
  merisier: 620,
  noyer: 650,
  sapin: 450,
  epicea: 450,
  douglas: 530,
  meleze: 600,
};

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
  "raiN",
  "raiL",
  "raiP",
  "raiD",
  "raiE",
  "ecm",
  "cmEmb",
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

/** Bornes de toute cote, en mm, loin de ce qu'un escalier demande : au-delà, le calcul ne tiendrait plus à l'écran. */
export const H_MAX = 20000;
export const COTE_MAX = 50000;

export const BOOLEAN_KEYS = [
  "fAuto",
  "nAuto",
  "hljAuto",
  "cm",
  "rai",
  "tAuto",
  "mp",
] as const satisfies readonly (keyof Params)[];

/** Réglages choisis dans une liste, écrits tels quels dans un lien de projet. */
export const TEXT_KEYS = [
  "forme",
  "ess",
  "gc",
  "gcPose",
  "tForme",
  "tournant",
  "nez",
  "cmPose",
] as const satisfies readonly (keyof Params)[];

/** Recul de la coupe arrière d'une marche derrière la ligne de nez suivante : jusqu'au dos de la contremarche
    posée dessus, ou jusqu'à son parement quand elle descend derrière la marche. */
export const arriereMarche = (p: Pick<Params, "deb" | "cm" | "ecm" | "cmPose">): number =>
  p.deb + (p.cm && p.cmPose === "sur" ? p.ecm : 0);

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
  if (PROFILS_NEZ.includes(r.nez as ProfilNez)) p.nez = r.nez as ProfilNez;
  if (POSES_CM.includes(r.cmPose as PoseCm)) p.cmPose = r.cmPose as PoseCm;
  for (const k of NUMERIC_KEYS) if (typeof r[k] === "number" && Number.isFinite(r[k])) p[k] = r[k];
  for (const k of BOOLEAN_KEYS) if (typeof r[k] === "boolean") p[k] = r[k];
  return p;
}
