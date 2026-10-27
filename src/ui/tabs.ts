/** Téléphone : un seul panneau à l'écran (réglages, 3D, plan ou fiche), choisi dans la barre du bas. */
export class Tabs {
  private readonly buttons: HTMLButtonElement[];
  /** Les vues 3D et plan prennent la hauteur laissée par l'en-tête, qui change avec le nom du projet. */
  private readonly measure: () => void;

  constructor(bar: HTMLElement, work: HTMLElement) {
    this.buttons = [...bar.querySelectorAll<HTMLButtonElement>("button[data-tab]")];
    bar.addEventListener("click", (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab]");
      if (b) this.show(b.dataset.tab!);
    });
    this.measure = () => document.documentElement.style.setProperty("--hdr", `${work.offsetTop}px`);
    new ResizeObserver(this.measure).observe(document.body);
    this.show("reglages");
  }

  show(tab: string): void {
    document.body.dataset.tab = tab;
    for (const b of this.buttons) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
    this.measure();
    window.scrollTo(0, 0);
  }
}
