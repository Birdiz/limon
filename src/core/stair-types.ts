/* Modèle de l'escalier : les types que produit compute (stair.ts) et que lisent les autres modules de core,
   l'export CNC, la fiche PDF et l'interface. Rien que des types, sans calcul : pockets.ts, railing.ts, tremie.ts
   et stair-notes.ts les importent d'ici sans repasser par stair.ts, qui les ré-exporte pour les imports extérieurs. */
import type { Headroom } from "./headroom";
import type { NumericKey, Params, Pose } from "./params";
import type { Poly } from "./poly";
import type { Pt, Vertex } from "./vec";

export type Status = "ok" | "warn" | "bad";
export type NoteLevel = Status | "info";
/** Correction proposée avec une note : réglages à appliquer d'un clic. */
export interface Fix {
  set: Partial<Params>;
  label: string;
}
export type Note = [level: NoteLevel, text: string, fix?: Fix | undefined];

/** Ligne de nez k : du point Q sur le jour, par le point P de la ligne de foulée, jusqu'au point O sur le limon extérieur. */
export interface NoseLine {
  k: number;
  /** Abscisse sur la ligne de foulée. */
  t: number;
  Q: Pt;
  P: Pt;
  O: Pt;
  dir: Pt;
  /** Normale vers le haut de l'escalier. */
  nr: Pt;
  sIn: number;
  sOut: number;
}

export interface Tread {
  /** Numéro de marche, à partir de 1. */
  j: number;
  /** Hauteur du dessus de marche. */
  top: number;
  /** Surface vue en plan, de nez à nez. */
  plan: Pt[];
  /** Surface réelle de la marche (sous la contremarche suivante), sans la bande du nez arrondi. */
  solid: Pt[];
  /** Bande du nez arrondi, de largeur rn derrière la ligne de nez ; null si le nez est vif. */
  nose: { o: Pt; len: number; nr: Pt } | null;
  gIn: number;
  gOut: number;
  gWalk: number;
  /** Longueur de nez. */
  nez: number;
  balanced: boolean;
  /** Palier d'un tournant, à la place des marches balancées. */
  palier: boolean;
}

/** Marche palière : du dernier nez jusqu'au plancher d'arrivée, logée dans les limons prolongés. */
export interface LandingTread {
  /** Dessus, au niveau du sol fini du haut. */
  top: number;
  /** Épaisseur. */
  e: number;
  /** Profondeur depuis le nez. */
  depth: number;
  /** Rayon du nez appliqué (au plus la moitié de son épaisseur). */
  rn: number;
  plan: Pt[];
  solid: Pt[];
  nose: Tread["nose"];
  /** Longueur de nez. */
  nez: number;
}

export interface Riser {
  z0: number;
  z1: number;
  plan: Pt[];
}

/** Tronçon de limon droit, développé dans son plan (u le long du limon, z en hauteur). */
export interface StringerGeom {
  origin: Pt;
  dir: Pt;
  /** Normale à droite de dir, vers l'épaisseur du limon. */
  rn: Pt;
  /** Arête haute (u, z). */
  prof: Pt[];
  width: number;
  side: "in" | "out";
  idx: number;
  count: number;
  /** Début du segment de polyligne. */
  a: Pt;
  sLo: number;
  sHi: number;
}

/** Tenon au bout d'un limon de jour, dans le plan du limon : de u0 à u1 (l'un des deux est l'épaulement),
    de z0 à z1, et de t0 à t1 dans l'épaisseur depuis la face côté marches. */
export interface Tenon {
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  t0: number;
  t1: number;
}

export interface StringerPiece extends StringerGeom {
  /** Logements, dans le plan du limon. */
  pockets: Vertex[][];
  /** Pièce reçue par chaque logement. */
  pocketOf: PocketOf[];
  /** Hauteur qui garde 20 mm de bois sous le logement le plus bas. */
  need: number;
  /** Hauteur retenue pour cette pièce. */
  hl: number;
  /** Tenons dans les poteaux (limons de jour qui tournent) : au bout bas, puis au bout haut. */
  tenons: Tenon[];
  /** Perçages traversants (u, z) pour visser ou boulonner l'about du limon de mur suivant. */
  holes: Pt[];
}

/** Face du poteau : normale sortante n, abscisse u le long de la face (o + dir·u, de u0 à u1). */
export interface NewelFace {
  n: Pt;
  o: Pt;
  dir: Pt;
  u0: number;
  u1: number;
  /** Volée dont la face reçoit les marches (faces côté marches) ; null pour les faces à mortaises. */
  volee: number | null;
  /** Logements des marches et contremarches (u, z), sur les faces côté marches. */
  pockets: Vertex[][];
  /** Mortaises du tronçon idx (limon de jour ou main courante), sur sa face d'entrée. */
  mortises: { idx: number; of: "limon" | "main courante"; pts: Pt[]; depth: number }[];
}

/** Poteau d'un tournant, du sol à h, affleurant les faces des limons de jour côté marches. */
export interface Newel {
  /** Tournant reçu : entre les tronçons de limon de jour k et k + 1 (le poteau unique du demi-tournant
      reçoit aussi le suivant, entre k + 1 et k + 2). */
  k: number;
  /** Centre et dimensions en plan, le long de x et de y (avant le miroir) : carré de la section du poteau,
      ou section × jour pour le poteau unique. */
  c: Pt;
  sx: number;
  sy: number;
  h: number;
  /** Les quatre faces dans l'ordre du tour, en commençant par la face côté marches de la volée qui arrive. */
  faces: NewelFace[];
}

/** Cotes de la trémie retenue, saisies ou calculées. */
export interface TreDims {
  tL: number;
  tX: number;
  tY: number;
  /** Largeurs des branches de la trémie en L. */
  tbD: number;
  tbA: number;
}

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Zone de marches balancées d'un tournant, de la ligne de nez a à la ligne b. */
export interface Balance {
  a: number;
  b: number;
  m: number;
  extended: boolean;
  /** Progressivité appliquée, de 0 à 1. */
  pr: number;
  /** Progressivité demandée, de 0 à 1. */
  want: number;
}

export interface Stair {
  params: Params;
  notes: Note[];
  /** Escalier qui tourne (quart ou double quart). */
  quart: boolean;
  /** Nombre de tournants. */
  tours: number;
  n: number;
  nAuto: number;
  h: number;
  g: number;
  f: number;
  fAuto: number;
  /** Longueur de la ligne de foulée. */
  Lw: number;
  /** Début et fin de l'arc de la ligne de foulée au premier tournant. */
  T1: number;
  T2: number;
  W: number;
  A: number;
  B: number;
  C: number;
  L: number;
  H: number;
  inner: Poly;
  outer: Poly;
  walkAt: (t: number) => Pt;
  lines: NoseLine[];
  treads: Tread[];
  risers: Riser[];
  stringers: StringerPiece[];
  /** Rayon du nez appliqué (au plus la moitié de l'épaisseur de marche). */
  rn: number;
  /** Hauteur du limon de mur (ou des deux limons en escalier droit). */
  hl: number;
  /** Hauteur du limon de jour. */
  hlj: number;
  /** Hauteur de limon de jour proposée d'après ses logements. */
  hljAuto: number;
  needJ: number;
  needM: number;
  /** Un poteau par tournant. */
  newels: Newel[];
  /** Garde-corps côté jour ; null sans garde-corps. */
  rail: Railing | null;
  /** Marche palière ; null sans marche palière. */
  mp: LandingTread | null;
  slab: Rect;
  /** Contour de la trémie (rectangle ou L) et sa boîte englobante. */
  trePoly: Pt[];
  tre: Rect;
  /** Trémie en L retenue (quart tournant). */
  treL: boolean;
  /** Trémie calculée plutôt que saisie. */
  tAuto: boolean;
  treDims: TreDims;
  /** Hauteur de la sous-face du plancher. */
  ceil: number;
  /** Échappée la plus faible sur toute la largeur. */
  ech: Headroom | null;
  /** Échappée sur la face du limon de jour, la ligne de foulée et la face du limon de mur. */
  echCotes: Record<EchCote, Headroom | null>;
  tLmin: number | null;
  tXmin: number | null;
  tYmin: number | null;
  /** Balancement du premier tournant. */
  bal: Balance | null;
  /** Balancement de chaque tournant. */
  bals: Balance[];
  /** Paliers, dans l'ordre de la montée : marche j, et reste de la division ajouté à sa profondeur côté arrivée
      de la volée qui y monte. */
  paliers: { j: number; reste: number }[];
  blondel: number;
  pente: number;
  gInMin: number;
  st: Record<"h" | "g" | "bl" | "pente" | "gIn" | "ech", Status>;
}

/** Réglage refusé ; key désigne le champ à corriger quand il y en a un. */
export interface InputError {
  message: string;
  key?: NumericKey;
}

export type ComputeResult = { ok: true; stair: Stair } | { ok: false; errors: InputError[] };
/** Refus du calcul : renvoyé tel quel par l'étape qui bute. */
export type ComputeFailure = Extract<ComputeResult, { ok: false }>;

export type EchCote = "jour" | "foulee" | "mur";

/** Volées d'un escalier à palier : m girons sur la volée d'arrivée, qui fixent le giron g ; counts girons sur
    chaque volée qui monte à un palier, reste ajouté à la profondeur du palier ; n hauteurs, palier compris. */
export interface PalierLayout {
  n: number;
  g: number;
  m: number;
  counts: number[];
  rest: number[];
}

/** Ce que reçoit un logement : marche j (palier compris), marche palière, ou contremarche j (sous la marche j). */
export interface PocketOf {
  k: "marche" | "palière" | "contremarche";
  j: number;
}

/** Tronçon de main courante au-dessus du tronçon de limon de jour idx, du bout u0 au bout u1 (pris au dessus). */
export interface Handrail {
  idx: number;
  u0: number;
  u1: number;
  /** Coupe d'onglet en bout : décalage en u du dessous par rapport au dessus ; absent si le bout est d'aplomb. */
  cut0?: number;
  cut1?: number;
  /** Retour horizontal au-dessus de la marche palière. */
  retour?: boolean;
  /** Dessus : z = z0 + b·u. */
  z0: number;
  b: number;
  /** Épaisseur mesurée d'aplomb. */
  hv: number;
  /** Tenons dans les poteaux, au bout bas puis au bout haut : de u0 à u1, de z0 à z1,
      de t0 à t1 depuis la face du limon côté marches. */
  tenons: { u0: number; u1: number; z0: number; z1: number; t0: number; t1: number }[];
}

/** Balustre ou montant, d'axe u : bas et haut à l'axe, avec la pente de chaque coupe. */
export interface Post {
  idx: number;
  u: number;
  zb: number;
  ab: number;
  zt: number;
  at: number;
  /** Tenon en bas, dans le chant du limon (pose dans le chant). */
  tenonBas: boolean;
  /** Perçages traversants du limon (u, z), pose à l'anglaise. */
  holes: Pt[];
}

/** Lisse entre deux appuis (montants ou poteau), de uA à uB ; dessus à z0 + b·u, épaisseur d'aplomb hv. */
export interface Rail {
  idx: number;
  uA: number;
  uB: number;
  z0: number;
  b: number;
  hv: number;
}

export interface Railing {
  type: "balustres" | "lisses";
  pose: Pose;
  /** Axe du garde-corps, depuis la face du limon de jour côté marches. */
  off: number;
  handrails: Handrail[];
  posts: Post[];
  rails: Rail[];
  /** Hauteur de la main courante au-dessus des nez, au plus bas et au plus haut. */
  hMin: number;
  hMax: number;
  /** Plus grand écart libre du remplissage. */
  gap: number;
  /** Écart le plus petit entre la lisse basse et le limon ; négatif si elle le touche. */
  railLow: number;
}
