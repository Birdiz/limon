// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { newProject, projectFile, withEtat, type Project } from "../src/core/project";
import { Home } from "../src/ui/home";
import type { ProjectStore } from "../src/ui/store";

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const host = {
  current: () => null,
  params: () => DEFAULTS,
  open() {},
  example() {},
  signedIn: () => false,
  known: () => false,
  account() {},
};

/** Un magasin qui ne filtre rien : la carte doit tenir toute seule. */
function storeOf(...list: ReturnType<typeof newProject>[]): ProjectStore {
  return { list: () => Promise.resolve(list) } as unknown as ProjectStore;
}

describe("cartes de l'accueil", () => {
  beforeEach(() => {
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    window.scrollTo = () => {};
  });

  it("un identifiant ne crée aucun nœud dans la carte", async () => {
    const id = 'x"><img data-intrus="1"><b title="';
    await new Home(storeOf(newProject(id, "Dupont", "complet", 1)), host).show();
    const box = document.getElementById("homeDraft")!;
    expect(box.querySelector("[data-intrus]")).toBeNull();
    const ids = [...box.querySelectorAll<HTMLButtonElement>("button[data-act]")].map((b) => b.dataset.id);
    expect(ids).toEqual([id, id, id]);
  });
});

describe("ouvrir une copie gardée", () => {
  const sain = newProject("a", "Dupont", "complet", 1, { ...DEFAULTS, forme: "droit", H: 2800, W: 900 });
  const msg = () => document.getElementById("pjMsg")!;
  let saved: Project[];
  let opened: (Project | null)[];

  /** L'écran d'import, de l'accueil jusqu'au message : le fichier choisi, puis l'escalier enregistré ou non. */
  async function importe(text: string): Promise<void> {
    saved = [];
    opened = [];
    const store = {
      list: () => Promise.resolve(saved),
      save: (p: Project) => Promise.resolve(void saved.push(p)),
      setCurrent: () => Promise.resolve(),
    } as unknown as ProjectStore;
    const home = new Home(store, { ...host, open: (p) => void opened.push(p) });
    await home.show();
    const file = document.getElementById("pjFile") as HTMLInputElement;
    Object.defineProperty(file, "files", { configurable: true, value: [{ text: () => Promise.resolve(text) }] });
    file.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
  }

  const avecH = (h: unknown) => {
    const f = JSON.parse(projectFile(sain)) as { projet: { params: Record<string, unknown> } };
    f.projet.params.H = h;
    return JSON.stringify(f);
  };

  beforeEach(() => {
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    window.scrollTo = () => {};
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("ouvre un fichier sain, sans message", async () => {
    await importe(projectFile(sain));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ nom: "Dupont", params: sain.params });
    expect(opened).toEqual(saved);
    expect(msg().hidden).toBe(true);
  });

  it("refuse un fichier tronqué ou sans cotes, sans rien enregistrer", async () => {
    for (const text of [
      projectFile(sain).slice(0, 80),
      projectFile(sain).replace(/"params": \{[^}]*\}/, '"params": {}'),
    ]) {
      await importe(text);
      expect(saved).toEqual([]);
      expect(opened).toEqual([]);
      expect(msg().hidden).toBe(false);
      expect(msg().classList.contains("err")).toBe(true);
    }
  });

  it("nomme la cote illisible et reste sur l'accueil, où le message se lit", async () => {
    await importe(avecH("2800"));
    expect(opened).toEqual([]);
    expect(saved[0]).toMatchObject({ params: { H: DEFAULTS.H, W: 900 } });
    expect(msg().hidden).toBe(false);
    expect(msg().classList.contains("err")).toBe(true);
    expect(msg().textContent).toContain("« Dupont »");
    expect(msg().textContent).toContain("Hauteur à monter");
    expect(document.getElementById("homeDraft")!.textContent).toContain("Dupont");
    expect(msg().scrollIntoView).toHaveBeenCalledOnce();
  });

  it("dit le mot juste pour plusieurs cotes, et une clé inconnue telle qu'elle est écrite", async () => {
    const f = JSON.parse(avecH("2800")) as { projet: { params: Record<string, unknown> } };
    f.projet.params.W = null;
    f.projet.params.Hh = 2800;
    await importe(JSON.stringify(f));
    expect(msg().textContent).toContain("Hauteur à monter, Emmarchement, Hh");
  });

  it("ne laisse pas terminé un escalier dont une cote est illisible", async () => {
    const f = JSON.parse(projectFile(withEtat(sain, "fini", 5))) as { projet: { params: Record<string, unknown> } };
    f.projet.params.H = "2800";
    await importe(JSON.stringify(f));
    expect(saved[0]).toMatchObject({ etat: "brouillon", finiLe: 0 });
    expect(document.getElementById("homeDoneBox")!.hidden).toBe(true);
  });
});
