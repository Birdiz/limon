/* Étapes 2 à 4 du calcul : hauteurs et paliers, balancement, lignes de nez. */
import { CONFORT } from "./confort";
import { H_MAX, type Params } from "./params";
import { polyAt, polyCut } from "./poly";
import type { Flights } from "./stair-flights";
import type { Balance, ComputeFailure, NoseLine, PalierLayout } from "./stair-types";
import { V, clamp, type Pt } from "./vec";

/** Écart au confort d'une hauteur h et d'un giron g : Blondel (2h + g ≈ 630 mm), pénalités hors des plages. */
const runScore = (h: number, g: number) =>
  Math.abs(2 * h + g - CONFORT.blondel.cible) +
  6 * Math.max(0, h - 190) +
  6 * Math.max(0, 155 - h) +
  3 * Math.max(0, 230 - g) +
  3 * Math.max(0, g - 320);

/** Plus grand nombre de hauteurs calculé : la plus haute montée permise, en hauteurs de 120 mm. */
const N_MAX = Math.floor(H_MAX / 120);

/** Nombre de hauteurs qui approche le mieux Blondel (2h + g ≈ 630 mm) dans les plages de confort. */
export function pickN(H: number, Lw: number): number {
  let best: { n: number; score: number } | null = null;
  for (let n = Math.max(3, Math.ceil(H / 230)); n <= Math.min(Math.floor(H / 120), N_MAX); n++) {
    const score = runScore(H / n, Lw / (n - 1));
    if (!best || score < best.score) best = { n, score };
  }
  return best ? best.n : clamp(Math.round(H / 175), 3, N_MAX);
}

/** Répartition la plus confortable des girons autour des paliers ; nFixed impose le nombre de hauteurs
    (le reste des paliers peut alors dépasser un giron). runs : volées qui montent à un palier ; last : volée d'arrivée ;
    rMin : reste minimal, pour que la contremarche sous le nez du palier reste devant le coin du jour. */
export function palierLayout(
  H: number,
  runs: readonly number[],
  last: number,
  rMin: number,
  nFixed?: number,
): PalierLayout | null {
  let best: (PalierLayout & { score: number }) | null = null;
  for (let m = 1; m <= 40; m++) {
    const g = last / m,
      counts = runs.map((r) => Math.floor((r - rMin) / g + 1e-9));
    if (counts.some((c) => c < 0)) continue;
    const lines = () => counts.reduce((a, c) => a + c + 1, 0) + m + 1;
    if (nFixed != null) {
      // Trop de lignes : les volées qui montent aux paliers perdent des girons, le palier s'allonge d'autant.
      for (let i = 0; i < counts.length && lines() > nFixed; i++)
        counts[i] = Math.max(0, counts[i]! - (lines() - nFixed));
      if (lines() !== nFixed) continue;
    }
    const n = lines(),
      rest = runs.map((r, i) => Math.max(0, r - counts[i]! * g));
    if (n < 3 || n > N_MAX) continue;
    const score = runScore(H / n, g) + (nFixed != null ? rest.reduce((a, v) => a + v, 0) / 100 : 0);
    if (!best || score < best.score) best = { n, g, m, counts, rest, score };
  }
  if (!best) return null;
  const { n, g, m, counts, rest } = best;
  return { n, g, m, counts, rest };
}

export interface Heights {
  /** Palier à chaque tournant (« tournant » = "palier"). */
  pal: boolean;
  /** Volées qui montent à un palier, et leurs longueurs. */
  into: number[];
  runs: number[];
  /** Reste minimal d'une volée sous le nez de son palier. */
  rMin: number;
  n: number;
  nAuto: number;
  h: number;
  g: number;
  /** Abscisse de chaque nez sur la ligne de foulée. */
  ts: number[];
  /** Ligne de nez j de chaque palier, et le reste de sa volée ajouté à sa profondeur. */
  paliers: { j: number; reste: number }[];
  /** Côté du jour où commence la volée qui suit chaque palier. */
  palSeg: number[];
}

/** Nombre et hauteur des marches, giron, paliers, abscisse de chaque nez sur la ligne de foulée. */
export function heights(p: Params, fl: Flights): Heights | ComputeFailure {
  const { H } = p;
  const { tours, quart, demi, len, tB, Lw } = fl;
  // Palier à chaque tournant (un seul, sur tout le fond, en demi-tournant) : même giron sur toutes les volées,
  // donné par la volée d'arrivée ; le reste de chaque volée qui monte à un palier s'ajoute à sa profondeur.
  const pal = quart && p.tournant === "palier";
  const into = !pal ? [] : demi ? [0] : Array.from({ length: tours }, (_, i) => i);
  const runs = into.map((i) => len[i]!);
  // Le nez du palier reste au moins à la contremarche et à l'encastrement du coin du jour : elle se loge dans le poteau.
  const rMin = p.deb + (p.cm ? p.ecm : 0) + Math.max(0, p.enc) + 1;
  const layAuto = pal ? palierLayout(H, runs, len[tours]!, rMin) : null;
  if (pal && !layAuto) return { ok: false, errors: [{ key: "B", message: "Palier impossible avec ces longueurs." }] };
  const nAuto = layAuto ? layAuto.n : pickN(H, Lw);
  const lay = layAuto && !p.nAuto ? palierLayout(H, runs, len[tours]!, rMin, clamp(Math.round(p.n), 3, 40)) : layAuto;
  if (pal && !lay)
    return { ok: false, errors: [{ key: "n", message: "Ce nombre de hauteurs ne tient pas avec un palier." }] };
  const n = lay ? lay.n : p.nAuto ? nAuto : clamp(Math.round(p.n), 3, 40);
  const h = H / n,
    g = lay ? lay.g : Lw / (n - 1);
  // Abscisse de chaque nez sur la ligne de foulée : régulière, ou volée par volée autour des paliers.
  const ts: number[] = [];
  const paliers: { j: number; reste: number }[] = [],
    palSeg: number[] = [];
  if (lay) {
    into.forEach((i, q) => {
      const t0 = i ? tB[i - 1]! : 0;
      for (let c = 0; c <= lay.counts[q]!; c++) ts.push(t0 + c * g);
      paliers.push({ j: ts.length, reste: lay.rest[q]! });
      palSeg.push(demi ? tours : i + 1);
    });
    for (let c = 0; c <= lay.m; c++) ts.push(tB[tours - 1]! + c * g);
  } else for (let k = 0; k < n; k++) ts.push(k * g);
  return { pal, into, runs, rMin, n, nAuto, h, g, ts, paliers, palSeg };
}

/** Position de chaque nez sur le côté du jour (s) : perpendiculaire en partie droite, puis balancée à chaque
    tournant (bals). */
export function balance(p: Params, fl: Flights, he: Heights): { s: number[]; bals: Balance[] } {
  const { tA, tB, sIn } = fl;
  const { pal, n, g, ts } = he;
  const s = ts.map(fl.sPerp);
  // Zone balancée de chaque tournant : mb marches centrées sur l'arc, étendues pour le couvrir tout entier.
  const m0 = clamp(Math.round(p.mb), 2, n - 1);
  const zones = (pal ? [] : tA).map((t1, i) => {
    const t2 = tB[i]!;
    // « || 0 » : pas de zéro négatif pour la première marche du tour, affichée et comparée telle quelle.
    let a = Math.round((t1 + t2) / 2 / g - m0 / 2) || 0,
      b = a + m0;
    if (a < 0) {
      b -= a;
      a = 0;
    }
    if (b > n - 1) {
      a -= b - (n - 1);
      b = n - 1;
      a = Math.max(0, a);
    }
    let extended = false;
    while (a > 0 && a * g > t1 + 1e-6) {
      a--;
      extended = true;
    }
    while (b < n - 1 && b * g < t2 - 1e-6) {
      b++;
      extended = true;
    }
    return { a, b, extended };
  });
  // Deux zones qui se chevauchent se partagent à la ligne la plus proche du milieu de la volée entre les deux :
  // le giron au jour garde un creux à chaque angle. Cette ligne s'appuie sur le côté du jour entre les angles.
  for (let i = 1; i < zones.length; i++) {
    const z0 = zones[i - 1]!,
      z1 = zones[i]!;
    if (z0.b <= z1.a) continue;
    const mid = (tB[i - 1]! + tA[i]!) / 2,
      k = clamp(Math.round(mid / g), z0.a + 1, z1.b - 1);
    z0.b = z1.a = k;
    s[k] = clamp(sIn[i]! + (k * g - tB[i - 1]!), sIn[i]!, sIn[i + 1]!);
  }
  const bals: Balance[] = zones.map(({ a, b, extended }) => {
    const m = b - a,
      S = s[b]! - s[a]!,
      base = S / m,
      amp = g - base;
    const c = (i: number) => (m >= 2 ? Math.cos((2 * Math.PI * (i + 0.5)) / m) : 0);
    let pr = clamp(p.prog / 100, 0, 1);
    const want = pr;
    const minW = CONFORT.gIn.min;
    if (amp > 0 && m >= 2) {
      let cmin = 0;
      for (let i = 0; i < m; i++) cmin = Math.min(cmin, c(i));
      const pmax = cmin < 0 ? (base - minW) / (-cmin * amp) : 1;
      pr = clamp(Math.min(pr, pmax), 0, 1);
    } else pr = 0;
    let acc = s[a]!;
    for (let i = 0; i < m - 1; i++) {
      acc += base + pr * amp * c(i);
      s[a + i + 1] = acc;
    }
    return { a, b, m, extended, pr, want };
  });
  return { s, bals };
}

/** Lignes de nez : du point sur le jour, passant par la ligne de foulée, jusqu'au limon extérieur. */
export function noseLines(fl: Flights, ts: readonly number[], s: readonly number[]): NoseLine[] | ComputeFailure {
  const { inner, outer, walkAt, walkTan } = fl;
  const lines: NoseLine[] = [];
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k]!,
      Q = polyAt(inner, s[k]!),
      P = walkAt(t);
    const dir = V.norm(V.sub(P, Q));
    let nr: Pt = [dir[1], -dir[0]];
    if (V.dot(nr, walkTan(t)) < 0) nr = [-nr[0], -nr[1]];
    const o = polyCut(outer, Q, dir, "ahead");
    if (!o)
      return {
        ok: false,
        errors: [{ message: "Géométrie impossible : une ligne de marche ne rejoint pas le limon extérieur." }],
      };
    lines.push({ k, t, Q, P, dir, nr, sIn: s[k]!, sOut: o.s, O: o.p });
  }
  return lines;
}
