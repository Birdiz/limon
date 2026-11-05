/* Pièces débitées de l'escalier et leurs cotes, sans leur pose dans les fichiers DXF.
   La liste de débit, le volume, les alertes de fabrication et le devis n'ont besoin que d'elles ;
   l'export CNC (src/cnc/build.ts) les reprend et pose leurs contours avec les mêmes formes. */
import { isLeft } from "./params";
import type { Params } from "./params";
import { cncFrame, type Frame, type Section } from "./pockets";
import { polyPath, type Cut } from "./poly";
import { handrailOutline, postOutline, railOutline } from "./railing";
import type { NoseLine, Railing, Stair, StringerPiece } from "./stair-types";
import { layBoard } from "./stringer";
import { V, bbox, closeRing, type Pt } from "./vec";

export interface TreadPart {
  j: number;
  /** Longueur hors tout (le long du nez). */
  L: number;
  /** Profondeur hors tout (hauteur pour une contremarche). */
  l: number;
  /** Palier d'un tournant, débité et logé comme une marche. */
  palier?: true;
}

export interface BoardPart {
  name: string;
  L: number;
  l: number;
  pockets: number;
  /** Hauteur de limon nécessaire pour garder 20 mm de bois sous chaque logement. */
  need: number;
  /** Hauteur retenue pour cette pièce. */
  hl: number;
}

/** Poteau d'un tournant : longueur, largeur et épaisseur de débit. */
export interface PostPart {
  j: number;
  L: number;
  l: number;
  e: number;
}

/** Pièce du garde-corps : main courante, balustre ou montant, lisse. */
export interface RailPart {
  j: number;
  L: number;
  l: number;
}

export interface RailPieces {
  handrailParts: (RailPart & { name: string })[];
  postParts: RailPart[];
  railParts: RailPart[];
}

/** Toutes les pièces débitées, dans l'ordre de l'export. */
export interface Pieces {
  treadParts: TreadPart[];
  riserParts: TreadPart[];
  boardParts: BoardPart[];
  /** Marche palière, dans marches.dxf ; null sans elle. */
  mpPart: TreadPart | null;
  postParts: PostPart[];
  /** Garde-corps côté jour, s'il y en a un. */
  rail: RailPieces | null;
}

/** Repère commun aux pièces et à leur pose : un escalier qui tourne à gauche est vu dans le miroir. */
export interface CutFrame extends Frame {
  left: boolean;
  /** Miroir d'un escalier qui tourne à gauche. */
  M: (q: Pt) => Pt;
  /** Recul de la coupe arrière d'une marche derrière la ligne de nez suivante. */
  bo: number;
}

export function cutFrame(R: Stair): CutFrame {
  const p = R.params,
    left = isLeft(p.forme),
    mx = left ? -1 : 1;
  return { ...cncFrame(R, p), left, M: (q) => [mx * q[0], q[1]], bo: p.deb + (p.cm ? p.ecm : 0) };
}

/** Contour d'une marche, du nez lnF jusqu'à la coupe arrière bk, dans son repère local
    (nez sur l'axe x, montée vers +y, vu de dessus), avec son rectangle de débit. */
export function treadShape(F: CutFrame, lnF: NoseLine, bk: Section) {
  const { M, inOff, outOff } = F;
  const fr = F.at(lnF, 0);
  // Nez qui part du coin du jour, après un palier : le fond de son logement est sur le prolongement du segment.
  const ext = (c: Cut) => (c.outside ? [c.p] : []);
  const outline = closeRing([
    ...ext(fr.inD),
    ...polyPath(inOff, fr.inD.s, bk.inD.s),
    ...ext(bk.inD),
    ...polyPath(outOff, bk.outD.s, fr.outD.s),
  ]);
  const ref = M(fr.inF.p),
    nr = M(lnF.nr),
    ax: Pt = [nr[1], -nr[0]];
  const loc = (q: Pt): Pt => {
    const d = V.sub(M(q), ref);
    return [V.dot(d, ax), V.dot(d, nr)];
  };
  const o = outline.map(loc),
    b = bbox(o);
  return { o, b, loc, L: b.x1 - b.x0, l: b.y1 - b.y0 };
}

/** Bout d'une contremarche : abscisse côté parement (f) et côté dos (b). */
export interface RiserEnd {
  f: number;
  b: number;
}

/** Contremarche i vue de face : bout gauche, bout droit, longueur hors tout et hauteur.
    Dans le tournant, elle arrive en biais sur le limon : parement et dos n'ont pas la même longueur. */
export function riserShape(F: CutFrame, R: Stair, i: number) {
  const ln = R.lines[i]!,
    r = R.risers[i]!,
    band = F.riserBand(ln),
    nr = F.M(ln.nr),
    ax: Pt = [nr[1], -nr[0]];
  const x = (q: Pt) => V.dot(F.M(q), ax);
  const ends: RiserEnd[] = [
    [band.a.inD.p, band.b.inD.p],
    [band.a.outD.p, band.b.outD.p],
  ].map(([f, b]) => ({ f: x(f!), b: x(b!) }));
  const [lo, hi] = (ends[0]!.f + ends[0]!.b < ends[1]!.f + ends[1]!.b ? ends : [ends[1], ends[0]]) as [
    RiserEnd,
    RiserEnd,
  ];
  const x0 = Math.min(lo.f, lo.b),
    x1 = Math.max(hi.f, hi.b);
  return { lo, hi, L: x1 - x0, l: r.z1 - r.z0 };
}

/** Noms des limons tels qu'écrits dans limons.dxf. */
export function boardNames(R: Stair) {
  const names = R.quart ? { in: "LIMON DE JOUR", out: "LIMON DE MUR" } : { in: "LIMON DROIT", out: "LIMON GAUCHE" };
  // Numéro de chaque limon de jour : sans limon du milieu (poteau unique du demi-tournant), ils se suivent quand même.
  const jour = R.stringers.filter((sp) => sp.side === "in").map((sp) => sp.idx),
    nj = jour.length,
    no = (idx: number) => `${jour.indexOf(idx) + 1}/${nj}`;
  const name = (sp: StringerPiece) =>
    names[sp.side] + (sp.count > 1 ? ` ${sp.side === "in" ? no(sp.idx) : `${sp.idx + 1}/${sp.count}`}` : "");
  return { names, no, name };
}

/** Rotation d'angle -th autour de l'origine, puis translation au coin bas gauche, décalé de y. */
export function lay(pts: readonly Pt[], th: number, y: number, ref: readonly Pt[] = pts) {
  const c = Math.cos(-th),
    s = Math.sin(-th);
  const rot = (q: Pt): Pt => [q[0] * c - q[1] * s, q[0] * s + q[1] * c];
  const b = bbox(ref.map(rot));
  return { tr: (q: Pt): Pt => [rot(q)[0] - b.x0, rot(q)[1] - b.y0 + y], L: b.x1 - b.x0, H: b.y1 - b.y0 };
}

/** Noms des mains courantes tels qu'écrits dans garde-corps.dxf. */
export function handrailNames(G: Railing): string[] {
  // Le retour horizontal au-dessus de la marche palière porte son propre nom.
  const ramp = G.handrails.filter((hr) => !hr.retour).length;
  let k = 0;
  return G.handrails.map((hr) =>
    hr.retour ? "RETOUR DE MAIN COURANTE" : `MAIN COURANTE${ramp > 1 ? ` ${++k}/${ramp}` : ""}`,
  );
}

export function railPieces(G: Railing, p: Params): RailPieces {
  const names = handrailNames(G);
  return {
    handrailParts: G.handrails.map((hr, i) => {
      const name = names[i]!;
      return {
        name: name.charAt(0) + name.slice(1).toLowerCase(),
        j: i + 1,
        L: lay(handrailOutline(hr), Math.atan(hr.b), 0).L,
        l: p.mcH,
      };
    }),
    postParts: G.posts.map((q, i) => {
      const b = bbox(postOutline(q, p));
      return { j: i + 1, L: b.y1 - b.y0, l: p.bs };
    }),
    railParts: G.rails.map((r, i) => ({ j: i + 1, L: lay(railOutline(r), Math.atan(r.b), 0).L, l: p.bs })),
  };
}

/** Pièces débitées et leurs cotes, sans rien poser : ce que lisent la liste de débit, la fiche et le devis. */
export function pieces(R: Stair, F: CutFrame = cutFrame(R)): Pieces {
  const p = R.params;
  const treadParts = R.treads.map((t): TreadPart => {
    const { L, l } = treadShape(F, R.lines[t.j - 1]!, F.at(R.lines[t.j]!, F.bo));
    return { j: t.j, L, l, ...(t.palier ? { palier: true as const } : {}) };
  });
  const mp = R.mp,
    lnA = R.lines[R.n - 1]!;
  const mpPart = mp ? (({ L, l }) => ({ j: R.n, L, l }))(treadShape(F, lnA, F.at(lnA, mp.depth))) : null;
  const riserParts = p.cm
    ? R.risers.map((_, i) => {
        const { L, l } = riserShape(F, R, i);
        return { j: i + 1, L, l };
      })
    : [];
  const { name } = boardNames(R);
  const boardParts = R.stringers.map((sp) => {
    const { L, H } = layBoard(sp, F.left);
    return { name: name(sp), L, l: H, pockets: sp.pockets.length, need: sp.need, hl: sp.hl };
  });
  const postParts = R.newels.map((N, c) => ({ j: c + 1, L: N.h, l: Math.max(N.sx, N.sy), e: Math.min(N.sx, N.sy) }));
  const rail = R.rail ? railPieces(R.rail, p) : null;
  return { treadParts, riserParts, boardParts, mpPart, postParts, rail };
}

/** Limons dont des logements débordent sous le bord : moins de 20 mm de bois sous le plus bas. */
export const tightBoards = (boards: readonly BoardPart[]): BoardPart[] => boards.filter((b) => b.need > b.hl + 0.5);

type Piece = Pick<TreadPart, "L" | "l">;

/** Pièces plus grandes qu'un plateau de pL (dans le fil) sur pW. */
export function oversize(P: Pieces, pL: number, pW: number) {
  const big = (q: Piece) => q.L > pL + 0.5 || q.l > pW + 0.5;
  return {
    treads: P.treadParts.filter(big),
    risers: P.riserParts.filter(big),
    boards: P.boardParts.filter(big),
  };
}

/** Volume brut débité, en m³ : rectangle de débit de chaque pièce × son épaisseur. */
export function stockVolume(P: Pieces, R: Stair): number {
  const p = R.params;
  const sum = (list: readonly Piece[], e: number) => list.reduce((v, q) => v + q.L * q.l * e, 0);
  const mp = P.mpPart ? P.mpPart.L * P.mpPart.l * p.mpE : 0;
  const post = P.postParts.reduce((v, q) => v + q.L * q.l * q.e, 0);
  const rail = P.rail
    ? sum(P.rail.handrailParts, p.mcL) + sum(P.rail.postParts, p.bs) + sum(P.rail.railParts, p.bs)
    : 0;
  return (sum(P.boardParts, p.el) + sum(P.treadParts, p.et) + mp + sum(P.riserParts, p.ecm) + post + rail) / 1e9;
}
