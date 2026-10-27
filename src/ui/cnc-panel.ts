import { oversize, stockVolume, tightBoards, type BoardPart, type CNC, type TreadPart } from "../cnc/build";
import type { Entity } from "../cnc/entities";
import { ceil10, fmt } from "../core/format";
import { DENSITE } from "../core/params";
import type { Stair } from "../core/stair";
import { V, bbox, type Pt, type Vertex } from "../core/vec";

/** Arcs DXF (bulge en troisième coordonnée) découpés en segments pour l'aperçu. */
export function bulgePts(pts: readonly Vertex[]): Vertex[] {
  const out: Vertex[] = [];
  pts.forEach((q, i) => {
    out.push(q);
    if (!q[2]) return;
    const a: Pt = [q[0], q[1]],
      nx = pts[(i + 1) % pts.length]!;
    const b = q[2],
      c = V.sub([nx[0], nx[1]], a);
    const ctr = V.add(V.add(a, V.mul(c, 0.5)), V.mul([-c[1], c[0]], (1 - b * b) / (4 * b)));
    const a0 = Math.atan2(q[1] - ctr[1], q[0] - ctr[0]),
      th = 4 * Math.atan(b),
      r = V.len(V.sub(a, ctr));
    for (let k = 1; k < 8; k++)
      out.push([ctr[0] + r * Math.cos(a0 + (th * k) / 8), ctr[1] + r * Math.sin(a0 + (th * k) / 8)]);
  });
  return out;
}

/** Aperçu SVG d'un jeu d'entités DXF (y vers le haut). */
export function previewSVG(ents: readonly Entity[], label: string): string {
  const pts: Vertex[] = [];
  ents.forEach((e) =>
    e.kind === "poly"
      ? pts.push(...e.pts)
      : e.kind === "circle"
        ? pts.push([e.x - e.r, e.y - e.r], [e.x + e.r, e.y + e.r])
        : pts.push([e.x, e.y + e.h]),
  );
  if (!pts.length) return "";
  const b = bbox(pts),
    pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.03;
  const P2 = (q: Vertex) => `${q[0].toFixed(1)},${(-q[1]).toFixed(1)}`;
  const body = ents
    .map((e) =>
      e.kind === "poly"
        ? `<polygon class="cx-${e.layer}" vector-effect="non-scaling-stroke" points="${bulgePts(e.pts).map(P2).join(" ")}"/>`
        : e.kind === "circle"
          ? `<circle class="cx-${e.layer}" vector-effect="non-scaling-stroke" cx="${e.x.toFixed(1)}" cy="${(-e.y).toFixed(1)}" r="${e.r}"/>`
          : `<text class="cx-TEXTE" x="${e.x.toFixed(1)}" y="${(-e.y).toFixed(1)}" font-size="${e.h}" ${e.center ? 'text-anchor="middle" dominant-baseline="central"' : e.right ? 'text-anchor="end"' : ""}>${e.s}</text>`,
    )
    .join("");
  return `<svg viewBox="${b.x0 - pad} ${-b.y1 - pad} ${b.x1 - b.x0 + 2 * pad} ${b.y1 - b.y0 + 2 * pad}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${label}">${body}</svg>`;
}

/** Alerte si des logements débordent sous le bord d'un limon. */
export function stringerFitHTML(boards: readonly BoardPart[], R: Stair): string {
  const tight = tightBoards(boards);
  const fixes = [
    R.hl < R.needM - 0.5 && `passez la hauteur de limon à ${fmt(ceil10(R.needM))} mm`,
    R.quart && R.hlj < R.needJ - 0.5 && `passez le limon de jour à ${fmt(R.hljAuto)} mm`,
  ].filter(Boolean);
  return tight.length
    ? `<div class="note warn">Des logements débordent sous le bord du limon (${tight.map((b) => b.name.toLowerCase()).join(", ")}) : ${fixes.join(" et ")}.</div>`
    : `<div class="note ok">Tous les logements tiennent dans les limons, avec au moins 20 mm de bois dessous${R.quart ? ` (limon de jour de ${fmt(R.hlj)} mm)` : ""}.</div>`;
}

/** Alerte si des pièces dépassent les plateaux disponibles. */
export function stockFitHTML(cnc: CNC, R: Stair): string {
  const { pL, pW } = R.params;
  const big = oversize(cnc, pL, pW);
  const plateau = `plateau de ${fmt(pL)} × ${fmt(pW)} mm`;
  const list = (ps: readonly TreadPart[]) => ps.map((q) => q.j).join(", ");
  const notes: string[] = [];
  const glued = (ps: readonly TreadPart[], one: string, many: string) => {
    const wide = ps.filter((q) => q.l > pW + 0.5),
      long = ps.filter((q) => q.L > pL + 0.5);
    if (wide.length)
      notes.push(
        `${wide.length > 1 ? many : one} ${list(wide)} plus ${one === "Marche" ? "profonde" : "haute"}${wide.length > 1 ? "s" : ""} que le plateau (jusqu'à ${fmt(Math.ceil(Math.max(...wide.map((q) => q.l))))} mm pour ${fmt(pW)}) : à reconstituer en lames collées, fil le long du nez.`,
      );
    if (long.length)
      notes.push(
        `${long.length > 1 ? many : one} ${list(long)} plus longue${long.length > 1 ? "s" : ""} que le plateau (jusqu'à ${fmt(Math.ceil(Math.max(...long.map((q) => q.L))))} mm pour ${fmt(pL)}).`,
      );
  };
  glued(big.treads, "Marche", "Marches");
  glued(big.risers, "Contremarche", "Contremarches");
  big.boards.forEach((b) =>
    notes.push(
      `${b.name.charAt(0)}${b.name.slice(1).toLowerCase()} (${fmt(Math.ceil(b.L))} × ${fmt(Math.ceil(b.l))} mm) plus grand que le ${plateau} : à abouter ou à débiter dans un plateau plus grand.`,
    ),
  );
  return notes.length
    ? notes.map((t) => `<div class="note warn">${t}</div>`).join("")
    : `<div class="note ok">Toutes les pièces tiennent dans un ${plateau}.</div>`;
}

interface CutRow {
  name: string;
  q: number;
  L: number;
  l: number;
  e: number;
}

/** Pièces identiques (au mm près) regroupées sur une ligne. */
function group(list: readonly TreadPart[], one: string, many: string, e: number): CutRow[] {
  const m = new Map<string, { L: number; l: number; js: number[] }>();
  list.forEach((it) => {
    const k = `${Math.ceil(it.L)}x${Math.ceil(it.l)}`;
    let g = m.get(k);
    if (!g) m.set(k, (g = { L: Math.ceil(it.L), l: Math.ceil(it.l), js: [] }));
    g.js.push(it.j);
  });
  return [...m.values()].map((g) => ({
    name: `${g.js.length > 1 ? many : one} ${g.js.join(", ")}`,
    L: g.L,
    l: g.l,
    q: g.js.length,
    e,
  }));
}

/** Liste de débit : limons, marches, contremarches, poteau. */
export function cutListHTML(cnc: CNC, R: Stair): string {
  const p = R.params;
  const rows: CutRow[] = [
    ...cnc.boardParts.map((b) => ({
      name: b.name.charAt(0) + b.name.slice(1).toLowerCase(),
      L: Math.ceil(b.L),
      l: Math.ceil(b.l),
      e: p.el,
      q: 1,
    })),
    ...group(cnc.treadParts, "Marche", "Marches", p.et),
    ...group(cnc.riserParts, "Contremarche", "Contremarches", p.ecm),
    ...(cnc.postPart
      ? [{ name: "Poteau", q: 1, L: Math.ceil(cnc.postPart.L), l: cnc.postPart.l, e: cnc.postPart.e }]
      : []),
  ];
  return (
    "<thead><tr><th>Pièce</th><th>Qté</th><th>Longueur</th><th>Largeur</th><th>Épaisseur</th></tr></thead><tbody>" +
    rows
      .map(
        (r) => `<tr><td>${r.name}</td><td>${r.q}</td><td>${fmt(r.L)}</td><td>${fmt(r.l)}</td><td>${fmt(r.e)}</td></tr>`,
      )
      .join("") +
    "</tbody>" +
    `<tfoot><tr><td colspan="5">${volumeText(cnc, R)}</td></tr></tfoot>`
  );
}

const ESSENCE_LABEL = { chene: "chêne", hetre: "hêtre", frene: "frêne", sapin: "sapin", noyer: "noyer" } as const;

/** Volume brut et poids approximatif selon l'essence. */
export function volumeText(cnc: CNC, R: Stair): string {
  const v = stockVolume(cnc, R),
    ess = R.params.ess;
  return `Volume brut débité : ${fmt(v, 3)} m³ de ${ESSENCE_LABEL[ess]}, soit environ ${fmt(Math.round((v * DENSITE[ess]) / 5) * 5)} kg (${fmt(DENSITE[ess])} kg/m³).`;
}
