import { describe, expect, it } from "vitest";
import { buildCNC, oversize, stockVolume, tightBoards } from "../src/cnc/build";
import { toDXF } from "../src/cnc/dxf";
import { exportFiles, exportFilename, readme } from "../src/cnc/package";
import { treadsCSV } from "../src/core/sheet";
import { PERCAGE, TENON } from "../src/core/stair";
import { stringerOutline } from "../src/core/stringer";
import { bbox } from "../src/core/vec";
import { CASES, stairOf } from "./cases";

/* Les fichiers de référence de tests/__snapshots__ sont identiques, à l'octet près,
   à ceux de la dernière version en un seul fichier HTML (limon.html, commit 8ce7f38). */
describe.each(Object.entries(CASES))("export %s", (name, over) => {
  const R = stairOf(over);
  const cnc = buildCNC(R);
  const marches = toDXF(cnc.treadEnts),
    limons = toDXF(cnc.boardEnts),
    contremarches = toDXF(cnc.riserEnts),
    poteau = toDXF(cnc.postEnts);

  it("produit les mêmes DXF, fiche et notice", async () => {
    await expect(marches).toMatchFileSnapshot(`__snapshots__/${name}-marches.dxf`);
    await expect(limons).toMatchFileSnapshot(`__snapshots__/${name}-limons.dxf`);
    if (R.params.cm) await expect(contremarches).toMatchFileSnapshot(`__snapshots__/${name}-contremarches.dxf`);
    if (R.newel) await expect(poteau).toMatchFileSnapshot(`__snapshots__/${name}-poteau.dxf`);
    await expect(treadsCSV(R)).toMatchFileSnapshot(`__snapshots__/${name}.csv`);
    await expect(readme(R)).toMatchFileSnapshot(`__snapshots__/${name}-lisezmoi.txt`);
  });

  it("écrit un DXF R12 en ASCII, fins de ligne CRLF", () => {
    for (const dxf of [marches, limons, contremarches, poteau]) {
      expect(dxf).toMatch(/^ {2}0\r\nSECTION\r\n/);
      expect(dxf).toContain("\r\nAC1009\r\n");
      expect(dxf.endsWith("  0\r\nEOF\r\n")).toBe(true);
      expect(/[^\x20-\x7e\r\n]/.test(dxf)).toBe(false);
    }
  });

  it("découpe une marche par giron et un limon par tronçon", () => {
    const cut = (ents: typeof cnc.treadEnts) => ents.filter((e) => e.kind === "poly" && e.layer === "DECOUPE");
    expect(cut(cnc.treadEnts)).toHaveLength(R.treads.length);
    expect(cut(cnc.boardEnts)).toHaveLength(R.stringers.length);
    expect(cnc.riserParts).toHaveLength(R.params.cm ? R.n : 0);
    expect(cut(cnc.riserEnts)).toHaveLength(R.params.cm ? R.n : 0);
  });

  it("met contremarches.dxf dans l'archive seulement s'il y a des contremarches", () => {
    expect(exportFiles(R, cnc).some((f) => f.name === "contremarches.dxf")).toBe(R.params.cm);
  });

  it("met poteau.dxf dans l'archive seulement en quart tournant", () => {
    expect(exportFiles(R, cnc).some((f) => f.name === "poteau.dxf")).toBe(R.quart);
    expect(cnc.postEnts.length > 0).toBe(R.quart);
  });

  it("arrondit le bout avant des logements de marche quand le nez est arrondi", () => {
    // Bulge DXF : code de groupe 42 sur les sommets.
    expect(limons.includes("\r\n 42\r\n")).toBe(R.rn > 0);
  });

  it("place des logements dans chaque limon", () => {
    for (const b of cnc.boardParts) expect(b.pockets).toBeGreaterThan(0);
  });

  it("nomme l'archive d'après la forme et le nombre de hauteurs", () => {
    expect(exportFilename(R)).toMatch(/^escalier-(droit|quart-gauche|quart-droit)-\d+h\.zip$/);
  });
});

describe("logements sous le bord du limon", () => {
  it("ne signale rien avec l'exemple par défaut", () => {
    for (const forme of ["droit", "quart-g", "quart-d"] as const)
      expect(tightBoards(buildCNC(stairOf({ forme })).boardParts)).toEqual([]);
  });

  it("repère les limons de mur trop étroits pour des marches plus hautes", () => {
    const tight = tightBoards(buildCNC(stairOf({ forme: "quart-d", H: 3200 })).boardParts);
    expect(tight.map((b) => b.name)).toEqual(["LIMON DE MUR 1/2", "LIMON DE MUR 2/2"]);
  });
});

describe("plateaux et volume", () => {
  it("fait tenir l'exemple dans les plateaux par défaut", () => {
    for (const forme of ["droit", "quart-g", "quart-d"] as const) {
      const R = stairOf({ forme });
      expect(oversize(buildCNC(R), R.params.pL, R.params.pW)).toEqual({ treads: [], risers: [], boards: [] });
    }
  });

  it("repère les marches trop profondes et les limons trop longs", () => {
    const big = oversize(buildCNC(stairOf({ forme: "quart-d" })), 3000, 520);
    expect(big.treads.map((q) => q.j)).toEqual([9]);
    expect(big.risers).toEqual([]);
    expect(big.boards.map((b) => b.name)).toEqual(["LIMON DE MUR 1/2"]);
  });

  it("additionne le volume brut de chaque pièce", () => {
    // Escalier droit : 2 limons 4 567 × 280 × 45, 14 marches 880 × 313 × 40, 15 contremarches 880 × 140 × 22.
    const R = stairOf({ forme: "droit" });
    expect(stockVolume(buildCNC(R), R)).toBeCloseTo(0.31, 2);
    const sans = stairOf({ forme: "droit", cm: false });
    expect(stockVolume(buildCNC(sans), sans)).toBeLessThan(0.28);
  });
});

describe("poteau et raccord des limons", () => {
  const R = stairOf({ forme: "quart-d" });
  const N = R.newel!,
    p = R.params;
  const jour = R.stringers.filter((sp) => sp.side === "in");

  it("arrête les limons de jour sur les faces du poteau, affleurant côté marches", () => {
    const K = R.A - R.W;
    expect(N.size).toBe(p.ps);
    expect(N.c).toEqual([R.W + p.ps / 2, K - p.ps / 2]);
    expect(jour[0]!.prof.at(-1)![0]).toBeCloseTo(K - p.ps, 6);
    expect(jour[1]!.prof[0]![0]).toBeCloseTo(p.ps, 6);
    // Tête du poteau au-dessus du limon le plus haut qui y arrive.
    expect(N.h).toBeGreaterThanOrEqual(Math.max(jour[0]!.prof.at(-1)![1], jour[1]!.prof[0]![1]) + TENON.tete);
  });

  it("donne à chaque limon de jour un tenon qui sort de son bout côté poteau", () => {
    for (const sp of jour) {
      const t = sp.tenon!,
        o = bbox(stringerOutline(sp, sp.hl));
      expect(t.u1 - t.u0).toBe(TENON.long);
      expect(sp.idx === 0 ? o.x1 : o.x0).toBeCloseTo(sp.idx === 0 ? t.u1 : t.u0, 6);
      // Le tenon reste derrière la profondeur des logements, dans l'épaisseur du limon.
      expect(t.t0).toBeGreaterThan(p.enc + p.jeu);
      expect(t.t1).toBeLessThan(p.el);
      expect(t.z1 - t.z0).toBeGreaterThan(200);
    }
    for (const sp of R.stringers.filter((s) => s.side === "out")) expect(sp.tenon).toBeNull();
  });

  it("creuse dans le poteau une mortaise à la mesure de chaque tenon, jeu compris", () => {
    const ms = N.faces.flatMap((f) => f.mortises);
    expect(ms.map((m) => m.idx)).toEqual([0, 1]);
    for (const m of ms) {
      const t = jour[m.idx]!.tenon!,
        b = bbox(m.pts);
      expect(b.x1 - b.x0).toBeCloseTo(t.t1 - t.t0 + 2 * p.jeu, 6);
      expect(b.y1 - b.y0).toBeCloseTo(t.z1 - t.z0 + 2 * p.jeu, 6);
      expect(m.depth).toBeCloseTo(t.u1 - t.u0 + TENON.fond, 6);
    }
  });

  it("garde les deux mortaises l'une hors de l'autre", () => {
    // Mortaise du 1/2 : entre dans la face sud jusqu'à y0 + profondeur ; celle du 2/2 occupe y = K - t.
    const K = R.A - R.W,
      [m0, m1] = N.faces.flatMap((f) => f.mortises);
    const reach0 = K - p.ps + m0!.depth,
      near1 = K - Math.max(...m1!.pts.map((q) => q[0]));
    expect(reach0).toBeLessThan(near1);
  });

  it("loge dans le poteau les marches et contremarches du tournant qui le touchent", () => {
    const steps = N.faces.filter((f) => f.pockets.length);
    expect(steps.map((f) => f.n)).toEqual([
      [-1, 0],
      [0, 1],
    ]);
    expect(steps.reduce((k, f) => k + f.pockets.length, 0)).toBeGreaterThanOrEqual(3);
    const ents = buildCNC(R).postEnts;
    expect(ents.filter((e) => e.kind === "poly" && e.layer === "DECOUPE")).toHaveLength(4);
    expect(ents.filter((e) => e.kind === "poly" && e.layer === "MORTAISE")).toHaveLength(2);
  });

  it("perce le limon de mur 1/2 pour l'about du 2/2, hors des logements", () => {
    const [m1, m2] = R.stringers.filter((s) => s.side === "out");
    expect(m2!.holes).toEqual([]);
    expect(m1!.holes).toHaveLength(2);
    const end = m1!.prof.at(-1)![0];
    for (const [u, z] of m1!.holes) {
      expect(u).toBeGreaterThan(end - p.el + p.enc + p.jeu + PERCAGE / 2);
      expect(u).toBeLessThan(end - PERCAGE / 2);
      for (const pk of m1!.pockets) {
        const b = bbox(pk);
        const inside =
          u + PERCAGE / 2 > b.x0 && u - PERCAGE / 2 < b.x1 && z + PERCAGE / 2 > b.y0 && z - PERCAGE / 2 < b.y1;
        expect(inside).toBe(false);
      }
    }
    expect(toDXF(buildCNC(R).boardEnts)).toContain("\r\nCIRCLE\r\n");
  });

  it("ne déclare les calques d'assemblage que dans les fichiers qui s'en servent", () => {
    const D = buildCNC(stairOf({ forme: "droit" }));
    expect(toDXF(D.boardEnts)).not.toContain("TENON");
    expect(toDXF(buildCNC(R).boardEnts)).toContain("\r\nTENON\r\n");
    expect(toDXF(buildCNC(R).treadEnts)).not.toContain("MORTAISE");
  });

  it("compte le poteau dans le volume débité", () => {
    const cnc = buildCNC(R);
    expect(cnc.postPart).toEqual({ L: N.h, l: p.ps, e: p.ps });
    const sans = { ...cnc, postPart: null };
    expect(stockVolume(cnc, R) - stockVolume(sans, R)).toBeCloseTo((N.h * p.ps * p.ps) / 1e9, 9);
  });
});
