import type { Compte, CompteDetail, Statut } from "./account";
import { day } from "./format";
import { TOURS, type Forme } from "./params";

/* Trois niveaux : le gratuit pour vérifier un escalier, le payant pour le fabriquer, le premium pour le vendre. */

export type Niveau = "gratuit" | "payant" | "premium";

export interface Droits {
  /** Escaliers modifiables en même temps. */
  escaliers: number;
  /** Formes en U (double quart, demi-tournant) et palier. */
  formes: boolean;
  avance: boolean;
  /** Fiche entière et sans filigrane ; sinon sa première page, en brouillon. */
  ficheComplete: boolean;
  /** Fichiers pour la machine, liste de débit et tableurs. */
  fabrication: boolean;
  /** Réglages de l'atelier pour les nouveaux escaliers. */
  atelier: boolean;
  devis: boolean;
}

const PAYANT: Droits = {
  escaliers: Infinity,
  formes: true,
  avance: true,
  ficheComplete: true,
  fabrication: true,
  atelier: true,
  devis: false,
};

export const DROITS: Record<Niveau, Droits> = {
  gratuit: {
    escaliers: 1,
    formes: false,
    avance: false,
    ficheComplete: false,
    fabrication: false,
    atelier: false,
    devis: false,
  },
  payant: PAYANT,
  premium: { ...PAYANT, devis: true },
};

/** Niveau d'un compte ; sans compte, le gratuit. L'essai et les testeurs ont tout. */
export function niveauDe(statut: Statut | null): Niveau {
  switch (statut) {
    case "testeur":
    case "essai":
    case "premium":
      return "premium";
    case "abonne":
      return "payant";
    default:
      return "gratuit";
  }
}

/**
 * L'interrupteur de l'abonnement, tant que Thomas n'a pas de compte Stripe. Faux : tout reste ouvert, car un artisan
 * limité n'aurait aucun moyen de s'abonner, et les pages gardent leurs textes d'avant (`textesAbonnement`). Le passer à
 * vrai demande un paiement essayé et l'accord de Thomas (skill `serveur-compte`, Activation).
 */
export const ABONNEMENT_OUVERT: boolean = false;

/**
 * Garde dans une page, au build, les blocs `<!-- abonnement: ouvert -->` ou `<!-- abonnement: ferme -->` selon
 * l'interrupteur, jusqu'à leur `<!-- /abonnement -->`. Les pages n'ont pas de script pour le faire à l'ouverture.
 */
export function textesAbonnement(html: string, ouvert = ABONNEMENT_OUVERT): string {
  return html.replace(
    /[ \t]*<!-- abonnement: (ouvert|ferme) -->\n?([\s\S]*?)[ \t]*<!-- \/abonnement -->\n?/g,
    (_, etat, bloc) => {
      const [o = "", f = ""] = String(bloc).split(/[ \t]*<!-- abonnement: ferme -->\n?/);
      return etat === "ouvert" ? (ouvert ? o : f) : ouvert ? "" : o;
    },
  );
}

const RANG: Record<Niveau, number> = { gratuit: 0, payant: 1, premium: 2 };

/**
 * Niveau appliqué sur cet appareil : celui du compte, ou tout tant que les limites dorment. La préférence ?niveau= sert à
 * l'essayer : « compte » suit le compte, un niveau forcé ne peut que baisser, jamais donner plus que ce qui est payé.
 */
export function niveauActif(preference: string | null, statut: Statut | null, actives = ABONNEMENT_OUVERT): Niveau {
  const base = actives || preference === "compte" ? niveauDe(statut) : "premium";
  return (preference === "gratuit" || preference === "payant") && RANG[preference] < RANG[base] ? preference : base;
}

/** Marge après la fin d'une période payée : Stripe redit un renouvellement pendant 3 jours si le site ne répond pas. */
const MARGE_ABONNE = 7 * 86_400_000;

/**
 * Statut qui vaut maintenant : une date passée ramène au gratuit, même si rien n'a prévenu. Lu pareil par la page, hors
 * ligne compris, et par le serveur.
 */
export function statutReel(compte: Pick<Compte, "statut" | "droitsJusquA"> | null, now: number): Statut | null {
  if (!compte) return null;
  const { statut, droitsJusquA: fin } = compte;
  if (statut === "essai") return fin && now < fin ? statut : "expire";
  if (statut === "abonne" || statut === "premium") return fin && now < fin + MARGE_ABONNE ? statut : "expire";
  return statut;
}

/* ---------- Offres ---------- */

export type Offre = "payant" | "premium";
export type Rythme = "mois" | "an";

/**
 * Prix TTC en centimes, ceux que Stripe prélève (`scripts/stripe-prix.ts`). Les pages les montrent HT d'abord (`prixHT`),
 * à recopier dans `index.html` et `mentions-legales`.
 */
export const PRIX: Record<Offre, Record<Rythme, number>> = {
  payant: { mois: 900, an: 10_000 },
  premium: { mois: 1250, an: 14_000 },
};

/** Noms montrés aux artisans. */
export const NOM_OFFRE: Record<Offre, string> = { payant: "Pour fabriquer", premium: "Pour vendre" };

export const isOffre = (v: unknown): v is Offre => v === "payant" || v === "premium";
export const isRythme = (v: unknown): v is Rythme => v === "mois" || v === "an";

/** Au-delà de ce reste, l'essai en cours retarde le premier prélèvement ; Stripe demande au moins 2 jours. */
export const ESSAI_RESTE_MIN = 3 * 86_400_000;

/** Ce que l'onglet Mon compte montre de l'offre : `texte` est du HTML sans donnée de la personne. */
export interface OffreVue {
  texte: string;
  /** Montrer le choix des offres. */
  choix: boolean;
  /** Montrer « Gérer mon abonnement ». */
  gerer: boolean;
  /** Sous le choix des offres. */
  note: string;
}

export function offreVue(
  d: Pick<CompteDetail, "statut" | "droitsJusquA" | "resilie" | "gestion">,
  now: number,
): OffreVue {
  const statut = statutReel(d, now);
  const fin = day(d.droitsJusquA ?? now);
  const ensuite = "Ensuite, vous gardez l'offre gratuite et tous vos escaliers, sans rien payer.";
  if (statut === "testeur")
    return {
      texte: "<b>Tout est ouvert pour vous, sans limite de durée.</b> Merci d'avoir essayé Quart de tour dès le début.",
      choix: false,
      gerer: false,
      note: "",
    };
  if (statut === "essai")
    return {
      texte: `<b>Essai : tout est ouvert jusqu'au ${fin}.</b> ${ensuite}`,
      choix: true,
      gerer: false,
      note:
        (d.droitsJusquA ?? 0) - now > ESSAI_RESTE_MIN
          ? `Votre essai reste offert : le premier prélèvement tombe le ${fin}.`
          : "",
    };
  if (statut === "abonne" || statut === "premium") {
    const nom = NOM_OFFRE[statut === "abonne" ? "payant" : "premium"];
    return {
      texte: d.resilie
        ? `<b>${nom}, jusqu'au ${fin}.</b> L'abonnement s'arrête à cette date. ${ensuite}`
        : `<b>${nom}.</b> Prochain prélèvement le ${fin}.`,
      choix: false,
      gerer: true,
      note: "",
    };
  }
  return {
    texte:
      "<b>Offre gratuite.</b> Un escalier modifiable à la fois, droit ou quart tournant. Vos autres escaliers restent gardés, à lire.",
    choix: true,
    gerer: d.gestion,
    note: "",
  };
}

/** « 9 € », « 12,50 € » : le prix écrit comme sur la page publique. */
/** Taux de TVA des abonnements. */
export const TVA = 0.2;

/** Prix HT en centimes, arrondi au centime, d'un prix TTC. */
export const prixHT = (ttc: number): number => Math.round(ttc / (1 + TVA));

export function prixEuros(centimes: number): string {
  const e = centimes / 100;
  return `${Number.isInteger(e) ? e : e.toFixed(2).replace(".", ",")} €`;
}

export const formeOuverte = (d: Droits, f: Forme): boolean => d.formes || TOURS[f] < 2;

/**
 * Escaliers en lecture seule : au-delà de ce que le niveau permet, les moins récemment modifiés. Rien n'est effacé à la
 * fin d'un abonnement. `projets` va du plus récent au plus ancien.
 */
export function enLecture(d: Droits, projets: readonly { id: string }[]): Set<string> {
  return new Set(projets.slice(d.escaliers).map((p) => p.id));
}
