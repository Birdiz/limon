import { sanitizeParams } from "../core/params";
import { NOM_PAR_DEFAUT, newProject, sanitizeProject, type Project } from "../core/project";

/** Interface commune au stockage de l'appareil et à sa recopie dans le compte. */
export interface ProjectStore {
  /** Projets, le plus récemment modifié en premier. */
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  save(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
  /** Dernier projet ouvert. */
  currentId(): Promise<string | null>;
  setCurrent(id: string | null): Promise<void>;
}

const PROJECTS_KEY = "limon-projets";
const CURRENT_KEY = "limon-courant";
/** Réglages de la version à projet unique, repris une fois comme premier projet. */
const LEGACY_KEY = "limon-v2";

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

/** Stockage du navigateur ; un autre dans les tests, pour simuler plusieurs appareils. */
export type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserStorage(): KeyValue | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function read(store: KeyValue | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Valeur JSON enregistrée, sans en vérifier la forme ; null si elle est absente ou illisible. */
export function readJSON(store: KeyValue | null, key: string): unknown {
  try {
    return JSON.parse(read(store, key) ?? "null");
  } catch {
    return null;
  }
}

/** Vrai si l'écriture a eu lieu. */
export function write(store: KeyValue | null, key: string, value: string | null): boolean {
  if (!store) return false;
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
    return true;
  } catch {
    // Stockage indisponible ou plein : à l'appelant de le dire, la mémoire ne survit pas au rechargement.
    return false;
  }
}

/**
 * Projets dans le localStorage de ce navigateur, que les autres onglets écrivent aussi : chaque écriture relit le
 * stockage et n'y porte que les changements faits ici, le plus récent gagnant, projet par projet.
 */
export class LocalStore implements ProjectStore {
  /** Copie en mémoire, qui sert aussi quand le stockage est indisponible. */
  private projects: Project[];
  private current: string | null;
  /** Changements faits ici et pas encore écrits, null pour une suppression. Il n'en reste que si le stockage refuse. */
  private unwritten = new Map<string, Project | null>();
  private written: boolean;
  private changeListeners: ((ids: string[]) => void)[] = [];
  private storedListeners: (() => void)[] = [];

  constructor(private storage: KeyValue | null = browserStorage()) {
    this.written = storage !== null;
    const stored = this.readProjects();
    this.projects = stored ?? this.migrate();
    this.current = read(storage, CURRENT_KEY);
    if (!stored && this.projects.length) {
      this.current = this.projects[0]!.id;
      for (const p of this.projects) this.unwritten.set(p.id, p);
      this.flush();
      write(storage, CURRENT_KEY, this.current);
    }
  }

  /** Projets du stockage ; null s'il n'en dit rien : indisponible, vide ou abîmé. */
  private readProjects(): Project[] | null {
    const raw = readJSON(this.storage, PROJECTS_KEY);
    return Array.isArray(raw) ? raw.map(sanitizeProject).filter((p): p is Project => p !== null) : null;
  }

  private migrate(): Project[] {
    // Absente, il n'y a rien à reprendre ; illisible, elle donne quand même un escalier, aux réglages de l'exemple.
    if (read(this.storage, LEGACY_KEY) === null) return [];
    const params = sanitizeParams(readJSON(this.storage, LEGACY_KEY));
    return [newProject(newId(), NOM_PAR_DEFAUT, "complet", Date.now(), params)];
  }

  /** Recale la copie en mémoire sur le stockage et renvoie les projets que d'autres onglets ont changés. */
  private reload(): string[] {
    const stored = this.readProjects();
    if (!stored) return [];
    const merged = new Map(stored.map((p) => [p.id, p]));
    for (const [id, mine] of this.unwritten) {
      const theirs = merged.get(id);
      if (!mine) merged.delete(id);
      else if (!theirs || mine.modifie >= theirs.modifie) merged.set(id, mine);
    }
    const before = new Map(this.projects.map((p) => [p.id, p.modifie]));
    this.projects = [...merged.values()];
    return [...new Set([...before.keys(), ...merged.keys()])].filter(
      (id) => before.get(id) !== merged.get(id)?.modifie,
    );
  }

  /**
   * Écrit les projets. Seule cette écriture décide de `stored` : le projet ouvert, écrit à côté, est une petite valeur
   * qui passe encore quand le stockage est plein.
   */
  private flush(): void {
    const changed = this.reload();
    this.writeProjects();
    this.emit(changed);
  }

  private writeProjects(): void {
    const written = write(this.storage, PROJECTS_KEY, JSON.stringify(this.projects));
    if (written) this.unwritten.clear();
    if (written !== this.written) {
      this.written = written;
      for (const cb of this.storedListeners) cb();
    }
  }

  private emit(ids: string[]): void {
    if (ids.length) for (const cb of this.changeListeners) cb(ids);
  }

  /** Écoute les écritures des autres onglets ; le navigateur ne prévient pas celui qui écrit. */
  watch(): void {
    window.addEventListener("storage", (e) => {
      if (e.key !== PROJECTS_KEY) return;
      // Des changements attendent : l'autre onglet a peut-être libéré de la place.
      if (this.unwritten.size) this.flush();
      else this.emit(this.reload());
    });
  }

  /** Projets changés par un autre onglet. */
  onChange(cb: (ids: string[]) => void): void {
    this.changeListeners.push(cb);
  }

  /** La réponse de `stored` change. */
  onStored(cb: () => void): void {
    this.storedListeners.push(cb);
  }

  /** Faux tant que le stockage refuse d'écrire les projets : ils ne survivraient pas au rechargement. */
  stored(): boolean {
    return this.written;
  }

  list(): Promise<Project[]> {
    return Promise.resolve([...this.projects].sort((a, b) => b.modifie - a.modifie));
  }

  get(id: string): Promise<Project | null> {
    return Promise.resolve(this.projects.find((p) => p.id === id) ?? null);
  }

  save(p: Project): Promise<void> {
    const i = this.projects.findIndex((q) => q.id === p.id);
    if (i < 0) this.projects.push(p);
    else this.projects[i] = p;
    this.unwritten.set(p.id, p);
    this.flush();
    return Promise.resolve();
  }

  /** Ramène la date d'un projet en arrière, ce que `save` ne fait pas : entre onglets, la plus récente l'emporte. */
  redate(id: string, modifie: number): Promise<void> {
    const changed = this.reload();
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, modifie } : p));
    this.writeProjects();
    this.emit(changed);
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.unwritten.set(id, null);
    if (this.current === id) void this.setCurrent(null);
    this.flush();
    return Promise.resolve();
  }

  currentId(): Promise<string | null> {
    return Promise.resolve(this.current);
  }

  setCurrent(id: string | null): Promise<void> {
    this.current = id;
    write(this.storage, CURRENT_KEY, id);
    return Promise.resolve();
  }
}
