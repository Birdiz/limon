import { describe, expect, it } from "vitest";
import type { Vertex } from "../src/core/vec";
import { bulgePts } from "../src/ui/cnc-panel";

describe("aperçu des arcs", () => {
  it("découpe un quart de cercle (bulge tan(π/8)) en points sur le cercle", () => {
    const B = Math.tan(Math.PI / 8);
    const pts: Vertex[] = [
      [10, 0, B],
      [0, 10],
      [0, 0],
    ];
    const out = bulgePts(pts);
    expect(out).toHaveLength(pts.length + 7);
    // Arc de (10, 0) à (0, 10) centré sur l'origine, dans le sens trigonométrique.
    for (const q of out.slice(1, 8)) {
      expect(Math.hypot(q[0], q[1])).toBeCloseTo(10, 9);
      expect(q[0]).toBeGreaterThan(0);
      expect(q[1]).toBeGreaterThan(0);
    }
  });

  it("laisse les segments droits tels quels", () => {
    const pts: Vertex[] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(bulgePts(pts)).toEqual(pts);
  });
});
