/* Archive zip sans compression (méthode « stored »), noms en UTF-8. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  name: string;
  data: string | Uint8Array;
}

export function makeZip(files: readonly ZipFile[], date = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder(),
    parts: Uint8Array[] = [],
    central: Uint8Array[] = [];
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  let offset = 0;
  files.forEach((f) => {
    const name = enc.encode(f.name),
      data = typeof f.data === "string" ? enc.encode(f.data) : f.data,
      crc = crc32(data),
      sz = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, day, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, sz, true);
    lh.setUint32(22, sz, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, day, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, sz, true);
    ch.setUint32(24, sz, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + sz;
  });
  const cdSize = central.reduce((a, b) => a + b.length, 0),
    eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(8, files.length, true);
  eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true);
  eo.setUint32(16, offset, true);
  const chunks = [...parts, ...central, new Uint8Array(eo.buffer)];
  const out = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
