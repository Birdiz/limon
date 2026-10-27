import { fmt } from "./format";
import type { Essence, Forme, Params } from "./params";
import type { Stair, Status } from "./stair";

export const FORME_LABEL: Record<Forme, string> = {
  droit: "Droit",
  "quart-g": "Quart tournant gauche",
  "quart-d": "Quart tournant droit",
};

export const ESSENCE_LABEL: Record<Essence, string> = {
  chene: "Chêne",
  hetre: "Hêtre",
  frene: "Frêne",
  sapin: "Sapin",
  noyer: "Noyer",
};

/** Sections de réglage, dans l'ordre du pas à pas. */
export const SECTIONS = ["forme", "dimensions", "tremie", "marches", "bois"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_TITLE: Record<Section, string> = {
  forme: "Forme",
  dimensions: "Dimensions",
  tremie: "Trémie",
  marches: "Marches",
  bois: "Bois",
};

/** Résumé d'une ligne de chaque section, lisible quand elle est repliée. */
export function sectionSummaries(p: Params, R: Stair | null): Record<Section, string> {
  const quart = p.forme !== "droit";
  const tre = R ? R.treDims : { tL: p.tL, tX: p.tX, tY: p.tY };
  const treTxt = quart ? `${fmt(tre.tY)} × ${fmt(tre.tX)}` : fmt(tre.tL);
  return {
    forme: FORME_LABEL[p.forme],
    dimensions: `${fmt(p.H)} de haut · ${quart ? `${fmt(p.A)} × ${fmt(p.B)}` : `${fmt(p.L)} de long`} · ${fmt(p.W)} de large`,
    tremie: p.tAuto ? (R ? `à calculer : ${treTxt}` : "à calculer") : treTxt,
    marches: R
      ? `${R.n} hauteurs de ${fmt(R.h, 1)}${p.nAuto ? ", automatique" : ""}${R.bal ? ` · ${R.bal.m} balancées` : ""}`
      : p.nAuto
        ? "automatique"
        : `${p.n} hauteurs`,
    bois: `${ESSENCE_LABEL[p.ess]} · marches ${fmt(p.et)}${p.cm ? ` · contremarches ${fmt(p.ecm)}` : ", sans contremarches"}`,
  };
}

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
  return [
    c("Hauteur de marche", fmt(R.h, 1), "mm", `${R.n} hauteurs`, R.st.h),
    c("Giron", fmt(R.g, 1), "mm", `${R.n - 1} marches · foulée`, R.st.g),
    c("Blondel 2h + g", fmt(R.blondel), "mm", "cible 600 à 640", R.st.bl),
    c("Pente", fmt(R.pente, 1), "°", `foulée ${fmt(R.Lw)} mm`, R.st.pente),
    R.ech
      ? c("Échappée", fmt(R.ech.c), "mm", `sur la marche ${R.ech.j}`, R.st.ech)
      : c("Échappée", "Libre", "", "tout sous la trémie", R.st.ech),
    R.bal
      ? c("Giron mini au jour", fmt(R.gInMin), "mm", `${R.bal.m} balancées`, R.st.gIn)
      : c("Reculement", fmt(R.L), "mm", `emmarchement ${fmt(R.W)}`, null),
  ];
}
