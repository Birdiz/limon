import { DEFAULTS, EXEMPLE_DEMI, EXEMPLE_U, type Params } from "../src/core/params";
import { compute, type Stair } from "../src/core/stair";

/** Cotes confortables à palier : 15 hauteurs de 180 mm, trémie calculée. */
export const PALIER = {
  quart: { A: 2550, B: 2700, tAuto: true },
  dq: { A: 1950, C: 2550, B: 2100, tAuto: true },
  demi: { A: 2600, B: 2800, J: 200, tAuto: true },
} satisfies Record<string, Partial<Params>>;

/** Configurations de référence : l'exemple par défaut dans les trois formes, plus des réglages manuels,
    chaque garde-corps, la marche palière et la trémie en L ; le double quart et le demi-tournant avec leurs
    cotes d'exemple, et la trémie en U ; puis à palier. */
export const CASES: Record<string, Partial<Params>> = {
  droit: { forme: "droit" },
  "quart-g": { forme: "quart-g" },
  "quart-d": { forme: "quart-d" },
  "quart-d-manuel": { forme: "quart-d", nAuto: false, n: 17, fAuto: false, f: 380, mb: 5, prog: 100, cm: false },
  "droit-court": { forme: "droit", L: 2400, tL: 1500 },
  "quart-d-vif": { forme: "quart-d", rn: 0, jeu: 0 },
  "quart-g-reglages": { forme: "quart-g", hljAuto: false, hlj: 380, hl: 300, rn: 25, deb: 20, jeu: 1.2 },
  "quart-d-balustres": { forme: "quart-d", gc: "balustres" },
  "droit-anglaise": { forme: "droit", gc: "balustres", gcPose: "anglaise" },
  "quart-g-lisses": { forme: "quart-g", gc: "lisses" },
  "droit-palier": { forme: "droit", mp: true, mpE: 50, gc: "balustres", tAuto: true },
  "quart-d-palier-l": { forme: "quart-d", mp: true, tForme: "L", tAuto: true, gc: "lisses" },
  "quart-g-palier-l": {
    forme: "quart-g",
    mp: true,
    mpP: 350,
    tForme: "L",
    tX: 2200,
    tbD: 1000,
    tbA: 1000,
    gc: "balustres",
    gcPose: "anglaise",
  },
  "quart-d-l": { forme: "quart-d", tForme: "L", tbD: 1000, tbA: 1000 },
  "dq-d": { forme: "dq-d", ...EXEMPLE_U },
  "dq-g": { forme: "dq-g", ...EXEMPLE_U },
  "dq-d-balustres": { forme: "dq-d", ...EXEMPLE_U, gc: "balustres" },
  "dq-g-anglaise": { forme: "dq-g", ...EXEMPLE_U, gc: "balustres", gcPose: "anglaise", mb: 6, prog: 40 },
  "dq-d-palier-u": { forme: "dq-d", ...EXEMPLE_U, mp: true, tForme: "L", tAuto: true, gc: "balustres" },
  "demi-d": { forme: "demi-d", ...EXEMPLE_DEMI },
  "demi-g": { forme: "demi-g", ...EXEMPLE_DEMI },
  "demi-d-balustres": { forme: "demi-d", ...EXEMPLE_DEMI, gc: "balustres" },
  "demi-g-large": { forme: "demi-g", ...EXEMPLE_DEMI, J: 400, tX: 2190, gc: "lisses" },
  "quart-d-a-palier": { forme: "quart-d", tournant: "palier", ...PALIER.quart },
  "quart-g-a-palier-balustres": { forme: "quart-g", tournant: "palier", ...PALIER.quart, gc: "balustres" },
  "dq-d-a-palier": { forme: "dq-d", tournant: "palier", ...PALIER.dq },
  "demi-d-a-palier-balustres": { forme: "demi-d", tournant: "palier", ...PALIER.demi, gc: "balustres" },
  "dq-g-a-palier-mp-u": { forme: "dq-g", tournant: "palier", ...PALIER.dq, mp: true, tForme: "L", gc: "balustres" },
  "demi-g-a-palier-large": { forme: "demi-g", tournant: "palier", ...PALIER.demi, J: 400, gc: "balustres", cm: false },
};

export function stairOf(over: Partial<Params>): Stair {
  const r = compute({ ...DEFAULTS, ...over });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join(" "));
  return r.stair;
}
