import { DEFAULTS, type Params } from "../src/core/params";
import { compute, type Stair } from "../src/core/stair";

/** Configurations de référence : l'exemple par défaut dans les trois formes, plus des réglages manuels. */
export const CASES: Record<string, Partial<Params>> = {
  droit: { forme: "droit" },
  "quart-g": { forme: "quart-g" },
  "quart-d": { forme: "quart-d" },
  "quart-d-manuel": { forme: "quart-d", nAuto: false, n: 17, fAuto: false, f: 380, mb: 5, prog: 100, cm: false },
  "droit-court": { forme: "droit", L: 2400, tL: 1500 },
};

export function stairOf(over: Partial<Params>): Stair {
  const r = compute({ ...DEFAULTS, ...over });
  if (!r.ok) throw new Error(r.errors.join(" "));
  return r.stair;
}
