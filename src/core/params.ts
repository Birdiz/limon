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
  /** Marches débordantes à l'anglaise : le limon de jour devient une crémaillère, les marches posées dessus le
      dépassent (escalier droit). */
  mdeb: boolean;
  /** Débord des marches au jour, au-delà du flanc de la crémaillère. */
  debJ: number;
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

/** Bornes de toute cote, en mm, loin de ce qu'un escalier demande : au-delà, le calcul ne tiendrait plus à l'écran. */
export const H_MAX = 20000;
export const COTE_MAX = 50000;

/* ---------- Catalogue des réglages ----------
   Ce que l'outil sait de chaque réglage, en un seul endroit : sa valeur d'exemple, son nom, et pour quels autres
   réglages il existe, se grise ou se calcule. Le calcul (cotes relues et bornées), le formulaire (lignes masquées,
   champs grisés), le profil de l'atelier et les noms des cotes en découlent. */

/** Rainures antidérapantes par marche, au plus. */
export const RAINURES_MAX = 6;

/** Champ d'un nombre, dans la colonne de réglages comme dans Mon atelier : pas et bornes de la saisie (celles du
    calcul sont dans `validate`), en millimètres sauf `sansUnite` ; `curseur` pour un pourcentage. */
export interface Saisie {
  pas: number;
  min: number;
  max?: number;
  sansUnite?: true;
  curseur?: true;
}

/** Ce que l'outil sait d'un réglage. */
type Reglage<K extends keyof Params> = {
  /** Nom pour l'artisan hors de son champ : cotes ignorées d'un fichier, réglages de l'atelier. */
  libelle: string;
  /** Valeur de l'exemple, celle d'un nouvel escalier sans profil d'atelier. */
  defaut: Params[K];
  /** Repris par chaque nouvel escalier depuis le profil de l'atelier. */
  atelier?: true;
  /** Réglage avancé : masqué sans la préférence de l'appareil. */
  avance?: true;
  /** Nombre ramené dans ses bornes par le calcul plutôt que refusé. */
  ramene?: true;
  /** N'existe qu'avec ces réglages (forme, option cochée) ; sinon masqué et sans effet sur le calcul. */
  existe?: (p: Params) => boolean;
  /** Sa case, dans la même ligne, est cochée ; décochée, le champ reste visible, grisé, et garde sa valeur. */
  allume?: (p: Params) => boolean;
  /** Sa case « automatique » est cochée : le champ montre le calcul, et le formulaire ne le relit pas. */
  auto?: (p: Params) => boolean;
} & (Params[K] extends string
  ? {
      /** Valeurs permises, dans l'ordre des listes de choix. */
      valeurs: readonly Params[K][];
      /** Nom de chaque valeur, dans les listes de choix. */
      noms: { readonly [V in Params[K] & string]: string };
      saisie?: never;
      mot?: never;
    }
  : Params[K] extends number
    ? { saisie: Saisie; valeurs?: never; noms?: never; mot?: never }
    : { /** Mot qui suit la case. */ mot?: string; valeurs?: never; noms?: never; saisie?: never });

const tourne = (p: Params) => TOURS[p.forme] > 0;
const droit = (p: Params) => TOURS[p.forme] === 0;
const balancees = (p: Params) => tourne(p) && p.tournant === "balance";
const tremieACalculer = (p: Params) => p.tAuto;
const avecGardeCorps = (p: Params) => p.gc !== "aucun";
const avecRainures = (p: Params) => p.rai;
const avecContremarches = (p: Params) => p.cm;
const avecMarchePaliere = (p: Params) => p.mp;

/** Tous les réglages, dans l'ordre des réglages enregistrés (fichiers .escalier, comparaisons de réglages). */
export const REGLAGES = {
  forme: {
    libelle: "Forme",
    defaut: "quart-d",
    valeurs: FORMES,
    noms: {
      droit: "Droit",
      "quart-g": "Quart tournant gauche",
      "quart-d": "Quart tournant droit",
      "dq-g": "Double quart tournant gauche",
      "dq-d": "Double quart tournant droit",
      "demi-g": "Demi-tournant gauche",
      "demi-d": "Demi-tournant droit",
    },
  },
  H: { libelle: "Hauteur à monter", defaut: 2700, saisie: { pas: 5, min: 300 } },
  L: { libelle: "Reculement", defaut: 3650, saisie: { pas: 10, min: 500 }, existe: droit },
  A: { libelle: "Longueur côté départ", defaut: 2900, saisie: { pas: 10, min: 500 }, existe: tourne },
  B: { libelle: "Longueur côté arrivée", defaut: 1800, saisie: { pas: 10, min: 500 }, existe: tourne },
  C: {
    libelle: "Longueur côté fond",
    defaut: 2400,
    saisie: { pas: 10, min: 500 },
    existe: (p) => TOURS[p.forme] === 2 && !isDemi(p.forme),
  },
  J: { libelle: "Jour", defaut: 200, saisie: { pas: 10, min: 100 }, existe: (p) => isDemi(p.forme) },
  W: { libelle: "Emmarchement", defaut: 850, saisie: { pas: 10, min: 400 } },
  fAuto: { libelle: "Ligne de foulée automatique", defaut: true, mot: "automatique", avance: true },
  f: { libelle: "Ligne de foulée", defaut: 425, saisie: { pas: 10, min: 100 }, avance: true, auto: (p) => p.fAuto },
  nAuto: { libelle: "Nombre de hauteurs automatique", defaut: true, mot: "automatique", avance: true },
  n: {
    libelle: "Nombre de hauteurs",
    defaut: 15,
    saisie: { pas: 1, min: 3, max: 40, sansUnite: true },
    avance: true,
    ramene: true,
    auto: (p) => p.nAuto,
  },
  mb: {
    libelle: "Marches balancées",
    defaut: 7,
    saisie: { pas: 1, min: 2, max: 12, sansUnite: true },
    avance: true,
    ramene: true,
    existe: balancees,
  },
  prog: {
    libelle: "Progressivité",
    defaut: 60,
    saisie: { pas: 5, min: 0, max: 100, sansUnite: true, curseur: true },
    avance: true,
    ramene: true,
    existe: balancees,
  },
  tournant: {
    libelle: "Passage du tournant",
    defaut: "balance",
    valeurs: TOURNANTS,
    noms: { balance: "Marches balancées", palier: "Palier" },
    existe: tourne,
  },
  ess: {
    libelle: "Essence",
    defaut: "chene",
    valeurs: ESSENCES,
    noms: {
      chene: "Chêne",
      hetre: "Hêtre",
      frene: "Frêne",
      chataignier: "Châtaignier",
      erable: "Érable",
      merisier: "Merisier",
      noyer: "Noyer",
      sapin: "Sapin",
      epicea: "Épicéa",
      douglas: "Douglas",
      meleze: "Mélèze",
    },
    atelier: true,
  },
  et: { libelle: "Épaisseur de marche", defaut: 40, saisie: { pas: 1, min: 18 }, atelier: true },
  deb: { libelle: "Débord de nez", defaut: 30, saisie: { pas: 1, min: 0 }, atelier: true, avance: true },
  rn: {
    libelle: "Rayon du nez",
    defaut: 10,
    saisie: { pas: 1, min: 0 },
    atelier: true,
    avance: true,
    existe: (p) => p.nez !== "casse",
  },
  nez: {
    libelle: "Profil du nez",
    defaut: "arrondi",
    valeurs: PROFILS_NEZ,
    noms: { arrondi: "Arrondi", quart: "Quart-de-rond", chanfrein: "Chanfrein", casse: "Arêtes cassées" },
    atelier: true,
  },
  rai: { libelle: "Rainures antidérapantes", defaut: false, mot: "avec", atelier: true },
  raiN: {
    libelle: "Nombre de rainures",
    defaut: 2,
    saisie: { pas: 1, min: 1, max: RAINURES_MAX, sansUnite: true },
    atelier: true,
    avance: true,
    existe: avecRainures,
  },
  raiL: {
    libelle: "Largeur des rainures",
    defaut: 6,
    saisie: { pas: 1, min: 2 },
    atelier: true,
    avance: true,
    existe: avecRainures,
  },
  raiP: {
    libelle: "Profondeur des rainures",
    defaut: 3,
    saisie: { pas: 0.5, min: 0.5 },
    atelier: true,
    avance: true,
    existe: avecRainures,
  },
  raiD: {
    libelle: "Première rainure",
    defaut: 25,
    saisie: { pas: 1, min: 5 },
    atelier: true,
    avance: true,
    existe: avecRainures,
  },
  raiE: {
    libelle: "Entraxe des rainures",
    defaut: 15,
    saisie: { pas: 1, min: 5 },
    atelier: true,
    avance: true,
    existe: avecRainures,
  },
  cm: { libelle: "Contremarches", defaut: true, mot: "avec", atelier: true },
  ecm: {
    libelle: "Épaisseur de contremarche",
    defaut: 22,
    saisie: { pas: 1, min: 10 },
    atelier: true,
    allume: avecContremarches,
  },
  cmPose: {
    libelle: "Pose de la contremarche",
    defaut: "sur",
    valeurs: POSES_CM,
    noms: { sur: "Sur la marche", derriere: "Derrière" },
    atelier: true,
    existe: avecContremarches,
  },
  cmEmb: {
    libelle: "Embrèvement de la contremarche",
    defaut: 0,
    saisie: { pas: 1, min: 0 },
    atelier: true,
    avance: true,
    existe: avecContremarches,
  },
  mdeb: { libelle: "Marches débordantes", defaut: false, mot: "avec", atelier: true, existe: droit },
  debJ: {
    libelle: "Débord au jour",
    defaut: 30,
    saisie: { pas: 1, min: 0 },
    atelier: true,
    avance: true,
    existe: (p) => anglaise(p),
  },
  el: { libelle: "Épaisseur de limon", defaut: 45, saisie: { pas: 1, min: 20 }, atelier: true },
  hl: { libelle: "Hauteur de limon", defaut: 340, saisie: { pas: 5, min: 150 }, atelier: true, avance: true },
  hljAuto: {
    libelle: "Hauteur du limon de jour automatique",
    defaut: true,
    mot: "automatique",
    atelier: true,
    avance: true,
    existe: tourne,
  },
  hlj: {
    libelle: "Hauteur du limon de jour",
    defaut: 470,
    saisie: { pas: 5, min: 150 },
    avance: true,
    existe: tourne,
    auto: (p) => p.hljAuto,
  },
  tAuto: { libelle: "Trémie à calculer", defaut: false },
  ps: { libelle: "Section du poteau", defaut: 100, saisie: { pas: 5, min: 75 }, atelier: true, existe: tourne },
  gc: {
    libelle: "Côté jour",
    defaut: "aucun",
    valeurs: GARDE_CORPS,
    noms: { aucun: "Aucun", balustres: "Balustres", lisses: "Lisses rampantes" },
    atelier: true,
  },
  gcPose: {
    libelle: "Pose sur le limon",
    defaut: "chant",
    valeurs: POSES,
    noms: { chant: "Dans le chant", anglaise: "À l'anglaise" },
    atelier: true,
    existe: avecGardeCorps,
  },
  mcL: {
    libelle: "Largeur de main courante",
    defaut: 50,
    saisie: { pas: 5, min: 30 },
    atelier: true,
    existe: avecGardeCorps,
  },
  mcH: {
    libelle: "Hauteur de main courante",
    defaut: 70,
    saisie: { pas: 5, min: 30 },
    atelier: true,
    existe: avecGardeCorps,
  },
  bs: {
    libelle: "Section des balustres",
    defaut: 30,
    saisie: { pas: 1, min: 20 },
    atelier: true,
    existe: avecGardeCorps,
  },
  tL: {
    libelle: "Longueur de trémie",
    defaut: 3200,
    saisie: { pas: 10, min: 0 },
    existe: droit,
    auto: tremieACalculer,
  },
  tX: {
    libelle: "Trémie côté arrivée ou fond",
    defaut: 1845,
    saisie: { pas: 10, min: 0 },
    existe: tourne,
    auto: tremieACalculer,
  },
  tY: {
    libelle: "Trémie côté départ ou arrivée",
    defaut: 2550,
    saisie: { pas: 10, min: 0 },
    existe: tourne,
    auto: tremieACalculer,
  },
  tForme: {
    libelle: "Forme de la trémie",
    defaut: "rect",
    valeurs: FORMES_TREMIE,
    // « En U » à la place de « En L » quand l'escalier a deux tournants (syncInputs).
    noms: { rect: "Rectangle", L: "En L" },
    existe: tourne,
  },
  tbD: {
    libelle: "Branche de trémie côté départ",
    defaut: 950,
    saisie: { pas: 10, min: 100 },
    existe: (p) => tourne(p) && p.tForme === "L",
    auto: tremieACalculer,
  },
  tbA: {
    libelle: "Branche de trémie côté arrivée",
    defaut: 950,
    saisie: { pas: 10, min: 100 },
    existe: (p) => tourne(p) && p.tForme === "L",
    auto: tremieACalculer,
  },
  mp: { libelle: "Marche palière", defaut: false, mot: "avec", atelier: true },
  mpP: {
    libelle: "Profondeur de marche palière",
    defaut: 300,
    saisie: { pas: 10, min: 150 },
    atelier: true,
    allume: avecMarchePaliere,
  },
  mpE: {
    libelle: "Épaisseur de marche palière",
    defaut: 40,
    saisie: { pas: 1, min: 18 },
    atelier: true,
    existe: avecMarchePaliere,
  },
  ep: { libelle: "Épaisseur du plancher", defaut: 200, saisie: { pas: 5, min: 0 } },
  enc: { libelle: "Encastrement", defaut: 15, saisie: { pas: 1, min: 0, max: 40 }, atelier: true, avance: true },
  jeu: { libelle: "Jeu d'assemblage", defaut: 0.5, saisie: { pas: 0.1, min: 0, max: 5 }, atelier: true, avance: true },
  pL: { libelle: "Longueur des plateaux", defaut: 5000, saisie: { pas: 100, min: 500 }, atelier: true, avance: true },
  pW: { libelle: "Largeur des plateaux", defaut: 600, saisie: { pas: 10, min: 100 }, atelier: true, avance: true },
} satisfies { readonly [K in keyof Params]: Reglage<K> };

/** Clés des réglages, dans l'ordre du catalogue. */
export const CLES = Object.keys(REGLAGES) as readonly (keyof Params)[];

type ClesDe<T> = { [K in keyof Params]: Params[K] extends T ? K : never }[keyof Params];
export type NumericKey = ClesDe<number>;
export type BooleanKey = ClesDe<boolean>;
export type TextKey = ClesDe<string>;

/** Entrée du catalogue, lue sans connaître la clé : ce que chaque type de réglage peut porter. */
export type FicheReglage = Omit<Reglage<keyof Params>, "valeurs" | "noms" | "saisie" | "mot"> & {
  valeurs?: readonly string[];
  noms?: Readonly<Record<string, string>>;
  saisie?: Saisie;
  mot?: string;
};

/** Entrée du catalogue d'un réglage. */
export const reglage = (k: keyof Params): FicheReglage => REGLAGES[k] as FicheReglage;

export const DEFAULTS: Readonly<Params> = Object.fromEntries(CLES.map((k) => [k, reglage(k).defaut])) as never;

export const NUMERIC_KEYS: readonly NumericKey[] = CLES.filter(
  (k): k is NumericKey => typeof reglage(k).defaut === "number",
);

/** Cases à cocher, dans l'ordre du lien de projet : il est écrit dans les codes QR des fiches, ne pas le changer. */
export const BOOLEAN_KEYS = [
  "fAuto",
  "nAuto",
  "hljAuto",
  "cm",
  "rai",
  "mdeb",
  "tAuto",
  "mp",
] as const satisfies readonly BooleanKey[];

/** Réglages choisis dans une liste, écrits tels quels dans un lien de projet, dans cet ordre (voir BOOLEAN_KEYS). */
export const TEXT_KEYS = [
  "forme",
  "ess",
  "gc",
  "gcPose",
  "tForme",
  "tournant",
  "nez",
  "cmPose",
] as const satisfies readonly TextKey[];

// Les deux listes du lien nomment toutes les cases et toutes les listes du catalogue : sinon, erreur de type ici.
type Oublis<L extends readonly string[], U extends string> = Exclude<U, L[number]>;
const toutDansLeLien: [Oublis<typeof BOOLEAN_KEYS, BooleanKey> | Oublis<typeof TEXT_KEYS, TextKey>] extends [never]
  ? true
  : never = true;
void toutDansLeLien;

/**
 * Mode du champ d'un réglage : saisi par l'artisan, grisé par sa case décochée (il garde sa valeur), ou calculé
 * (il montre le calcul et n'est pas relu).
 */
export type ModeSaisie = "saisi" | "eteint" | "calcule";

/** État d'un réglage avec ces réglages : montré ou masqué (sans effet sur le calcul), et le mode de son champ.
    Les deux sont indépendants : la longueur de trémie d'un quart tournant est masquée, et calculée si la trémie l'est. */
export function etatReglage(k: keyof Params, p: Params): { montre: boolean; mode: ModeSaisie } {
  const r = reglage(k);
  return {
    montre: r.existe?.(p) ?? true,
    mode: r.auto?.(p) ? "calcule" : r.allume && !r.allume(p) ? "eteint" : "saisi",
  };
}

/** Cotes que le calcul relit et borne avec ces réglages : montrées et saisies. Les autres (autre forme, valeur
    automatique, case décochée) sont sans effet : hors de vue, ou non relues du formulaire, elles ne bloquent pas
    l'escalier. Le nombre de hauteurs et le balancement sont ramenés dans leurs bornes par le calcul. */
export function cotesLues(p: Params): NumericKey[] {
  return NUMERIC_KEYS.filter((k) => {
    if (reglage(k).ramene) return false;
    const { montre, mode } = etatReglage(k, p);
    return montre && mode === "saisi";
  });
}

/** Recul de la coupe arrière d'une marche derrière la ligne de nez suivante : jusqu'au dos de la contremarche
    posée dessus, ou jusqu'à son parement quand elle descend derrière la marche. */
export const arriereMarche = (p: Pick<Params, "deb" | "cm" | "ecm" | "cmPose">): number =>
  p.deb + (p.cm && p.cmPose === "sur" ? p.ecm : 0);

/** Marches débordantes réellement appliquées : l'escalier droit seulement, pour l'instant. */
export const anglaise = (p: Pick<Params, "mdeb" | "forme">): boolean => p.mdeb && TOURS[p.forme] === 0;

/** Fusionne des réglages enregistrés (non fiables) avec les valeurs par défaut, champ par champ. */
export function sanitizeParams(raw: unknown): Params {
  const p: Params = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return p;
  const r = raw as Record<string, unknown>;
  for (const k of CLES) {
    const v = r[k];
    const { defaut, valeurs } = reglage(k);
    const lu = valeurs
      ? (valeurs as readonly unknown[]).includes(v)
      : typeof defaut === "number"
        ? typeof v === "number" && Number.isFinite(v)
        : typeof v === typeof defaut;
    if (lu) (p as Record<keyof Params, unknown>)[k] = v;
  }
  return p;
}
