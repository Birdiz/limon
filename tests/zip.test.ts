import { describe, expect, it } from "vitest";
import { crc32, makeZip } from "../src/cnc/zip";

const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint32(o, true);
const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset).getUint16(o, true);

describe("zip", () => {
  it("calcule le CRC32 standard", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("range les fichiers sans compression, relisibles depuis le répertoire central", () => {
    const files = [
      { name: "a.txt", data: "bonjour" },
      { name: "é.dxf", data: new Uint8Array([1, 2, 3]) },
    ];
    const z = makeZip(files, new Date(2026, 0, 2, 3, 4, 6));
    const eocd = z.length - 22;
    expect(u32(z, eocd)).toBe(0x06054b50);
    expect(u16(z, eocd + 10)).toBe(2);
    let cd = u32(z, eocd + 16);
    const dec = new TextDecoder();
    for (const f of files) {
      expect(u32(z, cd)).toBe(0x02014b50);
      const nameLen = u16(z, cd + 28),
        local = u32(z, cd + 42),
        size = u32(z, cd + 24);
      expect(dec.decode(z.subarray(cd + 46, cd + 46 + nameLen))).toBe(f.name);
      expect(u32(z, local)).toBe(0x04034b50);
      const data = z.subarray(local + 30 + nameLen, local + 30 + nameLen + size);
      const expected = typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data;
      expect([...data]).toEqual([...expected]);
      expect(u32(z, cd + 16)).toBe(crc32(expected));
      cd += 46 + nameLen;
    }
  });
});
