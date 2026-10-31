import { fmt } from "./format";
import { DEFAULTS, sanitizeParams, type Essence, type Params } from "./params";
import { ESSENCE_LABEL } from "./summary";
import {
  POSTE_LABEL,
  POSTES,
  sanitizeEntreprise,
  sanitizeTarifs,
  type Entreprise,
  type Poste,
  type Tarifs,
} from "./tarifs";

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
  /** Acompte à la commande, en % du TTC ; aucun par défaut. */
  acompte: number | null;
  /** Date de début et durée des travaux, en clair (« semaine 48, deux jours de pose »). */
  delai: string;
}

/** Client du devis : ce que le document imprimera. */
export interface Client {
  nom: string;
  /** Adresse de facturation. */
  adresse: string;
  /** Adresse du chantier, si elle diffère. */
  chantier: string;
}

/** Devis d'un escalier, enregistré avec lui : le client et les réglages, dont les lignes se recalculent, et les
    versions déjà remises au client. */
export interface DevisProjet {
  client: Client;
  saisie: Saisie;
  /** Versions remises au client, la plus récente en dernier. */
  remis: DevisRemis[];
  /** Devis repris par l'artisan après la dernière remise : la version en cours est un brouillon. */
  rouvert: boolean;
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
  acompte: null,
  delai: "",
};

export const CLIENT_VIDE: Client = { nom: "", adresse: "", chantier: "" };

export function newDevis(tva: TauxTVA = 20): DevisProjet {
  return { client: { ...CLIENT_VIDE }, saisie: { ...SAISIE_DEFAUT, tva }, remis: [], rouvert: false };
}

const MAX_TEXTE = 2000;
const MAX_LIGNES = 100;
/** Versions remises gardées pour un escalier. */
const MAX_VERSIONS = 50;
const MAX_MONTANT = 1e7;
const texte = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_MONTANT ? v : null);
const positif = (v: unknown) => {
  const n = nombre(v);
  return n !== null && n >= 0 ? n : null;
};
const obj = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;

function sanitizeClient(raw: unknown): Client {
  const c = obj(raw);
  return { nom: texte(c.nom), adresse: texte(c.adresse, MAX_TEXTE), chantier: texte(c.chantier, MAX_TEXTE) };
}

function sanitizeSaisie(raw: unknown): Saisie {
  const s = obj(raw);
  const corrections: Record<string, Correction> = {};
  for (const [id, v] of Object.entries(obj(s.corrections)).slice(0, MAX_LIGNES)) {
    if (!/^[a-z][a-zA-Z-]{0,40}$/.test(id)) continue;
    const k = obj(v);
    const out: Correction = {};
    if (typeof k.designation === "string") out.designation = texte(k.designation);
    const q = positif(k.q),
      pu = nombre(k.pu);
    if (q !== null) out.q = q;
    if (pu !== null) out.pu = pu;
    if (k.retiree === true) out.retiree = true;
    if (Object.keys(out).length) corrections[id] = out;
  }
  const libres: LigneLibre[] = (Array.isArray(s.libres) ? s.libres : []).slice(0, MAX_LIGNES).map((v) => {
    const l = obj(v);
    return {
      designation: texte(l.designation),
      q: positif(l.q) ?? 1,
      unite: texte(l.unite, 20),
      pu: nombre(l.pu) ?? 0,
      tva: TAUX.includes(l.tva as number) ? (l.tva as number) : 20,
    };
  });
  const rm = obj(s.remise);
  const pct = positif(rm.pct),
    eur = positif(rm.eur),
    acompte = positif(s.acompte);
  return {
    tva: s.tva === 10 ? 10 : 20,
    pose: s.pose !== false,
    km: positif(s.km) ?? 0,
    livraison: s.livraison === true,
    faconDetail: s.faconDetail === true,
    corrections,
    libres,
    remise: pct !== null ? { pct: Math.min(pct, 100) } : eur !== null ? { eur } : null,
    acompte: acompte !== null && acompte > 0 ? Math.min(acompte, 100) : null,
    delai: texte(s.delai),
  };
}

/** Devis relu (stockage, fichier ou serveur, non fiable) ; null s'il n'y en a pas. */
export function sanitizeDevis(raw: unknown): DevisProjet | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const remis = (Array.isArray(r.remis) ? r.remis : [])
    .slice(-MAX_VERSIONS)
    .map(sanitizeRemis)
    .filter((v): v is DevisRemis => v !== null);
  return {
    client: sanitizeClient(r.client),
    saisie: sanitizeSaisie(r.saisie),
    remis,
    rouvert: remis.length > 0 && r.rouvert === true,
  };
}

/** Taux de TVA d'une ligne libre. */
export const TAUX: readonly number[] = [20, 10, 5.5, 0];

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
  /** Acompte à la commande, TTC, arrondi au centime ; null sans acompte. */
  acompte: number | null;
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
  const ttc = ht + montantTVA;

  // Déboursé : fournitures au prix d'achat, heures d'atelier et de pose.
  const achat = (prix === null ? 0 : vol * prix) + (quinc ?? 0);
  return {
    lignes,
    totalLignes: euros(tot),
    remise: euros(remise),
    totalHT: euros(ht),
    tva: tvas,
    totalTTC: euros(ttc),
    acompte: S.acompte ? euros(Math.round((ttc * S.acompte) / 100)) : null,
    aCompleter: aCompleter.filter((m, i) => aCompleter.indexOf(m) === i),
    alertes,
    facon: fab.map(([k, q]) => ({ poste: k, q, h: T.heures[k] })),
    debourse: { fournitures: euros(cents(achat)), heures: round((hFab.h ?? 0) + (hPose?.h ?? 0), 2) },
  };
}

/* ---------- Remise au client et suite ---------- */

/** État d'une version remise ; « expiré » se lit à la date, il n'est pas enregistré. */
export type EtatRemis = "remis" | "accepte" | "refuse";
export type EtatDevis = "brouillon" | EtatRemis | "expire";

export const ETAT_DEVIS_LABEL: Record<EtatDevis, string> = {
  brouillon: "Brouillon",
  remis: "Remis au client",
  accepte: "Accepté",
  refuse: "Refusé",
  expire: "Expiré",
};

/**
 * Version remise au client, figée : les réglages de l'escalier, les tarifs, l'entreprise, le client, la saisie et
 * les lignes chiffrées, pour refaire le même document au caractère près, même après un changement de tarifs ou
 * de calcul.
 */
export interface DevisRemis {
  /** Numéro donné par le serveur, le même pour toutes les versions d'un escalier : « 2026-0012 ». */
  numero: string;
  /** 1, 2… */
  version: number;
  remisLe: number;
  /** Durée de validité, en jours. */
  validite: number;
  etat: EtatRemis;
  /** Date de l'acceptation ou du refus, 0 sinon. */
  etatLe: number;
  /** Nom de l'escalier. */
  nom: string;
  params: Params;
  tarifs: Tarifs;
  entreprise: Entreprise;
  client: Client;
  saisie: Saisie;
  chiffrage: Devis;
}

const date = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const texts = (v: unknown, n: number) =>
  (Array.isArray(v) ? v : [])
    .slice(0, n)
    .map((x) => texte(x, MAX_TEXTE))
    .filter(Boolean);

function sanitizeChiffrage(raw: unknown): Devis {
  const r = obj(raw);
  const lignes: Ligne[] = (Array.isArray(r.lignes) ? r.lignes : []).slice(0, 2 * MAX_LIGNES).map((v, i) => {
    const l = obj(v);
    return {
      id: texte(l.id, 60) || `ligne-${i + 1}`,
      designation: texte(l.designation),
      q: nombre(l.q),
      unite: texte(l.unite, 20),
      pu: nombre(l.pu),
      tva: positif(l.tva) ?? 20,
      total: nombre(l.total),
      auto: l.auto === true,
      corrigee: l.corrigee === true,
    };
  });
  const tva = (Array.isArray(r.tva) ? r.tva : []).slice(0, 10).map((v) => {
    const t = obj(v);
    return { taux: positif(t.taux) ?? 0, base: nombre(t.base) ?? 0, montant: nombre(t.montant) ?? 0 };
  });
  const facon = (Array.isArray(r.facon) ? r.facon : [])
    .map(obj)
    .filter((f) => POSTES.includes(f.poste as Poste))
    .map((f) => ({ poste: f.poste as Poste, q: positif(f.q) ?? 0, h: positif(f.h) }));
  const d = obj(r.debourse);
  return {
    lignes,
    totalLignes: nombre(r.totalLignes) ?? 0,
    remise: nombre(r.remise) ?? 0,
    totalHT: nombre(r.totalHT) ?? 0,
    tva,
    totalTTC: nombre(r.totalTTC) ?? 0,
    acompte: nombre(r.acompte),
    aCompleter: texts(r.aCompleter, MAX_LIGNES),
    alertes: texts(r.alertes, MAX_LIGNES),
    facon,
    debourse: { fournitures: nombre(d.fournitures) ?? 0, heures: positif(d.heures) ?? 0 },
  };
}

/** Version remise relue ; null sans numéro. */
function sanitizeRemis(raw: unknown): DevisRemis | null {
  const r = obj(raw);
  if (typeof r.numero !== "string" || !/^\d{4}-\d{4,6}$/.test(r.numero)) return null;
  const version = typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 1 ? r.version : 1;
  const etat: EtatRemis = r.etat === "accepte" || r.etat === "refuse" ? r.etat : "remis";
  return {
    numero: r.numero,
    version,
    remisLe: date(r.remisLe),
    validite: Math.round(Math.min(positif(r.validite) ?? 30, 3650)),
    etat,
    etatLe: etat === "remis" ? 0 : date(r.etatLe),
    nom: texte(r.nom, 80),
    params: sanitizeParams(r.params),
    tarifs: sanitizeTarifs(r.tarifs),
    entreprise: sanitizeEntreprise(r.entreprise),
    client: sanitizeClient(r.client),
    saisie: sanitizeSaisie(r.saisie),
    chiffrage: sanitizeChiffrage(r.chiffrage),
  };
}

/** Dernier jour de validité, à minuit passé, à l'heure de l'appareil. */
export function finValidite(r: Pick<DevisRemis, "remisLe" | "validite">): number {
  const d = new Date(r.remisLe);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + r.validite + 1);
  return d.getTime() - 1;
}

/** État d'une version remise à la date donnée : une version sans réponse passe « expiré » après sa validité. */
export function etatRemis(r: DevisRemis, now: number): EtatRemis | "expire" {
  return r.etat === "remis" && now > finValidite(r) ? "expire" : r.etat;
}

/** Mêmes réglages d'escalier, réglage par réglage. */
export function memesParams(a: Params, b: Params): boolean {
  return (Object.keys(DEFAULTS) as (keyof Params)[]).every((k) => a[k] === b[k]);
}

/**
 * Version remise qui tient lieu de devis en cours, ou null quand le devis en cours est un brouillon : jamais remis,
 * repris par l'artisan, ou escalier modifié depuis la dernière remise (une nouvelle version repart en brouillon).
 */
export function versionRemise(d: DevisProjet | null, params: Params): DevisRemis | null {
  const last = d?.remis.at(-1);
  return last && !d!.rouvert && memesParams(last.params, params) ? last : null;
}

/** Numéro de la version qu'aurait le brouillon en cours. */
export const versionSuivante = (d: DevisProjet | null) => (d?.remis.at(-1)?.version ?? 0) + 1;

/** Devis avec une version de plus, remise au client à `now`. */
export function remettre(
  d: DevisProjet,
  v: Pick<DevisRemis, "numero" | "nom" | "params" | "tarifs" | "entreprise" | "chiffrage">,
  now: number,
): DevisProjet {
  const r: DevisRemis = structuredClone({
    ...v,
    version: versionSuivante(d),
    remisLe: now,
    validite: v.tarifs.validite ?? 30,
    etat: "remis",
    etatLe: 0,
    client: d.client,
    saisie: d.saisie,
  });
  return { ...d, remis: [...d.remis, r].slice(-MAX_VERSIONS), rouvert: false };
}

/** Réponse du client notée sur une version ; « remis » efface une réponse notée par erreur. */
export function noterReponse(d: DevisProjet, version: number, etat: EtatRemis, now: number): DevisProjet {
  return {
    ...d,
    remis: d.remis.map((r) => (r.version === version ? { ...r, etat, etatLe: etat === "remis" ? 0 : now } : r)),
  };
}

/** Ce qui empêche de remettre le devis au client ; vide quand il peut partir. */
export function bloquants(D: Devis, d: DevisProjet, T: Tarifs, E: Entreprise): string[] {
  const out: string[] = [];
  if (D.aCompleter.length) out.push("les lignes à compléter");
  if (!D.lignes.length) out.push("au moins une ligne");
  if (!d.client.nom) out.push("le nom du client");
  if (!d.client.adresse) out.push("l'adresse du client");
  if (!E.nom || !E.adresse) out.push("le nom et l'adresse de votre entreprise (Mon atelier)");
  if (T.validite === null) out.push("la durée de validité des devis (Mon atelier)");
  return out;
}

/** Mentions de l'entreprise que le document devrait porter et qui manquent : un avertissement, pas un refus. */
export function mentionsManquantes(E: Entreprise): string[] {
  const out: string[] = [];
  if (!E.forme) out.push("forme juridique");
  if (!E.siren) out.push("SIREN");
  if (!E.immat) out.push("immatriculation (RCS ou répertoire des métiers)");
  if (!E.assureur || !E.contrat || !E.couverture) out.push("assurance décennale");
  if (!E.mediateur) out.push("médiateur de la consommation");
  if (!E.paiement) out.push("conditions de paiement");
  if (!E.dechets) out.push("gestion des déchets");
  return out;
}
