import type { Project } from "./project";

/* Ce que la page et le serveur échangent pour le compte et la synchronisation des projets. */

/** Testeur : compte créé avant l'abonnement, tout ouvert à vie. Essai : 30 jours à la création. Abonne au niveau payant, premium au-dessus. Expire : revenu au gratuit. */
export type Statut = "testeur" | "essai" | "abonne" | "premium" | "expire";

export interface Compte {
  id: string;
  email: string;
  statut: Statut;
  /** Fin de l'essai ou de la période payée. Absente d'un compte gardé sur l'appareil avant l'abonnement. */
  droitsJusquA?: number | null;
}

/** Passkey du compte : la clé privée reste dans l'appareil ou son trousseau. */
export interface Passkey {
  id: string;
  /** Appareil qui l'a créée : « iPhone », « Mac »… */
  nom: string;
  cree: number;
  utilise: number | null;
}

/** Appareil connecté au compte : une session, sans rien de son jeton. */
export interface Appareil {
  id: string;
  /** « iPhone », « Mac »… ; « Appareil » pour une connexion d'avant ces noms. */
  nom: string;
  cree: number;
  /** Dernier usage, noté une fois par jour au plus. */
  utilise: number;
  /** Celui qui demande. */
  actuel: boolean;
}

export interface CompteDetail extends Compte {
  passkeys: Passkey[];
  appareils: Appareil[];
  /** Le paiement en ligne est ouvert sur ce serveur. */
  paiement: boolean;
  /** L'abonnement a déjà un client chez Stripe : factures, carte et arrêt s'y gèrent. */
  gestion: boolean;
  /** L'arrêt est demandé : l'abonnement court jusqu'à `droitsJusquA`, sans nouveau prélèvement. */
  resilie: boolean;
}

/** Ligne de l'index des projets d'un compte : de quoi savoir qui a la version la plus récente. */
export interface Entree {
  id: string;
  modifie: number;
  /** Trace d'un projet supprimé, datée par `modifie`. */
  supprime: boolean;
}

/** Version d'un projet envoyée au serveur : le projet entier, ou la trace de sa suppression. */
export type Changement = { id: string; modifie: number; supprime: true } | { id: string; projet: Project };

/** Raison d'un refus pour la date : la page y reconnaît ce qu'une horloge remise à l'heure peut réparer. */
export const DATE_REFUSEE = "Sa date de modification est impossible.";

/** Élément d'un envoi que le serveur n'a pas rangé, et pourquoi, en mots pour l'artisan. */
export interface Refus {
  id: string;
  raison: string;
}

/** Réponse à un envoi : l'index à jour et les refus. */
export interface Envoi {
  index: Entree[];
  refus: Refus[];
}

/** Adresse e-mail nettoyée ; null si elle n'en a pas la forme. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u.test(e) ? e : null;
}
