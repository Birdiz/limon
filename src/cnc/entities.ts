import type { Pt } from "../core/vec";

export type Layer = "DECOUPE" | "DEFONCE" | "CM_DESSUS" | "CM_DESSOUS" | "TEXTE";

/** Calques DXF et leur couleur ACI. */
export const LAYERS: readonly [Layer, number][] = [
  ["DECOUPE", 7],
  ["DEFONCE", 1],
  ["CM_DESSUS", 5],
  ["CM_DESSOUS", 4],
  ["TEXTE", 3],
];

export interface PolyEntity {
  kind: "poly";
  layer: Layer;
  pts: Pt[];
  closed: boolean;
}

export interface TextEntity {
  kind: "text";
  layer: Layer;
  x: number;
  y: number;
  /** Hauteur des caractères. */
  h: number;
  s: string;
  center?: boolean;
}

export type Entity = PolyEntity | TextEntity;
