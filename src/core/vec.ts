/** Point ou vecteur du plan, en millimètres. */
export type Pt = [number, number];

/** Sommet de contour ; la troisième valeur, si présente, est le bulge DXF de l'arc vers le sommet suivant. */
export type Vertex = [number, number, number?];

export const V = {
  add: (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]],
  sub: (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]],
  mul: (a: Pt, k: number): Pt => [a[0] * k, a[1] * k],
  len: (a: Pt): number => Math.hypot(a[0], a[1]),
  norm: (a: Pt): Pt => {
    const l = Math.hypot(a[0], a[1]);
    return [a[0] / l, a[1] / l];
  },
  cross: (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0],
  dot: (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1],
};

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Interpolation linéaire par morceaux, constante hors des bornes. `xs` est croissant. */
export function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]!) return ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (x - xs[i - 1]!)) / (xs[i]! - xs[i - 1]! || 1);
  }
  return ys[ys.length - 1]!;
}

/** Retire les points consécutifs confondus (à 0,05 mm près). */
export function dedupe(arr: readonly Pt[]): Pt[] {
  return arr.filter((q, i) => i === 0 || Math.hypot(q[0] - arr[i - 1]![0], q[1] - arr[i - 1]![1]) > 0.05);
}

/** Contour fermé sans doublons ni point final répétant le premier. */
export function closeRing(pts: readonly Pt[]): Pt[] {
  const d = dedupe(pts);
  if (d.length > 2 && Math.hypot(d[0]![0] - d[d.length - 1]![0], d[0]![1] - d[d.length - 1]![1]) < 0.05) d.pop();
  return d;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function bbox(pts: readonly Vertex[]): Box {
  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
