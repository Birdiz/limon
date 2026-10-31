/* Export CNC.
   Marches : vue de dessus, nez en bas, encastrement compris des deux côtés.
   Contremarches : vues de face, longueur hors tout.
   Limons : développé vu depuis la face côté marches, avec les logements à défoncer.
   Poteaux : leurs quatre faces vues de l'extérieur, couchées pied à gauche, avec logements et mortaises. */
import { fmt } from "../core/format";
import { cncFrame, type Section } from "../core/pockets";
import { polyPath } from "../core/poly";
import { isLeft } from "../core/params";
import { GC } from "../core/railing";
import { PERCAGE, type NoseLine, type Stair } from "../core/stair";
import { stringerOutline } from "../core/stringer";
import { V, bbox, closeRing, interp, type Box, type Pt, type Vertex } from "../core/vec";
import type { Entity, Layer } from "./entities";
import { buildRailing, postTenon, type RailingCNC } from "./railing";

export interface TreadPart {
  j: number;
  /** Longueur hors tout (le long du nez). */
  L: number;
  /** Profondeur hors tout (hauteur pour une contremarche). */
  l: number;
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

/** Limons dont des logements débordent sous le bord : moins de 20 mm de bois sous le plus bas. */
export const tightBoards = (boards: readonly BoardPart[]): BoardPart[] => boards.filter((b) => b.need > b.hl + 0.5);

type Piece = Pick<TreadPart, "L" | "l">;

/** Pièces plus grandes qu'un plateau de pL (dans le fil) sur pW. */
export function oversize(cnc: CNC, pL: number, pW: number) {
  const big = (q: Piece) => q.L > pL + 0.5 || q.l > pW + 0.5;
  return {
    treads: cnc.treadParts.filter(big),
    risers: cnc.riserParts.filter(big),
    boards: cnc.boardParts.filter(big),
  };
}

/** Volume brut débité, en m³ : rectangle de débit de chaque pièce × son épaisseur. */
export function stockVolume(cnc: CNC, R: Stair): number {
  const p = R.params;
  const sum = (list: readonly Piece[], e: number) => list.reduce((v, q) => v + q.L * q.l * e, 0);
  const mp = cnc.mpPart ? cnc.mpPart.L * cnc.mpPart.l * p.mpE : 0;
  const post = cnc.postParts.reduce((v, q) => v + q.L * q.l * q.e, 0);
  const rail = cnc.rail
    ? sum(cnc.rail.handrailParts, p.mcL) + sum(cnc.rail.postParts, p.bs) + sum(cnc.rail.railParts, p.bs)
    : 0;
  return (sum(cnc.boardParts, p.el) + sum(cnc.treadParts, p.et) + mp + sum(cnc.riserParts, p.ecm) + post + rail) / 1e9;
}

export interface CNC {
  treadEnts: Entity[];
  riserEnts: Entity[];
  boardEnts: Entity[];
  treadParts: TreadPart[];
  riserParts: TreadPart[];
  boardParts: BoardPart[];
  /** Marche palière, dans marches.dxf ; null sans elle. */
  mpPart: TreadPart | null;
  postEnts: Entity[];
  postParts: PostPart[];
  /** Garde-corps côté jour, s'il y en a un. */
  rail: RailingCNC | null;
}

export function buildCNC(R: Stair): CNC {
  const p = R.params;
  const left = isLeft(p.forme),
    mx = left ? -1 : 1,
    M = (q: Pt): Pt => [mx * q[0], q[1]];
  const e = p.enc,
    bo = p.deb + (p.cm ? p.ecm : 0);
  const { inOff, outOff, at, riserBand } = cncFrame(R, p);

  // Marches
  const treadEnts: Entity[] = [],
    treadParts: TreadPart[] = [];
  let cx = 0,
    cy = 0,
    rowH = 0;
  const gap = 40,
    rowMax = 2600;
  // Une marche, du nez lnF jusqu'à la coupe arrière bk, placée à la suite des précédentes.
  const tread = (lnF: NoseLine, bk: Section, marks: [Layer, Pt[]][], label: string, nose: string): Piece => {
    const fr = at(lnF, 0);
    const outline = closeRing([...polyPath(inOff, fr.inD.s, bk.inD.s), ...polyPath(outOff, bk.outD.s, fr.outD.s)]);
    // Repère local : nez sur l'axe x, montée vers +y, vu de dessus.
    const ref = M(fr.inF.p),
      nr = M(lnF.nr),
      ax: Pt = [nr[1], -nr[0]];
    const loc = (q: Pt): Pt => {
      const d = V.sub(M(q), ref);
      return [V.dot(d, ax), V.dot(d, nr)];
    };
    const o = outline.map(loc),
      b = bbox(o);
    if (cx > 0 && cx + (b.x1 - b.x0) > rowMax) {
      cx = 0;
      cy += rowH + gap + 30;
      rowH = 0;
    }
    const place = (q: Pt): Pt => [q[0] - b.x0 + cx, q[1] - b.y0 + cy];
    treadEnts.push({ kind: "poly", layer: "DECOUPE", pts: o.map(place), closed: true });
    marks.forEach(([layer, quad]) =>
      treadEnts.push({ kind: "poly", layer, pts: quad.map((q) => place(loc(q))), closed: true }),
    );
    const w = b.x1 - b.x0,
      d = b.y1 - b.y0;
    treadEnts.push({ kind: "text", layer: "TEXTE", x: cx + w / 2, y: cy + d / 2, h: 50, s: label, center: true });
    treadEnts.push({ kind: "text", layer: "TEXTE", x: cx + w / 2, y: cy + 18, h: 22, s: nose, center: true });
    cx += w + gap;
    rowH = Math.max(rowH, d);
    return { L: w, l: d };
  };
  R.treads.forEach((t) => {
    const lnF = R.lines[t.j - 1]!,
      lnB = R.lines[t.j]!;
    const marks: [Layer, Pt[]][] = p.cm
      ? [
          ["CM_DESSOUS", riserBand(lnF).quad],
          ["CM_DESSUS", riserBand(lnB).quad],
        ]
      : [];
    const part = tread(lnF, at(lnB, bo), marks, `M${t.j}`, R.rn > 0 ? `nez R${fmt(R.rn, 1)}` : "nez");
    treadParts.push({ j: t.j, ...part });
  });
  // Marche palière : du dernier nez jusqu'au bout des limons, encastrée comme les marches.
  const mp = R.mp,
    lnA = R.lines[R.n - 1]!;
  const mpPart = mp
    ? {
        j: R.n,
        ...tread(
          lnA,
          at(lnA, mp.depth),
          p.cm ? [["CM_DESSOUS", riserBand(lnA).quad]] : [],
          "MP",
          `marche paliere ep. ${fmt(mp.e)} - ${mp.rn > 0 ? `nez R${fmt(mp.rn, 1)}` : "nez"}`,
        ),
      }
    : null;

  // Contremarches : vues de face depuis l'escalier, bas en bas, encastrement compris, longueur hors tout.
  // Dans le tournant, la contremarche arrive en biais sur le limon : chaque bout biais est coté.
  const riserEnts: Entity[] = [],
    riserParts: TreadPart[] = [];
  cx = 0;
  cy = 0;
  rowH = 0;
  if (p.cm)
    R.risers.forEach((r, i) => {
      const ln = R.lines[i]!,
        band = riserBand(ln),
        nr = M(ln.nr),
        ax: Pt = [nr[1], -nr[0]];
      const x = (q: Pt) => V.dot(M(q), ax);
      type End = { f: number; b: number };
      const ends: End[] = [
        [band.a.inD.p, band.b.inD.p],
        [band.a.outD.p, band.b.outD.p],
      ].map(([f, b]) => ({ f: x(f!), b: x(b!) }));
      const [lo, hi] = (ends[0]!.f + ends[0]!.b < ends[1]!.f + ends[1]!.b ? ends : [ends[1], ends[0]]) as [End, End];
      const x0 = Math.min(lo.f, lo.b),
        x1 = Math.max(hi.f, hi.b),
        w = x1 - x0,
        d = r.z1 - r.z0;
      if (cx > 0 && cx + w > rowMax) {
        cx = 0;
        cy += rowH + gap + 30;
        rowH = 0;
      }
      riserEnts.push({
        kind: "poly",
        layer: "DECOUPE",
        pts: [
          [cx, cy],
          [cx + w, cy],
          [cx + w, cy + d],
          [cx, cy + d],
        ],
        closed: true,
      });
      riserEnts.push({
        kind: "text",
        layer: "TEXTE",
        x: cx + w / 2,
        y: cy + d / 2,
        h: 50,
        s: `CM${i + 1}`,
        center: true,
      });
      // Parement : face vue, côté nez. Un bout est biais quand parement et dos n'ont pas la même longueur.
      const bevel = (end: End, shortF: boolean, y: number, right: boolean) => {
        const dev = Math.abs(end.f - end.b);
        if (dev < 0.5) return;
        const deg = (Math.atan2(dev, p.ecm) * 180) / Math.PI;
        riserEnts.push({
          kind: "text",
          layer: "TEXTE",
          x: right ? cx + w - 12 : cx + 12,
          y,
          h: 20,
          right,
          s: `biais ${fmt(deg, 1)} deg (${shortF ? "parement" : "dos"} -${fmt(dev, 1)} mm)`,
        });
      };
      bevel(lo, lo.f > lo.b, cy + 12, false);
      bevel(hi, hi.f < hi.b, cy + d - 32, true);
      cx += w + gap;
      rowH = Math.max(rowH, d);
      riserParts.push({ j: i + 1, L: w, l: d });
    });

  // Limons
  const boardEnts: Entity[] = [],
    boardParts: BoardPart[] = [];
  let by = 0;
  const G = R.rail;
  const names = R.quart ? { in: "LIMON DE JOUR", out: "LIMON DE MUR" } : { in: "LIMON DROIT", out: "LIMON GAUCHE" };
  R.stringers.forEach((sp) => {
    const outline = stringerOutline(sp, sp.hl),
      pockets = sp.pockets;
    // Vu depuis la face côté marches : le limon de jour se lit à l'envers du sens de montée.
    // Puis couché dans le sens de la planche (plus petit rectangle de débit), haut en haut.
    const flip = (sp.side === "in") !== left;
    const fl = (q: Vertex): Pt => [flip ? -q[0] : q[0], q[1]];
    const flat = outline.map(fl);
    let best: { area: number; th: number; r: Box; c: number; s: number } | null = null;
    for (let i = 0; i < flat.length; i++) {
      const a = flat[i]!,
        b = flat[(i + 1) % flat.length]!;
      let th = Math.atan2(b[1] - a[1], b[0] - a[0]);
      while (th > Math.PI / 2) th -= Math.PI;
      while (th <= -Math.PI / 2) th += Math.PI;
      const c = Math.cos(-th),
        s = Math.sin(-th);
      const r = bbox(flat.map((q): Pt => [q[0] * c - q[1] * s, q[0] * s + q[1] * c]));
      const area = (r.x1 - r.x0) * (r.y1 - r.y0);
      if (!best || area < best.area - 1 || (Math.abs(area - best.area) <= 1 && Math.abs(th) < Math.abs(best.th)))
        best = { area, th, r, c, s };
    }
    const B = best!;
    // Le retournement inverse le sens des arcs.
    const tr = (q: Vertex): Vertex => {
      const f = fl(q),
        t: Pt = [f[0] * B.c - f[1] * B.s - B.r.x0, f[0] * B.s + f[1] * B.c - B.r.y0 + by];
      return q.length > 2 ? [...t, flip ? -q[2]! : q[2]!] : t;
    };
    boardEnts.push({ kind: "poly", layer: "DECOUPE", pts: outline.map(tr), closed: true });
    pockets.forEach((pk) => boardEnts.push({ kind: "poly", layer: "DEFONCE", pts: pk.map(tr), closed: true }));
    sp.tenons.forEach((t) =>
      boardEnts.push({
        kind: "poly",
        layer: "TENON",
        pts: (
          [
            [t.u0, t.z0],
            [t.u1, t.z0],
            [t.u1, t.z1],
            [t.u0, t.z1],
          ] as Pt[]
        ).map(tr),
        closed: true,
      }),
    );
    sp.holes.forEach((q) => {
      const c = tr(q);
      boardEnts.push({ kind: "circle", layer: "PERCAGE", x: c[0], y: c[1], r: PERCAGE / 2 });
    });
    // Balustres posés à l'anglaise : perçages de fixation dans le limon de jour.
    const posts = G && sp.side === "in" ? G.posts.filter((q) => q.idx === sp.idx) : [];
    posts.forEach((q) =>
      q.holes.forEach((h) => {
        const c = tr(h);
        boardEnts.push({ kind: "circle", layer: "PERCAGE", x: c[0], y: c[1], r: GC.vis / 2 });
      }),
    );
    const name = names[sp.side] + (sp.count > 1 ? ` ${sp.idx + 1}/${sp.count}` : "");
    const L = B.r.x1 - B.r.x0,
      H = B.r.y1 - B.r.y0;
    boardEnts.push({
      kind: "text",
      layer: "TEXTE",
      x: 0,
      y: by + H + 40,
      h: 45,
      s: `${name} - face cote marches - ${Math.ceil(L)} x ${Math.ceil(H)} x ${p.el} - defonce ${e} mm, jeu ${fmt(p.jeu, 1)} mm`,
    });
    // Assemblage, sous le nom : tenons dans les poteaux, ou about des limons de mur.
    const ts = sp.tenons,
      dims = (t: (typeof ts)[number]) => `${fmt(t.u1 - t.u0, 1)} x ${fmt(t.z1 - t.z0, 1)} ep. ${fmt(t.t1 - t.t0, 1)}`;
    const joints = ts.length
      ? [
          `${ts.length > 1 ? `tenons ${dims(ts[0]!)} en bas et ${dims(ts[1]!)} en haut` : `tenon ${dims(ts[0]!)}`} : joues de ${fmt(ts[0]!.t0, 1)} cote marches et ${fmt(p.el - ts[0]!.t1, 1)} cote jour`,
        ]
      : [
          ...(sp.holes.length
            ? [
                `about du ${names.out} ${sp.idx + 2}/${sp.count} contre cette face : ${sp.holes.length} percages D${PERCAGE} traversants (vis ou boulons dans son bout)`,
              ]
            : []),
          ...(R.quart && sp.side === "out" && sp.idx > 0
            ? [`bout en about contre le ${names.out} ${sp.idx}/${sp.count} : percer en bout au droit de ses percages`]
            : []),
        ];
    joints.forEach((s, i) =>
      boardEnts.push({ kind: "text", layer: "TEXTE", x: 0, y: by + H + 100 + 50 * i, h: 30, s }),
    );
    boardParts.push({ name, L, l: H, pockets: pockets.length, need: sp.need, hl: sp.hl });
    by += H + 180 + 50 * Math.max(0, joints.length - 1);
    // Balustres posés dans le chant : chant haut déroulé au-dessus du limon, dans le même sens, avec les mortaises.
    if (posts.length && G!.pose === "chant") {
      const pr = sp.prof,
        arc = [0];
      for (let i = 1; i < pr.length; i++)
        arc.push(arc[i - 1]! + Math.hypot(pr[i]![0] - pr[i - 1]![0], pr[i]![1] - pr[i - 1]![1]));
      const total = arc[arc.length - 1]!,
        at = (u: number) => {
          const x = interp(
            pr.map((q) => q[0]),
            arc,
            u,
          );
          return flip ? total - x : x;
        };
      const tb = postTenon(p),
        jeu = Math.max(0, p.jeu);
      boardEnts.push({
        kind: "poly",
        layer: "DECOUPE",
        pts: [
          [0, by],
          [total, by],
          [total, by + p.el],
          [0, by + p.el],
        ],
        closed: true,
      });
      posts.forEach((q) => {
        const x = at(q.u),
          a = (tb * Math.hypot(1, q.ab)) / 2 + jeu,
          b = tb / 2 + jeu,
          m = by + G!.off;
        boardEnts.push({
          kind: "poly",
          layer: "MORTAISE",
          pts: [
            [x - a, m - b],
            [x + a, m - b],
            [x + a, m + b],
            [x - a, m + b],
          ],
          closed: true,
        });
      });
      boardEnts.push({
        kind: "text",
        layer: "TEXTE",
        x: 0,
        y: by + p.el + 30,
        h: 30,
        s: `${name} - CHANT HAUT deroule, cote marches en bas - mortaises d'aplomb ${tb} x ${tb} profondeur ${GC.tenon + GC.fond} mm, jeu ${fmt(p.jeu, 1)} mm`,
      });
      by += p.el + 180;
    }
  });

  // Poteaux : chaque face vue de l'extérieur, couchée pied à gauche, la suivante du tour dessous
  // (l'arête basse d'une face est l'arête haute de la suivante) ; le poteau suivant plus bas.
  const postEnts: Entity[] = [];
  const NN = R.newels,
    nj = NN.length + 1,
    volee = (i: number) => (i === 0 ? "volee de depart" : i === nj - 1 ? "volee d'arrivee" : "volee du milieu");
  let py = 0;
  NN.forEach((N, c) => {
    const ps = N.size;
    const what = [
      `cote marches, ${volee(N.k)} - defonce ${e} mm, jeu ${fmt(p.jeu, 1)} mm`,
      `mortaise${G ? "s" : ""} du ${names.in} ${N.k + 1}/${nj}`,
      `mortaise${G ? "s" : ""} du ${names.in} ${N.k + 2}/${nj}`,
      `cote marches, ${volee(N.k + 1)} - defonce ${e} mm, jeu ${fmt(p.jeu, 1)} mm`,
    ];
    // Le miroir d'un escalier qui tourne à gauche inverse le sens du tour.
    const order = left ? [0, 3, 2, 1] : [0, 1, 2, 3];
    postEnts.push({
      kind: "text",
      layer: "TEXTE",
      x: 0,
      y: py + ps + 110,
      h: 45,
      s: `POTEAU${NN.length > 1 ? ` ${c + 1}/${NN.length}` : ""} ${Math.ceil(N.h)} x ${ps} x ${ps} - faces vues de l'exterieur, pied a gauche, dans l'ordre du tour`,
    });
    order.forEach((i, k) => {
      const f = N.faces[i]!,
        fy = py - k * (ps + 150);
      const n = M(f.n),
        right: Pt = [-n[1], n[0]],
        d = M(f.dir),
        o = M(f.o);
      const s = V.dot(d, right),
        v = (u: number) => V.dot(V.add(o, V.mul(d, u)), right),
        vmin = Math.min(v(f.u0), v(f.u1));
      const tr = (q: Vertex): Vertex => {
        const t: Pt = [q[1], fy + ps - (v(q[0]) - vmin)];
        return q.length > 2 ? [...t, s * q[2]!] : t;
      };
      postEnts.push({
        kind: "poly",
        layer: "DECOUPE",
        pts: [
          [0, fy],
          [N.h, fy],
          [N.h, fy + ps],
          [0, fy + ps],
        ],
        closed: true,
      });
      f.pockets.forEach((pk) => postEnts.push({ kind: "poly", layer: "DEFONCE", pts: pk.map(tr), closed: true }));
      f.mortises.forEach((m) => postEnts.push({ kind: "poly", layer: "MORTAISE", pts: m.pts.map(tr), closed: true }));
      const mc = f.mortises.find((m) => m.of === "main courante");
      const depth = !f.mortises.length
        ? ""
        : mc
          ? ` (profondeur ${fmt(f.mortises[0]!.depth, 1)} mm) et de la MAIN COURANTE ${mc.idx + 1}/${nj} (profondeur ${fmt(mc.depth, 1)} mm), jeu ${fmt(p.jeu, 1)} mm`
          : ` - profondeur ${fmt(f.mortises[0]!.depth, 1)} mm, jeu ${fmt(p.jeu, 1)} mm`;
      postEnts.push({
        kind: "text",
        layer: "TEXTE",
        x: 0,
        y: fy + ps + 30,
        h: 30,
        s: `FACE ${k + 1}/4 - ${what[i]}${depth}`,
      });
    });
    py -= 4 * (ps + 150) + 250;
  });
  const postParts = NN.map((N, c) => ({ j: c + 1, L: N.h, l: N.size, e: N.size }));
  const rail = G ? buildRailing(G, p) : null;
  return { treadEnts, riserEnts, boardEnts, treadParts, riserParts, boardParts, mpPart, postEnts, postParts, rail };
}
