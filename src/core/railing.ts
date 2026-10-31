/* Garde-corps côté jour : main courante rampante, balustres ou montants et lisses.
   Chaque tronçon de main courante suit en plan un tronçon de limon de jour (même abscisse u, depuis sp.a) ;
   en quart tournant, il s'assemble dans le poteau à tenon et mortaise, comme le limon. */
import type { Params, Pose } from "./params";
import type { StringerPiece } from "./stair";
import { interp, type Pt } from "./vec";

export const GC = {
  /** Hauteur de la main courante au-dessus des nez (NF P01-012). */
  h: 900,
  /** Écart libre maximal entre les éléments du remplissage. */
  ecart: 110,
  /** Entraxe maximal des montants qui portent les lisses. */
  pas: 1000,
  /** Tenons en bout des balustres et montants ; fond de mortaise au-delà. */
  tenon: 20,
  fond: 2,
  /** Tenon de la main courante dans le poteau, épaulements haut et bas. */
  tenonMC: 30,
  epaulMC: 10,
  /** Débord des balustres posés à l'anglaise sous le bord bas du limon. */
  debord: 30,
  /** Diamètre des perçages de fixation des balustres posés à l'anglaise. */
  vis: 8,
  /** Tête du poteau au-dessus de la main courante. */
  tete: 60,
} as const;

/** Tronçon de main courante au-dessus du tronçon de limon de jour idx, du bout u0 au bout u1 (pris au dessus). */
export interface Handrail {
  idx: number;
  u0: number;
  u1: number;
  /** Coupe d'onglet en bout : décalage en u du dessous par rapport au dessus ; absent si le bout est d'aplomb. */
  cut0?: number;
  cut1?: number;
  /** Retour horizontal au-dessus de la marche palière. */
  retour?: boolean;
  /** Dessus : z = z0 + b·u. */
  z0: number;
  b: number;
  /** Épaisseur mesurée d'aplomb. */
  hv: number;
  /** Tenon dans le poteau : de u0 à u1, de z0 à z1, de t0 à t1 depuis la face du limon côté marches. */
  tenon: { u0: number; u1: number; z0: number; z1: number; t0: number; t1: number } | null;
}

/** Balustre ou montant, d'axe u : bas et haut à l'axe, avec la pente de chaque coupe. */
export interface Post {
  idx: number;
  u: number;
  zb: number;
  ab: number;
  zt: number;
  at: number;
  /** Tenon en bas, dans le chant du limon (pose dans le chant). */
  tenonBas: boolean;
  /** Perçages traversants du limon (u, z), pose à l'anglaise. */
  holes: Pt[];
}

/** Lisse entre deux appuis (montants ou poteau), de uA à uB ; dessus à z0 + b·u, épaisseur d'aplomb hv. */
export interface Rail {
  idx: number;
  uA: number;
  uB: number;
  z0: number;
  b: number;
  hv: number;
}

export interface Railing {
  type: "balustres" | "lisses";
  pose: Pose;
  /** Axe du garde-corps, depuis la face du limon de jour côté marches. */
  off: number;
  handrails: Handrail[];
  posts: Post[];
  rails: Rail[];
  /** Hauteur de la main courante au-dessus des nez, au plus bas et au plus haut. */
  hMin: number;
  hMax: number;
  /** Plus grand écart libre du remplissage. */
  gap: number;
  /** Écart le plus petit entre la lisse basse et le limon ; négatif si elle le touche. */
  railLow: number;
}

export interface RailingInput {
  p: Params;
  quart: boolean;
  /** Tronçons de limon de jour, dans l'ordre de la montée. */
  jour: readonly StringerPiece[];
  /** Abscisse curviligne du début de chaque tronçon de la ligne de jour. */
  cum: readonly number[];
  /** Nez sur la ligne de jour : abscisses curvilignes et hauteurs, du premier nez à l'arrivée. */
  noseS: readonly number[];
  noseZ: readonly number[];
  /** Profondeur de la marche palière, 0 sans elle : la main courante y fait un retour horizontal. */
  mpD?: number;
}

const slopeOf = (f: (u: number) => number, u: number) => f(u + 0.5) - f(u - 0.5);

/** Axes régulièrement espacés sur [a, b] : un élément affleure chaque bout libre, l'écart libre reste sous gap.
    Un bout contre le poteau n'a pas d'élément : le poteau en tient lieu. */
function spread(a: number, b: number, w: number, gap: number, postA: boolean, postB: boolean): number[] {
  const L = b - a;
  if (postA && postB) {
    const n = Math.max(0, Math.ceil((L - gap) / (w + gap))),
      p = L / (n + 1);
    return Array.from({ length: n }, (_, i) => a + p * (i + 1));
  }
  if (postA || postB) {
    const n = Math.max(1, Math.ceil(L / (w + gap))),
      p = L / n;
    return Array.from({ length: n }, (_, i) => (postB ? a + w / 2 + i * p : b - w / 2 - i * p)).sort((x, y) => x - y);
  }
  const n = Math.max(2, Math.ceil((L - w) / (w + gap)) + 1),
    p = (L - w) / (n - 1);
  return Array.from({ length: n }, (_, i) => a + w / 2 + i * p);
}

/** Perçages de fixation d'un balustre posé à l'anglaise : deux hauteurs dans le recouvrement, hors des logements. */
function holesAt(sp: StringerPiece, u: number, z0: number, z1: number): Pt[] {
  const r = GC.vis / 2 + 3;
  const boxes = sp.pockets.map((pk) => {
    const us = pk.map((q) => q[0]),
      zs = pk.map((q) => q[1]);
    return [Math.min(...us), Math.max(...us), Math.min(...zs), Math.max(...zs)] as const;
  });
  const free = (z: number) => boxes.every(([a, b, c, d]) => u + r < a || u - r > b || z + r < c || z - r > d);
  const zs: number[] = [];
  for (let z = z0 + 20; z <= z1 - 20; z += 5) if (free(z)) zs.push(z);
  if (!zs.length) return [];
  const lo = zs[0]!,
    hi = zs[zs.length - 1]!;
  return hi - lo >= 40
    ? [
        [u, lo],
        [u, hi],
      ]
    : [[u, lo]];
}

export function railing({ p, quart, jour, cum, noseS, noseZ, mpD = 0 }: RailingInput): Railing | null {
  if (p.gc === "aucun") return null;
  const chant = p.gcPose === "chant";
  const off = chant ? p.el / 2 : p.el + p.bs / 2;
  const nose = (s: number) => interp(noseS, noseZ, s);
  const handrails: Handrail[] = [],
    posts: Post[] = [],
    rails: Rail[] = [];
  let hMin = Infinity,
    hMax = -Infinity,
    gap = 0,
    railLow = Infinity;
  jour.forEach((sp) => {
    const s0 = cum[sp.idx]!,
      last = sp.idx === sp.count - 1;
    const postA = quart && sp.idx > 0,
      postB = quart && !last;
    const u0 = postA ? sp.prof[0]![0] : noseS[0]! - s0,
      u1 = postB ? sp.prof[sp.prof.length - 1]![0] : noseS[noseS.length - 1]! - s0;
    const top = (u: number) =>
        interp(
          sp.prof.map((q) => q[0]),
          sp.prof.map((q) => q[1]),
          u,
        ),
      want = (u: number) => nose(s0 + u) + GC.h;
    const us = [u0, ...noseS.map((s) => s - s0).filter((u) => u > u0 && u < u1), u1];
    // Main courante droite au plus près de 900 mm : la pente qui donne le moins de surhauteur.
    // La surhauteur est convexe en la pente (maximum de fonctions affines) : recherche ternaire.
    const fit = (b: number) => {
      const z0 = Math.max(...us.map((u) => want(u) - b * u));
      return { b, z0, ex: Math.max(...us.map((u) => z0 + b * u - want(u))) };
    };
    let lo = 0,
      hi = 3;
    for (let i = 0; i < 100; i++) {
      const m1 = lo + (hi - lo) / 3,
        m2 = hi - (hi - lo) / 3;
      if (fit(m1).ex <= fit(m2).ex) hi = m2;
      else lo = m1;
    }
    const best = fit((lo + hi) / 2);
    const { b, z0 } = best,
      sec = Math.hypot(1, b),
      hv = p.mcH * sec;
    us.forEach((u) => {
      const d = z0 + b * u - nose(s0 + u);
      hMin = Math.min(hMin, d);
      hMax = Math.max(hMax, d);
    });
    let tenon: Handrail["tenon"] = null;
    if (postA || postB) {
      const tm = Math.max(6, Math.round(p.mcL / 3)),
        t0 = off - tm / 2,
        t1 = off + tm / 2,
        tl = Math.min(GC.tenonMC, p.ps - t1 - 5);
      const sh = postB ? u1 : u0,
        far = postB ? u1 + tl : u0 - tl;
      const zt = (u: number) => z0 + b * u;
      tenon = {
        u0: Math.min(sh, far),
        u1: Math.max(sh, far),
        z0: Math.max(zt(sh), zt(far)) - hv + GC.epaulMC,
        z1: Math.min(zt(sh), zt(far)) - GC.epaulMC,
        t0,
        t1,
      };
    }
    // Marche palière : retour horizontal à la hauteur où arrive la main courante, coupé d'onglet avec elle.
    const zr = z0 + b * u1,
      uE = u1 + mpD,
      retour = last && mpD > 0 && b > 1e-6;
    const cut = retour ? (hv - p.mcH) / b : 0;
    handrails.push({ idx: sp.idx, u0, u1, z0, b, hv, tenon, ...(retour ? { cut1: cut } : {}) });
    fill(sp, top, u0, u1, z0, b, hv, postA, postB, us);
    if (retour) {
      handrails.push({ idx: sp.idx, u0: u1, u1: uE, z0: zr, b: 0, hv: p.mcH, tenon: null, cut0: cut, retour: true });
      const d = zr - nose(s0 + u1);
      hMin = Math.min(hMin, d);
      hMax = Math.max(hMax, d);
      fill(sp, top, u1, uE, zr, 0, p.mcH, true, false, [u1, uE]);
    }
  });
  /** Balustres ou montants et lisses sous la main courante de dessus z0 + b·u, de u0 à u1. */
  function fill(
    sp: StringerPiece,
    top: (u: number) => number,
    u0: number,
    u1: number,
    z0: number,
    b: number,
    hv: number,
    postA: boolean,
    postB: boolean,
    us: readonly number[],
  ): void {
    const sec = Math.hypot(1, b);
    const under = (u: number) => z0 + b * u - hv;
    const G = p.gc === "balustres" ? GC.ecart : GC.pas - p.bs;
    const axes = spread(u0, u1, p.bs, G, postA, postB);
    const bot = chant ? top : (u: number) => Math.max(0, top(u) - sp.hl - GC.debord);
    axes.forEach((u) => {
      posts.push({
        idx: sp.idx,
        u,
        zb: bot(u),
        ab: slopeOf(bot, u),
        zt: under(u),
        at: b,
        tenonBas: chant,
        holes: chant ? [] : holesAt(sp, u, Math.max(0, top(u) - sp.hl), top(u)),
      });
    });
    // Écart libre entre balustres (ou entre un balustre et le poteau).
    const edges = [
      ...(postA ? [u0] : []),
      ...axes.flatMap((u) => [u - p.bs / 2, u + p.bs / 2]),
      ...(postB ? [u1] : []),
    ];
    if (p.gc === "balustres")
      for (let i = postA ? 0 : 1; i + 1 < edges.length; i += 2) gap = Math.max(gap, edges[i + 1]! - edges[i]!);
    else {
      // Lisses parallèles à la main courante, régulièrement espacées là où le vide sous la main courante est le plus haut.
      const samples = [...us, ...sp.prof.map((q) => q[0]).filter((u) => u > u0 && u < u1)];
      const clear = samples.map((u) => under(u) - top(u)),
        cMax = Math.max(...clear),
        cMin = Math.min(...clear);
      const hvL = p.bs * sec,
        m = Math.max(0, Math.ceil((cMax - GC.ecart) / (hvL + GC.ecart))),
        g = (cMax - m * hvL) / (m + 1);
      gap = Math.max(gap, g);
      railLow = Math.min(railLow, cMin - m * (g + hvL));
      for (let i = postA ? 0 : 1; i + 1 < edges.length; i += 2)
        for (let k = 1; k <= m; k++)
          rails.push({
            idx: sp.idx,
            uA: edges[i]!,
            uB: edges[i + 1]!,
            z0: z0 - hv - k * g - (k - 1) * hvL,
            b,
            hv: hvL,
          });
    }
  }
  return {
    type: p.gc,
    pose: p.gcPose,
    off,
    handrails,
    posts,
    rails,
    hMin,
    hMax,
    gap,
    railLow: rails.length ? railLow : Infinity,
  };
}
