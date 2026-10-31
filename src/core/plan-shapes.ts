import { fmt } from "./format";
import { isDemi, isLeft } from "./params";
import { echSidesShown, echStatus, type Stair, type Status } from "./stair";
import { V, type Pt } from "./vec";

/** Rôle d'un élément du plan, qui décide de son aspect (classe CSS à l'écran, couleurs dans la fiche PDF). */
export type PlanRole =
  | "pl-str"
  | "pl-tread"
  | "pl-bal"
  | "pl-gc"
  | "pl-tremie"
  | "pl-walk"
  | "pl-walk-end"
  | "pl-num"
  | "pl-ech"
  | "pl-echtxt"
  | "pl-ech-cote"
  | "pl-echtxt-cote"
  | "pl-dim"
  | "pl-dimtxt";

/** Éléments du plan, déjà dans le repère du dessin (montée vers le haut, y vers le bas) ;
    detail : élément secondaire, masqué sur téléphone. */
export type PlanShape =
  /** Polygone ; fine : trait d'épaisseur constante, coordonnées au dixième. */
  (
    | { k: "poly"; role: PlanRole; pts: Pt[]; fine: boolean }
    | { k: "line"; role: PlanRole; pts: Pt[] }
    | { k: "circle"; role: PlanRole; c: Pt; r: number; fine: boolean; s?: Status }
    /** Segments de cote. */
    | { k: "path"; role: PlanRole; segs: [Pt, Pt][] }
    /** Texte centré verticalement ; halo : épaisseur du détourage ; rot : texte tourné autour de at. */
    | {
        k: "text";
        role: PlanRole;
        at: Pt;
        size: number;
        text: string;
        anchor: "start" | "middle" | "end";
        halo?: number;
        rot?: number;
        s?: Status;
      }
  ) & { detail?: boolean };

export interface PlanDrawing {
  shapes: PlanShape[];
  /** Cadre du dessin : x0, y0, largeur, hauteur. */
  box: [number, number, number, number];
}

/** Plan coté de l'escalier, vue de dessus (montée vers le haut de l'écran). */
export function planShapes(R: Stair): PlanDrawing {
  const mx = isLeft(R.params.forme) ? -1 : 1;
  const T = (q: Pt): Pt => [mx * q[0], -q[1]];
  const span = Math.max(R.tours === 2 ? Math.max(R.A, R.B, R.C) : R.quart ? Math.max(R.A, R.B) : R.L, R.W);
  const fs = span / 34;
  const pts: Pt[] = [],
    shapes: PlanShape[] = [];
  const poly = (arr: Pt[], role: PlanRole) => {
    const t = arr.map(T);
    pts.push(...t);
    shapes.push({ k: "poly", role, pts: t, fine: true });
  };

  // Limons et poteau
  R.stringers.forEach((sp) => {
    const u0 = sp.prof[0]![0],
      u1 = sp.prof[sp.prof.length - 1]![0];
    const a = V.add(sp.origin, V.mul(sp.dir, u0)),
      b = V.add(sp.origin, V.mul(sp.dir, u1));
    poly([a, b, V.add(b, V.mul(sp.rn, sp.width)), V.add(a, V.mul(sp.rn, sp.width))], "pl-str");
  });
  R.newels.forEach((N) => {
    const c = N.c,
      dx = N.sx / 2,
      dy = N.sy / 2;
    poly(
      [
        [c[0] - dx, c[1] - dy],
        [c[0] + dx, c[1] - dy],
        [c[0] + dx, c[1] + dy],
        [c[0] - dx, c[1] + dy],
      ],
      "pl-str",
    );
  });
  // Marches et marche palière ; marches balancées et paliers en teinte : les deux passent le tournant.
  R.treads.forEach((t) => poly(t.plan, t.balanced || t.palier ? "pl-bal" : "pl-tread"));
  if (R.mp) poly(R.mp.plan, "pl-tread");
  // Garde-corps, au-dessus des marches : main courante et balustres ou montants.
  const G = R.rail;
  if (G) {
    const p = R.params;
    const box = (idx: number, u0: number, u1: number, w: number) => {
      const sp = R.stringers.find((s) => s.side === "in" && s.idx === idx)!;
      const q = (u: number, t: number) => V.add(V.add(sp.a, V.mul(sp.dir, u)), V.mul(sp.rn, G.off + t));
      poly([q(u0, -w / 2), q(u1, -w / 2), q(u1, w / 2), q(u0, w / 2)], "pl-gc");
    };
    G.handrails.forEach((hr) => box(hr.idx, hr.u0, hr.u1, p.mcL));
    G.posts.forEach((q) => box(q.idx, q.u - p.bs / 2, q.u + p.bs / 2, p.bs));
  }
  // Trémie, au-dessus des marches
  poly(R.trePoly, "pl-tremie");
  // Ligne de foulée
  const wp: Pt[] = [],
    steps = 120;
  for (let i = 0; i <= steps; i++) wp.push(T(R.walkAt((R.Lw * i) / steps)));
  shapes.push({ k: "line", role: "pl-walk", pts: wp });
  const s0 = wp[0]!,
    e1 = wp[wp.length - 1]!,
    e0 = wp[wp.length - 3]!;
  const ang = Math.atan2(e1[1] - e0[1], e1[0] - e0[0]),
    ah = fs * 0.9;
  shapes.push({ k: "circle", role: "pl-walk-end", c: s0, r: fs * 0.28, fine: false });
  shapes.push({
    k: "poly",
    role: "pl-walk-end",
    fine: false,
    pts: [
      [e1[0], e1[1]],
      [e1[0] - ah * Math.cos(ang - 0.4), e1[1] - ah * Math.sin(ang - 0.4)],
      [e1[0] - ah * Math.cos(ang + 0.4), e1[1] - ah * Math.sin(ang + 0.4)],
    ],
  });
  // Numéros de marche, flèche d'arrivée, repères d'échappée et leurs étiquettes : les cotes posées sur le dessin les évitent.
  type Box = [number, number, number, number];
  const occupe: Box[] = [];
  const boite = (q: Pt, w: number, h: number): Box => [q[0] - w / 2, q[1] - h / 2, q[0] + w / 2, q[1] + h / 2];
  const largeur = (text: string, size: number) => text.length * size * 0.6;
  const etiquette = (q: Pt, dx: number, size: number, text: string) => {
    const w = dx + largeur(text, size);
    occupe.push(boite([q[0] + (mx * w) / 2, q[1]], w, size));
  };
  // Numéros de marche
  R.treads.forEach((t) => {
    // Autour d'un palier, les nez ne sont plus espacés d'un giron sur la ligne de foulée.
    const tm = R.paliers.length ? (R.lines[t.j - 1]!.t + R.lines[t.j]!.t) / 2 : (t.j - 0.5) * R.g;
    const q = T(R.walkAt(tm));
    shapes.push({
      k: "text",
      role: "pl-num",
      at: q,
      size: fs * 0.72,
      halo: fs * 0.22,
      anchor: "middle",
      text: String(t.j),
    });
    occupe.push(boite(q, largeur(String(t.j), fs * 0.72), fs * 0.72));
  });
  occupe.push(boite(e1, ah * 2, ah * 2));
  // Point le plus bas sous le plancher ; sur grand écran et dans la fiche, aussi celui de chaque côté.
  if (R.ech && echSidesShown(R))
    for (const e of Object.values(R.echCotes)) {
      if (!e || V.len(V.sub(e.pt, R.ech.pt)) < 1) continue;
      const q = T(e.pt),
        s = echStatus(e);
      shapes.push({ k: "circle", role: "pl-ech-cote", c: q, r: fs * 0.3, fine: true, s });
      shapes.push({
        k: "text",
        role: "pl-echtxt-cote",
        at: [q[0] + mx * fs * 0.55, q[1]],
        size: fs * 0.56,
        halo: fs * 0.22,
        anchor: mx > 0 ? "start" : "end",
        text: fmt(e.c),
        s,
      });
      etiquette(q, fs * 0.55, fs * 0.56, fmt(e.c));
    }
  if (R.ech) {
    const q = T(R.ech.pt),
      s = R.st.ech;
    shapes.push({ k: "circle", role: "pl-ech", c: q, r: fs * 0.42, fine: true, s });
    shapes.push({
      k: "text",
      role: "pl-echtxt",
      at: [q[0] + mx * fs * 0.7, q[1]],
      size: fs * 0.62,
      halo: fs * 0.22,
      anchor: mx > 0 ? "start" : "end",
      text: `échappée ${fmt(R.ech.c)}`,
      s,
    });
    etiquette(q, fs * 0.7, fs * 0.62, `échappée ${fmt(R.ech.c)}`);
  }
  // Cotes. at : position de la ligne de cote le long de o ; par défaut, au premier rang, à l'écart des limons.
  // detail : masquée sur téléphone, où les réglages la donnent. Texte détouré, lisible même sur un trait.
  const d1 = R.stringers[0]!.width + fs * 1.6,
    d2 = d1 + fs * 1.9;
  const dim = (a: Pt, b: Pt, o: Pt, label: string, at?: number, detail = false) => {
    const A2 = V.add(a, V.mul(o, at === undefined ? d1 : at - V.dot(a, o))),
      B2 = V.add(b, V.mul(o, at === undefined ? d1 : at - V.dot(b, o)));
    const ta = T(a),
      tb = T(b),
      tA = T(A2),
      tB = T(B2);
    const ext = V.mul(o, fs * 0.5);
    const tA3 = T(V.add(A2, ext)),
      tB3 = T(V.add(B2, ext));
    pts.push(tA3, tB3);
    const dx = tB[0] - tA[0],
      dy = tB[1] - tA[1],
      L = Math.hypot(dx, dy),
      ux = dx / L,
      uy = dy / L,
      k = fs * 0.35;
    const tick = (q: Pt): [Pt, Pt] => [
      [q[0] - k * (ux - uy), q[1] - k * (uy + ux)],
      [q[0] + k * (ux - uy), q[1] + k * (uy + ux)],
    ];
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg <= -90) deg += 180;
    const mid = T(V.add(V.mul(V.add(A2, B2), 0.5), V.mul(o, fs * 0.55)));
    const fin = detail ? { detail } : {};
    shapes.push({
      k: "path",
      role: "pl-dim",
      segs: [
        [ta, tA3],
        [tb, tB3],
        [tA, tB],
      ],
      ...fin,
    });
    shapes.push({ k: "path", role: "pl-dim", segs: [tick(tA)], ...fin });
    shapes.push({ k: "path", role: "pl-dim", segs: [tick(tB)], ...fin });
    shapes.push({
      k: "text",
      role: "pl-dimtxt",
      at: mid,
      size: fs * 0.62,
      anchor: "middle",
      rot: deg,
      text: label,
      halo: fs * 0.22,
      ...fin,
    });
  };
  // Étiquette d'une cote parallèle à un axe, dans le repère du dessin ; libre : elle ne touche aucun numéro ni repère.
  const texte = (a: Pt, b: Pt, o: Pt, at: number, label: string): Box => {
    const m = V.mul(V.add(a, b), 0.5),
      c = T(V.add(m, V.mul(o, at - V.dot(m, o) + fs * 0.55))),
      w = largeur(label, fs * 0.62);
    return Math.abs(o[0]) > 0.5 ? boite(c, fs * 0.62, w) : boite(c, w, fs * 0.62);
  };
  const libre = (b: Box, e = fs * 0.3) =>
    occupe.every((c) => b[2] + e <= c[0] || c[2] + e <= b[0] || b[3] + e <= c[1] || c[3] + e <= b[1]);
  // Ligne de cote posée sur le dessin : la plus proche de at, entre lo et hi, dont l'étiquette est libre.
  const place = (a: Pt, b: Pt, o: Pt, at: number, label: string, lo: number, hi: number) => {
    for (let k = 0; k <= 60; k++)
      for (const v of k ? [at + k * fs * 0.1, at - k * fs * 0.1] : [at])
        if (v >= lo && v <= hi && libre(texte(a, b, o, v, label))) return v;
    return at;
  };
  // Cote posée sur le dessin, masquée sur téléphone.
  const dedans = (a: Pt, b: Pt, o: Pt, label: string, at: number, lo: number, hi: number) =>
    dim(a, b, o, label, place(a, b, o, at, label, lo, hi), true);
  if (R.tours === 2) {
    dim([0, 0], [0, R.A], [-1, 0], fmt(R.A));
    dim([0, R.A], [R.C, R.A], [0, 1], fmt(R.C));
    dim([R.C, R.A], [R.C, R.A - R.B], [1, 0], fmt(R.B));
    // Demi-tournant : le jour saisi, entre les deux volées.
    if (isDemi(R.params.forme)) dim([R.W, 0], [R.C - R.W, 0], [0, -1], fmt(R.params.J));
  } else if (R.quart) {
    dim([0, 0], [0, R.A], [-1, 0], fmt(R.A));
    dim([0, R.A], [R.B, R.A], [0, 1], fmt(R.B));
  } else dim([0, 0], [0, R.L], [-1, 0], fmt(R.L));
  dim([0, 0], [R.W, 0], [0, -1], fmt(R.W));

  // Trémie, au deuxième rang : le long du côté départ, depuis le départ ; en travers, depuis le mur du départ
  // (x = −el) ; en U, depuis le mur du fond quand elle ne l'atteint pas. Cotes de la trémie dessinée : celles retenues,
  // bornées par les murs.
  const { x0: tx0, x1: tx1, y0: ty0, y1: ty1 } = R.tre,
    el = R.params.el,
    murFond = R.A + el;
  const left: Pt = [-1, 0],
    up: Pt = [0, 1],
    atTop = R.quart ? R.A + d2 : ty1 + d1;
  if (Math.abs(ty0) >= 1) dim([0, 0], [tx0, ty0], left, fmt(Math.abs(ty0)), d2, true);
  dim([tx0, ty0], [tx0, ty1], left, `trémie ${fmt(ty1 - ty0)}`, d2);
  if (R.tours === 2 && ty1 < murFond - 1) dim([tx0, ty1], [-el, murFond], left, fmt(murFond - ty1), d2, true);
  if (tx0 > -el + 1) dim([-el, ty1], [tx0, ty1], up, fmt(tx0 + el), atTop, true);
  dim([tx0, ty1], [tx1, ty1], up, `trémie ${fmt(tx1 - tx0)}`, atTop);
  // Branches du L et du U, dans la trémie, mesurées depuis le mur jusqu'au coin du plancher qui reste : en L, près du
  // bord du plancher d'arrivée ; en U, sous la bande du fond, ce bord étant près du départ et de ses cotes.
  const tp = R.trePoly;
  if (tp.length === 6) {
    const xa = tp[1]![0],
      yb = tp[2]![1],
      bD = `branche ${fmt(xa - tx0)}`,
      bA = `branche ${fmt(ty1 - yb)}`;
    dedans([tx0, ty0], [xa, ty0], up, bD, ty0 + fs * 1.4, ty0 + fs * 0.8, yb - fs * 1.2);
    dedans([tx1, yb], [tx1, ty1], left, bA, fs * 1.4 - tx1, fs * 0.8 - tx1, -xa - fs * 1.2);
  } else if (tp.length === 8) {
    const xa = tp[1]![0],
      yb = tp[2]![1],
      xb = tp[3]![0],
      down: Pt = [0, -1],
      [lo, hi] = [fs * 0.8 - yb, -ty0 - fs * 1.2];
    dedans([tx0, yb], [xa, yb], down, `branche ${fmt(xa - tx0)}`, fs * 1.4 - yb, lo, hi);
    dedans([xb, yb], [tx1, yb], down, `branche ${fmt(tx1 - xb)}`, fs * 1.4 - yb, lo, hi);
    dedans([xa, yb], [xa, ty1], [1, 0], `bande ${fmt(ty1 - yb)}`, xa + fs * 1.4, xa + fs * 0.8, xb - fs * 1.2);
  }

  // Giron, sur une marche droite (nez parallèles) : de nez à nez sur la ligne de foulée, coté du côté du jour, hors du limon ;
  // dans la marche, entre le jour et la foulée, quand le jour du U est trop étroit pour la cote. Sur la marche la plus
  // proche du départ, après la première, dont l'étiquette est libre.
  const dehors = R.tours < 2 || R.C - 2 * R.W - 2 * R.params.el > 2 * d1;
  const girons = R.treads.flatMap((t) => {
    const a = R.lines[t.j - 1]!,
      b = R.lines[t.j]!;
    if (t.balanced || t.palier || V.dot(a.dir, b.dir) < 1 - 1e-9) return [];
    const o = dehors ? V.mul(a.dir, -1) : a.dir,
      at = V.dot(a.Q, o) + (dehors ? d1 : V.len(V.sub(a.P, a.Q)) / 2 - fs * 0.3),
      label = `giron ${fmt(V.dot(V.sub(b.P, a.P), a.nr), 1)}`;
    return [{ j: t.j, a: a.Q, b: b.Q, o, at, label, libre: libre(texte(a.Q, b.Q, o, at, label)) }];
  });
  const gm = girons.find((c) => c.j > 1 && c.libre) ?? girons.find((c) => c.libre) ?? girons[0];
  if (gm) dim(gm.a, gm.b, gm.o, gm.label, gm.at);

  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  const pad = fs * 1.2;
  const x0 = Math.min(...xs) - pad,
    y0 = Math.min(...ys) - pad;
  return { shapes, box: [x0, y0, Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad] };
}
