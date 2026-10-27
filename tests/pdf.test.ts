import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fichePDF } from "../src/pdf/fiche";
import { PdfDoc, textWidth, wrap } from "../src/pdf/pdf";
import { CASES, stairOf } from "./cases";

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

/** Vérifie que chaque entrée de la table xref pointe sur le début de son objet. */
function checkXref(pdf: Uint8Array): number {
  const s = latin1(pdf);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
  const [head, ...rows] = s.slice(start).split("\n");
  expect(head).toBe("xref");
  const count = Number(rows[0]!.split(" ")[1]);
  for (let i = 1; i < count; i++) {
    const off = Number(rows[1 + i]!.slice(0, 10));
    expect(s.slice(off, off + 12)).toMatch(new RegExp(`^${i} 0 obj\\n`));
  }
  return count;
}

/* Fiches de référence, sans vue 3D et à date fixe. Pour en refaire une, supprimer son fichier. */
describe.each(Object.entries(CASES))("fiche %s", (name, over) => {
  const R = stairOf(over);
  const pdf = fichePDF(R, { nom: `Escalier ${name}`, date: "01/01/2026" });

  it("produit la même fiche PDF", () => {
    const file = new URL(`__snapshots__/${name}-fiche.pdf`, import.meta.url);
    if (!existsSync(file)) writeFileSync(file, pdf);
    expect(Buffer.from(pdf).equals(readFileSync(file))).toBe(true);
  });

  it("écrit un PDF 1.4 de deux pages aux décalages justes", () => {
    const s = latin1(pdf);
    expect(s.startsWith("%PDF-1.4\n%")).toBe(true);
    expect(s.match(/\/Type \/Page /g)).toHaveLength(2);
    checkXref(pdf);
    expect(s).toContain("(FICHE DES MARCHES) Tj");
  });
});

describe("écrivain PDF", () => {
  it("incorpore une image JPEG", () => {
    const doc = new PdfDoc("Essai é");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const pg = doc.page();
    pg.image(doc.jpeg(jpeg, 4, 3), 10, 10, 40, 30);
    const pdf = doc.bytes();
    const s = latin1(pdf);
    expect(s).toContain("/Filter /DCTDecode /Length 9 >>\nstream\n");
    expect(s).toContain("/XObject << /Im1 6 0 R >>");
    expect(s).toContain("/Title <FEFF00450073007300610069002000E9>");
    checkXref(pdf);
  });

  it("encode les accents en WinAnsi", () => {
    const doc = new PdfDoc("x");
    doc.page().text(0, 10, "Échappée 2 000 (°)", { size: 10 });
    expect(latin1(doc.bytes())).toContain("(\\311chapp\\351e 2 000 \\(\\260\\))");
  });

  it("mesure et coupe le texte", () => {
    expect(textWidth("0000", 10)).toBeCloseTo(22.24, 6);
    expect(textWidth("é", 10)).toBe(textWidth("e", 10));
    expect(wrap("un deux trois quatre", 10, textWidth("un deux trois", 10))).toEqual(["un deux trois", "quatre"]);
  });
});
