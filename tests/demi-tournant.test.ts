import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { toDXF } from "../src/cnc/dxf";
import { readme } from "../src/cnc/package";
import { DEFAULTS, EXEMPLE_DEMI, EXEMPLE_U, changeForme, jourUnPoteau, type Params } from "../src/core/params";
import { planShapes } from "../src/core/plan-shapes";
import { paramsFromHash, paramsToHash } from "../src/core/share";
import { ECHAPPEE, TENON, compute, type Stair } from "../src/core/stair";
import { stringerOutline } from "../src/core/stringer";
import { sectionSummaries } from "../src/core/summary";
import { bbox } from "../src/core/vec";
import { stairOf } from "./cases";

const E = { ...EXEMPLE_DEMI };
const D = stairOf({ forme: "demi-d", ...E });
const p = D.params;
const jour = D.stringers.filter((sp) => sp.side === "in");
const N = D.newels[0]!;
const errKeys = (over: Partial<Params>) => {
  const r = compute({ ...DEFAULTS, ...over });
  return r.ok ? [] : r.errors.map((e) => e.key);
};

describe("demi-tournant : géométrie", () => {
  it("est le U du double quart, côté fond déduit du jour, avec l'exemple confortable", () => {
    expect(D.tours).toBe(2);
    expect(D.C).toBe(2 * D.W + p.J);
    expect(D.inner.pts).toEqual([
      [D.W, 0],
      [D.W, D.A - D.W],
      [D.W + p.J, D.A - D.W],
      [D.W + p.J, D.A - D.B],
    ]);
    expect(D.notes.filter((n) => n[0] === "warn" || n[0] === "bad")).toEqual([]);
  });

  it("refuse un jour où les deux limons de jour ne passent pas", () => {
    expect(errKeys({ forme: "demi-d", ...E, J: 2 * DEFAULTS.el + 10 })).toEqual(["J"]);
    // Un peu plus large, les marches qui pivotent au jour ne rejoignent pas encore les limons.
    expect(errKeys({ forme: "demi-d", ...E, J: 2 * DEFAULTS.el + 20 })).toEqual(["J"]);
    expect(errKeys({ forme: "demi-d", ...E, J: 140 })).toEqual([]);
  });
});

describe("demi-tournant : poteau unique du jour étroit", () => {
  it("met un seul poteau de la largeur du jour, affleurant les limons de jour côté marches", () => {
    expect(p.J).toBeLessThan(jourUnPoteau(p));
    expect(D.newels).toHaveLength(1);
    expect([N.sx, N.sy]).toEqual([p.J, p.ps]);
    expect(N.c).toEqual([D.W + p.J / 2, D.A - D.W - p.ps / 2]);
  });

  it("remplace le limon de jour du milieu : deux limons de jour, un tenon chacun", () => {
    expect(jour.map((sp) => sp.idx)).toEqual([0, 2]);
    expect(jour.map((sp) => sp.tenons.length)).toEqual([1, 1]);
    expect(jour[0]!.prof.at(-1)![0]).toBeCloseTo(D.A - D.W - p.ps, 6);
    expect(jour[1]!.prof[0]![0]).toBeCloseTo(p.ps, 6);
    for (const sp of jour) {
      const t = sp.tenons[0]!,
        o = bbox(stringerOutline(sp, sp.hl));
      expect(t.u1 - t.u0).toBe(TENON.long);
      expect(sp.idx === 0 ? o.x1 : o.x0).toBeCloseTo(sp.idx === 0 ? t.u1 : t.u0, 6);
    }
    const txt = toDXF(buildCNC(D).boardEnts);
    expect(txt).toContain("LIMON DE JOUR 1/2 - face");
    expect(txt).toContain("LIMON DE JOUR 2/2 - face");
  });

  it("reçoit les deux limons sur la face du fond, chacun près de son arête, sans se toucher", () => {
    const back = N.faces.find((f) => f.mortises.length)!;
    expect(back.u1 - back.u0).toBe(p.J);
    const [m0, m2] = back.mortises;
    expect([m0!.idx, m2!.idx]).toEqual([0, 2]);
    const b0 = bbox(m0!.pts),
      b2 = bbox(m2!.pts);
    // Mortaise du limon d'arrivée : même épaisseur, comptée depuis l'autre arête.
    expect(b2.x0).toBeCloseTo(p.J - b0.x1, 6);
    expect(b0.x1).toBeLessThan(b2.x0);
    for (const [m, sp] of [
      [m0!, jour[0]!],
      [m2!, jour[1]!],
    ] as const) {
      const t = sp.tenons[0]!,
        b = bbox(m.pts);
      expect(b.x1 - b.x0).toBeCloseTo(t.t1 - t.t0 + 2 * p.jeu, 6);
      expect(b.y1 - b.y0).toBeCloseTo(t.z1 - t.z0 + 2 * p.jeu, 6);
      expect(m.depth).toBeCloseTo(t.u1 - t.u0 + TENON.fond, 6);
      expect(N.h).toBeGreaterThanOrEqual(b.y1 + TENON.tete - TENON.epaul);
    }
  });

  it("loge les marches des trois volées dans ses trois faces côté marches", () => {
    expect(N.faces.map((f) => f.volee)).toEqual([0, null, 2, 1]);
    expect(N.faces.map((f) => f.u1 - f.u0)).toEqual([p.ps, p.J, p.ps, p.J]);
    for (const f of N.faces.filter((f) => f.volee !== null)) expect(f.pockets.length).toBeGreaterThan(0);
  });

  it("dessine ses quatre faces à leur largeur dans poteau.dxf, et le débite à la largeur du jour", () => {
    const cnc = buildCNC(D);
    const cut = cnc.postEnts.filter((e) => e.kind === "poly" && e.layer === "DECOUPE");
    expect(cut.map((e) => (e.kind === "poly" ? bbox(e.pts).y1 - bbox(e.pts).y0 : 0))).toEqual([p.ps, p.J, p.ps, p.J]);
    // Faces sans chevauchement, l'une sous l'autre.
    const ys = cut.map((e) => (e.kind === "poly" ? bbox(e.pts) : null)!);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!.y1).toBeLessThan(ys[i - 1]!.y0);
    expect(cnc.postParts).toEqual([{ j: 1, L: N.h, l: p.J, e: p.ps }]);
    expect(readme(D)).toContain(`poteau de ${p.J} x ${p.ps} mm`);
    const txt = toDXF(cnc.postEnts);
    expect(txt).toContain("mortaises des LIMONS DE JOUR 1/2 et 2/2");
    expect(txt).toContain("volee du milieu");
  });

  it("passe à deux poteaux dès que le jour laisse 100 mm de limon de jour entre eux", () => {
    const J = jourUnPoteau(p);
    const L = stairOf({ forme: "demi-d", ...E, J });
    expect(L.newels).toHaveLength(2);
    expect(L.stringers.filter((sp) => sp.side === "in")).toHaveLength(3);
    expect(stairOf({ forme: "demi-d", ...E, J: J - 10 }).newels).toHaveLength(1);
    // Au-delà, c'est le double quart de même côté fond.
    const Q = stairOf({ forme: "dq-d", ...E, C: L.C });
    expect(buildCNC(L).boardParts).toEqual(buildCNC(Q).boardParts);
    expect(buildCNC(L).postParts).toEqual(buildCNC(Q).postParts);
  });
});

describe("demi-tournant : garde-corps", () => {
  const R = stairOf({ forme: "demi-d", ...E, gc: "balustres" });
  const G = R.rail!,
    P = R.newels[0]!;

  it("tenonne les deux mains courantes dans le poteau unique, qui monte les recevoir", () => {
    expect(G.handrails.map((h) => [h.idx, h.tenons.length])).toEqual([
      [0, 1],
      [2, 1],
    ]);
    const mc = P.faces.flatMap((f) => f.mortises).filter((m) => m.of === "main courante");
    expect(mc.map((m) => m.idx)).toEqual([0, 2]);
    const [a, b] = mc.map((m) => bbox(m.pts));
    expect(a!.x1).toBeLessThan(b!.x0);
    for (const m of mc) expect(P.h).toBeGreaterThanOrEqual(bbox(m.pts).y1);
    expect(G.hMin).toBeGreaterThanOrEqual(900 - 1e-6);
  });

  it("refuse des mains courantes qui se touchent contre le poteau", () => {
    expect(errKeys({ forme: "demi-d", ...E, gc: "balustres", J: 140, mcL: 100 })).toEqual(["mcL"]);
    expect(errKeys({ forme: "demi-d", ...E, gc: "balustres", J: 140, mcL: 90 })).toEqual([]);
  });
});

describe("demi-tournant : trémie", () => {
  it("calcule la plus courte trémie côté arrivée, sur toute la largeur", () => {
    const free = (R: Stair) => R.ech === null || R.ech.c >= ECHAPPEE;
    const R = stairOf({ forme: "demi-d", ...E, tAuto: true });
    expect(R.treDims.tX).toBe(R.C + 2 * p.el);
    expect(free(stairOf({ forme: "demi-d", ...E, tX: R.treDims.tX, tY: R.treDims.tY }))).toBe(true);
    expect(free(stairOf({ forme: "demi-d", ...E, tX: R.treDims.tX, tY: R.treDims.tY - 20 }))).toBe(false);
  });
});

describe("demi-tournant : gauche et droite", () => {
  const L = stairOf({ forme: "demi-g", ...E });

  it("calcule la même géométrie, vue en miroir", () => {
    expect(L.lines).toEqual(D.lines);
    const cg = buildCNC(L),
      cd = buildCNC(D);
    expect(cg.boardParts).toEqual(cd.boardParts);
    expect(cg.postParts).toEqual(cd.postParts);
    const a = planShapes(D).shapes[0]!,
      b = planShapes(L).shapes[0]!;
    if (a.k === "poly" && b.k === "poly") expect(b.pts[0]![0]).toBeCloseTo(-a.pts[0]![0], 9);
  });
});

describe("demi-tournant : réglages", () => {
  it("reprend les cotes d'exemple en y entrant, et garde l'escalier entre double quart et demi-tournant", () => {
    const q = { ...DEFAULTS, forme: "quart-d" as const };
    expect(changeForme(q, { ...q, forme: "demi-g" })).toEqual({ ...q, forme: "demi-g", ...EXEMPLE_DEMI });
    const dq = { ...q, forme: "dq-d" as const, ...EXEMPLE_U };
    expect(changeForme(dq, { ...dq, forme: "demi-d" }).J).toBe(EXEMPLE_U.C - 2 * dq.W);
    const demi = { ...q, forme: "demi-d" as const, ...EXEMPLE_DEMI };
    // Jour trop étroit pour deux poteaux : le double quart prend le plus petit côté fond possible.
    expect(changeForme(demi, { ...demi, forme: "dq-d" }).C).toBe(2 * demi.W + jourUnPoteau(demi));
    expect(changeForme(demi, { ...demi, forme: "demi-g" })).toEqual({ ...demi, forme: "demi-g" });
  });

  it("relit un lien de demi-tournant à l'identique", () => {
    const v = { ...DEFAULTS, forme: "demi-g" as const, ...E, J: 160 };
    const hash = paramsToHash(v);
    expect(hash).toContain("forme=demi-g");
    expect(hash).toContain("J=160");
    expect(paramsFromHash(`#${hash}`)).toEqual(v);
  });

  it("résume les deux côtés et le jour", () => {
    const s = sectionSummaries(p, D);
    expect(s.forme).toBe("Demi-tournant droit");
    expect(s.dimensions.replace(/\s/g, " ")).toContain("2 600 × 2 600, jour 200");
  });
});
