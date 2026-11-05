/* Plages de confort d'une volée : hauteur de marche, giron, Blondel, pente. */
import type { Stair } from "./stair-types";

/**
 * Plages des contrôles de confort, en mm (pente en degrés) : hors de min…max, « Limite » ;
 * au-delà de bad, « Hors norme ». gIn : giron côté jour des marches balancées.
 */
export const CONFORT = {
  h: { min: 155, max: 185, bad: 200 },
  g: { min: 240, max: 320, bad: 210 },
  blondel: { min: 600, max: 640, cible: 630, badMin: 580, badMax: 660 },
  pente: { max: 38, bad: 45 },
  gIn: { min: 100, conseil: 120, bad: 60 },
} as const;

/** Statuts de confort d'une hauteur de marche h et d'un giron g. */
export function comfortStatus(h: number, g: number): Pick<Stair["st"], "h" | "g" | "bl" | "pente"> {
  const C = CONFORT;
  const blondel = 2 * h + g,
    pente = (Math.atan2(h, g) * 180) / Math.PI;
  return {
    h: h > C.h.bad ? "bad" : h > C.h.max || h < C.h.min ? "warn" : "ok",
    g: g < C.g.bad ? "bad" : g < C.g.min || g > C.g.max ? "warn" : "ok",
    bl:
      blondel < C.blondel.badMin || blondel > C.blondel.badMax
        ? "bad"
        : blondel < C.blondel.min || blondel > C.blondel.max
          ? "warn"
          : "ok",
    pente: pente > C.pente.bad ? "bad" : pente > C.pente.max ? "warn" : "ok",
  };
}
