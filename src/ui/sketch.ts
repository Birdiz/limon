import type { Forme } from "../core/params";

/*
 * Croquis de la cote en cours de saisie, en pas à pas : où prendre la mesure sur le chantier.
 * Dessins de principe sur 150 × 96, coupe pour les hauteurs et le reculement, plan pour le reste.
 */

type Key = "H" | "L" | "A" | "B" | "W" | "tL" | "tX" | "tY" | "ep";

const tick = (x1: number, y1: number, x2: number, y2: number) => {
  // Cote : trait et deux butées perpendiculaires.
  const v = x1 === x2;
  const t = (x: number, y: number) => (v ? `M${x - 4} ${y}H${x + 4}` : `M${x} ${y - 4}V${y + 4}`);
  return `<path class="k-dim" d="M${x1} ${y1}L${x2} ${y2}${t(x1, y1)}${t(x2, y2)}"/>`;
};

/** Coupe : sol, plancher haut percé de la trémie, volée de sept marches. */
const COUPE =
  '<path class="k-mut" d="M4 88H146"/>' +
  '<path class="k-slab" d="M4 18H24V30H4ZM96 18H140V30H96Z"/>' +
  '<path class="k-ink" d="M20 88V78H31V68H42V58H53V48H64V38H75V28H86V18H96"/>';

/** Plan d'un escalier droit : montée vers le haut, marches en travers. */
const DROIT =
  '<path class="k-ink" d="M58 8H98V90H58Z"/>' +
  '<path class="k-mut" d="M58 20H98M58 32H98M58 44H98M58 56H98M58 68H98M58 80H98"/>';

/** Plan d'un quart tournant à droite (le gauche en est le miroir) : départ en bas, arrivée à droite. */
const QUART =
  '<path class="k-ink" d="M24 92V16H146V52H60V92Z"/>' +
  '<path class="k-mut" d="M24 80H60M24 68H60M24 56H60M60 52L24 36M60 52L40 16M60 52L72 16M86 16V52M100 16V52M114 16V52M128 16V52"/>';

const SKETCH: Record<Key, { svg: (quart: boolean) => string; text: string }> = {
  H: {
    svg: () => COUPE + '<path class="k-mut" d="M140 18H150" stroke-dasharray="2 2"/>' + tick(146, 18, 146, 88),
    text: "<b>Hauteur à monter</b> : du sol fini du bas au sol fini du haut.",
  },
  L: {
    svg: () => COUPE + tick(20, 95, 96, 95),
    text: "<b>Reculement</b> : du nez de la première marche au nez du palier.",
  },
  ep: {
    svg: () => COUPE + tick(118, 18, 118, 30),
    text: "<b>Épaisseur du plancher</b> : du sol fini du haut à la sous-face du plafond.",
  },
  tL: {
    svg: () => COUPE + '<path class="k-dash" d="M24 24H96"/>' + tick(24, 8, 96, 8),
    text: "<b>Longueur de trémie</b> : depuis le bord du palier.",
  },
  W: {
    svg: (quart) => (quart ? QUART + tick(24, 99, 60, 99) : DROIT + tick(58, 98, 98, 98)),
    text: "<b>Emmarchement</b> : la largeur des marches, entre les deux limons.",
  },
  A: {
    svg: () => QUART + tick(12, 16, 12, 92),
    text: "<b>Longueur côté départ</b> : côté extérieur, hors limon.",
  },
  B: {
    svg: () => QUART + tick(24, 6, 146, 6),
    text: "<b>Longueur côté arrivée</b> : côté extérieur, hors limon.",
  },
  tX: {
    svg: () => QUART + '<path class="k-dash" d="M146 18H26V64H58V50H146"/>' + tick(26, 6, 146, 6),
    text: "<b>Trémie côté arrivée</b> : depuis le bord du palier.",
  },
  tY: {
    svg: () => QUART + '<path class="k-dash" d="M146 18H26V64H58V50H146"/>' + tick(12, 18, 12, 64),
    text: "<b>Trémie côté départ</b> : depuis le mur face à la montée.",
  },
};

const isKey = (k: string): k is Key => k in SKETCH;

/** Remplit le croquis d'une section avec la cote du champ donné, ou la première cote visible. */
export function showSketch(fig: HTMLElement, forme: Forme, focused?: string): void {
  const sec = fig.closest(".sbody")!;
  const visible = [...sec.querySelectorAll<HTMLInputElement>("input[type=number]")]
    .filter((el) => !el.closest("[hidden]") && isKey(el.id))
    .map((el) => el.id as Key);
  const key = focused && isKey(focused) && visible.includes(focused) ? focused : visible[0];
  if (!key) {
    fig.innerHTML = "";
    return;
  }
  const quart = forme !== "droit";
  // Le quart gauche est le miroir du droit.
  const flip = quart && forme === "quart-g" ? ' transform="matrix(-1 0 0 1 150 0)"' : "";
  fig.innerHTML = `<svg viewBox="0 0 150 100" aria-hidden="true"><g${flip}>${SKETCH[key].svg(quart)}</g></svg><figcaption>${SKETCH[key].text}</figcaption>`;
}
