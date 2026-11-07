/* Étapes 6 et 8 du calcul : limons le long des lignes de nez, puis leurs logements, hauteurs, tenons et perçages.
   Les faces des poteaux (stair-newels) passent entre les deux : elles reçoivent aussi des logements. */
import { ceil10 } from "./format";
import { anglaise, type Params } from "./params";
import { cncFrame, stringerPockets, type StringerPockets } from "./pockets";
import type { Poly } from "./poly";
import type { Flights } from "./stair-flights";
import type { Heights } from "./stair-noses";
import type { Treads } from "./stair-treads";
import type { ComputeFailure, NoseLine, StringerGeom, StringerPiece, Tenon } from "./stair-types";
import { V, interp, type Pt } from "./vec";

/** Hauteur du bord haut des limons au-dessus de la ligne des nez. */
export const LIFT = 50;
/** Assemblage des limons de jour dans le poteau : longueur de tenon visée, épaulements haut et bas,
    fond de mortaise au-delà du tenon. Tête du poteau au-dessus du limon le plus haut. */
export const TENON = { long: 40, epaul: 30, fond: 2, tete: 100 } as const;
/** Diamètre des perçages de l'about des limons de mur. */
export const PERCAGE = 10;
/** Gorge de la crémaillère : bois laissé d'équerre au rampant sous chaque angle rentrant des dents. */
export const GORGE = 90;

/** Crémaillère sous des marches débordantes : un palier de dent sous chaque marche (et sous la marche palière),
    du dos de la contremarche d'en dessous au dos de la suivante, contre lequel elle s'appuie ; hauteur de la
    planche qui garde GORGE de bois sous les angles rentrants. */
function cremaillere(
  p: Params,
  sp: StringerGeom,
  s0: number,
  lines: readonly NoseLine[],
  tr: Pick<Treads, "treads" | "mp">,
): { cut: Pt[]; hl: number } {
  const dos = p.deb + (p.cm ? p.ecm : 0),
    uOf = (k: number) => lines[k]!.sIn - s0 + dos;
  const prof = sp.prof,
    uEnd = prof[prof.length - 1]![0];
  const seats = tr.treads.map((t) => ({ u0: uOf(t.j - 1), u1: uOf(t.j), z: t.top - p.et }));
  if (tr.mp) seats.push({ u0: uOf(lines.length - 1), u1: uEnd, z: tr.mp.top - tr.mp.e });
  const cut: Pt[] = [[seats[0]!.u0, 0]];
  for (const q of seats) {
    if (q.u0 >= uEnd) break;
    cut.push([q.u0, q.z], [Math.min(q.u1, uEnd), q.z]);
  }
  const top = (u: number) =>
    interp(
      prof.map((q) => q[0]),
      prof.map((q) => q[1]),
      u,
    );
  const [a, b] = prof as [Pt, Pt];
  const gorge = GORGE * Math.hypot(1, (b[1] - a[1]) / (b[0] - a[0]));
  const deep = Math.max(...seats.filter((q) => q.u1 < uEnd).map((q) => top(q.u1) - q.z), 0);
  return { cut, hl: ceil10(deep + gorge) };
}

/** Limon de jour : côté jour d'un escalier tournant (le limon droit côté jour reste un limon de mur). */
export const isJour = (quart: boolean, sp: Pick<StringerGeom, "side">) => quart && sp.side === "in";

/** Nez le long d'un côté : abscisses xs sur le côté, hauteurs zs. */
export interface Noses {
  xs: number[];
  zs: number[];
}

export interface StringerLines {
  nosesIn: Noses;
  nosesOut: Noses;
  /** Bord haut des limons du jour et du mur, selon l'abscisse sur leur côté. */
  zIn: (v: number) => number;
  zOut: (v: number) => number;
  /** Tronçons de limon, jour puis mur, sans logements. */
  geoms: StringerGeom[];
}

/** Limons : un tronçon par côté droit du jour et du mur, arête haute à LIFT au-dessus de la ligne des nez. */
export function stringerLines(
  p: Params,
  fl: Flights,
  he: Heights,
  lines: readonly NoseLine[],
  mpD: number,
): StringerLines {
  const { quart, single, inner, outer } = fl;
  const { h, g, paliers, palSeg } = he;
  const el = p.el;
  // Hauteur des nez le long d'un côté. Sur un palier, elle reste à plat jusqu'à un giron avant le premier nez
  // de la volée suivante, sans revenir sur le tronçon d'avant : le limon suit le palier, puis la volée.
  const noses = (side: "sIn" | "sOut", P: Poly): Noses => {
    const xs: number[] = [],
      zs: number[] = [];
    lines.forEach((l, k) => {
      xs.push(l[side]);
      zs.push((k + 1) * h);
      const q = paliers.findIndex((pl) => pl.j === k + 1),
        nx = lines[k + 1];
      if (q < 0 || !nx) return;
      xs.push(Math.max(l[side], P.cum[palSeg[q]!]!, nx[side] - g));
      zs.push((k + 1) * h);
    });
    return { xs, zs };
  };
  const nosesIn = noses("sIn", inner),
    nosesOut = noses("sOut", outer);
  const zIn = (v: number) => interp(nosesIn.xs, nosesIn.zs, v) + LIFT;
  const zOut = (v: number) => interp(nosesOut.xs, nosesOut.zs, v) + LIFT;
  // Poteau affleurant les faces côté marches, à chaque coin du jour : les limons de jour s'arrêtent sur ses faces.
  const ps = p.ps;
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
      // Avec une marche palière, le dernier tronçon se prolonge à l'horizontale pour la loger.
      const hi = i === N - 2 ? Math.max(s1, arr[arr.length - 1]!) + mpD : s1 - post;
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
  // Jour étroit du demi-tournant : le poteau unique prend la place du limon de jour du milieu.
  const geoms = [
    ...pieces(inner, nosesIn.xs, zIn, false).filter((sp) => !(single && sp.idx === 1)),
    ...pieces(outer, nosesOut.xs, zOut, true),
  ];
  return { nosesIn, nosesOut, zIn, zOut, geoms };
}

export interface Stringers {
  stringers: StringerPiece[];
  /** Logements des faces de poteaux, dans l'ordre de postFaces. */
  facePockets: StringerPockets[];
  hlj: number;
  hljAuto: number;
  /** Hauteurs nécessaires des limons de jour et des limons de mur. */
  needJ: number;
  needM: number;
}

/** Logements de chaque limon et des faces de poteaux, hauteur des limons, tenons des limons de jour et perçages
    de l'about des limons de mur. */
export function stringerPieces(
  p: Params,
  fl: Flights,
  lines: NoseLine[],
  tr: Pick<Treads, "treads" | "risers" | "mp">,
  sl: StringerLines,
  postFaces: readonly StringerGeom[],
): Stringers | ComputeFailure {
  const { quart, demi, inner, outer } = fl;
  const { zIn, zOut, geoms } = sl;
  const { treads, risers, mp } = tr;
  const n = lines.length;
  const el = p.el,
    hl = p.hl,
    ps = p.ps;
  // Logements de chaque limon et hauteur qui garde 20 mm de bois sous le plus bas.
  // Le limon de jour du quart tournant a sa propre hauteur, proposée d'après ses logements.
  const geo = {
    inner,
    outer,
    lines,
    treads,
    risers,
    stringers: [...geoms, ...postFaces],
    mp: mp && { line: lines[n - 1]!, top: mp.top, e: mp.e, depth: mp.depth },
  };
  const jour = (sp: StringerGeom) => isJour(quart, sp);
  let pk: StringerPockets[];
  try {
    pk = stringerPockets(geo, p, cncFrame(geo, p));
  } catch {
    // Une ligne de marche, décalée du débord ou de l'encastrement, sort des limons (balancement trop serré,
    // ou jour du demi-tournant trop étroit pour loger les marches qui y pivotent).
    return {
      ok: false,
      errors: [
        demi
          ? {
              key: "J",
              message:
                "Géométrie impossible : une marche ne rejoint plus les limons. Élargissez le jour ou augmentez le nombre de marches balancées.",
            }
          : {
              key: "mb",
              message:
                "Géométrie impossible : une marche ne rejoint plus les limons. Augmentez le nombre de marches balancées.",
            },
      ],
    };
  }
  const withPockets = geoms.map((sp, i) => ({ ...sp, ...pk[i]! }));
  const needJ = Math.max(0, ...withPockets.filter(jour).map((sp) => sp.need));
  const needM = Math.max(0, ...withPockets.filter((sp) => !jour(sp)).map((sp) => sp.need));
  const hljAuto = Math.max(150, ceil10(needJ));
  const hlj = quart ? (p.hljAuto ? hljAuto : p.hlj) : hl;
  // Tenon centré dans le bois laissé derrière les logements, pour que sa mortaise n'y débouche pas.
  // Il s'arrête avant la mortaise de l'autre limon, sur la face voisine du poteau.
  const jeu = Math.max(0, p.jeu);
  const tt = Math.max(6, Math.round((el - p.enc) / 2)),
    t0 = Math.max(0, p.enc + (el - p.enc - tt) / 2),
    t1 = t0 + tt,
    tl = Math.min(TENON.long, ps - t1 - 5);
  const tenonOf = (sp: StringerGeom, hs: number, end: boolean): Tenon => {
    const sh = end ? sp.prof[sp.prof.length - 1]![0] : sp.prof[0]![0],
      far = end ? sh + tl : sh - tl;
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
  // About des limons de mur : chaque tronçon dépasse de son épaisseur et reçoit le bout du suivant, vissé ou boulonné.
  // Perçages au milieu du bois laissé derrière les logements, pour rester loin de ceux de la marche d'angle.
  const holesOf = (sp: StringerGeom): Pt[] => {
    if (!quart || sp.side !== "out" || sp.idx === sp.count - 1) return [];
    const i = sp.idx,
      zt = zOut(outer.cum[i + 1]!),
      zb = Math.max(0, zt - hl),
      u = outer.cum[i + 1]! - outer.cum[i]! + (p.enc + jeu + el) / 2;
    return [
      [u, zb + (zt - zb) / 3],
      [u, zb + ((zt - zb) * 2) / 3],
    ];
  };
  const crem = anglaise(p);
  const stringers: StringerPiece[] = withPockets.map((sp) => {
    if (crem && sp.side === "in") {
      const c = cremaillere(p, sp, inner.cum[sp.idx]!, lines, tr);
      return { ...sp, need: c.hl, hl: c.hl, tenons: [], holes: [], cut: c.cut };
    }
    const hs = jour(sp) ? hlj : hl;
    const tenons = jour(sp)
      ? [...(sp.idx > 0 ? [tenonOf(sp, hs, false)] : []), ...(sp.idx < sp.count - 1 ? [tenonOf(sp, hs, true)] : [])]
      : [];
    return { ...sp, hl: hs, tenons, holes: holesOf(sp) };
  });
  return { stringers, facePockets: pk.slice(geoms.length), hlj, hljAuto, needJ, needM };
}
