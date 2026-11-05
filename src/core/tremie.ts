/* Plancher haut, trémie et échappée de l'escalier. */
import { ceil10 } from "./format";
import { ECHAPPEE, headroomUnder, type Headroom, type NoseSeg } from "./headroom";
import { TOURS, type Params } from "./params";
import { polyPath, type Poly } from "./poly";
import type { NoseLine, Rect, Stair, TreDims } from "./stair-types";
import { V, bbox, type Pt } from "./vec";

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

/** Ce que la trémie et l'échappée lisent de l'escalier ; mpD : profondeur de la marche palière, 0 sans elle. */
export interface TremieCtx extends Pick<Stair, "C" | "h" | "lines" | "inner" | "outer" | "walkAt" | "rail"> {
  p: Params;
  mpD: number;
}

export type TremieResult = Pick<
  Stair,
  "slab" | "ceil" | "trePoly" | "tre" | "treL" | "treDims" | "ech" | "echCotes" | "tLmin" | "tXmin" | "tYmin"
>;

/** Plancher, trémie retenue (saisie, ou la plus courte qui suffit) et échappée sous son contour. */
export function tremie({ p, C, h, lines, inner, outer, walkAt, rail, mpD }: TremieCtx): TremieResult {
  const { H, W, A, B, L, el, ps } = p,
    tours = TOURS[p.forme],
    quart = tours > 0;
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
  const treAt = (d: Partial<TreDims>) => tremieContour(p, { ...treDims, ...d }, mpD, C);
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
  // Trémie qui suit vraiment l'escalier : un jour trop étroit (demi-tournant) la laisse en rectangle.
  const shaped = trePoly.length > 4;
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
  return { slab, ceil, trePoly, tre, treL: shaped, treDims, ech, echCotes, tLmin, tXmin, tYmin };
}
