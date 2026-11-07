/* Étape 5 du calcul : marches, marche palière et contremarches, entre les lignes de nez. */
import { fmt } from "./format";
import { nezCote } from "./nez";
import { anglaise, arriereMarche, type Params } from "./params";
import { offsetPoly, polyAt, polyCut, polyPath, type Poly } from "./poly";
import type { Flights } from "./stair-flights";
import type { Heights } from "./stair-noses";
import type { Balance, ComputeFailure, LandingTread, NoseLine, Riser, Tread } from "./stair-types";
import { V, clamp, type Pt } from "./vec";

type Edge = { sIn: number; sOut: number };

/** Rainures antidérapantes : au plus RAINURES_MAX, arrêtées à RAINURE_ARRET des limons et de la ligne de nez
    suivante, une rainure plus courte que RAINURE_MIN n'est pas taillée. */
export const RAINURES_MAX = 6;
export const RAINURE_ARRET = 10;
export const RAINURE_MIN = 50;

/** Rainures antidérapantes parallèles au nez de fr, arrêtées avant les limons et avant la ligne de nez suivante bk
    (ou à depth derrière le nez) : sur les marches balancées, elles raccourcissent du côté où le giron se resserre. */
function grooves(p: Params, fl: Flights, fr: NoseLine, bk: NoseLine | null, depth = Infinity): Pt[][] {
  const n = p.rai ? clamp(Math.round(p.raiN), 1, RAINURES_MAX) : 0;
  const out: Pt[][] = [];
  const uOn = (o: number, P: Poly, side: "near" | "ahead") => {
    const c = polyCut(P, V.add(fr.Q, V.mul(fr.nr, o)), fr.dir, side);
    return c ? V.dot(V.sub(c.p, fr.Q), fr.dir) : null;
  };
  const X = (u: number, v: number) => V.add(V.add(fr.Q, V.mul(fr.dir, u)), V.mul(fr.nr, v));
  for (let i = 0; i < n; i++) {
    const c = p.raiD + i * p.raiE,
      o1 = c - p.raiL / 2,
      o2 = c + p.raiL / 2;
    if (o2 > depth - RAINURE_ARRET) break;
    const a1 = uOn(o1, fl.inner, "near"),
      a2 = uOn(o2, fl.inner, "near"),
      b1 = uOn(o1, fl.outer, "ahead"),
      b2 = uOn(o2, fl.outer, "ahead");
    if (a1 === null || a2 === null || b1 === null || b2 === null) continue;
    let u0 = Math.max(a1, a2) + RAINURE_ARRET,
      u1 = Math.min(b1, b2) - RAINURE_ARRET;
    if (bk) {
      // Distance de la ligne bk au nez de fr, le long de nr, à l'abscisse u : affine en u.
      const den = V.dot(fr.nr, bk.nr),
        vb = (u: number) => -V.dot(V.add(V.sub(fr.Q, bk.Q), V.mul(fr.dir, u)), bk.nr) / den;
      const v0 = vb(0),
        slope = vb(1) - v0,
        need = o2 + RAINURE_ARRET;
      if (Math.abs(slope) < 1e-9) {
        if (v0 < need) continue;
      } else if (slope > 0) u0 = Math.max(u0, (need - v0) / slope);
      else u1 = Math.min(u1, (need - v0) / slope);
    }
    if (u1 - u0 < RAINURE_MIN) continue;
    out.push([X(u0, o1), X(u1, o1), X(u1, o2), X(u0, o2)]);
  }
  return out;
}

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

/** Marche palière : de la ligne de nez d'arrivée ln jusqu'à depth en arrière, nez profilé de cote r. */
function landingTread(
  ln: NoseLine,
  top: number,
  e: number,
  depth: number,
  r: number,
  g: PlanCuts,
  rainures: Pt[][],
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
    grooves: rainures,
    nez: V.len(V.sub(ln.O, ln.Q)),
  };
}

export interface Treads {
  /** Cote du profil du nez, bornée à la moitié de l'épaisseur des marches. */
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
  const { region } = cuts;
  // Marches débordantes : la marche passe sur la crémaillère et la dépasse de debJ, la contremarche s'arrête à son
  // flanc. Le plan de marche, de nez à nez, reste entre les limons.
  const ang = anglaise(p);
  const flT = ang ? { ...fl, inner: offsetPoly(fl.inner, p.el + p.debJ) } : fl,
    cutsT = ang ? planCuts(flT) : cuts,
    cutsR = ang ? planCuts({ ...fl, inner: offsetPoly(fl.inner, p.el) }) : cuts;
  const isPalier = (j: number) => paliers.some((q) => q.j === j);
  const bo = arriereMarche(p);
  // Nez profilé : bande de largeur rn derrière la ligne de nez, dessinée à part en 3D.
  const rn = nezCote(p.nez, p.rn, p.et);
  const treads: Tread[] = [];
  for (let j = 1; j < n; j++) {
    const fr = lines[j - 1]!,
      bk = lines[j]!;
    treads.push({
      j,
      top: j * h,
      plan: region(fr, bk),
      solid: cutsT.region(cutsT.cutOff(fr, rn), cutsT.cutOff(bk, bo)),
      nose: rn > 0 ? cutsT.noseSpan(fr, rn) : null,
      grooves: grooves(p, flT, fr, bk),
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
  const lnA = lines[n - 1]!;
  const mp = mpD
    ? landingTread(
        lnA,
        n * h,
        p.mpE,
        mpD,
        Math.min(rn, nezCote(p.nez, p.rn, p.mpE)),
        cutsT,
        grooves(p, flT, lnA, null, mpD),
      )
    : null;
  // Contremarches : sous le nez de la marche du haut, rentrées de l'embrèvement dans sa rainure ; posées sur la
  // marche du bas, ou descendues derrière elle jusqu'à son dessous. La dernière, sans marche palière, s'arrête
  // sous le plancher d'arrivée, qui n'est pas rainuré.
  const risers: Riser[] = [];
  if (p.cm)
    for (let j = 1; j <= n; j++) {
      const ln = lines[j - 1]!;
      const emb = j === n && !mp ? 0 : p.cmEmb;
      const z1 = j * h - (j === n && mp ? mp.e : p.et) + emb;
      const z0 = (j - 1) * h - (p.cmPose === "derriere" && j > 1 ? p.et : 0);
      risers.push({ z0, z1, plan: cutsR.region(cutsR.cutOff(ln, p.deb), cutsR.cutOff(ln, p.deb + p.ecm)) });
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
