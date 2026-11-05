import type { StringerPiece } from "./stair-types";
import { bbox, dedupe, type Box, type Pt, type Vertex } from "./vec";

/** Contour du limon dans son plan (u le long du limon, z en hauteur), coupé au sol, tenons compris. */
export function stringerOutline(
  sp: Pick<StringerPiece, "prof"> & Partial<Pick<StringerPiece, "tenons">>,
  hl: number,
): Pt[] {
  const top = sp.prof,
    bot: Pt[] = [];
  for (let i = 0; i < top.length; i++) {
    const [u, z] = top[i]!,
      r = z - hl;
    if (i > 0) {
      const [u0, z0] = top[i - 1]!,
        r0 = z0 - hl;
      if (r0 < 0 !== r < 0) {
        const t = r0 / (r0 - r);
        bot.push([u0 + (u - u0) * t, 0]);
      }
    }
    bot.push([u, Math.max(0, r)]);
  }
  // Un tenon sort du bout haut (u croissant), l'autre du bout bas du limon.
  const uEnd = top[top.length - 1]![0],
    ts = sp.tenons ?? [];
  const hi = ts.find((t) => t.u0 >= uEnd - 1e-6),
    lo = ts.find((t) => t !== hi);
  return dedupe([
    ...top,
    ...(hi
      ? ([
          [hi.u0, hi.z1],
          [hi.u1, hi.z1],
          [hi.u1, hi.z0],
          [hi.u0, hi.z0],
        ] as Pt[])
      : []),
    ...bot.reverse(),
    ...(lo
      ? ([
          [lo.u1, lo.z0],
          [lo.u0, lo.z0],
          [lo.u0, lo.z1],
          [lo.u1, lo.z1],
        ] as Pt[])
      : []),
  ]);
}

/** Limon couché dans le sens de la planche : vu depuis la face côté marches (le limon de jour se lit à l'envers
    du sens de montée), tourné au plus petit rectangle de débit, haut en haut, coin bas gauche à l'origine. */
export interface BoardLay {
  /** Point du plan du limon (u, z) vers la planche, bulge retourné avec la pièce. */
  tr: (q: Vertex) => Vertex;
  L: number;
  H: number;
  flip: boolean;
}

export function layBoard(sp: StringerPiece, left: boolean): BoardLay {
  const flip = (sp.side === "in") !== left;
  const fl = (q: Vertex): Pt => [flip ? -q[0] : q[0], q[1]];
  const flat = stringerOutline(sp, sp.hl).map(fl);
  let best: { area: number; th: number; r: Box; c: number; s: number } | null = null;
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i]!,
      b = flat[(i + 1) % flat.length]!;
    let th = Math.atan2(b[1] - a[1], b[0] - a[0]);
    while (th > Math.PI / 2) th -= Math.PI;
    while (th <= -Math.PI / 2) th += Math.PI;
    const c = Math.cos(-th),
      s = Math.sin(-th);
    const r = bbox(flat.map((q): Pt => [q[0] * c - q[1] * s, q[0] * s + q[1] * c]));
    const area = (r.x1 - r.x0) * (r.y1 - r.y0);
    if (!best || area < best.area - 1 || (Math.abs(area - best.area) <= 1 && Math.abs(th) < Math.abs(best.th)))
      best = { area, th, r, c, s };
  }
  const B = best!;
  // Le retournement inverse le sens des arcs.
  const tr = (q: Vertex): Vertex => {
    const f = fl(q),
      t: Pt = [f[0] * B.c - f[1] * B.s - B.r.x0, f[0] * B.s + f[1] * B.c - B.r.y0];
    return q.length > 2 ? [...t, flip ? -q[2]! : q[2]!] : t;
  };
  return { tr, L: B.r.x1 - B.r.x0, H: B.r.y1 - B.r.y0, flip };
}
