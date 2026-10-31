import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { layBoards } from "../src/pdf/limons";
import { CASES, stairOf } from "./cases";

const boardsOf = (name: string) => {
  const R = stairOf(CASES[name]!);
  return {
    R,
    boards: layBoards(
      R,
      buildCNC(R).boardParts.map((b) => b.name),
    ),
  };
};

describe.each(Object.keys(CASES))("limons cotés %s", (name) => {
  const { R, boards } = boardsOf(name);

  it("numérote chaque marche sur au moins un limon", () => {
    const labels = new Set(boards.flatMap((b) => b.noses.map((q) => q.label)));
    for (const t of R.treads) expect(labels).toContain(String(t.j));
    if (R.mp) expect(labels).toContain("MP");
  });

  it("place les nez sur le plateau et coupe chaque bout", () => {
    for (const b of boards) {
      for (const q of b.noses) {
        expect(q.at[0]).toBeGreaterThanOrEqual(-0.01);
        expect(q.at[0]).toBeLessThanOrEqual(b.L + 0.01);
        expect(q.at[1]).toBeLessThanOrEqual(b.H + 0.01);
      }
      expect(b.cuts.filter((c) => c.kind === "aplomb").length).toBeGreaterThanOrEqual(1);
      expect(b.cuts.filter((c) => c.tenon).length).toBe(b.tenons.length);
    }
  });
});

describe("limons de l'escalier droit", () => {
  it("dessine une fois deux limons qui sont la même pièce retournée", () => {
    const { boards } = boardsOf("droit");
    expect(boards).toHaveLength(1);
    expect(boards[0]!.mirror).toBe("LIMON GAUCHE".toLowerCase());
  });

  it("garde les deux quand le limon de jour reçoit les balustres à l'anglaise", () => {
    const { boards } = boardsOf("droit-anglaise");
    expect(boards).toHaveLength(2);
    expect(boards[0]!.notes.join(" ")).toMatch(/balustres posés à l'anglaise/);
  });

  it("donne les coupes d'about de l'escalier droit : aplomb et sol à la pente", () => {
    const { R, boards } = boardsOf("droit");
    const sol = boards[0]!.cuts.find((c) => c.kind === "sol")!;
    const ang = (Math.atan2(Math.abs(sol.b[1] - sol.a[1]), Math.abs(sol.b[0] - sol.a[0])) * 180) / Math.PI;
    expect(ang).toBeCloseTo((Math.atan(R.h / R.g) * 180) / Math.PI, 1);
  });
});
