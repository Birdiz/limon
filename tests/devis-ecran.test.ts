// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { newDevis, sanitizeDevis, type DevisProjet } from "../src/core/devis";
import { DEFAULTS } from "../src/core/params";
import {
  newProject,
  parseProjectFile,
  projectFile,
  sanitizeProject,
  withDevis,
  type Project,
} from "../src/core/project";
import { compute, type Stair } from "../src/core/stair";
import { TARIFS_VIDES, type Tarifs } from "../src/core/tarifs";
import { DevisView } from "../src/ui/devis";

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const change = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, v: string | boolean) => {
  if (typeof v === "boolean") (el as HTMLInputElement).checked = v;
  else el.value = v;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const row = (id: string) => document.querySelector<HTMLElement>(`#dvLines .dl[data-id="${id}"]`);

const T: Tarifs = {
  ...TARIFS_VIDES,
  bois: { ...TARIFS_VIDES.bois, chene: 1800 },
  coef: 1.2,
  quincEscalier: 30,
  quincMarche: 2,
  finition: 8,
  taux: 45,
  heures: {
    ...TARIFS_VIDES.heures,
    prepa: 4,
    marche: 1.5,
    balancee: 3,
    palier: 2,
    contremarche: 0.5,
    limon: 2,
    poteau: 3,
    finition: 0.2,
    poseEscalier: 4,
    poseMarche: 0.25,
  },
  deplForfait: 50,
};

describe("devis enregistré avec l'escalier", () => {
  it("se relit sans rien garder de faux", () => {
    const d = sanitizeDevis({
      client: { nom: "  Dupont ", adresse: 4 },
      saisie: {
        tva: 7,
        pose: "oui",
        km: -3,
        corrections: { bois: { pu: 2000, q: -1 }, "<script>": { retiree: true }, vide: {} },
        libres: [{ designation: "Dépose", q: 2, pu: 150, tva: 10 }, { tva: 33 }],
        remise: { pct: 140 },
      },
    })!;
    expect(d.client).toEqual({ nom: "Dupont", adresse: "", chantier: "" });
    expect(d.saisie).toMatchObject({ tva: 20, pose: true, km: 0, corrections: { bois: { pu: 2000 } } });
    expect(Object.keys(d.saisie.corrections)).toEqual(["bois"]);
    expect(d.saisie.libres).toEqual([
      { designation: "Dépose", q: 2, unite: "", pu: 150, tva: 10 },
      { designation: "", q: 1, unite: "", pu: 0, tva: 20 },
    ]);
    expect(d.saisie.remise).toEqual({ pct: 100 });
    expect(sanitizeDevis(null)).toBeNull();
  });

  it("suit le projet dans le fichier .escalier et dans le stockage", () => {
    const d: DevisProjet = { ...newDevis(10), client: { nom: "Dupont", adresse: "", chantier: "" } };
    const p = withDevis(newProject("a", "Escalier Dupont", "complet", 1), d, 5);
    expect(p.modifie).toBe(5);
    expect(sanitizeProject(JSON.parse(JSON.stringify(p)))!.devis).toEqual(d);
    expect((parseProjectFile(projectFile(p), "b") as Project).devis).toEqual(d);
    expect(sanitizeProject({ id: "x" })!.devis).toBeNull();
  });
});

describe("onglet Devis", () => {
  let project: Project;
  let R: Stair | null;
  let tarifs: Tarifs;
  let view: DevisView;
  let opened = 0;

  beforeEach(() => {
    document.body.innerHTML = body;
    document.body.dataset.tab = "devis";
    const r = compute(DEFAULTS, false);
    R = r.ok ? r.stair : null;
    tarifs = T;
    project = newProject("a", "Exemple", "complet", 1);
    opened = 0;
    view = new DevisView({
      project: () => project,
      stair: () => R,
      tarifs: () => tarifs,
      saved: (d) => {
        project = withDevis(project, d, project.modifie + 1);
        view.refresh();
      },
      openTarifs: () => opened++,
    });
    view.refresh();
  });

  it("montre les lignes calculées et les totaux", () => {
    expect([...document.querySelectorAll("#dvLines .dl[data-id]")].map((r) => (r as HTMLElement).dataset.id)).toEqual([
      "bois",
      "quincaillerie",
      "facon",
      "finition",
      "pose",
      "deplacement",
    ]);
    expect($("#dvLead").textContent).toBe("Pour « Exemple ».");
    expect($("#dvTot").textContent).toContain("Total TTC");
    expect($("#dvNeed").hidden).toBe(true);
    // Rien n'est enregistré tant que l'artisan ne touche à rien.
    expect(project.devis).toBeNull();
  });

  it("garde une correction de prix, et revient au calcul", () => {
    change(row("bois")!.querySelector(".dl-pu input")!, "2000");
    expect(project.devis!.saisie.corrections).toEqual({ bois: { pu: 2000 } });
    expect(row("bois")!.classList.contains("corrigee")).toBe(true);
    row("bois")!.querySelector<HTMLButtonElement>("[data-act=reset]")!.click();
    expect(project.devis!.saisie.corrections).toEqual({});
    expect(row("bois")!.classList.contains("corrigee")).toBe(false);
  });

  it("ne garde pas une correction égale au calcul", () => {
    const pu = row("facon")!.querySelector<HTMLInputElement>(".dl-pu input")!;
    change(pu, "45");
    expect(project.devis!.saisie.corrections).toEqual({});
  });

  it("retire une ligne calculée, et la remet", () => {
    row("finition")!.querySelector<HTMLButtonElement>("[data-act=del]")!.click();
    expect(row("finition")).toBeNull();
    expect($("#dvRetirees").hidden).toBe(false);
    $<HTMLButtonElement>("#dvRetirees [data-act=restore]").click();
    expect(row("finition")).not.toBeNull();
    expect(project.devis!.saisie.corrections).toEqual({});
  });

  it("ajoute une ligne libre et la chiffre", () => {
    $<HTMLButtonElement>("#dvAdd").click();
    change(row("libre-1")!.querySelector<HTMLInputElement>(".dl-des")!, "Dépose de l'ancien escalier");
    change(row("libre-1")!.querySelector<HTMLInputElement>(".dl-pu input")!, "350");
    expect(project.devis!.saisie.libres).toEqual([
      { designation: "Dépose de l'ancien escalier", q: 1, unite: "u", pu: 350, tva: 20 },
    ]);
    expect(row("libre-1")!.querySelector(".dl-tot")!.textContent).toBe("350,00 €");
    row("libre-1")!.querySelector<HTMLButtonElement>("[data-act=del]")!.click();
    expect(project.devis!.saisie.libres).toEqual([]);
  });

  it("enregistre le client, la TVA, la pose et la remise", () => {
    change($("#dvNom"), " M. Dupont ");
    change($<HTMLSelectElement>("#dvTva"), "10");
    change($("#dvKm"), "25");
    change($<HTMLSelectElement>("#dvRemiseKind"), "pct");
    change($("#dvRemise"), "5");
    expect(project.devis!.client.nom).toBe("M. Dupont");
    expect(project.devis!.saisie).toMatchObject({ tva: 10, km: 25, remise: { pct: 5 } });
    expect($("#dvRemiseBox").hidden).toBe(false);
    expect($("#dvTot").textContent).toContain("Remise");
    expect($("#dvTot").textContent).toContain("TVA 10 %");
    change($("#dvPose"), false);
    expect(row("pose")).toBeNull();
    expect($("#dvNotes").textContent).toBe("Fourniture seule, sans pose : TVA à 20 %.");
  });

  it("envoie vers les tarifs quand ils manquent", () => {
    tarifs = TARIFS_VIDES;
    view.refresh();
    expect($("#dvNeed").hidden).toBe(false);
    expect($("#dvNeedTxt").textContent).toBe("Vos tarifs ne sont pas encore remplis : les lignes restent à compléter.");
    expect(row("bois")!.querySelector(".dl-tot")!.textContent).toBe("à compléter");
    $<HTMLButtonElement>("#dvTarifs").click();
    expect(opened).toBe(1);
  });

  it("attend un escalier calculable", () => {
    R = null;
    view.refresh();
    expect($("#dvBody").hidden).toBe(true);
    expect($("#dvNeedTxt").textContent).toContain("Corrigez d'abord les réglages");
  });

  it("ne recalcule rien hors de l'onglet", () => {
    document.body.dataset.tab = "reglages";
    $("#dvLines").innerHTML = "";
    view.refresh();
    expect($("#dvLines").innerHTML).toBe("");
  });
});
