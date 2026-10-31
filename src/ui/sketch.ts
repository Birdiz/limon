import { TOURS, isLeft, type Forme, type FormeTremie } from "../core/params";

/*
 * Croquis de la cote en cours de saisie, en pas à pas : où prendre la mesure sur le chantier.
 * Dessins de principe sur 150 × 96, coupe pour les hauteurs et le reculement, plan pour le reste.
 * Les mêmes dessins, et quelques détails de fabrication, illustrent l'aide des champs.
 */

type Key = "H" | "L" | "A" | "B" | "C" | "J" | "W" | "tL" | "tX" | "tY" | "tbD" | "tbA" | "ep" | "mpP";

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

/** Plan d'un double quart tournant à droite : départ en bas à gauche, volée du fond en haut, arrivée en bas à droite. */
const DQ =
  '<path class="k-ink" d="M24 92V12H126V84H92V46H58V92Z"/>' +
  '<path class="k-mut" d="M24 80H58M24 68H58M24 58H58M58 46L24 36M58 46L38 12M75 12V46M92 46L112 12M92 46L126 36M92 58H126M92 70H126"/>';
/** Trémie en pointillés : rectangle, ou qui suit l'escalier (en L pour le quart, en U pour le double quart). */
const TREMIE = (tours: number, L: boolean) =>
  tours === 2
    ? L
      ? '<path class="k-dash" d="M20 84V8H130V84H88V50H62V84Z"/>'
      : '<path class="k-dash" d="M20 84V8H130V84Z"/>'
    : L
      ? '<path class="k-dash" d="M146 18H26V64H58V50H146"/>'
      : '<path class="k-dash" d="M26 18H146V64H26Z"/>';

const SKETCH: Record<Key, { svg: (tours: number, L: boolean) => string; text: string | ((tours: number) => string) }> =
  {
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
      svg: (tours) =>
        tours === 2 ? DQ + tick(24, 99, 58, 99) : tours ? QUART + tick(24, 99, 60, 99) : DROIT + tick(58, 98, 98, 98),
      text: "<b>Emmarchement</b> : la largeur des marches, entre les deux limons.",
    },
    A: {
      svg: (tours) => (tours === 2 ? DQ + tick(12, 12, 12, 92) : QUART + tick(12, 16, 12, 92)),
      text: "<b>Longueur côté départ</b> : côté extérieur, hors limon.",
    },
    B: {
      svg: (tours) => (tours === 2 ? DQ + tick(138, 12, 138, 84) : QUART + tick(24, 6, 146, 6)),
      text: "<b>Longueur côté arrivée</b> : côté extérieur, hors limon.",
    },
    C: {
      svg: () => DQ + tick(24, 4, 126, 4),
      text: "<b>Longueur côté fond</b> : entre les deux tournants, côté extérieur, hors limon.",
    },
    J: {
      svg: () => DQ + tick(58, 88, 92, 88),
      text: "<b>Jour</b> : entre les deux volées, limons de jour compris.",
    },

    tX: {
      svg: (tours, L) =>
        tours === 2 ? DQ + TREMIE(2, L) + tick(20, 3, 130, 3) : QUART + TREMIE(1, L) + tick(26, 6, 146, 6),
      text: (tours) =>
        tours === 2
          ? "<b>Trémie côté fond</b> : depuis le mur côté arrivée."
          : "<b>Trémie côté arrivée</b> : depuis le bord du palier.",
    },
    tY: {
      svg: (tours, L) =>
        tours === 2 ? DQ + TREMIE(2, L) + tick(142, 8, 142, 84) : QUART + TREMIE(1, L) + tick(12, 18, 12, 64),
      text: (tours) =>
        tours === 2
          ? "<b>Trémie côté arrivée</b> : depuis le bord du palier."
          : "<b>Trémie côté départ</b> : depuis le mur face à la montée.",
    },
    tbD: {
      svg: (tours) =>
        tours === 2 ? DQ + TREMIE(2, true) + tick(20, 97, 62, 97) : QUART + TREMIE(1, true) + tick(26, 98, 58, 98),
      text: (tours) =>
        tours === 2
          ? "<b>Branches des volées</b> : la largeur de la trémie au-dessus des volées de départ et d'arrivée, depuis chaque mur de côté."
          : "<b>Branche côté départ</b> : la largeur de la trémie au-dessus de la volée de départ, depuis le mur.",
    },
    tbA: {
      svg: (tours) =>
        tours === 2 ? DQ + TREMIE(2, true) + tick(142, 8, 142, 50) : QUART + TREMIE(1, true) + tick(12, 18, 12, 50),
      text: (tours) =>
        tours === 2
          ? "<b>Bande du fond</b> : la largeur de la trémie au-dessus de la volée du fond, depuis le mur du fond."
          : "<b>Branche côté arrivée</b> : la largeur de la trémie au-dessus de la volée d'arrivée, depuis le mur face à la montée.",
    },
  };

const isKey = (k: string): k is Key => k in SKETCH;

/** Nez de marche en coupe : marche à nez arrondi, contremarche dessous, contremarche suivante au fond. */
const NEZ =
  '<path class="k-ink" d="M146 36H31A7 7 0 0 0 24 43V49A7 7 0 0 0 31 56H146M54 56V98M62 56V98M118 2V36M126 2V36"/>' +
  '<path class="k-mut" d="M54 56V24" stroke-dasharray="2 2"/>';

/** Détails de fabrication, pour l'aide seulement (pas de cote à prendre sur le chantier). */
const DETAIL: Record<string, (tours: number) => string> = {
  // Ligne de foulée : trait mixte, cotée depuis le jour.
  f: (tours) =>
    tours === 2
      ? DQ + '<path class="k-dash" d="M41 92V39Q41 29 51 29H99Q109 29 109 39V84"/>' + tick(41, 86, 58, 86)
      : tours
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

/** Légende d'une cote, selon le nombre de tournants. */
const caption = (key: Key, tours: number) => {
  const { text } = SKETCH[key];
  return typeof text === "string" ? text : text(tours);
};

/** Croquis d'un champ pour son aide, sans légende ; null si le champ n'en a pas. */
export function sketchSVG(key: string, forme: Forme, tForme: FormeTremie = "rect"): string | null {
  const draw = isKey(key) ? SKETCH[key].svg : DETAIL[key];
  if (!draw) return null;
  // Une forme qui tourne à gauche est le miroir de celle de droite.
  const flip = isLeft(forme) ? ' transform="matrix(-1 0 0 1 150 0)"' : "";
  return `<svg viewBox="0 0 150 100" aria-hidden="true"><g${flip}>${draw(TOURS[forme], tForme === "L")}</g></svg>`;
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
  fig.innerHTML = `${sketchSVG(key, forme, tForme)!}<figcaption>${caption(key, TOURS[forme])}</figcaption>`;
}
