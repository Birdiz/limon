import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { layBoards, pointName, ring } from "../src/pdf/limons";
import { treadCards } from "../src/pdf/tracage";
import { V, type Pt } from "../src/core/vec";
import { CASES, stairOf } from "./cases";

const dataOf = (name: string) => {
  const R = stairOf(CASES[name]!);
  const cnc = buildCNC(R);
  return {
    R,
    cnc,
    boards: layBoards(
      R,
      cnc.boardParts.map((b) => b.name),
    ),
  };
};

/** Angle d'une direction avec la rive, ramené entre −90° et 90°. */
const angle = (d: Pt) => {
  let a = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
};

const area = (pts: readonly Pt[]) => pts.reduce((s, q, i) => s + V.cross(q, pts[(i + 1) % pts.length]!), 0) / 2;

describe.each(Object.keys(CASES))("traçage à la main %s", (name) => {
  const { R, cnc, boards } = dataOf(name);

  it("donne chaque logement de marche une fois, du nez au fond, sur un trait parallèle à la fausse équerre", () => {
    const labels = boards.flatMap((b) => b.rows.map((r) => r.label));
    for (const t of R.treads) expect(labels).toContain(String(t.j));
    if (R.mp) expect(labels).toContain("MP");
    for (const b of boards)
      for (const r of b.rows) {
        for (const q of [r.nez, r.fond]) {
          expect(q[0]).toBeGreaterThanOrEqual(-0.01);
          expect(q[0]).toBeLessThanOrEqual(b.L + 0.01);
          expect(q[1]).toBeGreaterThanOrEqual(-0.01);
          expect(q[1]).toBeLessThanOrEqual(b.H + 0.01);
        }
        const d = V.sub(r.fond, r.nez);
        if (V.len(d) > 20) expect(Math.abs(angle(d) - b.pente)).toBeLessThan(0.05);
        if (r.cm) {
          expect(r.cm.d0).toBeGreaterThanOrEqual(-0.01);
          expect(r.cm.d1 - r.cm.d0).toBeGreaterThanOrEqual(R.params.ecm);
          // Au bout coupé, la contremarche très biaise peut dépasser le fond de la marche, sur le même trait.
          if (!r.coupe) expect(r.cm.d1).toBeLessThanOrEqual(V.len(d) + 0.01);
        }
      }
  });

  it("range les logements de gauche à droite et ne marque coupé que celui qui touche l'about", () => {
    for (const b of boards) {
      const xs = b.rows.map((r) => Math.min(r.nez[0], r.fond[0]));
      expect(xs).toEqual([...xs].sort((p, q) => p - q));
      for (const r of b.rows.filter((q) => q.coupe))
        expect(Math.min(r.nez[0], b.L - r.nez[0], r.nez[1], b.H - r.nez[1])).toBeLessThan(b.H);
    }
  });

  it("ramène le contour à ses sommets, dans le sens trigonométrique depuis le point le plus bas", () => {
    for (const b of boards) {
      const c = b.contour;
      expect(area(c)).toBeGreaterThan(0);
      expect(Math.abs(area(c) - Math.abs(area(b.outline)))).toBeLessThan(1);
      expect(c[0]![1]).toBeLessThan(Math.min(...c.map((q) => q[1])) + 0.5);
      for (const q of c) expect(b.outline.some((o) => V.len(V.sub(o, q)) < 1e-6)).toBe(true);
    }
  });

  it("garde pour les marches celles qui ne sont pas des rectangles, nez sur la rive", () => {
    const cards = treadCards(cnc, R.params);
    const balanced = R.treads.filter((t) => t.balanced).length;
    expect(cards.length).toBeGreaterThanOrEqual(R.quart && !R.paliers.length ? Math.min(balanced, 1) : 0);
    for (const c of cards) {
      expect(c.pts.length).toBeGreaterThanOrEqual(3);
      expect(c.pts[0]![1]).toBeCloseTo(0, 6);
      expect(c.pts[1]![1]).toBeCloseTo(0, 6);
      expect(c.pts[1]![0]).toBeGreaterThan(c.pts[0]![0]);
      expect(area(c.pts)).toBeGreaterThan(0);
    }
  });
});

describe("traçage de l'escalier droit", () => {
  const { R, cnc, boards } = dataOf("droit");

  it("met tous les nez à la même hauteur, espacés du pas de la volée", () => {
    const rows = boards[0]!.rows.filter((r) => !r.coupe);
    const ys = rows.map((r) => r.nez[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
    for (let i = 1; i < rows.length; i++)
      expect(Math.abs(rows[i]!.nez[0] - rows[i - 1]!.nez[0])).toBeCloseTo(Math.hypot(R.g, R.h), 6);
  });

  it("règle la fausse équerre à la pente de la volée et la contremarche au débord", () => {
    const b = boards[0]!;
    expect(Math.abs(b.pente)).toBeCloseTo((Math.atan(R.h / R.g) * 180) / Math.PI, 1);
    for (const r of b.rows.filter((q) => !q.coupe)) {
      expect(r.cm!.d0).toBeCloseTo(R.params.deb, 6);
      expect(r.cm!.d1).toBeCloseTo(R.params.deb + R.params.ecm + 2 * R.params.jeu, 6);
    }
  });

  it("n'a aucune marche à tracer hors des rectangles de la liste de débit", () => {
    expect(treadCards(cnc, R.params)).toEqual([]);
  });
});

describe("traçage du quart tournant", () => {
  it("trace les marches balancées, pas les droites", () => {
    const { R, cnc } = dataOf("quart-d");
    const cards = treadCards(cnc, R.params).map((c) => c.title);
    const bal = R.treads.filter((t) => t.balanced).map((t) => `Marche ${t.j}`);
    for (const t of R.treads.filter((q) => !q.balanced)) expect(cards).not.toContain(`Marche ${t.j}`);
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(bal).toContain(c);
  });

  it("donne les mêmes cotes au quart gauche, en miroir pour les marches", () => {
    const d = dataOf("quart-d"),
      g = dataOf("quart-g");
    const cd = treadCards(d.cnc, d.R.params),
      cg = treadCards(g.cnc, g.R.params);
    expect(cg.map((c) => c.title)).toEqual(cd.map((c) => c.title));
    cd.forEach((c, i) => {
      const m = cg[i]!;
      const len = (pts: Pt[]) => pts.map((q, k) => V.len(V.sub(pts[(k + 1) % pts.length]!, q))).sort((p, q) => p - q);
      len(c.pts).forEach((v, k) => expect(len(m.pts)[k]).toBeCloseTo(v, 3));
    });
  });
});

describe("contour à tracer", () => {
  it("enlève les points alignés et part du point le plus bas, le plus à gauche", () => {
    const r = ring([
      [0, 10],
      [10, 10],
      [10, 0],
      [5, 0],
      [0, 0],
    ]);
    expect(r).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it("nomme les points a à z, puis A à Z", () => {
    expect([0, 1, 25, 26, 51, 52].map(pointName)).toEqual(["a", "b", "z", "A", "Z", "a2"]);
  });
});
