/* Étape 1 du calcul : volées et ligne de foulée.
   Côtés du jour (inner) et du mur (outer) en plan, tronçons droits et quarts de cercle de la ligne de foulée. */
import { TOURS, isDemi, jourUnPoteau, type Params } from "./params";
import { makePoly, type Poly } from "./poly";
import { V, clamp, type Pt } from "./vec";

/** Ligne de foulée automatique du quart tournant : au plus à cette distance du jour. */
export const FOULEE_MAX = 500;

export interface Flights {
  tours: number;
  quart: boolean;
  demi: boolean;
  /** Côté fond (double quart, demi-tournant ; déduit du jour en demi-tournant). */
  C: number;
  /** Jour étroit du demi-tournant : un seul poteau de la largeur du jour. */
  single: boolean;
  fAuto: number;
  /** Distance de la ligne de foulée au jour. */
  f: number;
  inner: Poly;
  outer: Poly;
  /** Longueur de chaque côté du jour (tronçon droit de la ligne de foulée). */
  len: number[];
  /** Direction de chaque côté du jour, dans le sens de la montée. */
  dirs: Pt[];
  /** Abscisse de chaque angle du jour sur le côté du jour (0 au départ). */
  sIn: number[];
  /** Abscisses de la ligne de foulée au début (tA) et à la fin (tB) de chaque arc. */
  tA: number[];
  tB: number[];
  T1: number;
  T2: number;
  /** Longueur de la ligne de foulée. */
  Lw: number;
  walkAt: (t: number) => Pt;
  walkTan: (t: number) => Pt;
  /** Abscisse sur le côté du jour du nez en t, avant balancement : perpendiculaire en partie droite. */
  sPerp: (t: number) => number;
}

export function flights(p: Params): Flights {
  const tours = TOURS[p.forme],
    quart = tours > 0;
  const { W, A, B, L } = p;
  // Demi-tournant : côté fond déduit du jour ; jour étroit, un seul poteau de la largeur du jour.
  const demi = isDemi(p.forme),
    C = demi ? 2 * W + p.J : p.C,
    single = demi && p.J < jourUnPoteau(p);
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
  const sPerp = (t: number) => {
    let i = 0;
    while (i < tours && t >= tB[i]!) i++;
    if (i < tours && t > tA[i]!) return sIn[i + 1]!;
    return i ? sIn[i]! + (t - tB[i - 1]!) : t;
  };
  return {
    tours,
    quart,
    demi,
    C,
    single,
    fAuto,
    f,
    inner,
    outer,
    len,
    dirs,
    sIn,
    tA,
    tB,
    T1,
    T2,
    Lw,
    walkAt,
    walkTan,
    sPerp,
  };
}
