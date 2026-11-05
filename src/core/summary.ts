import { fmt } from "./format";
import { TOURS, isDemi, type Essence, type Forme, type GardeCorps, type Params, type Pose } from "./params";
import { CONFORT, echSidesShown, echStatus, type EchCote, type Headroom, type Stair, type Status } from "./stair";

export const FORME_LABEL: Record<Forme, string> = {
  droit: "Droit",
  "quart-g": "Quart tournant gauche",
  "quart-d": "Quart tournant droit",
  "dq-g": "Double quart tournant gauche",
  "dq-d": "Double quart tournant droit",
  "demi-g": "Demi-tournant gauche",
  "demi-d": "Demi-tournant droit",
};

export const ESSENCE_LABEL: Record<Essence, string> = {
  chene: "Chêne",
  hetre: "Hêtre",
  frene: "Frêne",
  chataignier: "Châtaignier",
  erable: "Érable",
  merisier: "Merisier",
  noyer: "Noyer",
  sapin: "Sapin",
  epicea: "Épicéa",
  douglas: "Douglas",
  meleze: "Mélèze",
};

export const GC_LABEL: Record<GardeCorps, string> = {
  aucun: "Aucun",
  balustres: "Balustres",
  lisses: "Lisses rampantes",
};
export const POSE_LABEL: Record<Pose, string> = { chant: "dans le chant", anglaise: "à l'anglaise" };

/** Nom d'un réglage pour l'artisan, comme à l'écran ; la trémie change de côté selon la forme. */
export const COTE_LABEL: Record<keyof Params, string> = {
  forme: "Forme",
  H: "Hauteur à monter",
  L: "Reculement",
  A: "Longueur côté départ",
  B: "Longueur côté arrivée",
  C: "Longueur côté fond",
  J: "Jour",
  W: "Emmarchement",
  fAuto: "Ligne de foulée automatique",
  f: "Ligne de foulée",
  nAuto: "Nombre de hauteurs automatique",
  n: "Nombre de hauteurs",
  mb: "Marches balancées",
  prog: "Progressivité",
  tournant: "Passage du tournant",
  ess: "Essence",
  et: "Épaisseur de marche",
  deb: "Débord de nez",
  rn: "Rayon du nez",
  nez: "Profil du nez",
  rai: "Rainures antidérapantes",
  raiN: "Nombre de rainures",
  raiL: "Largeur des rainures",
  raiP: "Profondeur des rainures",
  raiD: "Première rainure",
  raiE: "Entraxe des rainures",
  cm: "Contremarches",
  ecm: "Épaisseur de contremarche",
  cmPose: "Pose de la contremarche",
  cmEmb: "Embrèvement de la contremarche",
  el: "Épaisseur de limon",
  hl: "Hauteur de limon",
  hljAuto: "Hauteur du limon de jour automatique",
  hlj: "Hauteur du limon de jour",
  tAuto: "Trémie à calculer",
  ps: "Section du poteau",
  gc: "Côté jour",
  gcPose: "Pose sur le limon",
  mcL: "Largeur de main courante",
  mcH: "Hauteur de main courante",
  bs: "Section des balustres",
  tL: "Longueur de trémie",
  tX: "Trémie côté arrivée ou fond",
  tY: "Trémie côté départ ou arrivée",
  tForme: "Forme de la trémie",
  tbD: "Branche de trémie côté départ",
  tbA: "Branche de trémie côté arrivée",
  mp: "Marche palière",
  mpP: "Profondeur de marche palière",
  mpE: "Épaisseur de marche palière",
  ep: "Épaisseur du plancher",
  enc: "Encastrement",
  jeu: "Jeu d'assemblage",
  pL: "Longueur des plateaux",
  pW: "Largeur des plateaux",
};

/** Sections de réglage, dans l'ordre du pas à pas. */
export const SECTIONS = ["forme", "dimensions", "tremie", "marches", "bois", "gardecorps"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_TITLE: Record<Section, string> = {
  forme: "Forme",
  dimensions: "Dimensions",
  tremie: "Trémie",
  marches: "Marches",
  bois: "Bois",
  gardecorps: "Garde-corps",
};

export interface TurnSpan {
  from: number;
  to: number;
  z0: number;
  z1: number;
}

/** Chaque tournant : première et dernière marche balancée, et hauteur de leur dessus. */
export const turnSpans = (R: Stair): TurnSpan[] =>
  R.bals.map(({ a, b }) => ({ from: a + 1, to: b, z0: (a + 1) * R.h, z1: b * R.h }));

/** Résumé d'une ligne de chaque section, lisible quand elle est repliée. */
export function sectionSummaries(p: Params, R: Stair | null): Record<Section, string> {
  const tours = TOURS[p.forme],
    quart = tours > 0;
  const tre = R ? R.treDims : { tL: p.tL, tX: p.tX, tY: p.tY };
  const treTxt = quart
    ? `${(R ? R.treL : p.tForme === "L") ? (tours === 2 ? "en U, " : "en L, ") : ""}${fmt(tre.tY)} × ${fmt(tre.tX)}`
    : fmt(tre.tL);
  const spans = R ? turnSpans(R) : [];
  const pals = R?.paliers ?? [];
  const tourTxt = spans.length
    ? ` · tour${spans.length > 1 ? "s" : ""} ${spans.map((t) => `de ${fmt(t.z0)} à ${fmt(t.z1)}`).join(" et ")}`
    : pals.length
      ? ` · palier${pals.length > 1 ? "s" : ""} à ${pals.map((q) => fmt(q.j * R!.h)).join(" et ")}`
      : "";
  return {
    forme: FORME_LABEL[p.forme],
    dimensions: `${fmt(p.H)} de haut · ${isDemi(p.forme) ? `${fmt(p.A)} × ${fmt(p.B)}, jour ${fmt(p.J)}` : tours === 2 ? `${fmt(p.A)} × ${fmt(p.C)} × ${fmt(p.B)}` : quart ? `${fmt(p.A)} × ${fmt(p.B)}` : `${fmt(p.L)} de long`} · ${fmt(p.W)} de large`,
    tremie: p.tAuto ? (R ? `à calculer : ${treTxt}` : "à calculer") : treTxt,
    marches:
      (R
        ? `${R.n} hauteurs de ${fmt(R.h, 1)}${p.nAuto ? ", automatique" : ""}${tourTxt}`
        : p.nAuto
          ? "automatique"
          : `${p.n} hauteurs`) + (p.mp ? ` · marche palière de ${fmt(p.mpP)}` : ""),
    bois: `${ESSENCE_LABEL[p.ess]} · marches ${fmt(p.et)}${p.cm ? ` · contremarches ${fmt(p.ecm)}` : ", sans contremarches"}`,
    gardecorps: p.gc === "aucun" ? "aucun" : `${GC_LABEL[p.gc]} ${POSE_LABEL[p.gcPose]}`,
  };
}

/** Échappées détaillées, du jour au mur, avec leur intitulé (comme les girons de la fiche des marches). */
export const ECH_COTES: [EchCote, string][] = [
  ["jour", "Échappée jour"],
  ["foulee", "Échappée foulée"],
  ["mur", "Échappée mur"],
];

export const STATUS_LABEL: Record<Status, string> = { ok: "Bon", warn: "Limite", bad: "Hors norme" };

/** Contrôle affiché en tuile et dans la fiche : intitulé, valeur, unité, précision, état. */
export interface Check {
  k: string;
  v: string;
  unit: string;
  sub: string;
  s: Status | null;
}

export function checks(R: Stair): Check[] {
  const c = (k: string, v: string, unit: string, sub: string, s: Status | null): Check => ({ k, v, unit, sub, s });
  const ech = (k: string, e: Headroom | null, s = echStatus(e)) =>
    e ? c(k, fmt(e.c), "mm", `sur la marche ${e.j}`, s) : c(k, "Libre", "", "tout sous la trémie", s);
  return [
    c("Hauteur de marche", fmt(R.h, 1), "mm", `${R.n} hauteurs`, R.st.h),
    c("Giron", fmt(R.g, 1), "mm", `${R.n - 1} marches · foulée`, R.st.g),
    c("Blondel 2h + g", fmt(R.blondel), "mm", `cible ${CONFORT.blondel.min} à ${CONFORT.blondel.max}`, R.st.bl),
    c("Pente", fmt(R.pente, 1), "°", `foulée ${fmt(R.Lw)} mm`, R.st.pente),
    ...(echSidesShown(R) ? ECH_COTES.map(([cote, k]) => ech(k, R.echCotes[cote])) : [ech("Échappée", R.ech, R.st.ech)]),
    R.bal
      ? c(
          "Giron mini au jour",
          fmt(R.gInMin),
          "mm",
          `tour${R.bals.length > 1 ? "s" : ""} : ${turnSpans(R)
            .map((t) => `${R.bals.length > 1 ? "" : "marches "}${t.from} à ${t.to}`)
            .join(" et ")}`,
          R.st.gIn,
        )
      : R.paliers.length
        ? c(
            R.paliers.length > 1 ? "Paliers" : "Palier",
            R.paliers.map((q) => fmt(R.W + q.reste)).join(" et "),
            "mm",
            `profondeur · marche${R.paliers.length > 1 ? "s" : ""} ${R.paliers.map((q) => q.j).join(" et ")}`,
            null,
          )
        : c("Reculement", fmt(R.L), "mm", `emmarchement ${fmt(R.W)}`, null),
  ];
}
