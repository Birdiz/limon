/* Écrivain PDF 1.4 minimal : pages A4, Helvetica et Helvetica-Bold (polices standard, non incorporées),
   traits, polygones, texte, images JPEG. Coordonnées en points, origine en haut à gauche, y vers le bas. */

export const A4 = { w: 595.28, h: 841.89 };

export type RGB = [number, number, number];

/** Couleur #rrggbb. */
export const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;

/* Chasses Helvetica (millièmes de corps), d'après les métriques AFM d'Adobe, pour les codes 32 à 126.
   Les lettres accentuées prennent la chasse de leur lettre de base. */
const W_REG =
  "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584"
    .split(",")
    .map(Number);
const W_BOLD =
  "278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584"
    .split(",")
    .map(Number);
/** Caractères hors ASCII de WinAnsiEncoding (cp1252) utiles en français, avec leur code et leur chasse. */
const EXTRA: Record<string, [code: number, reg: number, bold: number]> = {
  "°": [0xb0, 400, 400],
  "×": [0xd7, 584, 584],
  "·": [0xb7, 278, 278],
  "«": [0xab, 556, 556],
  "»": [0xbb, 556, 556],
  "’": [0x92, 222, 278],
  "–": [0x96, 556, 556],
  "—": [0x97, 1000, 1000],
  "…": [0x85, 1000, 1000],
  œ: [0x9c, 944, 944],
  Œ: [0x8c, 1000, 1000],
  "²": [0xb2, 333, 333],
};

/** Code WinAnsi et chasse d'un caractère ; les espaces insécables deviennent des espaces. */
function glyph(ch: string, bold: boolean): [number, number] {
  if (ch === " " || ch === " ") ch = " ";
  const c = ch.codePointAt(0)!;
  const tbl = bold ? W_BOLD : W_REG;
  if (c >= 32 && c <= 126) return [c, tbl[c - 32]!];
  const x = EXTRA[ch];
  if (x) return [x[0], bold ? x[2] : x[1]];
  const base = ch.normalize("NFD")[0]!;
  const b = base.codePointAt(0)!;
  if (c >= 0xc0 && c <= 0xff && b >= 32 && b <= 126) return [c, tbl[b - 32]!];
  return [63, tbl[63 - 32]!]; // « ? »
}

/** Largeur d'un texte, en points. */
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) w += glyph(ch, bold)[1];
  return (w * size) / 1000;
}

/** Coupe un texte en lignes d'au plus maxW points. */
export function wrap(s: string, size: number, maxW: number, bold = false): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of s.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, size, bold) > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function pdfString(s: string, bold: boolean): string {
  let out = "(";
  for (const ch of s) {
    const c = glyph(ch, bold)[0];
    if (c === 40 || c === 41 || c === 92) out += "\\" + String.fromCharCode(c);
    else if (c < 32 || c > 126) out += "\\" + c.toString(8).padStart(3, "0");
    else out += String.fromCharCode(c);
  }
  return out + ")";
}

/** Nombre court et stable pour le flux de page. */
const n = (v: number) => {
  const s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};
const rgb = (c: RGB) => c.map((v) => n(v)).join(" ");

export interface Stroke {
  stroke?: RGB;
  fill?: RGB;
  width?: number;
  dash?: number[];
}

export interface TextStyle {
  size: number;
  bold?: boolean;
  color?: RGB;
  anchor?: "start" | "middle" | "end";
  /** Rotation en degrés, sens horaire à l'écran. */
  rot?: number;
  /** Détourage sous le texte, pour le détacher d'un trait. */
  halo?: { color: RGB; width: number };
}

export class Page {
  readonly ops: string[] = [];
  readonly images = new Set<string>();

  private y = (v: number) => A4.h - v;

  private paint(st: Stroke, close: boolean): void {
    const o: string[] = [];
    if (st.width !== undefined) o.push(`${n(st.width)} w`);
    o.push(st.dash ? `[${st.dash.map(n).join(" ")}] 0 d` : "[] 0 d");
    if (st.stroke) o.push(`${rgb(st.stroke)} RG`);
    if (st.fill) o.push(`${rgb(st.fill)} rg`);
    this.ops.splice(this.ops.length - 1, 0, o.join(" "));
    const op = st.fill && st.stroke ? "B" : st.fill ? "f" : "S";
    this.ops.push(close && op === "S" ? "s" : op);
  }

  path(pts: readonly (readonly [number, number])[], st: Stroke, close = false): void {
    if (pts.length < 2) return;
    this.ops.push(pts.map((p, i) => `${n(p[0])} ${n(this.y(p[1]))} ${i ? "l" : "m"}`).join(" ") + (close ? " h" : ""));
    this.paint(st, close);
  }

  rect(x: number, y: number, w: number, h: number, st: Stroke): void {
    this.ops.push(`${n(x)} ${n(this.y(y + h))} ${n(w)} ${n(h)} re`);
    this.paint(st, true);
  }

  circle(cx: number, cy: number, r: number, st: Stroke): void {
    const k = 0.5523 * r,
      X = cx,
      Y = this.y(cy);
    const c = (a: number[]) => a.map(n).join(" ");
    this.ops.push(
      `${c([X + r, Y])} m ${c([X + r, Y + k, X + k, Y + r, X, Y + r])} c ${c([X - k, Y + r, X - r, Y + k, X - r, Y])} c ` +
        `${c([X - r, Y - k, X - k, Y - r, X, Y - r])} c ${c([X + k, Y - r, X + r, Y - k, X + r, Y])} c h`,
    );
    this.paint(st, true);
  }

  /** Texte posé sur sa ligne de base en (x, y). */
  text(x: number, y: number, s: string, ts: TextStyle): void {
    const bold = !!ts.bold;
    const w = textWidth(s, ts.size, bold);
    const dx = ts.anchor === "middle" ? -w / 2 : ts.anchor === "end" ? -w : 0;
    const a = ((ts.rot ?? 0) * Math.PI) / 180,
      cos = Math.cos(a),
      sin = -Math.sin(a);
    const X = x + dx * cos,
      Y = this.y(y) + dx * sin;
    const set = `/${bold ? "F2" : "F1"} ${n(ts.size)} Tf ${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(X)} ${n(Y)} Tm`;
    const str = pdfString(s, bold);
    if (ts.halo)
      this.ops.push(`[] 0 d 1 j ${n(ts.halo.width)} w ${rgb(ts.halo.color)} RG BT ${set} 1 Tr ${str} Tj ET 0 j`);
    this.ops.push(`BT ${set} 0 Tr ${rgb(ts.color ?? [0, 0, 0])} rg ${str} Tj ET`);
  }

  image(name: string, x: number, y: number, w: number, h: number): void {
    this.images.add(name);
    this.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(this.y(y + h))} cm /${name} Do Q`);
  }
}

interface Jpeg {
  data: Uint8Array;
  w: number;
  h: number;
}

export class PdfDoc {
  private pages: Page[] = [];
  private jpegs = new Map<string, Jpeg>();

  constructor(private title: string) {}

  page(): Page {
    const p = new Page();
    this.pages.push(p);
    return p;
  }

  /** Déclare une image JPEG (sRGB) et renvoie son nom pour Page.image. */
  jpeg(data: Uint8Array, w: number, h: number): string {
    const name = `Im${this.jpegs.size + 1}`;
    this.jpegs.set(name, { data, w, h });
    return name;
  }

  bytes(): Uint8Array<ArrayBuffer> {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const put = (b: string | Uint8Array) => {
      const u = typeof b === "string" ? enc.encode(b) : b;
      chunks.push(u);
      size += u.length;
    };
    const offsets: number[] = [];
    const obj = (id: number, body: string | (string | Uint8Array)[]) => {
      offsets[id] = size;
      put(`${id} 0 obj\n`);
      for (const part of typeof body === "string" ? [body] : body) put(part);
      put("\nendobj\n");
    };
    // Numérotation : 1 catalogue, 2 pages, 3 et 4 polices, 5 informations, puis images, puis pages et contenus.
    const imgIds = new Map<string, number>();
    let next = 6;
    for (const k of this.jpegs.keys()) imgIds.set(k, next++);
    const pageIds = this.pages.map(() => {
      const id = next;
      next += 2;
      return id;
    });

    // Octets hors ASCII en commentaire : le fichier est binaire (il peut contenir des JPEG).
    put("%PDF-1.4\n%");
    put(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    // Titre en UTF-16BE, pour garder les accents dans les propriétés du document.
    const utf16 = [...this.title]
      .flatMap((ch) => {
        const c = ch.codePointAt(0)!;
        return c > 0xffff ? [] : [c.toString(16).padStart(4, "0")];
      })
      .join("");
    obj(5, `<< /Title <FEFF${utf16.toUpperCase()}> /Producer (Limon) >>`);
    for (const [k, im] of this.jpegs)
      obj(imgIds.get(k)!, [
        `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`,
        im.data,
        "\nendstream",
      ]);
    this.pages.forEach((p, i) => {
      const id = pageIds[i]!;
      const xo = [...p.images].map((k) => `/${k} ${imgIds.get(k)} 0 R`).join(" ");
      obj(
        id,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.w)} ${n(A4.h)}] /Contents ${id + 1} 0 R ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xo ? ` /XObject << ${xo} >>` : ""} >> >>`,
      );
      const content = p.ops.join("\n");
      obj(id + 1, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
    });
    const xref = size;
    put(`xref\n0 ${next}\n0000000000 65535 f \n`);
    for (let i = 1; i < next; i++) put(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
    put(`trailer\n<< /Size ${next} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}
