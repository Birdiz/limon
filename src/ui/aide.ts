import { aideOf } from "../core/aide";
import type { Forme, FormeTremie } from "../core/params";
import { sketchSVG } from "./sketch";

/*
 * Aide des réglages : un petit « ? » à côté de chaque champ ouvre, sous sa ligne, une bulle avec la définition,
 * la valeur conseillée et un croquis. Une seule bulle ouverte ; elle se ferme par le même bouton, par « × »,
 * par Échap ou en touchant ailleurs.
 */

/** Zones de réglage : sections de l'escalier, assemblage des fichiers machine, Mon atelier. */
export const AIDE_ZONES = ".side .sbody, #cncBody .asm, #atBody";

/** Champ décrit par un bloc : clé de data-aide, sinon le nom de ses boutons radio, sinon le champ de son étiquette. */
export function aideKey(block: Element): string | null {
  const el = block as HTMLElement;
  return (
    el.dataset.aide ??
    (block.matches("[role=radiogroup]") ? block.querySelector<HTMLInputElement>("input[type=radio]")?.name : null) ??
    block.querySelector("label[for]")?.getAttribute("for") ??
    null
  );
}

/** Lignes de réglage et groupes de choix d'une zone, chacun avec son aide. */
export function aideBlocks(zone: ParentNode): Element[] {
  return [...zone.querySelectorAll(".row, [role=radiogroup]")];
}

const BTN_SVG =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.2"/>' +
  '<path d="M7.6 7.7a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6"/><circle class="dot" cx="10" cy="14.6" r=".4"/></svg>';

export class Aide {
  private box = document.createElement("div");
  private open: HTMLButtonElement | null = null;
  private done = new WeakSet<Element>();

  constructor(
    private forme: () => Forme,
    private tForme: () => FormeTremie = () => "rect",
  ) {
    this.box.className = "aide";
    this.box.id = "aide";
    this.box.hidden = true;
    document.addEventListener("click", (e) => {
      const t = e.target as Element;
      const btn = t.closest<HTMLButtonElement>(".aidebtn");
      if (btn) this.toggle(btn);
      else if (t.closest(".aide .aidex")) this.close(true);
      else if (this.open && !this.box.contains(t)) this.close(false);
    });
    // En capture : Échap ferme la bulle sans fermer le dialogue qui la contient.
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape" || !this.open) return;
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      },
      true,
    );
  }

  /** Ajoute le bouton d'aide aux réglages des zones sous root qui n'en ont pas encore. */
  attach(root: ParentNode = document): void {
    root.querySelectorAll(AIDE_ZONES).forEach((zone) =>
      aideBlocks(zone).forEach((block) => {
        const key = aideKey(block);
        if (!key || !aideOf(key) || this.done.has(block)) return;
        this.done.add(block);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "aidebtn";
        btn.dataset.key = key;
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-controls", this.box.id);
        btn.setAttribute("aria-label", `Aide : ${this.name(block)}`);
        btn.innerHTML = BTN_SVG;
        // Entre l'intitulé et le champ ; au-dessus d'un groupe de choix, qui n'a pas d'intitulé à côté.
        if (block.matches("[role=radiogroup]")) block.before(btn);
        else block.firstElementChild!.after(btn);
      }),
    );
  }

  /** Intitulé du champ, sans sa précision en petit. */
  private name(block: Element): string {
    const label = block.querySelector("label[for]");
    if (!label || block.matches("[role=radiogroup]")) return block.getAttribute("aria-label") ?? "";
    return [...label.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join("")
      .trim();
  }

  private toggle(btn: HTMLButtonElement): void {
    const same = this.open === btn;
    this.close(false);
    if (!same) this.show(btn);
  }

  private show(btn: HTMLButtonElement): void {
    const a = aideOf(btn.dataset.key!);
    if (!a) return;
    const svg = sketchSVG(btn.dataset.key!.replace(/^at-/, ""), this.forme(), this.tForme());
    this.box.innerHTML =
      `<button class="aidex" type="button" aria-label="Fermer l'aide">×</button>` +
      (svg ?? "") +
      `<div><p></p>${a.conseil ? '<p class="conseil"></p>' : ""}</div>`;
    const [texte, conseil] = this.box.querySelectorAll("p");
    texte!.textContent = a.texte;
    if (conseil) conseil.textContent = a.conseil!;
    // Sous la ligne du champ (sous le bouton pour un groupe de choix), dans le fil de la page : rien ne déborde.
    const anchor = btn.closest(".row") ?? btn;
    anchor.after(this.box);
    this.box.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    this.open = btn;
  }

  /** Ferme la bulle ouverte ; refocus remet le focus sur son bouton (Échap, « × »). */
  close(refocus: boolean): void {
    const btn = this.open;
    if (!btn) return;
    this.box.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    this.open = null;
    if (refocus) btn.focus();
  }
}
