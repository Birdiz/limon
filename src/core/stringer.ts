import type { StringerPiece } from "./stair";
import { dedupe, type Pt } from "./vec";

/** Contour du limon dans son plan (u le long du limon, z en hauteur), coupé au sol, tenon compris. */
export function stringerOutline(
  sp: Pick<StringerPiece, "prof"> & Partial<Pick<StringerPiece, "tenon">>,
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
  const t = sp.tenon;
  if (!t) return dedupe([...top, ...bot.reverse()]);
  // Le tenon sort du bout haut (u croissant) ou du bout bas du limon.
  const uEnd = top[top.length - 1]![0];
  if (t.u0 >= uEnd - 1e-6)
    return dedupe([...top, [t.u0, t.z1], [t.u1, t.z1], [t.u1, t.z0], [t.u0, t.z0], ...bot.reverse()]);
  return dedupe([...top, ...bot.reverse(), [t.u1, t.z0], [t.u0, t.z0], [t.u0, t.z1], [t.u1, t.z1]]);
}
