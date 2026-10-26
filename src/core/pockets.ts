/* Logements des limons : calculés avec l'escalier, pour proposer la hauteur de chaque limon,
   puis repris tels quels par l'export CNC. */
import type { Params } from "./params";
import { offsetPoly, polyCut, type Cut, type Poly } from "./poly";
import type { NoseLine, Riser, StringerGeom, Tread } from "./stair";
import { V, clamp, interp, type Pt, type Vertex } from "./vec";

/** Points d'une ligne de marche décalée : sur les faces des limons (F) et au fond des logements (D). */
export interface Section {
  inF: Cut;
  inD: Cut;
  outF: Cut;
  outD: Cut;
}

export interface Frame {
  /** Fonds des logements côté jour et côté mur. */
  inOff: Poly;
  outOff: Poly;
  at: (ln: NoseLine, off: number) => Section;
  riserBand: (ln: NoseLine) => { a: Section; b: Section; quad: Pt[] };
}

export interface StairGeom {
  inner: Poly;
  outer: Poly;
  lines: NoseLine[];
  treads: Tread[];
  risers: Riser[];
  stringers: StringerGeom[];
}

export function cncFrame(R: Pick<StairGeom, "inner" | "outer">, p: Params): Frame {
  const inOff = offsetPoly(R.inner, p.enc),
    outOff = offsetPoly(R.outer, -p.enc);
  const at = (ln: NoseLine, off: number): Section => {
    const pt = V.add(ln.Q, V.mul(ln.nr, off));
    const cuts = {
      inF: polyCut(R.inner, pt, ln.dir, "near"),
      inD: polyCut(inOff, pt, ln.dir, "near"),
      outF: polyCut(R.outer, pt, ln.dir, "ahead"),
      outD: polyCut(outOff, pt, ln.dir, "ahead"),
    };
    if (!cuts.inF || !cuts.inD || !cuts.outF || !cuts.outD)
      throw new Error(`Ligne de marche ${ln.k} sans intersection avec les limons`);
    return cuts as Section;
  };
  const riserBand = (ln: NoseLine) => {
    const a = at(ln, p.deb),
      b = at(ln, p.deb + p.ecm);
    return { a, b, quad: [a.inF.p, a.outF.p, b.outF.p, b.inF.p] };
  };
  return { inOff, outOff, at, riserBand };
}

/** Logements d'un limon dans son plan (u le long du limon, z en hauteur), et hauteur nécessaire. */
export interface StringerPockets {
  pockets: Vertex[][];
  /** Hauteur de limon qui garde 20 mm de bois sous le logement le plus bas. */
  need: number;
}

/* Le jeu agrandit chaque logement de chaque côté ; le bout avant d'un logement de marche suit le nez arrondi
   (arc en bulge DXF, troisième coordonnée du sommet). */
export function stringerPockets(R: StairGeom, p: Params, F: Frame): StringerPockets[] {
  const bo = p.deb + (p.cm ? p.ecm : 0),
    jeu = Math.max(0, p.jeu),
    rn = clamp(p.rn, 0, p.et / 2),
    B = Math.tan(Math.PI / 8);
  return R.stringers.map((sp) => {
    const uLo = sp.prof[0]![0],
      uHi = sp.prof[sp.prof.length - 1]![0];
    const proj = (q: Pt) => V.dot(V.sub(q, sp.a), sp.dir);
    const keyF = sp.side === "in" ? "inF" : "outF",
      keyD = sp.side === "in" ? "inD" : "outD";
    const touches = (s1: number, s2: number) => Math.max(s1, s2) > sp.sLo + 0.5 && Math.min(s1, s2) < sp.sHi - 0.5;
    const topAt = (u: number) =>
      interp(
        sp.prof.map((q) => q[0]),
        sp.prof.map((q) => q[1]),
        u,
      );
    const pockets: Vertex[][] = [];
    let need = 0;
    const pocket = (c1: Section, c2: Section, z0: number, z1: number, nose: boolean) => {
      if (!touches(c1[keyF].s, c2[keyF].s)) return;
      const us = [c1[keyF].p, c1[keyD].p, c2[keyF].p, c2[keyD].p].map(proj);
      const a = Math.min(...us),
        b = Math.max(...us);
      const u0 = clamp(a - jeu, uLo, uHi),
        u1 = clamp(b + jeu, uLo, uHi);
      if (!(u1 - u0 > 2 && z1 > z0)) return;
      const lo = z0 > 0.5 ? z0 - jeu : z0,
        hi = z1 + jeu;
      // Le nez est au bout bas du logement, s'il tombe dans cette pièce de limon.
      const r = nose && rn > 0 && a - jeu >= uLo - 1e-6 ? Math.min(rn + jeu, (hi - lo) / 2, u1 - u0) : 0;
      pockets.push(
        r > 0.05
          ? [
              [u1, lo],
              [u1, hi],
              [u0 + r, hi, B],
              ...(hi - lo - 2 * r > 0.01
                ? ([
                    [u0, hi - r],
                    [u0, lo + r, B],
                  ] as Vertex[])
                : ([[u0, hi - r, B]] as Vertex[])),
              [u0 + r, lo],
            ]
          : [
              [u0, lo],
              [u1, lo],
              [u1, hi],
              [u0, hi],
            ],
      );
      if (z0 > 0.5) need = Math.max(need, topAt(u0) - lo + 20, topAt(u1) - lo + 20);
    };
    R.treads.forEach((t) => pocket(F.at(R.lines[t.j - 1]!, 0), F.at(R.lines[t.j]!, bo), t.top - p.et, t.top, true));
    if (p.cm)
      R.risers.forEach((r, i) => {
        const band = F.riserBand(R.lines[i]!);
        pocket(band.a, band.b, r.z0, r.z1, false);
      });
    return { pockets, need };
  });
}
