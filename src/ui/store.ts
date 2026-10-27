import { sanitizeParams } from "../core/params";
import { NOM_PAR_DEFAUT, newProject, sanitizeProject, type Project } from "../core/project";

/** Projets de l'utilisateur. Asynchrone pour qu'un espace en ligne remplace un jour le stockage du navigateur. */
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

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible (navigation privée) : les projets ne survivent pas au rechargement.
  }
}

/** Projets dans le localStorage de ce navigateur. */
export class LocalStore implements ProjectStore {
  /** Copie en mémoire, qui sert aussi quand le stockage est indisponible. */
  private projects: Project[];
  private current: string | null;

  constructor() {
    let raw: unknown;
    try {
      raw = JSON.parse(read(PROJECTS_KEY) ?? "null");
    } catch {
      raw = null;
    }
    this.projects = Array.isArray(raw)
      ? raw.map(sanitizeProject).filter((p): p is Project => p !== null)
      : this.migrate();
    this.current = read(CURRENT_KEY);
    if (!Array.isArray(raw) && this.projects.length) {
      this.current = this.projects[0]!.id;
      this.flush();
    }
  }

  private migrate(): Project[] {
    const legacy = read(LEGACY_KEY);
    if (legacy === null) return [];
    let params;
    try {
      params = sanitizeParams(JSON.parse(legacy));
    } catch {
      params = sanitizeParams(null);
    }
    return [newProject(newId(), NOM_PAR_DEFAUT, "complet", Date.now(), params)];
  }

  private flush(): void {
    write(PROJECTS_KEY, JSON.stringify(this.projects));
    write(CURRENT_KEY, this.current);
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
    this.flush();
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.current === id) this.current = null;
    this.flush();
    return Promise.resolve();
  }

  currentId(): Promise<string | null> {
    return Promise.resolve(this.current);
  }

  setCurrent(id: string | null): Promise<void> {
    this.current = id;
    this.flush();
    return Promise.resolve();
  }
}
