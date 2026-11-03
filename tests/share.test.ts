import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { linkOpensNew, paramsFromHash, paramsToHash, projectUrl, sameLink } from "../src/core/share";
import { compute } from "../src/core/stair";

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

  it("garde une cote hors bornes pour la signaler sur son champ", () => {
    const p = paramsFromHash("#H=1e15")!;
    expect(p.H).toBe(1e15);
    const r = compute(p);
    expect(r.ok ? [] : r.errors.map((e) => e.key)).toEqual(["H"]);
  });

  it("donne l'adresse qui rouvre l'escalier, forme comprise", () => {
    expect(projectUrl(DEFAULTS)).toBe("https://quart-de-tour.fr/app/#forme=quart-d");
    expect(paramsFromHash(projectUrl(DEFAULTS).split("#")[1]!)).toEqual(DEFAULTS);
    expect(projectUrl({ ...DEFAULTS, forme: "droit", H: 2850 })).toBe(
      "https://quart-de-tour.fr/app/#forme=droit&H=2850",
    );
  });

  it("compare les réglages comme le lien les écrit", () => {
    expect(sameLink(DEFAULTS, { ...DEFAULTS })).toBe(true);
    // Les valeurs calculées enregistrées ne comptent pas, le réglage manuel oui.
    expect(sameLink({ ...DEFAULTS, H: 3000 }, { ...DEFAULTS, H: 3000, n: 16, f: 400, hlj: 380 })).toBe(true);
    expect(sameLink({ ...DEFAULTS, nAuto: false, n: 16 }, { ...DEFAULTS, nAuto: false, n: 17 })).toBe(false);
    expect(sameLink({ ...DEFAULTS, nAuto: false, n: 16 }, { ...DEFAULTS, n: 16 })).toBe(false);
    expect(sameLink({ ...DEFAULTS, H: 3000 }, { ...DEFAULTS, H: 3100 })).toBe(false);
  });

  it("ouvre un lien en nouvel escalier sauf s'il redonne l'escalier ouvert", () => {
    const open = { ...DEFAULTS, H: 3000, n: 16 };
    const relu = paramsFromHash(`#${paramsToHash(open)}`)!;
    expect(relu.n).toBe(DEFAULTS.n);
    expect(linkOpensNew(relu, open)).toBe(false);
    expect(linkOpensNew({ ...relu, W: 900 }, open)).toBe(true);
    expect(linkOpensNew(relu, null)).toBe(true);
  });
});
