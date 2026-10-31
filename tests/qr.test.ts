import { describe, expect, it } from "vitest";
import { qrMatrix } from "../src/pdf/qr";

/* Le codeur a aussi été relu par le lecteur de codes d'Apple (Vision, celui de l'appareil photo de l'iPhone) :
   textes de 5 à 1 000 octets, chacun des huit masques, et le code de chaque fiche de référence. */

const sizeFor = (bytes: number) => qrMatrix("x".repeat(bytes)).length;

/** Bits de format lus autour du repère haut gauche, puis démasqués. */
function formatBits(m: boolean[][]): number {
  const at = (x: number, y: number) => (m[y]![x] ? 1 : 0);
  const bits = [...[0, 1, 2, 3, 4, 5, 7, 8].map((y) => at(8, y)), at(7, 8), ...[5, 4, 3, 2, 1, 0].map((x) => at(x, 8))];
  return bits.reduce((v, b, i) => v | (b << i), 0) ^ 0x5412;
}

describe("code QR", () => {
  it("prend la plus petite version qui contient le texte (correction M, mode octet)", () => {
    // Capacités de la norme en octets : version 1 → 14, 2 → 26, 3 → 42, 4 → 62, 7 → 122, 10 → 213.
    for (const [v, cap] of [
      [1, 14],
      [2, 26],
      [3, 42],
      [4, 62],
      [7, 122],
      [10, 213],
    ] as const) {
      expect(sizeFor(cap)).toBe(17 + 4 * v);
      expect(sizeFor(cap + 1)).toBe(17 + 4 * (v + 1));
    }
  });

  it("compte les octets UTF-8", () => {
    expect(qrMatrix("é".repeat(7)).length).toBe(21);
    expect(qrMatrix("é".repeat(8)).length).toBe(25);
  });

  it("écrit des bits de format valides, niveau M, avec le masque choisi", () => {
    for (let mask = 0; mask < 8; mask++) {
      const f = formatBits(qrMatrix("https://quart-de-tour.fr/app/#forme=droit", mask));
      expect(f >>> 13).toBe(0); // niveau M
      expect((f >>> 10) & 7).toBe(mask);
      let rem = f;
      for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
      expect(rem).toBe(0);
    }
  });

  it("trace les repères et les lignes de synchronisation", () => {
    const m = qrMatrix("https://quart-de-tour.fr/app/#forme=dq-g&A=2000&B=1900");
    const n = m.length;
    for (const [x, y] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ] as const) {
      expect(m[y]![x]).toBe(true);
      expect(m[y + 1]![x + 1]).toBe(false);
      expect(m[y + 3]![x + 3]).toBe(true);
    }
    for (let i = 8; i < n - 8; i++) {
      expect(m[6]![i]).toBe(i % 2 === 0);
      expect(m[i]![6]).toBe(i % 2 === 0);
    }
    expect(m[n - 8]![8]).toBe(true);
  });
});
