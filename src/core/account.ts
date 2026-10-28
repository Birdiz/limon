import type { Project } from "./project";

/* Ce que la page et le serveur échangent pour le compte et la synchronisation des projets. */

/** Testeur : compte créé avant l'abonnement. Les autres statuts viendront avec lui. */
export type Statut = "testeur" | "essai" | "abonne" | "expire";

export interface Compte {
  id: string;
  email: string;
  statut: Statut;
}

/** Passkey du compte : la clé privée reste dans l'appareil ou son trousseau. */
export interface Passkey {
  id: string;
  /** Appareil qui l'a créée : « iPhone », « Mac »… */
  nom: string;
  cree: number;
  utilise: number | null;
}

export interface CompteDetail extends Compte {
  passkeys: Passkey[];
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

/** Adresse e-mail nettoyée ; null si elle n'en a pas la forme. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
