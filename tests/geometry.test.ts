import { describe, expect, it } from "vitest";
import { makePoly, offsetPoly, polyAt, polyCut, polyPath } from "../src/core/poly";
import { closeRing, interp } from "../src/core/vec";

const L = makePoly([
  [0, 0],
  [0, 100],
  [50, 100],
]);

describe("polyligne", () => {
  it("cumule les longueurs", () => {
    expect(L.cum).toEqual([0, 100, 150]);
    expect(L.total).toBe(150);
  });

  it("place un point par abscisse curviligne, segments d'extrémité prolongés", () => {
    expect(polyAt(L, 40)).toEqual([0, 40]);
    expect(polyAt(L, 120)).toEqual([20, 100]);
    expect(polyAt(L, -10)).toEqual([0, -10]);
    expect(polyAt(L, 170)).toEqual([70, 100]);
  });

  it("extrait un chemin dans les deux sens, avec les sommets intermédiaires", () => {
    expect(polyPath(L, 50, 120)).toEqual([
      [0, 50],
      [0, 100],
      [20, 100],
    ]);
    expect(polyPath(L, 120, 50)).toEqual([
      [20, 100],
      [0, 100],
      [0, 50],
    ]);
  });

  it("coupe par une droite : la plus proche ou la première devant", () => {
    const near = polyCut(L, [30, 50], [-1, 0], "near")!;
    expect(near.p).toEqual([0, 50]);
    expect(near.s).toBe(50);
    expect(polyCut(L, [30, 50], [1, 0], "ahead")).toBeNull();
    const up = polyCut(L, [30, 50], [0, 1], "ahead")!;
    expect(up.p).toEqual([30, 100]);
    expect(up.s).toBe(130);
  });

  it("décale vers la droite du sens de parcours, angles raccordés", () => {
    const o = offsetPoly(L, 10);
    expect(o.pts.map((q) => q.map((v) => Math.round(v * 1e9) / 1e9))).toEqual([
      [10, 0],
      [10, 90],
      [50, 90],
    ]);
  });
});

describe("outils", () => {
  it("interpole par morceaux et reste constant hors bornes", () => {
    expect(interp([0, 10, 20], [0, 100, 100], 5)).toBe(50);
    expect(interp([0, 10, 20], [0, 100, 100], -1)).toBe(0);
    expect(interp([0, 10, 20], [0, 100, 100], 99)).toBe(100);
  });

  it("ferme un contour sans répéter le premier point", () => {
    expect(
      closeRing([
        [0, 0],
        [1, 0],
        [1, 0.01],
        [1, 1],
        [0, 0.01],
      ]),
    ).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });
});
