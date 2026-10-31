import { fmt } from "./format";
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

/** Éléments du plan, déjà dans le repère du dessin (montée vers le haut, y vers le bas). */
export type PlanShape =
  /** Polygone ; fine : trait d'épaisseur constante, coordonnées au dixième. */
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
    };

export interface PlanDrawing {
  shapes: PlanShape[];
  /** Cadre du dessin : x0, y0, largeur, hauteur. */
  box: [number, number, number, number];
}

/** Plan coté de l'escalier, vue de dessus (montée vers le haut de l'écran). */
export function planShapes(R: Stair): PlanDrawing {
  const mx = R.params.forme === "quart-g" ? -1 : 1;
  const T = (q: Pt): Pt => [mx * q[0], -q[1]];
  const span = Math.max(R.quart ? Math.max(R.A, R.B) : R.L, R.W);
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
  if (R.newel) {
    const c = R.newel.c,
      d = R.newel.size / 2;
    poly(
      [
        [c[0] - d, c[1] - d],
        [c[0] + d, c[1] - d],
        [c[0] + d, c[1] + d],
        [c[0] - d, c[1] + d],
      ],
      "pl-str",
    );
  }
  // Marches et marche palière
  R.treads.forEach((t) => poly(t.plan, t.balanced ? "pl-bal" : "pl-tread"));
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
  // Numéros de marche
  R.treads.forEach((t) => {
    const q = T(R.walkAt((t.j - 0.5) * R.g));
    shapes.push({
      k: "text",
      role: "pl-num",
      at: q,
      size: fs * 0.72,
      halo: fs * 0.22,
      anchor: "middle",
      text: String(t.j),
    });
  });
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
  }
  // Cotes
  const dim = (a: Pt, b: Pt, o: Pt, label: string) => {
    const d = R.stringers[0]!.width + fs * 1.6;
    const A2 = V.add(a, V.mul(o, d)),
      B2 = V.add(b, V.mul(o, d));
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
    shapes.push({
      k: "path",
      role: "pl-dim",
      segs: [
        [ta, tA3],
        [tb, tB3],
        [tA, tB],
      ],
    });
    shapes.push({ k: "path", role: "pl-dim", segs: [tick(tA)] });
    shapes.push({ k: "path", role: "pl-dim", segs: [tick(tB)] });
    shapes.push({ k: "text", role: "pl-dimtxt", at: mid, size: fs * 0.62, anchor: "middle", rot: deg, text: label });
  };
  if (R.quart) {
    dim([0, 0], [0, R.A], [-1, 0], fmt(R.A));
    dim([0, R.A], [R.B, R.A], [0, 1], fmt(R.B));
  } else dim([0, 0], [0, R.L], [-1, 0], fmt(R.L));
  dim([0, 0], [R.W, 0], [0, -1], fmt(R.W));

  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  const pad = fs * 1.2;
  const x0 = Math.min(...xs) - pad,
    y0 = Math.min(...ys) - pad;
  return { shapes, box: [x0, y0, Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad] };
}
