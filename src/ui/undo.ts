import { History } from "../core/history";
import type { Params } from "../core/params";
import { byId } from "./dom";

/** Ce que la page fournit : calculer la saisie en attente, puis afficher des réglages repris de l'historique. */
export interface UndoHost {
  flush(): void;
  apply(p: Params): void;
}

/** Champs dont une frappe continue ne fait qu'une étape. */
const TYPED = ["number", "range"];

/**
 * Texte libre en cours d'édition (nom de l'escalier, e-mail…) : Ctrl+Z y garde son effet habituel.
 * Dans un champ de réglage, l'historique fait la même chose, une étape valant une frappe continue.
 */
function freeText(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement) return true;
  return t instanceof HTMLInputElement && ![...TYPED, "checkbox", "radio", "button"].includes(t.type);
}

/** Annuler et rétablir les changements de réglages : boutons de l'en-tête, Ctrl/Cmd+Z et Ctrl/Cmd+Maj+Z. */
export class Undo {
  private readonly history: History<Params>;
  /** Champ modifié depuis le dernier enregistrement. */
  private key: string | undefined;
  private readonly undoBtn = byId<HTMLButtonElement>("undo");
  private readonly redoBtn = byId<HTMLButtonElement>("redo");

  constructor(
    private readonly host: UndoHost,
    p: Params,
  ) {
    this.history = new History(p);
    const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    this.undoBtn.title = `Annuler la dernière modification (${mac ? "⌘Z" : "Ctrl+Z"})`;
    this.redoBtn.title = `Rétablir (${mac ? "⌘⇧Z" : "Ctrl+Maj+Z"})`;
    this.undoBtn.addEventListener("click", () => this.undo());
    this.redoBtn.addEventListener("click", () => this.redo());
    document.addEventListener("keydown", (e) => this.onKey(e));
    this.show();
  }

  /** Escalier ouvert : l'historique repart de ses réglages. */
  reset(p: Params): void {
    this.history.reset(p);
    this.key = undefined;
    this.show();
  }

  /** Champ qui vient d'être modifié ; null pour un changement d'un coup (correction, exemple), toujours une étape. */
  touched(t: EventTarget | null): void {
    this.key = t instanceof HTMLInputElement && TYPED.includes(t.type) ? t.id || undefined : undefined;
  }

  /** Réglages après calcul : une nouvelle étape, ou la suite de la frappe en cours. */
  record(p: Params): void {
    this.history.record(p, this.key);
    this.show();
  }

  undo(): void {
    this.host.flush();
    this.go(this.history.undo());
  }

  redo(): void {
    this.host.flush();
    this.go(this.history.redo());
  }

  private go(p: Params | null): void {
    this.key = undefined;
    if (p) this.host.apply(p);
    this.show();
  }

  private show(): void {
    this.undoBtn.disabled = !this.history.canUndo();
    this.redoBtn.disabled = !this.history.canRedo();
    // Sur téléphone, les flèches n'apparaissent qu'une fois un réglage changé.
    byId("undoBox").classList.toggle("idle", this.undoBtn.disabled && this.redoBtn.disabled);
  }

  private onKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    // Ctrl+Y rétablit aussi, comme ailleurs sous Windows.
    const redo = (k === "z" && e.shiftKey) || (k === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey);
    if (k !== "z" && !redo) return;
    if (freeText(e.target) || document.body.classList.contains("home-on")) return;
    e.preventDefault();
    if (redo) this.redo();
    else this.undo();
  }
}
