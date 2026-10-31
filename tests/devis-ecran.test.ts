// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { ENTREPRISE_VIDE, TARIFS_VIDES, type Entreprise, type Tarifs } from "../src/core/tarifs";
import { NotSignedIn } from "../src/ui/api";
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
  validite: 30,
};

const E: Entreprise = {
  ...ENTREPRISE_VIDE,
  nom: "Menuiserie Bouzy",
  forme: "EI",
  adresse: "12 rue des Ateliers\n44000 Nantes",
  siren: "732 829 320",
  immat: "RM 44",
  assureur: "MAAF",
  contrat: "123",
  couverture: "France",
  mediateur: "CNPM",
  paiement: "Solde à la fin de la pose.",
  dechets: "Repris par l'entreprise.",
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
  let entreprise: Entreprise;
  let numero: (id: string) => Promise<string>;
  let files: { name: string; data: Uint8Array }[];
  let compte = 0;

  beforeEach(() => {
    document.body.innerHTML = body;
    document.body.dataset.tab = "devis";
    const r = compute(DEFAULTS, false);
    R = r.ok ? r.stair : null;
    tarifs = T;
    project = newProject("a", "Exemple", "complet", 1);
    opened = 0;
    compte = 0;
    entreprise = E;
    numero = async () => "2026-0012";
    files = [];
    view = new DevisView({
      project: () => project,
      stair: () => R,
      tarifs: () => tarifs,
      entreprise: () => entreprise,
      saved: (d) => {
        project = withDevis(project, d, project.modifie + 1);
        view.refresh();
      },
      openTarifs: () => opened++,
      openCompte: () => compte++,
      numero: (id) => numero(id),
      vue3d: () => null,
      download: (data, name) => files.push({ name, data }),
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

describe("remise au client", () => {
  let project: Project;
  let R: Stair | null;
  let view: DevisView;
  let entreprise: Entreprise;
  let numero: (id: string) => Promise<string>;
  let files: { name: string; data: Uint8Array }[];
  let compte: number;
  const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
  const shown = (id: string) => !$(`#${id}`).hidden;
  const remettre = async () => {
    $<HTMLButtonElement>("#dvRemettre").click();
    await vi.waitFor(() => expect($<HTMLButtonElement>("#dvRemettre").textContent).toBe("Remettre au client"));
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 10));
    document.body.innerHTML = body;
    document.body.dataset.tab = "devis";
    const r = compute(DEFAULTS, false);
    R = r.ok ? r.stair : null;
    project = withDevis(
      newProject("a", "Exemple", "complet", 1),
      { ...newDevis(), client: { nom: "Dupont", adresse: "8 allée des Tilleuls", chantier: "" } },
      2,
    );
    entreprise = E;
    numero = async () => "2026-0012";
    files = [];
    compte = 0;
    view = new DevisView({
      project: () => project,
      stair: () => R,
      tarifs: () => T,
      entreprise: () => entreprise,
      saved: (d) => {
        project = withDevis(project, d, project.modifie + 1);
        view.refresh();
      },
      openTarifs: () => {},
      openCompte: () => compte++,
      numero: (id) => numero(id),
      vue3d: () => null,
      download: (data, name) => files.push({ name, data }),
    });
    view.refresh();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("montre un brouillon, et son document filigrané", () => {
    expect($("#dvChip").textContent).toBe("Brouillon");
    expect($("#dvEtatTxt").textContent).toBe("Pas encore remis au client : le numéro est donné à la remise.");
    expect(["dvPdf", "dvRemettre", "dvAccepte", "dvRouvrir"].map(shown)).toEqual([true, true, false, false]);
    expect($<HTMLButtonElement>("#dvRemettre").disabled).toBe(false);
    $<HTMLButtonElement>("#dvPdf").click();
    expect(files.map((f) => f.name)).toEqual(["Exemple - devis (brouillon).pdf"]);
    const pdf = latin1(files[0]!.data);
    expect(pdf).toContain("(Brouillon : num\\351ro donn\\351 \\340 la remise) Tj");
    expect(pdf).toContain("1 Tr (BROUILLON) Tj");
  });

  it("dit ce qui manque avant de remettre", () => {
    entreprise = { ...ENTREPRISE_VIDE, nom: "Menuiserie Bouzy" };
    change($("#dvNom"), "");
    expect($<HTMLButtonElement>("#dvRemettre").disabled).toBe(true);
    expect($("#dvBloq").textContent).toContain(
      "Pour remettre le devis, il manque le nom du client et le nom et l'adresse de votre entreprise (Mon atelier).",
    );
    expect($("#dvBloq").textContent).toContain("Le devis ne porte pas encore forme juridique, SIREN");
  });

  it("fige le devis remis, avec son numéro, et le télécharge", async () => {
    await remettre();
    const d = project.devis!;
    expect(d.remis).toHaveLength(1);
    expect(d.remis[0]).toMatchObject({ numero: "2026-0012", version: 1, etat: "remis", validite: 30, nom: "Exemple" });
    expect(d.remis[0]!.tarifs).toEqual(T);
    expect(d.remis[0]!.chiffrage.totalTTC).toBeGreaterThan(0);
    expect($("#dvChip").textContent).toBe("Remis au client");
    expect($("#dvEtatTxt").textContent).toBe("N° 2026-0012, remis le 31/10/2026, valable jusqu'au 30/11/2026.");
    expect(files.map((f) => f.name)).toEqual(["Devis 2026-0012 - Dupont.pdf"]);
    expect(latin1(files[0]!.data)).not.toContain("BROUILLON");
    // Figé : rien ne se modifie, les boutons des lignes sont coupés.
    expect($("#dvNom").disabled).toBe(true);
    expect(row("bois")!.querySelector<HTMLInputElement>(".dl-pu input")!.disabled).toBe(true);
    expect(["dvRemettre", "dvAccepte", "dvRefuse", "dvRouvrir"].map(shown)).toEqual([false, true, true, true]);
    expect($("#dvVersions").textContent).toContain("N° 2026-0012, remis le 31/10/2026");
  });

  it("refait le même document après un changement de tarifs", async () => {
    await remettre();
    const avant = files[0]!.data;
    T.taux = 60;
    try {
      view.refresh();
      $<HTMLButtonElement>("#dvPdf").click();
      expect(Buffer.from(files[1]!.data).equals(Buffer.from(avant))).toBe(true);
    } finally {
      T.taux = 45;
    }
  });

  it("note la réponse du client, et l'efface", async () => {
    await remettre();
    vi.setSystemTime(new Date(2026, 10, 3, 9));
    $<HTMLButtonElement>("#dvAccepte").click();
    expect(project.devis!.remis[0]).toMatchObject({ etat: "accepte", etatLe: new Date(2026, 10, 3, 9).getTime() });
    expect($("#dvChip").textContent).toBe("Accepté");
    expect($("#dvEtatTxt").textContent).toBe("N° 2026-0012, remis le 31/10/2026, accepté le 03/11/2026.");
    $<HTMLButtonElement>("#dvSansReponse").click();
    expect(project.devis!.remis[0]).toMatchObject({ etat: "remis", etatLe: 0 });
    $<HTMLButtonElement>("#dvRefuse").click();
    expect($("#dvChip").textContent).toBe("Refusé");
  });

  it("passe expiré une fois la validité passée, sans réponse", async () => {
    await remettre();
    vi.setSystemTime(new Date(2026, 10, 30, 23, 59));
    view.refresh();
    expect($("#dvChip").textContent).toBe("Remis au client");
    vi.setSystemTime(new Date(2026, 11, 1, 0, 1));
    view.refresh();
    expect($("#dvChip").textContent).toBe("Expiré");
    expect($("#dvEtatTxt").textContent).toBe("N° 2026-0012, remis le 31/10/2026, validité passée le 30/11/2026.");
  });

  it("repart en brouillon, version 2, quand l'escalier change", async () => {
    await remettre();
    const r = compute({ ...DEFAULTS, W: DEFAULTS.W + 50 }, false);
    R = r.ok ? r.stair : null;
    project = { ...project, params: R!.params };
    view.refresh();
    expect($("#dvChip").textContent).toBe("Brouillon");
    expect($("#dvEtatTxt").textContent).toBe("Version 2 : l'escalier a changé depuis la remise du 31/10/2026.");
    expect($("#dvNom").disabled).toBe(false);
    expect(shown("dvAnnuler")).toBe(false);
    await remettre();
    expect(project.devis!.remis.map((v) => [v.numero, v.version])).toEqual([
      ["2026-0012", 1],
      ["2026-0012", 2],
    ]);
    expect(files.at(-1)!.name).toBe("Devis 2026-0012 v2 - Dupont.pdf");
    // L'ancienne version garde son document.
    document.querySelector<HTMLButtonElement>('#dvVersions [data-v="1"]')!.click();
    expect(files.at(-1)!.name).toBe("Devis 2026-0012 - Dupont.pdf");
  });

  it("se reprend à la main, puis revient à la version remise", async () => {
    await remettre();
    $<HTMLButtonElement>("#dvRouvrir").click();
    expect($("#dvEtatTxt").textContent).toBe("Version 2, reprise après la remise du 31/10/2026.");
    change($("#dvNom"), "Durand");
    expect(project.devis!.client.nom).toBe("Durand");
    $<HTMLButtonElement>("#dvAnnuler").click();
    expect(project.devis!.client.nom).toBe("Dupont");
    expect($("#dvChip").textContent).toBe("Remis au client");
  });

  it("demande un compte, ou le réseau, et garde le brouillon", async () => {
    numero = () => Promise.reject(new NotSignedIn());
    await remettre();
    expect(project.devis!.remis).toEqual([]);
    expect($("#dvMsgTxt").textContent).toContain("connectez-vous à votre compte");
    $<HTMLButtonElement>("#dvCompte").click();
    expect(compte).toBe(1);
    numero = () => Promise.reject(new TypeError("Failed to fetch"));
    await remettre();
    expect($("#dvMsgTxt").textContent).toBe(
      "Pas de réseau : la remise demande une connexion. Le brouillon reste enregistré.",
    );
    expect($("#dvCompte").hidden).toBe(true);
    expect(files).toEqual([]);
  });

  it("garde l'acompte et le délai des travaux", () => {
    change($("#dvAcompte"), "30");
    change($("#dvDelai"), " semaine 48 ");
    expect(project.devis!.saisie).toMatchObject({ acompte: 30, delai: "semaine 48" });
    expect($("#dvTot").textContent).toContain("Acompte à la commande");
    change($("#dvAcompte"), "");
    expect(project.devis!.saisie.acompte).toBeNull();
  });
});
