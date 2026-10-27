import { fmt } from "./format";
import type { Essence, Forme, Params } from "./params";
import type { Stair } from "./stair";

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
