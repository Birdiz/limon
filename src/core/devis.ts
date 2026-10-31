import { fmt } from "./format";
import type { Essence } from "./params";
import { ESSENCE_LABEL } from "./summary";
import { POSTE_LABEL, POSTES, type Poste, type Tarifs } from "./tarifs";

/*
 * Calcul du devis : des quantités de l'escalier et des tarifs de l'atelier, les lignes, la remise, la TVA et les
 * totaux. Tout en centimes entiers : chaque ligne est arrondie au centime, les totaux sont faits des lignes
 * arrondies, pour que le devis tombe juste à la calculatrice. Un tarif vide donne une ligne à compléter (prix
 * ou quantité null), jamais un prix inventé.
 */

/** Ce que l'escalier apporte au devis ; calculé par `quantites` (src/cnc) depuis la liste de débit. */
export interface Quantites {
  ess: Essence;
  /** Volume brut débité, m³. */
  volume: number;
  /** Marches droites, balancées, et paliers (marche palière comprise). */
  marches: number;
  balancees: number;
  paliers: number;
  contremarches: number;
  /** Longueur des limons, m. */
  limons: number;
  poteaux: number;
  /** Longueur de main courante, m. */
  mainCourante: number;
  /** Balustres, ou montants d'un garde-corps à lisses. */
  balustres: number;
  /** Longueur des lisses, m. */
  lisses: number;
  /** Deux faces de chaque pièce, m² (chants non comptés). */
  surface: number;
}

/** Taux de TVA proposés pour les lignes calculées. */
export type TauxTVA = 20 | 10;

/** Ligne ajoutée par l'artisan : dépose de l'ancien escalier, garde-corps d'étage, option… */
export interface LigneLibre {
  designation: string;
  q: number;
  unite: string;
  /** Prix unitaire HT, €. */
  pu: number;
  tva: number;
}

/** Correction d'une ligne calculée, gardée quand l'escalier change. */
export interface Correction {
  designation?: string;
  q?: number;
  pu?: number;
  /** Ligne enlevée du devis. */
  retiree?: boolean;
}

/** Ce que l'artisan règle pour un devis. */
export interface Saisie {
  /** Taux des lignes calculées : 10 % pour des travaux dans un logement de plus de deux ans, fourniture et pose. */
  tva: TauxTVA;
  pose: boolean;
  /** Distance jusqu'au chantier, km, pour le déplacement de pose et la livraison. */
  km: number;
  livraison: boolean;
  /** Façon détaillée par poste, au lieu d'une ligne d'heures totales. */
  faconDetail: boolean;
  corrections: Record<string, Correction>;
  libres: LigneLibre[];
  remise: { pct: number } | { eur: number } | null;
}

export const SAISIE_DEFAUT: Saisie = {
  tva: 20,
  pose: true,
  km: 0,
  livraison: false,
  faconDetail: false,
  corrections: {},
  libres: [],
  remise: null,
};

export interface Ligne {
  /** Repère stable d'une ligne calculée (« bois », « facon », « facon-marche »…) ou « libre-<n> ». */
  id: string;
  designation: string;
  q: number | null;
  unite: string;
  /** Prix unitaire HT, €. */
  pu: number | null;
  tva: number;
  /** Total HT, €, arrondi au centime ; null tant que la quantité ou le prix manque. */
  total: number | null;
  /** Ligne calculée depuis l'escalier (sinon ajoutée par l'artisan). */
  auto: boolean;
  /** Ligne calculée dont l'artisan a changé la désignation, la quantité ou le prix. */
  corrigee: boolean;
}

export interface Devis {
  lignes: Ligne[];
  /** Somme des lignes, HT, avant remise. */
  totalLignes: number;
  remise: number;
  totalHT: number;
  /** TVA par taux : base HT après remise, montant. */
  tva: { taux: number; base: number; montant: number }[];
  totalTTC: number;
  /** Ce qui manque pour que le devis soit complet (tarifs vides). Les totaux ne comptent que les lignes chiffrées. */
  aCompleter: string[];
  alertes: string[];
  /** Pour l'artisan seul : heures par poste, quantités comprises. */
  facon: { poste: Poste; q: number; h: number | null }[];
  /** Pour l'artisan seul : fournitures au prix d'achat (bois et quincaillerie, sans coefficient), et heures. */
  debourse: { fournitures: number; heures: number };
}

const cents = (eur: number) => Math.round(eur * 100);
const euros = (c: number) => c / 100;
/** Arrondi d'une quantité, pour qu'elle s'imprime telle qu'elle est comptée. */
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Quantité de chaque poste de façon, finition comprise (heures par m²) ; la pose a sa ligne à part. */
function postes(Q: Quantites): Record<Poste, number> {
  return {
    prepa: 1,
    marche: Q.marches,
    balancee: Q.balancees,
    palier: Q.paliers,
    contremarche: Q.contremarches,
    limon: round(Q.limons, 2),
    poteau: Q.poteaux,
    mainCourante: round(Q.mainCourante, 2),
    balustre: Q.balustres,
    lisse: round(Q.lisses, 2),
    finition: round(Q.surface, 2),
    poseEscalier: 0,
    poseMarche: 0,
  };
}

/** Somme d'heures ; null, avec les postes sans temps, si l'un des postes nécessaires n'en a pas. */
function heures(items: readonly [Poste, number][], T: Tarifs): { h: number | null; manque: string[] } {
  let h = 0;
  const manque: string[] = [];
  for (const [k, q] of items) {
    if (!q) continue;
    const t = T.heures[k];
    if (t === null) manque.push(`Heures : ${POSTE_LABEL[k].l.toLowerCase()} (${POSTE_LABEL[k].par})`);
    else h += q * t;
  }
  return { h: manque.length ? null : round(h, 2), manque };
}

/** Somme de montants dont l'un peut manquer : null si tous manquent, sinon les vides comptent pour zéro. */
const somme = (...v: (number | null)[]) =>
  v.every((x) => x === null) ? null : v.reduce<number>((s, x) => s + (x ?? 0), 0);

/** Ligne calculée avant corrections, avec ce qui lui manque pour être chiffrée. */
type Brut = Pick<Ligne, "id" | "designation" | "q" | "unite" | "pu"> & { manque: string[] };

export function devis(Q: Quantites, T: Tarifs, S: Saisie): Devis {
  const alertes: string[] = [];
  // Fourniture sans pose : le taux réduit ne s'applique pas.
  const tva = S.pose ? S.tva : 20;
  if (!S.pose && S.tva !== 20) alertes.push("Fourniture seule, sans pose : TVA à 20 %.");
  const coef = T.coef ?? 1;
  const tous = Q.marches + Q.balancees + Q.paliers;
  const brut: Brut[] = [];
  const taux = T.taux === null ? ["Taux horaire"] : [];

  // Bois
  const prix = T.bois[Q.ess];
  const vol = round(Q.volume * (1 + (T.perte ?? 0) / 100), 3);
  brut.push({
    id: "bois",
    designation: `Bois : ${ESSENCE_LABEL[Q.ess].toLowerCase()}, brut débité${T.perte ? `, ${fmt(T.perte)} % de perte compris` : ""}`,
    q: vol,
    unite: "m³",
    pu: prix === null ? null : euros(cents(prix * coef)),
    manque: prix === null ? [`Prix du bois : ${ESSENCE_LABEL[Q.ess].toLowerCase()}`] : [],
  });

  // Quincaillerie
  const quinc = somme(T.quincEscalier, T.quincMarche === null ? null : T.quincMarche * tous);
  brut.push({
    id: "quincaillerie",
    designation: "Quincaillerie : vis, boulons de limon, colle",
    q: 1,
    unite: "forfait",
    pu: quinc === null ? null : euros(cents(quinc * coef)),
    manque: quinc === null ? ["Quincaillerie"] : [],
  });

  // Façon, finition comprise (heures par m²)
  const P = postes(Q);
  const fab = POSTES.filter((k) => P[k] > 0).map((k) => [k, P[k]] as [Poste, number]);
  const hFab = heures(fab, T);
  if (S.faconDetail)
    for (const [k, q] of fab) {
      const h = heures([[k, q]], T);
      const t = T.heures[k];
      brut.push({
        id: `facon-${k}`,
        designation: `Façon : ${POSTE_LABEL[k].l.toLowerCase()}${t === null ? "" : ` (${fmt(q, Number.isInteger(q) ? 0 : 2)} × ${fmt(t, 1)} h)`}`,
        q: h.h,
        unite: "h",
        pu: T.taux,
        manque: [...h.manque, ...taux],
      });
    }
  else
    brut.push({
      id: "facon",
      designation: "Fabrication de l'escalier",
      q: hFab.h,
      unite: "h",
      pu: T.taux,
      manque: [...hFab.manque, ...taux],
    });

  // Produit de finition
  brut.push({
    id: "finition",
    designation: "Produit de finition, deux faces de chaque pièce",
    q: round(Q.surface, 2),
    unite: "m²",
    pu: T.finition,
    manque: T.finition === null ? ["Produit de finition"] : [],
  });

  // Pose et déplacement, livraison
  const hPose = S.pose
    ? heures(
        [
          ["poseEscalier", 1],
          ["poseMarche", tous],
        ],
        T,
      )
    : null;
  if (hPose) {
    brut.push({
      id: "pose",
      designation: "Pose sur le chantier",
      q: hPose.h,
      unite: "h",
      pu: T.taux,
      manque: [...hPose.manque, ...taux],
    });
    const depl = somme(T.deplForfait, T.deplKm === null ? null : T.deplKm * S.km);
    brut.push({
      id: "deplacement",
      designation: "Déplacement de pose",
      q: 1,
      unite: "forfait",
      pu: depl === null ? null : euros(cents(depl)),
      manque: depl === null ? ["Déplacement de pose"] : [],
    });
  }
  if (S.livraison) {
    const liv = somme(T.livForfait, T.livKm === null ? null : T.livKm * S.km);
    brut.push({
      id: "livraison",
      designation: "Livraison",
      q: 1,
      unite: "forfait",
      pu: liv === null ? null : euros(cents(liv)),
      manque: liv === null ? ["Livraison"] : [],
    });
  }

  // Corrections de l'artisan, puis ses lignes. Une ligne à zéro n'a rien à faire sur le devis.
  const aCompleter: string[] = [];
  const lignes: Ligne[] = [];
  for (const { manque, ...b } of brut) {
    const c = S.corrections[b.id];
    if (c?.retiree) continue;
    const corrigee = c !== undefined && (c.designation !== undefined || c.q !== undefined || c.pu !== undefined);
    const l: Ligne = {
      ...b,
      designation: c?.designation ?? b.designation,
      q: c?.q ?? b.q,
      pu: c?.pu ?? b.pu,
      tva,
      total: null,
      auto: true,
      corrigee,
    };
    if (l.q === 0) continue;
    if (l.q !== null && l.pu !== null) l.total = euros(cents(l.q * l.pu));
    // Ce qui manque à une ligne corrigée à la main se dit par sa désignation.
    else aCompleter.push(...(corrigee ? [l.designation] : manque));
    lignes.push(l);
  }
  S.libres.forEach((l, i) => {
    if (l.q === 0) return;
    lignes.push({ id: `libre-${i + 1}`, ...l, total: euros(cents(l.q * l.pu)), auto: false, corrigee: false });
  });

  // Totaux
  const base = new Map<number, number>();
  for (const l of lignes) if (l.total !== null) base.set(l.tva, (base.get(l.tva) ?? 0) + cents(l.total));
  const tot = [...base.values()].reduce((s, v) => s + v, 0);
  const r = S.remise;
  const remise = Math.min(tot, Math.max(0, r ? ("pct" in r ? Math.round((tot * r.pct) / 100) : cents(r.eur)) : 0));
  // La remise se répartit sur les taux au prorata, le reste d'arrondi sur le dernier.
  const parTaux = [...base.keys()].sort((a, b) => b - a);
  let reste = remise;
  const tvas = parTaux.map((t, i) => {
    const b = base.get(t)!;
    const part = i === parTaux.length - 1 ? reste : Math.round((remise * b) / tot);
    reste -= part;
    const net = b - part;
    return { taux: t, base: euros(net), montant: euros(Math.round((net * t) / 100)) };
  });
  const ht = tot - remise;
  const montantTVA = tvas.reduce((s, v) => s + cents(v.montant), 0);

  // Déboursé : fournitures au prix d'achat, heures d'atelier et de pose.
  const achat = (prix === null ? 0 : vol * prix) + (quinc ?? 0);
  return {
    lignes,
    totalLignes: euros(tot),
    remise: euros(remise),
    totalHT: euros(ht),
    tva: tvas,
    totalTTC: euros(ht + montantTVA),
    aCompleter: aCompleter.filter((m, i) => aCompleter.indexOf(m) === i),
    alertes,
    facon: fab.map(([k, q]) => ({ poste: k, q, h: T.heures[k] })),
    debourse: { fournitures: euros(cents(achat)), heures: round((hFab.h ?? 0) + (hPose?.h ?? 0), 2) },
  };
}
