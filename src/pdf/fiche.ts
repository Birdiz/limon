import { buildCNC, type CNC } from "../cnc/build";
import { cutRows, stockNotes, stringerFitNote, volumeText } from "../cnc/cutlist";
import { fmt } from "../core/format";
import { isDemi } from "../core/params";
import { projectUrl } from "../core/share";
import { planShapes, type PlanRole, type PlanShape } from "../core/plan-shapes";
import { sideShapes, type SideRole, type SideShape } from "../core/side-shapes";
import type { Stair, Status } from "../core/stair";
import { ESSENCE_LABEL, FORME_LABEL, GC_LABEL, POSE_LABEL, STATUS_LABEL, checks, turnSpans } from "../core/summary";
import { A4, PdfDoc, hex, wrap, type Page, type RGB, type Stroke } from "./pdf";
import { boardHeight, boardScale, drawBoard, layBoards, type Board } from "./limons";
import { qrMatrix } from "./qr";

/** Couleurs du thème clair de la page, la fiche étant faite pour l'impression. */
const C = {
  ink: hex("#161b22"),
  muted: hex("#56606c"),
  rule: hex("#cbd2d9"),
  chalk: hex("#2b5db3"),
  chalkSoft: hex("#e3eaf5"),
  paper: hex("#eceff2"),
  white: hex("#ffffff"),
  ok: hex("#2e7d4f"),
  warn: hex("#856a00"),
  bad: hex("#b42318"),
  draft: hex("#e6a8a1"),
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
  /** Escalier pas encore dit fini : mention en tête et filigrane sur chaque page. */
  brouillon?: boolean;
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

/** Marches balancées du logo, tracées sur 100 unités comme public/favicon.svg. */
const LOGO_RISERS: [[number, number], [number, number]][] = [
  [
    [17.4, 75.5],
    [32.9, 28],
  ],
  [
    [20.5, 77.1],
    [49.9, 36.6],
  ],
  [
    [22.9, 79.5],
    [63.4, 50.1],
  ],
  [
    [24.5, 82.6],
    [72, 67.1],
  ],
];

/** Logo (l'éventail d'un quart tournant et sa flèche), coin haut gauche en (x, y), côté s. */
function logo(pg: Page, x: number, y: number, s: number): void {
  const k = s / 100;
  const P = (u: number, v: number): [number, number] => [x + u * k, y + v * k];
  const arc = (r: number, a0: number, a1: number) =>
    Array.from({ length: 25 }, (_, i) => {
      const a = ((a0 + ((a1 - a0) * i) / 24) * Math.PI) / 180;
      return P(14 + r * Math.cos(a), 86 + r * Math.sin(a));
    });
  pg.path([...arc(58, -90, 0), ...arc(14, 0, -90)], { fill: C.chalk }, true);
  for (const [a, b] of LOGO_RISERS) pg.path([P(...a), P(...b)], { stroke: C.white, width: 3.6 * k });
  pg.path(arc(74, -90, -14), { stroke: C.chalk, width: 7 * k });
  pg.circle(...P(14, 12), 3.5 * k, { fill: C.chalk });
  pg.path([P(88.5, 78.8), P(92.6, 66.4), P(79, 69.8)], { fill: C.chalk }, true);
}

function footer(pg: Page, o: FicheOptions, i: number, count: number): void {
  pg.text(M, A4.h - 24, `Quart de tour · ${o.nom}`, { size: 7.5, color: C.muted });
  pg.text(A4.w - M, A4.h - 24, `page ${i}/${count}`, { size: 7.5, color: C.muted, anchor: "end" });
  // Filigrane en lettres creuses, posé en dernier : il ne cache rien de la page. Le long de la diagonale ;
  // la ligne de base descend d'une demi-hauteur de capitale pour centrer les lettres sur la page.
  if (o.brouillon)
    pg.text(A4.w / 2 + 29, A4.h / 2 + 20, "BROUILLON", {
      size: 96,
      bold: true,
      color: C.draft,
      rot: -55,
      anchor: "middle",
      contour: 1.4,
    });
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
  "pl-ech-cote": { width: 0.8 },
  "pl-echtxt-cote": {},
  "pl-dim": { stroke: C.muted, width: 0.4 },
  "pl-dimtxt": {},
};

const SIDE_STYLE: Record<SideRole, Stroke> = {
  ...PLAN_STYLE,
  "sd-dalle": { fill: C.rule },
  "sd-sol": { stroke: C.ink, width: 0.7 },
  "sd-ech": { width: 0.8 },
};

/** Dessin vectoriel (plan ou vue de côté), ajusté dans le cadre (x, y, w, h). */
function drawShapes(
  pg: Page,
  { shapes, box }: { shapes: (PlanShape | SideShape)[]; box: [number, number, number, number] },
  style: Record<string, Stroke>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const sc = Math.min(w / box[2], h / box[3]);
  const ox = x + (w - box[2] * sc) / 2,
    oy = y + (h - box[3] * sc) / 2;
  const P = (q: readonly [number, number]): [number, number] => [ox + (q[0] - box[0]) * sc, oy + (q[1] - box[1]) * sc];
  for (const s of shapes) {
    const st = style[s.role]!;
    if (s.k === "poly") pg.path(s.pts.map(P), st, true);
    else if (s.k === "line") pg.path(s.pts.map(P), st);
    else if (s.k === "path")
      for (const seg of s.segs) pg.path(seg.map(P), "s" in s && s.s ? { ...st, stroke: ST[s.s] } : st);
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

/** Largeur du code QR de la page 1, en points (28 mm : un module d'au moins 0,35 mm pour un lien de 300 signes). */
const QR_W = 80;

/** Code QR du lien de l'escalier, coin haut droit en (x, y), et sa légende ; renvoie l'ordonnée sous la légende. */
function qrBlock(pg: Page, x: number, y: number, url: string): number {
  const m = qrMatrix(url),
    k = QR_W / m.length,
    x0 = x - QR_W;
  // Modules foncés par suites horizontales ; la marge claire de 4 modules est le blanc de la page autour.
  const runs: [number, number, number, number][] = [];
  m.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (!row[i]) continue;
      const i0 = i;
      while (row[i + 1]) i++;
      runs.push([x0 + i0 * k, y + j * k, (i - i0 + 1) * k, k]);
    }
  });
  pg.rects(runs, { fill: C.ink });
  pg.text(x - QR_W / 2, y + QR_W + 13, "Rouvrir cet escalier", {
    size: 8.5,
    bold: true,
    color: C.ink,
    anchor: "middle",
  });
  pg.text(x - QR_W / 2, y + QR_W + 23, "sur quart-de-tour.fr", { size: 7.5, color: C.muted, anchor: "middle" });
  return y + QR_W + 27;
}

/* ---------- Limons ---------- */

const LAND = { w: A4.h, h: A4.w };
/** Place laissée de chaque côté du limon pour les coupes d'about et la hauteur. */
const SIDE = 70;

interface LimonSheets {
  boards: Board[];
  /** Échelle commune, 1:n. */
  n: number;
  /** Limons de chaque page. */
  pages: number[][];
}

/** Limons à une même échelle, répartis sur des pages à l'italienne. */
function limonSheets(R: Stair, cnc: CNC): LimonSheets {
  const boards = layBoards(
    R,
    cnc.boardParts.map((b) => b.name.toLowerCase().replace(/^limon/, "Limon")),
  );
  const n = boardScale(boards, LAND.w - 2 * M - 2 * SIDE);
  const pages: number[][] = [];
  let y = Infinity;
  boards.forEach((b, i) => {
    const h = boardHeight(b, n);
    if (y + h > LAND.h - 44) {
      pages.push([]);
      y = 90;
    }
    pages[pages.length - 1]!.push(i);
    y += h + 12;
  });
  return { boards, n, pages };
}

function limonPage(doc: PdfDoc, R: Stair, L: LimonSheets, ids: number[], nom: string, i: number, count: number): void {
  const pg = doc.page(true);
  pg.text(M, 58, "Limons", { size: 18, bold: true, color: C.ink });
  pg.text(LAND.w - M, 46, nom, { size: 8.5, color: C.muted, anchor: "end" });
  pg.text(LAND.w - M, 58, `Vus côté marches, couchés dans le sens du plateau · échelle 1:${L.n}`, {
    size: 8.5,
    color: C.muted,
    anchor: "end",
  });
  pg.text(
    M,
    74,
    `Cotes en millimètres : nez depuis le bout gauche du plateau, hauteurs depuis sa rive basse, angles depuis sa rive. Logements défoncés de ${fmt(R.params.enc)} mm, jeu de ${fmt(R.params.jeu, 1)} mm par côté.`,
    { size: 8, color: C.muted },
  );
  let y = 90;
  for (const id of ids) {
    const b = L.boards[id]!;
    drawBoard(pg, b, L.n, M + SIDE, y, R.params.el, C);
    y += boardHeight(b, L.n) + 12;
  }
  pg.text(M, LAND.h - 24, `Quart de tour · ${nom}`, { size: 7.5, color: C.muted });
  pg.text(LAND.w - M, LAND.h - 24, `page ${i}/${count}`, { size: 7.5, color: C.muted, anchor: "end" });
}

function frame(pg: Page, x: number, y: number, w: number, h: number, title: string): void {
  pg.rect(x, y, w, h, { stroke: C.rule, width: 0.6 });
  heading(pg, x + 10, y + 16, title);
}

/** Fiche de l'escalier : cotes, contrôles, plan et vue 3D ; bois et fiche des marches ; liste de débit. */
export function fichePDF(R: Stair, o: FicheOptions): Uint8Array<ArrayBuffer> {
  const p = R.params;
  const doc = new PdfDoc(o.nom);
  const cnc = buildCNC(R);
  const limons = limonSheets(R, cnc);
  const PAGES = 3 + limons.pages.length;

  /* ---------- Page 1 ---------- */
  const pg = doc.page();
  // Bandeau de la marque, comme l'en-tête de la page : logo et nom à gauche, date à droite.
  logo(pg, M, 22, 22);
  pg.text(M + 28, 39, "QUART DE TOUR", { size: 11, bold: true, color: C.ink });
  pg.text(A4.w - M, 33, `Fiche escalier${o.brouillon ? " · brouillon" : ""} · ${o.date}`, {
    size: 8.5,
    color: C.muted,
    anchor: "end",
  });
  pg.text(A4.w - M, 44, "quart-de-tour.fr", { size: 8.5, color: C.muted, anchor: "end" });
  pg.path(
    [
      [M, 52],
      [A4.w - M, 52],
    ],
    { stroke: C.ink, width: 1.6 },
  );
  pg.text(M, 79, o.nom, { size: 22, bold: true, color: C.ink });
  pg.text(
    M,
    95,
    `Escalier ${FORME_LABEL[p.forme].toLowerCase()} · ${R.n} hauteurs de ${mm(R.h, 1)} · giron ${mm(R.g, 1)}`,
    { size: 10.5, color: C.muted },
  );

  const colW = (CW - 28) / 2;
  heading(pg, M, 114, "Cotes");
  const tre = R.quart
    ? `${mm(R.treDims.tY)} × ${mm(R.treDims.tX)}${R.treL ? `, en ${R.tours === 2 ? "U" : "L"} (branches ${fmt(R.treDims.tbD)} et ${fmt(R.treDims.tbA)})` : ""}`
    : mm(R.treDims.tL);
  const spans = turnSpans(R);
  const cotes: [string, string][] = [
    ["Hauteur à monter", mm(R.H)],
    ...(R.quart
      ? ([
          ["Longueur côté départ", mm(R.A)],
          ...(R.tours > 1
            ? ([isDemi(p.forme) ? ["Jour, limons compris", mm(p.J)] : ["Longueur côté fond", mm(R.C)]] as [
                string,
                string,
              ][])
            : []),
          ["Longueur côté arrivée", mm(R.B)],
        ] as [string, string][])
      : ([["Reculement", mm(R.L)]] as [string, string][])),
    ["Emmarchement", mm(R.W)],
    [R.tAuto ? "Trémie à prévoir" : "Trémie", tre],
    ["Épaisseur du plancher", mm(p.ep)],
    ["Ligne de foulée (depuis le jour)", mm(R.f)],
    ...(R.bal && spans.length === 1
      ? ([
          ["Marches balancées", `${R.bal.m} · progressivité ${fmt(R.bal.pr * 100)} %`],
          ["Tour", `marches ${spans[0]!.from} à ${spans[0]!.to} · ${mm(spans[0]!.z0)} à ${mm(spans[0]!.z1)}`],
        ] as [string, string][])
      : spans.length > 1
        ? ([
            [
              "Marches balancées",
              `${R.bals.map((z) => z.m).join(" et ")} · progressivité ${fmt(Math.min(...R.bals.map((z) => z.pr)) * 100)} %`,
            ],
            ...spans.map(
              (t, i) =>
                [`${i ? "Second" : "Premier"} tour`, `marches ${t.from} à ${t.to} · ${mm(t.z0)} à ${mm(t.z1)}`] as [
                  string,
                  string,
                ],
            ),
          ] as [string, string][])
        : R.paliers.map(
            (q, i) =>
              [
                R.paliers.length > 1 ? `Palier ${i + 1}` : "Palier",
                `marche ${q.j} · ${mm(R.W + q.reste)} de profondeur`,
              ] as [string, string],
          )),
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
  const yQr = qrBlock(pg, A4.w - M, y - 7, projectUrl(p));
  y += 16;
  for (const [s, t] of R.notes) {
    const lines = wrap(t, 9.5, CW - QR_W - 32);
    pg.rect(M, y - 6.5, 5, 5, { fill: ST[s] });
    lines.forEach((ln, i) => pg.text(M + 12, y + i * 12.5, ln, { size: 9.5, color: C.ink }));
    y += lines.length * 12.5 + 3;
  }
  y = Math.max(y, yQr) + 10;

  const boxH = Math.min(A4.h - 48 - y, 380);
  if (o.vue3d) {
    const bw = (CW - 14) / 2;
    frame(pg, M, y, bw, boxH, "Plan");
    drawShapes(pg, planShapes(R), PLAN_STYLE, M + 10, y + 26, bw - 20, boxH - 36);
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
    drawShapes(pg, planShapes(R), PLAN_STYLE, M + 10, y + 26, CW - 20, boxH - 36);
  }
  footer(pg, o, 1, PAGES);

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
    ...(R.mp ? ([["Marche palière", `${fmt(R.mp.depth)} × ${fmt(R.mp.e)} mm`]] as [string, string][]) : []),
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
  const sideH = 210;
  frame(p2, M, y, CW, sideH, "Vue de côté, développée sur la ligne de foulée");
  drawShapes(p2, sideShapes(R), SIDE_STYLE, M + 10, y + 24, CW - 20, sideH - 32);
  y += sideH + 22;
  heading(p2, M, y, "Fiche des marches");
  y += 10;
  const cols: [string, (t: Stair["treads"][number]) => string][] = R.quart
    ? [
        ["Marche", (t) => (t.palier ? `${t.j} palier` : String(t.j))],
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
  footer(p2, o, 2, PAGES);

  /* ---------- Page 3 ---------- */
  const p3 = doc.page();
  p3.text(M, 58, "Liste de débit", { size: 18, bold: true, color: C.ink });
  p3.text(A4.w - M, 46, o.nom, { size: 8.5, color: C.muted, anchor: "end" });
  const rows = cutRows(cnc, R);
  const head = ["Pièce", "Qté", "Longueur", "Largeur", "Épaisseur"];
  // Colonne des pièces large (noms du type « Marches 1, 2, 3 ») ; cotes alignées à droite.
  const nameW = CW * 0.46,
    numW = (CW - nameW) / 4;
  const colX = (i: number) => (i === 0 ? M + 8 : M + nameW + numW * i - 8);
  y = 82;
  const rh = Math.min(15, (footY - y - 60) / (rows.length + 1));
  const size = Math.min(9, rh * 0.62);
  p3.rect(M, y, CW, rh, { fill: C.paper });
  head.forEach((h, i) =>
    p3.text(colX(i), y + rh * 0.68, h.toUpperCase(), {
      size: 7,
      bold: true,
      color: C.muted,
      anchor: i === 0 ? "start" : "end",
    }),
  );
  y += rh;
  for (const r of rows) {
    const cells = [r.name, String(r.q), fmt(r.L), fmt(r.l), fmt(r.e)];
    cells.forEach((c, i) =>
      p3.text(colX(i), y + rh * 0.68, c, { size, color: C.ink, anchor: i === 0 ? "start" : "end" }),
    );
    p3.path(
      [
        [M, y + rh],
        [M + CW, y + rh],
      ],
      { stroke: C.rule, width: 0.4 },
    );
    y += rh;
  }
  p3.rect(M, 82, CW, y - 82, { stroke: C.rule, width: 0.6 });
  p3.text(M, y + 16, "Cotes brutes de débit en millimètres, longueur dans le fil.", { size: 8, color: C.muted });
  y += 38;
  p3.text(M, y, volumeText(cnc, R), { size: 9.5, bold: true, color: C.ink });
  y += 22;
  heading(p3, M, y, "Fabrication");
  y += 16;
  for (const [s, t] of [stringerFitNote(cnc.boardParts, R), ...stockNotes(cnc, R)]) {
    const lines = wrap(t, 9.5, CW - 14);
    p3.rect(M, y - 6.5, 5, 5, { fill: ST[s] });
    lines.forEach((ln, i) => p3.text(M + 12, y + i * 12.5, ln, { size: 9.5, color: C.ink }));
    y += lines.length * 12.5 + 3;
  }
  footer(p3, o, 3, PAGES);

  limons.pages.forEach((ids, i) => limonPage(doc, R, limons, ids, o.nom, 4 + i, PAGES));

  return doc.bytes();
}
