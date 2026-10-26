/* Export CNC.
   Marches : vue de dessus, nez en bas, encastrement compris des deux côtés.
   Limons : développé vu depuis la face côté marches, avec les logements à défoncer. */
import { offsetPoly, polyCut, polyPath, type Cut } from "../core/poly";
import type { NoseLine, Stair } from "../core/stair";
import { stringerOutline } from "../core/stringer";
import { V, bbox, clamp, closeRing, interp, type Box, type Pt } from "../core/vec";
import type { Entity, Layer } from "./entities";

export interface TreadPart {
  j: number;
  /** Longueur hors tout (le long du nez). */
  L: number;
  /** Profondeur hors tout. */
  l: number;
}

export interface BoardPart {
  name: string;
  L: number;
  l: number;
  pockets: number;
  /** Hauteur de limon nécessaire pour garder 20 mm de bois sous chaque logement. */
  need: number;
}

export interface CNC {
  treadEnts: Entity[];
  boardEnts: Entity[];
  treadParts: TreadPart[];
  riserParts: TreadPart[];
  boardParts: BoardPart[];
}

/** Points d'une ligne de marche décalée : sur les faces des limons (F) et au fond des logements (D). */
interface Section {
  inF: Cut;
  inD: Cut;
  outF: Cut;
  outD: Cut;
}

export function buildCNC(R: Stair): CNC {
  const p = R.params;
  const left = p.forme === "quart-g",
    mx = left ? -1 : 1,
    M = (q: Pt): Pt => [mx * q[0], q[1]];
  const e = p.enc,
    bo = p.deb + (p.cm ? p.ecm : 0);
  const inOff = offsetPoly(R.inner, e),
    outOff = offsetPoly(R.outer, -e);
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

  // Marches
  const treadEnts: Entity[] = [],
    treadParts: TreadPart[] = [];
  let cx = 0,
    cy = 0,
    rowH = 0;
  const gap = 40,
    rowMax = 2600;
  const items = R.treads.map((t) => {
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
    treadEnts.push({ kind: "text", layer: "TEXTE", x: cx + w / 2, y: cy + 18, h: 22, s: "nez", center: true });
    cx += w + gap;
    rowH = Math.max(rowH, d);
    treadParts.push({ j: t.j, L: w, l: d });
    return { t, fr, bk };
  });

  // Contremarches (débit seulement)
  const riserParts: TreadPart[] = p.cm
    ? R.risers.map((r, i) => {
        const band = riserBand(R.lines[i]!);
        return { j: i + 1, L: V.len(V.sub(band.a.outD.p, band.a.inD.p)), l: r.z1 - r.z0 };
      })
    : [];

  // Limons
  const boardEnts: Entity[] = [],
    boardParts: BoardPart[] = [];
  let by = 0;
  const names = R.quart ? { in: "LIMON DE JOUR", out: "LIMON DE MUR" } : { in: "LIMON DROIT", out: "LIMON GAUCHE" };
  R.stringers.forEach((sp) => {
    const outline = stringerOutline(sp, p.hl),
      bb = bbox(outline);
    const proj = (q: Pt) => V.dot(V.sub(q, sp.a), sp.dir);
    const keyF = sp.side === "in" ? "inF" : "outF",
      keyD = sp.side === "in" ? "inD" : "outD";
    const touches = (s1: number, s2: number) => Math.max(s1, s2) > sp.sLo + 0.5 && Math.min(s1, s2) < sp.sHi - 0.5;
    const pockets: Pt[][] = [];
    let need = 0;
    const topAt = (u: number) =>
      interp(
        sp.prof.map((q) => q[0]),
        sp.prof.map((q) => q[1]),
        u,
      );
    const pocket = (c1: Section, c2: Section, z0: number, z1: number) => {
      if (!touches(c1[keyF].s, c2[keyF].s)) return;
      const us = [c1[keyF].p, c1[keyD].p, c2[keyF].p, c2[keyD].p].map(proj);
      const u0 = clamp(Math.min(...us), bb.x0, bb.x1),
        u1 = clamp(Math.max(...us), bb.x0, bb.x1);
      if (!(u1 - u0 > 2 && z1 > z0)) return;
      pockets.push([
        [u0, z0],
        [u1, z0],
        [u1, z1],
        [u0, z1],
      ]);
      if (z0 > 0.5) need = Math.max(need, topAt(u0) - z0 + 20, topAt(u1) - z0 + 20);
    };
    items.forEach((it) => pocket(it.fr, it.bk, it.t.top - p.et, it.t.top));
    if (p.cm)
      R.risers.forEach((r, i) => {
        const band = riserBand(R.lines[i]!);
        pocket(band.a, band.b, r.z0, r.z1);
      });
    // Vu depuis la face côté marches : le limon de jour se lit à l'envers du sens de montée.
    // Puis couché dans le sens de la planche (plus petit rectangle de débit), haut en haut.
    const flip = (sp.side === "in") !== left;
    const fl = (q: Pt): Pt => [flip ? -q[0] : q[0], q[1]];
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
    const tr = (q: Pt): Pt => {
      const f = fl(q);
      return [f[0] * B.c - f[1] * B.s - B.r.x0, f[0] * B.s + f[1] * B.c - B.r.y0 + by];
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
      s: `${name} - face cote marches - ${Math.ceil(L)} x ${Math.ceil(H)} x ${p.el} - defonce ${e} mm`,
    });
    boardParts.push({ name, L, l: H, pockets: pockets.length, need });
    by += H + 180;
  });
  return { treadEnts, boardEnts, treadParts, riserParts, boardParts };
}
