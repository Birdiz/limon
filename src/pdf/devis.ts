import type { Client, Devis, Saisie } from "../core/devis";
import { fmt } from "../core/format";
import type { Params } from "../core/params";
import { planShapes } from "../core/plan-shapes";
import { sideShapes } from "../core/side-shapes";
import type { Stair } from "../core/stair";
import { ESSENCE_LABEL, FORME_LABEL } from "../core/summary";
import type { Entreprise } from "../core/tarifs";
import { C, CW, M, PLAN_STYLE, SIDE_STYLE, drawShapes, filigrane, frame, heading } from "./fiche";
import { A4, PdfDoc, wrap, type Page, type TextStyle } from "./pdf";

/*
 * Devis remis au client : l'entreprise, le client, les lignes, la TVA et les totaux, les mentions, le cadre
 * « bon pour accord », puis en annexe le plan et la vue de l'escalier. Jamais la liste de débit, les fichiers pour
 * la machine ni la marge : ils restent à l'atelier. Les mentions sont à faire relire (juriste ou CAPEB) avant la
 * mise en ligne.
 */

export interface DevisPdf {
  entreprise: Entreprise;
  client: Client;
  saisie: Saisie;
  chiffrage: Devis;
  /** Nom de l'escalier. */
  nom: string;
  params: Params;
  /** Escalier calculé sur `params`, pour l'annexe ; null si ses réglages ne se calculent pas. */
  stair: Stair | null;
  /** null pour un brouillon : le numéro est donné à la remise. */
  numero: string | null;
  version: number;
  /** Dates déjà mises en forme (« 31/10/2026 »). */
  date: string;
  /** Durée de validité en jours, et dernier jour, s'ils sont connus. */
  validite: number | null;
  jusquAu: string | null;
  /** Capture de la vue 3D en JPEG, si elle est disponible. */
  vue3d?: { data: Uint8Array; w: number; h: number };
}

/** Texte de la mention de TVA à taux réduit, certifiée par le client depuis la suppression de l'attestation. */
export const TVA_REDUITE =
  "En signant ce devis, le client certifie que les travaux portent sur des locaux à usage d'habitation achevés depuis plus de deux ans, et qu'ils n'ont pas pour effet, sur une période de deux ans au plus, de concourir à la production d'un immeuble neuf ni d'augmenter de plus de 10 % la surface de plancher des locaux existants (article 279-0 bis du code général des impôts).";

const eur = (v: number) => `${fmt(v, 2)}\u00a0€`;
const qte = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const taux = (t: number) => `${fmt(t, t % 1 ? 1 : 0)}\u00a0%`;
/** Texte sur plusieurs lignes, retours à la ligne de la saisie gardés. */
const lines = (s: string, size: number, w: number, bold = false) =>
  s.split("\n").flatMap((l) => (l.trim() ? wrap(l.trim(), size, w, bold) : []));
/** Texte saisi sur plusieurs lignes, remis sur une seule. */
const flat = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");

/** Bas de la zone écrite, au-dessus du pied de page. */
const BOTTOM = A4.h - 64;
const INK: TextStyle = { size: 9, color: C.ink };
const MUTED: TextStyle = { size: 9, color: C.muted };

/** Colonnes du tableau des lignes : bords droits des nombres, la désignation prend le reste. */
const T_TOT = M + CW - 6,
  T_TVA = T_TOT - 76,
  T_PU = T_TVA - 40,
  T_Q = T_PU - 104,
  T_DES = T_Q - 52 - (M + 6);

export function devisPDF(o: DevisPdf): Uint8Array<ArrayBuffer> {
  const E = o.entreprise,
    D = o.chiffrage;
  const brouillon = o.numero === null;
  const ref = brouillon ? "Devis (brouillon)" : `Devis n° ${o.numero}${o.version > 1 ? ` · version ${o.version}` : ""}`;
  const doc = new PdfDoc(
    `${brouillon ? "Devis (brouillon)" : `Devis ${o.numero}`}${o.client.nom ? ` · ${o.client.nom}` : ""}`,
  );
  const pages: Page[] = [];
  let pg!: Page;
  let y = 0;

  const newPage = () => {
    pg = doc.page();
    pages.push(pg);
    y = 50;
  };
  /** Page suivante, avec un rappel du devis en tête. */
  const suite = () => {
    newPage();
    pg.text(M, 46, E.nom, { size: 9, bold: true, color: C.ink });
    pg.text(A4.w - M, 46, `${ref} · suite`, { size: 8.5, color: C.muted, anchor: "end" });
    pg.path(
      [
        [M, 54],
        [A4.w - M, 54],
      ],
      { stroke: C.rule, width: 0.6 },
    );
    y = 76;
  };
  /** Assez de place pour h points, sinon page suivante ; vrai si la page a changé. */
  const room = (h: number): boolean => {
    if (y + h <= BOTTOM) return false;
    suite();
    return true;
  };
  /** Lignes posées à partir de l'ordonnée courante. */
  const put = (x: number, ls: string[], st: TextStyle, lh: number) => {
    ls.forEach((l, i) => pg.text(x, y + i * lh, l, st));
    y += ls.length * lh;
  };

  /* ---------- En-tête : l'entreprise, le devis ---------- */
  newPage();
  const colW = CW * 0.56;
  pg.text(M, 60, E.nom || "Votre entreprise", { size: 15, bold: true, color: E.nom ? C.ink : C.muted });
  y = 76;
  const ident = [E.forme, E.capital && `au capital de ${E.capital}`].filter(Boolean).join(" ");
  const contact = [E.telephone && `Tél. ${E.telephone}`, E.email].filter(Boolean).join(" · ");
  put(M, [ident, ...lines(E.adresse, 9, colW), contact].filter(Boolean), MUTED, 11.5);
  const yLeft = y;

  pg.text(A4.w - M, 66, "DEVIS", { size: 26, bold: true, color: C.chalk, anchor: "end" });
  const right = [
    brouillon ? "Brouillon : numéro donné à la remise" : `N° ${o.numero}`,
    ...(o.version > 1 ? [`Version ${o.version}`] : []),
    `Date : ${o.date}`,
    ...(o.jusquAu ? [`Valable jusqu'au ${o.jusquAu}`] : o.validite ? [`Valable ${o.validite} jours`] : []),
  ];
  right.forEach((l, i) =>
    pg.text(A4.w - M, 84 + i * 12.5, l, { size: 9.5, bold: i === 0 && !brouillon, color: C.ink, anchor: "end" }),
  );
  y = Math.max(yLeft, 84 + right.length * 12.5) + 10;
  pg.path(
    [
      [M, y],
      [A4.w - M, y],
    ],
    { stroke: C.ink, width: 1.4 },
  );
  y += 18;

  /* ---------- Client et chantier ---------- */
  const boxX = M + CW / 2 + 8,
    boxW = CW / 2 - 8;
  const cl = lines(o.client.adresse, 9.5, boxW - 20);
  const boxH = 46 + cl.length * 12;
  pg.rect(boxX, y, boxW, boxH, { stroke: C.rule, width: 0.6 });
  heading(pg, boxX + 10, y + 16, "Client");
  pg.text(boxX + 10, y + 32, o.client.nom || "—", { size: 10.5, bold: true, color: C.ink });
  cl.forEach((l, i) => pg.text(boxX + 10, y + 46 + i * 12, l, { size: 9.5, color: C.ink }));
  const top = y;
  heading(pg, M, y + 16, "Adresse du chantier");
  y += 32;
  put(
    M,
    o.client.chantier ? lines(o.client.chantier, 9.5, CW / 2 - 16) : ["Celle du client"],
    { size: 9.5, color: C.ink },
    12,
  );
  y = Math.max(y, top + boxH) + 20;

  /* ---------- Objet ---------- */
  const p = o.params;
  heading(pg, M, y, "Objet");
  y += 15;
  const objet = `${o.saisie.pose ? "Fabrication et pose" : "Fabrication"} d'un escalier ${FORME_LABEL[p.forme].toLowerCase()} en ${ESSENCE_LABEL[p.ess].toLowerCase()} : « ${o.nom} »`;
  put(M, wrap(objet, 10.5, CW, true), { size: 10.5, bold: true, color: C.ink }, 13);
  const R = o.stair;
  if (R) {
    const desc = `${R.n} hauteurs de ${fmt(R.h, 1)} mm pour ${fmt(R.H)} mm à monter, giron de ${fmt(R.g, 1)} mm, emmarchement de ${fmt(R.W)} mm. Plan et vue de l'escalier en annexe.`;
    put(M, wrap(desc, 9, CW), MUTED, 11.5);
  }
  y += 14;

  /* ---------- Lignes ---------- */
  const head = () => {
    pg.rect(M, y, CW, 16, { fill: C.paper });
    const h: TextStyle = { size: 7, bold: true, color: C.muted };
    pg.text(M + 6, y + 11, "DÉSIGNATION", h);
    pg.text(T_Q, y + 11, "QTÉ", { ...h, anchor: "end" });
    pg.text(T_PU, y + 11, "PRIX UNIT. HT", { ...h, anchor: "end" });
    pg.text(T_TVA, y + 11, "TVA", { ...h, anchor: "end" });
    pg.text(T_TOT, y + 11, "TOTAL HT", { ...h, anchor: "end" });
    y += 16;
  };
  head();
  for (const l of D.lignes) {
    const des = wrap(l.designation || "—", 9, T_DES);
    const h = 8 + des.length * 11;
    if (room(h)) head();
    const b = y + 12;
    des.forEach((s, i) => pg.text(M + 6, b + i * 11, s, INK));
    pg.text(T_Q, b, l.q === null ? "—" : qte(l.q), { ...INK, anchor: "end" });
    pg.text(T_Q + 5, b, l.unite, MUTED);
    pg.text(T_PU, b, l.pu === null ? "—" : eur(l.pu), { ...INK, anchor: "end" });
    pg.text(T_TVA, b, taux(l.tva), { ...INK, anchor: "end" });
    pg.text(T_TOT, b, l.total === null ? "à compléter" : eur(l.total), {
      ...INK,
      color: l.total === null ? C.warn : C.ink,
      anchor: "end",
    });
    y += h;
    pg.path(
      [
        [M, y],
        [M + CW, y],
      ],
      { stroke: C.rule, width: 0.4 },
    );
  }
  y += 12;

  /* ---------- Totaux ---------- */
  const rows: [string, string, boolean][] = [
    ...(D.remise
      ? ([
          ["Total des lignes HT", eur(D.totalLignes), false],
          ["Remise", `– ${eur(D.remise)}`, false],
        ] as [string, string, boolean][])
      : []),
    ["Total HT", eur(D.totalHT), true],
    ...D.tva.map((t) => [`TVA ${taux(t.taux)} sur ${eur(t.base)}`, eur(t.montant), false] as [string, string, boolean]),
  ];
  room(rows.length * 15 + 34);
  const tw = 250,
    tx = M + CW - tw;
  for (const [k, v, b] of rows) {
    pg.text(tx, y + 10, k, { size: 9.5, bold: b, color: b ? C.ink : C.muted });
    pg.text(M + CW, y + 10, v, { size: 9.5, bold: b, color: C.ink, anchor: "end" });
    y += 15;
  }
  pg.rect(tx - 8, y + 2, tw + 8, 24, { fill: C.chalkSoft });
  pg.text(tx, y + 18.5, "Total TTC", { size: 11.5, bold: true, color: C.ink });
  pg.text(M + CW - 6, y + 18.5, eur(D.totalTTC), { size: 11.5, bold: true, color: C.ink, anchor: "end" });
  y += 30;
  if (D.aCompleter.length) {
    pg.text(M + CW, y + 8, "Sans les lignes à compléter.", { size: 8.5, color: C.warn, anchor: "end" });
    y += 14;
  }
  y += 14;

  /* ---------- Mentions ---------- */
  const section = (title: string, text: string[]) => {
    const ls = text.flatMap((t) => lines(t, 8.5, CW));
    if (!ls.length) return;
    room(16 + Math.min(ls.length, 3) * 11);
    heading(pg, M, y, title);
    y += 13;
    for (const l of ls) {
      room(11);
      pg.text(M, y, l, { size: 8.5, color: C.ink });
      y += 11;
    }
    y += 9;
  };
  const S = o.saisie;
  section("Conditions", [
    ...(S.delai ? [`Début et durée des travaux : ${S.delai}`] : []),
    ...(S.acompte && D.acompte !== null
      ? [`Acompte à la commande : ${taux(S.acompte)} du total TTC, soit ${eur(D.acompte)}.`]
      : []),
    E.paiement,
    ...(o.validite ? [`Devis valable ${o.validite} jours${o.jusquAu ? `, jusqu'au ${o.jusquAu}` : ""}.`] : []),
  ]);
  if (D.lignes.some((l) => l.tva > 0 && l.tva < 20)) section("TVA à taux réduit", [TVA_REDUITE]);
  section("Déchets du chantier", [E.dechets]);
  if (E.assureur || E.contrat || E.couverture)
    section("Assurance décennale", [
      [E.assureur, flat(E.assureurAdresse)].filter(Boolean).join(", "),
      ...(E.contrat ? [`Contrat n° ${E.contrat}`] : []),
      ...(E.couverture ? [`Couverture géographique : ${E.couverture}`] : []),
    ]);
  if (E.mediateur)
    section("Médiation", [
      `En cas de litige, le client consommateur peut recourir gratuitement au médiateur de la consommation : ${flat(E.mediateur)}.`,
    ]);

  /* ---------- Bon pour accord ---------- */
  const accH = 104;
  room(accH + 4);
  y += 2;
  const half = CW / 2;
  pg.rect(M, y, CW, accH, { stroke: C.ink, width: 0.8 });
  pg.path(
    [
      [M + half, y],
      [M + half, y + accH],
    ],
    { stroke: C.rule, width: 0.6 },
  );
  heading(pg, M + 10, y + 16, "Bon pour accord");
  wrap(
    "Devis à retourner daté et signé, précédé de la mention manuscrite « Bon pour accord ». Il vaut alors commande des travaux décrits.",
    8.5,
    half - 20,
  ).forEach((l, i) => pg.text(M + 10, y + 31 + i * 11, l, { size: 8.5, color: C.ink }));
  const dot = (yy: number, label: string) => {
    pg.text(M + 10, yy, label, { size: 9, color: C.muted });
    pg.path(
      [
        [M + 50, yy + 1],
        [M + half - 12, yy + 1],
      ],
      { stroke: C.rule, width: 0.6, dash: [1, 2] },
    );
  };
  dot(y + 76, "Date");
  dot(y + 94, "Nom");
  pg.text(M + half + 10, y + 16, "SIGNATURE DU CLIENT", { size: 8.5, bold: true, color: C.muted });
  y += accH;

  /* ---------- Annexe : l'escalier ---------- */
  if (R) {
    newPage();
    pg.text(M, 58, "Annexe : l'escalier", { size: 18, bold: true, color: C.ink });
    pg.text(A4.w - M, 46, ref, { size: 8.5, color: C.muted, anchor: "end" });
    pg.text(A4.w - M, 58, o.nom, { size: 8.5, color: C.muted, anchor: "end" });
    const y0 = 76,
      h = BOTTOM - y0;
    if (o.vue3d) {
      const ph = (h - 14) * 0.52;
      frame(pg, M, y0, CW, ph, "Plan");
      drawShapes(pg, planShapes(R), PLAN_STYLE, M + 10, y0 + 26, CW - 20, ph - 36);
      const vy = y0 + ph + 14,
        vh = h - ph - 14;
      frame(pg, M, vy, CW, vh, "Vue 3D");
      const im = doc.jpeg(o.vue3d.data, o.vue3d.w, o.vue3d.h);
      const iw = CW - 20,
        ih = vh - 36;
      const k = Math.min(iw / o.vue3d.w, ih / o.vue3d.h);
      const w = o.vue3d.w * k,
        hh = o.vue3d.h * k;
      pg.image(im, M + 10 + (iw - w) / 2, vy + 26 + (ih - hh) / 2, w, hh);
    } else {
      const sh = 220,
        ph = h - sh - 14;
      frame(pg, M, y0, CW, ph, "Plan");
      drawShapes(pg, planShapes(R), PLAN_STYLE, M + 10, y0 + 26, CW - 20, ph - 36);
      frame(pg, M, y0 + ph + 14, CW, sh, "Vue de côté, développée sur la ligne de foulée");
      drawShapes(pg, sideShapes(R), SIDE_STYLE, M + 10, y0 + ph + 38, CW - 20, sh - 32);
    }
  }

  /* ---------- Pieds de page ---------- */
  const legal = [
    E.nom,
    [E.forme, E.capital && `au capital de ${E.capital}`].filter(Boolean).join(" "),
    E.siren && `SIREN ${E.siren}`,
    E.immat,
    E.tva && `TVA ${E.tva}`,
  ]
    .filter(Boolean)
    .join(" · ");
  pages.forEach((page, i) => {
    wrap(legal, 7, CW)
      .slice(0, 2)
      .forEach((l, j) => page.text(A4.w / 2, A4.h - 44 + j * 9, l, { size: 7, color: C.muted, anchor: "middle" }));
    page.text(M, A4.h - 22, ref, { size: 7.5, color: C.muted });
    page.text(A4.w - M, A4.h - 22, `page ${i + 1}/${pages.length}`, { size: 7.5, color: C.muted, anchor: "end" });
    if (brouillon) filigrane(page);
  });

  return doc.bytes();
}
