import type { Project } from "../core/project";
import { FORME_LABEL } from "../core/summary";
import { byId, esc } from "./dom";
import type { ProjectStore } from "./store";

const day = (ms: number) => new Date(ms).toLocaleDateString("fr-FR");

/** Ce que la page fournit à l'accueil. */
export interface HomeHost {
  current(): Project | null;
  /** Nouvel escalier, en pas à pas. */
  create(): void;
  /** Escalier d'exemple, déjà calculé. */
  example(): void;
  open(p: Project): void;
  account(): void;
  signedIn(): boolean;
}

/** Accueil : au premier lancement, quand il ne reste aucun escalier, ou par le logo. */
export class Home {
  private list = byId<HTMLUListElement>("homeList");

  constructor(
    private store: ProjectStore,
    private host: HomeHost,
  ) {
    byId("homeNew").addEventListener("click", () => host.create());
    byId("homeEx").addEventListener("click", () => host.example());
    byId("homeBack").addEventListener("click", () => this.hide());
    byId("homeAcct").addEventListener("click", () => host.account());
    this.list.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (b)
        void store.get(b.dataset.id!).then((p) => {
          if (p) host.open(p);
        });
    });
  }

  async show(): Promise<void> {
    const cur = this.host.current();
    const back = byId("homeBack");
    back.hidden = !cur;
    if (cur) back.textContent = `Revenir à « ${cur.nom} »`;
    byId("homeInvite").hidden = this.host.signedIn();
    const all = await this.store.list();
    byId("homeListBox").hidden = !all.length;
    this.list.innerHTML = all
      .slice(0, 6)
      .map(
        (p) =>
          `<li><div><b>${esc(p.nom)}</b><small>${FORME_LABEL[p.params.forme]} · ${day(p.modifie)}</small></div>` +
          `<button class="btn" type="button" data-id="${p.id}">Ouvrir</button></li>`,
      )
      .join("");
    byId("home").hidden = false;
    document.body.classList.add("home-on");
    window.scrollTo(0, 0);
  }

  hide(): void {
    byId("home").hidden = true;
    document.body.classList.remove("home-on");
  }
}
