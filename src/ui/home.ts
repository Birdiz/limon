import { day } from "../core/format";
import type { Params } from "../core/params";
import { planShapes, type PlanShape } from "../core/plan-shapes";
import { hasClient, newProject, parseProjectFile, type Mode, type Project } from "../core/project";
import { compute } from "../core/stair";
import { COTE_LABEL, FORME_LABEL } from "../core/summary";
import type { Pt } from "../core/vec";
import { byId, downloadProject, esc, flash } from "./dom";
import { newId, type ProjectStore } from "./store";

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
  /** Un compte a déjà servi sur cet appareil : l'invitation propose de s'y connecter. */
  known(): boolean;
  /** L'onglet Compte s'affiche. */
  account(): void;
}

/** Ce que l'artisan doit reprendre sur un escalier importé dont des cotes ne se lisent pas. Une clé inconnue reste telle
    qu'elle est écrite dans le fichier. */
function ignoresMsg(nom: string, ignores: string[]): string {
  const noms = ignores.map((k) => (Object.hasOwn(COTE_LABEL, k) ? COTE_LABEL[k as keyof Params] : k)).join(", ");
  const [debut, suite] = ignores.length > 1 ? ["Cotes illisibles", "Remises"] : ["Cote illisible", "Remise"];
  return `${debut} dans « ${nom} » : ${noms}. ${suite} à l'exemple : à reprendre avant de couper.`;
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
  private ask = byId("pjAsk");
  /** Escalier dont la copie attend la réponse sur le client. */
  private asked: string | null = null;
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
    byId("pjAvec").addEventListener("click", () => this.keepCopy(true));
    byId("pjSeul").addEventListener("click", () => this.keepCopy(false));
    byId("pjNon").addEventListener("click", () => this.closeAsk(true));
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
    this.closeAsk();
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
    // La réponse ne vaudrait pas pour un autre escalier, ni pour un client effacé entre-temps.
    if (cur?.id !== this.asked || !hasClient(cur)) this.closeAsk();
    const back = byId("homeBack");
    back.hidden = !cur;
    if (cur) back.textContent = `Revenir à « ${cur.nom} »`;
    byId("homeInvite").hidden = this.host.signedIn();
    byId("homeAcct").textContent = this.host.known() ? "me connecter" : "créer mon compte";
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
      // Sans dessin, la carte reste : l'escalier s'y ouvre ou s'y supprime.
      try {
        svg = thumbSVG(p.params);
      } catch {
        svg = "";
      }
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
      `<button class="cardopen" type="button" data-act="open" data-id="${esc(p.id)}">` +
      `<span class="thumb">${this.thumb(p)}</span>` +
      `<span class="ctxt"><b>${esc(p.nom)}</b><small>${FORME_LABEL[p.params.forme]} · modifié le ${day(p.modifie)}</small>${state}</span>` +
      `${isCur ? '<span class="pjcur">ouvert</span>' : ""}</button>` +
      `<div class="pjbtns"><button class="btn" type="button" data-act="dup" data-id="${esc(p.id)}">Dupliquer</button>` +
      `<button class="btn danger" type="button" data-act="del" data-id="${esc(p.id)}">Supprimer</button></div></li>`
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
    let text: string;
    try {
      text = await f.text();
    } catch {
      // Parti entre le choix et la lecture : clé retirée, fichier déplacé ou effacé.
      flash(
        this.msg,
        "Ce fichier n'a pas pu être lu. Vérifiez qu'il est toujours à sa place, puis recommencez.",
        true,
        10000,
      );
      return;
    }
    const r = parseProjectFile(text, newId());
    if ("erreur" in r) {
      flash(this.msg, r.erreur, true);
      return;
    }
    await this.store.save(r.projet);
    if (!r.ignores.length) {
      this.openProject(r.projet);
      return;
    }
    // L'accueil reste affiché : ouvrir l'escalier cacherait le message.
    await this.refresh();
    flash(this.msg, ignoresMsg(r.projet.nom, r.ignores), true, 60000);
    // La carte ajoutée le pousse vers le bas, parfois hors de l'écran.
    this.msg.scrollIntoView({ block: "center" });
  }

  private exportCurrent(): void {
    const p = this.host.current();
    if (!p) return;
    if (!hasClient(p)) {
      downloadProject(p);
      flash(this.msg, "Copie enregistrée");
      return;
    }
    this.asked = p.id;
    byId("pjAskQ").textContent =
      `La copie de « ${p.nom} » peut emporter le nom du client, son adresse et les prix du devis.`;
    this.ask.hidden = false;
    byId("pjAvec").focus();
  }

  private keepCopy(avecDevis: boolean): void {
    this.closeAsk(true);
    const p = this.host.current();
    if (!p) return;
    downloadProject(p, avecDevis);
    flash(
      this.msg,
      avecDevis ? "Copie enregistrée, avec le devis et le client" : "Copie enregistrée, sans le devis ni le client",
    );
  }

  private closeAsk(refocus = false): void {
    this.asked = null;
    this.ask.hidden = true;
    if (refocus) byId("pjExport").focus();
  }
}
