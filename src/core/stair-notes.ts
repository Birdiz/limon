/* Notes de contrôle de l'escalier et corrections qu'elles proposent.
   Les types viennent de stair-types.ts. Reste un cycle d'appel avec stair.ts, réel : compute appelle stairNotes,
   et la recherche de marches balancées rappelle compute pour essayer chaque réglage. Il ne joue qu'à l'exécution,
   jamais au chargement des modules. */
import { ceil10, fmt } from "./format";
import type { Params } from "./params";
import { BOIS_SOUS_LOGEMENT } from "./pockets";
import { CONFORT, comfortStatus, compute, echWhere, palierLayout, pickN } from "./stair";
import type { Balance, Fix, Note, PalierLayout, Stair } from "./stair-types";

const comfortable = (H: number, Lw: number, n: number) =>
  Object.values(comfortStatus(H / n, Lw / (n - 1))).every((s) => s === "ok");

/** Longueur de ligne de foulée confortable la plus proche de Lw (pas de 10 mm, la plus courte à égalité),
    avec le nombre de hauteurs imposé ou, à défaut, celui du calcul automatique. */
export function comfortableRun(H: number, Lw: number, nFixed?: number): { Lw: number; n: number } | null {
  for (let d = 0; d <= 6000; d += 10)
    for (const v of d ? [Lw - d, Lw + d] : [Lw]) {
      if (v < 500) continue;
      const n = nFixed ?? pickN(H, v);
      if (comfortable(H, v, n)) return { Lw: v, n };
    }
  return null;
}

/** Réglage de longueur qui rend la hauteur et le giron confortables : texte de la note et correction. */
function runFix(p: Params, quart: boolean, Lw: number, n: number, nAuto: number): [string, Fix] | null {
  if (!p.nAuto && comfortable(p.H, Lw, nAuto))
    return [
      `Le calcul automatique (${nAuto} hauteurs) rend l'escalier confortable sans changer les longueurs.`,
      { set: { nAuto: true }, label: "Revenir en automatique" },
    ];
  const run = (!p.nAuto && comfortableRun(p.H, Lw, n)) || comfortableRun(p.H, Lw);
  if (!run) return null;
  const d = run.Lw - Lw;
  const detail = `soit ${run.n} hauteurs de ${fmt(p.H / run.n, 1)} mm et un giron de ${fmt(run.Lw / (run.n - 1), 1)} mm`;
  const auto = run.n !== n ? { nAuto: true } : {};
  if (!quart)
    return [
      `Reculement conseillé : ${fmt(run.Lw)} mm, ${detail}.`,
      { set: { L: run.Lw, ...auto }, label: `Passer à ${fmt(run.Lw)} mm` },
    ];
  // En quart tournant, la ligne de foulée suit la longueur côté départ (ou côté arrivée si le départ est trop court).
  const key = p.A + d > p.W + 1 ? "A" : "B";
  const v = p[key] + d;
  if (!(v > p.W + 1)) return null;
  return [
    `Longueur côté ${key === "A" ? "départ" : "arrivée"} conseillée : ${fmt(v)} mm, ${detail}.`,
    { set: { [key]: v, ...auto }, label: `Passer à ${fmt(v)} mm` },
  ];
}

/** Longueur côté arrivée qui rend confortable un escalier à palier : elle donne le giron. */
function palierFix(p: Params, runs: readonly number[], last: number, rMin: number, n: number): [string, Fix] | null {
  const ok = (L: PalierLayout | null): L is PalierLayout =>
    !!L && Object.values(comfortStatus(p.H / L.n, L.g)).every((s) => s === "ok");
  const auto = palierLayout(p.H, runs, last, rMin);
  if (!p.nAuto && ok(auto))
    return [
      `Le calcul automatique (${auto.n} hauteurs) rend l'escalier confortable sans changer les longueurs.`,
      { set: { nAuto: true }, label: "Revenir en automatique" },
    ];
  for (const nFixed of p.nAuto ? [undefined] : [n, undefined])
    for (let d = 10; d <= 3000; d += 10)
      for (const v of [p.B - d, p.B + d]) {
        if (!(v > p.W + 1)) continue;
        const L = palierLayout(p.H, runs, last + v - p.B, rMin, nFixed);
        if (!ok(L)) continue;
        const auto = nFixed == null && !p.nAuto ? { nAuto: true } : {};
        return [
          `Longueur côté arrivée conseillée : ${fmt(v)} mm, soit ${L.n} hauteurs de ${fmt(p.H / L.n, 1)} mm et un giron de ${fmt(L.g, 1)} mm.`,
          { set: { B: v, ...auto }, label: `Passer à ${fmt(v)} mm` },
        ];
      }
  return null;
}

/** Ce que les notes lisent de l'escalier. Pour l'escalier à palier : pal, volées qui montent à un palier (runs, into :
    leurs numéros), volée d'arrivée (last), reste minimal (rMin). */
export interface NotesCtx extends Pick<
  Stair,
  | "quart"
  | "tours"
  | "n"
  | "nAuto"
  | "h"
  | "g"
  | "Lw"
  | "rn"
  | "hl"
  | "hlj"
  | "hljAuto"
  | "needJ"
  | "needM"
  | "rail"
  | "treL"
  | "treDims"
  | "ech"
  | "echCotes"
  | "tLmin"
  | "tXmin"
  | "tYmin"
  | "bals"
  | "paliers"
  | "blondel"
  | "pente"
  | "gInMin"
  | "st"
> {
  p: Params;
  pal: boolean;
  runs: number[];
  into: number[];
  last: number;
  rMin: number;
}

/** Notes de l'escalier ; suggest ajoute les corrections chiffrées (calculs supplémentaires). */
export function stairNotes(ctx: NotesCtx, suggest: boolean): Note[] {
  const { p, quart, tours, n, nAuto, h, g, Lw, rn, hl, hlj, hljAuto, needJ, needM, rail } = ctx;
  const { treL, treDims, ech, echCotes, tLmin, tXmin, tYmin, bals, paliers, blondel, pente, gInMin, st } = ctx;
  const { pal, runs, into, last, rMin } = ctx;
  const { W } = p,
    U = tours === 2;
  const N: Note[] = [];
  if (st.h !== "ok")
    N.push([
      st.h,
      h > CONFORT.h.max
        ? `Marches hautes (${fmt(h, 1)} mm) : ajoutez une hauteur ou allongez le reculement.`
        : `Marches basses (${fmt(h, 1)} mm) : retirez une hauteur.`,
    ]);
  if (st.g !== "ok")
    N.push([
      st.g,
      g < CONFORT.g.min
        ? `Giron court (${fmt(g)} mm) sur la ligne de foulée : il manque de la longueur au sol.`
        : `Giron long (${fmt(g)} mm) : ajoutez une hauteur pour un pas plus naturel.`,
    ]);
  if (st.bl !== "ok")
    N.push([
      st.bl,
      `Loi de Blondel hors plage : 2h + g = ${fmt(blondel)} mm, visez ${CONFORT.blondel.min} à ${CONFORT.blondel.max} mm.`,
    ]);
  if (st.pente !== "ok") N.push([st.pente, `Escalier raide (${fmt(pente, 1)}°).`]);
  if (suggest && [st.h, st.g, st.bl, st.pente].some((s) => s !== "ok")) {
    const fix = pal ? palierFix(p, runs, last, rMin, n) : runFix(p, quart, Lw, n, nAuto);
    if (fix) N.push(["info", fix[0], fix[1]]);
  }
  if (quart && st.gIn !== "ok") {
    // Plus petit nombre de marches balancées qui garde 100 mm au jour.
    let mb: number | null = null;
    for (let m = Math.max(p.mb, 1) + 1; suggest && m <= 12 && mb == null; m++) {
      const r = compute({ ...p, mb: m }, false);
      if (r.ok && r.stair.gInMin >= CONFORT.gIn.min) mb = m;
    }
    N.push([
      st.gIn,
      `Giron côté jour de ${fmt(gInMin)} mm seulement : augmentez le nombre de marches balancées${mb ? ` (${mb} suffisent)` : ""}.`,
      mb ? { set: { mb }, label: `Passer à ${mb}` } : undefined,
    ]);
  }
  bals.forEach((z, i) => {
    if (z.extended)
      N.push([
        "warn",
        `Balancement étendu à ${z.m} marches pour couvrir tout le ${tours > 1 ? `${i ? "second" : "premier"} ` : ""}tournant.`,
      ]);
  });
  const prMin = bals.reduce<Balance | null>((m, z) => (!m || z.pr < m.pr ? z : m), null);
  if (prMin && prMin.pr + 0.01 < prMin.want)
    N.push(["warn", `Progressivité limitée à ${fmt(prMin.pr * 100)} % pour garder au moins 100 mm au jour.`]);
  // Reste de la division des girons, ajouté à la profondeur de chaque palier : la cote qui l'annule.
  paliers.forEach(({ reste }, q) => {
    const key = into[q] === 1 ? "C" : "A",
      v = Math.ceil(p[key] - (reste - rMin) - 1e-6);
    if (v >= p[key]) return;
    N.push([
      "info",
      `${paliers.length > 1 ? `Palier ${q + 1}` : "Palier"} de ${fmt(W + reste)} mm de profondeur : le reste de la division des girons s'y ajoute. Longueur côté ${key === "A" ? "départ" : "fond"} de ${fmt(v)} mm pour le palier le plus court.`,
      { set: { [key]: v }, label: `Passer à ${fmt(v)} mm` },
    ]);
  });
  if (p.rn > p.et / 2 + 0.01)
    N.push(["info", `Rayon du nez ramené à ${fmt(rn, 1)} mm, la moitié de l'épaisseur de marche (demi-rond).`]);
  if (p.cm && rn > p.deb)
    N.push([
      "warn",
      `Le rayon du nez (${fmt(rn)} mm) dépasse le débord (${fmt(p.deb)} mm) : l'arrondi du dessous mord sur la contremarche.`,
    ]);
  if (hl < needM - 0.5)
    N.push([
      "warn",
      `Limon${quart ? " de mur" : ""} trop étroit : ${fmt(hl)} mm pour des marches de ${fmt(h)} mm, prévoyez au moins ${fmt(ceil10(needM))} mm pour garder ${BOIS_SOUS_LOGEMENT} mm de bois sous les logements.`,
      { set: { hl: ceil10(needM) }, label: `Passer à ${fmt(ceil10(needM))} mm` },
    ]);
  if (quart && hlj < needJ - 0.5)
    N.push([
      "warn",
      `Limon de jour trop étroit : ${fmt(hlj)} mm, les logements du tournant demandent au moins ${fmt(hljAuto)} mm.`,
      { set: { hljAuto: true }, label: `Passer à ${fmt(hljAuto)} mm` },
    ]);
  if (ech && st.ech !== "ok") {
    const fixes = U
      ? [
          tYmin != null && `allongez la trémie côté arrivée à ${fmt(tYmin)} mm`,
          tXmin != null && `${tYmin != null ? "élargissez-la" : "élargissez la trémie"} côté fond à ${fmt(tXmin)} mm`,
        ]
          .filter(Boolean)
          .join(" ou ")
      : quart
        ? [
            tYmin != null && `élargissez la trémie côté départ à ${fmt(tYmin)} mm`,
            tXmin != null && `${tYmin != null ? "allongez-la" : "allongez la trémie"} côté arrivée à ${fmt(tXmin)} mm`,
          ]
            .filter(Boolean)
            .join(" ou ")
        : tLmin != null
          ? `allongez la trémie à ${fmt(tLmin)} mm`
          : "";
    const set: Partial<Params> | null = quart
      ? tYmin != null
        ? { tY: tYmin }
        : tXmin != null
          ? { tX: tXmin }
          : null
      : tLmin != null
        ? { tL: tLmin }
        : null;
    // Côté le plus bas, et la ligne de foulée pour comparer quand ce n'est pas elle.
    const where = echWhere(ech, echCotes),
      fw = echCotes.foulee;
    const walk = fw && Math.abs(fw.c - ech.c) >= 0.5 ? ` (${fmt(fw.c)} mm sur la ligne de foulée)` : "";
    N.push([
      st.ech,
      `Échappée de ${fmt(ech.c)} mm${where ? ` ${where}` : ""}, au-dessus de la marche ${ech.j}${walk}${fixes ? ` : pour 2 000 mm, ${fixes}` : ""}.`,
      set ? { set, label: `Passer à ${fmt(Object.values(set)[0] as number)} mm` } : undefined,
    ]);
  } else if (p.tAuto) {
    N.push([
      "info",
      U
        ? `Trémie${treL ? " en U" : ""} à prévoir pour 2 000 mm d'échappée : ${fmt(treDims.tY)} mm côté arrivée, sur toute la largeur (${fmt(treDims.tX)} mm)${treL ? `, branches de ${fmt(treDims.tbD)} mm` : ""}.`
        : quart
          ? `Trémie${treL ? " en L" : ""} à prévoir pour 2 000 mm d'échappée : ${fmt(treDims.tY)} mm côté départ, sur tout le côté arrivée (${fmt(treDims.tX)} mm)${treL ? `, branches de ${fmt(treDims.tbD)} mm` : ""}.`
          : `Trémie à prévoir pour 2 000 mm d'échappée : ${fmt(treDims.tL)} mm de long.`,
    ]);
  } else if (quart ? tYmin != null : tLmin != null) {
    N.push([
      "info",
      U
        ? `Trémie minimale pour 2 000 mm d'échappée : ${fmt(tYmin!)} mm côté arrivée, avec ${fmt(p.tX)} mm côté fond.`
        : quart
          ? `Trémie minimale pour 2 000 mm d'échappée : ${fmt(tYmin!)} mm côté départ, avec ${fmt(p.tX)} mm côté arrivée.`
          : `Trémie minimale pour 2 000 mm d'échappée : ${fmt(tLmin!)} mm de long.`,
    ]);
  }
  if (rail) {
    const what =
      rail.type === "balustres"
        ? `${rail.posts.length} balustres`
        : `${rail.posts.length} montants et ${rail.rails.length} lisses`;
    N.push([
      "info",
      `Garde-corps${quart ? "" : " côté limon droit"} : main courante de ${fmt(rail.hMin)} à ${fmt(rail.hMax)} mm au-dessus des nez, ${what}, écart libre de ${fmt(rail.gap)} mm au plus.`,
    ]);
    if (rail.railLow < 0)
      N.push([
        "warn",
        "La lisse basse touche le limon là où il monte plus vite que la main courante (tournant) : préférez des balustres.",
        { set: { gc: "balustres" }, label: "Passer aux balustres" },
      ]);
  }
  if (!p.nAuto && n !== nAuto && !N.some((x) => x[2]?.set.nAuto))
    N.push([
      "info",
      `Le calcul automatique proposerait ${nAuto} hauteurs.`,
      { set: { nAuto: true }, label: "Revenir en automatique" },
    ]);
  if (!N.some((x) => x[0] === "warn" || x[0] === "bad"))
    N.unshift(["ok", "Escalier confortable : tout est dans les règles."]);
  return N;
}
