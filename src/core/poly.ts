import { V, clamp, type Pt } from "./vec";

/** Polyligne paramétrée par l'abscisse curviligne ; les segments extrêmes se prolongent à l'infini. */
export interface Poly {
  pts: Pt[];
  /** Abscisse curviligne de chaque sommet. */
  cum: number[];
  total: number;
}

/** Intersection d'une droite avec une polyligne. */
export interface Cut {
  /** Distance signée le long de la droite, en valeur absolue. */
  key: number;
  /** Abscisse curviligne sur la polyligne. */
  s: number;
  p: Pt;
  /** Point pris sur le prolongement d'un segment, hors de la polyligne : s est ramené au bout du segment. */
  outside?: true;
}

export function makePoly(pts: Pt[]): Poly {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + V.len(V.sub(pts[i]!, pts[i - 1]!)));
  return { pts, cum, total: cum[cum.length - 1]! };
}

export function polyAt(P: Poly, s: number): Pt {
  const n = P.pts.length;
  let i = 0;
  while (i < n - 2 && s > P.cum[i + 1]!) i++;
  const a = P.pts[i]!,
    b = P.pts[i + 1]!;
  return V.add(a, V.mul(V.sub(b, a), (s - P.cum[i]!) / (P.cum[i + 1]! - P.cum[i]!)));
}

/** Points de la polyligne entre les abscisses s1 et s2, dans le sens de s1 vers s2. */
export function polyPath(P: Poly, s1: number, s2: number): Pt[] {
  const out = [polyAt(P, s1)];
  if (s2 > s1) {
    for (let i = 0; i < P.pts.length; i++) if (P.cum[i]! > s1 + 1e-6 && P.cum[i]! < s2 - 1e-6) out.push(P.pts[i]!);
  } else {
    for (let i = P.pts.length - 1; i >= 0; i--) if (P.cum[i]! < s1 - 1e-6 && P.cum[i]! > s2 + 1e-6) out.push(P.pts[i]!);
  }
  out.push(polyAt(P, s2));
  return out;
}

/** Intersection de la droite (pt, dir) avec la polyligne. 'near' : la plus proche de pt ; 'ahead' : la première devant.
    extend : à défaut, sur le prolongement d'un segment (nez d'une volée qui part du coin du jour, après un palier). */
export function polyCut(P: Poly, pt: Pt, dir: Pt, mode: "near" | "ahead", extend = false): Cut | null {
  let best: Cut | null = null;
  const n = P.pts.length;
  for (let i = 0; i < n - 1; i++) {
    const A = P.pts[i]!,
      e = V.sub(P.pts[i + 1]!, A),
      den = V.cross(dir, e);
    if (Math.abs(den) < 1e-12) continue;
    const ap = V.sub(A, pt),
      lam = V.cross(ap, e) / den,
      u = V.cross(ap, dir) / den;
    const off = (i > 0 && u < -1e-9) || (i < n - 2 && u > 1 + 1e-9);
    if (off && !extend) continue;
    if (mode === "ahead" && lam <= 1e-6) continue;
    if (!best || Math.abs(lam) < best.key)
      best = {
        key: Math.abs(lam),
        s: P.cum[i]! + (off ? clamp(u, 0, 1) : u) * (P.cum[i + 1]! - P.cum[i]!),
        p: V.add(pt, V.mul(dir, lam)),
        ...(off ? { outside: true as const } : {}),
      };
  }
  return best;
}

/** Polyligne décalée de d vers la droite du sens de parcours (sommets aux intersections des segments décalés). */
export function offsetPoly(P: Poly, d: number): Poly {
  const pts = P.pts,
    segs: { a: Pt; dir: Pt }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dir = V.norm(V.sub(pts[i + 1]!, pts[i]!));
    segs.push({ a: V.add(pts[i]!, V.mul([dir[1], -dir[0]], d)), dir });
  }
  const out = [segs[0]!.a];
  for (let i = 1; i < segs.length; i++) {
    const s0 = segs[i - 1]!,
      s1 = segs[i]!,
      den = V.cross(s0.dir, s1.dir);
    if (Math.abs(den) < 1e-9) out.push(s1.a);
    else out.push(V.add(s0.a, V.mul(s0.dir, V.cross(V.sub(s1.a, s0.a), s1.dir) / den)));
  }
  const last = segs[segs.length - 1]!;
  out.push(V.add(pts[pts.length - 1]!, V.mul([last.dir[1], -last.dir[0]], d)));
  return makePoly(out);
}
