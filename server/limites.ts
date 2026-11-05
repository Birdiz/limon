/* Limites de débit de /api : en mémoire, un seul serveur tournant, à zéro à chaque redémarrage. */

const HOUR = 3_600_000;

/** Essais par code envoyé par e-mail, et par heure pour une adresse IP et un e-mail à la connexion. */
export const CODE_TRIES = 5;
/** Codes de connexion par heure, pour une adresse IP et un e-mail : qui ne reçoit rien réessaie, sans plus. */
const CODES_PAR_IP_EMAIL = 3;
/** Codes par heure à un même e-mail, d'où qu'ils viennent : la protection de sa boîte, pas une limite pour la personne. */
export const CODES_PAR_EMAIL = 20;
/** Codes de connexion valables à la fois pour un e-mail : les plus récents, chacun multiplie les chances d'un essai. */
export const CODES_VALABLES = 3;
/** Essais par heure sur un e-mail, d'où qu'ils viennent : avec `CODES_VALABLES`, ce plafond borne ce qu'on peut deviner. */
export const ESSAIS_PAR_EMAIL = 30;
/** Codes de changement d'adresse par heure : un compte peut se tromper en la tapant. */
const CODES_ADRESSE_PAR_COMPTE = 5;
/** Codes de preuve par heure et par compte : chacun arrive dans la boîte de la personne. */
const CODES_PREUVE_PAR_COMPTE = 5;
/** Codes par heure, tous envois et toutes personnes confondus. Un compte en demande rarement : passkey, session longue. */
export const CODES_PAR_HEURE = 100;
/** Vérifications de code par heure et par adresse IP : 5 essais pour chacune de quelques personnes, un atelier à plusieurs. */
export const VERIFICATIONS_PAR_IP = 60;
/** Envois ou lectures par minute, par compte et par route : largement au-dessus d'un échange toutes les 3 s. */
const MAX_ENVOIS = 120;
/** Clés gardées par limite. */
const MAX_CLES = 10_000;
/** Longueur gardée d'une clé, assez pour une adresse e-mail : la mémoire d'une table reste bornée. */
const LONGUEUR_CLE = 320;

/**
 * Une limite : au plus `max` essais par clé dans la fenêtre, en mémoire, un seul serveur tournant, et rien n'est
 * conservé. La table est rangée du dernier essai le plus ancien au plus récent : ce qui a expiré est toujours devant.
 */
export class Limiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly capacite = MAX_CLES,
  ) {}

  get taille(): number {
    return this.hits.size;
  }

  private limitee(essais: number[], now: number): boolean {
    return essais.length >= this.max && now - essais[0]! < this.windowMs;
  }

  /** Vrai si `key` est à sa limite, sans compter d'essai. */
  atteinte(key: string): boolean {
    const essais = this.hits.get(key.slice(0, LONGUEUR_CLE));
    return !!essais && this.limitee(essais, Date.now());
  }

  /** Vrai si l'essai passe ; faux au-delà de `max` dans la fenêtre, ou si la table est pleine de clés limitées. */
  hit(key: string): boolean {
    const cle = key.slice(0, LONGUEUR_CLE);
    const now = Date.now();
    const essais = this.hits.get(cle) ?? [];
    if (this.limitee(essais, now)) return false;
    this.hits.delete(cle);
    if (this.hits.size >= this.capacite && !this.evince(now)) return false;
    this.hits.set(cle, [...essais.filter((t) => now - t < this.windowMs), now]);
    return true;
  }

  /** Fait une place en retirant la clé la plus ancienne qui n'est pas limitée : une expirée s'il y en a. */
  private evince(now: number): boolean {
    for (const [cle, essais] of this.hits) {
      if (this.limitee(essais, now)) continue;
      this.hits.delete(cle);
      return true;
    }
    return false;
  }

  /** Oublie les clés expirées. Ne parcourt que celles-là. */
  balaye(): void {
    const now = Date.now();
    for (const [cle, essais] of this.hits) {
      if (now - essais.at(-1)! < this.windowMs) return;
      this.hits.delete(cle);
    }
  }
}

/** Une table par limite : aucune ne peut pousser dehors les clés d'une autre. */
export function nouvellesLimites() {
  return {
    codesParIp: new Limiter(20, HOUR),
    codesParIpEmail: new Limiter(CODES_PAR_IP_EMAIL, HOUR),
    verificationsParIp: new Limiter(VERIFICATIONS_PAR_IP, HOUR),
    essaisParIpEmail: new Limiter(CODE_TRIES, HOUR),
    essaisParEmail: new Limiter(ESSAIS_PAR_EMAIL, HOUR),
    passkeysParIp: new Limiter(60, HOUR),
    codesParEmail: new Limiter(CODES_PAR_EMAIL, HOUR),
    codesAdresseParEmail: new Limiter(CODES_PAR_EMAIL, HOUR),
    codesAdresseParCompte: new Limiter(CODES_ADRESSE_PAR_COMPTE, HOUR),
    codesPreuveParCompte: new Limiter(CODES_PREUVE_PAR_COMPTE, HOUR),
    envoisParCompte: new Limiter(MAX_ENVOIS, 60_000),
    codesEnvoyes: new Limiter(CODES_PAR_HEURE, HOUR),
  };
}
export type Limites = ReturnType<typeof nouvellesLimites>;
export const balayeLimites = (limites: Limites) => Object.values(limites).forEach((l) => l.balaye());
