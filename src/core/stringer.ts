import type { StringerPiece } from "./stair";
import { dedupe, type Pt } from "./vec";

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
