import { describe, expect, it } from "vitest";
import { DEFAULTS, sanitizeParams, type Params } from "../src/core/params";
import { ECHAPPEE, comfortableRun, compute, pickN, turnLengths, turnRange, type Stair } from "../src/core/stair";
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

describe("trémie à calculer", () => {
  const free = (R: ReturnType<typeof stairOf>) => R.ech === null || R.ech.c >= ECHAPPEE;

  it("prend la plus courte trémie qui donne l'échappée (droit)", () => {
    const R = stairOf({ forme: "droit", tAuto: true });
    expect(R.tAuto).toBe(true);
    expect(free(R)).toBe(true);
    expect(free(stairOf({ forme: "droit", tL: R.treDims.tL - 10 }))).toBe(false);
    expect(R.notes.some(([s, t]) => s === "info" && t.startsWith("Trémie à prévoir"))).toBe(true);
  });

  it("ouvre tout le côté arrivée et cherche le côté départ (quart tournant)", () => {
    const R = stairOf({ forme: "quart-d", tAuto: true });
    expect(R.treDims.tX).toBe(R.B + R.params.el);
    expect(R.tre.x0).toBe(-R.params.el);
    expect(free(R)).toBe(true);
    expect(free(stairOf({ forme: "quart-d", tX: R.treDims.tX, tY: R.treDims.tY - 10 }))).toBe(false);
  });

  it("garde la trémie saisie sinon", () => {
    const R = stairOf({ forme: "droit" });
    expect(R.treDims).toEqual({
      tL: DEFAULTS.tL,
      tX: DEFAULTS.tX,
      tY: DEFAULTS.tY,
      tbD: DEFAULTS.tbD,
      tbA: DEFAULTS.tbA,
    });
  });
});

describe("quart tournant", () => {
  const D = stairOf({ forme: "quart-d" });
  const G = stairOf({ forme: "quart-g" });

  it("respecte les règles de confort avec l'exemple par défaut", () => {
    expect(D.notes[0]).toEqual(["ok", "Escalier confortable : tout est dans les règles."]);
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

  it("place le tour plus bas en échangeant de la longueur entre départ et arrivée", () => {
    const p = { ...DEFAULTS, forme: "quart-d" as const };
    expect(D.bal!.a).toBe(6);
    expect(turnLengths(p, 6)).toEqual({ A: p.A, B: p.B });
    const ab = turnLengths(p, 2)!;
    expect(ab.A + ab.B).toBe(p.A + p.B);
    const R = stairOf({ forme: "quart-d", ...ab });
    expect(R.bal!.a).toBe(2);
    // Même ligne de foulée, donc mêmes hauteur et giron.
    expect([R.n, R.h, R.g]).toEqual([D.n, D.h, D.g]);
    expect(turnRange(p)).toEqual({ min: 0, max: 7 });
    expect(turnLengths(p, 8)).toBeNull();
  });

  it("refuse un balancement trop serré sans planter", () => {
    const r = compute({ ...DEFAULTS, mb: 2, A: 1120, B: 3580 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.key).toBe("mb");
  });

  it("limite la progressivité pour garder 100 mm au jour", () => {
    const R = stairOf({ forme: "quart-d", mb: 3, prog: 100 });
    expect(R.bal!.pr).toBeLessThanOrEqual(1);
    expect(R.notes.some(([, t]) => t.startsWith("Balancement étendu") || t.startsWith("Progressivité limitée"))).toBe(
      true,
    );
  });
});

describe("nez arrondi et limons", () => {
  it("détache une bande de nez de largeur rn, sauf nez vif", () => {
    const R = stairOf({ forme: "droit" });
    expect(R.rn).toBe(DEFAULTS.rn);
    for (const t of R.treads) expect(t.nose!.len).toBeCloseTo(DEFAULTS.W, 6);
    expect(stairOf({ forme: "droit", rn: 0 }).treads.every((t) => t.nose === null)).toBe(true);
  });

  it("ramène le rayon à la moitié de l'épaisseur de marche", () => {
    const R = stairOf({ forme: "droit", rn: 30, et: 40 });
    expect(R.rn).toBe(20);
    expect(R.notes.some(([s, t]) => s === "info" && t.startsWith("Rayon du nez ramené"))).toBe(true);
  });

  it("propose la hauteur du limon de jour d'après ses logements", () => {
    const R = stairOf({ forme: "quart-d" });
    expect(R.hljAuto).toBe(Math.max(150, Math.ceil(R.needJ / 10) * 10));
    expect(R.hlj).toBe(470);
    expect(R.stringers.map((s) => [s.side, s.hl])).toEqual([
      ["in", 470],
      ["in", 470],
      ["out", DEFAULTS.hl],
      ["out", DEFAULTS.hl],
    ]);
    for (const s of R.stringers) expect(s.need).toBeLessThanOrEqual(s.hl);
  });

  it("signale un limon de jour réglé trop bas", () => {
    const R = stairOf({ forme: "quart-d", hljAuto: false, hlj: 380 });
    expect(R.hlj).toBe(380);
    expect(R.notes.some(([s, t]) => s === "warn" && t.startsWith("Limon de jour trop étroit"))).toBe(true);
  });

  it("agrandit les logements du jeu d'assemblage", () => {
    const width = (jeu: number) => {
      const pk = stairOf({ forme: "droit", rn: 0, jeu }).stringers[0]!.pockets[5]!;
      return Math.max(...pk.map((q) => q[0])) - Math.min(...pk.map((q) => q[0]));
    };
    expect(width(1) - width(0)).toBeCloseTo(2, 6);
  });
});

describe("validation", () => {
  it("refuse les dimensions impossibles", () => {
    const r = compute({ ...DEFAULTS, forme: "quart-d", W: 300, A: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual({ key: "W", message: "L'emmarchement doit faire au moins 400 mm." });
      expect(r.errors).toContainEqual({ key: "A", message: "La longueur côté départ doit dépasser l'emmarchement." });
    }
  });

  it("rattache chaque erreur au champ à corriger", () => {
    const r = compute({ ...DEFAULTS, H: 120 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.key)).toEqual(["H", "ep"]);
  });

  it("demande un poteau plus large que le limon et des volées plus longues que lui", () => {
    const thin = compute({ ...DEFAULTS, ps: 60 });
    expect(thin.ok).toBe(false);
    if (!thin.ok) expect(thin.errors.map((e) => e.key)).toEqual(["ps"]);
    const big = compute({ ...DEFAULTS, ps: 900 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.errors.map((e) => e.key)).toEqual(["ps"]);
    expect(compute({ ...DEFAULTS, forme: "droit", ps: 60 }).ok).toBe(true);
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

describe("corrections proposées", () => {
  const fixes = (R: Stair) => R.notes.flatMap(([, , fix]) => (fix ? [fix.set] : []));
  const applyAll = (over: Partial<Params>) => {
    const R = stairOf(over);
    return stairOf({ ...over, ...Object.assign({}, ...fixes(R)) });
  };

  it("ne propose rien quand tout est bon", () => {
    expect(fixes(stairOf({ forme: "quart-d" }))).toEqual([]);
    expect(fixes(stairOf({ forme: "droit" }))).toEqual([]);
  });

  it("trouve le reculement le plus proche qui rend l'escalier confortable", () => {
    const run = comfortableRun(3200, 3650)!;
    expect(run).toEqual({ Lw: 4360, n: 18 });
    expect(comfortableRun(2700, 3650)).toEqual({ Lw: 3650, n: 15 });
  });

  it("corrige un escalier droit trop raide en un clic", () => {
    const R = stairOf({ forme: "droit", H: 3200 });
    expect(fixes(R)).toContainEqual({ L: 4360, nAuto: true });
    const F = applyAll({ forme: "droit", H: 3200 });
    expect([F.st.h, F.st.g, F.st.bl, F.st.pente]).toEqual(["ok", "ok", "ok", "ok"]);
    expect(F.notes[0]![0]).toBe("ok");
  });

  it("allonge le côté départ d'un quart tournant et ajoute des marches balancées", () => {
    const R = stairOf({ forme: "quart-d", H: 3200 });
    expect(fixes(R)).toEqual([{ A: 3590, nAuto: true }, { mb: 8 }, { hl: 350 }]);
    const F = applyAll({ forme: "quart-d", H: 3200 });
    expect(Object.values(F.st).every((s) => s === "ok")).toBe(true);
  });

  it("propose de revenir au nombre de hauteurs automatique, une seule fois", () => {
    const R = stairOf({ forme: "quart-d", nAuto: false, n: 12 });
    expect(fixes(R).filter((f) => f.nAuto && Object.keys(f).length === 1)).toHaveLength(1);
  });

  it("propose la trémie qui donne l'échappée", () => {
    const R = stairOf({ forme: "droit", L: 2400, tL: 1500 });
    expect(fixes(R)).toContainEqual({ tL: R.tLmin });
  });

  it("propose de remonter le limon de jour en automatique", () => {
    const R = stairOf({ forme: "quart-d", hljAuto: false, hlj: 380 });
    expect(fixes(R)).toContainEqual({ hljAuto: true });
  });
});
