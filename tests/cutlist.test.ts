import { describe, expect, it } from "vitest";
import { buildCNC, stockVolume } from "../src/cnc/build";
import { cutListCSV, cutRows } from "../src/cnc/cutlist";
import { exportFiles, readme } from "../src/cnc/package";
import { CASES, stairOf } from "./cases";

/** Cellules d'une ligne du CSV (aucune cellule de ces cas n'est entre guillemets). */
const cells = (line: string) => line.split(";");
/** Nombre écrit avec une virgule décimale. */
const fr = (s: string) => Number(s.replace(",", "."));

describe.each(Object.entries(CASES))("liste de débit %s", (name, over) => {
  const R = stairOf(over);
  const cnc = buildCNC(R);
  const csv = cutListCSV(cnc, R);
  const lines = csv.split("\n");

  it("produit la même liste de débit", async () => {
    await expect(csv).toMatchFileSnapshot(`__snapshots__/${name}-debit.csv`);
  });

  it("donne une ligne par ligne de la liste de débit, puis le total", () => {
    const rows = cutRows(cnc, R);
    expect(lines).toHaveLength(rows.length + 2);
    expect(lines[0]).toBe("Pièce;Essence;Épaisseur (mm);Longueur (mm);Largeur (mm);Quantité;Volume (m³)");
    rows.forEach((r, i) => {
      const c = cells(lines[i + 1]!);
      expect(c).toHaveLength(7);
      expect(c[0]).toBe(r.name);
      expect(c[1]).toBe("Chêne");
      expect([fr(c[2]!), fr(c[3]!), fr(c[4]!), Number(c[5])]).toEqual([r.e, r.L, r.l, r.q]);
    });
    const total = cells(lines.at(-1)!);
    expect(total.slice(0, 5)).toEqual(["Total", "", "", "", ""]);
    expect(Number(total[5])).toBe(rows.reduce((n, r) => n + r.q, 0));
  });

  it("additionne au total le volume de chaque ligne, proche du volume de la fiche", () => {
    const vols = lines.slice(1, -1).map((l) => fr(cells(l)[6]!));
    const total = fr(cells(lines.at(-1)!)[6]!);
    expect(total).toBeCloseTo(
      vols.reduce((v, x) => v + x, 0),
      3,
    );
    // Cotes brutes arrondies au millimètre supérieur : un peu plus que le volume exact, jamais moins.
    expect(total).toBeGreaterThanOrEqual(stockVolume(cnc, R) - 5e-5);
    expect(total - stockVolume(cnc, R)).toBeLessThan(0.001);
  });

  it("suit les contremarches et le garde-corps", () => {
    expect(csv.includes("Contremarche")).toBe(R.params.cm);
    expect(/Main courante|Balustre|Montant|Lisse/.test(csv)).toBe(R.params.gc !== "aucun");
    expect(csv.includes("Poteau")).toBe(R.quart);
  });

  it("met la liste de débit dans l'archive, avec un BOM, et la cite dans la notice", () => {
    const f = exportFiles(R, cnc).find((x) => x.name === "liste-debit.csv");
    expect(f?.data).toBe("﻿" + csv);
    expect(readme(R)).toContain("liste-debit.csv : ");
  });
});

describe("liste de débit pour le tableur", () => {
  it("écrit les cotes décimales avec une virgule, sans séparateur de milliers", () => {
    const R = stairOf({ forme: "droit", et: 27.5, ecm: 18.25 });
    const csv = cutListCSV(buildCNC(R), R);
    const marche = cells(csv.split("\n").find((l) => l.startsWith("Marche"))!);
    expect(marche[2]).toBe("27,5");
    // Une seule décimale pour les cotes, comme sur la fiche des marches.
    expect(cells(csv.split("\n").find((l) => l.startsWith("Contremarche"))!)[2]).toBe("18,3");
    // Les limons font plus de 1 000 mm : pas d'espace dans le nombre.
    expect(cells(csv.split("\n").find((l) => l.startsWith("Limon"))!)[3]).toMatch(/^\d{4,}$/);
    expect(csv).not.toMatch(/[\u00a0\u202f]/);
    expect(csv).not.toContain(".");
  });

  it("écrit l'essence et les noms avec leurs accents", () => {
    const R = stairOf({ forme: "quart-d", ess: "hetre" });
    const csv = cutListCSV(buildCNC(R), R);
    expect(csv).toContain(";Hêtre;");
    expect(csv.split("\n")[0]).toContain("Pièce;Essence;Épaisseur (mm)");
    expect(csv).toContain("Volume (m³)");
    // Encodé en UTF-8 dans l'archive : « ê » sur deux octets.
    const bytes = new TextEncoder().encode(exportFiles(R).find((f) => f.name === "liste-debit.csv")!.data as string);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("met entre guillemets une pièce dont le nom contient un point-virgule", () => {
    const R = stairOf({ forme: "droit" });
    const cnc = buildCNC(R);
    cnc.boardParts[0]!.name = 'LIMON "A"; MUR';
    const line = cutListCSV(cnc, R).split("\n")[1]!;
    expect(line.startsWith('"Limon ""a""; mur";Chêne;')).toBe(true);
  });
});
