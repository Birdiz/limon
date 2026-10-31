/**
 * Historique des réglages pour annuler et rétablir. Chaque étape est une copie complète de l'état
 * (gardée en JSON), pas une différence champ par champ : un réglage ajouté plus tard est suivi sans
 * rien changer ici. L'historique vit en mémoire, le temps qu'un escalier reste ouvert.
 */

/** Nombre d'étapes gardées pour annuler. */
export const HISTORY_LIMIT = 100;
/** Délai entre deux frappes dans un même champ au-delà duquel une nouvelle étape commence, en ms. */
export const HISTORY_DELAY = 1000;

export interface HistoryOptions {
  limit?: number;
  delay?: number;
  now?: () => number;
}

export class History<T> {
  private past: string[] = [];
  private future: string[] = [];
  private present: string;
  /** Champ de la dernière étape et heure de sa dernière modification, pour regrouper une frappe continue. */
  private group: { key: string; at: number } | null = null;
  private readonly limit: number;
  private readonly delay: number;
  private readonly now: () => number;

  constructor(state: T, opts: HistoryOptions = {}) {
    this.present = JSON.stringify(state);
    this.limit = opts.limit ?? HISTORY_LIMIT;
    this.delay = opts.delay ?? HISTORY_DELAY;
    this.now = opts.now ?? Date.now;
  }

  /** Repart de cet état, sans rien à annuler ni à rétablir. */
  reset(state: T): void {
    this.present = JSON.stringify(state);
    this.past = [];
    this.future = [];
    this.group = null;
  }

  /**
   * Enregistre l'état courant s'il a changé. Avec une clé (le champ modifié), un changement du même
   * champ peu après le précédent prolonge la dernière étape au lieu d'en ouvrir une. Un nouveau
   * changement efface ce qui restait à rétablir. Renvoie vrai si l'état a changé.
   */
  record(state: T, key?: string): boolean {
    const s = JSON.stringify(state);
    if (s === this.present) return false;
    const t = this.now();
    const g = this.group;
    if (!(key && g && g.key === key && t - g.at <= this.delay)) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.present = s;
    this.future = [];
    this.group = key ? { key, at: t } : null;
    return true;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** État précédent, ou null s'il n'y a rien à annuler. */
  undo(): T | null {
    const s = this.past.pop();
    if (s === undefined) return null;
    this.future.push(this.present);
    return this.move(s);
  }

  /** État annulé en dernier, ou null s'il n'y a rien à rétablir. */
  redo(): T | null {
    const s = this.future.pop();
    if (s === undefined) return null;
    this.past.push(this.present);
    return this.move(s);
  }

  private move(s: string): T {
    this.present = s;
    this.group = null;
    return JSON.parse(s) as T;
  }
}
