import { V, type Pt } from "./vec";

/** Hauteur libre la plus faible sous le plancher, et où elle se trouve. */
export interface Headroom {
  /** Hauteur libre. */
  c: number;
  pt: Pt;
  z: number;
  /** Marche concernée. */
  j: number;
}

/** Morceau de la ligne des nez : de a à b en plan, de za à zb en hauteur (linéaire), au-dessus de la marche j. */
export interface NoseSeg {
  a: Pt;
  b: Pt;
  za: number;
  zb: number;
  j: number;
}

const EPS = 1e-6;

/** Point à l'intérieur du contour ou sur son bord (à EPS près). */
export function inPolygon(pt: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
    const a = poly[k]!,
      b = poly[i]!,
      e = V.sub(b, a),
      l = V.len(e);
    if (l > EPS) {
      const u = V.dot(V.sub(pt, a), e) / (l * l);
      if (u >= -EPS && u <= 1 + EPS && Math.abs(V.cross(e, V.sub(pt, a))) / l <= EPS) return true;
    }
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < a[0] + ((pt[1] - a[1]) * e[0]) / e[1]) inside = !inside;
  }
  return inside;
}

/** Échappée la plus faible le long des morceaux, sous un plafond à la hauteur ceil percé de la trémie
    (contour quelconque, en plan). Le bord de la trémie compte comme ouvert : la hauteur y est celle de
    l'arête du plancher. Exact : la hauteur des nez étant linéaire sur chaque morceau, le pire point est un
    bout de morceau ou un croisement avec le bord. null si tout passe sous la trémie. */
export function headroomUnder(segs: readonly NoseSeg[], opening: readonly Pt[], ceil: number): Headroom | null {
  let best: Headroom | null = null;
  for (const s of segs) {
    const d = V.sub(s.b, s.a);
    // Abscisses des croisements avec le bord : le morceau y passe de dedans à dehors.
    const ts = [0, 1];
    for (let i = 0, k = opening.length - 1; i < opening.length; k = i++) {
      const A = opening[k]!,
        e = V.sub(opening[i]!, A),
        den = V.cross(d, e);
      if (Math.abs(den) < 1e-12) continue;
      const ap = V.sub(A, s.a),
        t = V.cross(ap, e) / den,
        u = V.cross(ap, d) / den;
      if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    const at = (t: number): Pt => V.add(s.a, V.mul(d, t));
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i]!,
        t1 = ts[i + 1]!;
      if (inPolygon(at((t0 + t1) / 2), opening)) continue;
      // Tronçon sous le plancher : le pire point est son bout le plus haut.
      for (const t of [t0, t1]) {
        const z = s.za + (s.zb - s.za) * t,
          c = ceil - z;
        if (!best || c < best.c - EPS) best = { c, pt: at(t), z, j: s.j };
      }
    }
  }
  return best;
}
