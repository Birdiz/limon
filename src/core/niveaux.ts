import type { Statut } from "./account";
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
 * Niveau appliqué sur cet appareil. Avant le paiement en ligne, tout reste ouvert : un artisan limité n'aurait aucun
 * moyen de s'abonner. La préférence ?niveau= sert à l'essayer : un niveau forcé, ou « compte » pour suivre le compte.
 */
export function niveauActif(preference: string | null, statut: Statut | null): Niveau {
  if (preference === "compte") return niveauDe(statut);
  return preference === "gratuit" || preference === "payant" ? preference : "premium";
}

export const formeOuverte = (d: Droits, f: Forme): boolean => d.formes || TOURS[f] < 2;

/**
 * Escaliers en lecture seule : au-delà de ce que le niveau permet, les moins récemment modifiés. Rien n'est effacé à la
 * fin d'un abonnement. `projets` va du plus récent au plus ancien.
 */
export function enLecture(d: Droits, projets: readonly { id: string }[]): Set<string> {
  return new Set(projets.slice(d.escaliers).map((p) => p.id));
}
