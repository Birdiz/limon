import { fmt } from "../core/format";
import type { Stair } from "../core/stair";
import { V, type Pt } from "../core/vec";

const xy = (q: Pt) => q[0].toFixed(1) + "," + q[1].toFixed(1);

/** Plan coté de l'escalier en SVG, vue de dessus (montée vers le haut de l'écran). */
export function planSVG(R: Stair): string {
  const mx = R.params.forme === "quart-g" ? -1 : 1;
  const T = (q: Pt): Pt => [mx * q[0], -q[1]];
  const span = Math.max(R.quart ? Math.max(R.A, R.B) : R.L, R.W);
  const fs = span / 34;
  const pts: Pt[] = [],
    parts: string[] = [];
  const poly = (arr: Pt[], cls: string) => {
    const t = arr.map(T);
    pts.push(...t);
    return `<polygon class="${cls}" vector-effect="non-scaling-stroke" points="${t.map(xy).join(" ")}"/>`;
  };

  // Limons et poteau
  R.stringers.forEach((sp) => {
    const u0 = sp.prof[0]![0],
      u1 = sp.prof[sp.prof.length - 1]![0];
    const a = V.add(sp.origin, V.mul(sp.dir, u0)),
      b = V.add(sp.origin, V.mul(sp.dir, u1));
    parts.push(poly([a, b, V.add(b, V.mul(sp.rn, sp.width)), V.add(a, V.mul(sp.rn, sp.width))], "pl-str"));
  });
  if (R.newel) {
    const c = R.newel.c,
      d = R.newel.size / 2;
    parts.push(
      poly(
        [
          [c[0] - d, c[1] - d],
          [c[0] + d, c[1] - d],
          [c[0] + d, c[1] + d],
          [c[0] - d, c[1] + d],
        ],
        "pl-str",
      ),
    );
  }
  // Marches
  R.treads.forEach((t) => parts.push(poly(t.plan, t.balanced ? "pl-bal" : "pl-tread")));
  // Trémie, au-dessus des marches
  const Tr = R.tre;
  parts.push(
    poly(
      [
        [Tr.x0, Tr.y0],
        [Tr.x1, Tr.y0],
        [Tr.x1, Tr.y1],
        [Tr.x0, Tr.y1],
      ],
      "pl-tremie",
    ),
  );
  // Ligne de foulée
  const wp: Pt[] = [],
    steps = 120;
  for (let i = 0; i <= steps; i++) wp.push(T(R.walkAt((R.Lw * i) / steps)));
  parts.push(
    `<polyline class="pl-walk" vector-effect="non-scaling-stroke" stroke-width="1.6" points="${wp.map(xy).join(" ")}"/>`,
  );
  const s0 = wp[0]!,
    e1 = wp[wp.length - 1]!,
    e0 = wp[wp.length - 3]!;
  const ang = Math.atan2(e1[1] - e0[1], e1[0] - e0[0]),
    ah = fs * 0.9;
  parts.push(`<circle class="pl-walk-end" cx="${s0[0]}" cy="${s0[1]}" r="${fs * 0.28}"/>`);
  parts.push(
    `<polygon class="pl-walk-end" points="${e1[0]},${e1[1]} ${e1[0] - ah * Math.cos(ang - 0.4)},${e1[1] - ah * Math.sin(ang - 0.4)} ${e1[0] - ah * Math.cos(ang + 0.4)},${e1[1] - ah * Math.sin(ang + 0.4)}"/>`,
  );
  // Numéros de marche
  R.treads.forEach((t) => {
    const q = T(R.walkAt((t.j - 0.5) * R.g));
    parts.push(
      `<text class="pl-num" x="${q[0]}" y="${q[1]}" font-size="${fs * 0.72}" stroke-width="${fs * 0.22}" text-anchor="middle" dominant-baseline="central">${t.j}</text>`,
    );
  });
  // Point le plus bas sous le plancher
  if (R.ech) {
    const q = T(R.ech.pt),
      s = R.st.ech;
    parts.push(
      `<circle class="pl-ech ${s}" vector-effect="non-scaling-stroke" cx="${q[0]}" cy="${q[1]}" r="${fs * 0.42}"/>`,
    );
    parts.push(
      `<text class="pl-echtxt ${s}" x="${q[0] + mx * fs * 0.7}" y="${q[1]}" font-size="${fs * 0.62}" stroke-width="${fs * 0.22}" text-anchor="${mx > 0 ? "start" : "end"}" dominant-baseline="central">échappée ${fmt(R.ech.c)}</text>`,
    );
  }
  // Cotes
  const dim = (a: Pt, b: Pt, o: Pt, label: string) => {
    const d = R.stringers[0]!.width + fs * 1.6;
    const A2 = V.add(a, V.mul(o, d)),
      B2 = V.add(b, V.mul(o, d));
    const ta = T(a),
      tb = T(b),
      tA = T(A2),
      tB = T(B2);
    const ext = V.mul(o, fs * 0.5);
    const tA3 = T(V.add(A2, ext)),
      tB3 = T(V.add(B2, ext));
    pts.push(tA3, tB3);
    const dx = tB[0] - tA[0],
      dy = tB[1] - tA[1],
      L = Math.hypot(dx, dy),
      ux = dx / L,
      uy = dy / L,
      k = fs * 0.35;
    const tick = (q: Pt) =>
      `<path class="pl-dim" vector-effect="non-scaling-stroke" d="M${q[0] - k * (ux - uy)},${q[1] - k * (uy + ux)}L${q[0] + k * (ux - uy)},${q[1] + k * (uy + ux)}"/>`;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg <= -90) deg += 180;
    const mid = T(V.add(V.mul(V.add(A2, B2), 0.5), V.mul(o, fs * 0.55)));
    return (
      `<path class="pl-dim" vector-effect="non-scaling-stroke" d="M${ta[0]},${ta[1]}L${tA3[0]},${tA3[1]}M${tb[0]},${tb[1]}L${tB3[0]},${tB3[1]}M${tA[0]},${tA[1]}L${tB[0]},${tB[1]}"/>${tick(tA)}${tick(tB)}` +
      `<text class="pl-dimtxt" font-size="${fs * 0.62}" text-anchor="middle" dominant-baseline="central" transform="translate(${mid[0]},${mid[1]}) rotate(${deg})">${label}</text>`
    );
  };
  if (R.quart) {
    parts.push(dim([0, 0], [0, R.A], [-1, 0], fmt(R.A)));
    parts.push(dim([0, R.A], [R.B, R.A], [0, 1], fmt(R.B)));
  } else parts.push(dim([0, 0], [0, R.L], [-1, 0], fmt(R.L)));
  parts.push(dim([0, 0], [R.W, 0], [0, -1], fmt(R.W)));

  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  const pad = fs * 1.2;
  const x0 = Math.min(...xs) - pad,
    y0 = Math.min(...ys) - pad,
    w = Math.max(...xs) - x0 + pad,
    hh = Math.max(...ys) - y0 + pad;
  return `<svg viewBox="${x0} ${y0} ${w} ${hh}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Plan de l'escalier, vue de dessus">${parts.join("")}</svg>`;
}
