import type { Vertex } from "../core/vec";

export type Layer = "DECOUPE" | "DEFONCE" | "CM_DESSUS" | "CM_DESSOUS" | "TEXTE" | "TENON" | "MORTAISE" | "PERCAGE";

/** Calques DXF et leur couleur ACI. */
export const LAYERS: readonly [Layer, number][] = [
  ["DECOUPE", 7],
  ["DEFONCE", 1],
  ["CM_DESSUS", 5],
  ["CM_DESSOUS", 4],
  ["TEXTE", 3],
];

/** Calques de l'assemblage au poteau, déclarés seulement dans les fichiers qui s'en servent. */
export const EXTRA_LAYERS: readonly [Layer, number][] = [
  ["TENON", 6],
  ["MORTAISE", 2],
  ["PERCAGE", 30],
];

export interface PolyEntity {
  kind: "poly";
  layer: Layer;
  pts: Vertex[];
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
  /** Aligné à droite sur (x, y). */
  right?: boolean;
}

export interface CircleEntity {
  kind: "circle";
  layer: Layer;
  x: number;
  y: number;
  r: number;
}

export type Entity = PolyEntity | TextEntity | CircleEntity;
