import type { StringerPiece } from "./stair";
import { dedupe, type Pt } from "./vec";

/** Contour du limon dans son plan (u le long du limon, z en hauteur), coupé au sol. */
export function stringerOutline(sp: StringerPiece, hl: number): Pt[] {
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
  return dedupe([...top, ...bot.reverse()]);
}
