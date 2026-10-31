/* Calcul de l'escalier.
   Repère plan (mm) : départ en y = 0, montée vers +y, limon extérieur en x = 0, jour (intérieur) en x = W.
   Tournants calculés à droite (2e volée vers +x, 3e vers −y en double quart) ; la version gauche est un miroir. */
import { fmt, ceil10 } from "./format";
import { headroomUnder, type Headroom, type NoseSeg } from "./headroom";
import { TOURS, type NumericKey, type Params } from "./params";
import { BOIS_SOUS_LOGEMENT, cncFrame, stringerPockets } from "./pockets";
import { makePoly, polyAt, polyCut, polyPath, type Poly } from "./poly";
import { GC, railing, type Railing } from "./railing";
import { V, bbox, clamp, interp, type Pt, type Vertex } from "./vec";

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
  /** Logements des marches et contremarches (u, z), sur les faces côté marches. */
  pockets: Vertex[][];
  /** Mortaises du tronçon idx (limon de jour ou main courante), sur sa face d'entrée. */
  mortises: { idx: number; of: "limon" | "main courante"; pts: Pt[]; depth: number }[];
}

/** Poteau d'un tournant, du sol à h, affleurant les faces des limons de jour côté marches. */
export interface Newel {
  /** Tournant reçu : entre les tronçons de limon de jour k et k + 1. */
  k: number;
  c: Pt;
  size: number;
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
export type { Headroom } from "./headroom";

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

/** Échappée visée. */
export const ECHAPPEE = 2000;
/** Échappée en dessous de laquelle l'escalier est hors norme. */
export const ECHAPPEE_MIN = 1900;
/**
 * Plages des contrôles de confort, en mm (pente en degrés) : hors de min…max, « Limite » ;
 * au-delà de bad, « Hors norme ». gIn : giron côté jour des marches balancées.
 */
export const CONFORT = {
  h: { min: 155, max: 185, bad: 200 },
  g: { min: 240, max: 320, bad: 210 },
  blondel: { min: 600, max: 640, cible: 630, badMin: 580, badMax: 660 },
  pente: { max: 38, bad: 45 },
  gIn: { min: 100, bad: 60 },
} as const;
/** Ligne de foulée automatique du quart tournant : au plus à cette distance du jour. */
export const FOULEE_MAX = 500;

export type EchCote = "jour" | "foulee" | "mur";

/** État d'une échappée (null : tout passe sous la trémie). */
export const echStatus = (e: Headroom | null): Status =>
  !e ? "ok" : e.c < ECHAPPEE_MIN ? "bad" : e.c < ECHAPPEE ? "warn" : "ok";

/** Où tombe l'échappée la plus faible : sur un côté, sur la ligne de foulée, sur toute la largeur quand
    les trois se valent (au demi-millimètre), "" quand elle tombe entre deux. */
export function echWhere(ech: Headroom, cotes: Record<EchCote, Headroom | null>): string {
  const at = (e: Headroom | null) => !!e && Math.abs(e.c - ech.c) < 0.5;
  if (at(cotes.jour) && at(cotes.foulee) && at(cotes.mur)) return "sur toute la largeur";
  return at(cotes.jour) ? "côté jour" : at(cotes.mur) ? "côté mur" : at(cotes.foulee) ? "sur la ligne de foulée" : "";
}

/** Échappée détaillée par côté : en quart tournant, ou quand les côtés diffèrent. */
export function echSidesShown(R: Stair): boolean {
  const v = Object.values(R.echCotes).map((e) => (e ? fmt(e.c) : ""));
  return R.quart || v.some((x) => x !== v[0]);
}
/** Hauteur du bord haut des limons au-dessus de la ligne des nez. */
export const LIFT = 50;
/** Assemblage des limons de jour dans le poteau : longueur de tenon visée, épaulements haut et bas,
    fond de mortaise au-delà du tenon. Tête du poteau au-dessus du limon le plus haut. */
export const TENON = { long: 40, epaul: 30, fond: 2, tete: 100 } as const;
/** Diamètre des perçages de l'about des limons de mur. */
export const PERCAGE = 10;

/** Statuts de confort d'une hauteur de marche h et d'un giron g. */
export function comfortStatus(h: number, g: number): Pick<Stair["st"], "h" | "g" | "bl" | "pente"> {
  const C = CONFORT;
  const blondel = 2 * h + g,
    pente = (Math.atan2(h, g) * 180) / Math.PI;
  return {
    h: h > C.h.bad ? "bad" : h > C.h.max || h < C.h.min ? "warn" : "ok",
    g: g < C.g.bad ? "bad" : g < C.g.min || g > C.g.max ? "warn" : "ok",
    bl:
      blondel < C.blondel.badMin || blondel > C.blondel.badMax
        ? "bad"
        : blondel < C.blondel.min || blondel > C.blondel.max
          ? "warn"
          : "ok",
    pente: pente > C.pente.bad ? "bad" : pente > C.pente.max ? "warn" : "ok",
  };
}

const comfortable = (H: number, Lw: number, n: number) =>
  Object.values(comfortStatus(H / n, Lw / (n - 1))).every((s) => s === "ok");

/** Longueur de ligne de foulée confortable la plus proche de Lw (pas de 10 mm, la plus courte à égalité),
    avec le nombre de hauteurs imposé ou, à défaut, celui du calcul automatique. */
export function comfortableRun(H: number, Lw: number, nFixed?: number): { Lw: number; n: number } | null {
  for (let d = 0; d <= 6000; d += 10)
    for (const v of d ? [Lw - d, Lw + d] : [Lw]) {
      if (v < 500) continue;
      const n = nFixed ?? pickN(H, v);
      if (comfortable(H, v, n)) return { Lw: v, n };
    }
  return null;
}

/** Nombre de hauteurs qui approche le mieux Blondel (2h + g ≈ 630 mm) dans les plages de confort. */
export function pickN(H: number, Lw: number): number {
  let best: { n: number; score: number } | null = null;
  for (let n = Math.max(3, Math.ceil(H / 230)); n <= Math.floor(H / 120); n++) {
    const h = H / n,
      g = Lw / (n - 1),
      bl = 2 * h + g;
    const score =
      Math.abs(bl - CONFORT.blondel.cible) +
      6 * Math.max(0, h - 190) +
      6 * Math.max(0, 155 - h) +
      3 * Math.max(0, 230 - g) +
      3 * Math.max(0, g - 320);
    if (!best || score < best.score) best = { n, score };
  }
  return best ? best.n : Math.max(3, Math.round(H / 175));
}

function validate(p: Params, tours: number): InputError[] {
  const quart = tours > 0;
  const errors: InputError[] = [];
  const err = (key: NumericKey, message: string) => errors.push({ key, message });
  const { H, W } = p;
  if (!(H >= 300)) err("H", "La hauteur à monter doit faire au moins 300 mm.");
  if (!(W >= 400)) err("W", "L'emmarchement doit faire au moins 400 mm.");
  if (quart) {
    if (!(p.A > W + 1)) err("A", "La longueur côté départ doit dépasser l'emmarchement.");
    if (!(p.B > W + 1)) err("B", "La longueur côté arrivée doit dépasser l'emmarchement.");
    if (tours === 2 && p.ps >= p.el + 30 && !(p.C - 2 * W >= 2 * p.ps + 100))
      err(
        "C",
        `Le côté fond doit laisser au moins 100 mm de limon de jour entre les deux poteaux : au moins ${fmt(2 * W + 2 * p.ps + 100)} mm.`,
      );
  } else if (!(p.L >= 500)) err("L", "Le reculement doit faire au moins 500 mm.");
  if (quart && !(p.ps >= p.el + 30))
    err("ps", "La section du poteau doit dépasser l'épaisseur de limon d'au moins 30 mm.");
  else if (quart && p.A > W + 1 && p.B > W + 1 && !(Math.min(p.A, p.B) - W >= p.ps + 100))
    err("ps", "Le poteau doit laisser au moins 100 mm de limon de jour de chaque côté : réduisez sa section.");
  if (p.gc !== "aucun") {
    if (!(p.bs >= 20)) err("bs", "Les balustres, montants et lisses doivent faire au moins 20 mm.");
    else if (p.gcPose === "chant" && !(p.bs <= p.el))
      err("bs", "Posés dans le chant, les balustres ne doivent pas dépasser l'épaisseur du limon.");
    if (!(p.mcH >= 30)) err("mcH", "La main courante doit faire au moins 30 mm de haut.");
    if (!(p.mcL >= 30)) err("mcL", "La main courante doit faire au moins 30 mm de large.");
    else if (
      quart &&
      p.ps >= p.el + 30 &&
      !(p.mcL / 2 + (p.gcPose === "chant" ? p.el / 2 : p.el + p.bs / 2) <= p.ps - 10)
    )
      err("mcL", "La main courante déborde du poteau : réduisez sa largeur ou élargissez le poteau.");
  }
  if (p.mp) {
    if (!(p.mpP >= 150)) err("mpP", "La marche palière doit faire au moins 150 mm de profondeur.");
    if (!(p.mpE >= 18)) err("mpE", "La marche palière doit faire au moins 18 mm d'épaisseur.");
  }
  if (quart && p.tForme === "L" && !p.tAuto) {
    if (!(p.tbD >= 100)) err("tbD", "La branche côté départ doit faire au moins 100 mm.");
    if (!(p.tbA >= 100)) err("tbA", "La branche côté arrivée doit faire au moins 100 mm.");
  }
  if (!(p.ep >= 0 && p.ep < H - 500))
    err("ep", "L'épaisseur du plancher doit rester inférieure à la hauteur à monter moins 500 mm.");
  return errors;
}

/** Réglage de longueur qui rend la hauteur et le giron confortables : texte de la note et correction. */
function runFix(p: Params, quart: boolean, Lw: number, n: number, nAuto: number): [string, Fix] | null {
  if (!p.nAuto && comfortable(p.H, Lw, nAuto))
    return [
      `Le calcul automatique (${nAuto} hauteurs) rend l'escalier confortable sans changer les longueurs.`,
      { set: { nAuto: true }, label: "Revenir en automatique" },
    ];
  const run = (!p.nAuto && comfortableRun(p.H, Lw, n)) || comfortableRun(p.H, Lw);
  if (!run) return null;
  const d = run.Lw - Lw;
  const detail = `soit ${run.n} hauteurs de ${fmt(p.H / run.n, 1)} mm et un giron de ${fmt(run.Lw / (run.n - 1), 1)} mm`;
  const auto = run.n !== n ? { nAuto: true } : {};
  if (!quart)
    return [
      `Reculement conseillé : ${fmt(run.Lw)} mm, ${detail}.`,
      { set: { L: run.Lw, ...auto }, label: `Passer à ${fmt(run.Lw)} mm` },
    ];
  // En quart tournant, la ligne de foulée suit la longueur côté départ (ou côté arrivée si le départ est trop court).
  const key = p.A + d > p.W + 1 ? "A" : "B";
  const v = p[key] + d;
  if (!(v > p.W + 1)) return null;
  return [
    `Longueur côté ${key === "A" ? "départ" : "arrivée"} conseillée : ${fmt(v)} mm, ${detail}.`,
    { set: { [key]: v, ...auto }, label: `Passer à ${fmt(v)} mm` },
  ];
}

/** Contour de la trémie, adossé au bord du plancher d'arrivée (reculé de la marche palière, mpD) ;
    en quart tournant, aussi au mur face à la montée ; en U (double quart), au mur côté arrivée, tY se prenant
    le long du côté arrivée et tX en travers. En L, le coin au-dessus du jour, hors de l'escalier, reste plancher ;
    en U, le milieu au-dessus du jour : branches des volées de tbD depuis chaque mur de côté, bande du fond de tbA. */
export function tremieContour(p: Params, d: TreDims, mpD: number, C = p.C): Pt[] {
  const { A, B, L, W, el } = p,
    tours = TOURS[p.forme];
  const y0U = A - B - mpD;
  const r =
    tours === 2
      ? { x0: Math.max(-el, C + el - d.tX), x1: C + el, y0: y0U, y1: Math.min(A + el, y0U + d.tY) }
      : tours
        ? { x0: Math.max(-el, B + mpD - d.tX), x1: B + mpD, y0: Math.max(-300, A + el - d.tY), y1: A + el }
        : { x0: -el, x1: W + el, y0: Math.max(-300, L + mpD - d.tL), y1: L + mpD };
  const rect: Pt[] = [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ];
  if (!tours || p.tForme !== "L") return rect;
  const xa = r.x0 + d.tbD,
    yb = r.y1 - d.tbA;
  if (tours === 2) {
    const xb = r.x1 - d.tbD;
    if (!(xa < xb - 0.5 && yb > r.y0 + 0.5)) return rect;
    return [
      [r.x0, r.y0],
      [xa, r.y0],
      [xa, yb],
      [xb, yb],
      [xb, r.y0],
      [r.x1, r.y0],
      [r.x1, r.y1],
      [r.x0, r.y1],
    ];
  }
  if (!(xa < r.x1 - 0.5 && yb > r.y0 + 0.5)) return rect;
  return [
    [r.x0, r.y0],
    [xa, r.y0],
    [xa, yb],
    [r.x1, yb],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ];
}

type Edge = { sIn: number; sOut: number };

/** Marche palière : de la ligne de nez d'arrivée ln jusqu'à depth en arrière, nez arrondi de rayon r. */
function landingTread(
  ln: NoseLine,
  top: number,
  e: number,
  depth: number,
  r: number,
  g: {
    cutOff: (ln: NoseLine, off: number) => Edge;
    region: (fr: Edge, bk: Edge) => Pt[];
    noseSpan: (ln: NoseLine, r: number) => NonNullable<Tread["nose"]>;
  },
): LandingTread {
  const back = g.cutOff(ln, depth);
  return {
    top,
    e,
    depth,
    rn: r,
    plan: g.region(ln, back),
    solid: g.region(r > 0 ? g.cutOff(ln, r) : ln, back),
    nose: r > 0 ? g.noseSpan(ln, r) : null,
    nez: V.len(V.sub(ln.O, ln.Q)),
  };
}

/** Calcule l'escalier ; suggest ajoute aux notes les corrections chiffrées (calculs supplémentaires). */
export function compute(p: Params, suggest = true): ComputeResult {
  const tours = TOURS[p.forme],
    quart = tours > 0;
  const errors = validate(p, tours);
  if (errors.length) return { ok: false, errors };

  const { H, W, A, B, C, L } = p;
  const fAuto = quart ? Math.min(W / 2, FOULEE_MAX) : W / 2;
  const f = p.fAuto ? fAuto : clamp(p.f, 100, W - 100);
  const inner = makePoly(
    tours === 2
      ? [
          [W, 0],
          [W, A - W],
          [C - W, A - W],
          [C - W, A - B],
        ]
      : quart
        ? [
            [W, 0],
            [W, A - W],
            [B, A - W],
          ]
        : [
            [W, 0],
            [W, L],
          ],
  );
  const outer = makePoly(
    tours === 2
      ? [
          [0, 0],
          [0, A],
          [C, A],
          [C, A - B],
        ]
      : quart
        ? [
            [0, 0],
            [0, A],
            [B, A],
          ]
        : [
            [0, 0],
            [0, L],
          ],
  );
  // Ligne de foulée : les côtés du jour décalés de f vers l'extérieur, raccordés par un quart de cercle
  // de rayon f autour de chaque angle du jour. Tronçons droits : longueurs len, départ des arcs tA, fins tB.
  const len = tours === 2 ? [A - W, C - 2 * W, B - W] : quart ? [A - W, B - W] : [L];
  const dirs = inner.pts.slice(1).map((q, i) => V.norm(V.sub(q, inner.pts[i]!)));
  const sIn = [0],
    tA: number[] = [],
    tB: number[] = [];
  for (let i = 0; i < tours; i++) {
    sIn.push(sIn[i]! + len[i]!);
    tA.push((i ? tB[i - 1]! : 0) + len[i]!);
    tB.push(tA[i]! + (Math.PI / 2) * f);
  }
  const T1 = quart ? tA[0]! : L,
    T2 = quart ? tB[0]! : L;
  const Lw = quart ? tB[tours - 1]! + len[tours]! : L;
  // Tronçon droit i : vers l'extérieur, à gauche du sens de montée.
  const out = (i: number): Pt => [-dirs[i]![1], dirs[i]![0]];
  const walkAt = (t: number): Pt => {
    let i = 0;
    while (i < tours && t >= tB[i]!) i++;
    if (i === 0 && (!quart || t <= T1)) return [W - f, t];
    if (i < tours && t > tA[i]!) {
      const th = (t - tA[i]!) / f,
        K = inner.pts[i + 1]!;
      return [
        K[0] + f * (out(i)[0] * Math.cos(th) + dirs[i]![0] * Math.sin(th)),
        K[1] + f * (out(i)[1] * Math.cos(th) + dirs[i]![1] * Math.sin(th)),
      ];
    }
    const u = t - (i ? tB[i - 1]! : 0),
      P0 = inner.pts[i]!;
    return [P0[0] + dirs[i]![0] * u + out(i)[0] * f, P0[1] + dirs[i]![1] * u + out(i)[1] * f];
  };
  const walkTan = (t: number): Pt => {
    let i = 0;
    while (i < tours && t >= tB[i]!) i++;
    if (i < tours && t > tA[i]!) {
      const th = (t - tA[i]!) / f;
      return V.sub(V.mul(dirs[i]!, Math.cos(th)), V.mul(out(i), Math.sin(th)));
    }
    return dirs[i]!;
  };

  const nAuto = pickN(H, Lw);
  const n = p.nAuto ? nAuto : clamp(Math.round(p.n), 3, 40);
  const h = H / n,
    g = Lw / (n - 1);

  // Position de chaque nez sur le limon du jour : perpendiculaire en partie droite, puis balancement.
  const sPerp = (t: number) => {
    let i = 0;
    while (i < tours && t >= tB[i]!) i++;
    if (i < tours && t > tA[i]!) return sIn[i + 1]!;
    return i ? sIn[i]! + (t - tB[i - 1]!) : t;
  };
  const s = Array.from({ length: n }, (_, k) => sPerp(k * g));
  // Zone balancée de chaque tournant : mb marches centrées sur l'arc, étendues pour le couvrir tout entier.
  const m0 = clamp(Math.round(p.mb), 2, n - 1);
  const zones = tA.map((t1, i) => {
    const t2 = tB[i]!;
    // « || 0 » : pas de zéro négatif pour la première marche du tour, affichée et comparée telle quelle.
    let a = Math.round((t1 + t2) / 2 / g - m0 / 2) || 0,
      b = a + m0;
    if (a < 0) {
      b -= a;
      a = 0;
    }
    if (b > n - 1) {
      a -= b - (n - 1);
      b = n - 1;
      a = Math.max(0, a);
    }
    let extended = false;
    while (a > 0 && a * g > t1 + 1e-6) {
      a--;
      extended = true;
    }
    while (b < n - 1 && b * g < t2 - 1e-6) {
      b++;
      extended = true;
    }
    return { a, b, extended };
  });
  // Deux zones qui se chevauchent se partagent à la ligne la plus proche du milieu de la volée entre les deux :
  // le giron au jour garde un creux à chaque angle. Cette ligne s'appuie sur le côté du jour entre les angles.
  for (let i = 1; i < zones.length; i++) {
    const z0 = zones[i - 1]!,
      z1 = zones[i]!;
    if (z0.b <= z1.a) continue;
    const mid = (tB[i - 1]! + tA[i]!) / 2,
      k = clamp(Math.round(mid / g), z0.a + 1, z1.b - 1);
    z0.b = z1.a = k;
    s[k] = clamp(sIn[i]! + (k * g - tB[i - 1]!), sIn[i]!, sIn[i + 1]!);
  }
  const bals: Balance[] = zones.map(({ a, b, extended }) => {
    const m = b - a,
      S = s[b]! - s[a]!,
      base = S / m,
      amp = g - base;
    const c = (i: number) => (m >= 2 ? Math.cos((2 * Math.PI * (i + 0.5)) / m) : 0);
    let pr = clamp(p.prog / 100, 0, 1);
    const want = pr;
    const minW = CONFORT.gIn.min;
    if (amp > 0 && m >= 2) {
      let cmin = 0;
      for (let i = 0; i < m; i++) cmin = Math.min(cmin, c(i));
      const pmax = cmin < 0 ? (base - minW) / (-cmin * amp) : 1;
      pr = clamp(Math.min(pr, pmax), 0, 1);
    } else pr = 0;
    let acc = s[a]!;
    for (let i = 0; i < m - 1; i++) {
      acc += base + pr * amp * c(i);
      s[a + i + 1] = acc;
    }
    return { a, b, m, extended, pr, want };
  });
  const bal = bals[0] ?? null;

  // Lignes de nez : du point sur le jour, passant par la ligne de foulée, jusqu'au limon extérieur.
  const lines: NoseLine[] = [];
  for (let k = 0; k < n; k++) {
    const t = k * g,
      Q = polyAt(inner, s[k]!),
      P = walkAt(t);
    const dir = V.norm(V.sub(P, Q));
    let nr: Pt = [dir[1], -dir[0]];
    if (V.dot(nr, walkTan(t)) < 0) nr = [-nr[0], -nr[1]];
    const o = polyCut(outer, Q, dir, "ahead");
    if (!o)
      return {
        ok: false,
        errors: [{ message: "Géométrie impossible : une ligne de marche ne rejoint pas le limon extérieur." }],
      };
    lines.push({ k, t, Q, P, dir, nr, sIn: s[k]!, sOut: o.s, O: o.p });
  }
  const cutOff = (ln: NoseLine, off: number) => {
    const pt = V.add(ln.Q, V.mul(ln.nr, off));
    const a = polyCut(inner, pt, ln.dir, "near"),
      b = polyCut(outer, pt, ln.dir, "ahead");
    return { sIn: a ? a.s : ln.sIn, sOut: b ? b.s : ln.sOut };
  };
  const region = (fr: Edge, bk: Edge) => [...polyPath(inner, fr.sIn, bk.sIn), ...polyPath(outer, bk.sOut, fr.sOut)];

  const bo = p.deb + (p.cm ? p.ecm : 0);
  // Nez arrondi : bande de largeur rn derrière la ligne de nez, dessinée à part en 3D.
  const rn = clamp(p.rn, 0, p.et / 2);
  const noseSpan = (ln: NoseLine, r = rn) => {
    const d2: Pt = [ln.nr[1], -ln.nr[0]],
      c = cutOff(ln, r);
    const us = [polyAt(inner, ln.sIn), polyAt(outer, ln.sOut), polyAt(inner, c.sIn), polyAt(outer, c.sOut)].map((q) =>
      V.dot(V.sub(q, ln.Q), d2),
    );
    const u0 = Math.min(...us),
      u1 = Math.max(...us);
    return { o: V.add(ln.Q, V.mul(d2, u0)), len: u1 - u0, nr: ln.nr };
  };
  const treads: Tread[] = [];
  for (let j = 1; j < n; j++) {
    const fr = lines[j - 1]!,
      bk = lines[j]!;
    treads.push({
      j,
      top: j * h,
      plan: region(fr, bk),
      solid: region(rn > 0 ? cutOff(fr, rn) : fr, cutOff(bk, bo)),
      nose: rn > 0 ? noseSpan(fr) : null,
      gIn: bk.sIn - fr.sIn,
      gOut: bk.sOut - fr.sOut,
      gWalk: g,
      nez: V.len(V.sub(fr.O, fr.Q)),
      balanced: bals.some((z) => j > z.a && j <= z.b),
    });
  }
  // Marche palière : dans le prolongement du plancher d'arrivée, son nez sur la dernière ligne de nez.
  const mpD = p.mp ? p.mpP : 0;
  if (mpD && !(p.mpE <= h - 20))
    return {
      ok: false,
      errors: [
        {
          key: "mpE",
          message: `La marche palière doit rester plus mince que la hauteur de marche moins 20 mm (${fmt(h - 20)} mm).`,
        },
      ],
    };
  const mp = mpD
    ? landingTread(lines[n - 1]!, n * h, p.mpE, mpD, Math.min(rn, p.mpE / 2), { cutOff, region, noseSpan })
    : null;
  const risers: Riser[] = [];
  if (p.cm)
    for (let j = 1; j <= n; j++) {
      const ln = lines[j - 1]!;
      const z1 = j * h - (j === n && mp ? mp.e : p.et);
      risers.push({ z0: (j - 1) * h, z1, plan: region(cutOff(ln, p.deb), cutOff(ln, p.deb + p.ecm)) });
    }
  if (treads.some((t) => t.gIn <= 1 || t.gOut <= 1)) {
    return {
      ok: false,
      errors: [
        {
          key: "mb",
          message:
            "Géométrie impossible : des marches se croisent. Augmentez le nombre de marches balancées ou réduisez la progressivité.",
        },
      ],
    };
  }

  // Limons : arête haute à LIFT au-dessus de la ligne des nez.
  const el = p.el,
    hl = p.hl;
  const zIn = (v: number) =>
    interp(
      lines.map((l) => l.sIn),
      lines.map((l) => (l.k + 1) * h + LIFT),
      v,
    );
  const zOut = (v: number) =>
    interp(
      lines.map((l) => l.sOut),
      lines.map((l) => (l.k + 1) * h + LIFT),
      v,
    );
  // Poteau affleurant les faces côté marches, à chaque coin du jour : les limons de jour s'arrêtent sur ses faces.
  const ps = p.ps;
  const pieces = (P: Poly, arr: number[], zf: (v: number) => number, isOuter: boolean): StringerGeom[] => {
    const out: StringerGeom[] = [],
      N = P.pts.length,
      post = quart && !isOuter ? ps : 0;
    for (let i = 0; i < N - 1; i++) {
      const a = P.pts[i]!,
        dir = V.norm(V.sub(P.pts[i + 1]!, a)),
        rn: Pt = [dir[1], -dir[0]];
      const s0 = P.cum[i]!,
        s1 = P.cum[i + 1]!,
        segL = s1 - s0;
      const lo = i === 0 ? Math.min(s0, arr[0]!) : s0 + post;
      // Avec une marche palière, le dernier tronçon se prolonge à l'horizontale pour la loger.
      const hi = i === N - 2 ? Math.max(s1, arr[arr.length - 1]!) + mpD : s1 - post;
      const ss = [lo, ...arr.filter((v) => v > lo + 1e-6 && v < hi - 1e-6), hi];
      const prof = ss.map((v): Pt => [v - s0, zf(v)]);
      if (isOuter && i < N - 2) prof.push([segL + el, zf(s1)]);
      out.push({
        origin: isOuter ? V.add(a, V.mul(rn, -el)) : a,
        dir,
        rn,
        prof,
        width: el,
        side: isOuter ? "out" : "in",
        idx: i,
        count: N - 1,
        a,
        sLo: i === 0 ? -Infinity : s0 + post,
        sHi: i === N - 2 ? Infinity : s1 - post,
      });
    }
    return out;
  };
  const geoms = [
    ...pieces(
      inner,
      lines.map((l) => l.sIn),
      zIn,
      false,
    ),
    ...pieces(
      outer,
      lines.map((l) => l.sOut),
      zOut,
      true,
    ),
  ];
  // Faces des poteaux côté marches, traitées comme des bouts de limon pour y loger marches et contremarches.
  const corners = Array.from({ length: tours }, (_, k) => k);
  const newelTop = corners.map((k) => ceil10(Math.max(zIn(sIn[k + 1]! - ps), zIn(sIn[k + 1]! + ps)) + TENON.tete));
  const face = (a: Pt, dir: Pt, u0: number, sLo: number, top: number): StringerGeom => ({
    origin: a,
    dir,
    rn: [dir[1], -dir[0]],
    prof: [
      [u0, top],
      [u0 + ps, top],
    ],
    width: ps,
    side: "in",
    idx: 0,
    count: 1,
    a,
    sLo,
    sHi: sLo + ps,
  });
  const postFaces = corners.flatMap((k) => [
    face(inner.pts[k]!, dirs[k]!, len[k]! - ps, sIn[k + 1]! - ps, newelTop[k]!),
    face(inner.pts[k + 1]!, dirs[k + 1]!, 0, sIn[k + 1]!, newelTop[k]!),
  ]);
  // Logements de chaque limon et hauteur qui garde 20 mm de bois sous le plus bas.
  // Le limon de jour du quart tournant a sa propre hauteur, proposée d'après ses logements.
  const geo = {
    inner,
    outer,
    lines,
    treads,
    risers,
    stringers: [...geoms, ...postFaces],
    mp: mp && { line: lines[n - 1]!, top: mp.top, e: mp.e, depth: mp.depth },
  };
  const isJour = (sp: StringerGeom) => quart && sp.side === "in";
  let pk: ReturnType<typeof stringerPockets>;
  try {
    pk = stringerPockets(geo, p, cncFrame(geo, p));
  } catch {
    // Une ligne de marche, décalée du débord ou de l'encastrement, sort des limons (balancement trop serré).
    return {
      ok: false,
      errors: [
        {
          key: "mb",
          message:
            "Géométrie impossible : une marche ne rejoint plus les limons. Augmentez le nombre de marches balancées.",
        },
      ],
    };
  }
  const withPockets = geoms.map((sp, i) => ({ ...sp, ...pk[i]! }));
  const needJ = Math.max(0, ...withPockets.filter(isJour).map((sp) => sp.need));
  const needM = Math.max(0, ...withPockets.filter((sp) => !isJour(sp)).map((sp) => sp.need));
  const hljAuto = Math.max(150, ceil10(needJ));
  const hlj = quart ? (p.hljAuto ? hljAuto : p.hlj) : hl;
  // Tenon centré dans le bois laissé derrière les logements, pour que sa mortaise n'y débouche pas.
  // Il s'arrête avant la mortaise de l'autre limon, sur la face voisine du poteau.
  const jeu = Math.max(0, p.jeu);
  const tt = Math.max(6, Math.round((el - p.enc) / 2)),
    t0 = Math.max(0, p.enc + (el - p.enc - tt) / 2),
    t1 = t0 + tt,
    tl = Math.min(TENON.long, ps - t1 - 5);
  const tenonOf = (sp: StringerGeom, hs: number, end: boolean): Tenon => {
    const sh = end ? sp.prof[sp.prof.length - 1]![0] : sp.prof[0]![0],
      far = end ? sh + tl : sh - tl;
    const top = (u: number) => zIn(inner.cum[sp.idx]! + u),
      bot = (u: number) => Math.max(0, top(u) - hs);
    return {
      u0: Math.min(sh, far),
      u1: Math.max(sh, far),
      z0: Math.max(bot(sh), bot(far)) + TENON.epaul,
      z1: Math.min(top(sh), top(far)) - TENON.epaul,
      t0,
      t1,
    };
  };
  // About des limons de mur : chaque tronçon dépasse de son épaisseur et reçoit le bout du suivant, vissé ou boulonné.
  // Perçages au milieu du bois laissé derrière les logements, pour rester loin de ceux de la marche d'angle.
  const holesOf = (sp: StringerGeom): Pt[] => {
    if (!quart || sp.side !== "out" || sp.idx === sp.count - 1) return [];
    const i = sp.idx,
      zt = zOut(outer.cum[i + 1]!),
      zb = Math.max(0, zt - hl),
      u = outer.cum[i + 1]! - outer.cum[i]! + (p.enc + jeu + el) / 2;
    return [
      [u, zb + (zt - zb) / 3],
      [u, zb + ((zt - zb) * 2) / 3],
    ];
  };
  const stringers: StringerPiece[] = withPockets.map((sp) => {
    const hs = isJour(sp) ? hlj : hl;
    const tenons = isJour(sp)
      ? [...(sp.idx > 0 ? [tenonOf(sp, hs, false)] : []), ...(sp.idx < sp.count - 1 ? [tenonOf(sp, hs, true)] : [])]
      : [];
    return { ...sp, hl: hs, tenons, holes: holesOf(sp) };
  });
  // Poteaux : faces dans l'ordre du tour (vu de dessus, sens trigonométrique pour un tournant à droite).
  const mortise = (idx: number, end: boolean) => {
    const ts = stringers.find((sp) => isJour(sp) && sp.idx === idx)!.tenons,
      t = end ? ts[ts.length - 1]! : ts[0]!;
    return {
      idx,
      of: "limon" as const,
      depth: t.u1 - t.u0 + TENON.fond,
      pts: [
        [t.t0 - jeu, t.z0 - jeu],
        [t.t1 + jeu, t.z0 - jeu],
        [t.t1 + jeu, t.z1 + jeu],
        [t.t0 - jeu, t.z1 + jeu],
      ] as Pt[],
    };
  };
  // Garde-corps : main courante au-dessus des limons de jour, assemblée dans le poteau qui monte la recevoir.
  const rail = railing({
    p,
    quart,
    jour: stringers.filter((sp) => sp.side === "in"),
    cum: inner.cum,
    noseS: lines.map((l) => l.sIn),
    noseZ: lines.map((l) => (l.k + 1) * h),
    mpD,
  });
  const mcMortise = (idx: number, end: boolean) => {
    const ts = rail?.handrails.find((r) => r.idx === idx)?.tenons;
    const t = ts?.length ? (end ? ts[ts.length - 1] : ts[0]) : undefined;
    if (!t) return [];
    return [
      {
        idx,
        of: "main courante" as const,
        depth: t.u1 - t.u0 + GC.fond,
        pts: [
          [t.t0 - jeu, t.z0 - jeu],
          [t.t1 + jeu, t.z0 - jeu],
          [t.t1 + jeu, t.z1 + jeu],
          [t.t0 - jeu, t.z1 + jeu],
        ] as Pt[],
      },
    ];
  };
  // Le poteau monte recevoir la main courante : dessus des deux tronçons à leur bout contre le poteau.
  const mcTop = (k: number) =>
    Math.max(
      0,
      ...(rail?.handrails
        .filter((r) => r.tenons.length && (r.idx === k || r.idx === k + 1))
        .map((r) => r.z0 + r.b * (r.idx === k ? r.u1 : r.u0)) ?? []),
    );
  const newels: Newel[] = corners.map((k) => {
    const K = inner.pts[k + 1]!,
      d0 = dirs[k]!,
      d1 = dirs[k + 1]!,
      back = V.sub(K, V.mul(d0, ps));
    return {
      k,
      c: V.add(V.sub(K, V.mul(d0, ps / 2)), V.mul(d1, ps / 2)),
      size: ps,
      h: rail ? Math.max(newelTop[k]!, ceil10(mcTop(k) + GC.tete)) : newelTop[k]!,
      faces: [
        {
          n: V.sub([0, 0], d1),
          o: inner.pts[k]!,
          dir: d0,
          u0: len[k]! - ps,
          u1: len[k]!,
          pockets: pk[geoms.length + 2 * k]!.pockets,
          mortises: [],
        },
        {
          n: V.sub([0, 0], d0),
          o: back,
          dir: d1,
          u0: 0,
          u1: ps,
          pockets: [],
          mortises: [mortise(k, true), ...mcMortise(k, true)],
        },
        {
          n: d1,
          o: V.add(K, V.mul(d1, ps)),
          dir: V.sub([0, 0], d0),
          u0: 0,
          u1: ps,
          pockets: [],
          mortises: [mortise(k + 1, false), ...mcMortise(k + 1, false)],
        },
        { n: d0, o: K, dir: d1, u0: 0, u1: ps, pockets: pk[geoms.length + 2 * k + 1]!.pockets, mortises: [] },
      ],
    };
  });
  // Plancher haut et trémie (voir tremieContour).
  const U = tours === 2;
  const slab: Rect = U
    ? { x0: -el - 300, x1: C + el + 300, y0: Math.min(-400, A - B - mpD - 900), y1: A + el + 300 }
    : quart
      ? { x0: -el - 300, x1: B + mpD + 900, y0: -400, y1: A + el + 300 }
      : { x0: -el - 300, x1: W + el + 300, y0: -400, y1: L + mpD + 900 };
  // Échappée : distance verticale entre la ligne des nez et la sous-face du plancher, hors de la trémie.
  // Mesurée sur la ligne de foulée, sur les faces des limons (côté jour, côté mur) et sur toute la largeur.
  const ceil = H - p.ep;
  const zNose = (k: number) => (k + 1) * h;
  const along = (P: Poly, s: (l: NoseLine) => number): NoseSeg[] =>
    lines.slice(0, -1).flatMap((L0, k) => {
      const L1 = lines[k + 1]!,
        path = polyPath(P, s(L0), s(L1)),
        len = Math.abs(s(L1) - s(L0)) || 1;
      let u = 0;
      return path.slice(1).map((b, i) => {
        const a = path[i]!,
          u0 = u;
        u += V.len(V.sub(b, a));
        return { a, b, za: zNose(k) + (h * u0) / len, zb: zNose(k) + (h * u) / len, j: k + 1 };
      });
    });
  // Ligne de foulée courbe dans le tour : découpée en 8 cordes par marche.
  const cuts = quart ? 8 : 1;
  const walkSegs: NoseSeg[] = lines.slice(0, -1).flatMap((L0, k) =>
    Array.from({ length: cuts }, (_, i) => {
      const t = (v: number) => L0.t + ((lines[k + 1]!.t - L0.t) * v) / cuts;
      return {
        a: walkAt(t(i)),
        b: walkAt(t(i + 1)),
        za: zNose(k) + (h * i) / cuts,
        zb: zNose(k) + (h * (i + 1)) / cuts,
        j: k + 1,
      };
    }),
  );
  const sideSegs = { jour: along(inner, (l) => l.sIn), foulee: walkSegs, mur: along(outer, (l) => l.sOut) };
  // Toute la largeur : 9 droites de nez à nez, du jour au mur.
  const widthSegs: NoseSeg[] = lines.slice(0, -1).flatMap((L0, k) => {
    const L1 = lines[k + 1]!;
    return Array.from({ length: 9 }, (_, a) => ({
      a: V.add(L0.Q, V.mul(V.sub(L0.O, L0.Q), a / 8)),
      b: V.add(L1.Q, V.mul(V.sub(L1.O, L1.Q), a / 8)),
      za: zNose(k),
      zb: zNose(k + 1),
      j: k + 1,
    }));
  });
  const allSegs = [...sideSegs.jour, ...sideSegs.foulee, ...sideSegs.mur, ...widthSegs];
  const headroom = (t: Pt[]): Headroom | null => headroomUnder(allSegs, t, ceil);
  const echOk = (t: Pt[]) => {
    const r = headroom(t);
    return !r || r.c >= ECHAPPEE;
  };
  // Plus petite ouverture (au cm) qui donne l'échappée visée, par dichotomie.
  const minOpening = (make: (v: number) => Pt[], max: number) => {
    if (!echOk(make(max))) return null;
    let lo = 0,
      hi = max;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (echOk(make(mid))) hi = mid;
      else lo = mid;
    }
    return ceil10(hi);
  };
  // Trémie à calculer : la plus courte qui suffit ; en quart tournant, sur tout le côté arrivée,
  // et en L, des branches juste assez larges pour l'escalier (limons, poteau et garde-corps compris).
  const treL = quart && p.tForme === "L";
  const treDims: TreDims = { tL: p.tL, tX: p.tX, tY: p.tY, tbD: p.tbD, tbA: p.tbA };
  const treAt = (d: Partial<TreDims>) => tremieContour(p, { ...treDims, ...d }, mpD);
  if (p.tAuto) {
    const branches = () => {
      const jour = Math.max(el, ps, rail ? rail.off + Math.max(p.mcL, p.bs) / 2 : 0);
      treDims.tbD = treDims.tbA = ceil10(el + W + jour);
    };
    if (U) {
      if (treL) branches();
      treDims.tX = C + 2 * el;
      treDims.tY = minOpening((v) => treAt({ tY: v }), B + el + mpD) ?? B + el + mpD;
    } else if (quart) {
      if (treL) branches();
      treDims.tX = B + el + mpD;
      treDims.tY = minOpening((v) => treAt({ tY: v }), A + el + 300) ?? A + el + 300;
    } else treDims.tL = minOpening((v) => treAt({ tL: v }), L + mpD + 300) ?? L + mpD + 300;
  }
  const trePoly = treAt({});
  const tre: Rect = bbox(trePoly);
  const ech = headroom(trePoly);
  const echCotes = {
    jour: headroomUnder(sideSegs.jour, trePoly, ceil),
    foulee: headroomUnder(sideSegs.foulee, trePoly, ceil),
    mur: headroomUnder(sideSegs.mur, trePoly, ceil),
  };
  const tLmin = quart ? null : minOpening((v) => treAt({ tL: v }), L + mpD + 300);
  const tYmin = U
    ? minOpening((v) => treAt({ tY: v }), B + el + mpD)
    : quart
      ? minOpening((v) => treAt({ tY: v }), A + el + 300)
      : null;
  const tXmin = U
    ? minOpening((v) => treAt({ tX: v }), C + 2 * el)
    : quart
      ? minOpening((v) => treAt({ tX: v }), B + el + mpD)
      : null;

  // Contrôles
  const gInMin = Math.min(...treads.map((t) => t.gIn));
  const blondel = 2 * h + g;
  const pente = (Math.atan2(h, g) * 180) / Math.PI;
  const st: Stair["st"] = {
    ...comfortStatus(h, g),
    gIn: gInMin < CONFORT.gIn.bad ? "bad" : gInMin < CONFORT.gIn.min ? "warn" : "ok",
    ech: echStatus(ech),
  };
  const N: Note[] = [];
  if (st.h !== "ok")
    N.push([
      st.h,
      h > CONFORT.h.max
        ? `Marches hautes (${fmt(h, 1)} mm) : ajoutez une hauteur ou allongez le reculement.`
        : `Marches basses (${fmt(h, 1)} mm) : retirez une hauteur.`,
    ]);
  if (st.g !== "ok")
    N.push([
      st.g,
      g < CONFORT.g.min
        ? `Giron court (${fmt(g)} mm) sur la ligne de foulée : il manque de la longueur au sol.`
        : `Giron long (${fmt(g)} mm) : ajoutez une hauteur pour un pas plus naturel.`,
    ]);
  if (st.bl !== "ok")
    N.push([
      st.bl,
      `Loi de Blondel hors plage : 2h + g = ${fmt(blondel)} mm, visez ${CONFORT.blondel.min} à ${CONFORT.blondel.max} mm.`,
    ]);
  if (st.pente !== "ok") N.push([st.pente, `Escalier raide (${fmt(pente, 1)}°).`]);
  if (suggest && [st.h, st.g, st.bl, st.pente].some((s) => s !== "ok")) {
    const fix = runFix(p, quart, Lw, n, nAuto);
    if (fix) N.push(["info", fix[0], fix[1]]);
  }
  if (quart && st.gIn !== "ok") {
    // Plus petit nombre de marches balancées qui garde 100 mm au jour.
    let mb: number | null = null;
    for (let m = p.mb + 1; suggest && m <= 12 && mb == null; m++) {
      const r = compute({ ...p, mb: m }, false);
      if (r.ok && r.stair.gInMin >= CONFORT.gIn.min) mb = m;
    }
    N.push([
      st.gIn,
      `Giron côté jour de ${fmt(gInMin)} mm seulement : augmentez le nombre de marches balancées${mb ? ` (${mb} suffisent)` : ""}.`,
      mb ? { set: { mb }, label: `Passer à ${mb}` } : undefined,
    ]);
  }
  bals.forEach((z, i) => {
    if (z.extended)
      N.push([
        "warn",
        `Balancement étendu à ${z.m} marches pour couvrir tout le ${tours > 1 ? `${i ? "second" : "premier"} ` : ""}tournant.`,
      ]);
  });
  const prMin = bals.reduce<Balance | null>((m, z) => (!m || z.pr < m.pr ? z : m), null);
  if (prMin && prMin.pr + 0.01 < prMin.want)
    N.push(["warn", `Progressivité limitée à ${fmt(prMin.pr * 100)} % pour garder au moins 100 mm au jour.`]);
  if (p.rn > p.et / 2 + 0.01)
    N.push(["info", `Rayon du nez ramené à ${fmt(rn, 1)} mm, la moitié de l'épaisseur de marche (demi-rond).`]);
  if (p.cm && rn > p.deb)
    N.push([
      "warn",
      `Le rayon du nez (${fmt(rn)} mm) dépasse le débord (${fmt(p.deb)} mm) : l'arrondi du dessous mord sur la contremarche.`,
    ]);
  if (hl < needM - 0.5)
    N.push([
      "warn",
      `Limon${quart ? " de mur" : ""} trop étroit : ${fmt(hl)} mm pour des marches de ${fmt(h)} mm, prévoyez au moins ${fmt(ceil10(needM))} mm pour garder ${BOIS_SOUS_LOGEMENT} mm de bois sous les logements.`,
      { set: { hl: ceil10(needM) }, label: `Passer à ${fmt(ceil10(needM))} mm` },
    ]);
  if (quart && hlj < needJ - 0.5)
    N.push([
      "warn",
      `Limon de jour trop étroit : ${fmt(hlj)} mm, les logements du tournant demandent au moins ${fmt(hljAuto)} mm.`,
      { set: { hljAuto: true }, label: `Passer à ${fmt(hljAuto)} mm` },
    ]);
  if (ech && st.ech !== "ok") {
    const fixes = U
      ? [
          tYmin != null && `allongez la trémie côté arrivée à ${fmt(tYmin)} mm`,
          tXmin != null && `${tYmin != null ? "élargissez-la" : "élargissez la trémie"} côté fond à ${fmt(tXmin)} mm`,
        ]
          .filter(Boolean)
          .join(" ou ")
      : quart
        ? [
            tYmin != null && `élargissez la trémie côté départ à ${fmt(tYmin)} mm`,
            tXmin != null && `${tYmin != null ? "allongez-la" : "allongez la trémie"} côté arrivée à ${fmt(tXmin)} mm`,
          ]
            .filter(Boolean)
            .join(" ou ")
        : tLmin != null
          ? `allongez la trémie à ${fmt(tLmin)} mm`
          : "";
    const set: Partial<Params> | null = quart
      ? tYmin != null
        ? { tY: tYmin }
        : tXmin != null
          ? { tX: tXmin }
          : null
      : tLmin != null
        ? { tL: tLmin }
        : null;
    // Côté le plus bas, et la ligne de foulée pour comparer quand ce n'est pas elle.
    const where = echWhere(ech, echCotes),
      fw = echCotes.foulee;
    const walk = fw && Math.abs(fw.c - ech.c) >= 0.5 ? ` (${fmt(fw.c)} mm sur la ligne de foulée)` : "";
    N.push([
      st.ech,
      `Échappée de ${fmt(ech.c)} mm${where ? ` ${where}` : ""}, au-dessus de la marche ${ech.j}${walk}${fixes ? ` : pour 2 000 mm, ${fixes}` : ""}.`,
      set ? { set, label: `Passer à ${fmt(Object.values(set)[0] as number)} mm` } : undefined,
    ]);
  } else if (p.tAuto) {
    N.push([
      "info",
      U
        ? `Trémie${treL ? " en U" : ""} à prévoir pour 2 000 mm d'échappée : ${fmt(treDims.tY)} mm côté arrivée, sur toute la largeur (${fmt(treDims.tX)} mm)${treL ? `, branches de ${fmt(treDims.tbD)} mm` : ""}.`
        : quart
          ? `Trémie${treL ? " en L" : ""} à prévoir pour 2 000 mm d'échappée : ${fmt(treDims.tY)} mm côté départ, sur tout le côté arrivée (${fmt(treDims.tX)} mm)${treL ? `, branches de ${fmt(treDims.tbD)} mm` : ""}.`
          : `Trémie à prévoir pour 2 000 mm d'échappée : ${fmt(treDims.tL)} mm de long.`,
    ]);
  } else if (quart ? tYmin != null : tLmin != null) {
    N.push([
      "info",
      U
        ? `Trémie minimale pour 2 000 mm d'échappée : ${fmt(tYmin!)} mm côté arrivée, avec ${fmt(p.tX)} mm côté fond.`
        : quart
          ? `Trémie minimale pour 2 000 mm d'échappée : ${fmt(tYmin!)} mm côté départ, avec ${fmt(p.tX)} mm côté arrivée.`
          : `Trémie minimale pour 2 000 mm d'échappée : ${fmt(tLmin!)} mm de long.`,
    ]);
  }
  if (rail) {
    const what =
      rail.type === "balustres"
        ? `${rail.posts.length} balustres`
        : `${rail.posts.length} montants et ${rail.rails.length} lisses`;
    N.push([
      "info",
      `Garde-corps${quart ? "" : " côté limon droit"} : main courante de ${fmt(rail.hMin)} à ${fmt(rail.hMax)} mm au-dessus des nez, ${what}, écart libre de ${fmt(rail.gap)} mm au plus.`,
    ]);
    if (rail.railLow < 0)
      N.push([
        "warn",
        "La lisse basse touche le limon là où il monte plus vite que la main courante (tournant) : préférez des balustres.",
        { set: { gc: "balustres" }, label: "Passer aux balustres" },
      ]);
  }
  if (!p.nAuto && n !== nAuto && !N.some((x) => x[2]?.set.nAuto))
    N.push([
      "info",
      `Le calcul automatique proposerait ${nAuto} hauteurs.`,
      { set: { nAuto: true }, label: "Revenir en automatique" },
    ]);
  if (!N.some((x) => x[0] === "warn" || x[0] === "bad"))
    N.unshift(["ok", "Escalier confortable : tout est dans les règles."]);

  return {
    ok: true,
    stair: {
      params: p,
      notes: N,
      quart,
      tours,
      n,
      nAuto,
      h,
      g,
      f,
      fAuto,
      Lw,
      T1,
      T2,
      W,
      A,
      B,
      C,
      L,
      H,
      inner,
      outer,
      walkAt,
      lines,
      treads,
      risers,
      stringers,
      rn,
      hl,
      hlj,
      hljAuto,
      needJ,
      needM,
      newels,
      rail,
      mp,
      slab,
      trePoly,
      tre,
      treL,
      tAuto: p.tAuto,
      treDims,
      ceil,
      ech,
      echCotes,
      tLmin,
      tXmin,
      tYmin,
      bal,
      bals,
      blondel,
      pente,
      gInMin,
      st,
    },
  };
}

/** Longueurs côté départ et côté arrivée qui laissent k marches droites avant le tour, à A + B constant :
    la ligne de foulée garde sa longueur, donc le même confort. null si le tour ne peut pas commencer là. */
export function turnLengths(p: Params, k: number): { A: number; B: number } | null {
  const r = compute(p, false);
  if (!r.ok || !r.stair.bal) return null;
  const R = r.stair,
    S = p.A + p.B;
  if (r.stair.bal.a === k) return { A: p.A, B: p.B };
  // Le balancement est centré sur le tournant : on déplace l'angle pour que sa première marche tombe en k.
  const m0 = clamp(Math.round(p.mb), 2, R.n - 1);
  const A0 = p.A + (k + m0 / 2) * R.g - (R.T1 + R.T2) / 2;
  const lo = p.W + p.ps + 100,
    hi = S - lo;
  // Au plus près, par pas de 10 mm : l'extension du balancement peut décaler la première marche.
  for (let d = 0; d <= R.g; d += 10)
    for (const v of d ? [A0 - d, A0 + d] : [A0]) {
      const A = Math.round(v / 10) * 10;
      if (A < lo || A > hi) continue;
      const t = compute({ ...p, A, B: S - A }, false);
      if (t.ok && t.stair.bal?.a === k) return { A, B: S - A };
    }
  return null;
}

/** Nombres de marches droites avant le tour possibles à A + B constant. */
export function turnRange(p: Params): { min: number; max: number } | null {
  const r = compute(p, false);
  if (!r.ok || !r.stair.bal) return null;
  let min = r.stair.bal.a,
    max = min;
  while (min > 0 && turnLengths(p, min - 1)) min--;
  while (max < r.stair.n - 2 && turnLengths(p, max + 1)) max++;
  return { min, max };
}
