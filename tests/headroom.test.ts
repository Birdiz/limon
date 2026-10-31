import { describe, expect, it } from "vitest";
import { fmt } from "../src/core/format";
import { DEFAULTS } from "../src/core/params";
import { headroomUnder, inPolygon, type NoseSeg } from "../src/core/headroom";
import { planShapes } from "../src/core/plan-shapes";
import { ECHAPPEE, echSidesShown, type Stair } from "../src/core/stair";
import { checks } from "../src/core/summary";
import type { Pt } from "../src/core/vec";
import { stairOf } from "./cases";

const { H, ep, el, A, B, W, tL, tY } = DEFAULTS;
const ceil = H - ep;

/** Hauteur de la ligne des nez en escalier droit, à l'abscisse y le long de la montée : h au premier nez (y = 0),
    puis h de plus à chaque giron. */
const zDroit = (h: number, g: number, y: number) => h * (1 + y / g);

describe("échappée sous un contour quelconque", () => {
  // Une montée de 1 000 mm de long en 5 marches de 200 mm, sous un plafond à 2 500 mm.
  const segs: NoseSeg[] = Array.from({ length: 5 }, (_, k) => ({
    a: [0, k * 200],
    b: [0, (k + 1) * 200],
    za: (k + 1) * 200,
    zb: (k + 2) * 200,
    j: k + 1,
  }));

  it("prend le bord de la trémie, pas un échantillon voisin", () => {
    const opening: Pt[] = [
      [-100, 330],
      [100, 330],
      [100, 2000],
      [-100, 2000],
    ];
    const e = headroomUnder(segs, opening, 2500)!;
    // Bord à y = 330 : 200 + 330 mm de montée.
    expect(e.c).toBeCloseTo(2500 - 530, 9);
    expect(e.pt).toEqual([0, 330]);
    expect(e.j).toBe(2);
  });

  it("suit un contour en L", () => {
    // Trémie en L : la ligne passe sous le plancher entre y = 400 et y = 600, puis ressort dans la trémie.
    const opening: Pt[] = [
      [-100, 0],
      [100, 0],
      [100, 400],
      [-50, 400],
      [-50, 600],
      [100, 600],
      [100, 1000],
      [-100, 1000],
    ];
    expect(inPolygon([0, 500], opening)).toBe(false);
    expect(inPolygon([0, 300], opening)).toBe(true);
    const e = headroomUnder(segs, opening, 2500)!;
    // Pire point au bout haut du passage sous le plancher : y = 600, soit 800 mm de nez.
    expect(e.c).toBeCloseTo(1700, 9);
    expect(e.pt[1]).toBeCloseTo(600, 9);
    expect(e.j).toBe(3);
  });

  it("ne trouve rien quand tout passe sous la trémie", () => {
    const opening: Pt[] = [
      [-100, -10],
      [100, -10],
      [100, 1010],
      [-100, 1010],
    ];
    expect(headroomUnder(segs, opening, 2500)).toBeNull();
  });
});

describe("échappée de chaque côté", () => {
  it("escalier droit : la même sur toute la largeur", () => {
    const R = stairOf({ forme: "droit" });
    // 15 hauteurs de 180 mm, 14 girons sur 3 650 mm ; bord de trémie à 3 650 - 3 200 = 450 mm du départ.
    const want = ceil - zDroit(180, 3650 / 14, 3650 - tL);
    expect(want).toBeCloseTo(2009.3, 1);
    for (const e of [R.ech, R.echCotes.jour, R.echCotes.foulee, R.echCotes.mur]) {
      expect(e!.c).toBeCloseTo(want, 6);
      expect(e!.j).toBe(2);
      expect(e!.pt[1]).toBeCloseTo(450, 6);
    }
    expect(R.echCotes.jour!.pt[0]).toBeCloseTo(W, 6);
    expect(R.echCotes.foulee!.pt[0]).toBeCloseTo(W - R.f, 6);
    expect(R.echCotes.mur!.pt[0]).toBeCloseTo(0, 6);
    expect(R.st.ech).toBe("ok");
    expect(echSidesShown(R)).toBe(false);
    expect(
      checks(R)
        .filter((c) => c.k.startsWith("Échappée"))
        .map((c) => [c.k, c.v, c.s]),
    ).toEqual([["Échappée", fmt(2009), "ok"]]);
    // Trémie à calculer : le bord au plus loin du départ où la ligne des nez reste 2 000 mm sous le plancher,
    // h (1 + y / g) = 500, arrondie aux 10 mm.
    const yMax = (3650 / 14) * ((ceil - ECHAPPEE) / 180 - 1);
    expect(stairOf({ forme: "droit", tAuto: true }).treDims.tL).toBe(Math.ceil((3650 - yMax) / 10) * 10);
  });

  it.each(["quart-d", "quart-g"] as const)("%s : bord côté départ dans la partie droite", (forme) => {
    const R = stairOf({ forme });
    // Ligne de foulée : partie droite A - W, quart de cercle de rayon f, partie droite B - W.
    const Lw = A - W + (Math.PI / 2) * R.f + (B - W);
    expect(R.Lw).toBeCloseTo(Lw, 9);
    // Bord de trémie à A + el - tY du départ, encore dans les marches droites : la même valeur des trois côtés.
    const want = ceil - zDroit(180, Lw / 14, A + el - tY);
    expect(want).toBeCloseTo(2048.6, 1);
    for (const e of Object.values(R.echCotes)) expect(e!.c).toBeCloseTo(want, 6);
    expect(R.ech!.c).toBeCloseTo(want, 6);
    expect(echSidesShown(R)).toBe(true);
    expect(
      checks(R)
        .filter((c) => c.k.startsWith("Échappée"))
        .map((c) => [c.k, c.v, c.s]),
    ).toEqual([
      ["Échappée jour", fmt(2049), "ok"],
      ["Échappée foulée", fmt(2049), "ok"],
      ["Échappée mur", fmt(2049), "ok"],
    ]);
  });

  /** Hauteur de la ligne des nez à l'abscisse s du limon de mur, d'après la position de chaque nez sur ce limon. */
  const zMur = (R: Stair, s: number) => {
    const k = R.lines.findIndex((l, i) => i + 1 < R.lines.length && s >= l.sOut && s <= R.lines[i + 1]!.sOut);
    const L0 = R.lines[k]!,
      L1 = R.lines[k + 1]!;
    return { z: R.h * (k + 1 + (s - L0.sOut) / (L1.sOut - L0.sOut)), j: k + 1 };
  };

  it("trémie trop courte côté arrivée : le mur passe sous le plancher, pas le jour", () => {
    const R = stairOf({ forme: "quart-d", tX: 1300 });
    const x0 = B - 1300;
    // Côté jour, la partie arrivée reste sous la trémie : seul compte le bord côté départ.
    expect(R.echCotes.jour!.c).toBeCloseTo(ceil - zDroit(180, R.Lw / 14, A + el - tY), 6);
    // Côté mur : le limon longe le mur d'arrivée (y = A) et croise le bord de trémie en x = x0.
    const mur = R.echCotes.mur!;
    expect(mur.pt[0]).toBeCloseTo(x0, 6);
    expect(mur.pt[1]).toBeCloseTo(A, 6);
    const m = zMur(R, A + x0);
    expect(mur.c).toBeCloseTo(ceil - m.z, 6);
    expect(mur.j).toBe(m.j);
    // La ligne de foulée croise le même bord plus bas dans le tour.
    const fw = R.echCotes.foulee!;
    expect(fw.pt[0]).toBeCloseTo(x0, 6);
    expect(fw.c).toBeGreaterThan(mur.c);
    expect(fw.c).toBeLessThan(1900);
    // L'échappée retenue est la plus faible, côté mur ; la note le dit et propose la trémie qui suffit.
    expect(R.ech!.c).toBeCloseTo(mur.c, 6);
    expect(R.st.ech).toBe("bad");
    const note = R.notes.find(([, t]) => t.startsWith("Échappée"))!;
    expect(note[1]).toMatch(
      /^Échappée de 512 mm côté mur, au-dessus de la marche \d+ \(736 mm sur la ligne de foulée\)/,
    );
    expect(note[1]).toContain(`allongez la trémie côté arrivée à ${fmt(R.tXmin!)} mm`);
    expect(note[2]!.set).toEqual({ tX: R.tXmin });
    expect(
      checks(R)
        .filter((c) => c.k.startsWith("Échappée"))
        .map((c) => c.s),
    ).toEqual(["ok", "bad", "bad"]);
    // Les trois repères sur le plan : le pire point, et les deux autres côtés.
    const roles = planShapes(R).shapes.map((s) => s.role);
    expect(roles.filter((r) => r === "pl-ech")).toHaveLength(1);
    expect(roles.filter((r) => r === "pl-ech-cote")).toHaveLength(2);
    // Corrigée, la trémie donne 2 000 mm de chaque côté.
    const F = stairOf({ forme: "quart-d", tX: R.tXmin! });
    for (const e of Object.values(F.echCotes)) expect(e === null || e.c >= ECHAPPEE).toBe(true);
  });

  it("trémie juste trop courte côté jour seulement : la foulée passe, le jour non", () => {
    // Départ court : le bord côté départ coupe les premières marches balancées, plus basses au jour.
    const over = { forme: "quart-d", A: 1500, B: 2600 } as const;
    const auto = stairOf({ ...over, tAuto: true });
    for (const e of Object.values(auto.echCotes)) expect(e!.c).toBeGreaterThanOrEqual(ECHAPPEE);
    const R = stairOf({ ...over, tX: auto.treDims.tX, tY: auto.treDims.tY - 10 });
    const { jour, foulee, mur } = R.echCotes;
    expect(jour!.c).toBeLessThan(ECHAPPEE);
    expect(jour!.c).toBeGreaterThan(1900);
    expect(foulee!.c).toBeGreaterThanOrEqual(ECHAPPEE);
    expect(mur!.c).toBeGreaterThan(foulee!.c);
    expect(R.st.ech).toBe("warn");
    expect(
      checks(R)
        .filter((c) => c.k.startsWith("Échappée"))
        .map((c) => c.s),
    ).toEqual(["warn", "ok", "ok"]);
    const note = R.notes.find(([, t]) => t.startsWith("Échappée"))!;
    expect(note[0]).toBe("warn");
    expect(note[1]).toMatch(
      /^Échappée de 1\u202f99\d mm côté jour, au-dessus de la marche \d+ \(2\u202f0\d\d mm sur la ligne de foulée\)/,
    );
    expect(note[2]!.set).toEqual({ tY: auto.treDims.tY });
  });

  it("droit trop court : sur toute la largeur", () => {
    const R = stairOf({ forme: "droit", L: 2400, tL: 1500 });
    const n = R.n;
    const want = ceil - zDroit(2700 / n, 2400 / (n - 1), 2400 - 1500);
    expect(R.ech!.c).toBeCloseTo(want, 6);
    expect(R.notes.find(([, t]) => t.startsWith("Échappée"))![1]).toMatch(
      /^Échappée de [\d\u202f]+ mm sur toute la largeur, au-dessus de la marche \d+ : pour 2 000 mm, allongez la trémie à /,
    );
  });
});
