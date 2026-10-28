import { sanitizeProject, type Project } from "../core/project";
import type { ProjectStore } from "./store";

/* Déménagement vers quart-de-tour.fr. Les projets des premiers utilisateurs sont dans le stockage
   du navigateur à l'ancienne adresse, que la nouvelle ne peut pas lire : l'ancienne page part vers la
   nouvelle en les emportant dans l'ancre de l'adresse, qui n'est jamais envoyée au serveur. */

const OLD_HOST = "limon-escaliers.up.railway.app";
const NEW_ORIGIN = "https://quart-de-tour.fr";
const KEY = "#transfert=";

export interface Moved {
  projets: Project[];
  courant: string | null;
  /** Ancre d'un lien de projet ouvert à l'ancienne adresse. */
  lien: string;
}

/** À l'ancienne adresse : part vers la nouvelle avec les projets ; vrai si la page s'en va. */
export function leaveOldHost(store: ProjectStore): boolean {
  if (location.hostname !== OLD_HOST) return false;
  const lien = location.hash;
  void (async () => {
    const projets = await store.list();
    const moved: Moved = { projets, courant: await store.currentId(), lien };
    const hash = projets.length ? KEY + encodeURIComponent(JSON.stringify(moved)) : lien;
    location.replace(`${NEW_ORIGIN}/${hash}`);
  })();
  return true;
}

/** Projets arrivés de l'ancienne adresse, lus avant que le premier calcul réécrive l'ancre. */
export function takeMoved(): Moved | null {
  if (!location.hash.startsWith(KEY)) return null;
  const text = location.hash.slice(KEY.length);
  history.replaceState(null, "", location.pathname);
  let raw: unknown;
  try {
    raw = JSON.parse(decodeURIComponent(text));
  } catch {
    return null;
  }
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    projets: Array.isArray(r.projets) ? r.projets.map(sanitizeProject).filter((p): p is Project => p !== null) : [],
    courant: typeof r.courant === "string" ? r.courant : null,
    lien: typeof r.lien === "string" ? r.lien : "",
  };
}

/** Range les projets reçus : un projet déjà présent garde sa version la plus récente. */
export async function storeMoved(store: ProjectStore, m: Moved): Promise<void> {
  for (const p of m.projets) {
    const q = await store.get(p.id);
    if (!q || q.modifie < p.modifie) await store.save(p);
  }
  if (m.courant && (await store.get(m.courant))) await store.setCurrent(m.courant);
}
