import { DROITS, enLecture, type Droits } from "../core/niveaux";
import { DEFAULTS, type Params } from "../core/params";
import { edited, newProject, type Mode, type Project } from "../core/project";
import { linkOpensNew, sameLink } from "../core/share";
import { newId, type ProjectStore } from "./store";

/**
 * Pourquoi un escalier prend l'écran :
 * - `ouvert` : choisi, reçu par lien, exemple ou nouveau ; l'écran repart de zéro (accueil fermé, historique vidé) ;
 * - `version` : version reçue d'un autre appareil ou d'un autre onglet ; l'écran en cours reste, l'historique repart ;
 * - `supprime` : l'escalier ouvert a été supprimé ailleurs, le suivant (ou aucun) prend sa place ;
 * - `devis` : même version, seul son devis change (caché quand la session se perd, revenu à la reconnexion).
 */
export type Raison = "ouvert" | "version" | "supprime" | "devis";

/** Ce que la page fournit à l'escalier ouvert. */
export interface OuvertHost {
  /** Met `p` à l'écran ; `p` est déjà l'escalier ouvert. null : il n'en reste aucun. */
  montrer(p: Project | null, raison: Raison): void;
  /** Ce que l'écran dit de l'escalier ouvert a changé : reçu ou gardé, lecture seule. */
  affiche(): void;
  /** Fait la place d'un nouvel escalier (au gratuit, après confirmation) ; faux si l'artisan refuse. */
  makeRoom(): Promise<boolean>;
  /** Réglages du profil de l'atelier. */
  atelier(): Params;
}

/**
 * L'escalier à l'écran et ce qu'on en garde. Un escalier reçu par lien, ou l'exemple quand la place manque, se montre
 * sans être enregistré ; le premier geste de l'artisan le garde, s'il reste de la place au niveau. Au-delà de la
 * limite du niveau, les escaliers les moins récents sont en lecture seule : rien ne s'y enregistre.
 */
export class EscalierOuvert {
  private p: Project | null = null;
  /** Escalier montré sans être gardé, tant que l'artisan n'y a pas touché. */
  private recevant: { id: string; quoi: "lien" | "exemple" } | null = null;
  private lecture = new Set<string>();
  /** Escaliers gardés, relus avec la liste. */
  private gardes = 0;

  constructor(
    private store: ProjectStore,
    private host: OuvertHost,
    private niv: Droits = DROITS.premium,
  ) {}

  get projet(): Project | null {
    return this.p;
  }

  get droits(): Droits {
    return this.niv;
  }

  /** L'escalier à l'écran n'est pas encore gardé : reçu par lien, ou l'exemple. */
  get recu(): "lien" | "exemple" | null {
    return this.p && this.p.id === this.recevant?.id ? this.recevant.quoi : null;
  }

  get lectureSeule(): boolean {
    return this.p !== null && !this.recu && this.lecture.has(this.p.id);
  }

  /** La fiche porte le filigrane d'un brouillon ; `extrait` : sa première page seulement. */
  fiche(): { brouillon: boolean; extrait: boolean } {
    const extrait = !this.niv.ficheComplete;
    return { brouillon: this.p?.etat !== "fini" || extrait, extrait };
  }

  /** Réglages de départ d'un nouvel escalier : ceux de l'atelier quand le niveau les comprend. */
  depart(): Params {
    return this.niv.atelier ? this.host.atelier() : { ...DEFAULTS };
  }

  /** Niveau de l'appareil, relu quand le compte change ; la lecture seule suit. */
  niveau(d: Droits): void {
    if (d === this.niv) return;
    this.niv = d;
    void this.relire();
  }

  /** Liste relue (ici ou par l'accueil) : nombre d'escaliers gardés et lecture seule. */
  liste(all: readonly Project[]): void {
    this.lecture = enLecture(this.niv, all);
    this.gardes = all.length;
    this.host.affiche();
  }

  async relire(): Promise<void> {
    this.liste(await this.store.list());
  }

  /** Ouvre un escalier ; null quand il n'en reste aucun. */
  ouvrir(p: Project | null): void {
    void this.relire();
    this.p = p;
    this.host.montrer(p, "ouvert");
  }

  /** Premier ouverture de la page : le dernier escalier ouvert, puis celui du lien de l'adresse s'il y en a un. */
  async demarrer(lien: Params | null): Promise<void> {
    await this.relire();
    const id = await this.store.currentId();
    const start = (id && (await this.store.get(id))) || (await this.store.list())[0] || null;
    // Sur un appareil vide, l'accueil ne passe pas avant l'escalier du lien.
    if (start || !lien) this.ouvrir(start);
    if (start) void this.store.setCurrent(start.id);
    if (lien) await this.lien(lien);
  }

  /** Nouvel escalier, gardé tout de suite ; en pas à pas sauf choix contraire. */
  async nouveau(nom = "", mode: Mode = "guide", params: Params = this.depart()): Promise<void> {
    if (!(await this.host.makeRoom())) return;
    const q = newProject(newId(), nom, mode, Date.now(), params);
    await this.store.save(q);
    await this.store.setCurrent(q.id);
    this.ouvrir(q);
  }

  /** Un lien montre son escalier sans rien écrire. Déjà gardé, il le rouvre plutôt que d'en préparer une copie. */
  async lien(link: Params): Promise<void> {
    if (!linkOpensNew(link, this.p?.params ?? null)) return;
    const kept = (await this.store.list()).find((q) => sameLink(q.params, link));
    if (kept) {
      this.ouvrir(kept);
      void this.store.setCurrent(kept.id);
      return;
    }
    this.recevoir(newProject(newId(), "Escalier reçu par lien", "complet", Date.now(), link), "lien");
  }

  /** L'exemple : un nouvel escalier, ou, au gratuit, à regarder sans prendre la place de l'escalier gardé. */
  async exemple(): Promise<void> {
    await this.relire();
    if (this.gardes < this.niv.escaliers) return this.nouveau("Exemple", "complet", { ...DEFAULTS });
    this.recevoir(newProject(newId(), "Exemple", "complet", Date.now(), { ...DEFAULTS }), "exemple");
  }

  private recevoir(q: Project, quoi: "lien" | "exemple"): void {
    this.recevant = { id: q.id, quoi };
    this.ouvrir(q);
  }

  /** Geste de l'artisan sur l'escalier (réglage, retour à l'exemple, correction) : garde l'escalier reçu. */
  geste(): void {
    if (this.recu) this.enregistrer();
  }

  /** « Garder cet escalier » : au gratuit, il prend la place de l'escalier gardé, après confirmation. */
  async garder(): Promise<void> {
    if (this.gardes < this.niv.escaliers) return this.geste();
    if (!(await this.host.makeRoom())) return;
    await this.relire();
    this.geste();
  }

  /** Changement fait par l'artisan (nom, état, étape, devis), enregistré ; le premier garde l'escalier reçu. */
  change(f: (p: Project) => Project): void {
    if (!this.p) return;
    this.p = f(this.p);
    this.enregistrer();
  }

  /**
   * Réglages relus des champs. Changés, ils repassent un escalier terminé en brouillon (`brouillon`). Sans geste de
   * l'artisan, un écart de relecture des champs n'enregistre pas un escalier reçu, ni un escalier en lecture seule.
   */
  regle(params: Params): "inchange" | "modifie" | "brouillon" {
    if (!this.p) return "inchange";
    const avant = this.p;
    const changed = edited(avant, params, Date.now());
    if (changed === avant) return "inchange";
    this.p = changed;
    if (!this.recu && !this.lectureSeule) void this.store.save(changed);
    return changed.etat !== avant.etat ? "brouillon" : "modifie";
  }

  /** Escaliers changés sur un autre appareil ou dans un autre onglet : l'ouvert se met à jour, ou laisse la place. */
  async ailleurs(ids: readonly string[]): Promise<void> {
    await this.relire();
    if (!this.p || !ids.includes(this.p.id)) return;
    const p = await this.store.get(this.p.id);
    if (p) {
      if (p.modifie !== this.p.modifie) {
        this.p = p;
        this.host.montrer(p, "version");
      } else {
        this.p = { ...this.p, devis: p.devis };
        this.host.montrer(this.p, "devis");
      }
      return;
    }
    const next = (await this.store.list())[0] ?? null;
    this.p = next;
    this.host.montrer(next, "supprime");
    if (next) void this.store.setCurrent(next.id);
  }

  /** Enregistre l'escalier ouvert ; le premier enregistrement garde l'escalier reçu, s'il reste de la place. */
  private enregistrer(): void {
    if (!this.p || this.lectureSeule) return;
    if (this.recu) {
      // Au gratuit, un escalier reçu ne prend la place du sien que par « Garder cet escalier ».
      if (this.gardes >= this.niv.escaliers) return;
      this.gardes++;
      this.recevant = null;
      this.host.affiche();
      void this.store.setCurrent(this.p.id);
    }
    void this.store.save(this.p);
  }
}
