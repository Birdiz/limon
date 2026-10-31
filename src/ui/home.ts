import type { Params } from "../core/params";
import { planShapes, type PlanShape } from "../core/plan-shapes";
import { fileBase, newProject, parseProjectFile, projectFile, type Mode, type Project } from "../core/project";
import { compute } from "../core/stair";
import { FORME_LABEL } from "../core/summary";
import type { Pt } from "../core/vec";
import { byId, downloadBytes, esc, flash } from "./dom";
import { newId, type ProjectStore } from "./store";

const day = (ms: number) => new Date(ms).toLocaleDateString("fr-FR");

/** Onglets de la page : escaliers, profil de l'atelier, compte. */
export type Panel = "escaliers" | "atelier" | "compte";
const PANELS: Record<Panel, [tab: string, panel: string]> = {
  escaliers: ["dtEsc", "dpEsc"],
  atelier: ["dtAt", "dpAt"],
  compte: ["dtAc", "dpAc"],
};

/** Ce que la page fournit à l'accueil. */
export interface HomeHost {
  current(): Project | null;
  /** Réglages de départ d'un nouvel escalier : ceux de l'atelier. */
  params(): Params;
  /** Ouvre un escalier ; null : plus aucun, l'accueil garde la page. */
  open(p: Project | null): void;
  /** Escalier d'exemple, déjà calculé. */
  example(): void;
  signedIn(): boolean;
  /** L'onglet Compte s'affiche. */
  account(): void;
}

/** Vignette du plan : limons, marches et ligne de foulée, sans les cotes. */
function thumbSVG(p: Params): string {
  const r = compute(p, false);
  if (!r.ok) return "";
  const keep = new Set(["pl-str", "pl-tread", "pl-bal", "pl-walk"]);
  const shapes = planShapes(r.stair).shapes.filter(
    (s): s is Extract<PlanShape, { k: "poly" | "line" }> => (s.k === "poly" || s.k === "line") && keep.has(s.role),
  );
  const pts = shapes.flatMap((s) => s.pts);
  if (!pts.length) return "";
  const xs = pts.map((q) => q[0]),
    ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs),
    y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0,
    h = Math.max(...ys) - y0;
  const m = Math.max(w, h) * 0.06;
  const xy = (q: Pt) => `${q[0].toFixed(0)},${q[1].toFixed(0)}`;
  const body = shapes
    .map((s) =>
      s.k === "poly"
        ? `<polygon class="${s.role}" vector-effect="non-scaling-stroke" points="${s.pts.map(xy).join(" ")}"/>`
        : `<polyline class="${s.role}" vector-effect="non-scaling-stroke" points="${s.pts.map(xy).join(" ")}"/>`,
    )
    .join("");
  return `<svg viewBox="${(x0 - m).toFixed(0)} ${(y0 - m).toFixed(0)} ${(w + 2 * m).toFixed(0)} ${(h + 2 * m).toFixed(0)}" aria-hidden="true">${body}</svg>`;
}

/**
 * Accueil, à la place des dialogues : onglets Escaliers (création, liste en cours et terminés, copies en fichier),
 * Mon atelier et Mon compte. Au premier lancement, quand il ne reste aucun escalier, par le logo ou l'en-tête.
 */
export class Home {
  private msg = byId("pjMsg");
  private nom = byId<HTMLInputElement>("homeNom");
  private panel: Panel = "escaliers";
  /** Vignettes déjà dessinées, par escalier et date de modification. */
  private thumbs = new Map<string, string>();

  constructor(
    private store: ProjectStore,
    private host: HomeHost,
  ) {
    byId("homeNewForm").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.create("guide");
    });
    byId("homeFull").addEventListener("click", () => void this.create("complet"));
    byId("homeEx").addEventListener("click", () => host.example());
    byId("homeBack").addEventListener("click", () => this.hide());
    byId("homeAcct").addEventListener("click", () => this.show("compte"));
    for (const [k, [tab]] of Object.entries(PANELS))
      byId(tab).addEventListener("click", () => void this.show(k as Panel));
    // Flèches entre les onglets, comme une barre d'onglets ordinaire.
    byId("dtEsc").parentElement!.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const keys = Object.keys(PANELS) as Panel[];
      const i = keys.indexOf(this.panel) + (e.key === "ArrowRight" ? 1 : -1);
      const next = keys[(i + keys.length) % keys.length]!;
      void this.show(next);
      byId(PANELS[next][0]).focus();
    });
    for (const id of ["homeDraft", "homeDone"]) byId(id).addEventListener("click", (e) => void this.act(e));
    const file = byId<HTMLInputElement>("pjFile");
    byId("pjImport").addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      file.value = "";
      if (f) void this.importFile(f);
    });
    byId("pjExport").addEventListener("click", () => this.exportCurrent());
  }

  get visible(): boolean {
    return !byId("home").hidden;
  }

  async show(panel: Panel = "escaliers"): Promise<void> {
    this.panel = panel;
    for (const [k, [tab, pan]] of Object.entries(PANELS)) {
      const on = k === panel;
      byId(tab).setAttribute("aria-selected", String(on));
      byId(tab).tabIndex = on ? 0 : -1;
      byId(pan).hidden = !on;
    }
    if (panel === "compte") this.host.account();
    await this.refresh();
    byId("home").hidden = false;
    document.body.classList.add("home-on");
    window.scrollTo(0, 0);
  }

  hide(): void {
    if (!this.visible) return;
    byId("home").hidden = true;
    document.body.classList.remove("home-on");
    // L'escalier s'ouvre en haut, pas à la hauteur de sa carte.
    window.scrollTo(0, 0);
  }

  /** Liste à jour quand un autre appareil a changé des escaliers. */
  async refreshIfOpen(): Promise<void> {
    if (this.visible) await this.refresh();
  }

  private async refresh(): Promise<void> {
    const cur = this.host.current();
    const back = byId("homeBack");
    back.hidden = !cur;
    if (cur) back.textContent = `Revenir à « ${cur.nom} »`;
    byId("homeInvite").hidden = this.host.signedIn();
    byId("pjExport").hidden = !cur;
    const all = await this.store.list();
    // Premier lancement : l'accueil invite à commencer.
    byId("homeTitle").textContent = all.length ? "Mes escaliers" : "Un escalier à calculer ?";
    byId("homeLead").hidden = all.length > 0;
    const drafts = all.filter((p) => p.etat === "brouillon");
    const done = all.filter((p) => p.etat === "fini");
    this.fill("homeDraft", drafts, cur);
    this.fill("homeDone", done, cur);
  }

  private fill(id: string, list: Project[], cur: Project | null): void {
    byId(`${id}Box`).hidden = !list.length;
    byId(`${id}N`).textContent = String(list.length);
    byId(id).innerHTML = list.map((p) => this.card(p, p.id === cur?.id)).join("");
  }

  private thumb(p: Project): string {
    const key = `${p.id}:${p.modifie}`;
    let svg = this.thumbs.get(key);
    if (svg === undefined) {
      svg = thumbSVG(p.params);
      this.thumbs.set(key, svg);
    }
    return svg;
  }

  private card(p: Project, isCur: boolean): string {
    const state =
      p.etat === "fini"
        ? `<span class="etat fini">Terminé le ${day(p.finiLe)}</span>`
        : `<span class="etat">${p.mode === "guide" ? "Pas à pas en cours" : "Brouillon"}</span>`;
    return (
      `<li${isCur ? ' class="cur"' : ""}>` +
      `<button class="cardopen" type="button" data-act="open" data-id="${p.id}">` +
      `<span class="thumb">${this.thumb(p)}</span>` +
      `<span class="ctxt"><b>${esc(p.nom)}</b><small>${FORME_LABEL[p.params.forme]} · modifié le ${day(p.modifie)}</small>${state}</span>` +
      `${isCur ? '<span class="pjcur">ouvert</span>' : ""}</button>` +
      `<div class="pjbtns"><button class="btn" type="button" data-act="dup" data-id="${p.id}">Dupliquer</button>` +
      `<button class="btn danger" type="button" data-act="del" data-id="${p.id}">Supprimer</button></div></li>`
    );
  }

  private openProject(p: Project): void {
    this.host.open(p);
    void this.store.setCurrent(p.id);
  }

  private async create(mode: Mode): Promise<void> {
    const p = newProject(newId(), this.nom.value, mode, Date.now(), this.host.params());
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
      // La copie repart en brouillon : c'est un autre escalier, à reprendre.
      const now = Date.now();
      await this.store.save({
        ...p,
        id: newId(),
        nom: `${p.nom} (copie)`,
        cree: now,
        modifie: now,
        etat: "brouillon",
        finiLe: 0,
      });
      await this.refresh();
    } else if (b.dataset.act === "del") {
      const where = this.host.signedIn() ? "de cet appareil et de votre compte" : "de cet appareil";
      if (!confirm(`Supprimer « ${p.nom} » ? L'escalier sera effacé ${where}.`)) return;
      await this.store.remove(p.id);
      // L'escalier ouvert supprimé : l'accueil reste affiché, sans escalier derrière.
      if (p.id === this.host.current()?.id) {
        this.host.open(null);
        await this.store.setCurrent(null);
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
