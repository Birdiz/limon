/* Export du garde-corps : mains courantes vues de côté avec leur dessous déroulé, balustres ou montants
   et lisses vus de côté, couchés dans le sens du fil. Tenons et mortaises centrés : le côté de la vue importe peu. */
import { fmt } from "../core/format";
import { GC, handrailOutline, postOutline, postTenon, railOutline } from "../core/railing";
import type { Params } from "../core/params";
import { handrailNames, lay, railPieces, type RailPieces } from "../core/pieces";
import type { Handrail, Railing } from "../core/stair-types";
import { bbox, type Pt } from "../core/vec";
import type { Entity } from "./entities";

/** Pièces du garde-corps et leur pose dans garde-corps.dxf. */
export interface RailingCNC extends RailPieces {
  ents: Entity[];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Pose du garde-corps. parts : ses pièces, recalculées si on ne les donne pas. */
export function buildRailing(G: Railing, p: Params, parts: RailPieces = railPieces(G, p)): RailingCNC {
  const ents: Entity[] = [];
  const text = (x: number, y: number, h: number, s: string, right = false) =>
    ents.push({ kind: "text", layer: "TEXTE", x, y, h, s, ...(right ? { right } : {}) });
  const tb = postTenon(p),
    jeu = Math.max(0, p.jeu),
    what = G.type === "balustres" ? "BALUSTRE" : "MONTANT";
  let y = 0;

  // Mains courantes : vue de côté, puis le dessous déroulé avec les mortaises des balustres.
  const names = handrailNames(G);
  G.handrails.forEach((hr, i) => {
    const out = handrailOutline(hr),
      th = Math.atan(hr.b),
      sec = Math.hypot(1, hr.b);
    const side = lay(out, th, y);
    ents.push({ kind: "poly", layer: "DECOUPE", pts: out.map(side.tr), closed: true });
    hr.tenons.forEach((t) =>
      ents.push({ kind: "poly", layer: "TENON", pts: rect(t.u0, t.z0, t.u1, t.z1).map(side.tr), closed: true }),
    );
    const name = names[i]!;
    const miter = (c: number | undefined) => (c ? "d'onglet" : "d'aplomb");
    const ends =
      miter(hr.cut0) === miter(hr.cut1)
        ? `bouts ${miter(hr.cut0)}`
        : `bout bas ${miter(hr.cut0)}, bout haut ${miter(hr.cut1)}`;
    text(
      0,
      y + side.H + 30,
      40,
      hr.retour
        ? `${name} - vue de cote - ${Math.ceil(side.L)} x ${p.mcH} x ${p.mcL} - horizontal au-dessus de la marche paliere, ${ends}`
        : `${name} - vue de cote - ${Math.ceil(side.L)} x ${p.mcH} x ${p.mcL} - pente ${fmt((th * 180) / Math.PI, 1)} deg, ${ends}`,
    );
    const dims = (t: Handrail["tenons"][number]) =>
      `${fmt(t.u1 - t.u0, 1)} x ${fmt(t.z1 - t.z0, 1)} ep. ${fmt(t.t1 - t.t0, 1)}`;
    const [t0, t1] = hr.tenons;
    if (t0)
      text(
        0,
        y + side.H + 85,
        30,
        t1
          ? `tenons ${dims(t0)} en bas et ${dims(t1)} en haut, centres sur la largeur`
          : `tenon ${dims(t0)}, centre sur la largeur`,
      );
    y += side.H + 180;
    // Dessous déroulé : longueur prise sur la pente, depuis le bout bas ; face côté marches en bas.
    const b0 = hr.u0 + (hr.cut0 ?? 0),
      b1 = hr.u1 + (hr.cut1 ?? 0);
    const len = (b1 - b0) * sec;
    ents.push({ kind: "poly", layer: "DECOUPE", pts: rect(0, y, len, y + p.mcL), closed: true });
    const mid = y + p.mcL / 2;
    G.posts
      .filter((q) => q.idx === hr.idx && q.u > b0 && q.u < b1)
      .forEach((q) => {
        const x = (q.u - b0) * sec,
          a = (tb * sec) / 2 + jeu,
          b = tb / 2 + jeu;
        ents.push({ kind: "poly", layer: "MORTAISE", pts: rect(x - a, mid - b, x + a, mid + b), closed: true });
      });
    text(
      0,
      y + p.mcL + 30,
      30,
      `${name} - DESSOUS deroule, bout bas a gauche - mortaises d'aplomb ${tb} x ${tb} profondeur ${GC.tenon + GC.fond} mm, jeu ${fmt(p.jeu, 1)} mm`,
    );
    y += p.mcL + 180;
  });

  // Balustres ou montants, couchés pied à gauche, dans l'ordre de la montée.
  text(0, y, 40, `${what}S ${p.bs} x ${p.bs} - vus de cote, pied a gauche, tenons ${tb} x ${tb} x ${GC.tenon} mm`);
  y += 90;
  G.posts.forEach((q, i) => {
    const out = postOutline(q, p);
    const b = bbox(out);
    const tr = (v: Pt): Pt => [v[1] - b.y0, y + (b.x1 - v[0])];
    ents.push({ kind: "poly", layer: "DECOUPE", pts: out.map(tr), closed: true });
    text(-20, y + p.bs / 2 - 10, 24, `${what.charAt(0)}${i + 1}`, true);
    y += p.bs + 40;
  });

  // Lisses, couchées dans le sens de la pente, bouts d'aplomb.
  if (G.rails.length) {
    y += 140;
    text(0, y, 40, `LISSES ${p.bs} x ${p.bs} - vues de cote, bout bas a gauche, bouts d'aplomb, fixees aux montants`);
    y += 90;
    G.rails.forEach((r, i) => {
      const out = railOutline(r),
        s = lay(out, Math.atan(r.b), y);
      ents.push({ kind: "poly", layer: "DECOUPE", pts: out.map(s.tr), closed: true });
      text(-20, y + s.H / 2 - 10, 24, `L${i + 1}`, true);
      y += s.H + 40;
    });
  }
  return { ...parts, ents };
}
