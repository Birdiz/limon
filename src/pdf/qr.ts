/* Code QR (ISO/IEC 18004) écrit à la main : mode octet, correction M (15 % du code peut manquer),
   version la plus petite qui contient le texte, masque choisi par les pénalités de la norme. */

/** Codes de correction par bloc et nombre de blocs, niveau M, versions 1 à 40 (indice 0 inutilisé). */
const ECC_PER_BLOCK = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS = [
  0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33,
  35, 37, 38, 40, 43, 45, 47, 49,
];

/** Modules libres pour les données et la correction (hors motifs, format et version), en bits. */
function rawModules(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const na = Math.floor(v / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}

const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v]! * BLOCKS[v]!;

/** Centres des motifs d'alignement. */
function alignments(v: number): number[] {
  if (v === 1) return [];
  const na = Math.floor(v / 7) + 2,
    size = 17 + 4 * v;
  const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < na; pos -= step) out.splice(1, 0, pos);
  return out;
}

/* Reed-Solomon sur GF(256), polynôme 0x11d. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j]!, root);
      if (j + 1 < degree) out[j]! ^= out[j + 1]!;
    }
    root = gfMul(root, 2);
  }
  return out;
}

function rsRemainder(data: readonly number[], div: readonly number[]): number[] {
  const out = new Array<number>(div.length).fill(0);
  for (const b of data) {
    const f = b ^ out.shift()!;
    out.push(0);
    div.forEach((c, i) => (out[i]! ^= gfMul(c, f)));
  }
  return out;
}

/** Octets de données complétés, découpés en blocs, chacun suivi de sa correction, puis entrelacés. */
function codewords(bytes: Uint8Array, v: number): number[] {
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const nb = BLOCKS[v]!,
    ecc = ECC_PER_BLOCK[v]!,
    raw = Math.floor(rawModules(v) / 8);
  const short = nb - (raw % nb),
    shortLen = Math.floor(raw / nb);
  const div = rsDivisor(ecc);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - ecc + (i < short ? 0 : 1));
    k += dat.length;
    const e = rsRemainder(dat, div);
    // Les blocs courts reçoivent une case vide, sautée à l'entrelacement.
    if (i < short) dat.push(0);
    blocks.push([...dat, ...e]);
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - ecc || j >= short) out.push(b[i]!);
    });
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Pénalités de la norme : suites de même couleur, carrés 2 × 2, motifs de repère, équilibre clair et foncé. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    // 1:1:3:1:1 bordé de quatre modules clairs (ou du bord).
    for (let i = 0; i + 7 <= size; i++) {
      const core = [true, false, true, true, true, false, true].every((d, k) => get(i + k) === d);
      if (!core) continue;
      const light = (a: number, b: number) => {
        for (let k = a; k < b; k++) if (k >= 0 && k < size && get(k)) return false;
        return true;
      };
      if (light(i - 4, i) || light(i + 7, i + 11)) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => m[y]![x]!);
  for (let x = 0; x < size; x++) line((y) => m[y]![x]!);
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = m[y]![x]!;
      if (c) dark++;
      if (x + 1 < size && y + 1 < size && c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1])
        score += 3;
    }
  score += Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  return score;
}

/** Matrice du code QR (true = module foncé), sans la marge claire de 4 modules à laisser autour. */
export function qrMatrix(text: string, forceMask?: number): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let v = 1;
  while (v <= 40 && dataCodewords(v) * 8 < 4 + (v < 10 ? 8 : 16) + bytes.length * 8) v++;
  if (v > 40) throw new Error("Texte trop long pour un code QR");
  const size = 17 + 4 * v;
  const mod = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, d: boolean) => {
    mod[y]![x] = d;
    fn[y]![x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const)
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx,
          y = cy + dy,
          d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
  const al = alignments(v),
    last = al.length - 1;
  al.forEach((ax, i) =>
    al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const format = (mask: number) => {
    // Niveau M : bits 00.
    const data = mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412,
      bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (v >= 7) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (v << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const d = ((bits >>> i) & 1) !== 0,
        a = size - 11 + (i % 3),
        b = Math.floor(i / 3);
      set(a, b, d);
      set(b, a, d);
    }
  }

  // Données en zigzag, par colonnes de deux, de droite à gauche, en sautant la colonne de synchronisation.
  const cw = codewords(bytes, v);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          up = ((right + 1) & 2) === 0,
          y = up ? size - 1 - vert : vert;
        if (!fn[y]![x] && i < cw.length * 8) {
          mod[y]![x] = ((cw[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }

  const masked = (k: number) => {
    format(k);
    return mod.map((row, y) => row.map((d, x) => (fn[y]![x] ? d : d !== MASKS[k]!(x, y))));
  };
  if (forceMask !== undefined) return masked(forceMask);
  let best: boolean[][] | null = null,
    bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    const m = masked(k),
      s = penalty(m);
    if (s < bestScore) [best, bestScore] = [m, s];
  }
  return best!;
}
