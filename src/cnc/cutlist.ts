/* Liste de débit, volume et alertes de fabrication, communs à la page et à la fiche PDF. */
import { ceil10, fmt } from "../core/format";
import { DENSITE } from "../core/params";
import type { Stair, Status } from "../core/stair";
import { oversize, stockVolume, tightBoards, type BoardPart, type CNC, type TreadPart } from "./build";

export interface CutRow {
  name: string;
  q: number;
  L: number;
  l: number;
  e: number;
}

/** Pièces identiques (au mm près) regroupées sur une ligne. */
function group(list: readonly TreadPart[], one: string, many: string, e: number): CutRow[] {
  const m = new Map<string, { L: number; l: number; js: number[] }>();
  list.forEach((it) => {
    const k = `${Math.ceil(it.L)}x${Math.ceil(it.l)}`;
    let g = m.get(k);
    if (!g) m.set(k, (g = { L: Math.ceil(it.L), l: Math.ceil(it.l), js: [] }));
    g.js.push(it.j);
  });
  return [...m.values()].map((g) => ({
    name: `${g.js.length > 1 ? many : one} ${g.js.join(", ")}`,
    L: g.L,
    l: g.l,
    q: g.js.length,
    e,
  }));
}

/** Arrondi au millimètre supérieur, sans compter les erreurs d'arrondi du calcul. */
const up = (v: number) => Math.ceil(v - 1e-6);

/** Liste de débit : limons, marches, contremarches, garde-corps, poteau. */
export function cutRows(cnc: CNC, R: Stair): CutRow[] {
  const p = R.params;
  return [
    ...cnc.boardParts.map((b) => ({
      name: b.name.charAt(0) + b.name.slice(1).toLowerCase(),
      L: Math.ceil(b.L),
      l: Math.ceil(b.l),
      e: p.el,
      q: 1,
    })),
    ...group(
      cnc.treadParts.filter((q) => !q.palier),
      "Marche",
      "Marches",
      p.et,
    ),
    ...cnc.treadParts
      .filter((q) => q.palier)
      .map((q, i, all) => ({
        name: all.length > 1 ? `Palier ${i + 1}` : "Palier",
        q: 1,
        L: Math.ceil(q.L),
        l: Math.ceil(q.l),
        e: p.et,
      })),
    ...(cnc.mpPart ? [{ name: "Marche palière", q: 1, L: up(cnc.mpPart.L), l: up(cnc.mpPart.l), e: p.mpE }] : []),
    ...group(cnc.riserParts, "Contremarche", "Contremarches", p.ecm),
    ...(cnc.rail
      ? [
          ...cnc.rail.handrailParts.map((q) => ({ name: q.name, q: 1, L: Math.ceil(q.L), l: p.mcH, e: p.mcL })),
          ...(R.rail?.type === "balustres"
            ? group(cnc.rail.postParts, "Balustre", "Balustres", p.bs)
            : group(cnc.rail.postParts, "Montant", "Montants", p.bs)),
          ...group(cnc.rail.railParts, "Lisse", "Lisses", p.bs),
        ]
      : []),
    ...cnc.postParts.map((q) => ({
      name: cnc.postParts.length > 1 ? `Poteau ${q.j}` : "Poteau",
      q: 1,
      L: Math.ceil(q.L),
      l: q.l,
      e: q.e,
    })),
  ];
}

const ESSENCE_LABEL = { chene: "chêne", hetre: "hêtre", frene: "frêne", sapin: "sapin", noyer: "noyer" } as const;

/** Nombre pour un tableur français : virgule décimale, sans séparateur de milliers. */
const num = (v: number, d: number) =>
  v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d, useGrouping: false });

/** Cellule entre guillemets si elle contient le séparateur, un guillemet ou un retour à la ligne. */
const cell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Liste de débit au format CSV (séparateur point-virgule, décimales à la française), avec une ligne de total.
    Le volume de chaque ligne est pris sur les cotes brutes affichées, quantité comprise. */
export function cutListCSV(cnc: CNC, R: Stair): string {
  const ess = ESSENCE_LABEL[R.params.ess];
  const essence = ess.charAt(0).toUpperCase() + ess.slice(1);
  const rows = cutRows(cnc, R).map((r) => ({ ...r, v: (r.q * r.L * r.l * r.e) / 1e9 }));
  const q = rows.reduce((t, r) => t + r.q, 0),
    v = rows.reduce((t, r) => t + r.v, 0);
  const lines: string[][] = [
    ["Pièce", "Essence", "Épaisseur (mm)", "Longueur (mm)", "Largeur (mm)", "Quantité", "Volume (m³)"],
    ...rows.map((r) => [r.name, essence, num(r.e, 1), num(r.L, 1), num(r.l, 1), String(r.q), num(r.v, 4)]),
    ["Total", "", "", "", "", String(q), num(v, 4)],
  ];
  return lines.map((l) => l.map(cell).join(";")).join("\n");
}

/** Volume brut et poids approximatif selon l'essence. */
export function volumeText(cnc: CNC, R: Stair): string {
  const v = stockVolume(cnc, R),
    ess = R.params.ess;
  return `Volume brut débité : ${fmt(v, 3)} m³ de ${ESSENCE_LABEL[ess]}, soit environ ${fmt(Math.round((v * DENSITE[ess]) / 5) * 5)} kg (${fmt(DENSITE[ess])} kg/m³).`;
}

/** Alerte si des logements débordent sous le bord d'un limon. */
export function stringerFitNote(boards: readonly BoardPart[], R: Stair): [Status, string] {
  const tight = tightBoards(boards);
  const fixes = [
    R.hl < R.needM - 0.5 && `passez la hauteur de limon à ${fmt(ceil10(R.needM))} mm`,
    R.quart && R.hlj < R.needJ - 0.5 && `passez le limon de jour à ${fmt(R.hljAuto)} mm`,
  ].filter(Boolean);
  return tight.length
    ? [
        "warn",
        `Des logements débordent sous le bord du limon (${tight.map((b) => b.name.toLowerCase()).join(", ")}) : ${fixes.join(" et ")}.`,
      ]
    : [
        "ok",
        `Tous les logements tiennent dans les limons, avec au moins 20 mm de bois dessous${R.quart ? ` (limon de jour de ${fmt(R.hlj)} mm)` : ""}.`,
      ];
}

/** Alertes si des pièces dépassent les plateaux disponibles. */
export function stockNotes(cnc: CNC, R: Stair): [Status, string][] {
  const { pL, pW } = R.params;
  const big = oversize(cnc, pL, pW);
  const plateau = `plateau de ${fmt(pL)} × ${fmt(pW)} mm`;
  const list = (ps: readonly TreadPart[]) => ps.map((q) => q.j).join(", ");
  const notes: string[] = [];
  const glued = (ps: readonly TreadPart[], one: string, many: string) => {
    const wide = ps.filter((q) => q.l > pW + 0.5),
      long = ps.filter((q) => q.L > pL + 0.5);
    if (wide.length)
      notes.push(
        `${wide.length > 1 ? many : one} ${list(wide)} plus ${one === "Marche" ? "profonde" : "haute"}${wide.length > 1 ? "s" : ""} que le plateau (jusqu'à ${fmt(Math.ceil(Math.max(...wide.map((q) => q.l))))} mm pour ${fmt(pW)}) : à reconstituer en lames collées, fil le long du nez.`,
      );
    if (long.length)
      notes.push(
        `${long.length > 1 ? many : one} ${list(long)} plus longue${long.length > 1 ? "s" : ""} que le plateau (jusqu'à ${fmt(Math.ceil(Math.max(...long.map((q) => q.L))))} mm pour ${fmt(pL)}).`,
      );
  };
  glued(
    big.treads.filter((q) => !q.palier),
    "Marche",
    "Marches",
  );
  // Palier : un plateau de l'épaisseur des marches, toujours plus profond qu'une planche.
  const pals = cnc.treadParts.filter((q) => q.palier && q.l > pW + 0.5);
  if (pals.length)
    notes.push(
      `${pals.length > 1 ? "Paliers" : "Palier"} de ${pals.map((q) => `${fmt(Math.ceil(q.L))} × ${fmt(Math.ceil(q.l))}`).join(" et ")} mm : plateau collé à chant, fil le long du nez, logé comme une marche.`,
    );
  glued(big.risers, "Contremarche", "Contremarches");
  const mp = cnc.mpPart;
  if (mp && (mp.L > pL + 0.5 || mp.l > pW + 0.5))
    notes.push(
      `Marche palière (${fmt(Math.ceil(mp.L))} × ${fmt(Math.ceil(mp.l))} mm) plus grande que le ${plateau} : à reconstituer en lames collées, fil le long du nez.`,
    );
  big.boards.forEach((b) =>
    notes.push(
      `${b.name.charAt(0)}${b.name.slice(1).toLowerCase()} (${fmt(Math.ceil(b.L))} × ${fmt(Math.ceil(b.l))} mm) plus grand que le ${plateau} : à abouter ou à débiter dans un plateau plus grand.`,
    ),
  );
  return notes.length
    ? notes.map((t): [Status, string] => ["warn", t])
    : [["ok", `Toutes les pièces tiennent dans un ${plateau}.`]];
}
