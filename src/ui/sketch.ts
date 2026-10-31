import type { Forme, FormeTremie } from "../core/params";

/*
 * Croquis de la cote en cours de saisie, en pas à pas : où prendre la mesure sur le chantier.
 * Dessins de principe sur 150 × 96, coupe pour les hauteurs et le reculement, plan pour le reste.
 * Les mêmes dessins, et quelques détails de fabrication, illustrent l'aide des champs.
 */

type Key = "H" | "L" | "A" | "B" | "W" | "tL" | "tX" | "tY" | "tbD" | "tbA" | "ep" | "mpP";

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

/** Trémie du quart tournant, en pointillés : rectangle, ou en L qui suit l'escalier. */
const TREMIE = (L: boolean) =>
  L ? '<path class="k-dash" d="M146 18H26V64H58V50H146"/>' : '<path class="k-dash" d="M26 18H146V64H26Z"/>';

const SKETCH: Record<Key, { svg: (quart: boolean, L: boolean) => string; text: string }> = {
  H: {
    svg: () => COUPE + '<path class="k-mut" d="M140 18H150" stroke-dasharray="2 2"/>' + tick(146, 18, 146, 88),
    text: "<b>Hauteur à monter</b> : du sol fini du bas au sol fini du haut.",
  },
  L: {
    svg: () => COUPE + tick(20, 95, 96, 95),
    text: "<b>Reculement</b> : du nez de la première marche au nez du palier.",
  },
  mpP: {
    svg: () =>
      '<path class="k-mut" d="M4 88H146"/>' +
      '<path class="k-slab" d="M4 18H24V30H4ZM110 18H140V30H110Z"/>' +
      '<path class="k-ink" d="M20 88V78H31V68H42V58H53V48H64V38H75V28H86M84 18H110V23H84Z"/>' +
      tick(84, 10, 110, 10),
    text: "<b>Marche palière</b> : sa profondeur depuis le nez. Le plancher reprend derrière elle.",
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
    svg: (_, L) => QUART + TREMIE(L) + tick(26, 6, 146, 6),
    text: "<b>Trémie côté arrivée</b> : depuis le bord du palier.",
  },
  tY: {
    svg: (_, L) => QUART + TREMIE(L) + tick(12, 18, 12, 64),
    text: "<b>Trémie côté départ</b> : depuis le mur face à la montée.",
  },
  tbD: {
    svg: () => QUART + TREMIE(true) + tick(26, 98, 58, 98),
    text: "<b>Branche côté départ</b> : la largeur de la trémie au-dessus de la volée de départ, depuis le mur.",
  },
  tbA: {
    svg: () => QUART + TREMIE(true) + tick(12, 18, 12, 50),
    text: "<b>Branche côté arrivée</b> : la largeur de la trémie au-dessus de la volée d'arrivée, depuis le mur face à la montée.",
  },
};

const isKey = (k: string): k is Key => k in SKETCH;

/** Nez de marche en coupe : marche à nez arrondi, contremarche dessous, contremarche suivante au fond. */
const NEZ =
  '<path class="k-ink" d="M146 36H31A7 7 0 0 0 24 43V49A7 7 0 0 0 31 56H146M54 56V98M62 56V98M118 2V36M126 2V36"/>' +
  '<path class="k-mut" d="M54 56V24" stroke-dasharray="2 2"/>';

/** Détails de fabrication, pour l'aide seulement (pas de cote à prendre sur le chantier). */
const DETAIL: Record<string, (quart: boolean) => string> = {
  // Ligne de foulée : trait mixte, cotée depuis le jour.
  f: (quart) =>
    quart
      ? QUART + '<path class="k-dash" d="M42 92V44Q42 34 52 34H146"/>' + tick(42, 86, 60, 86)
      : DROIT + '<path class="k-dash" d="M78 90V8"/>' + tick(78, 95, 98, 95),
  deb: () => NEZ + tick(24, 20, 54, 20),
  rn: () => NEZ + '<path class="k-dim" d="M31 36A7 7 0 0 0 24 43M24 49A7 7 0 0 0 31 56"/>',
  // Coupe en travers du limon : la marche entre dans son logement.
  enc: () =>
    '<path class="k-ink" d="M20 20H44V44H34V60H44V92H20Z"/>' +
    '<path class="k-ink" d="M146 44H34V60H146"/>' +
    '<path class="k-mut" d="M34 44V10M44 20V10" stroke-dasharray="2 2"/>' +
    tick(34, 12, 44, 12),
};

/** Croquis d'un champ pour son aide, sans légende ; null si le champ n'en a pas. */
export function sketchSVG(key: string, forme: Forme, tForme: FormeTremie = "rect"): string | null {
  const draw = isKey(key) ? SKETCH[key].svg : DETAIL[key];
  if (!draw) return null;
  const quart = forme !== "droit";
  // Le quart gauche est le miroir du droit.
  const flip = quart && forme === "quart-g" ? ' transform="matrix(-1 0 0 1 150 0)"' : "";
  return `<svg viewBox="0 0 150 100" aria-hidden="true"><g${flip}>${draw(quart, tForme === "L")}</g></svg>`;
}

/** Remplit le croquis d'une section avec la cote du champ donné, ou la première cote visible. */
export function showSketch(fig: HTMLElement, forme: Forme, focused?: string, tForme: FormeTremie = "rect"): void {
  const sec = fig.closest(".sbody")!;
  const visible = [...sec.querySelectorAll<HTMLInputElement>("input[type=number]")]
    .filter((el) => !el.closest("[hidden]") && isKey(el.id))
    .map((el) => el.id as Key);
  const key = focused && isKey(focused) && visible.includes(focused) ? focused : visible[0];
  if (!key) {
    fig.innerHTML = "";
    return;
  }
  fig.innerHTML = `${sketchSVG(key, forme, tForme)!}<figcaption>${SKETCH[key].text}</figcaption>`;
}
