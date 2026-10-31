import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { cutRows, stockNotes } from "../src/cnc/cutlist";
import { toDXF } from "../src/cnc/dxf";
import { DEFAULTS, type Params } from "../src/core/params";
import { paramsFromHash, paramsToHash } from "../src/core/share";
import { LIFT, compute, palierLayout, type Stair } from "../src/core/stair";
import { checks, sectionSummaries } from "../src/core/summary";
import { GC } from "../src/core/railing";
import { V, bbox, type Vertex } from "../src/core/vec";
import { PALIER, stairOf } from "./cases";

const Q = stairOf({ forme: "quart-d", tournant: "palier", ...PALIER.quart });
const p = Q.params;
/** Reste minimal : la contremarche sous le nez du palier reste devant le coin du jour. */
const rMin = p.deb + p.ecm + p.enc + 1;

/** Distance entre deux nez voisins, mesurée perpendiculairement à la volée. */
const going = (R: Stair, k: number) => Math.abs(V.dot(V.sub(R.lines[k + 1]!.Q, R.lines[k]!.Q), R.lines[k]!.nr));

describe("palier du quart tournant : géométrie", () => {
  it("remplace les marches balancées par un palier, confortable avec ses cotes d'exemple", () => {
    expect(Q.bals).toEqual([]);
    expect(Q.bal).toBeNull();
    expect(Q.treads.filter((t) => t.balanced)).toEqual([]);
    expect(Q.treads.filter((t) => t.palier).map((t) => t.j)).toEqual([Q.paliers[0]!.j]);
    expect(Q.notes.filter((n) => n[0] === "warn" || n[0] === "bad")).toEqual([]);
  });

  it("garde des hauteurs égales, le palier compris", () => {
    Q.treads.forEach((t) => expect(t.top).toBeCloseTo(t.j * Q.h, 9));
    expect(Q.n * Q.h).toBeCloseTo(Q.H, 9);
  });

  it("garde le même giron sur les deux volées, réglé par la longueur côté arrivée", () => {
    const j = Q.paliers[0]!.j;
    for (let k = 0; k < Q.n - 1; k++) if (k !== j - 1) expect(going(Q, k)).toBeCloseTo(Q.g, 6);
    // La volée d'arrivée part du coin du jour et finit au bord du palier haut.
    expect(Q.lines[j]!.Q).toEqual(Q.inner.pts[1]);
    expect(Q.lines.at(-1)!.Q[0]).toBeCloseTo(Q.B, 6);
    expect((Q.B - Q.W) / Q.g).toBeCloseTo(Math.round((Q.B - Q.W) / Q.g), 9);
  });

  it("ajoute le reste de la division à la profondeur du palier, côté départ", () => {
    const { j, reste } = Q.paliers[0]!;
    expect(reste).toBeGreaterThanOrEqual(rMin);
    expect(reste).toBeLessThan(rMin + Q.g);
    expect(Q.lines[j - 1]!.Q[1]).toBeCloseTo(Q.A - Q.W - reste, 6);
    // Le palier va du mur de départ au coin, et du mur du fond au premier nez de la volée d'arrivée.
    const b = bbox(Q.treads[j - 1]!.plan);
    [b.x0, b.x1, b.y0, b.y1].forEach((v, i) => expect(v).toBeCloseTo([0, Q.W, Q.A - Q.W - reste, Q.A][i]!, 6));
  });

  it("propose la longueur côté départ qui raccourcit le palier au plus juste", () => {
    const note = Q.notes.find((n) => n[1].startsWith("Palier de"))!;
    const A = note[2]!.set.A as number;
    const R = stairOf({ forme: "quart-d", tournant: "palier", ...PALIER.quart, A });
    expect(R.paliers[0]!.reste).toBeGreaterThanOrEqual(rMin);
    expect(R.paliers[0]!.reste).toBeLessThan(rMin + 1);
    expect(R.notes.some((n) => n[1].startsWith("Palier de"))).toBe(false);
  });

  it("propose une longueur côté arrivée qui rend l'escalier confortable", () => {
    const R = stairOf({ forme: "quart-d", tournant: "palier" });
    expect(R.st.h === "ok" && R.st.g === "ok" && R.st.bl === "ok").toBe(false);
    const fix = R.notes.find((n) => n[1].startsWith("Longueur côté arrivée conseillée"))![2]!;
    const S = stairOf({ forme: "quart-d", tournant: "palier", ...fix.set });
    expect([S.st.h, S.st.g, S.st.bl, S.st.pente]).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("tient un nombre de hauteurs imposé, le palier s'allongeant d'autant", () => {
    for (const n of [14, 16]) {
      const R = stairOf({ forme: "quart-d", tournant: "palier", ...PALIER.quart, nAuto: false, n });
      expect(R.n).toBe(n);
      expect(R.paliers[0]!.reste).toBeGreaterThanOrEqual(rMin);
    }
    const L = palierLayout(2700, [1700], 1850, rMin, 15)!;
    expect(L.counts[0]! + 1 + L.m + 1).toBe(15);
  });
});

describe("palier du quart tournant : limons, poteau et pièces", () => {
  const cnc = buildCNC(Q);
  const j = Q.paliers[0]!.j,
    Z = j * Q.h + LIFT;

  it("garde les limons à plat le long du palier, à LIFT au-dessus de lui", () => {
    const [jour0] = Q.stringers.filter((s) => s.side === "in");
    const [mur0, mur1] = Q.stringers.filter((s) => s.side === "out");
    // Limon de jour de départ : du nez du palier au poteau, à plat.
    expect(jour0!.prof.at(-1)![1]).toBeCloseTo(Z, 9);
    // Limons de mur : à plat sur tout le palier, puis la volée d'arrivée repart un giron avant son premier nez.
    expect(mur0!.prof.at(-1)![1]).toBeCloseTo(Z, 9);
    expect(mur1!.prof[0]![1]).toBeCloseTo(Z, 9);
    expect(mur1!.prof.find((q) => q[1] > Z + 1e-6)![0]).toBeCloseTo(Q.W, 6);
  });

  it("loge le palier dans les deux limons de mur et dans le poteau, jusqu'au coin", () => {
    const top = (pk: Vertex[]) => Math.max(...pk.map((q) => q[1]));
    const [mur0, mur1] = Q.stringers.filter((s) => s.side === "out");
    const lodged = (pks: Vertex[][]) => pks.filter((pk) => Math.abs(top(pk) - (j * Q.h + p.jeu)) < 1e-6);
    // Mur de départ : du nez du palier au coin ; mur du fond : du coin au premier nez de la volée d'arrivée.
    const b0 = bbox(lodged(mur0!.pockets).at(-1)! as [number, number][]),
      b1 = bbox(lodged(mur1!.pockets)[0]! as [number, number][]);
    expect(b0.x1).toBeCloseTo(Q.A + p.jeu, 6);
    expect(b1.x0).toBeCloseTo(0, 6);
    expect(b1.x1).toBeGreaterThan(Q.W);
    const N = Q.newels[0]!;
    expect(N.faces.filter((f) => f.pockets.some((pk) => Math.abs(top(pk) - (j * Q.h + p.jeu)) < 1e-6))).toHaveLength(2);
  });

  it("nomme le palier dans marches.dxf et la liste de débit, plateau collé à chant", () => {
    expect(toDXF(cnc.treadEnts)).toContain("\r\nPALIER\r\n");
    expect(cnc.treadParts.filter((q) => q.palier).map((q) => q.j)).toEqual([j]);
    const rows = cutRows(cnc, Q);
    expect(rows.filter((r) => r.name === "Palier")).toHaveLength(1);
    expect(rows.some((r) => r.name.includes(String(j)) && r.name.startsWith("Marches"))).toBe(false);
    expect(stockNotes(cnc, Q).some(([, t]) => t.startsWith("Palier de") && t.includes("collé à chant"))).toBe(true);
  });

  it("résume le palier dans les réglages et les contrôles", () => {
    expect(sectionSummaries(p, Q).marches.replace(/\s/g, " ")).toContain(
      `palier à ${(j * 180).toLocaleString("fr-FR").replace(/\s/g, " ")}`,
    );
    expect(checks(Q).at(-1)!.k).toBe("Palier");
  });
});

describe("double quart à palier", () => {
  const D = stairOf({ forme: "dq-d", tournant: "palier", ...PALIER.dq });

  it("met un palier à chaque tournant, avec le même giron sur les trois volées", () => {
    expect(D.paliers).toHaveLength(2);
    const pal = D.paliers.map((q) => q.j);
    expect(D.treads.filter((t) => t.palier).map((t) => t.j)).toEqual(pal);
    for (let k = 0; k < D.n - 1; k++) if (!pal.includes(k + 1)) expect(going(D, k)).toBeCloseTo(D.g, 6);
    for (const { reste } of D.paliers) expect(reste).toBeGreaterThanOrEqual(rMin);
    expect(D.notes.filter((n) => n[0] === "warn" || n[0] === "bad")).toEqual([]);
    // Le reste du second palier se règle sur le côté fond.
    expect(D.notes.filter((n) => n[1].startsWith("Palier 2")).every((n) => "C" in n[2]!.set)).toBe(true);
  });

  it("garde le limon de jour du milieu sous la pente, à plat sur le reste du second palier", () => {
    const mid = D.stringers.find((s) => s.side === "in" && s.idx === 1)!;
    expect(mid.prof[0]![1]).toBeLessThan(mid.prof.at(-1)![1]);
  });
});

describe("demi-tournant à palier", () => {
  const over: Partial<Params> = { forme: "demi-d", tournant: "palier", ...PALIER.demi, gc: "balustres" };
  const R = stairOf(over);
  const L = stairOf({ ...over, J: 400 });

  it("met un seul palier sur tout le fond", () => {
    expect(R.paliers).toHaveLength(1);
    const b = bbox(R.treads[R.paliers[0]!.j - 1]!.plan);
    expect(b.x0).toBeCloseTo(0, 6);
    expect(b.x1).toBeCloseTo(R.C, 6);
    expect(b.y1).toBeCloseTo(R.A, 6);
    expect(R.notes.filter((n) => n[0] === "warn" || n[0] === "bad")).toEqual([]);
  });

  it("tient le bord du palier par un limon de palier horizontal entre les deux poteaux", () => {
    expect(L.newels).toHaveLength(2);
    const lp = L.stringers.find((s) => s.side === "in" && s.idx === 1)!;
    const Z = L.paliers[0]!.j * L.h + LIFT;
    for (const q of lp.prof) expect(q[1]).toBeCloseTo(Z, 9);
    expect(lp.tenons).toHaveLength(2);
    expect(lp.pockets.length).toBeGreaterThan(0);
  });

  it("pose une main courante horizontale à 1 000 mm au-dessus du palier", () => {
    const hr = L.rail!.handrails.find((h) => h.idx === 1)!;
    expect(hr.b).toBeCloseTo(0, 9);
    expect(hr.z0).toBeCloseTo(L.paliers[0]!.j * L.h + GC.hPalier, 6);
    expect(L.rail!.hMax).toBeCloseTo(GC.hPalier, 6);
    // Les rampants restent à 900 mm au moins au-dessus des nez.
    expect(L.rail!.hMin).toBeGreaterThanOrEqual(GC.h - 1e-6);
  });

  it("garde le poteau unique au jour étroit, qui reçoit le bord du palier", () => {
    expect(R.newels).toHaveLength(1);
    const north = R.newels[0]!.faces.find((f) => f.volee === 1)!;
    expect(north.pockets.length).toBeGreaterThan(0);
  });
});

describe("palier : réglages", () => {
  it("relit un lien d'escalier à palier à l'identique", () => {
    const v = { ...DEFAULTS, tournant: "palier" as const, ...PALIER.quart };
    const hash = paramsToHash(v);
    expect(hash).toContain("tournant=palier");
    expect(paramsFromHash(`#${hash}`)).toEqual(v);
  });

  it("ne change rien à l'escalier droit", () => {
    const a = compute({ ...DEFAULTS, forme: "droit" }),
      b = compute({ ...DEFAULTS, forme: "droit", tournant: "palier" });
    if (!a.ok || !b.ok) throw new Error("calcul attendu");
    expect(b.stair.lines).toEqual(a.stair.lines);
    expect(b.stair.paliers).toEqual([]);
  });
});
