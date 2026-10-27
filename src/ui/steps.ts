import type { Mode } from "../core/project";
import { SECTIONS, SECTION_TITLE, type Section } from "../core/summary";
import { byId } from "./dom";

const OPEN_KEY = "limon-sections";
/** En mode complet, au premier passage : tout ouvert sauf le bois. */
const DEFAULT_OPEN: Record<Section, boolean> = {
  forme: true,
  dimensions: true,
  tremie: true,
  marches: true,
  bois: false,
};

function loadOpen(): Record<Section, boolean> {
  const o = { ...DEFAULT_OPEN };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
    if (raw && typeof raw === "object")
      for (const k of SECTIONS) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === "boolean") o[k] = v;
      }
  } catch {
    // Préférence perdue : on garde l'ouverture par défaut.
  }
  return o;
}

/**
 * Sections de réglage : dépliables librement en mode complet, une à la fois en mode guidé.
 * En mode guidé, les étapes faites restent visibles en résumé et les suivantes sont masquées.
 */
export class Steps {
  private mode: Mode = "complet";
  private etape = 0;
  private secs = SECTIONS.map((k) => document.querySelector<HTMLDetailsElement>(`details[data-step="${k}"]`)!);
  private prev = byId<HTMLButtonElement>("stPrev");
  private next = byId<HTMLButtonElement>("stNext");

  constructor(private onChange: (mode: Mode, etape: number) => void) {
    this.secs.forEach((d, i) => {
      d.querySelector("summary")!.addEventListener("click", (e) => {
        if (this.mode !== "guide") return;
        e.preventDefault();
        if (i < this.etape) this.go(i);
      });
      d.addEventListener("toggle", () => {
        if (this.mode === "complet") this.saveOpen();
      });
    });
    this.prev.addEventListener("click", () => this.go(this.etape - 1));
    this.next.addEventListener("click", () => {
      if (this.etape < SECTIONS.length - 1) this.go(this.etape + 1);
      else {
        this.mode = "complet";
        this.render();
        this.onChange(this.mode, this.etape);
        byId("tiles").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  apply(mode: Mode, etape: number): void {
    this.mode = mode;
    this.etape = Math.min(Math.max(0, etape), SECTIONS.length - 1);
    this.render();
  }

  private go(i: number): void {
    this.etape = Math.min(Math.max(0, i), SECTIONS.length - 1);
    this.render();
    this.onChange(this.mode, this.etape);
    this.secs[this.etape]!.querySelector("summary")!.focus({ preventScroll: true });
    this.secs[this.etape]!.scrollIntoView({ block: "nearest" });
  }

  private saveOpen(): void {
    const o = Object.fromEntries(SECTIONS.map((k, i) => [k, this.secs[i]!.open]));
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(o));
    } catch {
      // Stockage indisponible : l'ouverture des sections n'est pas retenue.
    }
  }

  private render(): void {
    const guide = this.mode === "guide";
    document.body.classList.toggle("guided", guide);
    byId("stepper").hidden = !guide;
    if (guide) {
      this.secs.forEach((d, i) => {
        d.hidden = i > this.etape;
        d.open = i === this.etape;
        d.classList.toggle("done", i < this.etape);
      });
      const last = this.etape === SECTIONS.length - 1;
      byId("stepTxt").textContent =
        `Étape ${this.etape + 1} sur ${SECTIONS.length} · ${SECTION_TITLE[SECTIONS[this.etape]!]}`;
      this.prev.disabled = this.etape === 0;
      this.next.textContent = last ? "Terminer" : "Suivant";
    } else {
      const o = loadOpen();
      this.secs.forEach((d, i) => {
        d.hidden = false;
        d.classList.remove("done");
        d.open = o[SECTIONS[i]!];
      });
    }
  }
}
