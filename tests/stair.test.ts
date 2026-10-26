import { describe, expect, it } from "vitest";
import { DEFAULTS, sanitizeParams } from "../src/core/params";
import { ECHAPPEE, compute, pickN } from "../src/core/stair";
import { stairOf } from "./cases";

describe("nombre de hauteurs", () => {
  it("vise Blondel 630 mm", () => {
    expect(pickN(2700, 3650)).toBe(15);
    const n = pickN(2700, 3650),
      h = 2700 / n,
      g = 3650 / (n - 1);
    expect(Math.abs(2 * h + g - 630)).toBeLessThan(15);
  });
});

describe("escalier droit", () => {
  const R = stairOf({ forme: "droit" });

  it("répartit hauteur et reculement", () => {
    expect(R.n).toBe(15);
    expect(R.h).toBe(180);
    expect(R.g).toBeCloseTo(3650 / 14, 9);
    expect(R.treads).toHaveLength(14);
    expect(R.risers).toHaveLength(15);
    expect(R.bal).toBeNull();
  });

  it("donne des girons égaux sur toute la largeur", () => {
    for (const t of R.treads) {
      expect(t.gIn).toBeCloseTo(R.g, 6);
      expect(t.gOut).toBeCloseTo(R.g, 6);
      expect(t.nez).toBeCloseTo(DEFAULTS.W, 6);
    }
  });

  it("a deux limons d'un seul tenant", () => {
    expect(R.stringers.map((s) => [s.side, s.count])).toEqual([
      ["in", 1],
      ["out", 1],
    ]);
  });

  it("signale une trémie trop courte et propose la longueur minimale", () => {
    const short = stairOf({ forme: "droit", L: 2400, tL: 1500 });
    expect(short.st.ech).not.toBe("ok");
    expect(short.ech!.c).toBeLessThan(ECHAPPEE);
    expect(short.tLmin).not.toBeNull();
    const fixed = stairOf({ forme: "droit", L: 2400, tL: short.tLmin! });
    expect(fixed.ech === null || fixed.ech.c >= ECHAPPEE).toBe(true);
  });
});

describe("quart tournant", () => {
  const D = stairOf({ forme: "quart-d" });
  const G = stairOf({ forme: "quart-g" });

  it("respecte les règles de confort avec l'exemple par défaut", () => {
    expect(D.notes[0]).toEqual(["ok", "Toutes les règles de confort sont respectées."]);
    expect(D.gInMin).toBeGreaterThanOrEqual(100);
  });

  it("balance les marches autour du tournant", () => {
    expect(D.bal).not.toBeNull();
    const balanced = D.treads.filter((t) => t.balanced);
    expect(balanced).toHaveLength(D.bal!.m);
    // Girons au jour plus courts dans le tournant, mais jamais nuls.
    for (const t of balanced) expect(t.gIn).toBeLessThan(D.g);
  });

  it("garde le même pas sur la ligne de foulée", () => {
    for (let k = 1; k < D.lines.length; k++) expect(D.lines[k]!.t - D.lines[k - 1]!.t).toBeCloseTo(D.g, 9);
  });

  it("calcule le gauche comme le droit (miroir au dessin)", () => {
    expect(G.treads.map((t) => [t.gIn, t.gOut, t.nez])).toEqual(D.treads.map((t) => [t.gIn, t.gOut, t.nez]));
    expect(G.notes).toEqual(D.notes);
  });

  it("coupe les limons au poteau : deux tronçons de chaque côté", () => {
    expect(D.stringers.map((s) => `${s.side}${s.idx + 1}/${s.count}`)).toEqual(["in1/2", "in2/2", "out1/2", "out2/2"]);
    expect(D.newel).not.toBeNull();
  });

  it("limite la progressivité pour garder 100 mm au jour", () => {
    const R = stairOf({ forme: "quart-d", mb: 3, prog: 100 });
    expect(R.bal!.pr).toBeLessThanOrEqual(1);
    expect(R.notes.some(([, t]) => t.startsWith("Balancement étendu") || t.startsWith("Progressivité limitée"))).toBe(
      true,
    );
  });
});

describe("validation", () => {
  it("refuse les dimensions impossibles", () => {
    const r = compute({ ...DEFAULTS, forme: "quart-d", W: 300, A: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContain("L'emmarchement doit faire au moins 400 mm.");
      expect(r.errors).toContain("La longueur côté départ doit dépasser l'emmarchement.");
    }
  });

  it("refuse un plancher plus épais que la hauteur le permet", () => {
    const r = compute({ ...DEFAULTS, ep: 2300 });
    expect(r.ok).toBe(false);
  });

  it("nettoie les réglages enregistrés", () => {
    const p = sanitizeParams({ forme: "spirale", H: "3000", W: 900, cm: "oui", ess: "noyer", extra: 1 });
    expect(p.forme).toBe(DEFAULTS.forme);
    expect(p.H).toBe(DEFAULTS.H);
    expect(p.W).toBe(900);
    expect(p.cm).toBe(DEFAULTS.cm);
    expect(p.ess).toBe("noyer");
    expect(p).not.toHaveProperty("extra");
  });
});
