/* Plans d'atelier des limons pour la fiche : chaque limon couché comme dans limons.dxf (vu côté marches,
   dans le sens de la planche), avec ses cotes. Coordonnées de planche en mm, x le long du plateau depuis
   son bout gauche, y depuis sa rive basse. */
import { layBoard } from "../cnc/build";
import { fmt } from "../core/format";
import { isLeft } from "../core/params";
import { GC } from "../core/railing";
import { PERCAGE, type Stair, type StringerPiece } from "../core/stair";
import { stringerOutline } from "../core/stringer";
import { V, bulgePts, type Pt } from "../core/vec";
import { textWidth, type Page, type RGB } from "./pdf";

export interface LimonColors {
  ink: RGB;
  muted: RGB;
  rule: RGB;
  chalk: RGB;
  chalkSoft: RGB;
  white: RGB;
}

/** Échelles proposées, de la plus grande à la plus petite (1:n). */
const SCALES = [10, 15, 20, 25, 30, 40, 50];

/** Points par millimètre. */
const PT_MM = 72 / 25.4;

/** Un limon couché sur sa planche, prêt à dessiner et à coter. */
export interface Board {
  name: string;
  L: number;
  H: number;
  outline: Pt[];
  pockets: Pt[][];
  /** Nez de chaque logement de marche (coin haut avant du logement), avec le numéro de la marche ;
      cut quand le bout du limon coupe le logement : le nez est ailleurs, pas dans la chaîne. */
  noses: { at: Pt; label: string; cut: boolean }[];
  /** Coupes d'about : segment, nature (d'aplomb ou au sol), et le tenon qui en sort. */
  cuts: { a: Pt; b: Pt; kind: "aplomb" | "sol"; tenon?: string }[];
  tenons: Pt[][];
  /** Perçages : about du limon de mur suivant, ou fixation des balustres posés à l'anglaise. */
  holes: { at: Pt; r: number }[];
  /** Remarques sous le dessin. */
  notes: string[];
  /** L'autre limon de l'escalier droit en est le miroir : un seul dessin pour les deux. */
  mirror?: string;
}

export function layBoards(R: Stair, names: readonly string[]): Board[] {
  const left = isLeft(R.params.forme),
    G = R.rail;
  const boards = R.stringers.map((sp, i): Board => {
    const lay = layBoard(sp, left),
      P = (q: readonly [number, number]): Pt => {
        const t = lay.tr([q[0], q[1]]);
        return [t[0], t[1]];
      };
    const uLo = sp.prof[0]![0];
    const noses: Board["noses"] = [];
    sp.pockets.forEach((pk, k) => {
      const of = sp.pocketOf[k]!;
      if (of.k === "contremarche") return;
      const u0 = Math.min(...pk.map((q) => q[0])),
        hi = Math.max(...pk.map((q) => q[1]));
      // Logement coupé par le bout du limon (première marche, palier qui tourne) : son nez n'est pas sur la pièce.
      noses.push({ at: P([u0, hi]), label: of.k === "palière" ? "MP" : String(of.j), cut: u0 < uLo + 1 });
    });
    noses.sort((a, b) => a.at[0] - b.at[0]);
    const posts = G && sp.side === "in" ? G.posts.filter((q) => q.idx === sp.idx) : [];
    const vis = posts.flatMap((q) => q.holes);
    const holes = sp.holes.map(P);
    const notes = [
      ...(holes.length
        ? [
            `${holes.length} perçages Ø ${PERCAGE} traversants pour l'about du limon suivant : ${holes.map((h) => `x ${fmt(h[0])}, y ${fmt(h[1])}`).join(" ; ")}.`,
          ]
        : []),
      ...(vis.length ? [`${vis.length} perçages Ø ${GC.vis} pour visser les balustres posés à l'anglaise.`] : []),
      ...(posts.length && G!.pose === "chant"
        ? [
            `${posts.length} mortaise${posts.length > 1 ? "s" : ""} de balustre${posts.length > 1 ? "s" : ""} dans le chant haut.`,
          ]
        : []),
    ];
    // Chaque tenon sort de la coupe d'aplomb de son bout, sur l'épaulement.
    const cuts = aboutCuts(sp).map((c): Board["cuts"][number] => {
      const t = sp.tenons.find((q) => c.kind === "aplomb" && (q.u0 === c.a[0] || q.u1 === c.a[0]));
      return {
        a: P(c.a),
        b: P(c.b),
        kind: c.kind,
        ...(t ? { tenon: `tenon ${fmt(t.u1 - t.u0)} × ${fmt(t.z1 - t.z0)}, ép. ${fmt(t.t1 - t.t0)}` } : {}),
      };
    });
    return {
      name: names[i]!,
      L: lay.L,
      H: lay.H,
      outline: stringerOutline(sp, sp.hl).map(P),
      pockets: sp.pockets.map((pk) => bulgePts(pk.map(lay.tr)).map((q): Pt => [q[0], q[1]])),
      noses,
      cuts,
      tenons: sp.tenons.map((t) =>
        (
          [
            [t.u0, t.z0],
            [t.u1, t.z0],
            [t.u1, t.z1],
            [t.u0, t.z1],
          ] as Pt[]
        ).map(P),
      ),
      holes: [...holes.map((at) => ({ at, r: PERCAGE / 2 })), ...vis.map((q) => ({ at: P(q), r: GC.vis / 2 }))],
      notes,
    };
  });
  // Escalier droit : les deux limons sont souvent la même pièce retournée.
  if (!R.quart && boards.length === 2 && mirrored(boards[0]!, boards[1]!))
    return [{ ...boards[0]!, mirror: boards[1]!.name.toLowerCase() }];
  return boards;
}

/** b est-il a retourné bout pour bout (contour, logements, perçages, à 0,1 mm près) ? */
function mirrored(a: Board, b: Board): boolean {
  if (Math.abs(a.L - b.L) > 0.1 || Math.abs(a.H - b.H) > 0.1) return false;
  const pts = (x: Board, flip: boolean): Pt[] =>
    [...x.outline, ...x.pockets.flat(), ...x.holes.map((h) => h.at)].map((q) => [flip ? x.L - q[0] : q[0], q[1]]);
  const pa = pts(a, false),
    pb = pts(b, true);
  return pa.length === pb.length && pa.every((q) => pb.some((r) => V.len(V.sub(q, r)) < 0.1));
}

/** Coupes d'about dans le plan du limon : d'aplomb à chaque bout (épaulements des tenons compris), au sol. */
function aboutCuts(sp: StringerPiece): { a: Pt; b: Pt; kind: "aplomb" | "sol" }[] {
  const pr = sp.prof,
    out: { a: Pt; b: Pt; kind: "aplomb" | "sol" }[] = [];
  for (const end of [0, pr.length - 1]) {
    const [u, z] = pr[end]!;
    const zb = Math.max(0, z - sp.hl);
    if (z - zb > 0.5) out.push({ a: [u, zb], b: [u, z], kind: "aplomb" });
  }
  // Coupe au sol : là où le dessous du limon passerait sous le sol, d'un seul trait.
  const floor = stringerOutline(sp, sp.hl)
    .filter((q) => Math.abs(q[1]) < 1e-6)
    .map((q) => q[0]);
  if (floor.length > 1 && Math.max(...floor) - Math.min(...floor) > 0.5)
    out.push({ a: [Math.min(...floor), 0], b: [Math.max(...floor), 0], kind: "sol" });
  return out;
}

/** Plus grande échelle ronde à laquelle le plus long limon tient dans la largeur w (points). */
export function boardScale(boards: readonly Board[], w: number): number {
  const L = Math.max(...boards.map((b) => b.L));
  const n = SCALES.find((s) => (L / s) * PT_MM <= w) ?? SCALES[SCALES.length - 1]!;
  return n;
}

/** Hauteur occupée par un limon dessiné au 1:n, cotes et remarques comprises, en points. */
export function boardHeight(b: Board, n: number): number {
  return TITLE + CHAIN + (b.H / n) * PT_MM + (aligned(b) ? 14 : 24) + 8 + b.notes.length * NOTE;
}

const TITLE = 14,
  CHAIN = 26,
  NOTE = 10,
  FS = 6.5;

/** Nez de la chaîne à la même hauteur (volée droite) : une seule cote de hauteur. */
const aligned = (b: Board) => {
  const ys = b.noses.filter((q) => !q.cut).map((q) => q.at[1]);
  return ys.length > 1 && Math.max(...ys) - Math.min(...ys) < 0.5;
};

/** Dessine le limon b au 1:n, bord gauche en x, haut du bloc en y. */
export function drawBoard(pg: Page, b: Board, n: number, x: number, y: number, el: number, C: LimonColors): void {
  const k = PT_MM / n;
  const top = y + TITLE + CHAIN,
    yb = top + b.H * k,
    xr = x + b.L * k;
  const P = (q: Pt): Pt => [x + q[0] * k, top + (b.H - q[1]) * k];
  const thin = { stroke: C.muted, width: 0.35 };

  const dims = `${fmt(Math.ceil(b.L))} × ${fmt(Math.ceil(b.H))} × ${fmt(el)}`;
  pg.text(x, y + 9, b.name, { size: 9.5, bold: true, color: C.ink });
  pg.text(
    x + textWidth(b.name, 9.5, true) + 8,
    y + 9,
    b.mirror ? `${dims} · × 2 : le ${b.mirror} est le même, retourné` : dims,
    { size: 9, color: C.muted },
  );

  // Plateau débité (rectangle), pièce, logements, tenons, perçages.
  pg.rect(x, top, b.L * k, b.H * k, { stroke: C.rule, width: 0.4, dash: [2, 2] });
  pg.path(b.outline.map(P), { fill: C.white, stroke: C.ink, width: 0.7 }, true);
  for (const pk of b.pockets) pg.path(pk.map(P), { fill: C.chalkSoft, stroke: C.chalk, width: 0.4 }, true);
  for (const t of b.tenons) pg.path(t.map(P), { stroke: C.ink, width: 0.4, dash: [1.5, 1.5] }, true);
  for (const h of b.holes) pg.circle(...P(h.at), Math.max(0.8, h.r * k), { stroke: C.ink, width: 0.4 });

  // Chaîne des nez, au-dessus du limon : du bout gauche du plateau à chaque nez, jusqu'au bout droit.
  const chain = b.noses.filter((q) => !q.cut);
  const yc = top - 12;
  const xs = [0, ...chain.map((q) => q.at[0]), b.L];
  pg.path(
    [
      [x, yc],
      [xr, yc],
    ],
    thin,
  );
  for (const no of b.noses) {
    const [px, py] = P(no.at);
    if (!no.cut) {
      pg.path(
        [
          [px, py],
          [px, yc - 2],
        ],
        { stroke: C.chalk, width: 0.3 },
      );
      pg.circle(px, py, 0.9, { fill: C.chalk });
    }
    // Numéro de la marche, juste sous son nez.
    pg.text(px + 1.5, py + 6.5, no.label, { size: 5.5, bold: true, color: C.chalk });
  }
  xs.forEach((v) => tick(pg, x + v * k, yc, C.muted));
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    if (d < 0.5) continue;
    const s = fmt(d),
      mid = x + ((xs[i]! + xs[i - 1]!) / 2) * k;
    if (textWidth(s, FS) + 3 < d * k) pg.text(mid, yc - 2.5, s, { size: FS, color: C.ink, anchor: "middle" });
    else pg.text(mid + FS * 0.35, yc - 2.5, s, { size: FS, color: C.ink, rot: -90 });
  }
  pg.text(x - 4, yc + 2, "nez", { size: FS, color: C.chalk, anchor: "end" });

  // Hauteur des nez au-dessus de la rive basse du plateau. Alignés : un trait des nez, coté une fois au bout gauche.
  const flat = aligned(b);
  if (flat) {
    const yn = P(chain[0]!.at)[1];
    pg.path(
      [
        [x, yn],
        [xr, yn],
      ],
      { stroke: C.chalk, width: 0.3, dash: [3, 1.5] },
    );
    pg.text(x - 4, yn + 2.3, fmt(chain[0]!.at[1]), { size: FS, color: C.chalk, anchor: "end" });
  } else if (chain.length) {
    chain.forEach((no) => {
      const [px] = P(no.at);
      pg.text(px + FS * 0.35, yb + 4, fmt(no.at[1]), { size: FS, color: C.chalk, rot: -90, anchor: "end" });
    });
    pg.text(x - 4, yb + 9, "hauteur", { size: FS, color: C.chalk, anchor: "end" });
  }

  // Coupes d'about : longueur et angle avec la rive du plateau, tenon dessous ; à gauche ou à droite de la pièce,
  // décalées pour ne chevaucher ni leur voisine ni la cote du trait des nez.
  const labels = b.cuts.map((c) => {
    const d = V.sub(c.b, c.a);
    const ang = (Math.atan2(Math.abs(d[1]), Math.abs(d[0])) * 180) / Math.PI;
    const m = P(V.mul(V.add(c.a, c.b), 0.5));
    const right = m[0] > (x + xr) / 2;
    const lines = [`${c.kind === "aplomb" ? "coupe d'aplomb" : "coupe au sol"} ${fmt(V.len(d))} · ${fmt(ang, 1)}°`];
    if (c.tenon) lines.push(c.tenon);
    return { right, x: right ? Math.max(m[0] + 6, xr + 14) : Math.min(m[0] - 6, x - 4), y: m[1], lines };
  });
  for (const right of [false, true]) {
    const fixed = !right && flat ? [P(chain[0]!.at)[1]] : [];
    let prev = -Infinity;
    for (const l of labels.filter((q) => q.right === right).sort((p, q) => p.y - q.y)) {
      const h = l.lines.length * 8;
      let y0 = Math.max(l.y - h / 2, prev + 1);
      for (const f of fixed) if (y0 < f + 5 && y0 + h > f - 5) y0 = f + 5;
      prev = y0 + h;
      l.lines.forEach((s, i) =>
        pg.text(l.x, y0 + 8 * i + 6.3, s, {
          size: FS,
          color: C.ink,
          anchor: right ? "start" : "end",
          halo: { color: C.white, width: 2 },
        }),
      );
    }
  }

  // Longueur et hauteur hors tout, puis remarques.
  const yL = yb + (flat ? 14 : 24);
  hdim(pg, x, xr, yL, fmt(Math.ceil(b.L)), C);
  vdim(pg, xr + 8, yb, top, fmt(Math.ceil(b.H)), C);
  b.notes.forEach((s, i) => pg.text(x, yL + 10 + i * NOTE, s, { size: 7, color: C.muted }));
}

function tick(pg: Page, x: number, y: number, c: RGB): void {
  pg.path(
    [
      [x - 1.8, y + 1.8],
      [x + 1.8, y - 1.8],
    ],
    { stroke: c, width: 0.5 },
  );
}

function hdim(pg: Page, x0: number, x1: number, y: number, s: string, C: LimonColors): void {
  pg.path(
    [
      [x0, y],
      [x1, y],
    ],
    { stroke: C.muted, width: 0.35 },
  );
  tick(pg, x0, y, C.muted);
  tick(pg, x1, y, C.muted);
  pg.text((x0 + x1) / 2, y - 2.5, s, { size: FS + 0.5, bold: true, color: C.ink, anchor: "middle" });
}

function vdim(pg: Page, x: number, y0: number, y1: number, s: string, C: LimonColors): void {
  pg.path(
    [
      [x, y0],
      [x, y1],
    ],
    { stroke: C.muted, width: 0.35 },
  );
  tick(pg, x, y0, C.muted);
  tick(pg, x, y1, C.muted);
  pg.text(x - 2.5, (y0 + y1) / 2, s, { size: FS, color: C.ink, anchor: "middle", rot: -90 });
}
