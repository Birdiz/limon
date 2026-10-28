import { fileBase, newProject, parseProjectFile, projectFile, type Mode, type Project } from "../core/project";
import { FORME_LABEL } from "../core/summary";
import { byId, downloadBytes, esc, flash } from "./dom";
import { newId, type ProjectStore } from "./store";

const day = (ms: number) => new Date(ms).toLocaleDateString("fr-FR");

/** Ce que la page fournit au dialogue : le projet ouvert et de quoi en ouvrir un autre. */
export interface ProjectsHost {
  current(): Project | null;
  /** null : plus aucun projet, la page attend qu'on en crée un. */
  open(p: Project | null): void;
  /** Connecté à un compte : les projets y sont aussi. */
  signedIn(): boolean;
}

/** Dialogue « Mes escaliers » : liste, création, duplication, suppression, copies en fichier .escalier. */
export class ProjectsDialog {
  private dlg = byId<HTMLDialogElement>("projets");
  private list = byId<HTMLUListElement>("pjList");
  private nom = byId<HTMLInputElement>("pjNom");
  private msg = byId("pjMsg");

  constructor(
    private store: ProjectStore,
    private host: ProjectsHost,
  ) {
    byId("pjGuide").addEventListener("click", () => void this.create("guide"));
    byId("pjFull").addEventListener("click", () => void this.create("complet"));
    byId("pjClose").addEventListener("click", () => this.dlg.close());
    this.list.addEventListener("click", (e) => void this.act(e));
    const file = byId<HTMLInputElement>("pjFile");
    byId("pjImport").addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      file.value = "";
      if (f) void this.importFile(f);
    });
    byId("pjExport").addEventListener("click", () => this.exportCurrent());
  }

  async show(): Promise<void> {
    await this.refresh();
    if (!this.dlg.open) this.dlg.showModal();
  }

  /** Liste à jour quand un autre appareil a changé des projets. */
  async refreshIfOpen(): Promise<void> {
    if (this.dlg.open) await this.refresh();
  }

  private async refresh(): Promise<void> {
    const cur = this.host.current();
    const all = await this.store.list();
    this.list.innerHTML = all.length
      ? all
          .map(
            (p) =>
              `<li${p.id === cur?.id ? ' class="cur"' : ""}><div><b>${esc(p.nom)}</b><small>${FORME_LABEL[p.params.forme]} · modifié le ${day(p.modifie)}${p.mode === "guide" ? " · pas à pas en cours" : ""}</small></div>` +
              `<div class="pjbtns">${p.id === cur?.id ? '<span class="pjcur">ouvert</span>' : `<button class="btn" type="button" data-act="open" data-id="${p.id}">Ouvrir</button>`}` +
              `<button class="btn" type="button" data-act="dup" data-id="${p.id}">Dupliquer</button>` +
              `<button class="btn danger" type="button" data-act="del" data-id="${p.id}">Supprimer</button></div></li>`,
          )
          .join("")
      : '<li class="empty">Aucun escalier pour l\'instant. Donnez-lui un nom et démarrez.</li>';
    byId("pjExport").hidden = !cur;
  }

  private openProject(p: Project): void {
    this.host.open(p);
    void this.store.setCurrent(p.id);
    this.dlg.close();
  }

  private async create(mode: Mode): Promise<void> {
    const p = newProject(newId(), this.nom.value, mode, Date.now());
    this.nom.value = "";
    await this.store.save(p);
    this.openProject(p);
  }

  private async act(e: Event): Promise<void> {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const p = b && (await this.store.get(b.dataset.id!));
    if (!b || !p) return;
    if (b.dataset.act === "open") this.openProject(p);
    else if (b.dataset.act === "dup") {
      const now = Date.now();
      await this.store.save({ ...p, id: newId(), nom: `${p.nom} (copie)`, cree: now, modifie: now });
      await this.refresh();
    } else if (b.dataset.act === "del") {
      const where = this.host.signedIn() ? "de cet appareil et de votre compte" : "de cet appareil";
      if (!confirm(`Supprimer « ${p.nom} » ? L'escalier sera effacé ${where}.`)) return;
      await this.store.remove(p.id);
      if (p.id === this.host.current()?.id) {
        const next = (await this.store.list())[0];
        if (next) {
          this.host.open(next);
          await this.store.setCurrent(next.id);
        } else this.host.open(null);
      }
      await this.refresh();
    }
  }

  private async importFile(f: File): Promise<void> {
    const r = parseProjectFile(await f.text(), newId());
    if ("erreur" in r) {
      flash(this.msg, r.erreur, true);
      return;
    }
    await this.store.save(r);
    this.openProject(r);
  }

  private exportCurrent(): void {
    const p = this.host.current();
    if (!p) return;
    downloadBytes(new TextEncoder().encode(projectFile(p)), `${fileBase(p.nom)}.escalier`, "application/json");
    flash(this.msg, "Copie enregistrée");
  }
}
