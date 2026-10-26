import type { BoardPart, CNC, TreadPart } from "../cnc/build";
import type { Entity } from "../cnc/entities";
import { ceil10, fmt } from "../core/format";
import type { Stair } from "../core/stair";
import { bbox, type Pt } from "../core/vec";

/** Aperçu SVG d'un jeu d'entités DXF (y vers le haut). */
export function previewSVG(ents: readonly Entity[], label: string): string {
  const pts: Pt[] = [];
  ents.forEach((e) => (e.kind === "poly" ? pts.push(...e.pts) : pts.push([e.x, e.y + e.h])));
  if (!pts.length) return "";
  const b = bbox(pts),
    pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.03;
  const P2 = (q: Pt) => `${q[0].toFixed(1)},${(-q[1]).toFixed(1)}`;
  const body = ents
    .map((e) =>
      e.kind === "poly"
        ? `<polygon class="cx-${e.layer}" vector-effect="non-scaling-stroke" points="${e.pts.map(P2).join(" ")}"/>`
        : `<text class="cx-TEXTE" x="${e.x.toFixed(1)}" y="${(-e.y).toFixed(1)}" font-size="${e.h}" ${e.center ? 'text-anchor="middle" dominant-baseline="central"' : ""}>${e.s}</text>`,
    )
    .join("");
  return `<svg viewBox="${b.x0 - pad} ${-b.y1 - pad} ${b.x1 - b.x0 + 2 * pad} ${b.y1 - b.y0 + 2 * pad}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${label}">${body}</svg>`;
}

/** Alerte si des logements débordent sous le bord d'un limon. */
export function stringerFitHTML(boards: readonly BoardPart[], hl: number): string {
  const tight = boards.filter((b) => b.need > hl);
  return tight.length
    ? `<div class="note warn">Des logements débordent sous le bord du limon (${tight.map((b) => b.name.toLowerCase()).join(", ")}) : passez la hauteur de limon à ${fmt(ceil10(Math.max(...tight.map((b) => b.need))))} mm, ou élargissez ce limon dans le tournant.</div>`
    : `<div class="note ok">Tous les logements tiennent dans les limons, avec au moins 20 mm de bois dessous.</div>`;
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

/** Liste de débit : limons, marches, contremarches. */
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
  ];
  return (
    "<thead><tr><th>Pièce</th><th>Qté</th><th>Longueur</th><th>Largeur</th><th>Épaisseur</th></tr></thead><tbody>" +
    rows
      .map(
        (r) => `<tr><td>${r.name}</td><td>${r.q}</td><td>${fmt(r.L)}</td><td>${fmt(r.l)}</td><td>${fmt(r.e)}</td></tr>`,
      )
      .join("") +
    "</tbody>"
  );
}
