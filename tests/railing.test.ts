import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { postOutline } from "../src/cnc/railing";
import { DEFAULTS, type Params } from "../src/core/params";
import { GC, type Railing } from "../src/core/railing";
import { compute, type Stair } from "../src/core/stair";
import { bbox, interp } from "../src/core/vec";
import { stairOf } from "./cases";

/** Hauteur de la main courante au-dessus de chaque nez de la ligne de jour qu'elle couvre. */
function heights(R: Stair): number[] {
  const G = R.rail!;
  return G.handrails.flatMap((hr) => {
    const s0 = R.inner.cum[hr.idx]!;
    return R.lines
      .filter((l) => l.sIn - s0 >= hr.u0 - 1e-6 && l.sIn - s0 <= hr.u1 + 1e-6)
      .map((l) => hr.z0 + hr.b * (l.sIn - s0) - (l.k + 1) * R.h);
  });
}

/** Écarts libres entre balustres voisins d'un même tronçon, et entre le dernier et le poteau. */
function gaps(R: Stair, G: Railing): number[] {
  const p = R.params;
  return G.handrails.flatMap((hr) => {
    const us = G.posts.filter((q) => q.idx === hr.idx).map((q) => q.u);
    const out = us.slice(1).map((u, i) => u - us[i]! - p.bs);
    if (hr.tenon) out.push(hr.idx === 0 ? hr.u1 - us[us.length - 1]! - p.bs / 2 : us[0]! - p.bs / 2 - hr.u0);
    return out;
  });
}

describe("garde-corps côté jour", () => {
  it("n'existe pas par défaut et ne change pas l'export", () => {
    const R = stairOf({ forme: "quart-d" });
    expect(R.rail).toBeNull();
    expect(buildCNC(R).rail).toBeNull();
  });

  it.each(["droit", "quart-d", "quart-g"] as const)(
    "tient la main courante à 900 mm au moins au-dessus des nez (%s)",
    (forme) => {
      const R = stairOf({ forme, gc: "balustres" });
      const hs = heights(R);
      expect(Math.min(...hs)).toBeGreaterThan(GC.h - 0.5);
      expect(Math.min(...hs)).toBeLessThan(GC.h + 0.5);
      expect(Math.max(...hs)).toBeLessThan(GC.h + 120);
      expect(R.rail!.hMin).toBeCloseTo(Math.min(...hs), 0);
    },
  );

  it("espace les balustres de 110 mm libres au plus, poteau compris", () => {
    for (const forme of ["droit", "quart-d"] as const) {
      const R = stairOf({ forme, gc: "balustres" });
      const gs = gaps(R, R.rail!);
      expect(Math.max(...gs)).toBeLessThanOrEqual(GC.ecart);
      expect(Math.min(...gs)).toBeGreaterThan(GC.ecart - 20);
      expect(R.rail!.gap).toBeCloseTo(Math.max(...gs), 6);
    }
  });

  it("pose les balustres dans le chant du limon, tenons en bout", () => {
    const R = stairOf({ forme: "droit", gc: "balustres" }),
      sp = R.stringers.find((s) => s.side === "in")!;
    const top = (u: number) =>
      interp(
        sp.prof.map((q) => q[0]),
        sp.prof.map((q) => q[1]),
        u,
      );
    for (const q of R.rail!.posts) {
      expect(q.zb).toBeCloseTo(top(q.u), 6);
      expect(q.tenonBas).toBe(true);
      const b = bbox(postOutline(q, R.params));
      expect(b.y0).toBeCloseTo(q.zb - GC.tenon, 6);
      expect(b.y1).toBeCloseTo(q.zt + GC.tenon, 6);
    }
    // Un escalier droit a des balustres tous pareils : une seule ligne de débit.
    const lengths = new Set(buildCNC(R).rail!.postParts.map((q) => Math.ceil(q.L)));
    expect(lengths.size).toBe(1);
  });

  it("perce le limon pour les balustres posés à l'anglaise, hors des logements", () => {
    const R = stairOf({ forme: "droit", gc: "balustres", gcPose: "anglaise" }),
      sp = R.stringers.find((s) => s.side === "in")!;
    expect(R.rail!.off).toBe(R.params.el + R.params.bs / 2);
    for (const q of R.rail!.posts) {
      expect(q.tenonBas).toBe(false);
      expect(q.holes.length).toBeGreaterThanOrEqual(1);
      for (const [u, z] of q.holes)
        for (const pk of sp.pockets) {
          const b = bbox(pk),
            r = GC.vis / 2;
          expect(u + r < b.x0 || u - r > b.x1 || z + r < b.y0 || z - r > b.y1).toBe(true);
        }
    }
  });

  it("assemble la main courante dans le poteau, qui monte la recevoir", () => {
    const R = stairOf({ forme: "quart-d", gc: "balustres" }),
      N = R.newel!;
    const sans = stairOf({ forme: "quart-d" }).newel!;
    expect(N.h).toBeGreaterThan(sans.h);
    for (const hr of R.rail!.handrails) {
      const t = hr.tenon!;
      expect(t.u1 - t.u0).toBe(GC.tenonMC);
      expect(t.z1).toBeGreaterThan(t.z0);
      const face = N.faces.find((f) => f.mortises.some((m) => m.of === "main courante" && m.idx === hr.idx))!;
      const [lim, mc] = [
        face.mortises.find((m) => m.of === "limon")!,
        face.mortises.find((m) => m.of === "main courante")!,
      ];
      // Mortaise de main courante au-dessus de celle du limon, sous la tête du poteau.
      expect(bbox(mc.pts).y0).toBeGreaterThan(bbox(lim.pts).y1);
      expect(N.h).toBeGreaterThanOrEqual(bbox(mc.pts).y1 + GC.tete - 1);
      expect(mc.depth).toBeCloseTo(t.u1 - t.u0 + GC.fond, 6);
    }
  });

  it("répartit les lisses à 110 mm libres au plus entre montants", () => {
    const R = stairOf({ forme: "droit", gc: "lisses" }),
      G = R.rail!;
    expect(G.type).toBe("lisses");
    expect(G.gap).toBeLessThanOrEqual(GC.ecart);
    expect(G.railLow).toBeGreaterThan(0);
    const us = G.posts.map((q) => q.u);
    for (let i = 1; i < us.length; i++) expect(us[i]! - us[i - 1]!).toBeLessThanOrEqual(GC.pas + 1e-6);
    // Chaque travée entre deux montants porte le même nombre de lisses.
    expect(G.rails.length % (us.length - 1)).toBe(0);
  });

  it("annonce le garde-corps dans les notes", () => {
    const R = stairOf({ forme: "quart-d", gc: "balustres" });
    expect(R.notes.some(([s, t]) => s === "info" && t.startsWith("Garde-corps : main courante de 900"))).toBe(true);
  });

  it("refuse des balustres plus épais que le limon dans le chant, et une main courante plus large que le poteau", () => {
    const err = (over: Partial<Params>) => {
      const r = compute({ ...DEFAULTS, ...over });
      return r.ok ? [] : r.errors.map((e) => e.key);
    };
    expect(err({ gc: "balustres", bs: 50 })).toEqual(["bs"]);
    expect(err({ forme: "droit", gc: "balustres", bs: 50, gcPose: "anglaise" })).toEqual([]);
    expect(err({ gc: "balustres", mcL: 160 })).toEqual(["mcL"]);
    expect(err({ gc: "aucun", bs: 50 })).toEqual([]);
  });

  it("compte le garde-corps dans le débit et le volume", () => {
    const R = stairOf({ forme: "droit", gc: "balustres" }),
      cnc = buildCNC(R);
    expect(cnc.rail!.handrailParts).toHaveLength(1);
    expect(cnc.rail!.postParts).toHaveLength(R.rail!.posts.length);
  });
});
