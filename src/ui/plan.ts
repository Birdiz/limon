import { planShapes, type PlanShape } from "../core/plan-shapes";
import { sideShapes, type SideShape } from "../core/side-shapes";
import type { Stair } from "../core/stair";
import type { Pt } from "../core/vec";

const xy = (q: Pt) => q[0].toFixed(1) + "," + q[1].toFixed(1);
const raw = (q: Pt) => `${q[0]},${q[1]}`;
const NS = ' vector-effect="non-scaling-stroke"';

function shapeSVG(s: PlanShape | SideShape): string {
  const cls = "s" in s && s.s ? `${s.role} ${s.s}` : s.role;
  switch (s.k) {
    case "poly":
      return s.fine
        ? `<polygon class="${cls}"${NS} points="${s.pts.map(xy).join(" ")}"/>`
        : `<polygon class="${cls}" points="${s.pts.map(raw).join(" ")}"/>`;
    case "line":
      return `<polyline class="${cls}"${NS} stroke-width="1.6" points="${s.pts.map(xy).join(" ")}"/>`;
    case "circle":
      return `<circle class="${cls}"${s.fine ? NS : ""} cx="${s.c[0]}" cy="${s.c[1]}" r="${s.r}"/>`;
    case "path":
      return `<path class="${cls}"${NS} d="${s.segs.map(([a, b]) => `M${raw(a)}L${raw(b)}`).join("")}"/>`;
    case "text":
      return s.rot !== undefined
        ? `<text class="${cls}" font-size="${s.size}" text-anchor="${s.anchor}" dominant-baseline="central" transform="translate(${raw(s.at)}) rotate(${s.rot})">${s.text}</text>`
        : `<text class="${cls}" x="${s.at[0]}" y="${s.at[1]}" font-size="${s.size}" stroke-width="${s.halo}" text-anchor="${s.anchor}" dominant-baseline="central">${s.text}</text>`;
  }
}

/** Plan coté de l'escalier en SVG, vue de dessus (montée vers le haut de l'écran). */
export function planSVG(R: Stair): string {
  const { shapes, box } = planShapes(R);
  return `<svg viewBox="${box.join(" ")}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Plan de l'escalier, vue de dessus">${shapes.map(shapeSVG).join("")}</svg>`;
}

/** Vue de côté cotée en SVG, développée sur la ligne de foulée (montée vers la droite) ; big : texte agrandi. */
export function sideSVG(R: Stair, big = false): string {
  const { shapes, box } = sideShapes(R, big);
  return `<svg viewBox="${box.join(" ")}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Vue de côté de l'escalier, développée sur la ligne de foulée">${shapes.map(shapeSVG).join("")}</svg>`;
}
