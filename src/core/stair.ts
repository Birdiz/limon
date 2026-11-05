/* Calcul de l'escalier.
   Repère plan (mm) : départ en y = 0, montée vers +y, limon extérieur en x = 0, jour (intérieur) en x = W.
   Tournants calculés à droite (2e volée vers +x, 3e vers −y en double quart) ; la version gauche est un miroir. */
import { CONFORT, comfortStatus } from "./confort";
import { fmt } from "./format";
import { ECHAPPEE, ECHAPPEE_MIN, type Headroom } from "./headroom";
import { nezCote } from "./nez";
import { COTE_MAX, H_MAX, TOURS, isDemi, jourUnPoteau, type NumericKey, type Params } from "./params";
import { railing } from "./railing";
import { flights } from "./stair-flights";
import { newelPosts, newels } from "./stair-newels";
import { balance, heights, noseLines } from "./stair-noses";
import { stairNotes } from "./stair-notes";
import { stringerLines, stringerPieces } from "./stair-stringers";
import { RAINURES_MAX, treadsAndRisers } from "./stair-treads";
import { tremie } from "./tremie";
import type { ComputeResult, EchCote, InputError, Stair, Status } from "./stair-types";
import { clamp } from "./vec";

/* Les types du modèle vivent dans stair-types.ts ; ils restent importables d'ici. */
export type * from "./stair-types";
export type { Headroom } from "./headroom";
export { ECHAPPEE, ECHAPPEE_MIN };
/* Constantes et calculs des étapes, gardés importables d'ici. */
export { CONFORT, comfortStatus } from "./confort";
export { FOULEE_MAX } from "./stair-flights";
export { palierLayout, pickN } from "./stair-noses";
export { LIFT, PERCAGE, TENON } from "./stair-stringers";
export { RAINURES_MAX, RAINURE_ARRET, RAINURE_MIN } from "./stair-treads";

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

/* Calcul en étapes, chacune dans son fichier, ses entrées et sorties explicites :
   volées et ligne de foulée (stair-flights) → hauteurs, balancement, lignes de nez (stair-noses) → marches et
   contremarches (stair-treads) → limons (stair-stringers) → faces des poteaux (stair-newels) → logements, tenons
   (stair-stringers) → garde-corps (railing) → poteaux (stair-newels) → trémie et échappée (tremie) → contrôles
   et notes (stair-notes). Une étape qui bute renvoie son refus, rendu tel quel. */

/** Calcule l'escalier ; suggest ajoute aux notes les corrections chiffrées (calculs supplémentaires). */
export function compute(p: Params, suggest = true): ComputeResult {
  const tours = TOURS[p.forme],
    quart = tours > 0;
  const errors = validate(p, tours);
  if (errors.length) return { ok: false, errors };
  const { H, W, A, B, L } = p;

  const fl = flights(p);
  const { C, f, fAuto, inner, outer, walkAt, len, T1, T2, Lw } = fl;
  const he = heights(p, fl);
  if ("errors" in he) return he;
  const { pal, into, runs, rMin, n, nAuto, h, g, paliers } = he;
  const { s, bals } = balance(p, fl, he);
  const bal = bals[0] ?? null;
  const lines = noseLines(fl, he.ts, s);
  if ("errors" in lines) return lines;
  const tr = treadsAndRisers(p, fl, he, bals, lines);
  if ("errors" in tr) return tr;
  const { rn, treads, risers, mpD, mp } = tr;

  const sl = stringerLines(p, fl, he, lines, mpD);
  const np = newelPosts(p, fl, sl.zIn);
  const sg = stringerPieces(p, fl, lines, tr, sl, np.postFaces);
  if ("errors" in sg) return sg;
  const { stringers, hlj, hljAuto, needJ, needM } = sg;
  const hl = p.hl;
  // Garde-corps : main courante au-dessus des limons de jour, assemblée dans le poteau qui monte la recevoir.
  const rail = railing({
    p,
    quart,
    jour: stringers.filter((sp) => sp.side === "in"),
    cum: inner.cum,
    noseS: sl.nosesIn.xs,
    noseZ: sl.nosesIn.zs,
    mpD,
  });
  const nw = newels(p, fl, np, stringers, sg.facePockets, rail);
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
      newels: nw,
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
