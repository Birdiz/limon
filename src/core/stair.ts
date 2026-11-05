/* Calcul de l'escalier.
   Repère plan (mm) : départ en y = 0, montée vers +y, limon extérieur en x = 0, jour (intérieur) en x = W.
   Tournants calculés à droite (2e volée vers +x, 3e vers −y en double quart) ; la version gauche est un miroir. */
import { fmt, ceil10 } from "./format";
import { ECHAPPEE, ECHAPPEE_MIN, type Headroom } from "./headroom";
import { nezCote } from "./nez";
import { COTE_MAX, H_MAX, TOURS, arriereMarche, isDemi, jourUnPoteau, type NumericKey, type Params } from "./params";
import { cncFrame, stringerPockets } from "./pockets";
import { makePoly, polyAt, polyCut, polyPath, type Poly } from "./poly";
import { GC, railing } from "./railing";
import { stairNotes } from "./stair-notes";
import { tremie } from "./tremie";
import type {
  Balance,
  ComputeResult,
  EchCote,
  InputError,
  LandingTread,
  Newel,
  NoseLine,
  PalierLayout,
  Riser,
  Stair,
  Status,
  StringerGeom,
  StringerPiece,
  Tenon,
  Tread,
} from "./stair-types";
import { V, clamp, interp, type Pt } from "./vec";

/** Rainures antidérapantes : au plus RAINURES_MAX, arrêtées à RAINURE_ARRET des limons et de la ligne de nez
    suivante, une rainure plus courte que RAINURE_MIN n'est pas taillée. */
export const RAINURES_MAX = 6;
export const RAINURE_ARRET = 10;
export const RAINURE_MIN = 50;

/* Les types du modèle vivent dans stair-types.ts ; ils restent importables d'ici. */
export type * from "./stair-types";
export type { Headroom } from "./headroom";
export { ECHAPPEE, ECHAPPEE_MIN };

/**
 * Plages des contrôles de confort, en mm (pente en degrés) : hors de min…max, « Limite » ;
 * au-delà de bad, « Hors norme ». gIn : giron côté jour des marches balancées.
 */
export const CONFORT = {
  h: { min: 155, max: 185, bad: 200 },
  g: { min: 240, max: 320, bad: 210 },
  blondel: { min: 600, max: 640, cible: 630, badMin: 580, badMax: 660 },
  pente: { max: 38, bad: 45 },
  gIn: { min: 100, bad: 60 },
} as const;
/** Ligne de foulée automatique du quart tournant : au plus à cette distance du jour. */
export const FOULEE_MAX = 500;

/** État d'une échappée (null : tout passe sous la trémie). */
export const echStatus = (e: Headroom | null): Status =>
  !e ? "ok" : e.c < ECHAPPEE_MIN ? "bad" : e.c < ECHAPPEE ? "warn" : "ok";

/** Où tombe l'échappée la plus faible : sur un côté, sur la ligne de foulée, sur toute la largeur quand
    les trois se valent (au demi-millimètre), "" quand elle tombe entre deux. */
export function echWhere(ech: Headroom, cotes: Record<EchCote, Headroom | null>): string {
  const at = (e: Headroom | null) => !!e && Math.abs(e.c - ech.c) < 0.5;
  if (at(cotes.jour) && at(cotes.foulee) && at(cotes.mur)) return "sur toute la largeur";
  return at(cotes.jour) ? "côté jour" : at(cotes.mur) ? "côté mur" : at(cotes.foulee) ? "sur la ligne de foulée" : "";
}

/** Échappée détaillée par côté : en quart tournant, ou quand les côtés diffèrent. */
export function echSidesShown(R: Stair): boolean {
  const v = Object.values(R.echCotes).map((e) => (e ? fmt(e.c) : ""));
  return R.quart || v.some((x) => x !== v[0]);
}
/** Hauteur du bord haut des limons au-dessus de la ligne des nez. */
export const LIFT = 50;
/** Assemblage des limons de jour dans le poteau : longueur de tenon visée, épaulements haut et bas,
    fond de mortaise au-delà du tenon. Tête du poteau au-dessus du limon le plus haut. */
export const TENON = { long: 40, epaul: 30, fond: 2, tete: 100 } as const;
/** Diamètre des perçages de l'about des limons de mur. */
export const PERCAGE = 10;

/** Statuts de confort d'une hauteur de marche h et d'un giron g. */
export function comfortStatus(h: number, g: number): Pick<Stair["st"], "h" | "g" | "bl" | "pente"> {
  const C = CONFORT;
  const blondel = 2 * h + g,
    pente = (Math.atan2(h, g) * 180) / Math.PI;
  return {
    h: h > C.h.bad ? "bad" : h > C.h.max || h < C.h.min ? "warn" : "ok",
    g: g < C.g.bad ? "bad" : g < C.g.min || g > C.g.max ? "warn" : "ok",
    bl:
      blondel < C.blondel.badMin || blondel > C.blondel.badMax
        ? "bad"
        : blondel < C.blondel.min || blondel > C.blondel.max
          ? "warn"
          : "ok",
    pente: pente > C.pente.bad ? "bad" : pente > C.pente.max ? "warn" : "ok",
  };
}

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

/** Cotes que le calcul lit avec ces réglages. Les autres (autre forme, valeur automatique) sont sans effet : hors de
    vue, ou non relues du formulaire, elles ne doivent pas bloquer l'escalier. */
function cotesLues(p: Params, tours: number): NumericKey[] {
  return [
    "H",
    "W",
    "et",
    "deb",
    "rn",
    "el",
    "hl",
    "ep",
    "enc",
    "jeu",
    "pL",
    "pW",
    ...(tours ? ["A", "B", "ps"] : ["L"]),
    ...(tours === 2 ? [isDemi(p.forme) ? "J" : "C"] : []),
    ...(p.cm ? ["ecm", "cmEmb"] : []),
    ...(p.rai ? ["raiN", "raiL", "raiP", "raiD", "raiE"] : []),
    ...(p.fAuto ? [] : ["f"]),
    ...(tours && !p.hljAuto ? ["hlj"] : []),
    ...(p.tAuto ? [] : tours ? ["tX", "tY", ...(p.tForme === "L" ? ["tbD", "tbA"] : [])] : ["tL"]),
    ...(p.gc === "aucun" ? [] : ["bs", "mcL", "mcH"]),
    ...(p.mp ? ["mpP", "mpE"] : []),
  ] as NumericKey[];
}

function validate(p: Params, tours: number): InputError[] {
  const quart = tours > 0;
  const errors: InputError[] = [];
  const err = (key: NumericKey, message: string) => errors.push({ key, message });
  for (const k of cotesLues(p, tours)) {
    const max = k === "H" ? H_MAX : COTE_MAX;
    if (!(Math.abs(p[k]) <= max)) err(k, `Cette cote sort des limites d'un escalier : ${fmt(max)} mm au plus.`);
  }
  if (errors.length) return errors;
  const { H, W } = p;
  if (!(H >= 300)) err("H", "La hauteur à monter doit faire au moins 300 mm.");
  if (!(W >= 400)) err("W", "L'emmarchement doit faire au moins 400 mm.");
  if (quart) {
    if (!(p.A > W + 1)) err("A", "La longueur côté départ doit dépasser l'emmarchement.");
    if (!(p.B > W + 1)) err("B", "La longueur côté arrivée doit dépasser l'emmarchement.");
    if (isDemi(p.forme)) {
      if (!(p.J >= 2 * p.el + 20))
        err("J", `Le jour doit laisser passer les deux limons de jour : au moins ${fmt(2 * p.el + 20)} mm.`);
    } else if (tours === 2 && p.ps >= p.el + 30 && !(p.C - 2 * W >= 2 * p.ps + 100))
      err(
        "C",
        `Le côté fond doit laisser au moins 100 mm de limon de jour entre les deux poteaux : au moins ${fmt(2 * W + 2 * p.ps + 100)} mm.`,
      );
  } else if (!(p.L >= 500)) err("L", "Le reculement doit faire au moins 500 mm.");
  if (quart && !(p.ps >= p.el + 30))
    err("ps", "La section du poteau doit dépasser l'épaisseur de limon d'au moins 30 mm.");
  else if (quart && p.A > W + 1 && p.B > W + 1 && !(Math.min(p.A, p.B) - W >= p.ps + 100))
    err("ps", "Le poteau doit laisser au moins 100 mm de limon de jour de chaque côté : réduisez sa section.");
  if (p.gc !== "aucun") {
    if (!(p.bs >= 20)) err("bs", "Les balustres, montants et lisses doivent faire au moins 20 mm.");
    else if (p.gcPose === "chant" && !(p.bs <= p.el))
      err("bs", "Posés dans le chant, les balustres ne doivent pas dépasser l'épaisseur du limon.");
    if (!(p.mcH >= 30)) err("mcH", "La main courante doit faire au moins 30 mm de haut.");
    if (!(p.mcL >= 30)) err("mcL", "La main courante doit faire au moins 30 mm de large.");
    else if (
      quart &&
      p.ps >= p.el + 30 &&
      !(p.mcL / 2 + (p.gcPose === "chant" ? p.el / 2 : p.el + p.bs / 2) <= p.ps - 10)
    )
      err("mcL", "La main courante déborde du poteau : réduisez sa largeur ou élargissez le poteau.");
    else if (
      isDemi(p.forme) &&
      p.J < jourUnPoteau(p) &&
      !(2 * (p.mcL / 2 + (p.gcPose === "chant" ? p.el / 2 : p.el + p.bs / 2)) <= p.J)
    )
      err(
        "mcL",
        "Les deux mains courantes se touchent contre le poteau : réduisez leur largeur ou élargissez le jour.",
      );
  }
  if (p.rai) {
    const r = nezCote(p.nez, p.rn, p.et);
    if (!(Number.isInteger(p.raiN) && p.raiN >= 1 && p.raiN <= RAINURES_MAX))
      err("raiN", `Un nombre entier de rainures, de 1 à ${RAINURES_MAX}.`);
    if (!(p.raiL >= 2 && p.raiL <= 20)) err("raiL", "Les rainures doivent faire de 2 à 20 mm de large.");
    if (!(p.raiP >= 0.5 && p.raiP <= p.et / 4))
      err(
        "raiP",
        `Les rainures doivent faire de 0,5 mm au quart de l'épaisseur de marche (${fmt(p.et / 4, 1)} mm) de profondeur.`,
      );
    if (!(p.raiD - p.raiL / 2 >= r + 3))
      err(
        "raiD",
        `La première rainure doit commencer derrière le profil du nez : axe à au moins ${fmt(Math.ceil(r + 3 + p.raiL / 2))} mm du nez.`,
      );
    if (p.raiN > 1 && !(p.raiE >= p.raiL + 3))
      err(
        "raiE",
        `L'entraxe doit laisser au moins 3 mm de bois entre deux rainures : au moins ${fmt(Math.ceil(p.raiL + 3))} mm.`,
      );
  }
  if (p.cm && !(p.cmEmb >= 0 && p.cmEmb <= p.et / 2))
    err("cmEmb", `L'embrèvement doit rester entre 0 et la moitié de l'épaisseur de marche (${fmt(p.et / 2, 1)} mm).`);
  if (p.mp) {
    if (!(p.mpP >= 150)) err("mpP", "La marche palière doit faire au moins 150 mm de profondeur.");
    if (!(p.mpE >= 18)) err("mpE", "La marche palière doit faire au moins 18 mm d'épaisseur.");
  }
  if (quart && p.tForme === "L" && !p.tAuto) {
    if (!(p.tbD >= 100)) err("tbD", "La branche côté départ doit faire au moins 100 mm.");
    if (!(p.tbA >= 100)) err("tbA", "La branche côté arrivée doit faire au moins 100 mm.");
  }
  if (!(p.ep >= 0 && p.ep < H - 500))
    err("ep", "L'épaisseur du plancher doit rester inférieure à la hauteur à monter moins 500 mm.");
  return errors;
}

type Edge = { sIn: number; sOut: number };

/** Marche palière : de la ligne de nez d'arrivée ln jusqu'à depth en arrière, nez arrondi de rayon r. */
function landingTread(
  ln: NoseLine,
  top: number,
  e: number,
  depth: number,
  r: number,
  g: {
    cutOff: (ln: NoseLine, off: number) => Edge;
    region: (fr: Edge, bk: Edge) => Pt[];
    noseSpan: (ln: NoseLine, r: number) => NonNullable<Tread["nose"]>;
    grooves: (ln: NoseLine, depth: number) => Pt[][];
  },
): LandingTread {
  const back = g.cutOff(ln, depth);
  return {
    top,
    e,
    depth,
    rn: r,
    plan: g.region(ln, back),
    solid: g.region(r > 0 ? g.cutOff(ln, r) : ln, back),
    nose: r > 0 ? g.noseSpan(ln, r) : null,
    grooves: g.grooves(ln, depth),
    nez: V.len(V.sub(ln.O, ln.Q)),
  };
}

/** Calcule l'escalier ; suggest ajoute aux notes les corrections chiffrées (calculs supplémentaires). */
export function compute(p: Params, suggest = true): ComputeResult {
  const tours = TOURS[p.forme],
    quart = tours > 0;
  const errors = validate(p, tours);
  if (errors.length) return { ok: false, errors };

  const { H, W, A, B, L } = p;
  // Demi-tournant : côté fond déduit du jour ; jour étroit, un seul poteau de la largeur du jour.
  const demi = isDemi(p.forme),
    C = demi ? 2 * W + p.J : p.C,
    single = demi && p.J < jourUnPoteau(p);
  const fAuto = quart ? Math.min(W / 2, FOULEE_MAX) : W / 2;
  const f = p.fAuto ? fAuto : clamp(p.f, 100, W - 100);
  const inner = makePoly(
    tours === 2
      ? [
          [W, 0],
          [W, A - W],
          [C - W, A - W],
          [C - W, A - B],
        ]
      : quart
        ? [
            [W, 0],
            [W, A - W],
            [B, A - W],
          ]
        : [
            [W, 0],
            [W, L],
          ],
  );
  const outer = makePoly(
    tours === 2
      ? [
          [0, 0],
          [0, A],
          [C, A],
          [C, A - B],
        ]
      : quart
        ? [
            [0, 0],
            [0, A],
            [B, A],
          ]
        : [
            [0, 0],
            [0, L],
          ],
  );
  // Ligne de foulée : les côtés du jour décalés de f vers l'extérieur, raccordés par un quart de cercle
  // de rayon f autour de chaque angle du jour. Tronçons droits : longueurs len, départ des arcs tA, fins tB.
  const len = tours === 2 ? [A - W, C - 2 * W, B - W] : quart ? [A - W, B - W] : [L];
  const dirs = inner.pts.slice(1).map((q, i) => V.norm(V.sub(q, inner.pts[i]!)));
  const sIn = [0],
    tA: number[] = [],
    tB: number[] = [];
  for (let i = 0; i < tours; i++) {
    sIn.push(sIn[i]! + len[i]!);
    tA.push((i ? tB[i - 1]! : 0) + len[i]!);
    tB.push(tA[i]! + (Math.PI / 2) * f);
  }
  const T1 = quart ? tA[0]! : L,
    T2 = quart ? tB[0]! : L;
  const Lw = quart ? tB[tours - 1]! + len[tours]! : L;
  // Tronçon droit i : vers l'extérieur, à gauche du sens de montée.
  const out = (i: number): Pt => [-dirs[i]![1], dirs[i]![0]];
  const walkAt = (t: number): Pt => {
    let i = 0;
    while (i < tours && t >= tB[i]!) i++;
    if (i === 0 && (!quart || t <= T1)) return [W - f, t];
    if (i < tours && t > tA[i]!) {
      const th = (t - tA[i]!) / f,
        K = inner.pts[i + 1]!;
      return [
        K[0] + f * (out(i)[0] * Math.cos(th) + dirs[i]![0] * Math.sin(th)),
        K[1] + f * (out(i)[1] * Math.cos(th) + dirs[i]![1] * Math.sin(th)),
      ];
    }
    const u = t - (i ? tB[i - 1]! : 0),
      P0 = inner.pts[i]!;
    return [P0[0] + dirs[i]![0] * u + out(i)[0] * f, P0[1] + dirs[i]![1] * u + out(i)[1] * f];
  };
  const walkTan = (t: number): Pt => {
    let i = 0;
    while (i < tours && t >= tB[i]!) i++;
    if (i < tours && t > tA[i]!) {
      const th = (t - tA[i]!) / f;
      return V.sub(V.mul(dirs[i]!, Math.cos(th)), V.mul(out(i), Math.sin(th)));
    }
    return dirs[i]!;
  };

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
  const isPalier = (j: number) => paliers.some((q) => q.j === j);

  // Position de chaque nez sur le limon du jour : perpendiculaire en partie droite, puis balancement.
  const sPerp = (t: number) => {
    let i = 0;
    while (i < tours && t >= tB[i]!) i++;
    if (i < tours && t > tA[i]!) return sIn[i + 1]!;
    return i ? sIn[i]! + (t - tB[i - 1]!) : t;
  };
  const s = ts.map(sPerp);
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
  const bal = bals[0] ?? null;

  // Lignes de nez : du point sur le jour, passant par la ligne de foulée, jusqu'au limon extérieur.
  const lines: NoseLine[] = [];
  for (let k = 0; k < n; k++) {
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
  const cutOff = (ln: NoseLine, off: number) => {
    const pt = V.add(ln.Q, V.mul(ln.nr, off));
    const a = polyCut(inner, pt, ln.dir, "near"),
      b = polyCut(outer, pt, ln.dir, "ahead");
    return { sIn: a ? a.s : ln.sIn, sOut: b ? b.s : ln.sOut };
  };
  const region = (fr: Edge, bk: Edge) => [...polyPath(inner, fr.sIn, bk.sIn), ...polyPath(outer, bk.sOut, fr.sOut)];

  const bo = arriereMarche(p);
  // Nez profilé : bande de largeur rn derrière la ligne de nez, dessinée à part en 3D.
  const rn = nezCote(p.nez, p.rn, p.et);
  const noseSpan = (ln: NoseLine, r = rn) => {
    const d2: Pt = [ln.nr[1], -ln.nr[0]],
      c = cutOff(ln, r);
    const us = [polyAt(inner, ln.sIn), polyAt(outer, ln.sOut), polyAt(inner, c.sIn), polyAt(outer, c.sOut)].map((q) =>
      V.dot(V.sub(q, ln.Q), d2),
    );
    const u0 = Math.min(...us),
      u1 = Math.max(...us);
    return { o: V.add(ln.Q, V.mul(d2, u0)), len: u1 - u0, nr: ln.nr };
  };
  // Rainures antidérapantes parallèles au nez de fr, arrêtées avant les limons et avant la ligne de nez suivante bk
  // (ou à depth derrière le nez) : sur les marches balancées, elles raccourcissent du côté où le giron se resserre.
  const nRai = p.rai ? clamp(Math.round(p.raiN), 1, RAINURES_MAX) : 0;
  const grooves = (fr: NoseLine, bk: NoseLine | null, depth = Infinity): Pt[][] => {
    const out: Pt[][] = [];
    const uOn = (o: number, P: Poly, side: "near" | "ahead") => {
      const c = polyCut(P, V.add(fr.Q, V.mul(fr.nr, o)), fr.dir, side);
      return c ? V.dot(V.sub(c.p, fr.Q), fr.dir) : null;
    };
    const X = (u: number, v: number) => V.add(V.add(fr.Q, V.mul(fr.dir, u)), V.mul(fr.nr, v));
    for (let i = 0; i < nRai; i++) {
      const c = p.raiD + i * p.raiE,
        o1 = c - p.raiL / 2,
        o2 = c + p.raiL / 2;
      if (o2 > depth - RAINURE_ARRET) break;
      const a1 = uOn(o1, inner, "near"),
        a2 = uOn(o2, inner, "near"),
        b1 = uOn(o1, outer, "ahead"),
        b2 = uOn(o2, outer, "ahead");
      if (a1 === null || a2 === null || b1 === null || b2 === null) continue;
      let u0 = Math.max(a1, a2) + RAINURE_ARRET,
        u1 = Math.min(b1, b2) - RAINURE_ARRET;
      if (bk) {
        // Distance de la ligne bk au nez de fr, le long de nr, à l'abscisse u : affine en u.
        const den = V.dot(fr.nr, bk.nr),
          vb = (u: number) => -V.dot(V.add(V.sub(fr.Q, bk.Q), V.mul(fr.dir, u)), bk.nr) / den;
        const v0 = vb(0),
          slope = vb(1) - v0,
          need = o2 + RAINURE_ARRET;
        if (Math.abs(slope) < 1e-9) {
          if (v0 < need) continue;
        } else if (slope > 0) u0 = Math.max(u0, (need - v0) / slope);
        else u1 = Math.min(u1, (need - v0) / slope);
      }
      if (u1 - u0 < RAINURE_MIN) continue;
      out.push([X(u0, o1), X(u1, o1), X(u1, o2), X(u0, o2)]);
    }
    return out;
  };
  const treads: Tread[] = [];
  for (let j = 1; j < n; j++) {
    const fr = lines[j - 1]!,
      bk = lines[j]!;
    treads.push({
      j,
      top: j * h,
      plan: region(fr, bk),
      solid: region(rn > 0 ? cutOff(fr, rn) : fr, cutOff(bk, bo)),
      nose: rn > 0 ? noseSpan(fr) : null,
      grooves: grooves(fr, bk),
      gIn: bk.sIn - fr.sIn,
      gOut: bk.sOut - fr.sOut,
      gWalk: isPalier(j) ? bk.t - fr.t : g,
      nez: V.len(V.sub(fr.O, fr.Q)),
      balanced: bals.some((z) => j > z.a && j <= z.b),
      palier: isPalier(j),
    });
  }
  // Marche palière : dans le prolongement du plancher d'arrivée, son nez sur la dernière ligne de nez.
  const mpD = p.mp ? p.mpP : 0;
  if (mpD && !(p.mpE <= h - 20))
    return {
      ok: false,
      errors: [
        {
          key: "mpE",
          message: `La marche palière doit rester plus mince que la hauteur de marche moins 20 mm (${fmt(h - 20)} mm).`,
        },
      ],
    };
  const mp = mpD
    ? landingTread(lines[n - 1]!, n * h, p.mpE, mpD, Math.min(rn, nezCote(p.nez, p.rn, p.mpE)), {
        cutOff,
        region,
        noseSpan,
        grooves: (ln, depth) => grooves(ln, null, depth),
      })
    : null;
  // Contremarches : sous le nez de la marche du haut, rentrées de l'embrèvement dans sa rainure ; posées sur la
  // marche du bas, ou descendues derrière elle jusqu'à son dessous. La dernière, sans marche palière, s'arrête
  // sous le plancher d'arrivée, qui n'est pas rainuré.
  const risers: Riser[] = [];
  if (p.cm)
    for (let j = 1; j <= n; j++) {
      const ln = lines[j - 1]!;
      const emb = j === n && !mp ? 0 : p.cmEmb;
      const z1 = j * h - (j === n && mp ? mp.e : p.et) + emb;
      const z0 = (j - 1) * h - (p.cmPose === "derriere" && j > 1 ? p.et : 0);
      risers.push({ z0, z1, plan: region(cutOff(ln, p.deb), cutOff(ln, p.deb + p.ecm)) });
    }
  if (treads.some((t) => t.gIn <= 1 || t.gOut <= 1)) {
    return {
      ok: false,
      errors: [
        {
          key: "mb",
          message:
            "Géométrie impossible : des marches se croisent. Augmentez le nombre de marches balancées ou réduisez la progressivité.",
        },
      ],
    };
  }

  // Limons : arête haute à LIFT au-dessus de la ligne des nez.
  const el = p.el,
    hl = p.hl;
  // Hauteur des nez le long d'un côté. Sur un palier, elle reste à plat jusqu'à un giron avant le premier nez
  // de la volée suivante, sans revenir sur le tronçon d'avant : le limon suit le palier, puis la volée.
  const noses = (side: "sIn" | "sOut", P: Poly) => {
    const xs: number[] = [],
      zs: number[] = [];
    lines.forEach((l, k) => {
      xs.push(l[side]);
      zs.push((k + 1) * h);
      const q = paliers.findIndex((pl) => pl.j === k + 1),
        nx = lines[k + 1];
      if (q < 0 || !nx) return;
      xs.push(Math.max(l[side], P.cum[palSeg[q]!]!, nx[side] - g));
      zs.push((k + 1) * h);
    });
    return { xs, zs };
  };
  const nosesIn = noses("sIn", inner),
    nosesOut = noses("sOut", outer);
  const zIn = (v: number) => interp(nosesIn.xs, nosesIn.zs, v) + LIFT;
  const zOut = (v: number) => interp(nosesOut.xs, nosesOut.zs, v) + LIFT;
  // Poteau affleurant les faces côté marches, à chaque coin du jour : les limons de jour s'arrêtent sur ses faces.
  const ps = p.ps;
  const pieces = (P: Poly, arr: number[], zf: (v: number) => number, isOuter: boolean): StringerGeom[] => {
    const out: StringerGeom[] = [],
      N = P.pts.length,
      post = quart && !isOuter ? ps : 0;
    for (let i = 0; i < N - 1; i++) {
      const a = P.pts[i]!,
        dir = V.norm(V.sub(P.pts[i + 1]!, a)),
        rn: Pt = [dir[1], -dir[0]];
      const s0 = P.cum[i]!,
        s1 = P.cum[i + 1]!,
        segL = s1 - s0;
      const lo = i === 0 ? Math.min(s0, arr[0]!) : s0 + post;
      // Avec une marche palière, le dernier tronçon se prolonge à l'horizontale pour la loger.
      const hi = i === N - 2 ? Math.max(s1, arr[arr.length - 1]!) + mpD : s1 - post;
      const ss = [lo, ...arr.filter((v) => v > lo + 1e-6 && v < hi - 1e-6), hi];
      const prof = ss.map((v): Pt => [v - s0, zf(v)]);
      if (isOuter && i < N - 2) prof.push([segL + el, zf(s1)]);
      out.push({
        origin: isOuter ? V.add(a, V.mul(rn, -el)) : a,
        dir,
        rn,
        prof,
        width: el,
        side: isOuter ? "out" : "in",
        idx: i,
        count: N - 1,
        a,
        sLo: i === 0 ? -Infinity : s0 + post,
        sHi: i === N - 2 ? Infinity : s1 - post,
      });
    }
    return out;
  };
  // Jour étroit du demi-tournant : le poteau unique prend la place du limon de jour du milieu.
  const geoms = [
    ...pieces(inner, nosesIn.xs, zIn, false).filter((sp) => !(single && sp.idx === 1)),
    ...pieces(outer, nosesOut.xs, zOut, true),
  ];
  // Faces des poteaux côté marches, traitées comme des bouts de limon pour y loger marches et contremarches.
  // Un poteau par tournant, des angles k0 à k1 : le poteau unique du demi-tournant prend les deux angles,
  // sa face du fond court sur tout le jour.
  const posts = single ? [{ k0: 0, k1: 1 }] : Array.from({ length: tours }, (_, k) => ({ k0: k, k1: k }));
  const newelTop = posts.map(({ k0, k1 }) =>
    ceil10(Math.max(zIn(sIn[k0 + 1]! - ps), zIn(sIn[k1 + 1]! + ps)) + TENON.tete),
  );
  const face = (a: Pt, dir: Pt, u0: number, sLo: number, top: number, w = ps): StringerGeom => ({
    origin: a,
    dir,
    rn: [dir[1], -dir[0]],
    prof: [
      [u0, top],
      [u0 + w, top],
    ],
    width: ps,
    side: "in",
    idx: 0,
    count: 1,
    a,
    sLo,
    sHi: sLo + w,
  });
  const newelFaces = posts.map(({ k0, k1 }, c) => [
    face(inner.pts[k0]!, dirs[k0]!, len[k0]! - ps, sIn[k0 + 1]! - ps, newelTop[c]!),
    ...(k1 > k0 ? [face(inner.pts[k1]!, dirs[k1]!, 0, sIn[k1]!, newelTop[c]!, len[k1]!)] : []),
    face(inner.pts[k1 + 1]!, dirs[k1 + 1]!, 0, sIn[k1 + 1]!, newelTop[c]!),
  ]);
  const postFaces = newelFaces.flat();
  // Logements de chaque limon et hauteur qui garde 20 mm de bois sous le plus bas.
  // Le limon de jour du quart tournant a sa propre hauteur, proposée d'après ses logements.
  const geo = {
    inner,
    outer,
    lines,
    treads,
    risers,
    stringers: [...geoms, ...postFaces],
    mp: mp && { line: lines[n - 1]!, top: mp.top, e: mp.e, depth: mp.depth },
  };
  const isJour = (sp: StringerGeom) => quart && sp.side === "in";
  let pk: ReturnType<typeof stringerPockets>;
  try {
    pk = stringerPockets(geo, p, cncFrame(geo, p));
  } catch {
    // Une ligne de marche, décalée du débord ou de l'encastrement, sort des limons (balancement trop serré,
    // ou jour du demi-tournant trop étroit pour loger les marches qui y pivotent).
    return {
      ok: false,
      errors: [
        demi
          ? {
              key: "J",
              message:
                "Géométrie impossible : une marche ne rejoint plus les limons. Élargissez le jour ou augmentez le nombre de marches balancées.",
            }
          : {
              key: "mb",
              message:
                "Géométrie impossible : une marche ne rejoint plus les limons. Augmentez le nombre de marches balancées.",
            },
      ],
    };
  }
  const withPockets = geoms.map((sp, i) => ({ ...sp, ...pk[i]! }));
  const needJ = Math.max(0, ...withPockets.filter(isJour).map((sp) => sp.need));
  const needM = Math.max(0, ...withPockets.filter((sp) => !isJour(sp)).map((sp) => sp.need));
  const hljAuto = Math.max(150, ceil10(needJ));
  const hlj = quart ? (p.hljAuto ? hljAuto : p.hlj) : hl;
  // Tenon centré dans le bois laissé derrière les logements, pour que sa mortaise n'y débouche pas.
  // Il s'arrête avant la mortaise de l'autre limon, sur la face voisine du poteau.
  const jeu = Math.max(0, p.jeu);
  const tt = Math.max(6, Math.round((el - p.enc) / 2)),
    t0 = Math.max(0, p.enc + (el - p.enc - tt) / 2),
    t1 = t0 + tt,
    tl = Math.min(TENON.long, ps - t1 - 5);
  const tenonOf = (sp: StringerGeom, hs: number, end: boolean): Tenon => {
    const sh = end ? sp.prof[sp.prof.length - 1]![0] : sp.prof[0]![0],
      far = end ? sh + tl : sh - tl;
    const top = (u: number) => zIn(inner.cum[sp.idx]! + u),
      bot = (u: number) => Math.max(0, top(u) - hs);
    return {
      u0: Math.min(sh, far),
      u1: Math.max(sh, far),
      z0: Math.max(bot(sh), bot(far)) + TENON.epaul,
      z1: Math.min(top(sh), top(far)) - TENON.epaul,
      t0,
      t1,
    };
  };
  // About des limons de mur : chaque tronçon dépasse de son épaisseur et reçoit le bout du suivant, vissé ou boulonné.
  // Perçages au milieu du bois laissé derrière les logements, pour rester loin de ceux de la marche d'angle.
  const holesOf = (sp: StringerGeom): Pt[] => {
    if (!quart || sp.side !== "out" || sp.idx === sp.count - 1) return [];
    const i = sp.idx,
      zt = zOut(outer.cum[i + 1]!),
      zb = Math.max(0, zt - hl),
      u = outer.cum[i + 1]! - outer.cum[i]! + (p.enc + jeu + el) / 2;
    return [
      [u, zb + (zt - zb) / 3],
      [u, zb + ((zt - zb) * 2) / 3],
    ];
  };
  const stringers: StringerPiece[] = withPockets.map((sp) => {
    const hs = isJour(sp) ? hlj : hl;
    const tenons = isJour(sp)
      ? [...(sp.idx > 0 ? [tenonOf(sp, hs, false)] : []), ...(sp.idx < sp.count - 1 ? [tenonOf(sp, hs, true)] : [])]
      : [];
    return { ...sp, hl: hs, tenons, holes: holesOf(sp) };
  });
  // Poteaux : faces dans l'ordre du tour (vu de dessus, sens trigonométrique pour un tournant à droite).
  const mortise = (idx: number, end: boolean) => {
    const ts = stringers.find((sp) => isJour(sp) && sp.idx === idx)!.tenons,
      t = end ? ts[ts.length - 1]! : ts[0]!;
    return slot(idx, "limon", t, TENON.fond);
  };
  const slot = (idx: number, of: "limon" | "main courante", t: Tenon, fond: number) => {
    return {
      idx,
      of,
      depth: t.u1 - t.u0 + fond,
      pts: [
        [t.t0 - jeu, t.z0 - jeu],
        [t.t1 + jeu, t.z0 - jeu],
        [t.t1 + jeu, t.z1 + jeu],
        [t.t0 - jeu, t.z1 + jeu],
      ] as Pt[],
    };
  };
  // Garde-corps : main courante au-dessus des limons de jour, assemblée dans le poteau qui monte la recevoir.
  const rail = railing({
    p,
    quart,
    jour: stringers.filter((sp) => sp.side === "in"),
    cum: inner.cum,
    noseS: nosesIn.xs,
    noseZ: nosesIn.zs,
    mpD,
  });
  const mcMortise = (idx: number, end: boolean) => {
    const ts = rail?.handrails.find((r) => r.idx === idx)?.tenons;
    const t = ts?.length ? (end ? ts[ts.length - 1] : ts[0]) : undefined;
    return t ? [slot(idx, "main courante", t, GC.fond)] : [];
  };
  // Mortaise d'un limon de jour qui arrive par l'autre bout de la face du fond (poteau unique) : vue de la face,
  // son épaisseur se compte depuis l'autre arête.
  const across = (m: ReturnType<typeof slot>, w: number) => ({
    ...m,
    pts: m.pts.map(([u, z]): Pt => [w - u, z]).reverse(),
  });
  // Le poteau monte recevoir la main courante : dessus des deux tronçons à leur bout contre le poteau.
  const mcTop = (k0: number, k1: number) =>
    Math.max(
      0,
      ...(rail?.handrails
        .filter((r) => r.tenons.length && (r.idx === k0 || r.idx === k1 + 1))
        .map((r) => r.z0 + r.b * (r.idx === k0 ? r.u1 : r.u0)) ?? []),
    );
  const newels: Newel[] = posts.map(({ k0, k1 }, c) => {
    const K = inner.pts[k0 + 1]!,
      d0 = dirs[k0]!,
      d1 = dirs[k0 + 1]!,
      back = V.sub(K, V.mul(d0, ps)),
      // Largeur le long du jour : la section, ou tout le jour pour le poteau unique.
      w = k1 > k0 ? len[k1]! : ps;
    const fi = postFaces.indexOf(newelFaces[c]![0]!),
      pockets = (i: number) => pk[geoms.length + fi + i]!.pockets;
    const span = V.add(V.mul(d0, ps), V.mul(d1, w));
    const sides =
      k1 > k0
        ? [
            // Les deux limons de jour arrivent sur la face du fond, chacun près de son arête.
            {
              n: V.sub([0, 0], d0),
              o: back,
              dir: d1,
              u0: 0,
              u1: w,
              volee: null,
              pockets: [],
              mortises: [
                mortise(k0, true),
                ...mcMortise(k0, true),
                across(mortise(k1 + 1, false), w),
                ...mcMortise(k1 + 1, false).map((m) => across(m, w)),
              ],
            },
            {
              n: dirs[k1]!,
              o: inner.pts[k1 + 1]!,
              dir: dirs[k1 + 1]!,
              u0: 0,
              u1: ps,
              volee: k1 + 1,
              pockets: pockets(2),
              mortises: [],
            },
            {
              n: V.sub([0, 0], dirs[k1 + 1]!),
              o: K,
              dir: d1,
              u0: 0,
              u1: w,
              volee: k1,
              pockets: pockets(1),
              mortises: [],
            },
          ]
        : [
            {
              n: V.sub([0, 0], d0),
              o: back,
              dir: d1,
              u0: 0,
              u1: ps,
              volee: null,
              pockets: [],
              mortises: [mortise(k0, true), ...mcMortise(k0, true)],
            },
            {
              n: d1,
              o: V.add(K, V.mul(d1, ps)),
              dir: V.sub([0, 0], d0),
              u0: 0,
              u1: ps,
              volee: null,
              pockets: [],
              mortises: [mortise(k0 + 1, false), ...mcMortise(k0 + 1, false)],
            },
            { n: d0, o: K, dir: d1, u0: 0, u1: ps, volee: k0 + 1, pockets: pockets(1), mortises: [] },
          ];
    return {
      k: k0,
      c: V.add(V.sub(K, V.mul(d0, ps / 2)), V.mul(d1, w / 2)),
      sx: Math.abs(span[0]),
      sy: Math.abs(span[1]),
      h: rail ? Math.max(newelTop[c]!, ceil10(mcTop(k0, k1) + GC.tete)) : newelTop[c]!,
      faces: [
        {
          n: V.sub([0, 0], d1),
          o: inner.pts[k0]!,
          dir: d0,
          u0: len[k0]! - ps,
          u1: len[k0]!,
          volee: k0,
          pockets: pockets(0),
          mortises: [],
        },
        ...sides,
      ],
    };
  });
  // Plancher haut, trémie et échappée (voir tremie).
  const { slab, ceil, trePoly, tre, treL, treDims, ech, echCotes, tLmin, tXmin, tYmin } = tremie({
    p,
    C,
    h,
    lines,
    inner,
    outer,
    walkAt,
    rail,
    mpD,
  });

  // Contrôles
  const gInMin = Math.min(...treads.filter((t) => !t.palier).map((t) => t.gIn));
  const blondel = 2 * h + g;
  const pente = (Math.atan2(h, g) * 180) / Math.PI;
  const st: Stair["st"] = {
    ...comfortStatus(h, g),
    gIn: gInMin < CONFORT.gIn.bad ? "bad" : gInMin < CONFORT.gIn.min ? "warn" : "ok",
    ech: echStatus(ech),
  };
  const N = stairNotes(
    {
      p,
      quart,
      tours,
      n,
      nAuto,
      h,
      g,
      Lw,
      rn,
      treads,
      mp,
      hl,
      hlj,
      hljAuto,
      needJ,
      needM,
      rail,
      treL,
      treDims,
      ech,
      echCotes,
      tLmin,
      tXmin,
      tYmin,
      bals,
      paliers,
      blondel,
      pente,
      gInMin,
      st,
      pal,
      runs,
      into,
      last: len[tours]!,
      rMin,
    },
    suggest,
  );

  return {
    ok: true,
    stair: {
      params: p,
      notes: N,
      quart,
      tours,
      n,
      nAuto,
      h,
      g,
      f,
      fAuto,
      Lw,
      T1,
      T2,
      W,
      A,
      B,
      C,
      L,
      H,
      inner,
      outer,
      walkAt,
      lines,
      treads,
      risers,
      stringers,
      rn,
      hl,
      hlj,
      hljAuto,
      needJ,
      needM,
      newels,
      rail,
      mp,
      slab,
      trePoly,
      tre,
      treL,
      tAuto: p.tAuto,
      treDims,
      ceil,
      ech,
      echCotes,
      tLmin,
      tXmin,
      tYmin,
      bal,
      bals,
      paliers,
      blondel,
      pente,
      gInMin,
      st,
    },
  };
}

/** Longueurs côté départ et côté arrivée qui laissent k marches droites avant le tour, à A + B constant :
    la ligne de foulée garde sa longueur, donc le même confort. null si le tour ne peut pas commencer là. */
export function turnLengths(p: Params, k: number): { A: number; B: number } | null {
  const r = compute(p, false);
  if (!r.ok || !r.stair.bal) return null;
  const R = r.stair,
    S = p.A + p.B;
  if (r.stair.bal.a === k) return { A: p.A, B: p.B };
  // Le balancement est centré sur le tournant : on déplace l'angle pour que sa première marche tombe en k.
  const m0 = clamp(Math.round(p.mb), 2, R.n - 1);
  const A0 = p.A + (k + m0 / 2) * R.g - (R.T1 + R.T2) / 2;
  const lo = p.W + p.ps + 100,
    hi = S - lo;
  // Au plus près, par pas de 10 mm : l'extension du balancement peut décaler la première marche.
  for (let d = 0; d <= R.g; d += 10)
    for (const v of d ? [A0 - d, A0 + d] : [A0]) {
      const A = Math.round(v / 10) * 10;
      if (A < lo || A > hi) continue;
      const t = compute({ ...p, A, B: S - A }, false);
      if (t.ok && t.stair.bal?.a === k) return { A, B: S - A };
    }
  return null;
}

/** Nombres de marches droites avant le tour possibles à A + B constant. */
export function turnRange(p: Params): { min: number; max: number } | null {
  const r = compute(p, false);
  if (!r.ok || !r.stair.bal) return null;
  let min = r.stair.bal.a,
    max = min;
  while (min > 0 && turnLengths(p, min - 1)) min--;
  while (max < r.stair.n - 2 && turnLengths(p, max + 1)) max++;
  return { min, max };
}
