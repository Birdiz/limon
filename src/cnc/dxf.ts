import { LAYERS, type Entity } from "./entities";

/** Texte réduit à l'ASCII imprimable : le DXF R12 ne connaît pas l'UTF-8. */
export const ascii = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "");

/** DXF R12 (AC1009) en millimètres, fins de ligne CRLF. */
export function toDXF(ents: readonly Entity[]): string {
  const out: string[] = [];
  const g = (c: number, v: string | number) => out.push(String(c).padStart(3, " "), String(v));
  const n = (v: number) => v.toFixed(3);
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$INSUNITS");
  g(70, 4);
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LTYPE");
  g(70, 1);
  g(0, "LTYPE");
  g(2, "CONTINUOUS");
  g(70, 0);
  g(3, "Solid line");
  g(72, 65);
  g(73, 0);
  g(40, "0.0");
  g(0, "ENDTAB");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, LAYERS.length);
  LAYERS.forEach(([name, col]) => {
    g(0, "LAYER");
    g(2, name);
    g(70, 0);
    g(62, col);
    g(6, "CONTINUOUS");
  });
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  ents.forEach((e) => {
    if (e.kind === "poly") {
      g(0, "POLYLINE");
      g(8, e.layer);
      g(66, 1);
      g(10, "0.0");
      g(20, "0.0");
      g(30, "0.0");
      g(70, e.closed ? 1 : 0);
      e.pts.forEach((q) => {
        g(0, "VERTEX");
        g(8, e.layer);
        g(10, n(q[0]));
        g(20, n(q[1]));
        g(30, "0.0");
        if (q[2]) g(42, q[2].toFixed(6));
      });
      g(0, "SEQEND");
      g(8, e.layer);
    } else {
      g(0, "TEXT");
      g(8, e.layer);
      g(10, n(e.x));
      g(20, n(e.y));
      g(30, "0.0");
      g(40, n(e.h));
      g(1, ascii(e.s));
      if (e.center) {
        g(72, 1);
        g(73, 2);
        g(11, n(e.x));
        g(21, n(e.y));
        g(31, "0.0");
      } else if (e.right) {
        g(72, 2);
        g(11, n(e.x));
        g(21, n(e.y));
        g(31, "0.0");
      }
    }
  });
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}
