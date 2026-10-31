import { ESSENCES, type Essence } from "./params";

/*
 * Tarifs et fiche de l'entreprise : ce que le devis ajoute à l'escalier pour en faire un prix. Saisis une fois
 * dans Mon atelier, repris par chaque devis. Montants hors taxes. Un tarif vide (null) donne une ligne à
 * compléter dans le devis : l'outil n'invente jamais un prix.
 */

/** Postes de façon, chiffrés en heures, multipliées par le taux horaire. */
export type Poste =
  | "prepa"
  | "marche"
  | "balancee"
  | "palier"
  | "contremarche"
  | "limon"
  | "poteau"
  | "mainCourante"
  | "balustre"
  | "lisse"
  | "finition"
  | "poseEscalier"
  | "poseMarche";

export const POSTES: readonly Poste[] = [
  "prepa",
  "marche",
  "balancee",
  "palier",
  "contremarche",
  "limon",
  "poteau",
  "mainCourante",
  "balustre",
  "lisse",
  "finition",
  "poseEscalier",
  "poseMarche",
];

/** Intitulé et unité de la quantité, pour chaque poste. */
export const POSTE_LABEL: Record<Poste, { l: string; par: string }> = {
  prepa: { l: "Dessin et préparation", par: "par escalier" },
  marche: { l: "Marche droite", par: "par marche" },
  balancee: { l: "Marche balancée", par: "par marche" },
  palier: { l: "Palier ou marche palière", par: "par pièce" },
  contremarche: { l: "Contremarche", par: "par pièce" },
  limon: { l: "Limon", par: "par mètre" },
  poteau: { l: "Poteau", par: "par poteau" },
  mainCourante: { l: "Main courante", par: "par mètre" },
  balustre: { l: "Balustre", par: "par balustre" },
  lisse: { l: "Lisse", par: "par mètre" },
  finition: { l: "Finition", par: "par m²" },
  poseEscalier: { l: "Pose", par: "par escalier" },
  poseMarche: { l: "Pose", par: "par marche" },
};

export interface Tarifs {
  /** Prix du bois brut, €/m³, par essence. */
  bois: Record<Essence, number | null>;
  /** Perte et chutes, en % du volume brut débité. */
  perte: number | null;
  /** Coefficient appliqué au bois et à la quincaillerie. */
  coef: number | null;
  /** Quincaillerie, € par escalier et € par marche. */
  quincEscalier: number | null;
  quincMarche: number | null;
  /** Finition, €/m² de surfaces vues. */
  finition: number | null;
  /** Taux horaire de vente, €/h. */
  taux: number | null;
  /** Heures par poste. */
  heures: Record<Poste, number | null>;
  /** Livraison et déplacement de pose : forfait en €, puis € par km. */
  livForfait: number | null;
  livKm: number | null;
  deplForfait: number | null;
  deplKm: number | null;
  /** Durée de validité des devis, en jours. */
  validite: number | null;
}

/** Montants simples des tarifs, lus et relus de la même façon. */
export const TARIF_KEYS = [
  "perte",
  "coef",
  "quincEscalier",
  "quincMarche",
  "finition",
  "taux",
  "livForfait",
  "livKm",
  "deplForfait",
  "deplKm",
  "validite",
] as const satisfies readonly (keyof Tarifs)[];

const each = <K extends string>(keys: readonly K[], f: (k: K) => number | null) =>
  Object.fromEntries(keys.map((k) => [k, f(k)])) as Record<K, number | null>;

export const TARIFS_VIDES: Tarifs = {
  bois: each(ESSENCES, () => null),
  heures: each(POSTES, () => null),
  ...each(TARIF_KEYS, () => null),
};

/** Ce que le devis imprime de l'entreprise. Tous les champs sont du texte, vide quand il n'est pas rempli. */
export interface Entreprise {
  /** Nom ou raison sociale. */
  nom: string;
  /** Forme juridique : EI, EURL, SARL, SAS… */
  forme: string;
  /** Capital social, pour une société. */
  capital: string;
  adresse: string;
  telephone: string;
  email: string;
  siren: string;
  /** Immatriculation : RCS ou répertoire des métiers, avec la ville ou le département. */
  immat: string;
  /** Numéro de TVA intracommunautaire. */
  tva: string;
  /** Assurance décennale : assureur, ses coordonnées, numéro de contrat, couverture géographique. */
  assureur: string;
  assureurAdresse: string;
  contrat: string;
  couverture: string;
  /** Médiateur de la consommation : nom et coordonnées. */
  mediateur: string;
  /** Conditions de paiement et texte sur la gestion des déchets, repris tels quels. */
  paiement: string;
  dechets: string;
}

export const ENTREPRISE_KEYS = [
  "nom",
  "forme",
  "capital",
  "adresse",
  "telephone",
  "email",
  "siren",
  "immat",
  "tva",
  "assureur",
  "assureurAdresse",
  "contrat",
  "couverture",
  "mediateur",
  "paiement",
  "dechets",
] as const satisfies readonly (keyof Entreprise)[];

/** Champs qui tiennent sur plusieurs lignes. */
export const ENTREPRISE_LONGS: readonly (keyof Entreprise)[] = [
  "adresse",
  "assureurAdresse",
  "mediateur",
  "paiement",
  "dechets",
];

/** Vrai à la compilation seulement si la liste nomme tous les champs de la fiche. */
type EntrepriseKey = (typeof ENTREPRISE_KEYS)[number];
const toutes: Exclude<keyof Entreprise, EntrepriseKey> extends never ? true : never = true;
void toutes;

const texts = (f: (k: EntrepriseKey) => string) =>
  Object.fromEntries(ENTREPRISE_KEYS.map((k) => [k, f(k)])) as Record<EntrepriseKey, string>;

export const ENTREPRISE_VIDE: Entreprise = texts(() => "");

/** Plafonds des tarifs relus : au-delà, c'est une faute de frappe ou une donnée abîmée. */
const MAX_TARIF = 1e6;
const MAX_COURT = 200;
const MAX_LONG = 2000;

/** Montant relu : un nombre positif ou nul, sinon vide. */
function montant(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_TARIF ? v : null;
}

/** Tarifs relus (stockage, serveur ou formulaire, non fiables) ; ce qui manque ou ne va pas reste vide. */
export function sanitizeTarifs(raw: unknown): Tarifs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sub = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const bois = sub(r.bois),
    heures = sub(r.heures);
  return {
    bois: each(ESSENCES, (k) => montant(bois[k])),
    heures: each(POSTES, (k) => montant(heures[k])),
    ...each(TARIF_KEYS, (k) => montant(r[k])),
  };
}

/** Fiche de l'entreprise relue ; espaces de bord retirés, texte trop long coupé. */
export function sanitizeEntreprise(raw: unknown): Entreprise {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return texts((k) => {
    const v = r[k];
    return typeof v === "string" ? v.trim().slice(0, ENTREPRISE_LONGS.includes(k) ? MAX_LONG : MAX_COURT) : "";
  });
}

/** Vrai si rien n'est rempli. */
export function isEmptyTarifs(t: Tarifs): boolean {
  return (
    ESSENCES.every((k) => t.bois[k] === null) &&
    POSTES.every((k) => t.heures[k] === null) &&
    TARIF_KEYS.every((k) => t[k] === null)
  );
}

export function isEmptyEntreprise(e: Entreprise): boolean {
  return ENTREPRISE_KEYS.every((k) => e[k] === "");
}

/** SIREN : 9 chiffres, espaces permis, et clé de Luhn juste. */
export function sirenOk(s: string): boolean {
  const d = s.replace(/\s/g, "");
  if (!/^\d{9}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(d.charAt(i)) * (i % 2 ? 2 : 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}
