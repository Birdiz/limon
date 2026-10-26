import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { toDXF } from "../src/cnc/dxf";
import { exportFiles, exportFilename, readme } from "../src/cnc/package";
import { treadsCSV } from "../src/core/sheet";
import { CASES, stairOf } from "./cases";

/* Les fichiers de référence de tests/__snapshots__ sont identiques, à l'octet près,
   à ceux de la dernière version en un seul fichier HTML (limon.html, commit 8ce7f38). */
describe.each(Object.entries(CASES))("export %s", (name, over) => {
  const R = stairOf(over);
  const cnc = buildCNC(R);
  const marches = toDXF(cnc.treadEnts),
    limons = toDXF(cnc.boardEnts),
    contremarches = toDXF(cnc.riserEnts);

  it("produit les mêmes DXF, fiche et notice", async () => {
    await expect(marches).toMatchFileSnapshot(`__snapshots__/${name}-marches.dxf`);
    await expect(limons).toMatchFileSnapshot(`__snapshots__/${name}-limons.dxf`);
    if (R.params.cm) await expect(contremarches).toMatchFileSnapshot(`__snapshots__/${name}-contremarches.dxf`);
    await expect(treadsCSV(R)).toMatchFileSnapshot(`__snapshots__/${name}.csv`);
    await expect(readme(R)).toMatchFileSnapshot(`__snapshots__/${name}-lisezmoi.txt`);
  });

  it("écrit un DXF R12 en ASCII, fins de ligne CRLF", () => {
    for (const dxf of [marches, limons, contremarches]) {
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
