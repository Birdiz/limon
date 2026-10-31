import { describe, expect, it } from "vitest";
import { fmt } from "../src/core/format";
import { DEFAULTS, EXEMPLE_DEMI, EXEMPLE_U, type Params } from "../src/core/params";
import { planShapes, type PlanShape } from "../src/core/plan-shapes";
import type { Stair } from "../src/core/stair";
import { V, type Pt } from "../src/core/vec";
import { planSVG } from "../src/ui/plan";
import { CASES, PALIER, stairOf } from "./cases";

const { el } = DEFAULTS;

/** Cotes du plan : texte, ligne de cote (dans le repère du dessin), et si elle est masquée sur téléphone. */
interface Cote {
  text: string;
  a: Pt;
  b: Pt;
  detail: boolean;
}
function cotes(R: Stair): Cote[] {
  const shapes = planShapes(R).shapes;
  return shapes.flatMap((s, i) => {
    if (s.k !== "text" || s.role !== "pl-dimtxt") return [];
    // Chaque cote : traits (attaches et ligne de cote), deux traits obliques, puis le texte.
    const p = shapes[i - 3] as Extract<PlanShape, { k: "path" }>;
    const [a, b] = p.segs[2]!;
    return [{ text: s.text, a, b, detail: !!s.detail }];
  });
}
const valeur = (c: Cote) =>
  Number(
    /[\d\s\u202f,]+$/
      .exec(c.text)![0]
      .replace(/[\s\u202f]/g, "")
      .replace(",", "."),
  );
const find = (R: Stair, prefix: string) => cotes(R).filter((c) => c.text.startsWith(prefix));

describe("plan coté", () => {
  it.each(Object.entries(CASES))("%s : chaque cote vaut la longueur de sa ligne de cote", (_, over) => {
    const R = stairOf(over);
    const all = cotes(R);
    for (const c of all) expect(Math.abs(V.len(V.sub(c.b, c.a)) - valeur(c)), c.text).toBeLessThan(0.051);
    // Toujours la trémie en long et en travers, et un giron sur une marche droite.
    expect(find(R, "trémie ")).toHaveLength(2);
    expect(find(R, "giron ").map((c) => c.text)).toEqual([`giron ${fmt(R.g, 1)}`]);
  });

  it("escalier droit : la trémie depuis le départ, sur toute la largeur, limons compris", () => {
    const R = stairOf({ forme: "droit" });
    expect(find(R, "trémie ").map((c) => c.text)).toEqual([
      `trémie ${fmt(DEFAULTS.tL)}`,
      `trémie ${fmt(R.W + 2 * el)}`,
    ]);
    // Le reste de la longueur, du départ au bord de la trémie, masqué sur téléphone.
    const pos = cotes(R).find((c) => c.text === fmt(R.L - DEFAULTS.tL))!;
    expect(pos.detail).toBe(true);
    // Marche palière : le bord du plancher recule, la trémie calculée aussi.
    const P = stairOf(CASES["droit-palier"]!);
    expect(find(P, "trémie ")[0]!.text).toBe(`trémie ${fmt(P.treDims.tL)}`);
    expect(cotes(P).some((c) => c.text === fmt(P.L + P.mp!.depth - P.treDims.tL))).toBe(true);
  });

  it("quart tournant : la trémie depuis le départ et depuis le mur du départ, bornée par le mur", () => {
    const R = stairOf({ forme: "quart-d", tX: 1200, tY: 1800 });
    expect(find(R, "trémie ").map((c) => c.text)).toEqual([`trémie ${fmt(1800)}`, `trémie ${fmt(1200)}`]);
    const t = cotes(R);
    // Du départ au bord côté départ, du mur au bord côté jour : deux cotes de détail.
    for (const v of [R.A + el - 1800, R.B + el - 1200]) expect(t.find((c) => c.text === fmt(v))?.detail).toBe(true);
    // L'exemple va du bord du palier au mur ; plus large, la trémie s'arrête au mur.
    expect(find(stairOf({ forme: "quart-d" }), "trémie ")[1]!.text).toBe(`trémie ${fmt(DEFAULTS.tX)}`);
    const E = stairOf({ forme: "quart-d", tX: 1900 });
    expect(find(E, "trémie ")[1]!.text).toBe(`trémie ${fmt(E.B + el)}`);
    // Trémie calculée : les cotes retenues.
    const A = stairOf({ forme: "quart-d", tAuto: true });
    expect(find(A, "trémie ").map((c) => c.text)).toEqual([
      `trémie ${fmt(A.treDims.tY)}`,
      `trémie ${fmt(A.treDims.tX)}`,
    ]);
  });

  it("trémie en L et en U : branches et bande du fond, masquées sur téléphone", () => {
    const L = stairOf(CASES["quart-d-l"]!);
    expect(find(L, "branche ").map((c) => [c.text, c.detail])).toEqual([
      [`branche ${fmt(1000)}`, true],
      [`branche ${fmt(1000)}`, true],
    ]);
    const auto = stairOf(CASES["quart-d-palier-l"]!);
    expect(find(auto, "branche ").map((c) => c.text)).toEqual([
      `branche ${fmt(auto.treDims.tbD)}`,
      `branche ${fmt(auto.treDims.tbA)}`,
    ]);
    for (const name of ["dq-d-palier-u", "dq-g-a-palier-mp-u"]) {
      const U = stairOf(CASES[name]!);
      expect(find(U, "branche ").map((c) => c.text)).toEqual([
        `branche ${fmt(U.treDims.tbD)}`,
        `branche ${fmt(U.treDims.tbD)}`,
      ]);
      expect(find(U, "bande ").map((c) => [c.text, c.detail])).toEqual([[`bande ${fmt(U.treDims.tbA)}`, true]]);
      // En travers, toute la largeur entre les murs ; le long du côté arrivée, la cote retenue.
      expect(find(U, "trémie ").map((c) => c.text)).toEqual([
        `trémie ${fmt(U.treDims.tY)}`,
        `trémie ${fmt(U.C + 2 * el)}`,
      ]);
    }
    // Rectangle : ni branche ni bande.
    expect(find(stairOf({ forme: "dq-d", ...EXEMPLE_U }), "b")).toEqual([]);
  });

  it("giron sur une marche droite, de nez à nez, en balancé comme à palier", () => {
    const cases: Partial<Params>[] = [
      { forme: "droit" },
      { forme: "quart-g" },
      { forme: "dq-d", ...EXEMPLE_U },
      { forme: "demi-g", ...EXEMPLE_DEMI },
      { forme: "quart-d", tournant: "palier", ...PALIER.quart },
      { forme: "demi-d", tournant: "palier", ...PALIER.demi },
    ];
    for (const over of cases) {
      const R = stairOf(over);
      const [g] = find(R, "giron ");
      expect(g!.detail).toBe(false);
      // La ligne de cote relie deux nez voisins d'une marche droite, parallèle à la montée.
      const j = R.treads.find((t) => !t.balanced && !t.palier && t.j > 1)!;
      expect(V.len(V.sub(g!.b, g!.a))).toBeCloseTo(R.lines[j.j]!.t - R.lines[j.j - 1]!.t, 6);
    }
  });

  it("à gauche, le miroir de la droite (x → −x)", () => {
    for (const [d, g] of [
      ["quart-d", "quart-g"],
      ["dq-d", "dq-g"],
      ["demi-d", "demi-g"],
    ] as const) {
      const base =
        d === "quart-d" ? { tForme: "L" as const, tbD: 1000, tbA: 1000 } : d === "dq-d" ? EXEMPLE_U : EXEMPLE_DEMI;
      const cd = cotes(stairOf({ ...base, forme: d })),
        cg = cotes(stairOf({ ...base, forme: g }));
      expect(cg.map((c) => c.text)).toEqual(cd.map((c) => c.text));
      cg.forEach((c, i) => {
        expect(c.a[0]).toBeCloseTo(-cd[i]!.a[0], 6);
        expect(c.a[1]).toBeCloseTo(cd[i]!.a[1], 6);
      });
    }
  });

  it("à l'écran, les cotes de détail portent la classe masquée sur téléphone", () => {
    const svg = planSVG(stairOf(CASES["dq-d-palier-u"]!));
    expect(svg.match(/class="pl-dimtxt pl-detail"[^>]*>[^<]+/g)!.map((t) => t.replace(/.*>/, ""))).toEqual([
      "200",
      "35",
      `branche ${fmt(1000)}`,
      `branche ${fmt(1000)}`,
      `bande ${fmt(1000)}`,
    ]);
    expect(svg).toContain(`>trémie ${fmt(2210)}<`);
  });
});
