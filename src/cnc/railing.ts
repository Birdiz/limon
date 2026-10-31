/* Export du garde-corps : mains courantes vues de côté avec leur dessous déroulé, balustres ou montants
   et lisses vus de côté, couchés dans le sens du fil. Tenons et mortaises centrés : le côté de la vue importe peu. */
import { fmt } from "../core/format";
import { GC, type Handrail, type Post, type Rail, type Railing } from "../core/railing";
import type { Params } from "../core/params";
import { bbox, type Pt } from "../core/vec";
import type { Entity } from "./entities";

export interface RailPart {
  j: number;
  L: number;
  l: number;
}

export interface RailingCNC {
  ents: Entity[];
  handrailParts: (RailPart & { name: string })[];
  postParts: RailPart[];
  railParts: RailPart[];
}

/** Tenon carré en bout des balustres et montants : la moitié de leur section. */
export const postTenon = (p: Params): number => Math.round(p.bs / 2);

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Contour d'une main courante dans son plan (u, z) : dessus, bouts d'aplomb ou d'onglet, tenon dans le poteau. */
export function handrailOutline(hr: Handrail): Pt[] {
  const top = (u: number) => hr.z0 + hr.b * u,
    c0 = hr.cut0 ?? 0,
    c1 = hr.cut1 ?? 0;
  const tl: Pt = [hr.u0, top(hr.u0)],
    tr: Pt = [hr.u1, top(hr.u1)],
    br: Pt = [hr.u1 + c1, top(hr.u1 + c1) - hr.hv],
    bl: Pt = [hr.u0 + c0, top(hr.u0 + c0) - hr.hv];
  const hi = hr.tenons.find((t) => t.u0 >= hr.u1 - 1e-6),
    lo = hr.tenons.find((t) => t !== hi);
  return [
    tl,
    tr,
    ...(hi
      ? ([
          [hi.u0, hi.z1],
          [hi.u1, hi.z1],
          [hi.u1, hi.z0],
          [hi.u0, hi.z0],
        ] as Pt[])
      : []),
    br,
    bl,
    ...(lo
      ? ([
          [lo.u1, lo.z0],
          [lo.u0, lo.z0],
          [lo.u0, lo.z1],
          [lo.u1, lo.z1],
        ] as Pt[])
      : []),
  ];
}

/** Contour d'un balustre ou montant dans le plan du garde-corps (u, z) : coupes biais, tenons en bout. */
export function postOutline(q: Post, p: Params): Pt[] {
  const w = p.bs / 2,
    t = postTenon(p) / 2,
    L = GC.tenon;
  const zb = (u: number) => q.zb + q.ab * (u - q.u),
    zt = (u: number) => q.zt + q.at * (u - q.u);
  const bottom: Pt[] = q.tenonBas
    ? [
        [q.u - w, zb(q.u - w)],
        [q.u - t, zb(q.u - t)],
        [q.u - t, q.zb - L],
        [q.u + t, q.zb - L],
        [q.u + t, zb(q.u + t)],
        [q.u + w, zb(q.u + w)],
      ]
    : [
        [q.u - w, zb(q.u - w)],
        [q.u + w, zb(q.u + w)],
      ];
  return [
    ...bottom,
    [q.u + w, zt(q.u + w)],
    [q.u + t, zt(q.u + t)],
    [q.u + t, q.zt + L],
    [q.u - t, q.zt + L],
    [q.u - t, zt(q.u - t)],
    [q.u - w, zt(q.u - w)],
  ];
}

export function railOutline(r: Rail): Pt[] {
  const top = (u: number) => r.z0 + r.b * u;
  return [
    [r.uA, top(r.uA)],
    [r.uB, top(r.uB)],
    [r.uB, top(r.uB) - r.hv],
    [r.uA, top(r.uA) - r.hv],
  ];
}

/** Rotation d'angle -th autour de l'origine, puis translation au coin bas gauche, décalé de y. */
function lay(pts: readonly Pt[], th: number, y: number, ref: readonly Pt[] = pts) {
  const c = Math.cos(-th),
    s = Math.sin(-th);
  const rot = (q: Pt): Pt => [q[0] * c - q[1] * s, q[0] * s + q[1] * c];
  const b = bbox(ref.map(rot));
  return { tr: (q: Pt): Pt => [rot(q)[0] - b.x0, rot(q)[1] - b.y0 + y], L: b.x1 - b.x0, H: b.y1 - b.y0 };
}

export function buildRailing(G: Railing, p: Params): RailingCNC {
  const ents: Entity[] = [];
  const text = (x: number, y: number, h: number, s: string, right = false) =>
    ents.push({ kind: "text", layer: "TEXTE", x, y, h, s, ...(right ? { right } : {}) });
  const tb = postTenon(p),
    jeu = Math.max(0, p.jeu),
    what = G.type === "balustres" ? "BALUSTRE" : "MONTANT";
  let y = 0;

  // Mains courantes : vue de côté, puis le dessous déroulé avec les mortaises des balustres.
  const handrailParts: RailingCNC["handrailParts"] = [];
  // Le retour horizontal au-dessus de la marche palière porte son propre nom.
  const ramp = G.handrails.filter((hr) => !hr.retour).length;
  let k = 0;
  G.handrails.forEach((hr) => {
    const out = handrailOutline(hr),
      th = Math.atan(hr.b),
      sec = Math.hypot(1, hr.b);
    const side = lay(out, th, y);
    ents.push({ kind: "poly", layer: "DECOUPE", pts: out.map(side.tr), closed: true });
    hr.tenons.forEach((t) =>
      ents.push({ kind: "poly", layer: "TENON", pts: rect(t.u0, t.z0, t.u1, t.z1).map(side.tr), closed: true }),
    );
    const name = hr.retour ? "RETOUR DE MAIN COURANTE" : `MAIN COURANTE${ramp > 1 ? ` ${++k}/${ramp}` : ""}`;
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
    handrailParts.push({
      name: name.charAt(0) + name.slice(1).toLowerCase(),
      j: handrailParts.length + 1,
      L: side.L,
      l: p.mcH,
    });
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
  const postParts: RailPart[] = [];
  text(0, y, 40, `${what}S ${p.bs} x ${p.bs} - vus de cote, pied a gauche, tenons ${tb} x ${tb} x ${GC.tenon} mm`);
  y += 90;
  G.posts.forEach((q, i) => {
    const out = postOutline(q, p);
    const b = bbox(out);
    const tr = (v: Pt): Pt => [v[1] - b.y0, y + (b.x1 - v[0])];
    ents.push({ kind: "poly", layer: "DECOUPE", pts: out.map(tr), closed: true });
    text(-20, y + p.bs / 2 - 10, 24, `${what.charAt(0)}${i + 1}`, true);
    postParts.push({ j: i + 1, L: b.y1 - b.y0, l: p.bs });
    y += p.bs + 40;
  });

  // Lisses, couchées dans le sens de la pente, bouts d'aplomb.
  const railParts: RailPart[] = [];
  if (G.rails.length) {
    y += 140;
    text(0, y, 40, `LISSES ${p.bs} x ${p.bs} - vues de cote, bout bas a gauche, bouts d'aplomb, fixees aux montants`);
    y += 90;
    G.rails.forEach((r, i) => {
      const out = railOutline(r),
        s = lay(out, Math.atan(r.b), y);
      ents.push({ kind: "poly", layer: "DECOUPE", pts: out.map(s.tr), closed: true });
      text(-20, y + s.H / 2 - 10, 24, `L${i + 1}`, true);
      railParts.push({ j: i + 1, L: s.L, l: p.bs });
      y += s.H + 40;
    });
  }
  return { ents, handrailParts, postParts, railParts };
}
