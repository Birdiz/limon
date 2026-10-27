import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { paramsFromHash, paramsToHash } from "../src/core/share";

describe("lien de projet", () => {
  it("ne garde que les réglages qui diffèrent de l'exemple", () => {
    expect(paramsToHash(DEFAULTS)).toBe("");
    expect(paramsToHash({ ...DEFAULTS, forme: "droit", H: 2850, jeu: 0.8, cm: false })).toBe(
      "forme=droit&H=2850&jeu=0.8&cm=false",
    );
  });

  it("omet les valeurs calculées automatiquement", () => {
    expect(paramsToHash({ ...DEFAULTS, n: 18, hlj: 430, f: 400 })).toBe("");
    expect(paramsToHash({ ...DEFAULTS, nAuto: false, n: 18 })).toBe("n=18&nAuto=false");
  });

  it("relit un lien à l'identique", () => {
    const p = {
      ...DEFAULTS,
      forme: "quart-g" as const,
      ess: "noyer" as const,
      gc: "lisses" as const,
      gcPose: "anglaise" as const,
      A: 3100,
      nAuto: false,
      n: 16,
    };
    expect(paramsFromHash(`#${paramsToHash(p)}`)).toEqual(p);
  });

  it("ignore les liens sans réglages et les valeurs invalides", () => {
    expect(paramsFromHash("")).toBeNull();
    expect(paramsFromHash("#autre=1")).toBeNull();
    expect(paramsFromHash("#H=abc&forme=spirale&cm=oui&W=900")).toEqual({ ...DEFAULTS, W: 900 });
  });
});
