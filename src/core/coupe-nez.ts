/* Coupe au nez, pour la fiche : la marche du haut, sa contremarche et l'arrière de la marche du bas, coupés
   d'équerre au nez. On y lit le profil du nez, les rainures antidérapantes, la pose de la contremarche et son
   embrèvement. Abscisse v vers le haut de l'escalier (0 au nez de la marche du haut), z depuis le dessus de la
   marche du bas. */
import { fmt } from "./format";
import { noseProfile } from "./nez";
import { arriereMarche } from "./params";
import type { SideDrawing, SideRole, SideShape } from "./side-shapes";
import type { Stair } from "./stair-types";
import type { Pt } from "./vec";

/** Étendue dessinée de la marche du haut derrière son nez, et de la marche du bas devant la contremarche. */
const VR = 170,
  VL = 110;

/** Cote sans décimale quand elle est entière. */
const num = (v: number) => fmt(v, Number.isInteger(v) ? 0 : 1);

/** Cote du profil, en abrégé. */
function nezCourt(R: Stair): string {
  const p = R.params,
    r = num(R.rn);
  if (!(R.rn > 0)) return "nez vif";
  return p.nez === "chanfrein" ? `chanfrein ${r} × 45°` : `R${r}${p.nez === "quart" ? " dessus" : ""}`;
}

export function coupeNez(R: Stair): SideDrawing {
  const p = R.params,
    { h } = R,
    et = p.et;
  const T = (v: number, z: number): Pt => [v, -z];
  const fs = 12;
  const shapes: SideShape[] = [],
    pts: Pt[] = [];
  const add = (s: SideShape, ...at: Pt[]) => {
    shapes.push(s);
    pts.push(...at);
  };
  const poly = (q: Pt[], role: SideRole = "pl-tread") => {
    const d = q.map(([v, z]) => T(v, z));
    add({ k: "poly", role, pts: d, fine: true }, ...d);
  };
  const text = (at: Pt, t: string, anchor: "start" | "middle" | "end") => {
    const w = 0.6 * fs * t.length,
      a = T(...at),
      x0 = anchor === "start" ? a[0] : anchor === "end" ? a[0] - w : a[0] - w / 2;
    add(
      { k: "text", role: "pl-dimtxt", at: a, size: fs, text: t, anchor },
      [x0, a[1] - fs / 2],
      [x0 + w, a[1] + fs / 2],
    );
  };

  // Rainures du dessus, dans l'étendue dessinée.
  const grooves = p.rai
    ? Array.from({ length: Math.round(p.raiN) }, (_, i) => p.raiD + i * p.raiE).filter((c) => c + p.raiL / 2 < VR - 10)
    : [];
  const emb = p.cm ? p.cmEmb : 0,
    zb = h - et;
  // Marche du haut : coupe du nez, dessus rainuré, coupe arrière, dessous avec la rainure de logement.
  const top: Pt[] = noseProfile(p.nez, R.rn, et).map(([v, z]): Pt => [v, zb + z]);
  for (const c of grooves) {
    const a = c - p.raiL / 2,
      b = c + p.raiL / 2;
    top.push([a, h], [a, h - p.raiP], [b, h - p.raiP], [b, h]);
  }
  top.push([VR, h], [VR, zb]);
  if (emb > 0) top.push([p.deb + p.ecm, zb], [p.deb + p.ecm, zb + emb], [p.deb, zb + emb], [p.deb, zb]);
  poly(top);
  // Marche du bas, jusqu'au dos de la contremarche ou jusqu'à son parement.
  const back = arriereMarche(p);
  poly([
    [-VL, -et],
    [back, -et],
    [back, 0],
    [-VL, 0],
  ]);
  // Contremarche, sur la marche du bas ou derrière elle, jusque dans sa rainure.
  if (p.cm) {
    const z0 = p.cmPose === "derriere" ? -et : 0;
    poly([
      [p.deb, z0],
      [p.deb + p.ecm, z0],
      [p.deb + p.ecm, zb + emb],
      [p.deb, zb + emb],
    ]);
  }

  // Cotes : débord sous le nez, profil devant, rainures au-dessus, contremarche à droite.
  const k = 3;
  const dz = zb - 12;
  const seg = (a: Pt, b: Pt): [Pt, Pt] => [T(...a), T(...b)];
  add(
    {
      k: "path",
      role: "pl-dim",
      segs: [
        seg([0, dz], [p.deb, dz]),
        seg([-k, dz - k], [k, dz + k]),
        seg([p.deb - k, dz - k], [p.deb + k, dz + k]),
        seg([0, zb], [0, dz - k]),
      ],
    },
    T(0, dz),
    T(p.deb, dz),
  );
  text([-6, dz], `débord ${fmt(p.deb)}`, "end");
  text([-6, zb + et / 2], nezCourt(R), "end");
  if (grooves.length)
    text(
      [(grooves[0]! + grooves[grooves.length - 1]!) / 2, h + fs],
      `${grooves.length > 1 ? `${grooves.length} rainures` : "rainure"} ${num(p.raiL)} × ${num(p.raiP)}`,
      "middle",
    );
  if (p.cm) {
    const x = p.deb + p.ecm + 8;
    text([x, zb / 2 + fs * 0.6], `contremarche ${fmt(p.ecm)}`, "start");
    text([x, zb / 2 - fs * 0.6], p.cmPose === "derriere" ? "derrière la marche" : "sur la marche", "start");
    if (emb > 0) text([x, zb - fs * 1.2], `embrevée de ${fmt(emb)}`, "start");
  }

  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  const m = 6,
    x0 = Math.min(...xs) - m,
    y0 = Math.min(...ys) - m;
  return { shapes, box: [x0, y0, Math.max(...xs) + m - x0, Math.max(...ys) + m - y0] };
}
