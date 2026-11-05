/* Traçage à la main, pour l'atelier sans commande numérique : cotes des logements et du contour de chaque limon
   depuis le bout gauche et la rive basse du plateau, puis contour des marches qui ne sont pas des rectangles depuis
   la rive du nez. Mêmes pièces, mêmes repères que limons.dxf et marches.dxf. */
import { fmt } from "../core/format";
import type { Params } from "../core/params";
import type { Pieces } from "../core/pieces";
import { bbox, V, type Pt } from "../core/vec";
import { contourNames, pointName, ring, type Board, type LimonColors } from "./limons";
import { textWidth, wrap, type Page, type RGB } from "./pdf";

export interface TraceColors extends LimonColors {
  paper: RGB;
}

/** Cote au dixième, sans « ,0 ». */
const fmt1 = (v: number) => fmt(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1);

const FS = 7.5,
  ROW = 10.5,
  HEAD = 9;

/** Colonne d'un tableau : intitulé, largeur, texte de chaque ligne. */
type Col<T> = [title: string, w: number, get: (r: T) => string];

/** Tableau à deux rangées d'intitulés (groupes, puis colonnes), cotes alignées à droite ; renvoie sa hauteur. */
function table<T>(
  pg: Page,
  x: number,
  y: number,
  groups: [title: string, cols: number][],
  cols: Col<T>[],
  rows: readonly T[],
  C: TraceColors,
): number {
  const w = cols.reduce((s, c) => s + c[1], 0);
  pg.rect(x, y, w, 2 * HEAD + 1, { fill: C.paper });
  let cx = x,
    ci = 0;
  for (const [title, n] of groups) {
    const gw = cols.slice(ci, ci + n).reduce((s, c) => s + c[1], 0);
    if (title) pg.text(cx + gw / 2, y + HEAD - 2, title, { size: 6.5, bold: true, color: C.muted, anchor: "middle" });
    cx += gw;
    ci += n;
  }
  cx = x;
  cols.forEach(([title, cw], i) => {
    pg.text(i ? cx + cw - 5 : cx + 5, y + 2 * HEAD - 2.5, title, {
      size: 6.5,
      bold: true,
      color: C.muted,
      anchor: i ? "end" : "start",
    });
    cx += cw;
  });
  let ry = y + 2 * HEAD + 1;
  for (const r of rows) {
    cx = x;
    cols.forEach(([, cw, get], i) => {
      pg.text(i ? cx + cw - 5 : cx + 5, ry + ROW - 3, get(r), {
        size: FS,
        bold: i === 0,
        color: C.ink,
        anchor: i ? "end" : "start",
      });
      cx += cw;
    });
    pg.path(
      [
        [x, ry + ROW],
        [x + w, ry + ROW],
      ],
      { stroke: C.rule, width: 0.35 },
    );
    ry += ROW;
  }
  pg.rect(x, y, w, ry - y, { stroke: C.rule, width: 0.5 });
  return ry - y;
}

/* ---------- Limons ---------- */

/** Méthode, en tête des pages de traçage des limons. */
export function traceMethod(p: Params, rn: number): string[] {
  const ep = fmt1(p.et + 2 * Math.max(0, p.jeu));
  return [
    "1. Dresser la rive basse du plateau et tracer le bout gauche d'équerre : x se mesure le long de la rive depuis ce bout, y d'équerre depuis la rive.",
    "2. Contour : pointer a, b, c… et les joindre dans l'ordre. Les lettres sont aussi sur le dessin des limons.",
    `3. Marches : pointer le nez et le fond, les joindre, c'est le dessus de la marche ; tracer le dessous parallèle, ${ep} mm plus bas (marche et jeu).${rn > 0 ? ` Arrondir le bout côté nez au rayon ${fmt1(rn)}.` : ""}`,
    ...(p.cm
      ? [
          "4. Contremarches : sur le dessus de la marche, depuis le nez, pointer les deux distances données ; tracer d'équerre vers le bas jusqu'au dessus de la marche d'en dessous, ou jusqu'au sol.",
        ]
      : []),
    `${p.cm ? 5 : 4}. Défoncer à ${fmt(p.enc)} mm. Tous les dessus de marche d'un limon sont parallèles : la fausse équerre réglée comme indiqué les contrôle.`,
  ];
}

/** Réglage de la fausse équerre sur la rive, pour les dessus de marche. */
function penteText(b: Board): string {
  const a = Math.abs(b.pente);
  if (a < 0.05) return "dessus de marche parallèles à la rive";
  const sens = b.pente > 0 ? "montant" : "descendant";
  return `dessus de marche à ${fmt(a, 1)}° sur la rive, ${sens} vers la droite (fausse équerre : 1 000 le long de la rive, ${fmt(1000 * Math.tan((a * Math.PI) / 180))} d'équerre)`;
}

const MARCHE_W = 46,
  NUM_W = 46,
  PT_W = 30,
  GROUP_GAP = 14;

/** Groupes de colonnes du contour qui tiennent dans la largeur w. */
const contourGroups = (w: number) => Math.max(1, Math.floor((w + GROUP_GAP) / (PT_W + 2 * NUM_W + GROUP_GAP)));

/** Largeur du tableau des marches. */
const rowsWidth = (cm: boolean) => MARCHE_W + NUM_W * (cm ? 6 : 4);

/** Hauteur d'un bloc de limon dans une page de traçage de largeur w, en points. */
export function traceLimonHeight(b: Board, cm: boolean, w: number): number {
  const g = contourGroups(w - rowsWidth(cm) - 24);
  const rows = Math.max(b.rows.length, Math.ceil(b.contour.length / g));
  return 16 + 2 * HEAD + 1 + rows * ROW + (b.rows.some((r) => r.coupe) ? 11 : 0) + 4;
}

/** Bloc de traçage d'un limon : nom, fausse équerre, tableau des logements, tableau du contour. */
export function drawTraceLimon(pg: Page, b: Board, p: Params, x: number, y: number, w: number, C: TraceColors): void {
  const dims = `${fmt(Math.ceil(b.L))} × ${fmt(Math.ceil(b.H))} × ${fmt(p.el)}`;
  pg.text(x, y + 9, b.name, { size: 9.5, bold: true, color: C.ink });
  const tail = `${dims}${b.mirror ? ` · × 2 : pour le ${b.mirror}, mesurer x depuis le bout droit` : ""} · ${penteText(b)}`;
  pg.text(x + textWidth(b.name, 9.5, true) + 8, y + 9, tail, { size: 8, color: C.muted });
  const ty = y + 16;
  const xy = (q: Pt) => [fmt(q[0]), fmt(q[1])] as const;
  const cols: Col<Board["rows"][number]>[] = [
    ["Marche", MARCHE_W, (r) => `${r.label}${r.coupe ? " *" : ""}`],
    ["x", NUM_W, (r) => xy(r.nez)[0]],
    ["y", NUM_W, (r) => xy(r.nez)[1]],
    ["x", NUM_W, (r) => xy(r.fond)[0]],
    ["y", NUM_W, (r) => xy(r.fond)[1]],
    ...(p.cm
      ? ([
          ["de", NUM_W, (r) => (r.cm ? fmt(r.cm.d0) : "–")],
          ["à", NUM_W, (r) => (r.cm ? fmt(r.cm.d1) : "–")],
        ] as Col<Board["rows"][number]>[])
      : []),
  ];
  const h = table(
    pg,
    x,
    ty,
    [["", 1], ["Nez", 2], ["Fond", 2], ...(p.cm ? ([["Contremarche, depuis le nez", 2]] as [string, number][]) : [])],
    cols,
    b.rows,
    C,
  );
  if (b.rows.some((r) => r.coupe))
    pg.text(x, ty + h + 9, "* logement coupé par l'about : le point « nez » est pris sur l'about.", {
      size: 6.5,
      color: C.muted,
    });

  // Contour, en colonnes de points.
  const cx = x + rowsWidth(p.cm) + 24,
    g = contourGroups(w - rowsWidth(p.cm) - 24),
    per = Math.ceil(b.contour.length / g);
  const pts = b.contour.map((q, i) => ({ name: pointName(i), q }));
  for (let k = 0; k * per < pts.length; k++) {
    const part = pts.slice(k * per, (k + 1) * per);
    table(
      pg,
      cx + k * (PT_W + 2 * NUM_W + GROUP_GAP),
      ty,
      [
        ["", 1],
        [k ? "" : "Contour", 2],
      ],
      [
        ["Point", PT_W, (r) => r.name],
        ["x", NUM_W, (r) => fmt(r.q[0])],
        ["y", NUM_W, (r) => fmt(r.q[1])],
      ],
      part,
      C,
    );
  }
}

/* ---------- Marches ---------- */

/** Marche à tracer : son contour n'est pas un rectangle. */
export interface TreadCard {
  title: string;
  L: number;
  l: number;
  e: number;
  /** Contour vu de dessus, nez sur y = 0 ; sommets nommés a, b, c… depuis le bout gauche du nez. */
  pts: Pt[];
}

/** Contour d'équerre : quatre sommets, côtés parallèles aux rives. */
const rectangle = (pts: readonly Pt[]) =>
  pts.length === 4 &&
  pts.every((q, i) => {
    const n = pts[(i + 1) % 4]!;
    return Math.abs(q[0] - n[0]) < 0.5 || Math.abs(q[1] - n[1]) < 0.5;
  });

/** Marches, paliers et marche palière qui ne sont pas des rectangles, dans l'ordre de l'escalier. */
export function treadCards(cnc: Pieces, p: Params): TreadCard[] {
  const all = [
    ...cnc.treadParts.map((t) => ({ t, title: t.palier ? `Palier, marche ${t.j}` : `Marche ${t.j}`, e: p.et })),
    ...(cnc.mpPart ? [{ t: cnc.mpPart, title: "Marche palière", e: p.mpE }] : []),
  ];
  return all.flatMap(({ t, title, e }) => {
    const pts = ring(t.outline ?? []);
    return pts.length < 3 || rectangle(pts) ? [] : [{ title, L: t.L, l: t.l, e, pts }];
  });
}

const CARD_TITLE = 14,
  SKETCH = 92;

/** Lignes de contrôle d'une marche : longueur des côtés, diagonales d'un quadrilatère. */
function checksOf(pts: readonly Pt[]): string[] {
  const n = pts.length,
    d = (i: number, j: number) => fmt(V.len(V.sub(pts[j]!, pts[i]!)));
  const sides = pts.map((_, i) => `${pointName(i)}–${pointName((i + 1) % n)} ${d(i, (i + 1) % n)}`).join(" · ");
  return [`Côtés : ${sides}`, ...(n === 4 ? [`Diagonales : a–c ${d(0, 2)} · b–d ${d(1, 3)}`] : [])];
}

/** Hauteur d'une fiche de marche de largeur w, en points. */
export function treadCardHeight(c: TreadCard, w: number): number {
  const lines = checksOf(c.pts).flatMap((s) => wrap(s, 6.5, w - 16));
  return CARD_TITLE + SKETCH + 2 * HEAD + 1 + Math.ceil(c.pts.length / 2) * ROW + 10 + lines.length * 8.5 + 8;
}

/** Fiche d'une marche : croquis nommé, points depuis le bout gauche et la rive du nez, côtés pour contrôler. */
export function drawTreadCard(
  pg: Page,
  c: TreadCard,
  x: number,
  y: number,
  w: number,
  h: number,
  C: TraceColors,
): void {
  pg.rect(x, y, w, h, { stroke: C.rule, width: 0.5 });
  pg.text(x + 8, y + 12, c.title, { size: 8.5, bold: true, color: C.ink });
  pg.text(x + w - 8, y + 12, `${fmt(Math.ceil(c.L))} × ${fmt(Math.ceil(c.l))} × ${fmt(c.e)}`, {
    size: 7.5,
    color: C.muted,
    anchor: "end",
  });

  // Croquis, nez en bas, dans le cadre du débit.
  const b = bbox(c.pts),
    sw = w - 36,
    sh = SKETCH - 26;
  const k = Math.min(sw / (b.x1 - b.x0), sh / (b.y1 - b.y0));
  const ox = x + (w - (b.x1 - b.x0) * k) / 2,
    oy = y + CARD_TITLE + 8 + (sh + (b.y1 - b.y0) * k) / 2;
  const P = (q: Pt): Pt => [ox + (q[0] - b.x0) * k, oy - (q[1] - b.y0) * k];
  pg.rect(ox, oy - (b.y1 - b.y0) * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k, {
    stroke: C.rule,
    width: 0.4,
    dash: [2, 2],
  });
  pg.path(c.pts.map(P), { fill: C.chalkSoft, stroke: C.ink, width: 0.6 }, true);
  // Nez : côté a–b, sur la rive avant du débit.
  pg.path([P(c.pts[0]!), P(c.pts[1]!)], { stroke: C.chalk, width: 1.6 });
  const nm = P(V.mul(V.add(c.pts[0]!, c.pts[1]!), 0.5));
  pg.text(nm[0], nm[1] + 9, "nez", { size: 6.5, bold: true, color: C.chalk, anchor: "middle" });
  contourNames(pg, c.pts, P, C, 6.5);

  // Points, sur deux colonnes.
  const ty = y + CARD_TITLE + SKETCH,
    per = Math.ceil(c.pts.length / 2),
    tw = (w - 16 - 8) / 2;
  const pts = c.pts.map((q, i) => ({ name: pointName(i), q }));
  for (let g = 0; g * per < pts.length; g++)
    table(
      pg,
      x + 8 + g * (tw + 8),
      ty,
      [
        ["", 1],
        ["", 2],
      ],
      [
        ["Point", tw * 0.3, (r) => r.name],
        ["x", tw * 0.35, (r) => fmt(r.q[0])],
        ["y", tw * 0.35, (r) => fmt(r.q[1])],
      ],
      pts.slice(g * per, (g + 1) * per),
      C,
    );
  let ly = ty + 2 * HEAD + 1 + per * ROW + 10;
  for (const s of checksOf(c.pts))
    for (const ln of wrap(s, 6.5, w - 16)) {
      pg.text(x + 8, ly, ln, { size: 6.5, color: C.muted });
      ly += 8.5;
    }
}
