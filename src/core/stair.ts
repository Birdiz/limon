/* Calcul de l'escalier.
   Repère plan (mm) : départ en y = 0, montée vers +y, limon extérieur en x = 0, jour (intérieur) en x = W.
   Quart tournant calculé à droite (2e volée vers +x) ; la version gauche est un miroir. */
import { fmt, ceil10 } from "./format";
import type { NumericKey, Params } from "./params";
import { cncFrame, stringerPockets } from "./pockets";
import { makePoly, polyAt, polyCut, polyPath, type Poly } from "./poly";
import { GC, railing, type Railing } from "./railing";
import { V, clamp, interp, type Pt, type Vertex } from "./vec";

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
  /** Tenon dans le poteau (limons de jour du quart tournant). */
  tenon: Tenon | null;
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

/** Poteau du quart tournant, du sol à h, affleurant les faces des limons de jour côté marches. */
export interface Newel {
  c: Pt;
  size: number;
  h: number;
  /** Les quatre faces dans l'ordre du tour, en commençant par la face côté marches de la volée de départ. */
  faces: NewelFace[];
}

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Point le plus bas sous le plancher. */
export interface Headroom {
  /** Hauteur libre. */
  c: number;
  pt: Pt;
  z: number;
  /** Marche concernée. */
  j: number;
}

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
  quart: boolean;
  n: number;
  nAuto: number;
  h: number;
  g: number;
  f: number;
  fAuto: number;
  /** Longueur de la ligne de foulée. */
  Lw: number;
  T1: number;
  T2: number;
  W: number;
  A: number;
  B: number;
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
  newel: Newel | null;
  /** Garde-corps côté jour ; null sans garde-corps. */
  rail: Railing | null;
  slab: Rect;
  tre: Rect;
  /** Trémie calculée plutôt que saisie. */
  tAuto: boolean;
  /** Cotes de la trémie retenue, saisies ou calculées. */
  treDims: { tL: number; tX: number; tY: number };
  /** Hauteur de la sous-face du plancher. */
  ceil: number;
  ech: Headroom | null;
  tLmin: number | null;
  tXmin: number | null;
  tYmin: number | null;
  bal: Balance | null;
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
/** Hauteur du bord haut des limons au-dessus de la ligne des nez. */
export const LIFT = 50;
/** Assemblage des limons de jour dans le poteau : longueur de tenon visée, épaulements haut et bas,
    fond de mortaise au-delà du tenon. Tête du poteau au-dessus du limon le plus haut. */
export const TENON = { long: 40, epaul: 30, fond: 2, tete: 100 } as const;
/** Diamètre des perçages de l'about des limons de mur. */
export const PERCAGE = 10;

/** Statuts de confort d'une hauteur de marche h et d'un giron g. */
export function comfortStatus(h: number, g: number): Pick<Stair["st"], "h" | "g" | "bl" | "pente"> {
  const blondel = 2 * h + g,
    pente = (Math.atan2(h, g) * 180) / Math.PI;
  return {
    h: h > 200 ? "bad" : h > 185 || h < 155 ? "warn" : "ok",
    g: g < 210 ? "bad" : g < 240 || g > 320 ? "warn" : "ok",
    bl: blondel < 580 || blondel > 660 ? "bad" : blondel < 600 || blondel > 640 ? "warn" : "ok",
    pente: pente > 45 ? "bad" : pente > 38 ? "warn" : "ok",
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
      Math.abs(bl - 630) +
      6 * Math.max(0, h - 190) +
      6 * Math.max(0, 155 - h) +
      3 * Math.max(0, 230 - g) +
      3 * Math.max(0, g - 320);
    if (!best || score < best.score) best = { n, score };
  }
  return best ? best.n : Math.max(3, Math.round(H / 175));
}

function validate(p: Params, quart: boolean): InputError[] {
  const errors: InputError[] = [];
  const err = (key: NumericKey, message: string) => errors.push({ key, message });
  const { H, W } = p;
  if (!(H >= 300)) err("H", "La hauteur à monter doit faire au moins 300 mm.");
  if (!(W >= 400)) err("W", "L'emmarchement doit faire au moins 400 mm.");
  if (quart) {
    if (!(p.A > W + 1)) err("A", "La longueur côté départ doit dépasser l'emmarchement.");
    if (!(p.B > W + 1)) err("B", "La longueur côté arrivée doit dépasser l'emmarchement.");
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

/** Calcule l'escalier ; suggest ajoute aux notes les corrections chiffrées (calculs supplémentaires). */
export function compute(p: Params, suggest = true): ComputeResult {
  const quart = p.forme !== "droit";
  const errors = validate(p, quart);
  if (errors.length) return { ok: false, errors };

  const { H, W, A, B, L } = p;
  const fAuto = quart ? (W <= 1000 ? W / 2 : 500) : W / 2;
  const f = p.fAuto ? fAuto : clamp(p.f, 100, W - 100);
  const inner = makePoly(
    quart
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
    quart
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
  const T1 = quart ? A - W : L,
    T2 = quart ? T1 + (Math.PI / 2) * f : L;
  const Lw = quart ? T2 + (B - W) : L;
  const walkAt = (t: number): Pt => {
    if (!quart || t <= T1) return [W - f, t];
    if (t >= T2) return [W + (t - T2), A - W + f];
    const th = (t - T1) / f;
    return [W - f * Math.cos(th), A - W + f * Math.sin(th)];
  };
  const walkTan = (t: number): Pt => {
    if (!quart || t <= T1) return [0, 1];
    if (t >= T2) return [1, 0];
    const th = (t - T1) / f;
    return [Math.sin(th), Math.cos(th)];
  };

  const nAuto = pickN(H, Lw);
  const n = p.nAuto ? nAuto : clamp(Math.round(p.n), 3, 40);
  const h = H / n,
    g = Lw / (n - 1);

  // Position de chaque nez sur le limon du jour : perpendiculaire en partie droite, puis balancement.
  const sPerp = (t: number) => (!quart || t <= T1 ? t : t >= T2 ? T1 + (t - T2) : T1);
  const s = Array.from({ length: n }, (_, k) => sPerp(k * g));
  let bal: Balance | null = null;
  if (quart) {
    const m0 = clamp(Math.round(p.mb), 2, n - 1);
    let a = Math.round((T1 + T2) / 2 / g - m0 / 2),
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
    while (a > 0 && a * g > T1 + 1e-6) {
      a--;
      extended = true;
    }
    while (b < n - 1 && b * g < T2 - 1e-6) {
      b++;
      extended = true;
    }
    const m = b - a,
      S = s[b]! - s[a]!,
      base = S / m,
      amp = g - base;
    const c = (i: number) => (m >= 2 ? Math.cos((2 * Math.PI * (i + 0.5)) / m) : 0);
    let pr = clamp(p.prog / 100, 0, 1);
    const want = pr;
    const minW = 100;
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
    bal = { a, b, m, extended, pr, want };
  }

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
  type Edge = { sIn: number; sOut: number };
  const region = (fr: Edge, bk: Edge) => [...polyPath(inner, fr.sIn, bk.sIn), ...polyPath(outer, bk.sOut, fr.sOut)];

  const bo = p.deb + (p.cm ? p.ecm : 0);
  // Nez arrondi : bande de largeur rn derrière la ligne de nez, dessinée à part en 3D.
  const rn = clamp(p.rn, 0, p.et / 2);
  const noseSpan = (ln: NoseLine) => {
    const d2: Pt = [ln.nr[1], -ln.nr[0]],
      c = cutOff(ln, rn);
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
      balanced: !!bal && j > bal.a && j <= bal.b,
    });
  }
  const risers: Riser[] = [];
  if (p.cm)
    for (let j = 1; j <= n; j++) {
      const ln = lines[j - 1]!;
      risers.push({ z0: (j - 1) * h, z1: j * h - p.et, plan: region(cutOff(ln, p.deb), cutOff(ln, p.deb + p.ecm)) });
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
  // Poteau affleurant les faces côté marches, au coin du jour : les limons de jour s'arrêtent sur ses faces.
  const ps = p.ps,
    sK = A - W;
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
      const hi = i === N - 2 ? Math.max(s1, arr[arr.length - 1]!) : s1 - post;
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
  // Faces du poteau côté marches, traitées comme des bouts de limon pour y loger marches et contremarches.
  const newelTop = quart ? ceil10(Math.max(zIn(sK - ps), zIn(sK + ps)) + TENON.tete) : 0;
  const face = (a: Pt, dir: Pt, u0: number, sLo: number): StringerGeom => ({
    origin: a,
    dir,
    rn: [dir[1], -dir[0]],
    prof: [
      [u0, newelTop],
      [u0 + ps, newelTop],
    ],
    width: ps,
    side: "in",
    idx: 0,
    count: 1,
    a,
    sLo,
    sHi: sLo + ps,
  });
  const postFaces = quart ? [face([W, 0], [0, 1], sK - ps, sK - ps), face([W, sK], [1, 0], 0, sK)] : [];
  // Logements de chaque limon et hauteur qui garde 20 mm de bois sous le plus bas.
  // Le limon de jour du quart tournant a sa propre hauteur, proposée d'après ses logements.
  const geo = { inner, outer, lines, treads, risers, stringers: [...geoms, ...postFaces] };
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
  const tenonOf = (sp: StringerGeom, hs: number): Tenon => {
    const sh = sp.idx === 0 ? sp.prof[sp.prof.length - 1]![0] : sp.prof[0]![0],
      far = sp.idx === 0 ? sh + tl : sh - tl;
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
  // About des limons de mur : le tronçon 1 dépasse de son épaisseur et reçoit le bout du 2, vissé ou boulonné.
  // Perçages au milieu du bois laissé derrière les logements, pour rester loin de ceux de la marche d'angle.
  const holesOf = (sp: StringerGeom): Pt[] => {
    if (!quart || sp.side !== "out" || sp.idx !== 0) return [];
    const zt = zOut(outer.cum[1]!),
      zb = Math.max(0, zt - hl),
      u = outer.cum[1]! - outer.cum[0]! + (p.enc + jeu + el) / 2;
    return [
      [u, zb + (zt - zb) / 3],
      [u, zb + ((zt - zb) * 2) / 3],
    ];
  };
  const stringers: StringerPiece[] = withPockets.map((sp) => {
    const hs = isJour(sp) ? hlj : hl;
    return { ...sp, hl: hs, tenon: isJour(sp) ? tenonOf(sp, hs) : null, holes: holesOf(sp) };
  });
  // Poteau : faces dans l'ordre du tour (vu de dessus, sens trigonométrique pour le quart droit).
  const mortise = (idx: number) => {
    const t = stringers.find((sp) => isJour(sp) && sp.idx === idx)!.tenon!;
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
  });
  const mcMortise = (idx: number) => {
    const hr = rail?.handrails.find((r) => r.idx === idx);
    const t = hr?.tenon;
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
  const mcTop = Math.max(
    0,
    ...(rail?.handrails.filter((r) => r.tenon).map((r) => r.z0 + r.b * (r.idx === 0 ? r.u1 : r.u0)) ?? []),
  );
  const newel: Newel | null = quart
    ? {
        c: [W + ps / 2, sK - ps / 2],
        size: ps,
        h: rail ? Math.max(newelTop, ceil10(mcTop + GC.tete)) : newelTop,
        faces: [
          { n: [-1, 0], o: [W, 0], dir: [0, 1], u0: sK - ps, u1: sK, pockets: pk[geoms.length]!.pockets, mortises: [] },
          {
            n: [0, -1],
            o: [W, sK - ps],
            dir: [1, 0],
            u0: 0,
            u1: ps,
            pockets: [],
            mortises: [mortise(0), ...mcMortise(0)],
          },
          {
            n: [1, 0],
            o: [W + ps, sK],
            dir: [0, -1],
            u0: 0,
            u1: ps,
            pockets: [],
            mortises: [mortise(1), ...mcMortise(1)],
          },
          { n: [0, 1], o: [W, sK], dir: [1, 0], u0: 0, u1: ps, pockets: pk[geoms.length + 1]!.pockets, mortises: [] },
        ],
      }
    : null;
  // Plancher haut et trémie (rectangle adossé au bord du palier ; en quart tournant, aussi au mur face à la montée).
  const slab: Rect = quart
    ? { x0: -el - 300, x1: B + 900, y0: -400, y1: A + el + 300 }
    : { x0: -el - 300, x1: W + el + 300, y0: -400, y1: L + 900 };
  const treOf = (tL: number, tX: number, tY: number): Rect =>
    quart
      ? { x0: Math.max(-el, B - tX), x1: B, y0: Math.max(-300, A + el - tY), y1: A + el }
      : { x0: -el, x1: W + el, y0: Math.max(-300, L - tL), y1: L };
  // Échappée : distance verticale entre la ligne des nez et la sous-face du plancher, sur toute la largeur.
  const ceil = H - p.ep;
  const headroom = (t: Rect): Headroom | null => {
    let best: Headroom | null = null;
    for (let k = 0; k < n - 1; k++) {
      const L0 = lines[k]!,
        L1 = lines[k + 1]!;
      for (let a = 0; a <= 8; a++) {
        const p0 = V.add(L0.Q, V.mul(V.sub(L0.O, L0.Q), a / 8)),
          p1 = V.add(L1.Q, V.mul(V.sub(L1.O, L1.Q), a / 8));
        for (let b = 0; b <= 24; b++) {
          const pt = V.add(p0, V.mul(V.sub(p1, p0), b / 24));
          if (pt[0] >= t.x0 - 1e-6 && pt[0] <= t.x1 + 1e-6 && pt[1] >= t.y0 - 1e-6 && pt[1] <= t.y1 + 1e-6) continue;
          const z = (k + 1) * h + (b / 24) * h,
            c = ceil - z;
          if (!best || c < best.c) best = { c, pt, z, j: k + 1 };
        }
      }
    }
    return best;
  };
  const echOk = (t: Rect) => {
    const r = headroom(t);
    return !r || r.c >= ECHAPPEE;
  };
  // Plus petite ouverture (au cm) qui donne l'échappée visée, par dichotomie.
  const minOpening = (make: (v: number) => Rect, max: number) => {
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
  // Trémie à calculer : la plus courte qui suffit ; en quart tournant, sur tout le côté arrivée.
  const treDims = { tL: p.tL, tX: p.tX, tY: p.tY };
  if (p.tAuto) {
    if (quart) {
      treDims.tX = B + el;
      treDims.tY = minOpening((v) => treOf(0, treDims.tX, v), A + el + 300) ?? A + el + 300;
    } else treDims.tL = minOpening((v) => treOf(v, 0, 0), L + 300) ?? L + 300;
  }
  const tre = treOf(treDims.tL, treDims.tX, treDims.tY);
  const ech = headroom(tre);
  const tLmin = quart ? null : minOpening((v) => ({ ...tre, y0: Math.max(-300, L - v) }), L + 300);
  const tYmin = quart ? minOpening((v) => ({ ...tre, y0: Math.max(-300, A + el - v) }), A + el + 300) : null;
  const tXmin = quart ? minOpening((v) => ({ ...tre, x0: Math.max(-el, B - v) }), B + el) : null;

  // Contrôles
  const gInMin = Math.min(...treads.map((t) => t.gIn));
  const blondel = 2 * h + g;
  const pente = (Math.atan2(h, g) * 180) / Math.PI;
  const st: Stair["st"] = {
    ...comfortStatus(h, g),
    gIn: gInMin < 60 ? "bad" : gInMin < 100 ? "warn" : "ok",
    ech: !ech ? "ok" : ech.c < 1900 ? "bad" : ech.c < ECHAPPEE ? "warn" : "ok",
  };
  const N: Note[] = [];
  if (st.h !== "ok")
    N.push([
      st.h,
      h > 185
        ? `Marches hautes (${fmt(h, 1)} mm) : ajoutez une hauteur ou allongez le reculement.`
        : `Marches basses (${fmt(h, 1)} mm) : retirez une hauteur.`,
    ]);
  if (st.g !== "ok")
    N.push([
      st.g,
      g < 240
        ? `Giron court (${fmt(g)} mm) sur la ligne de foulée : il manque de la longueur au sol.`
        : `Giron long (${fmt(g)} mm) : ajoutez une hauteur pour un pas plus naturel.`,
    ]);
  if (st.bl !== "ok") N.push([st.bl, `Loi de Blondel hors plage : 2h + g = ${fmt(blondel)} mm, visez 600 à 640 mm.`]);
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
      if (r.ok && r.stair.gInMin >= 100) mb = m;
    }
    N.push([
      st.gIn,
      `Giron côté jour de ${fmt(gInMin)} mm seulement : augmentez le nombre de marches balancées${mb ? ` (${mb} suffisent)` : ""}.`,
      mb ? { set: { mb }, label: `Passer à ${mb}` } : undefined,
    ]);
  }
  if (bal && bal.extended) N.push(["warn", `Balancement étendu à ${bal.m} marches pour couvrir tout le tournant.`]);
  if (bal && bal.pr + 0.01 < bal.want)
    N.push(["warn", `Progressivité limitée à ${fmt(bal.pr * 100)} % pour garder au moins 100 mm au jour.`]);
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
      `Limon${quart ? " de mur" : ""} trop étroit : ${fmt(hl)} mm pour des marches de ${fmt(h)} mm, prévoyez au moins ${fmt(ceil10(needM))} mm pour garder 20 mm de bois sous les logements.`,
      { set: { hl: ceil10(needM) }, label: `Passer à ${fmt(ceil10(needM))} mm` },
    ]);
  if (quart && hlj < needJ - 0.5)
    N.push([
      "warn",
      `Limon de jour trop étroit : ${fmt(hlj)} mm, les logements du tournant demandent au moins ${fmt(hljAuto)} mm.`,
      { set: { hljAuto: true }, label: `Passer à ${fmt(hljAuto)} mm` },
    ]);
  if (ech && st.ech !== "ok") {
    const fixes = quart
      ? [
          tYmin != null && `élargissez la trémie côté départ à ${fmt(tYmin)} mm`,
          tXmin != null && `allongez-la côté arrivée à ${fmt(tXmin)} mm`,
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
    N.push([
      st.ech,
      `Échappée de ${fmt(ech.c)} mm au-dessus de la marche ${ech.j}${fixes ? ` : pour 2 000 mm, ${fixes}` : ""}.`,
      set ? { set, label: `Passer à ${fmt(Object.values(set)[0] as number)} mm` } : undefined,
    ]);
  } else if (p.tAuto) {
    N.push([
      "info",
      quart
        ? `Trémie à prévoir pour 2 000 mm d'échappée : ${fmt(treDims.tY)} mm côté départ, sur tout le côté arrivée (${fmt(treDims.tX)} mm).`
        : `Trémie à prévoir pour 2 000 mm d'échappée : ${fmt(treDims.tL)} mm de long.`,
    ]);
  } else if (quart ? tYmin != null : tLmin != null) {
    N.push([
      "info",
      quart
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
      newel,
      rail,
      slab,
      tre,
      tAuto: p.tAuto,
      treDims,
      ceil,
      ech,
      tLmin,
      tXmin,
      tYmin,
      bal,
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
