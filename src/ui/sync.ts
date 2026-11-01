import type { Changement, Compte, Entree, Refus } from "../core/account";
import { sanitizeProject, stamped, type Project } from "../core/project";
import { ApiError, NotSignedIn, type Api } from "./api";
import type { AtelierStore } from "./atelier";
import { browserStorage, read, write, type KeyValue, type LocalStore, type ProjectStore } from "./store";

const SYNC_KEY = "limon-synchro";
/** Délai entre la dernière modification et l'envoi. */
const DEBOUNCE = 3000;
/** Le navigateur refuse un envoi `keepalive` de plus de 64 ko. */
const KEEPALIVE_MAX = 60_000;
/** Éléments par envoi, comme la lecture. */
const LOT_MAX = 500;
/** Octets par envoi : le serveur en accepte 4 Mo, et un projet plein de devis pèse près de 60 ko. */
const LOT_OCTETS = 3 << 20;

interface SyncState {
  /** Compte connecté sur cet appareil. */
  compte: Compte | null;
  /**
   * E-mail du dernier compte connecté, gardé quand la session expire, pour reconnaître une autre personne.
   * L'e-mail plutôt que l'identifiant : un compte supprimé puis recréé avec la même adresse garde ses projets.
   */
  dernier: string | null;
  /** Un compte a déjà servi sur cet appareil, même déconnecté : on propose de s'y connecter plutôt que d'en créer un. */
  connu: boolean;
  /** Version de chaque projet que le serveur avait au dernier échange. */
  serveur: Record<string, number>;
  /** Suppressions pas encore envoyées, avec leur date. */
  supprimes: Record<string, number>;
  /** Versions refusées par le serveur : elles ne comptent plus comme à envoyer, une autre version repart. */
  refuses: Record<string, { modifie: number; raison: string }>;
}

const EMPTY: SyncState = { compte: null, dernier: null, connu: false, serveur: {}, supprimes: {}, refuses: {} };

/** Découpe un envoi : 500 éléments au plus, et de quoi tenir dans ce que le serveur accepte. */
export function lots(changes: Changement[]): Changement[][] {
  const out: Changement[][] = [];
  let lot: Changement[] = [];
  let octets = 0;
  for (const ch of changes) {
    const n = new TextEncoder().encode(JSON.stringify(ch)).length;
    if (lot.length && (lot.length >= LOT_MAX || octets + n > LOT_OCTETS)) {
      out.push(lot);
      lot = [];
      octets = 0;
    }
    lot.push(ch);
    octets += n;
  }
  if (lot.length) out.push(lot);
  return out;
}

/** Escalier ou suppression refusé par le serveur ; `nom` est null pour une suppression, l'escalier n'est plus là. */
export interface RefusVu extends Refus {
  nom: string | null;
}

export interface SyncStatus {
  compte: Compte | null;
  /** Projets modifiés ou supprimés ici, pas encore envoyés. */
  pending: number;
  /** Le dernier échange a échoué faute de réseau. */
  offline: boolean;
  /** Le serveur a répondu non au dernier échange, en entier ou pour le profil de l'atelier : ses mots. */
  erreur: string | null;
  /** Ce que le serveur a refusé élément par élément. */
  refuses: RefusVu[];
  /** Le stockage de l'appareil accepte les projets. */
  stored: boolean;
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
  private erreur: string | null = null;
  /** Les refus sont retentés une fois par chargement de la page : l'heure a pu avancer, le compte a pu changer. */
  private retry = true;
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
    // État enregistré avant `connu`.
    this.state.connu ||= !!this.state.dernier;
    local.onChange((ids) => {
      this.emit(ids);
      this.emitStatus();
    });
    local.onStored(() => this.emitStatus());
  }

  /** Échanges au démarrage, au retour du réseau, au retour sur la page et toutes les 5 minutes. */
  start(): void {
    this.local.watch();
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
    const p = await this.local.get(id);
    await this.local.remove(id);
    if (id in this.state.refuses) {
      this.state.refuses = Object.fromEntries(Object.entries(this.state.refuses).filter(([k]) => k !== id));
      this.persist();
      // Refusé et jamais arrivé : le serveur n'a rien à supprimer.
      if (!(id in this.state.serveur)) return this.emitStatus();
    }
    if (!this.state.compte && !(id in this.state.serveur)) return;
    this.state.supprimes[id] = p ? stamped(p, Date.now()) : Date.now();
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

  /** Projets ajoutés, changés ou supprimés par un échange avec le serveur ou par un autre onglet. */
  onChange(cb: (ids: string[]) => void): void {
    this.changeListeners.push(cb);
  }

  onStatus(cb: () => void): void {
    this.statusListeners.push(cb);
  }

  account(): Compte | null {
    return this.state.compte;
  }

  /** Un compte a déjà servi sur cet appareil, connecté ou non. */
  known(): boolean {
    return this.state.connu;
  }

  async status(): Promise<SyncStatus> {
    return {
      compte: this.state.compte,
      pending: this.state.compte ? (await this.pending()).length : 0,
      offline: this.offline,
      erreur: this.erreur,
      refuses: this.state.compte ? await this.refused() : [],
      stored: this.local.stored(),
    };
  }

  /** Refus qui valent encore : la version refusée est toujours celle de l'appareil. */
  private async refused(): Promise<RefusVu[]> {
    const out: RefusVu[] = [];
    for (const [id, r] of Object.entries(this.state.refuses)) {
      const p = await this.local.get(id);
      if (p?.modifie === r.modifie) out.push({ id, nom: p.nom, raison: r.raison });
      else if (this.state.supprimes[id] === r.modifie) out.push({ id, nom: null, raison: r.raison });
    }
    return out;
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
      this.state.refuses = {};
    }
    this.state.compte = compte;
    this.state.dernier = compte.email;
    this.state.connu = true;
    this.persist();
    this.emit(changed);
    await this.sync();
  }

  /**
   * Déconnexion : tout est envoyé, puis les projets du compte quittent l'appareil. Refusée s'il reste
   * des modifications à envoyer (hors ligne, ou serveur qui répond non). Un projet refusé ne bloque pas : il reste ici.
   */
  async signOut(): Promise<void> {
    await this.sync();
    if (this.state.compte && (await this.pending()).length)
      throw new Error(
        this.erreur
          ? `Des modifications n'ont pas encore pu être envoyées. ${this.erreur}`
          : "Des modifications n'ont pas encore pu être envoyées : retrouvez du réseau avant de vous déconnecter.",
      );
    try {
      await this.api.logout();
    } catch (e) {
      if (!(e instanceof NotSignedIn)) throw e;
    }
    this.emit(await this.removeSynced());
    this.atelier?.clear();
    this.reset(true);
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
    this.reset(false);
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

  /** Versions plus récentes ici que sur le serveur, et suppressions à envoyer ; les refusées seulement à la demande. */
  private async pending(withRefused = false): Promise<Changement[]> {
    const { serveur, supprimes, refuses } = this.state;
    const skip = (id: string, modifie: number) => !withRefused && refuses[id]?.modifie === modifie;
    const changes: Changement[] = (await this.local.list())
      .filter((p) => (!(p.id in serveur) || p.modifie > serveur[p.id]!) && !skip(p.id, p.modifie))
      .map((p) => ({ id: p.id, projet: p }));
    for (const [id, modifie] of Object.entries(supprimes))
      if (!skip(id, modifie)) changes.push({ id, modifie, supprime: true });
    return changes;
  }

  /** Envoie par lots et note les refus ; renvoie l'index à jour. */
  private async send(changes: Changement[], keepalive: boolean): Promise<Entree[]> {
    const refuses = new Map(Object.entries(this.state.refuses));
    const versions = new Map(changes.map((ch) => [ch.id, "projet" in ch ? ch.projet.modifie : ch.modifie]));
    let index: Entree[] | null = null;
    for (const lot of lots(changes)) {
      for (const ch of lot) refuses.delete(ch.id);
      let refus: Refus[];
      try {
        const small = JSON.stringify(lot).length < KEEPALIVE_MAX;
        ({ index, refus } = await this.api.push(lot, keepalive && small));
      } catch (e) {
        // Un seul élément, trop gros pour le serveur : il est refusé, les autres lots partent.
        if (!(e instanceof ApiError && e.status === 413 && lot.length === 1)) throw e;
        index = null;
        refus = [{ id: lot[0]!.id, raison: "Cet escalier est trop gros pour être envoyé." }];
      }
      for (const { id, raison } of refus) {
        const modifie = versions.get(id);
        if (modifie !== undefined) refuses.set(id, { modifie, raison });
      }
    }
    this.state.refuses = Object.fromEntries(refuses);
    return index ?? (await this.api.index());
  }

  private async exchange(keepalive: boolean): Promise<void> {
    if (!this.state.compte) return;
    try {
      const changes = await this.pending(this.retry);
      const index = changes.length ? await this.send(changes, keepalive) : await this.api.index();
      await this.apply(index);
      this.retry = false;
      await this.exchangeAtelier();
      this.offline = false;
      this.erreur = null;
      // Un projet absent de l'index n'a jamais atteint ce compte (ou le compte a été recréé) : il part au tour suivant.
      if (!changes.length && (await this.pending()).length) this.again = true;
    } catch (e) {
      if (e instanceof NotSignedIn) this.state.compte = null;
      // Le serveur a répondu : ce n'est pas le réseau.
      else if (e instanceof ApiError) [this.offline, this.erreur] = [false, e.message];
      else [this.offline, this.erreur] = [true, null];
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

  private reset(connu: boolean): void {
    clearTimeout(this.timer);
    this.state = { ...EMPTY, connu, serveur: {}, supprimes: {}, refuses: {} };
    this.offline = false;
    this.erreur = null;
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
