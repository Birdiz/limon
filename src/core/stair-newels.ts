/* Étapes 7 et 10 du calcul : poteaux à chaque tournant.
   D'abord leurs faces côté marches, qui reçoivent des logements comme des bouts de limon ; puis, limons et garde-corps
   connus, leurs quatre faces avec logements et mortaises. */
import { ceil10 } from "./format";
import type { Params } from "./params";
import type { StringerPockets } from "./pockets";
import { GC } from "./railing";
import type { Flights } from "./stair-flights";
import { TENON, isJour } from "./stair-stringers";
import type { Newel, NewelFace, Railing, StringerGeom, StringerPiece, Tenon } from "./stair-types";
import { V, type Pt } from "./vec";

export interface NewelPosts {
  /** Un poteau par tournant, des angles k0 à k1 (le poteau unique du demi-tournant prend les deux angles). */
  posts: { k0: number; k1: number }[];
  /** Hauteur de chaque poteau, avant la main courante. */
  newelTop: number[];
  /** Faces côté marches de chaque poteau, et toutes à la suite. */
  newelFaces: StringerGeom[][];
  postFaces: StringerGeom[];
}

/** Faces des poteaux côté marches, traitées comme des bouts de limon pour y loger marches et contremarches. */
export function newelPosts(p: Params, fl: Flights, zIn: (v: number) => number): NewelPosts {
  const { tours, single, inner, len, dirs, sIn } = fl;
  const ps = p.ps;
  // Un poteau par tournant, des angles k0 à k1 : le poteau unique du demi-tournant prend les deux angles,
  // sa face du fond court sur tout le jour.
  const posts = single ? [{ k0: 0, k1: 1 }] : Array.from({ length: tours }, (_, k) => ({ k0: k, k1: k }));
  const newelTop = posts.map(({ k0, k1 }) =>
    ceil10(Math.max(zIn(sIn[k0 + 1]! - ps), zIn(sIn[k1 + 1]! + ps)) + TENON.tete),
  );
  const face = (a: Pt, dir: Pt, u0: number, sLo: number, top: number, w = ps): StringerGeom => ({
    origin: a,
    dir,
    rn: [dir[1], -dir[0]],
    prof: [
      [u0, top],
      [u0 + w, top],
    ],
    width: ps,
    side: "in",
    idx: 0,
    count: 1,
    a,
    sLo,
    sHi: sLo + w,
  });
  const newelFaces = posts.map(({ k0, k1 }, c) => [
    face(inner.pts[k0]!, dirs[k0]!, len[k0]! - ps, sIn[k0 + 1]! - ps, newelTop[c]!),
    ...(k1 > k0 ? [face(inner.pts[k1]!, dirs[k1]!, 0, sIn[k1]!, newelTop[c]!, len[k1]!)] : []),
    face(inner.pts[k1 + 1]!, dirs[k1 + 1]!, 0, sIn[k1 + 1]!, newelTop[c]!),
  ]);
  return { posts, newelTop, newelFaces, postFaces: newelFaces.flat() };
}

/** Poteaux : faces dans l'ordre du tour (vu de dessus, sens trigonométrique pour un tournant à droite),
    logements des faces côté marches, mortaises des limons de jour et des mains courantes. */
export function newels(
  p: Params,
  fl: Flights,
  np: NewelPosts,
  stringers: readonly StringerPiece[],
  facePockets: readonly StringerPockets[],
  rail: Railing | null,
): Newel[] {
  const { quart, inner, len, dirs } = fl;
  const { posts, newelTop, newelFaces, postFaces } = np;
  const ps = p.ps;
  const jeu = Math.max(0, p.jeu);
  const mortise = (idx: number, end: boolean) => {
    const ts = stringers.find((sp) => isJour(quart, sp) && sp.idx === idx)!.tenons,
      t = end ? ts[ts.length - 1]! : ts[0]!;
    return slot(idx, "limon", t, TENON.fond);
  };
  const slot = (idx: number, of: "limon" | "main courante", t: Tenon, fond: number) => {
    return {
      idx,
      of,
      depth: t.u1 - t.u0 + fond,
      pts: [
        [t.t0 - jeu, t.z0 - jeu],
        [t.t1 + jeu, t.z0 - jeu],
        [t.t1 + jeu, t.z1 + jeu],
        [t.t0 - jeu, t.z1 + jeu],
      ] as Pt[],
    };
  };
  const mcMortise = (idx: number, end: boolean) => {
    const ts = rail?.handrails.find((r) => r.idx === idx)?.tenons;
    const t = ts?.length ? (end ? ts[ts.length - 1] : ts[0]) : undefined;
    return t ? [slot(idx, "main courante", t, GC.fond)] : [];
  };
  // Mortaise d'un limon de jour qui arrive par l'autre bout de la face du fond (poteau unique) : vue de la face,
  // son épaisseur se compte depuis l'autre arête.
  const across = (m: ReturnType<typeof slot>, w: number) => ({
    ...m,
    pts: m.pts.map(([u, z]): Pt => [w - u, z]).reverse(),
  });
  // Le poteau monte recevoir la main courante : dessus des deux tronçons à leur bout contre le poteau.
  const mcTop = (k0: number, k1: number) =>
    Math.max(
      0,
      ...(rail?.handrails
        .filter((r) => r.tenons.length && (r.idx === k0 || r.idx === k1 + 1))
        .map((r) => r.z0 + r.b * (r.idx === k0 ? r.u1 : r.u0)) ?? []),
    );
  return posts.map(({ k0, k1 }, c) => {
    const K = inner.pts[k0 + 1]!,
      d0 = dirs[k0]!,
      d1 = dirs[k0 + 1]!,
      back = V.sub(K, V.mul(d0, ps)),
      // Largeur le long du jour : la section, ou tout le jour pour le poteau unique.
      w = k1 > k0 ? len[k1]! : ps;
    const fi = postFaces.indexOf(newelFaces[c]![0]!),
      pockets = (i: number) => facePockets[fi + i]!.pockets;
    const span = V.add(V.mul(d0, ps), V.mul(d1, w));
    const sides: NewelFace[] =
      k1 > k0
        ? [
            // Les deux limons de jour arrivent sur la face du fond, chacun près de son arête.
            {
              n: V.sub([0, 0], d0),
              o: back,
              dir: d1,
              u0: 0,
              u1: w,
              volee: null,
              pockets: [],
              mortises: [
                mortise(k0, true),
                ...mcMortise(k0, true),
                across(mortise(k1 + 1, false), w),
                ...mcMortise(k1 + 1, false).map((m) => across(m, w)),
              ],
            },
            {
              n: dirs[k1]!,
              o: inner.pts[k1 + 1]!,
              dir: dirs[k1 + 1]!,
              u0: 0,
              u1: ps,
              volee: k1 + 1,
              pockets: pockets(2),
              mortises: [],
            },
            {
              n: V.sub([0, 0], dirs[k1 + 1]!),
              o: K,
              dir: d1,
              u0: 0,
              u1: w,
              volee: k1,
              pockets: pockets(1),
              mortises: [],
            },
          ]
        : [
            {
              n: V.sub([0, 0], d0),
              o: back,
              dir: d1,
              u0: 0,
              u1: ps,
              volee: null,
              pockets: [],
              mortises: [mortise(k0, true), ...mcMortise(k0, true)],
            },
            {
              n: d1,
              o: V.add(K, V.mul(d1, ps)),
              dir: V.sub([0, 0], d0),
              u0: 0,
              u1: ps,
              volee: null,
              pockets: [],
              mortises: [mortise(k0 + 1, false), ...mcMortise(k0 + 1, false)],
            },
            { n: d0, o: K, dir: d1, u0: 0, u1: ps, volee: k0 + 1, pockets: pockets(1), mortises: [] },
          ];
    return {
      k: k0,
      c: V.add(V.sub(K, V.mul(d0, ps / 2)), V.mul(d1, w / 2)),
      sx: Math.abs(span[0]),
      sy: Math.abs(span[1]),
      h: rail ? Math.max(newelTop[c]!, ceil10(mcTop(k0, k1) + GC.tete)) : newelTop[c]!,
      faces: [
        {
          n: V.sub([0, 0], d1),
          o: inner.pts[k0]!,
          dir: d0,
          u0: len[k0]! - ps,
          u1: len[k0]!,
          volee: k0,
          pockets: pockets(0),
          mortises: [],
        },
        ...sides,
      ],
    };
  });
}
