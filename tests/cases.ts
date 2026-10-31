import { DEFAULTS, type Params } from "../src/core/params";
import { compute, type Stair } from "../src/core/stair";

/** Configurations de référence : l'exemple par défaut dans les trois formes, plus des réglages manuels,
    chaque garde-corps, la marche palière et la trémie en L. */
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
};

export function stairOf(over: Partial<Params>): Stair {
  const r = compute({ ...DEFAULTS, ...over });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join(" "));
  return r.stair;
}
