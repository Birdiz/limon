import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { toDXF } from "../src/cnc/dxf";
import { readme } from "../src/cnc/package";
import { ATELIER_KEYS, atelierDefauts } from "../src/core/atelier";
import { coupeNez } from "../src/core/coupe-nez";
import { inPolygon } from "../src/core/headroom";
import { ARETE_CASSEE, aretes, nezCote, noseProfile } from "../src/core/nez";
import { DEFAULTS, EXEMPLE_U, sanitizeParams, type Params } from "../src/core/params";
import { paramsFromHash, paramsToHash } from "../src/core/share";
import { RAINURE_ARRET, compute } from "../src/core/stair";
import { V, type Pt, type Vertex } from "../src/core/vec";
import { stairOf } from "./cases";

const err = (over: Partial<Params>) => {
  const r = compute({ ...DEFAULTS, ...over });
  return r.ok ? [] : r.errors.map((e) => e.key);
};

describe("réglages des finitions", () => {
  it("gardent les anciens projets comme avant : nez arrondi, sans rainures, contremarche sur la marche", () => {
    const { nez, rai, cmPose, cmEmb, ...ancien } = DEFAULTS;
    void [nez, rai, cmPose, cmEmb];
    const p = sanitizeParams(ancien);
    expect([p.nez, p.rai, p.cmPose, p.cmEmb]).toEqual(["arrondi", false, "sur", 0]);
  });

  it("se relisent d'un fichier, et refusent une valeur inconnue", () => {
    const p = sanitizeParams({ nez: "chanfrein", cmPose: "derriere", rai: true, raiN: 3, cmEmb: 8 });
    expect([p.nez, p.cmPose, p.rai, p.raiN, p.cmEmb]).toEqual(["chanfrein", "derriere", true, 3, 8]);
    expect(sanitizeParams({ nez: "ogive", cmPose: "dessous" })).toMatchObject({ nez: "arrondi", cmPose: "sur" });
  });

  it("passent dans le lien de projet", () => {
    const p: Params = { ...DEFAULTS, nez: "quart", cmPose: "derriere", rai: true, raiD: 30 };
    expect(paramsFromHash(paramsToHash(p))).toEqual(p);
  });

  it("font partie du profil de l'atelier", () => {
    for (const k of ["nez", "rai", "raiN", "raiL", "raiP", "raiD", "raiE", "cmPose", "cmEmb"] as const)
      expect(ATELIER_KEYS).toContain(k);
    expect(atelierDefauts({ ...DEFAULTS, nez: "casse" }).nez).toBe("casse");
  });
});

describe("profil du nez", () => {
  it("donne la cote appliquée : au plus la moitié de l'épaisseur, 2 mm fixes aux arêtes cassées", () => {
    expect(nezCote("arrondi", 30, 40)).toBe(20);
    expect(nezCote("chanfrein", 8, 40)).toBe(8);
    expect(nezCote("casse", 0, 40)).toBe(ARETE_CASSEE);
    expect(stairOf({ nez: "casse", rn: 15 }).rn).toBe(ARETE_CASSEE);
  });

  it("profile le dessous en arrondi et aux arêtes cassées seulement", () => {
    expect(aretes("arrondi", 10).dessous.k).toBe("arc");
    expect(aretes("casse", 2).dessous.k).toBe("arc");
    expect(aretes("quart", 10)).toEqual({ dessus: { k: "arc", r: 10 }, dessous: { k: "vive" } });
    expect(aretes("chanfrein", 10)).toEqual({ dessus: { k: "chanfrein", c: 10 }, dessous: { k: "vive" } });
    expect(aretes("quart", 0).dessus.k).toBe("vive");
  });

  it("dessine une coupe fermée du dessous au dessus de la bande du nez", () => {
    for (const nez of ["arrondi", "quart", "chanfrein", "casse"] as const) {
      const r = nezCote(nez, 10, 40),
        q = noseProfile(nez, r, 40);
      expect(q[0]).toEqual([r, 0]);
      expect(q[q.length - 1]![0]).toBeCloseTo(r, 9);
      expect(q[q.length - 1]![1]).toBeCloseTo(40, 9);
      for (const [v, z] of q) {
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(z).toBeGreaterThanOrEqual(-1e-9);
      }
    }
    // Quart-de-rond et chanfrein : arête du dessous vive.
    expect(noseProfile("quart", 10, 40)).toContainEqual([0, 0]);
    expect(noseProfile("chanfrein", 10, 40)).toEqual([
      [10, 0],
      [0, 0],
      [0, 30],
      [10, 40],
    ]);
  });

  /** Logement de la marche 5 dans le limon droit de l'escalier droit. */
  const pocket = (over: Partial<Params>) => {
    const R = stairOf({ forme: "droit", ...over }),
      sp = R.stringers[0]!;
    return sp.pockets[sp.pocketOf.findIndex((o) => o.k === "marche" && o.j === 5)]!;
  };

  it("donne au bout avant des logements la forme du nez, jeu compris", () => {
    const bulges = (pk: readonly Vertex[]) => pk.filter((q) => q[2]).length;
    expect(bulges(pocket({}))).toBe(2);
    expect(bulges(pocket({ nez: "casse" }))).toBe(2);
    const q = pocket({ nez: "quart", rn: 12 });
    expect(bulges(q)).toBe(1);
    expect(q).toHaveLength(5);
    const c = pocket({ nez: "chanfrein", rn: 8, jeu: 0 });
    expect(bulges(c)).toBe(0);
    expect(c).toHaveLength(5);
    // Chanfrein à 45° : ses deux sommets à 8 mm du coin, en u et en z.
    const [, , a, b] = c as [number, number][];
    expect(Math.abs(a![0] - b![0])).toBeCloseTo(8, 6);
    expect(Math.abs(a![1] - b![1])).toBeCloseTo(8, 6);
    expect(bulges(pocket({ rn: 0 }))).toBe(0);
  });

  it("n'avertit que le dessous profilé qui mord sur la contremarche", () => {
    const warn = (over: Partial<Params>) =>
      stairOf({ forme: "droit", deb: 15, rn: 18, ...over }).notes.some((n) =>
        n[1].includes("mord sur la contremarche"),
      );
    expect(warn({})).toBe(true);
    expect(warn({ nez: "quart" })).toBe(false);
    expect(warn({ nez: "chanfrein" })).toBe(false);
  });

  it("s'écrit sur chaque marche du DXF", () => {
    const dxf = (over: Partial<Params>) => toDXF(buildCNC(stairOf({ forme: "droit", ...over })).treadEnts);
    expect(dxf({})).toContain("nez R10,0");
    expect(dxf({ nez: "quart", rn: 12 })).toContain("nez quart-de-rond R12,0");
    expect(dxf({ nez: "chanfrein", rn: 8 })).toContain("nez chanfrein 8,0 x 45 deg");
    expect(dxf({ nez: "casse" })).toContain("nez aretes cassees R2,0");
  });
});

describe("rainures antidérapantes", () => {
  const RAI = { rai: true, raiN: 2, raiL: 6, raiP: 3, raiD: 25, raiE: 15 } as const;

  it("se taillent parallèles au nez, à leur distance, arrêtées avant les limons", () => {
    const R = stairOf({ forme: "droit", ...RAI });
    for (const t of R.treads) {
      expect(t.grooves).toHaveLength(2);
      const ln = R.lines[t.j - 1]!;
      t.grooves.forEach((g, i) => {
        const v = g.map((q) => V.dot(V.sub(q, ln.Q), ln.nr)),
          u = g.map((q) => V.dot(V.sub(q, ln.Q), ln.dir));
        expect(Math.min(...v)).toBeCloseTo(25 + 15 * i - 3, 6);
        expect(Math.max(...v)).toBeCloseTo(25 + 15 * i + 3, 6);
        expect(Math.max(...u) - Math.min(...u)).toBeCloseTo(R.W - 2 * RAINURE_ARRET, 6);
      });
    }
  });

  it("restent sur la marche dans le tournant, raccourcies là où le giron se resserre", () => {
    for (const over of [{ forme: "quart-d" }, { forme: "dq-g", ...EXEMPLE_U }] as Partial<Params>[]) {
      const R = stairOf({ ...over, ...RAI, raiN: 6 });
      for (const t of R.treads)
        for (const g of t.grooves) for (const q of g) expect(inPolygon(q, t.plan), `marche ${t.j}`).toBe(true);
      const len = (g: Pt[]) => V.len(V.sub(g[1]!, g[0]!));
      const bal = R.treads.filter((t) => t.balanced);
      // La dernière rainure, la plus loin du nez, s'arrête avant la ligne de nez suivante, au jour.
      expect(
        bal.some((t) => {
          const l = t.grooves.map(len);
          return l[l.length - 1]! < Math.max(...l) - 1;
        }),
      ).toBe(true);
    }
  });

  it("préviennent quand une marche en reçoit moins", () => {
    const R = stairOf({ forme: "droit", ...RAI, raiN: 6, raiE: 50 });
    expect(R.notes.some((n) => n[1].startsWith("Rainures : "))).toBe(true);
    expect(stairOf({ forme: "droit", ...RAI }).notes.some((n) => n[1].startsWith("Rainures"))).toBe(false);
  });

  it("vont sur la marche palière, et sur leur calque dans marches.dxf", () => {
    const R = stairOf({ forme: "droit", mp: true, ...RAI });
    expect(R.mp!.grooves).toHaveLength(2);
    const cnc = buildCNC(R);
    expect(cnc.treadEnts.filter((e) => e.layer === "RAINURE")).toHaveLength(2 * (R.treads.length + 1));
    expect(readme(R)).toContain("RAINURE");
  });

  it("refusent des cotes impossibles sur leur champ", () => {
    expect(err({ ...RAI })).toEqual([]);
    expect(err({ ...RAI, raiN: 7 })).toEqual(["raiN"]);
    expect(err({ ...RAI, raiN: 2.5 })).toEqual(["raiN"]);
    expect(err({ ...RAI, raiL: 1 })).toEqual(["raiL"]);
    expect(err({ ...RAI, raiP: 11 })).toEqual(["raiP"]);
    // Dans le profil du nez (rayon 10) : axe à au moins 10 + 3 + 3 mm.
    expect(err({ ...RAI, raiD: 15 })).toEqual(["raiD"]);
    expect(err({ ...RAI, raiD: 16 })).toEqual([]);
    expect(err({ ...RAI, raiE: 8 })).toEqual(["raiE"]);
    expect(err({ ...RAI, raiE: 8, raiN: 1 })).toEqual([]);
    // Sans rainures, leurs cotes ne sont pas lues.
    expect(err({ ...RAI, rai: false, raiN: 0 })).toEqual([]);
  });

  it("se creusent sur la coupe au nez de la fiche", () => {
    const shapes = coupeNez(stairOf({ forme: "droit", ...RAI })).shapes;
    expect(shapes.some((s) => s.k === "text" && s.text === "2 rainures 6 × 3")).toBe(true);
  });
});

describe("pose de la contremarche", () => {
  it("sur la marche : du dessus de la marche du bas au dessous de celle du haut, comme avant", () => {
    const R = stairOf({ forme: "droit" });
    R.risers.forEach((r, i) => {
      expect(r.z0).toBeCloseTo(i * R.h, 6);
      expect(r.z1).toBeCloseTo((i + 1) * R.h - R.params.et, 6);
    });
  });

  it("derrière la marche : elle descend sous la marche du bas, qui raccourcit de son épaisseur", () => {
    const sur = stairOf({ forme: "droit" }),
      der = stairOf({ forme: "droit", cmPose: "derriere" });
    expect(der.risers[0]!.z0).toBe(0);
    der.risers.slice(1).forEach((r, i) => expect(r.z0).toBeCloseTo((i + 1) * der.h - der.params.et, 6));
    const a = buildCNC(sur),
      b = buildCNC(der);
    b.treadParts.forEach((t, i) => expect(t.l).toBeCloseTo(a.treadParts[i]!.l - sur.params.ecm, 6));
    b.riserParts.forEach((t, i) => expect(t.l).toBeCloseTo(a.riserParts[i]!.l + (i ? sur.params.et : 0), 6));
    // Plus de contremarche posée sur la marche ; la notice dit comment la visser.
    expect(b.treadEnts.some((e) => e.layer === "CM_DESSUS")).toBe(false);
    expect(readme(der)).toContain("vissée dans son chant arrière");
  });

  it("embrevée : elle monte dans la rainure de la marche du haut, sauf sous le plancher d'arrivée", () => {
    const R = stairOf({ forme: "droit", cmEmb: 8 }),
      n = R.risers.length;
    R.risers.forEach((r, i) => expect(r.z1).toBeCloseTo((i + 1) * R.h - R.params.et + (i < n - 1 ? 8 : 0), 6));
    const M = stairOf({ forme: "droit", cmEmb: 8, mp: true });
    expect(M.risers[n - 1]!.z1).toBeCloseTo(R.H - M.params.mpE + 8, 6);
    const ents = buildCNC(R).treadEnts;
    expect(ents.filter((e) => e.layer === "EMBREVEMENT")).toHaveLength(R.treads.length);
    expect(ents.some((e) => e.layer === "CM_DESSOUS")).toBe(false);
  });

  it("refuse un embrèvement de plus de la moitié de la marche", () => {
    expect(err({ cmEmb: 20 })).toEqual([]);
    expect(err({ cmEmb: 21 })).toEqual(["cmEmb"]);
    expect(err({ cmEmb: 21, cm: false })).toEqual([]);
  });

  it("se lit sur la coupe au nez de la fiche", () => {
    const texts = (over: Partial<Params>) =>
      coupeNez(stairOf({ forme: "droit", ...over })).shapes.flatMap((s) => (s.k === "text" ? [s.text] : []));
    expect(texts({})).toContain("sur la marche");
    expect(texts({ cmPose: "derriere", cmEmb: 8 })).toEqual(
      expect.arrayContaining(["derrière la marche", "embrevée de 8"]),
    );
    expect(texts({ cm: false }).some((t) => t.startsWith("contremarche"))).toBe(false);
  });
});
