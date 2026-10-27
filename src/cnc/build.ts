/* Export CNC.
   Marches : vue de dessus, nez en bas, encastrement compris des deux côtés.
   Contremarches : vues de face, longueur hors tout.
   Limons : développé vu depuis la face côté marches, avec les logements à défoncer. */
import { fmt } from "../core/format";
import { cncFrame } from "../core/pockets";
import { polyPath } from "../core/poly";
import type { Stair } from "../core/stair";
import { stringerOutline } from "../core/stringer";
import { V, bbox, closeRing, type Box, type Pt, type Vertex } from "../core/vec";
import type { Entity, Layer } from "./entities";

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

/** Limons dont des logements débordent sous le bord : moins de 20 mm de bois sous le plus bas. */
export const tightBoards = (boards: readonly BoardPart[]): BoardPart[] => boards.filter((b) => b.need > b.hl + 0.5);

export interface CNC {
  treadEnts: Entity[];
  riserEnts: Entity[];
  boardEnts: Entity[];
  treadParts: TreadPart[];
  riserParts: TreadPart[];
  boardParts: BoardPart[];
}

export function buildCNC(R: Stair): CNC {
  const p = R.params;
  const left = p.forme === "quart-g",
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
  R.treads.forEach((t) => {
    const lnF = R.lines[t.j - 1]!,
      lnB = R.lines[t.j]!;
    const fr = at(lnF, 0),
      bk = at(lnB, bo);
    const outline = closeRing([...polyPath(inOff, fr.inD.s, bk.inD.s), ...polyPath(outOff, bk.outD.s, fr.outD.s)]);
    const marks: [Layer, Pt[]][] = p.cm
      ? [
          ["CM_DESSOUS", riserBand(lnF).quad],
          ["CM_DESSUS", riserBand(lnB).quad],
        ]
      : [];
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
    treadEnts.push({ kind: "text", layer: "TEXTE", x: cx + w / 2, y: cy + d / 2, h: 50, s: `M${t.j}`, center: true });
    treadEnts.push({
      kind: "text",
      layer: "TEXTE",
      x: cx + w / 2,
      y: cy + 18,
      h: 22,
      s: R.rn > 0 ? `nez R${fmt(R.rn, 1)}` : "nez",
      center: true,
    });
    cx += w + gap;
    rowH = Math.max(rowH, d);
    treadParts.push({ j: t.j, L: w, l: d });
  });

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
    boardParts.push({ name, L, l: H, pockets: pockets.length, need: sp.need, hl: sp.hl });
    by += H + 180;
  });
  return { treadEnts, riserEnts, boardEnts, treadParts, riserParts, boardParts };
}
