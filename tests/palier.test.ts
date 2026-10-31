import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { cutRows } from "../src/cnc/cutlist";
import { handrailOutline } from "../src/cnc/railing";
import { atelierDefauts } from "../src/core/atelier";
import { DEFAULTS, type Params } from "../src/core/params";
import { fileBase, newProject, parseProjectFile, projectFile } from "../src/core/project";
import { paramsFromHash, paramsToHash } from "../src/core/share";
import { LIFT, compute, tremieContour, type StringerPiece } from "../src/core/stair";
import { bbox, inPolygon } from "../src/core/vec";
import { stairOf } from "./cases";

const FORMES = ["droit", "quart-g", "quart-d"] as const;
const last = (sp: StringerPiece) => sp.prof[sp.prof.length - 1]!;
const ends = (over: Partial<Params>) => {
  const R = stairOf(over);
  return R.stringers.filter((sp) => sp.idx === sp.count - 1);
};
const errorKeys = (over: Partial<Params>) => {
  const r = compute({ ...DEFAULTS, ...over });
  return r.ok ? [] : r.errors.map((e) => e.key);
};

describe.each(FORMES)("marche palière, %s", (forme) => {
  const sans = stairOf({ forme });
  const R = stairOf({ forme, mp: true, mpP: 320, mpE: 50 });
  const p = R.params,
    H = R.H;

  it("est absente par défaut", () => {
    expect(sans.mp).toBeNull();
    expect(buildCNC(sans).mpPart).toBeNull();
  });

  it("prolonge le nez d'arrivée de sa profondeur, au niveau du sol fini", () => {
    const m = R.mp!;
    expect(m.top).toBe(H);
    expect(m.e).toBe(50);
    expect(m.rn).toBe(Math.min(R.rn, 25));
    // Plan : du dernier nez jusqu'à 320 mm en arrière, entre les limons.
    const b = bbox(m.plan),
      want =
        forme === "droit"
          ? { x0: 0, x1: R.W, y0: R.L, y1: R.L + 320 }
          : { x0: R.B, x1: R.B + 320, y0: R.A - R.W, y1: R.A };
    for (const k of ["x0", "x1", "y0", "y1"] as const) expect(b[k]).toBeCloseTo(want[k], 6);
    expect(m.nez).toBeCloseTo(R.W, 6);
  });

  it("raccourcit la dernière contremarche de son épaisseur", () => {
    expect(R.risers[R.n - 1]!.z1).toBeCloseTo(H - 50, 6);
    expect(R.risers[R.n - 2]!.z1).toBeCloseTo((R.n - 1) * R.h - p.et, 6);
  });

  it("prolonge les limons d'arrivée à l'horizontale et y loge la marche palière", () => {
    const before = ends({ forme }),
      after = ends({ forme, mp: true, mpP: 320, mpE: 50 });
    expect(after).toHaveLength(2);
    after.forEach((sp, i) => {
      const b = before[i]!;
      expect(last(sp)[0]).toBeCloseTo(last(b)[0] + 320, 6);
      expect(last(sp)[1]).toBeCloseTo(H + LIFT, 6);
      // Le dernier nez reste un sommet du chant haut.
      expect(sp.prof[sp.prof.length - 2]).toEqual(last(b));
      // Logement de la marche palière : de son dessous au sol fini, jusqu'au bout du limon.
      const pk = sp.pockets.find((q) => q.some((v) => Math.abs(v[1] - (H + p.jeu)) < 1e-6))!;
      const us = pk.map((v) => v[0]),
        zs = pk.map((v) => v[1]);
      expect(Math.min(...zs)).toBeCloseTo(H - 50 - p.jeu, 6);
      expect(Math.max(...us)).toBeCloseTo(last(sp)[0], 6);
      expect(Math.min(...us)).toBeLessThan(last(b)[0]);
    });
  });

  it("recule le bord de la trémie et du plancher de sa profondeur", () => {
    if (forme === "droit") {
      expect(R.tre.y1).toBe(sans.tre.y1 + 320);
      expect(R.tre.y1 - R.tre.y0).toBe(p.tL);
      expect(R.slab.y1).toBe(sans.slab.y1 + 320);
    } else {
      expect(R.tre.x1).toBe(sans.tre.x1 + 320);
      expect(R.slab.x1).toBe(sans.slab.x1 + 320);
    }
  });

  it("garde la même trémie à calculer, décalée de la marche palière", () => {
    const a = stairOf({ forme, tAuto: true }),
      b = stairOf({ forme, tAuto: true, mp: true, mpP: 320 });
    if (forme === "droit") expect(b.treDims.tL).toBe(a.treDims.tL + 320);
    else {
      expect(b.treDims.tX).toBe(a.treDims.tX + 320);
      expect(b.treDims.tY).toBe(a.treDims.tY);
    }
    expect(b.ech!.c).toBe(a.ech!.c);
  });

  it("ajoute une pièce à marches.dxf et à la liste de débit", () => {
    const cnc = buildCNC(R);
    expect(cnc.mpPart).toMatchObject({ j: R.n });
    // Encastrée dans les limons comme les marches, sur toute sa profondeur.
    expect(cnc.mpPart!.L).toBeCloseTo(R.W + 2 * p.enc, 6);
    expect(cnc.mpPart!.l).toBeCloseTo(320, 6);
    expect(cnc.treadEnts.filter((e) => e.kind === "text" && e.s === "MP")).toHaveLength(1);
    expect(cutRows(cnc, R)).toContainEqual({ name: "Marche palière", q: 1, L: R.W + 2 * p.enc, l: 320, e: 50 });
  });

  it("refuse une marche palière trop courte ou trop épaisse", () => {
    expect(errorKeys({ forme, mp: true, mpP: 100 })).toContain("mpP");
    expect(errorKeys({ forme, mp: true, mpE: 10 })).toContain("mpE");
    expect(errorKeys({ forme, mp: true, mpE: Math.ceil(R.h) })).toContain("mpE");
    // Sans marche palière, ses cotes ne comptent pas.
    expect(errorKeys({ forme, mp: false, mpP: 100, mpE: 500 })).toEqual([]);
  });
});

describe.each(FORMES)("retour de main courante, %s", (forme) => {
  it("prolonge la main courante à l'horizontale, coupée d'onglet", () => {
    const R = stairOf({ forme, mp: true, gc: "balustres" }),
      G = R.rail!;
    const ret = G.handrails.filter((hr) => hr.retour);
    expect(ret).toHaveLength(1);
    const r = ret[0]!,
      ramp = G.handrails.find((hr) => hr.idx === r.idx && !hr.retour)!;
    expect(r.b).toBe(0);
    expect(r.u0).toBe(ramp.u1);
    expect(r.u1).toBeCloseTo(ramp.u1 + R.params.mpP, 6);
    expect(r.z0).toBeCloseTo(ramp.z0 + ramp.b * ramp.u1, 6);
    expect(r.z0 - R.H).toBeGreaterThanOrEqual(900 - 1e-6);
    // Onglet : les dessous se rejoignent au même point.
    expect(ramp.cut1).toBeGreaterThan(0);
    expect(r.cut0).toBe(ramp.cut1);
    const a = handrailOutline(ramp),
      b = handrailOutline(r);
    expect(a[1]).toEqual(b[0]);
    expect(a[2]![0]).toBeCloseTo(b[3]![0], 6);
    expect(a[2]![1]).toBeCloseTo(b[3]![1], 6);
    // Balustres continués sous le retour, coupés d'équerre, le dernier au bout.
    const under = G.posts.filter((q) => q.idx === r.idx && q.u > r.u0);
    expect(under.length).toBeGreaterThan(0);
    under.forEach((q) => expect(q.at).toBe(0));
    expect(under[under.length - 1]!.u).toBeCloseTo(r.u1 - R.params.bs / 2, 6);
    expect(G.gap).toBeLessThanOrEqual(110);
  });

  it("met des lisses horizontales sous le retour", () => {
    const G = stairOf({ forme, mp: true, gc: "lisses" }).rail!;
    const r = G.handrails.find((hr) => hr.retour)!;
    const under = G.rails.filter((l) => l.idx === r.idx && l.uA >= r.u0 - 1e-6);
    expect(under.length).toBeGreaterThan(0);
    under.forEach((l) => expect(l.b).toBe(0));
  });

  it("nomme le retour dans garde-corps.dxf", () => {
    const cnc = buildCNC(stairOf({ forme, mp: true, gc: "balustres" }));
    expect(cnc.rail!.handrailParts.map((q) => q.name)).toContain("Retour de main courante");
  });

  it("n'en fait pas sans marche palière", () => {
    const G = stairOf({ forme, gc: "balustres" }).rail!;
    expect(G.handrails.some((hr) => hr.retour || hr.cut0 || hr.cut1)).toBe(false);
  });
});

describe("trémie en L", () => {
  it("est un rectangle en escalier droit, et par défaut", () => {
    expect(stairOf({ forme: "droit", tForme: "L" }).trePoly).toHaveLength(4);
    expect(stairOf({ forme: "quart-d" }).trePoly).toHaveLength(4);
    expect(stairOf({ forme: "droit", tForme: "L" }).treL).toBe(false);
  });

  it.each(["quart-g", "quart-d"] as const)("laisse le coin au-dessus du jour en plancher (%s)", (forme) => {
    const R = stairOf({ forme, tForme: "L", tbD: 1000, tbA: 1100 });
    expect(R.treL).toBe(true);
    const { el } = R.params,
      x0 = -el,
      x1 = R.B,
      y1 = R.A + el,
      y0 = y1 - R.params.tY;
    expect(R.trePoly).toEqual([
      [x0, y0],
      [x0 + 1000, y0],
      [x0 + 1000, y1 - 1100],
      [x1, y1 - 1100],
      [x1, y1],
      [x0, y1],
    ]);
    expect(R.tre).toEqual({ x0, y0, x1, y1 });
    // Le coin retiré est hors de l'escalier : même échappée qu'avec le rectangle.
    expect(R.ech?.c).toBe(stairOf({ forme }).ech?.c);
  });

  it("perd de l'échappée si une branche passe au-dessus de l'escalier", () => {
    const R = stairOf({ forme: "quart-d", tForme: "L", tbD: 500 });
    expect(R.ech!.c).toBeLessThan(stairOf({ forme: "quart-d" }).ech?.c ?? Infinity);
    expect(R.st.ech).toBe("bad");
  });

  it("à calculer, garde des branches à la largeur de l'escalier", () => {
    const rect = stairOf({ forme: "quart-d", tAuto: true }),
      L = stairOf({ forme: "quart-d", tAuto: true, tForme: "L" });
    const { el, ps } = L.params;
    expect(L.treDims.tbD).toBe(Math.ceil((el + L.W + Math.max(el, ps)) / 10) * 10);
    expect(L.treDims.tbA).toBe(L.treDims.tbD);
    expect([L.treDims.tX, L.treDims.tY]).toEqual([rect.treDims.tX, rect.treDims.tY]);
    expect(L.ech!.c).toBe(rect.ech!.c);
    expect(L.notes.some(([, t]) => t.startsWith("Trémie en L à prévoir") && t.includes("branches de"))).toBe(true);
    // Avec un garde-corps posé à l'anglaise, la branche s'élargit pour lui laisser passage.
    const over = { gc: "balustres", gcPose: "anglaise", bs: 60, mcL: 30 } as const;
    const gc = stairOf({ forme: "quart-d", tAuto: true, tForme: "L", ...over });
    expect(gc.treDims.tbD).toBeGreaterThanOrEqual(el + gc.W + el + over.bs);
  });

  it("se combine avec la marche palière", () => {
    const R = stairOf({ forme: "quart-d", tForme: "L", tAuto: true, mp: true });
    expect(R.trePoly).toHaveLength(6);
    expect(R.tre.x1).toBe(R.B + R.params.mpP);
    expect(R.st.ech).toBe("ok");
  });

  it("refuse une branche trop étroite, sauf à calculer", () => {
    expect(errorKeys({ forme: "quart-d", tForme: "L", tbD: 50 })).toEqual(["tbD"]);
    expect(errorKeys({ forme: "quart-d", tForme: "L", tbA: 0 })).toEqual(["tbA"]);
    expect(errorKeys({ forme: "quart-d", tForme: "L", tbD: 50, tAuto: true })).toEqual([]);
    expect(errorKeys({ forme: "droit", tForme: "L", tbD: 50 })).toEqual([]);
  });

  it("redevient un rectangle quand les branches couvrent toute la trémie", () => {
    const p = { ...DEFAULTS, tForme: "L" as const };
    const d = { tL: p.tL, tX: p.tX, tY: p.tY, tbD: 5000, tbA: 900 };
    expect(tremieContour(p, d, 0)).toHaveLength(4);
  });
});

describe("point dans un polygone", () => {
  const L: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 5],
    [20, 5],
    [20, 10],
    [0, 10],
  ];
  it("compte les bords et sommets comme dedans", () => {
    expect(inPolygon(L, [5, 5])).toBe(true);
    expect(inPolygon(L, [15, 7])).toBe(true);
    expect(inPolygon(L, [0, 0])).toBe(true);
    expect(inPolygon(L, [15, 5])).toBe(true);
    expect(inPolygon(L, [10, 2])).toBe(true);
    expect(inPolygon(L, [15, 2])).toBe(false);
    expect(inPolygon(L, [-1, 5])).toBe(false);
    expect(inPolygon(L, [5, 10.001])).toBe(false);
  });
});

describe("nouveaux réglages", () => {
  const p: Params = {
    ...DEFAULTS,
    forme: "quart-g",
    mp: true,
    mpP: 350,
    mpE: 45,
    tForme: "L",
    tbD: 1020,
    tbA: 980,
  };

  it("passent par le lien de projet", () => {
    const hash = paramsToHash(p);
    expect(hash).toBe("forme=quart-g&tForme=L&tbD=1020&tbA=980&mpP=350&mpE=45&mp=true");
    expect(paramsFromHash(`#${hash}`)).toEqual(p);
    expect(paramsFromHash("#tForme=U&mp=1")).toEqual(DEFAULTS);
  });

  it("passent par le fichier .escalier", () => {
    const pj = newProject("a", "Palier", "complet", 1, p);
    expect(parseProjectFile(projectFile(pj), "b")).toEqual({ ...pj, id: "b" });
    expect(fileBase(pj.nom)).toBe("Palier");
  });

  it("gardent la marche palière dans le profil de l'atelier, pas la trémie", () => {
    const d = atelierDefauts(p);
    expect(d).toMatchObject({ mp: true, mpP: 350, mpE: 45 });
    expect(d).not.toHaveProperty("tForme");
    expect(d).not.toHaveProperty("tbD");
  });
});
