import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { sectionSummaries } from "../src/core/summary";
import { stairOf } from "./cases";

describe("résumés des sections", () => {
  it("résume l'exemple en quart tournant", () => {
    const R = stairOf({});
    expect(sectionSummaries(R.params, R)).toEqual({
      forme: "Quart tournant droit",
      dimensions: "2 700 de haut · 2 900 × 1 800 · 850 de large",
      tremie: "2 550 × 1 850",
      marches: "15 hauteurs de 180,0, automatique · 7 balancées",
      bois: "Chêne · marches 40 · contremarches 22",
    });
  });

  it("montre la trémie calculée et l'escalier droit", () => {
    const R = stairOf({ forme: "droit", tAuto: true, cm: false, nAuto: false, n: 16 });
    const s = sectionSummaries(R.params, R);
    expect(s.dimensions).toBe("2 700 de haut · 3 650 de long · 850 de large");
    expect(s.tremie).toMatch(/^à calculer : /);
    expect(s.marches).toBe("16 hauteurs de 168,8");
    expect(s.bois).toBe("Chêne · marches 40, sans contremarches");
  });

  it("se passe du calcul quand les réglages sont impossibles", () => {
    expect(sectionSummaries({ ...DEFAULTS, tAuto: true }, null).tremie).toBe("à calculer");
  });
});
