import { fmt } from "../core/format";
import { planShapes, type PlanRole } from "../core/plan-shapes";
import type { Stair, Status } from "../core/stair";
import { ESSENCE_LABEL, FORME_LABEL, GC_LABEL, POSE_LABEL, STATUS_LABEL, checks } from "../core/summary";
import { A4, PdfDoc, hex, wrap, type Page, type RGB, type Stroke } from "./pdf";

/** Couleurs du thème clair de la page, la fiche étant faite pour l'impression. */
const C = {
  ink: hex("#1b2129"),
  muted: hex("#5a6472"),
  rule: hex("#c9d0d9"),
  chalk: hex("#2b5db3"),
  chalkSoft: hex("#e3eaf5"),
  paper: hex("#edf0f3"),
  white: hex("#ffffff"),
  ok: hex("#2e7d4f"),
  warn: hex("#a2650f"),
  bad: hex("#b42318"),
} satisfies Record<string, RGB>;
const ST: Record<Status | "info", RGB> = { ok: C.ok, warn: C.warn, bad: C.bad, info: C.muted };

const M = 42;
const CW = A4.w - 2 * M;

const DISCLAIMER =
  "Girons mesurés de nez à nez. Repères de confort usuels (Blondel 600 à 640 mm, hauteur 160 à 185 mm, giron d'au moins 240 mm, échappée d'au moins 2 000 mm et jamais sous 1 900 mm) : à confronter au NF DTU 36.3 et aux exigences du chantier avant fabrication.";

export interface FicheOptions {
  nom: string;
  /** Date déjà mise en forme (« 27/10/2026 »). */
  date: string;
  /** Capture de la vue 3D en JPEG, si elle est disponible. */
  vue3d?: { data: Uint8Array; w: number; h: number };
}

const mm = (v: number, d = 0) => `${fmt(v, d)} mm`;

function heading(pg: Page, x: number, y: number, s: string): void {
  pg.text(x, y, s.toUpperCase(), { size: 8.5, bold: true, color: C.muted });
}

/** Lignes intitulé / valeur ; renvoie l'ordonnée sous la dernière ligne. */
function keyValues(pg: Page, x: number, y: number, w: number, rows: [string, string][]): number {
  for (const [k, v] of rows) {
    pg.text(x, y, k, { size: 9.5, color: C.muted });
    pg.text(x + w, y, v, { size: 9.5, bold: true, color: C.ink, anchor: "end" });
    pg.path(
      [
        [x, y + 4.5],
        [x + w, y + 4.5],
      ],
      { stroke: C.rule, width: 0.4 },
    );
    y += 15;
  }
  return y;
}

function footer(pg: Page, nom: string, i: number, count: number): void {
  pg.text(M, A4.h - 24, `Limon · ${nom}`, { size: 7.5, color: C.muted });
  pg.text(A4.w - M, A4.h - 24, `page ${i}/${count}`, { size: 7.5, color: C.muted, anchor: "end" });
}

const PLAN_STYLE: Record<PlanRole, Stroke> = {
  "pl-str": { fill: C.rule, stroke: C.muted, width: 0.5 },
  "pl-tread": { fill: C.white, stroke: C.ink, width: 0.5 },
  "pl-bal": { fill: C.chalkSoft, stroke: C.ink, width: 0.5 },
  "pl-gc": { stroke: C.chalk, width: 0.5 },
  "pl-tremie": { stroke: C.ink, width: 0.9, dash: [6, 2, 1, 2] },
  "pl-walk": { stroke: C.chalk, width: 0.9, dash: [3.5, 2.5] },
  "pl-walk-end": { fill: C.chalk },
  "pl-num": {},
  "pl-ech": { width: 1.1 },
  "pl-echtxt": {},
  "pl-dim": { stroke: C.muted, width: 0.4 },
  "pl-dimtxt": {},
};

/** Plan vectoriel, ajusté dans le cadre (x, y, w, h). */
function drawPlan(pg: Page, R: Stair, x: number, y: number, w: number, h: number): void {
  const { shapes, box } = planShapes(R);
  const sc = Math.min(w / box[2], h / box[3]);
  const ox = x + (w - box[2] * sc) / 2,
    oy = y + (h - box[3] * sc) / 2;
  const P = (q: readonly [number, number]): [number, number] => [ox + (q[0] - box[0]) * sc, oy + (q[1] - box[1]) * sc];
  for (const s of shapes) {
    const st = PLAN_STYLE[s.role];
    if (s.k === "poly") pg.path(s.pts.map(P), st, true);
    else if (s.k === "line") pg.path(s.pts.map(P), st);
    else if (s.k === "path") for (const seg of s.segs) pg.path(seg.map(P), st);
    else if (s.k === "circle") {
      const c = P(s.c);
      pg.circle(c[0], c[1], s.r * sc, s.s ? { ...st, stroke: ST[s.s] } : st);
    } else {
      // Texte centré sur sa hauteur : la ligne de base descend de 0,35 corps, dans le sens du texte tourné.
      const size = s.size * sc,
        a = ((s.rot ?? 0) * Math.PI) / 180;
      const at = P(s.at);
      const color = s.s ? ST[s.s] : s.role === "pl-dimtxt" ? C.muted : C.ink;
      pg.text(at[0] - 0.35 * size * Math.sin(a), at[1] + 0.35 * size * Math.cos(a), s.text, {
        size,
        color,
        bold: s.role === "pl-num",
        anchor: s.anchor,
        rot: s.rot ?? 0,
        ...(s.halo ? { halo: { color: C.white, width: s.halo * sc } } : {}),
      });
    }
  }
}

function frame(pg: Page, x: number, y: number, w: number, h: number, title: string): void {
  pg.rect(x, y, w, h, { stroke: C.rule, width: 0.6 });
  heading(pg, x + 10, y + 16, title);
}

/** Fiche de l'escalier : cotes, contrôles, plan et vue 3D, puis fiche des marches et bois. */
export function fichePDF(R: Stair, o: FicheOptions): Uint8Array<ArrayBuffer> {
  const p = R.params;
  const doc = new PdfDoc(o.nom);

  /* ---------- Page 1 ---------- */
  const pg = doc.page();
  pg.text(M, 58, o.nom, { size: 22, bold: true, color: C.ink });
  pg.text(A4.w - M, 46, `Fiche escalier · ${o.date}`, { size: 8.5, color: C.muted, anchor: "end" });
  pg.text(
    M,
    78,
    `Escalier ${FORME_LABEL[p.forme].toLowerCase()} · ${R.n} hauteurs de ${mm(R.h, 1)} · giron ${mm(R.g, 1)}`,
    { size: 11, color: C.muted },
  );
  pg.path(
    [
      [M, 90],
      [A4.w - M, 90],
    ],
    { stroke: C.ink, width: 0.8 },
  );

  const colW = (CW - 28) / 2;
  heading(pg, M, 114, "Cotes");
  const tre = R.quart ? `${mm(R.treDims.tY)} × ${mm(R.treDims.tX)}` : mm(R.treDims.tL);
  const cotes: [string, string][] = [
    ["Hauteur à monter", mm(R.H)],
    ...(R.quart
      ? ([
          ["Longueur côté départ", mm(R.A)],
          ["Longueur côté arrivée", mm(R.B)],
        ] as [string, string][])
      : ([["Reculement", mm(R.L)]] as [string, string][])),
    ["Emmarchement", mm(R.W)],
    [R.tAuto ? "Trémie à prévoir" : "Trémie", tre],
    ["Épaisseur du plancher", mm(p.ep)],
    ["Ligne de foulée (depuis le jour)", mm(R.f)],
    ...(R.bal
      ? ([["Marches balancées", `${R.bal.m} · progressivité ${fmt(R.bal.pr * 100)} %`]] as [string, string][])
      : []),
  ];
  let yL = keyValues(pg, M, 132, colW, cotes);

  const xR = M + colW + 28;
  heading(pg, xR, 114, "Contrôles");
  let yR = 132;
  for (const c of checks(R)) {
    pg.text(xR, yR, c.k, { size: 9.5, color: C.muted });
    pg.text(xR + colW - 62, yR, `${c.v}${c.unit ? ` ${c.unit}` : ""}`, {
      size: 9.5,
      bold: true,
      color: C.ink,
      anchor: "end",
    });
    if (c.s) pg.text(xR + colW, yR, STATUS_LABEL[c.s], { size: 8.5, bold: true, color: ST[c.s], anchor: "end" });
    pg.path(
      [
        [xR, yR + 4.5],
        [xR + colW, yR + 4.5],
      ],
      { stroke: C.rule, width: 0.4 },
    );
    yR += 15;
  }

  let y = Math.max(yL, yR) + 12;
  heading(pg, M, y, "Remarques");
  y += 16;
  for (const [s, t] of R.notes) {
    const lines = wrap(t, 9.5, CW - 14);
    pg.rect(M, y - 6.5, 5, 5, { fill: ST[s] });
    lines.forEach((ln, i) => pg.text(M + 12, y + i * 12.5, ln, { size: 9.5, color: C.ink }));
    y += lines.length * 12.5 + 3;
  }
  y += 10;

  const boxH = Math.min(A4.h - 48 - y, 380);
  if (o.vue3d) {
    const bw = (CW - 14) / 2;
    frame(pg, M, y, bw, boxH, "Plan");
    drawPlan(pg, R, M + 10, y + 26, bw - 20, boxH - 36);
    frame(pg, M + bw + 14, y, bw, boxH, "Vue 3D");
    const im = doc.jpeg(o.vue3d.data, o.vue3d.w, o.vue3d.h);
    const iw = bw - 20,
      ih = boxH - 36;
    const k = Math.min(iw / o.vue3d.w, ih / o.vue3d.h);
    const w = o.vue3d.w * k,
      h = o.vue3d.h * k;
    pg.image(im, M + bw + 24 + (iw - w) / 2, y + 26 + (ih - h) / 2, w, h);
  } else {
    frame(pg, M, y, CW, boxH, "Plan");
    drawPlan(pg, R, M + 10, y + 26, CW - 20, boxH - 36);
  }
  footer(pg, o.nom, 1, 2);

  /* ---------- Page 2 ---------- */
  const p2 = doc.page();
  p2.text(M, 58, "Bois et fiche des marches", { size: 18, bold: true, color: C.ink });
  p2.text(A4.w - M, 46, o.nom, { size: 8.5, color: C.muted, anchor: "end" });

  heading(p2, M, 88, "Bois");
  const bois: [string, string][] = [
    ["Essence", ESSENCE_LABEL[p.ess]],
    ["Épaisseur de marche", mm(p.et)],
    ["Débord de nez", mm(p.deb)],
    ["Rayon du nez", R.rn > 0 ? mm(R.rn, 1) : "vif"],
    ["Contremarches", p.cm ? mm(p.ecm) : "sans"],
  ];
  const asm: [string, string][] = [
    ["Épaisseur de limon", mm(p.el)],
    [R.quart ? "Hauteur du limon de mur" : "Hauteur de limon", mm(R.hl)],
    ...(R.quart
      ? ([
          ["Hauteur du limon de jour", mm(R.hlj)],
          ["Section du poteau", mm(p.ps)],
        ] as [string, string][])
      : []),
    ["Encastrement", mm(p.enc)],
    ["Jeu d'assemblage par côté", mm(p.jeu, 1)],
    ["Garde-corps", p.gc === "aucun" ? "aucun" : `${GC_LABEL[p.gc]} ${POSE_LABEL[p.gcPose]}`],
    ...(p.gc === "aucun" ? [] : ([["Main courante", `${fmt(p.mcL)} × ${fmt(p.mcH)} mm`]] as [string, string][])),
  ];
  yL = keyValues(p2, M, 106, colW, bois);
  heading(p2, xR, 88, "Limons et assemblage");
  yR = keyValues(p2, xR, 106, colW, asm);

  y = Math.max(yL, yR) + 14;
  heading(p2, M, y, "Fiche des marches");
  y += 10;
  const cols: [string, (t: Stair["treads"][number]) => string][] = R.quart
    ? [
        ["Marche", (t) => String(t.j)],
        ["Dessus", (t) => fmt(t.top, 1)],
        ["Giron jour", (t) => fmt(t.gIn, 1)],
        ["Giron foulée", (t) => fmt(t.gWalk, 1)],
        ["Giron extérieur", (t) => fmt(t.gOut, 1)],
        ["Longueur de nez", (t) => fmt(t.nez, 1)],
      ]
    : [
        ["Marche", (t) => String(t.j)],
        ["Dessus", (t) => fmt(t.top, 1)],
        ["Giron", (t) => fmt(t.gWalk, 1)],
        ["Longueur de nez", (t) => fmt(t.nez, 1)],
      ];
  const footY = A4.h - 70;
  const rowH = Math.min(15, (footY - y - 8) / (R.treads.length + 2));
  const cw = CW / cols.length;
  const cellX = (i: number) => (i === 0 ? M + 8 : M + cw * (i + 1) - 8);
  const anchorOf = (i: number) => (i === 0 ? "start" : "end") as "start" | "end";
  p2.rect(M, y, CW, rowH, { fill: C.paper });
  cols.forEach(([h], i) =>
    p2.text(cellX(i), y + rowH * 0.68, h.toUpperCase(), { size: 7, bold: true, color: C.muted, anchor: anchorOf(i) }),
  );
  y += rowH;
  const fs = Math.min(9, rowH * 0.62);
  for (const t of R.treads) {
    if (t.balanced) p2.rect(M, y, CW, rowH, { fill: C.chalkSoft });
    cols.forEach(([h, get], i) =>
      p2.text(cellX(i), y + rowH * 0.68, get(t), {
        size: fs,
        color: R.quart && h === "Giron jour" && t.gIn < 100 ? C.warn : C.ink,
        anchor: anchorOf(i),
      }),
    );
    p2.path(
      [
        [M, y + rowH],
        [M + CW, y + rowH],
      ],
      { stroke: C.rule, width: 0.4 },
    );
    y += rowH;
  }
  p2.text(cellX(0), y + rowH * 0.68, "Palier", { size: fs, color: C.ink });
  p2.text(cellX(1), y + rowH * 0.68, fmt(R.H, 1), { size: fs, color: C.ink, anchor: "end" });
  y += rowH;
  p2.rect(M, y - rowH * (R.treads.length + 2), CW, rowH * (R.treads.length + 2), { stroke: C.rule, width: 0.6 });
  if (R.quart) {
    p2.rect(M, y + 10, 10, 7, { fill: C.chalkSoft, stroke: C.rule, width: 0.4 });
    p2.text(M + 15, y + 16.5, "marches balancées · cotes en millimètres", { size: 8, color: C.muted });
  } else p2.text(M, y + 16.5, "Cotes en millimètres.", { size: 8, color: C.muted });

  wrap(DISCLAIMER, 7.5, CW).forEach((ln, i) => p2.text(M, footY + 14 + i * 10, ln, { size: 7.5, color: C.muted }));
  footer(p2, o.nom, 2, 2);

  return doc.bytes();
}
