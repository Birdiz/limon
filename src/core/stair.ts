/* Calcul de l'escalier.
   Repère plan (mm) : départ en y = 0, montée vers +y, limon extérieur en x = 0, jour (intérieur) en x = W.
   Quart tournant calculé à droite (2e volée vers +x) ; la version gauche est un miroir. */
import { fmt, ceil10 } from "./format";
import type { Params } from "./params";
import { cncFrame, stringerPockets } from "./pockets";
import { makePoly, polyAt, polyCut, polyPath, type Poly } from "./poly";
import { V, clamp, interp, type Pt, type Vertex } from "./vec";

export type Status = "ok" | "warn" | "bad";
export type NoteLevel = Status | "info";
export type Note = [NoteLevel, string];

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

export interface StringerPiece extends StringerGeom {
  /** Logements, dans le plan du limon. */
  pockets: Vertex[][];
  /** Hauteur qui garde 20 mm de bois sous le logement le plus bas. */
  need: number;
  /** Hauteur retenue pour cette pièce. */
  hl: number;
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
  newel: { c: Pt; size: number; h: number } | null;
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

export type ComputeResult = { ok: true; stair: Stair } | { ok: false; errors: string[] };

/** Échappée visée. */
export const ECHAPPEE = 2000;
/** Hauteur du bord haut des limons au-dessus de la ligne des nez. */
export const LIFT = 50;

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

function validate(p: Params, quart: boolean): string[] {
  const errors: string[] = [];
  const { H, W } = p;
  if (!(H >= 300)) errors.push("La hauteur à monter doit dépasser 300 mm.");
  if (!(W >= 400)) errors.push("L'emmarchement doit faire au moins 400 mm.");
  if (quart) {
    if (!(p.A > W + 1)) errors.push("La longueur côté départ doit dépasser l'emmarchement.");
    if (!(p.B > W + 1)) errors.push("La longueur côté arrivée doit dépasser l'emmarchement.");
  } else if (!(p.L >= 500)) errors.push("Le reculement doit faire au moins 500 mm.");
  if (!(p.ep >= 0 && p.ep < H - 500))
    errors.push("L'épaisseur du plancher doit rester inférieure à la hauteur à monter moins 500 mm.");
  return errors;
}

export function compute(p: Params): ComputeResult {
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
      return { ok: false, errors: ["Géométrie impossible : une ligne de marche ne rejoint pas le limon extérieur."] };
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
        "Géométrie impossible : des marches se croisent. Augmentez le nombre de marches balancées ou réduisez la progressivité.",
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
  const pieces = (P: Poly, arr: number[], zf: (v: number) => number, isOuter: boolean): StringerGeom[] => {
    const out: StringerGeom[] = [],
      N = P.pts.length;
    for (let i = 0; i < N - 1; i++) {
      const a = P.pts[i]!,
        dir = V.norm(V.sub(P.pts[i + 1]!, a)),
        rn: Pt = [dir[1], -dir[0]];
      const s0 = P.cum[i]!,
        s1 = P.cum[i + 1]!,
        segL = s1 - s0;
      const lo = i === 0 ? Math.min(s0, arr[0]!) : s0;
      const hi = i === N - 2 ? Math.max(s1, arr[arr.length - 1]!) : s1;
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
        sLo: i === 0 ? -Infinity : s0,
        sHi: i === N - 2 ? Infinity : s1,
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
  // Logements de chaque limon et hauteur qui garde 20 mm de bois sous le plus bas.
  // Le limon de jour du quart tournant a sa propre hauteur, proposée d'après ses logements.
  const geo = { inner, outer, lines, treads, risers, stringers: geoms };
  const isJour = (sp: StringerGeom) => quart && sp.side === "in";
  const pk = stringerPockets(geo, p, cncFrame(geo, p));
  const withPockets = geoms.map((sp, i) => ({ ...sp, ...pk[i]! }));
  const needJ = Math.max(0, ...withPockets.filter(isJour).map((sp) => sp.need));
  const needM = Math.max(0, ...withPockets.filter((sp) => !isJour(sp)).map((sp) => sp.need));
  const hljAuto = Math.max(150, ceil10(needJ));
  const hlj = quart ? (p.hljAuto ? hljAuto : p.hlj) : hl;
  const stringers: StringerPiece[] = withPockets.map((sp) => ({ ...sp, hl: isJour(sp) ? hlj : hl }));
  const newelSize = Math.max(90, el * 2);
  const newel = quart ? { c: [W + el / 2, A - W - el / 2] as Pt, size: newelSize, h: zIn(T1) + 120 } : null;
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
    h: h > 200 ? "bad" : h > 185 || h < 155 ? "warn" : "ok",
    g: g < 210 ? "bad" : g < 240 || g > 320 ? "warn" : "ok",
    bl: blondel < 580 || blondel > 660 ? "bad" : blondel < 600 || blondel > 640 ? "warn" : "ok",
    pente: pente > 45 ? "bad" : pente > 38 ? "warn" : "ok",
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
  if (quart && st.gIn !== "ok")
    N.push([st.gIn, `Giron côté jour de ${fmt(gInMin)} mm seulement : augmentez le nombre de marches balancées.`]);
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
    ]);
  if (quart && hlj < needJ - 0.5)
    N.push([
      "warn",
      `Limon de jour trop étroit : ${fmt(hlj)} mm, les logements du tournant demandent au moins ${fmt(hljAuto)} mm.`,
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
    N.push([
      st.ech,
      `Échappée de ${fmt(ech.c)} mm au-dessus de la marche ${ech.j}${fixes ? ` : pour 2 000 mm, ${fixes}` : ""}.`,
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
  if (!p.nAuto && n !== nAuto) N.push(["info", `Le calcul automatique proposerait ${nAuto} hauteurs.`]);
  if (!N.some((x) => x[0] === "warn" || x[0] === "bad"))
    N.unshift(["ok", "Toutes les règles de confort sont respectées."]);

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
