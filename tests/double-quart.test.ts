import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { toDXF } from "../src/cnc/dxf";
import { DEFAULTS, EXEMPLE_U, changeForme, sanitizeParams } from "../src/core/params";
import { planShapes } from "../src/core/plan-shapes";
import { polyAt } from "../src/core/poly";
import { paramsFromHash, paramsToHash } from "../src/core/share";
import { ECHAPPEE, LIFT, TENON, compute, turnLengths, turnRange, type Stair } from "../src/core/stair";
import { stringerOutline } from "../src/core/stringer";
import { sectionSummaries } from "../src/core/summary";
import { V, bbox } from "../src/core/vec";
import { stairOf } from "./cases";

const U = { ...EXEMPLE_U };
const D = stairOf({ forme: "dq-d", ...U });

/** Distance du point q à la droite (a, b). */
const offLine = (q: [number, number], a: [number, number], b: [number, number]) =>
  Math.abs(V.cross(V.sub(b, a), V.sub(q, a))) / V.len(V.sub(b, a));

describe("double quart tournant : géométrie", () => {
  it("tourne deux fois, en U, avec l'exemple confortable", () => {
    expect(D.tours).toBe(2);
    expect(D.quart).toBe(true);
    expect(D.inner.pts).toEqual([
      [D.W, 0],
      [D.W, D.A - D.W],
      [D.C - D.W, D.A - D.W],
      [D.C - D.W, D.A - D.B],
    ]);
    expect(D.outer.pts).toEqual([
      [0, 0],
      [0, D.A],
      [D.C, D.A],
      [D.C, D.A - D.B],
    ]);
    expect(D.Lw).toBeCloseTo(D.A - D.W + (D.C - 2 * D.W) + (D.B - D.W) + Math.PI * D.f, 6);
    expect(D.notes.filter((n) => n[0] === "warn" || n[0] === "bad")).toEqual([]);
  });

  it("donne des hauteurs égales", () => {
    D.treads.forEach((t) => expect(t.top).toBeCloseTo(t.j * D.h, 9));
    D.risers.forEach((r, i) => {
      expect(r.z0).toBeCloseTo(i * D.h, 9);
      expect(r.z1).toBeCloseTo((i + 1) * D.h - D.params.et, 9);
    });
    expect(D.n * D.h).toBeCloseTo(D.H, 9);
  });

  it("garde le giron sur la ligne de foulée : chaque nez la coupe à g du précédent", () => {
    D.lines.forEach((ln, k) => {
      expect(ln.t).toBeCloseTo(k * D.g, 9);
      expect(V.len(V.sub(ln.P, D.walkAt(ln.t)))).toBeLessThan(1e-6);
      expect(offLine(ln.P, ln.Q, ln.O)).toBeLessThan(1e-6);
    });
    // Ligne de foulée continue, à f du jour sur les parties droites.
    for (let t = 0; t < D.Lw; t += 7) expect(V.len(V.sub(D.walkAt(t + 1), D.walkAt(t)))).toBeCloseTo(1, 3);
  });

  it("enchaîne les nez sans croisement, côté jour comme côté mur", () => {
    D.treads.forEach((t) => {
      expect(t.gIn).toBeGreaterThan(0);
      expect(t.gOut).toBeGreaterThan(0);
    });
    D.lines.forEach((ln) => {
      expect(V.len(V.sub(polyAt(D.inner, ln.sIn), ln.Q))).toBeLessThan(1e-6);
      expect(V.len(V.sub(polyAt(D.outer, ln.sOut), ln.O))).toBeLessThan(1e-6);
    });
    // Chaque marche a pour nez la ligne de la précédente et pour fond la ligne suivante.
    D.treads.forEach((t) => {
      const fr = D.lines[t.j - 1]!;
      expect(V.len(V.sub(t.plan[0]!, fr.Q))).toBeLessThan(1e-6);
      expect(V.len(V.sub(t.plan.at(-1)!, fr.O))).toBeLessThan(1e-6);
    });
  });

  it("balance chaque tournant, avec un creux du giron au jour à chaque angle", () => {
    expect(D.bals).toHaveLength(2);
    expect(D.bal).toBe(D.bals[0]);
    const [z0, z1] = D.bals as [Stair["bals"][number], Stair["bals"][number]];
    expect(z0.b).toBeLessThanOrEqual(z1.a);
    const g = D.treads.map((t) => t.gIn);
    const dip = (a: number, b: number) => g.slice(a, b).indexOf(Math.min(...g.slice(a, b))) + a;
    const k0 = dip(z0.a, z0.b),
      k1 = dip(z1.a, z1.b);
    // Le creux est vers l'angle : la ligne de nez y passe près du coin du jour.
    expect(V.len(V.sub(D.lines[k0]!.Q, D.inner.pts[1]!))).toBeLessThan(D.g);
    expect(V.len(V.sub(D.lines[k1]!.Q, D.inner.pts[2]!))).toBeLessThan(D.g);
    expect(D.gInMin).toBeGreaterThanOrEqual(100);
    // Hors des zones, marches droites : giron identique des deux côtés.
    D.treads
      .filter((t) => !t.balanced)
      .forEach((t) => {
        expect(t.gIn).toBeCloseTo(D.g, 6);
        expect(t.gOut).toBeCloseTo(D.g, 6);
      });
  });

  it("garde deux zones séparées quand la volée du milieu est longue", () => {
    const R = stairOf({ forme: "dq-d", ...U, C: 3400, mb: 4 });
    const [z0, z1] = R.bals;
    expect(z0!.b).toBeLessThan(z1!.a);
    for (let j = z0!.b + 1; j <= z1!.a; j++) expect(R.treads[j - 1]!.balanced).toBe(false);
  });

  it("refuse un côté fond qui ne laisse pas 100 mm de limon de jour entre les poteaux", () => {
    const p = { ...DEFAULTS, forme: "dq-d" as const, ...U };
    const min = 2 * p.W + 2 * p.ps + 100;
    expect(compute({ ...p, C: min }).ok).toBe(true);
    const r = compute({ ...p, C: min - 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.key)).toContain("C");
  });

  it("déplace les tournants à A + B constant, côté fond inchangé", () => {
    const p = { ...DEFAULTS, forme: "dq-d" as const, ...U };
    const range = turnRange(p)!;
    expect(range.max).toBeGreaterThan(range.min);
    const k = range.min === D.bal!.a ? range.max : range.min;
    const ab = turnLengths(p, k)!;
    expect(ab.A + ab.B).toBe(p.A + p.B);
    const R = stairOf({ forme: "dq-d", ...U, ...ab });
    expect(R.bal!.a).toBe(k);
    expect(R.Lw).toBeCloseTo(D.Lw, 6);
  });
});

describe("double quart tournant : limons et poteaux", () => {
  const p = D.params;
  const jour = D.stringers.filter((s) => s.side === "in"),
    mur = D.stringers.filter((s) => s.side === "out");

  it("coupe chaque limon en trois tronçons, bord haut à LIFT au-dessus des nez", () => {
    expect(jour.map((s) => [s.idx, s.count])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(mur).toHaveLength(3);
    for (const sp of D.stringers) {
      const s0 = (sp.side === "in" ? D.inner : D.outer).cum[sp.idx]!;
      for (const ln of D.lines) {
        const s = (sp.side === "in" ? ln.sIn : ln.sOut) - s0;
        const q = sp.prof.find((v) => Math.abs(v[0] - s) < 1e-6);
        if (q) expect(q[1]).toBeCloseTo((ln.k + 1) * D.h + LIFT, 6);
      }
    }
  });

  it("garde chaque logement dans son limon, avec 20 mm de bois dessous", () => {
    for (const sp of D.stringers) {
      const o = bbox(stringerOutline(sp, sp.hl));
      expect(sp.pockets.length).toBeGreaterThan(0);
      for (const pk of sp.pockets) {
        const b = bbox(pk);
        expect(b.x0).toBeGreaterThanOrEqual(o.x0 - 1e-6);
        expect(b.x1).toBeLessThanOrEqual(o.x1 + 1e-6);
        expect(b.y1).toBeLessThanOrEqual(o.y1 + 1e-6);
      }
      expect(sp.need).toBeLessThanOrEqual(sp.hl + 0.5);
    }
  });

  it("met un poteau à chaque coin du jour, affleurant les limons de jour côté marches", () => {
    expect(D.newels.map((N) => N.k)).toEqual([0, 1]);
    const [N0, N1] = D.newels;
    const K0 = D.inner.pts[1]!,
      K1 = D.inner.pts[2]!,
      d = p.ps / 2;
    expect(N0!.c).toEqual([K0[0] + d, K0[1] - d]);
    expect(N1!.c).toEqual([K1[0] - d, K1[1] - d]);
    // Les limons de jour s'arrêtent sur les faces.
    expect(jour[0]!.prof.at(-1)![0]).toBeCloseTo(D.A - D.W - p.ps, 6);
    expect(jour[1]!.prof[0]![0]).toBeCloseTo(p.ps, 6);
    expect(jour[1]!.prof.at(-1)![0]).toBeCloseTo(D.C - 2 * D.W - p.ps, 6);
    expect(jour[2]!.prof[0]![0]).toBeCloseTo(p.ps, 6);
    for (const N of D.newels) expect(N.faces.filter((f) => f.pockets.length).length).toBeGreaterThan(0);
  });

  it("tenonne le limon de jour du milieu à ses deux bouts, les autres à un seul", () => {
    expect(jour.map((s) => s.tenons.length)).toEqual([1, 2, 1]);
    const mid = jour[1]!,
      o = bbox(stringerOutline(mid, mid.hl));
    expect(o.x0).toBeCloseTo(mid.tenons[0]!.u0, 6);
    expect(o.x1).toBeCloseTo(mid.tenons[1]!.u1, 6);
    for (const t of mid.tenons) expect(t.u1 - t.u0).toBe(TENON.long);
  });

  it("creuse dans chaque poteau la mortaise des deux limons qui y arrivent", () => {
    const ms = D.newels.map((N) => N.faces.flatMap((f) => f.mortises).map((m) => m.idx));
    expect(ms).toEqual([
      [0, 1],
      [1, 2],
    ]);
    for (const N of D.newels)
      for (const m of N.faces.flatMap((f) => f.mortises)) {
        const sp = jour[m.idx]!,
          t = m.idx === N.k ? sp.tenons.at(-1)! : sp.tenons[0]!,
          b = bbox(m.pts);
        expect(b.y1 - b.y0).toBeCloseTo(t.z1 - t.z0 + 2 * p.jeu, 6);
        expect(m.depth).toBeCloseTo(t.u1 - t.u0 + TENON.fond, 6);
      }
  });

  it("perce les limons de mur 1/3 et 2/3 pour l'about du suivant", () => {
    expect(mur.map((s) => s.holes.length)).toEqual([2, 2, 0]);
    const txt = toDXF(buildCNC(D).boardEnts);
    expect(txt).toContain("about du LIMON DE MUR 2/3 contre cette face");
    expect(txt).toContain("about du LIMON DE MUR 3/3 contre cette face");
    expect(txt).toContain("bout en about contre le LIMON DE MUR 2/3");
  });

  it("met les deux poteaux dans poteau.dxf et dans la liste de débit", () => {
    const cnc = buildCNC(D);
    const ents = cnc.postEnts;
    expect(ents.filter((e) => e.kind === "poly" && e.layer === "DECOUPE")).toHaveLength(8);
    expect(
      ents
        .filter((e) => e.kind === "text" && e.s.startsWith("POTEAU "))
        .map((e) => e.kind === "text" && e.s.slice(0, 11)),
    ).toEqual(["POTEAU 1/2 ", "POTEAU 2/2 "]);
    expect(cnc.postParts.map((q) => q.j)).toEqual([1, 2]);
  });
});

describe("double quart tournant : garde-corps", () => {
  const R = stairOf({ forme: "dq-d", ...U, gc: "balustres" });
  const G = R.rail!;

  it("pose une main courante par limon de jour, tenonnée dans chaque poteau", () => {
    expect(G.handrails.map((h) => [h.idx, h.tenons.length])).toEqual([
      [0, 1],
      [1, 2],
      [2, 1],
    ]);
    for (const N of R.newels) {
      const mc = N.faces.flatMap((f) => f.mortises).filter((m) => m.of === "main courante");
      expect(mc.map((m) => m.idx)).toEqual([N.k, N.k + 1]);
      for (const m of mc) expect(N.h).toBeGreaterThanOrEqual(bbox(m.pts).y1);
    }
  });

  it("tient la main courante à 900 mm au moins au-dessus des nez", () => {
    expect(G.hMin).toBeGreaterThanOrEqual(900 - 1e-6);
    expect(G.gap).toBeLessThanOrEqual(110);
  });
});

describe("double quart tournant : trémie", () => {
  const free = (R: Stair) => R.ech === null || R.ech.c >= ECHAPPEE;

  it("calcule la plus courte trémie côté arrivée, sur toute la largeur", () => {
    const R = stairOf({ forme: "dq-d", ...U, tAuto: true });
    expect(R.treDims.tX).toBe(R.C + 2 * R.params.el);
    expect(free(R)).toBe(true);
    expect(free(stairOf({ forme: "dq-d", ...U, tX: R.treDims.tX, tY: R.treDims.tY }))).toBe(true);
    expect(free(stairOf({ forme: "dq-d", ...U, tX: R.treDims.tX, tY: R.treDims.tY - 20 }))).toBe(false);
    expect(R.tre.y0).toBe(R.A - R.B);
  });

  it("propose d'allonger une trémie trop courte", () => {
    const R = stairOf({ forme: "dq-d", ...U, tY: 1200 });
    expect(R.st.ech).not.toBe("ok");
    const note = R.notes.find((n) => n[1].startsWith("Échappée"))!;
    expect(note[1]).toContain("côté arrivée");
    expect(free(stairOf({ forme: "dq-d", ...U, ...note[2]!.set }))).toBe(true);
  });
});

describe("double quart tournant : gauche et droite", () => {
  const G = stairOf({ forme: "dq-g", ...U });

  it("calcule la même géométrie, vue en miroir", () => {
    expect(G.lines).toEqual(D.lines);
    const cg = buildCNC(G),
      cd = buildCNC(D);
    expect(cg.treadParts).toEqual(cd.treadParts);
    expect(cg.riserParts).toEqual(cd.riserParts);
    expect(cg.boardParts).toEqual(cd.boardParts);
    expect(cg.postParts).toEqual(cd.postParts);
  });

  it("retourne le plan et l'ordre des faces des poteaux", () => {
    const pg = planShapes(G),
      pd = planShapes(D);
    const first = (s: (typeof pd.shapes)[number]) => (s.k === "poly" ? s.pts[0]! : null);
    const a = first(pd.shapes[0]!)!,
      b = first(pg.shapes[0]!)!;
    expect(b[0]).toBeCloseTo(-a[0], 9);
    expect(b[1]).toBeCloseTo(a[1], 9);
    const faces = (R: Stair) =>
      buildCNC(R)
        .postEnts.filter((e) => e.kind === "text" && e.s.startsWith("FACE"))
        .map((e) => (e.kind === "text" ? e.s.split(" - ")[1] : ""));
    expect(faces(G)).not.toEqual(faces(D));
    expect(faces(G).slice(0, 4)).toEqual([faces(D)[0], faces(D)[3], faces(D)[2], faces(D)[1]]);
  });
});

describe("double quart tournant : réglages", () => {
  it("reprend les cotes d'exemple en passant au double quart, pas en restant dedans", () => {
    const q = { ...DEFAULTS, forme: "quart-d" as const };
    expect(changeForme(q, { ...q, forme: "dq-g" })).toEqual({ ...q, forme: "dq-g", ...EXEMPLE_U });
    const dq = { ...q, forme: "dq-g" as const, A: 2222 };
    expect(changeForme(dq, { ...dq, forme: "dq-d" }).A).toBe(2222);
    expect(changeForme(dq, { ...dq, forme: "droit" })).toEqual({ ...dq, forme: "droit" });
  });

  it("relit un lien de double quart à l'identique", () => {
    const p = { ...DEFAULTS, forme: "dq-g" as const, ...U, C: 2600, gc: "lisses" as const };
    const hash = paramsToHash(p);
    expect(hash).toContain("forme=dq-g");
    expect(hash).toContain("C=2600");
    expect(paramsFromHash(`#${hash}`)).toEqual(p);
    expect(sanitizeParams({ forme: "dq-d", C: "x" }).C).toBe(DEFAULTS.C);
  });

  it("résume les trois côtés et les deux tours", () => {
    const s = sectionSummaries(D.params, D);
    expect(s.forme).toBe("Double quart tournant droit");
    expect(s.dimensions.replace(/\s/g, " ")).toContain("2 000 × 2 400 × 1 900");
    expect(s.marches).toMatch(/tours de .* et de /);
  });
});
