import { fmt } from "./format";
import { inPolygon } from "./headroom";
import type { PlanRole, PlanShape } from "./plan-shapes";
import { echStatus, echWhere, type Stair, type Status } from "./stair";
import type { Pt } from "./vec";

/* Vue de côté : la ligne de foulée déroulée à plat, comme le menuisier trace le développé.
   Abscisse t le long de la ligne de foulée (0 au nez de la première marche), z en hauteur depuis le sol fini du bas.
   Sur ce développé, toutes les marches ont le giron de la ligne de foulée et les cotes y sont vraies. */

/** Marche du développé : dessus à z, du nez t0 au nez suivant t1. */
export interface SideStep {
  j: number;
  t0: number;
  t1: number;
  z: number;
  balanced: boolean;
  palier: boolean;
}

export interface SideView {
  /** Nez de chaque marche (t, z), le dernier étant celui de l'arrivée. */
  noses: Pt[];
  steps: SideStep[];
  /** Étendue dessinée le long de la ligne de foulée, prolongée avant le départ et après l'arrivée. */
  range: [number, number];
  /** Morceaux de plancher haut au-dessus de la ligne de foulée : de t0 à t1, hors de la trémie. */
  floors: [number, number][];
  /** Bords de trémie croisés par la ligne de foulée ; open : côté de la trémie (+1 après le bord, −1 avant). */
  edges: { t: number; open: 1 | -1 }[];
  /** Échappée la plus faible sur la ligne de foulée : nez en (t, z), hauteur libre c. */
  ech: { t: number; z: number; c: number; s: Status } | null;
  /** Rappel de l'échappée la plus faible quand elle tombe ailleurs que sur la ligne de foulée, ou qu'il n'y en a pas. */
  rappel: { text: string; s: Status } | null;
}

/** Prolongement de la ligne de foulée dessiné avant le départ et après l'arrivée. */
const MARGE = 600;

/** Développé de l'escalier sur sa ligne de foulée. */
export function sideView(R: Stair): SideView {
  const { h, lines } = R;
  const noses: Pt[] = lines.map((l, k): Pt => [l.t, (k + 1) * h]);
  const steps: SideStep[] = R.treads.map((t) => ({
    j: t.j,
    t0: lines[t.j - 1]!.t,
    t1: lines[t.j]!.t,
    z: t.top,
    balanced: t.balanced,
    palier: t.palier,
  }));
  const range: [number, number] = [-MARGE, R.Lw + (R.mp ? R.mp.depth : 0) + MARGE];

  // Plancher : là où la ligne de foulée (prolongée) passe hors du contour de trémie, bord compris dans la trémie
  // comme pour l'échappée. Pas de 10 mm, puis bords cherchés par dichotomie.
  const open = (t: number) => inPolygon(R.walkAt(t), R.trePoly);
  const floors: [number, number][] = [],
    edges: SideView["edges"] = [];
  const cnt = Math.ceil((range[1] - range[0]) / 10);
  let prev = range[0],
    was = open(prev),
    from = was ? null : prev;
  for (let i = 1; i <= cnt; i++) {
    const t = range[0] + ((range[1] - range[0]) * i) / cnt,
      is = open(t);
    if (is !== was) {
      let lo = prev,
        hi = t;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (open(mid) === was) lo = mid;
        else hi = mid;
      }
      const e = (lo + hi) / 2;
      edges.push({ t: e, open: is ? 1 : -1 });
      if (is) floors.push([from!, e]);
      else from = e;
      was = is;
    }
    prev = t;
  }
  if (!was) floors.push([from!, range[1]]);

  // Échappée sur la ligne de foulée : hauteur des nez linéaire de nez à nez, au-dessus de la marche j.
  const e = R.echCotes.foulee;
  let ech: SideView["ech"] = null;
  if (e) {
    const a = noses[e.j - 1]!,
      b = noses[e.j]!;
    ech = { t: a[0] + ((b[0] - a[0]) * (e.z - a[1])) / h, z: e.z, c: e.c, s: echStatus(e) };
  }
  let rappel: SideView["rappel"] = null;
  if (!R.ech) rappel = { text: "Échappée libre : tout l'escalier passe sous la trémie.", s: "ok" };
  else if (!e || Math.abs(R.ech.c - e.c) >= 0.5) {
    const where = echWhere(R.ech, R.echCotes);
    rappel = {
      text: `Échappée la plus faible : ${fmt(R.ech.c)} mm${where ? ` ${where}` : ""}, sur la marche ${R.ech.j}.`,
      s: R.st.ech,
    };
  }
  return { noses, steps, range, floors, edges, ech, rappel };
}

/** Rôles propres à la vue de côté, en plus de ceux du plan. */
export type SideRole = PlanRole | "sd-dalle" | "sd-sol" | "sd-ech";

/** Éléments de la vue de côté : ceux du plan, avec leurs rôles ; une cote peut porter un état. */
export type SideShape = (PlanShape extends infer S ? (S extends unknown ? Omit<S, "role"> : never) : never) & {
  role: SideRole;
  s?: Status;
};

export interface SideDrawing {
  shapes: SideShape[];
  /** Cadre du dessin : x0, y0, largeur, hauteur. */
  box: [number, number, number, number];
}

/** Vue de côté cotée, développée sur la ligne de foulée (montée vers la droite, hauteur vers le haut).
    big : texte agrandi pour un écran de téléphone, en hauteur, où le dessin en largeur est réduit. */
export function sideShapes(R: Stair, big = false): SideDrawing {
  const p = R.params,
    S = sideView(R),
    { h, H, ceil } = R;
  const T = (t: number, z: number): Pt => [t, -z];
  // Corps du texte : le dessin est fait pour un cadre deux fois plus large que haut.
  const fs = (Math.max(S.range[1] - S.range[0] + 1000, (H + 800) * 1.9) / 34) * (big ? 1.5 : 1);
  const shapes: SideShape[] = [],
    pts: Pt[] = [];
  const add = (s: SideShape, ...at: Pt[]) => {
    shapes.push(s);
    pts.push(...at);
  };
  const rect = (t0: number, t1: number, z0: number, z1: number, role: SideRole) => {
    const q = [T(t0, z0), T(t1, z0), T(t1, z1), T(t0, z1)];
    add({ k: "poly", role, pts: q, fine: true }, ...q);
  };
  const line = (role: SideRole, ...q: Pt[]) => add({ k: "line", role, pts: q }, ...q);
  /** Texte détouré ; le cadre du dessin compte sa largeur à peu près (chasse de la police des cotes). */
  const text = (
    role: SideRole,
    at: Pt,
    t: string,
    anchor: "start" | "middle" | "end",
    s?: Status,
    size = fs * 0.62,
  ) => {
    const w = 0.6 * size * t.length,
      x0 = anchor === "start" ? at[0] : anchor === "end" ? at[0] - w : at[0] - w / 2;
    const sh: SideShape = { k: "text", role, at, size, text: t, anchor, halo: Math.min(fs * 0.22, size * 0.35) };
    if (s) sh.s = s;
    add(sh, [x0, at[1] - size / 2], [x0 + w, at[1] + size / 2]);
  };
  const k = fs * 0.35;
  const tick = (q: Pt): [Pt, Pt] => [
    [q[0] - k, q[1] + k],
    [q[0] + k, q[1] - k],
  ];
  /** Cote horizontale de t0 à t1, à la hauteur z, rappels depuis zFrom. */
  const dimH = (t0: number, t1: number, z: number, zFrom: number | null, label: string) => {
    const a = T(t0, z),
      b = T(t1, z),
      up = z > (zFrom ?? z) ? 1 : -1;
    const segs: [Pt, Pt][] = [[a, b], tick(a), tick(b)];
    if (zFrom !== null) segs.push([T(t0, zFrom), T(t0, z + up * fs * 0.4)], [T(t1, zFrom), T(t1, z + up * fs * 0.4)]);
    add({ k: "path", role: "pl-dim", segs }, a, b);
    text("pl-dimtxt", T((t0 + t1) / 2, z + up * fs * 0.55), label, "middle");
  };
  /** Cote verticale de z0 à z1 à l'abscisse t, texte du côté side. */
  const dimV = (t: number, z0: number, z1: number, side: 1 | -1, label: string, role: SideRole = "pl-dim") => {
    const a = T(t, z0),
      b = T(t, z1);
    add({ k: "path", role, segs: [[a, b], tick(a), tick(b)] }, a, b);
    text("pl-dimtxt", T(t + side * fs * 0.45, (z0 + z1) / 2), label, side > 0 ? "start" : "end");
  };

  // Plancher haut, coupé le long de la ligne de foulée : dessus au sol fini du haut, dessous à ceil.
  for (const [t0, t1] of S.floors) {
    rect(t0, t1, ceil, H, "sd-dalle");
    line("sd-sol", T(t0, H), T(t1, H));
    if (p.ep > 0) line("sd-sol", T(t0, ceil), T(t1, ceil));
  }
  for (const e of S.edges) line("sd-sol", T(e.t, ceil), T(e.t, H));
  line("sd-sol", T(S.range[0], 0), T(S.range[1], 0));

  // Contremarches, marches et marche palière, épaisseurs vraies ; marches balancées et paliers en teinte.
  if (p.cm)
    R.risers.forEach((r, i) => {
      const t = S.noses[i]![0] + p.deb;
      rect(t, t + p.ecm, r.z0, r.z1, "pl-tread");
    });
  const bo = p.deb + (p.cm ? p.ecm : 0);
  for (const st of S.steps)
    rect(st.t0, st.t1 + bo, st.z - p.et, st.z, st.balanced || st.palier ? "pl-bal" : "pl-tread");
  if (R.mp) rect(R.Lw, R.Lw + R.mp.depth, H - R.mp.e, H, "pl-tread");
  // Ligne des nez, sur laquelle se mesure l'échappée.
  add({ k: "line", role: "pl-walk", pts: S.noses.map((q) => T(q[0], q[1])) });
  // Numéro juste sous sa marche, dans la hauteur de marche, à droite de la marche d'en dessous.
  const nSize = Math.min(fs * 0.62, 0.75 * (h - p.et));
  for (const st of S.steps)
    text("pl-num", T((st.t0 + bo + st.t1) / 2, st.z - p.et - 0.6 * nSize), String(st.j), "middle", undefined, nSize);

  // Pente : angle au nez d'arrivée, entre l'horizontale et la ligne des nez de la dernière volée, dans le vide
  // sous la trémie.
  const a = Math.atan2(h, R.g),
    r = 2.2 * R.g,
    nA = S.noses[S.noses.length - 1]!;
  const arc: Pt[] = Array.from({ length: 17 }, (_, i) =>
    T(nA[0] - r * Math.cos((a * i) / 16), nA[1] - r * Math.sin((a * i) / 16)),
  );
  add({ k: "path", role: "pl-dim", segs: [[T(nA[0], nA[1]), T(nA[0] - r * 1.15, nA[1])]] });
  line("pl-dim", ...arc);
  const am = T(nA[0] - (r + fs * 0.35) * Math.cos(a / 2), nA[1] - (r + fs * 0.35) * Math.sin(a / 2));
  text("pl-dimtxt", am, `${fmt(R.pente, 1)}°`, "end");

  // Hauteur de marche et giron cotés sur une marche vers le milieu de l'escalier, loin de la cote d'échappée.
  const mid = (q: SideStep) => (q.t0 + q.t1) / 2;
  const pal = (i: number) => !!S.steps[i]?.palier;
  const plain = S.steps.filter((_, i) => i >= 1 && !pal(i) && !pal(i - 1));
  // Loin aussi des cotes de palier, au-dessus de la marche d'avant et de celle d'après.
  const clear = plain.filter((q) => {
    const i = q.j - 1;
    return !pal(i - 2) && !pal(i + 1);
  });
  const cand = clear.length ? clear : plain;
  const far = cand.filter((q) => !S.ech || Math.abs(mid(q) - S.ech.t) > 2.5 * R.g);
  const st = (far.length ? far : cand.length ? cand : S.steps).reduce((b, q) =>
    Math.abs(mid(q) - 0.45 * R.Lw) < Math.abs(mid(b) - 0.45 * R.Lw) ? q : b,
  );
  dimH(st.t0, st.t1, st.z + fs * 1.3, st.z, `g ${fmt(st.t1 - st.t0, 1)}`);
  dimV(st.t0 - fs * 0.9, st.z - h, st.z, -1, `h ${fmt(h, 1)}`);
  // Profondeur des paliers sur la ligne de foulée.
  for (const q of S.steps) if (q.palier) dimH(q.t0, q.t1, q.z + fs * 1.3, q.z, fmt(q.t1 - q.t0));

  // Épaisseur du plancher cotée dans la trémie, au bord qui surplombe la montée (le plus proche de l'échappée),
  // loin de l'angle coté à l'arrivée.
  if (S.edges.length && p.ep > 0) {
    const ref = S.ech ? S.ech.t : 0,
      over = S.edges.filter((x) => x.open > 0);
    const e = (over.length ? over : S.edges).reduce((b, x) => (Math.abs(x.t - ref) < Math.abs(b.t - ref) ? x : b));
    dimV(e.t + e.open * fs * 0.8, ceil, H, e.open, `plancher ${fmt(p.ep)}`);
  }
  // Échappée la plus faible sur la ligne de foulée : du nez à la sous-face du plancher.
  if (S.ech) {
    const E = S.ech,
      q = T(E.t, E.z);
    add({ k: "circle", role: "pl-ech", c: q, r: fs * 0.3, fine: true, s: E.s }, q);
    const top = T(E.t, ceil);
    add({ k: "path", role: "sd-ech", segs: [[q, top], tick(top)], s: E.s }, top);
    text("pl-echtxt", T(E.t - fs * 0.45, (E.z + ceil) / 2), `échappée ${fmt(E.c)}`, "end", E.s);
  }

  // Cotes d'ensemble : hauteur à monter à droite, longueur de la ligne de foulée sous le sol.
  const xH = S.range[1] + fs * 1.2;
  const hA = T(xH, 0),
    hB = T(xH, H);
  add(
    {
      k: "path",
      role: "pl-dim",
      segs: [[hA, hB], tick(hA), tick(hB), [T(S.range[1], H), T(xH + fs * 0.4, H)]],
    },
    hA,
    hB,
  );
  add(
    {
      k: "text",
      role: "pl-dimtxt",
      at: T(xH + fs * 0.55, H / 2),
      size: fs * 0.62,
      anchor: "middle",
      rot: -90,
      text: fmt(H),
    },
    T(xH + fs * 1.0, H / 2),
  );
  dimH(0, R.Lw, -fs * 1.6, 0, R.quart ? `développé ${fmt(R.Lw)}` : fmt(R.Lw));
  if (S.rappel) text("pl-echtxt", T(S.range[0], -fs * 3.2), S.rappel.text, "start", S.rappel.s);

  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  const pad = fs * 0.8;
  const x0 = Math.min(...xs) - pad,
    y0 = Math.min(...ys) - pad;
  return { shapes, box: [x0, y0, Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad] };
}
