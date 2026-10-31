import type { BoardPart, CNC } from "../cnc/build";
import { cutRows, stockNotes, stringerFitNote, volumeText } from "../cnc/cutlist";
import type { Entity } from "../cnc/entities";
import { fmt } from "../core/format";
import type { Stair } from "../core/stair";
import { bbox, bulgePts, type Vertex } from "../core/vec";

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
  const [st, t] = stringerFitNote(boards, R);
  return `<div class="note ${st}">${t}</div>`;
}

/** Alerte si des pièces dépassent les plateaux disponibles. */
export function stockFitHTML(cnc: CNC, R: Stair): string {
  return stockNotes(cnc, R)
    .map(([st, t]) => `<div class="note ${st}">${t}</div>`)
    .join("");
}

/** Liste de débit : limons, marches, contremarches, garde-corps, poteau. */
export function cutListHTML(cnc: CNC, R: Stair): string {
  return (
    "<thead><tr><th>Pièce</th><th>Qté</th><th>Longueur</th><th>Largeur</th><th>Épaisseur</th></tr></thead><tbody>" +
    cutRows(cnc, R)
      .map(
        (r) => `<tr><td>${r.name}</td><td>${r.q}</td><td>${fmt(r.L)}</td><td>${fmt(r.l)}</td><td>${fmt(r.e)}</td></tr>`,
      )
      .join("") +
    "</tbody>" +
    `<tfoot><tr><td colspan="5">${volumeText(cnc, R)}</td></tr></tfoot>`
  );
}
