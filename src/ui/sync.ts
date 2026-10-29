import type { Changement, Compte, Entree } from "../core/account";
import { sanitizeProject, type Project } from "../core/project";
import { NotSignedIn, type Api } from "./api";
import type { AtelierStore } from "./atelier";
import { browserStorage, read, write, type KeyValue, type LocalStore, type ProjectStore } from "./store";

const SYNC_KEY = "limon-synchro";
/** Délai entre la dernière modification et l'envoi. */
const DEBOUNCE = 3000;
/** Le navigateur refuse un envoi `keepalive` de plus de 64 ko. */
const KEEPALIVE_MAX = 60_000;

interface SyncState {
  /** Compte connecté sur cet appareil. */
  compte: Compte | null;
  /**
   * E-mail du dernier compte connecté, gardé quand la session expire, pour reconnaître une autre personne.
   * L'e-mail plutôt que l'identifiant : un compte supprimé puis recréé avec la même adresse garde ses projets.
   */
  dernier: string | null;
  /** Version de chaque projet que le serveur avait au dernier échange. */
  serveur: Record<string, number>;
  /** Suppressions pas encore envoyées, avec leur date. */
  supprimes: Record<string, number>;
}

const EMPTY: SyncState = { compte: null, dernier: null, serveur: {}, supprimes: {} };

export interface SyncStatus {
  compte: Compte | null;
  /** Projets modifiés ou supprimés ici, pas encore envoyés. */
  pending: number;
  /** Le dernier échange a échoué faute de réseau ou de serveur. */
  offline: boolean;
}

/**
 * Projets de l'appareil, recopiés dans le compte quand on est connecté. Tout se lit et s'écrit dans
 * le LocalStore, tout de suite ; l'échange avec le serveur se fait en arrière-plan, sans bouton.
 * La version modifiée en dernier gagne, projet par projet ; une suppression est une trace datée.
 * Le projet ouvert (`currentId`) reste propre à chaque appareil.
 */
export class SyncStore implements ProjectStore {
  private state: SyncState;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private offline = false;
  private changeListeners: ((ids: string[]) => void)[] = [];
  private statusListeners: (() => void)[] = [];

  constructor(
    private local: LocalStore,
    private api: Api,
    private storage: KeyValue | null = browserStorage(),
    private atelier: AtelierStore | null = null,
  ) {
    let raw: Partial<SyncState> | null;
    try {
      raw = JSON.parse(read(storage, SYNC_KEY) ?? "null") as Partial<SyncState> | null;
    } catch {
      raw = null;
    }
    this.state = { ...EMPTY, ...raw };
  }

  /** Échanges au démarrage, au retour du réseau, au retour sur la page et toutes les 5 minutes. */
  start(): void {
    window.addEventListener("online", () => void this.sync());
    document.addEventListener("visibilitychange", () => void this.sync(document.hidden));
    setInterval(() => {
      if (!document.hidden) void this.sync();
    }, 300_000);
    void this.sync();
  }

  list(): Promise<Project[]> {
    return this.local.list();
  }

  get(id: string): Promise<Project | null> {
    return this.local.get(id);
  }

  async save(p: Project): Promise<void> {
    await this.local.save(p);
    if (this.state.compte) this.schedule();
  }

  async remove(id: string): Promise<void> {
    await this.local.remove(id);
    if (!this.state.compte && !(id in this.state.serveur)) return;
    this.state.supprimes[id] = Date.now();
    this.persist();
    if (this.state.compte) this.schedule();
  }

  currentId(): Promise<string | null> {
    return this.local.currentId();
  }

  setCurrent(id: string | null): Promise<void> {
    return this.local.setCurrent(id);
  }

  /** Profil de l'atelier modifié ici : il part au prochain envoi. */
  atelierChanged(): void {
    if (this.state.compte) this.schedule();
  }

  /** Projets ajoutés, changés ou supprimés par un échange avec le serveur. */
  onChange(cb: (ids: string[]) => void): void {
    this.changeListeners.push(cb);
  }

  onStatus(cb: () => void): void {
    this.statusListeners.push(cb);
  }

  account(): Compte | null {
    return this.state.compte;
  }

  async status(): Promise<SyncStatus> {
    return {
      compte: this.state.compte,
      pending: this.state.compte ? (await this.pending()).length : 0,
      offline: this.offline,
    };
  }

  /** Connexion réussie : les projets de l'appareil montent dans le compte, ceux du compte descendent. */
  async signIn(compte: Compte): Promise<void> {
    let changed: string[] = [];
    if (this.state.dernier && this.state.dernier !== compte.email) {
      // Autre compte que le précédent : les projets de celui-ci, à l'abri dans son compte, quittent l'appareil.
      changed = await this.removeSynced();
      this.atelier?.clear();
      this.state.serveur = {};
      this.state.supprimes = {};
    }
    this.state.compte = compte;
    this.state.dernier = compte.email;
    this.persist();
    this.emit(changed);
    await this.sync();
  }

  /**
   * Déconnexion : tout est envoyé, puis les projets du compte quittent l'appareil. Refusée s'il reste
   * des modifications à envoyer (hors ligne).
   */
  async signOut(): Promise<void> {
    await this.sync();
    if (this.state.compte && (await this.pending()).length)
      throw new Error(
        "Des modifications n'ont pas encore pu être envoyées : retrouvez du réseau avant de vous déconnecter.",
      );
    try {
      await this.api.logout();
    } catch (e) {
      if (!(e instanceof NotSignedIn)) throw e;
    }
    this.emit(await this.removeSynced());
    this.atelier?.clear();
    this.reset();
  }

  /** Retire de l'appareil les projets dont le serveur a la dernière version. */
  private async removeSynced(): Promise<string[]> {
    const removed: string[] = [];
    for (const p of await this.local.list()) {
      const known = this.state.serveur[p.id];
      if (known !== undefined && p.modifie <= known) {
        await this.local.remove(p.id);
        removed.push(p.id);
      }
    }
    return removed;
  }

  /** Compte supprimé : les projets restent sur cet appareil, comme avant d'avoir un compte. */
  async deleteAccount(): Promise<void> {
    await this.api.deleteAccount();
    this.reset();
  }

  /** La session a expiré ou le compte n'existe plus. */
  sessionLost(): void {
    if (!this.state.compte) return;
    this.state.compte = null;
    this.persist();
    this.emitStatus();
  }

  /** Échange avec le serveur ; un seul à la fois, relancé si on le redemande pendant qu'il tourne. */
  sync(keepalive = false): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.exchange(keepalive);
      } while (this.again);
    })().finally(() => (this.running = null));
    return this.running;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), DEBOUNCE);
    this.emitStatus();
  }

  /** Versions plus récentes ici que sur le serveur, et suppressions à envoyer. */
  private async pending(): Promise<Changement[]> {
    const { serveur, supprimes } = this.state;
    const changes: Changement[] = (await this.local.list())
      .filter((p) => !(p.id in serveur) || p.modifie > serveur[p.id]!)
      .map((p) => ({ id: p.id, projet: p }));
    for (const [id, modifie] of Object.entries(supprimes)) changes.push({ id, modifie, supprime: true });
    return changes;
  }

  private async exchange(keepalive: boolean): Promise<void> {
    if (!this.state.compte) return;
    try {
      const changes = await this.pending();
      const small = JSON.stringify(changes).length < KEEPALIVE_MAX;
      const index = changes.length ? await this.api.push(changes, keepalive && small) : await this.api.index();
      await this.apply(index);
      await this.exchangeAtelier();
      this.offline = false;
      // Un projet absent de l'index n'a jamais atteint ce compte (ou le compte a été recréé) : il part au tour suivant.
      if (!changes.length && (await this.pending()).length) this.again = true;
    } catch (e) {
      if (e instanceof NotSignedIn) this.state.compte = null;
      else this.offline = true;
      this.persist();
    }
    this.emitStatus();
  }

  /** Profil de l'atelier : le plus récent des deux côtés l'emporte, comme pour un projet. */
  private async exchangeAtelier(): Promise<void> {
    if (!this.atelier) return;
    const mine = this.atelier.get();
    const theirs = mine ? await this.api.pushAtelier(mine) : await this.api.atelierOf();
    if (theirs && theirs.modifie > (mine?.modifie ?? 0)) this.atelier.adopt(theirs);
  }

  /** Range l'index du serveur : télécharge ce qui est plus récent en ligne, retire ce qui y a été supprimé. */
  private async apply(index: Entree[]): Promise<void> {
    const { supprimes } = this.state;
    /** Suppressions que le serveur n'a plus besoin de recevoir. */
    const settled = new Set<string>();
    const serveur: Record<string, number> = {};
    const wanted: string[] = [];
    const changed: string[] = [];
    for (const e of index) {
      const p = await this.local.get(e.id);
      const deleted = supprimes[e.id];
      if (e.supprime) {
        if (deleted !== undefined && deleted <= e.modifie) settled.add(e.id);
        if (p && p.modifie <= e.modifie) {
          await this.local.remove(e.id);
          changed.push(e.id);
        }
        continue;
      }
      serveur[e.id] = e.modifie;
      if (deleted !== undefined) {
        // Supprimé ici, mais modifié ailleurs depuis : il revient.
        if (deleted < e.modifie) {
          settled.add(e.id);
          wanted.push(e.id);
        }
      } else if (!p || p.modifie < e.modifie) wanted.push(e.id);
    }
    for (let i = 0; i < wanted.length; i += 500)
      for (const raw of await this.api.fetchProjects(wanted.slice(i, i + 500))) {
        const q = sanitizeProject(raw);
        if (!q) continue;
        // Une modification faite ici pendant l'échange reste la plus récente.
        const cur = await this.local.get(q.id);
        if (cur && cur.modifie >= q.modifie) continue;
        await this.local.save(q);
        changed.push(q.id);
      }
    this.state.serveur = serveur;
    this.state.supprimes = Object.fromEntries(Object.entries(supprimes).filter(([id]) => !settled.has(id)));
    this.persist();
    this.emit(changed);
  }

  private reset(): void {
    clearTimeout(this.timer);
    this.state = { ...EMPTY, serveur: {}, supprimes: {} };
    this.offline = false;
    this.persist();
    this.emitStatus();
  }

  private persist(): void {
    write(this.storage, SYNC_KEY, JSON.stringify(this.state));
  }

  private emit(ids: string[]): void {
    if (ids.length) for (const cb of this.changeListeners) cb(ids);
  }

  private emitStatus(): void {
    for (const cb of this.statusListeners) cb();
  }
}
