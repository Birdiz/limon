/* Étape 5 du calcul : marches, marche palière et contremarches, entre les lignes de nez. */
import { fmt } from "./format";
import type { Params } from "./params";
import { polyAt, polyCut, polyPath } from "./poly";
import type { Flights } from "./stair-flights";
import type { Heights } from "./stair-noses";
import type { Balance, ComputeFailure, LandingTread, NoseLine, Riser, Tread } from "./stair-types";
import { V, clamp, type Pt } from "./vec";

type Edge = { sIn: number; sOut: number };

/** Découpe du plan entre les lignes de nez : ligne décalée vers le haut de l'escalier, région entre deux lignes,
    bande du nez arrondi. */
interface PlanCuts {
  cutOff: (ln: NoseLine, off: number) => Edge;
  region: (fr: Edge, bk: Edge) => Pt[];
  noseSpan: (ln: NoseLine, r: number) => NonNullable<Tread["nose"]>;
}

function planCuts(fl: Flights): PlanCuts {
  const { inner, outer } = fl;
  const cutOff = (ln: NoseLine, off: number) => {
    const pt = V.add(ln.Q, V.mul(ln.nr, off));
    const a = polyCut(inner, pt, ln.dir, "near"),
      b = polyCut(outer, pt, ln.dir, "ahead");
    return { sIn: a ? a.s : ln.sIn, sOut: b ? b.s : ln.sOut };
  };
  const region = (fr: Edge, bk: Edge) => [...polyPath(inner, fr.sIn, bk.sIn), ...polyPath(outer, bk.sOut, fr.sOut)];
  const noseSpan = (ln: NoseLine, r: number) => {
    const d2: Pt = [ln.nr[1], -ln.nr[0]],
      c = cutOff(ln, r);
    const us = [polyAt(inner, ln.sIn), polyAt(outer, ln.sOut), polyAt(inner, c.sIn), polyAt(outer, c.sOut)].map((q) =>
      V.dot(V.sub(q, ln.Q), d2),
    );
    const u0 = Math.min(...us),
      u1 = Math.max(...us);
    return { o: V.add(ln.Q, V.mul(d2, u0)), len: u1 - u0, nr: ln.nr };
  };
  return { cutOff, region, noseSpan };
}

/** Marche palière : de la ligne de nez d'arrivée ln jusqu'à depth en arrière, nez arrondi de rayon r. */
function landingTread(ln: NoseLine, top: number, e: number, depth: number, r: number, g: PlanCuts): LandingTread {
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

export interface Treads {
  /** Rayon du nez arrondi, borné à la moitié de l'épaisseur des marches. */
  rn: number;
  treads: Tread[];
  risers: Riser[];
  /** Profondeur de la marche palière (0 sans elle). */
  mpD: number;
  mp: LandingTread | null;
}

export function treadsAndRisers(
  p: Params,
  fl: Flights,
  he: Heights,
  bals: readonly Balance[],
  lines: readonly NoseLine[],
): Treads | ComputeFailure {
  const { n, h, g, paliers } = he;
  const cuts = planCuts(fl);
  const { cutOff, region } = cuts;
  const isPalier = (j: number) => paliers.some((q) => q.j === j);
  const bo = p.deb + (p.cm ? p.ecm : 0);
  // Nez arrondi : bande de largeur rn derrière la ligne de nez, dessinée à part en 3D.
  const rn = clamp(p.rn, 0, p.et / 2);
  const treads: Tread[] = [];
  for (let j = 1; j < n; j++) {
    const fr = lines[j - 1]!,
      bk = lines[j]!;
    treads.push({
      j,
      top: j * h,
      plan: region(fr, bk),
      solid: region(rn > 0 ? cutOff(fr, rn) : fr, cutOff(bk, bo)),
      nose: rn > 0 ? cuts.noseSpan(fr, rn) : null,
      gIn: bk.sIn - fr.sIn,
      gOut: bk.sOut - fr.sOut,
      gWalk: isPalier(j) ? bk.t - fr.t : g,
      nez: V.len(V.sub(fr.O, fr.Q)),
      balanced: bals.some((z) => j > z.a && j <= z.b),
      palier: isPalier(j),
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
  const mp = mpD ? landingTread(lines[n - 1]!, n * h, p.mpE, mpD, Math.min(rn, p.mpE / 2), cuts) : null;
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
  return { rn, treads, risers, mpD, mp };
}
