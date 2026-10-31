import { describe, expect, it } from "vitest";
import { inPolygon } from "../src/core/headroom";
import { TOURS, type Forme } from "../src/core/params";
import { sideShapes, sideView } from "../src/core/side-shapes";
import { V } from "../src/core/vec";
import { CASES, stairOf } from "./cases";

describe.each(Object.entries(CASES))("vue de côté %s", (_, over) => {
  const R = stairOf(over);
  const S = sideView(R);

  it("déroule les marches sur la ligne de foulée, au giron de la foulée", () => {
    expect(S.steps).toHaveLength(R.n - 1);
    S.steps.forEach((st, i) => {
      expect(st.j).toBe(i + 1);
      expect(st.z).toBeCloseTo((i + 1) * R.h, 9);
      expect(st.t0).toBe(R.lines[i]!.t);
      expect(st.t1).toBe(R.lines[i + 1]!.t);
      expect(st.t1 - st.t0).toBeCloseTo(R.treads[i]!.gWalk, 9);
      if (!st.palier) expect(st.t1 - st.t0).toBeCloseTo(R.g, 9);
      expect(st.palier).toBe(R.treads[i]!.palier);
    });
    expect(S.noses[0]).toEqual([0, R.h]);
    expect(S.noses[S.noses.length - 1]![0]).toBeCloseTo(R.Lw, 9);
    expect(S.noses[S.noses.length - 1]![1]).toBeCloseTo(R.H, 9);
  });

  it("coupe le plancher aux bords de la trémie", () => {
    const open = (t: number) => inPolygon(R.walkAt(t), R.trePoly);
    for (const [t0, t1] of S.floors) {
      expect(t1).toBeGreaterThan(t0);
      for (const u of [0.01, 0.5, 0.99]) expect(open(t0 + (t1 - t0) * u)).toBe(false);
    }
    for (const e of S.edges) {
      expect(open(e.t + e.open * 0.01)).toBe(true);
      expect(open(e.t - e.open * 0.01)).toBe(false);
    }
    // Le plancher d'arrivée commence derrière la marche palière.
    const last = S.edges[S.edges.length - 1]!;
    expect(last.open).toBe(-1);
    expect(last.t).toBeCloseTo(R.Lw + (R.mp ? R.mp.depth : 0), 4);
  });

  it("cote l'échappée de la ligne de foulée à sa place", () => {
    const e = R.echCotes.foulee;
    if (!e) return expect(S.ech).toBeNull();
    expect(S.ech!.c).toBe(e.c);
    expect(R.ceil - S.ech!.z).toBeCloseTo(e.c, 9);
    // Le point du développé retombe en plan sur celui du calcul.
    expect(V.len(V.sub(R.walkAt(S.ech!.t), e.pt))).toBeLessThan(1e-6);
    // Le nez est sur la ligne des nez, entre les marches j et j + 1.
    const a = S.noses[e.j - 1]!,
      b = S.noses[e.j]!;
    expect(S.ech!.t).toBeGreaterThanOrEqual(a[0] - 1e-9);
    expect(S.ech!.t).toBeLessThanOrEqual(b[0] + 1e-9);
  });

  it("dessine dans son cadre, une étiquette par marche", () => {
    const { shapes, box } = sideShapes(R);
    const [x0, y0, w, h] = box;
    for (const s of shapes) {
      const pts =
        s.k === "poly" || s.k === "line" ? s.pts : s.k === "path" ? s.segs.flat() : [s.k === "circle" ? s.c : s.at];
      for (const q of pts) {
        expect(q[0]).toBeGreaterThanOrEqual(x0);
        expect(q[0]).toBeLessThanOrEqual(x0 + w);
        expect(q[1]).toBeGreaterThanOrEqual(y0);
        expect(q[1]).toBeLessThanOrEqual(y0 + h);
      }
    }
    expect(shapes.filter((s) => s.role === "pl-num")).toHaveLength(R.n - 1);
    const texts = shapes.flatMap((s) => (s.k === "text" ? [s.text] : []));
    expect(texts).toContain(R.quart ? `développé ${fmtFr(R.Lw)}` : fmtFr(R.Lw));
    expect(texts).toContain(fmtFr(R.H));
    expect(texts).toContain(`h ${fmtFr(R.h, 1)}`);
    expect(texts).toContain(`${fmtFr(R.pente, 1)}°`);
    for (const st of S.steps) if (st.palier) expect(texts).toContain(fmtFr(st.t1 - st.t0));
  });
});

const fmtFr = (v: number, d = 0) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

describe("vue de côté", () => {
  it("couvre les sept formes, en balancé et en palier", () => {
    const seen = new Set(Object.values(CASES).map((o) => `${o.forme}-${o.tournant ?? "balance"}`));
    for (const f of Object.keys(TOURS) as Forme[]) {
      expect(seen).toContain(`${f}-balance`);
      if (f !== "droit") expect(seen).toContain(`${f}-palier`);
    }
  });

  it("escalier droit : trémie de tL depuis le bord du plancher", () => {
    const R = stairOf(CASES.droit!);
    const S = sideView(R);
    expect(S.edges.map((e) => e.open)).toEqual([1, -1]);
    expect(S.edges[0]!.t).toBeCloseTo(R.L - R.treDims.tL, 4);
    expect(S.floors).toHaveLength(2);
    expect(S.floors[0]![0]).toBe(S.range[0]);
    expect(S.floors[1]![1]).toBe(S.range[1]);
    expect(S.rappel).toBeNull();
  });

  it("palier : giron de la foulée sur les volées, profondeur du palier cotée à part", () => {
    const R = stairOf(CASES["quart-d-a-palier"]!);
    const S = sideView(R);
    const pal = S.steps.filter((s) => s.palier);
    expect(pal.map((s) => s.j)).toEqual(R.paliers.map((q) => q.j));
    for (const s of pal) expect(s.t1 - s.t0).toBeGreaterThan(R.g);
  });

  it("rappelle l'échappée la plus faible quand elle tombe hors de la ligne de foulée", () => {
    // Trémie courte côté arrivée : le côté mur passe sous le plancher.
    const R = stairOf({ forme: "quart-d", tX: 1500 });
    const S = sideView(R);
    expect(R.ech!.c).toBeLessThan(R.echCotes.foulee!.c - 1);
    expect(S.ech!.c).toBe(R.echCotes.foulee!.c);
    expect(S.rappel!.text).toBe(`Échappée la plus faible : ${fmtFr(R.ech!.c)} mm côté mur, sur la marche ${R.ech!.j}.`);
    expect(S.rappel!.s).toBe("bad");
  });

  it("sans échappée, le dit", () => {
    const R = stairOf(CASES["demi-d"]!);
    expect(R.ech).toBeNull();
    const S = sideView(R);
    expect(S.ech).toBeNull();
    expect(S.rappel).toEqual({ text: "Échappée libre : tout l'escalier passe sous la trémie.", s: "ok" });
  });
});
