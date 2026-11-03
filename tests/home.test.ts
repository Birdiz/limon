// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { newProject, projectFile, withEtat, type Project } from "../src/core/project";
import { compute } from "../src/core/stair";
import { Home, type HomeHost } from "../src/ui/home";
import { LocalStore, type KeyValue, type ProjectStore } from "../src/ui/store";

vi.mock("../src/core/stair", async (actual) => ({ ...(await actual<object>()), compute: vi.fn() }));
const realCompute = (await vi.importActual<{ compute: typeof compute }>("../src/core/stair")).compute;

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
    vi.mocked(compute).mockImplementation(realCompute);
  });

  it("garde et laisse supprimer un escalier hors bornes", async () => {
    const hors = { ...newProject("hors", "Hors bornes", "complet", 1), params: { ...DEFAULTS, H: 1e15 } };
    const list = [hors];
    const store = {
      list: () => Promise.resolve(list),
      get: () => Promise.resolve(hors),
      remove: vi.fn(() => {
        list.length = 0;
        return Promise.resolve();
      }),
    } as unknown as ProjectStore;
    vi.stubGlobal("confirm", () => true);
    await new Home(store, host).show();
    const box = document.getElementById("homeDraft")!;
    expect(box.querySelector(".thumb")!.innerHTML).toBe("");
    box.querySelector<HTMLButtonElement>('[data-act="del"]')!.click();
    await vi.waitFor(() => expect(store.remove).toHaveBeenCalledWith("hors"));
    await vi.waitFor(() => expect(box.children).toHaveLength(0));
  });

  it("garde la carte quand le dessin d'un escalier échoue", async () => {
    vi.mocked(compute).mockImplementation(() => {
      throw new Error("calcul impossible");
    });
    await new Home(storeOf(newProject("a", "Dupont", "complet", 1)), host).show();
    const box = document.getElementById("homeDraft")!;
    expect(box.querySelector(".thumb")!.innerHTML).toBe("");
    expect(box.querySelector('[data-act="del"]')).not.toBeNull();
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

describe("gestes de l'accueil, sur un vrai magasin en mémoire", () => {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const settled = () => new Promise((r) => setTimeout(r));
  let store: LocalStore;
  let opened: (Project | null)[];
  let current: Project | null;

  function memoire(): KeyValue {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }

  /** Une page neuve à chaque fois : un second accueil sur le même DOM répondrait aux clics en double. */
  async function ouvrir(hostPlus: Partial<HomeHost> = {}, ...projets: Project[]): Promise<Home> {
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    store = new LocalStore(memoire());
    for (const p of projets) await store.save(p);
    const home = new Home(store, {
      ...host,
      current: () => current,
      open: (p) => void opened.push(p),
      ...hostPlus,
    });
    await home.show();
    return home;
  }

  /** Le bouton d'une carte, trouvé par son geste et son escalier. */
  function bouton(act: string, id: string): HTMLButtonElement {
    const b = [...document.querySelectorAll<HTMLButtonElement>(`button[data-act="${act}"]`)];
    return b.find((x) => x.dataset.id === id)!;
  }
  const noms = async () => (await store.list()).map((p) => p.nom);

  beforeEach(() => {
    window.scrollTo = () => {};
    Element.prototype.scrollIntoView = vi.fn();
    opened = [];
    current = null;
    vi.mocked(compute).mockImplementation(realCompute);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });

  const dupont = () => newProject("a", "Dupont", "complet", 1);
  const martin = () => newProject("b", "Martin", "complet", 2);

  describe("ouvrir", () => {
    it("ouvre l'escalier de la carte et le retient comme ouvert", async () => {
      const a = dupont();
      await ouvrir({}, a, martin());
      bouton("open", "a").click();
      await vi.waitFor(() => expect(opened).toEqual([a]));
      expect(await store.currentId()).toBe("a");
    });

    it("un clic sur le nom ouvre aussi", async () => {
      await ouvrir({}, dupont());
      bouton("open", "a").querySelector<HTMLElement>("b")!.click();
      await vi.waitFor(() => expect(opened).toHaveLength(1));
    });

    it("ne fait rien sur un escalier supprimé entre-temps dans un autre onglet", async () => {
      await ouvrir({}, dupont());
      const b = bouton("open", "a");
      await store.remove("a");
      b.click();
      await settled();
      expect(opened).toEqual([]);
    });

    it("un clic à côté des boutons ne fait rien", async () => {
      await ouvrir({}, dupont());
      el("homeDraft").querySelector("li")!.click();
      await settled();
      expect(opened).toEqual([]);
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe("dupliquer", () => {
    it("la copie d'un escalier terminé repart en brouillon, sous un autre identifiant", async () => {
      const fini = withEtat(dupont(), "fini", 5);
      await ouvrir({}, fini);
      const avant = Date.now();
      bouton("dup", "a").click();
      await vi.waitFor(async () => expect(await store.list()).toHaveLength(2));
      const copie = (await store.list()).find((p) => p.id !== "a")!;
      expect(copie).toMatchObject({ nom: "Dupont (copie)", etat: "brouillon", finiLe: 0, params: fini.params });
      expect(copie.cree).toBeGreaterThanOrEqual(avant);
      expect(copie.modifie).toBe(copie.cree);
      expect(await store.get("a")).toEqual(fini);
    });

    it("n'ouvre rien : la liste montre la copie à côté de l'original", async () => {
      await ouvrir({}, withEtat(dupont(), "fini", 5));
      expect(el("homeDraftBox").hidden).toBe(true);
      bouton("dup", "a").click();
      await vi.waitFor(() => expect(el("homeDraft").textContent).toContain("Dupont (copie)"));
      expect(el("homeDraftBox").hidden).toBe(false);
      expect(el("homeDone").textContent).toContain("Dupont");
      expect(el("homeDraftN").textContent).toBe("1");
      expect(el("homeDoneN").textContent).toBe("1");
      expect(opened).toEqual([]);
    });
  });

  describe("supprimer", () => {
    it("ne supprime rien sans accord", async () => {
      await ouvrir({}, dupont());
      vi.mocked(confirm).mockReturnValueOnce(false);
      bouton("del", "a").click();
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
      await settled();
      expect(await noms()).toEqual(["Dupont"]);
      expect(el("homeDraft").children).toHaveLength(1);
    });

    it("dit d'où l'escalier s'efface, selon qu'il y a un compte", async () => {
      await ouvrir({}, dupont(), martin());
      bouton("del", "a").click();
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
      const sans = vi.mocked(confirm).mock.lastCall![0]!;
      expect(sans).toContain("« Dupont »");
      expect(sans).toContain("de cet appareil.");
      expect(sans).not.toContain("compte");

      vi.mocked(confirm).mockClear();
      await ouvrir({ signedIn: () => true }, martin());
      bouton("del", "b").click();
      await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
      expect(vi.mocked(confirm).mock.lastCall![0]).toContain("de cet appareil et de votre compte");
    });

    it("un autre escalier que l'ouvert : l'ouvert le reste", async () => {
      const a = dupont();
      current = a;
      await ouvrir({}, a, martin());
      await store.setCurrent("a");
      bouton("del", "b").click();
      await vi.waitFor(() => expect(el("homeDraft").children).toHaveLength(1));
      expect(await noms()).toEqual(["Dupont"]);
      expect(opened).toEqual([]);
      expect(await store.currentId()).toBe("a");
    });

    it("l'escalier ouvert : plus rien derrière, et l'accueil reste", async () => {
      const a = dupont();
      current = a;
      const home = await ouvrir({ open: (p) => ((current = p), void opened.push(p)) }, a, martin());
      await store.setCurrent("a");
      bouton("del", "a").click();
      await vi.waitFor(() => expect(opened).toEqual([null]));
      await vi.waitFor(() => expect(el("homeBack").hidden).toBe(true));
      expect(await store.currentId()).toBeNull();
      expect(home.visible).toBe(true);
      expect(await noms()).toEqual(["Martin"]);
    });

    it("le dernier supprimé : l'accueil invite à commencer", async () => {
      await ouvrir({}, dupont());
      expect(el("homeTitle").textContent).toBe("Mes escaliers");
      bouton("del", "a").click();
      await vi.waitFor(() => expect(el("homeTitle").textContent).toBe("Un escalier à calculer ?"));
      expect(el("homeLead").hidden).toBe(false);
      expect(el("homeDraftBox").hidden).toBe(true);
    });
  });

  describe("créer", () => {
    const params = { ...DEFAULTS, H: 3100 };

    it("le formulaire crée un escalier en pas à pas, aux réglages de l'atelier, et vide le nom", async () => {
      await ouvrir({ params: () => params });
      el<HTMLInputElement>("homeNom").value = "Chantier Dupont";
      el("homeNewForm").dispatchEvent(new Event("submit", { cancelable: true }));
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      expect(opened[0]).toMatchObject({ nom: "Chantier Dupont", mode: "guide", params: { H: 3100 } });
      expect(await store.get(opened[0]!.id)).toEqual(opened[0]);
      expect(await store.currentId()).toBe(opened[0]!.id);
      expect(el<HTMLInputElement>("homeNom").value).toBe("");
    });

    it("« Tous les réglages » crée en mode complet", async () => {
      await ouvrir();
      el("homeFull").click();
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      expect(opened[0]).toMatchObject({ mode: "complet" });
    });
  });

  describe("copies en fichier", () => {
    const fichier = (text: string) => {
      const file = el<HTMLInputElement>("pjFile");
      Object.defineProperty(file, "files", { configurable: true, value: [{ text: () => Promise.resolve(text) }] });
      file.dispatchEvent(new Event("change"));
    };

    it("le même fichier ouvert deux fois donne deux escaliers, sans toucher à l'original", async () => {
      const a = dupont();
      await ouvrir({}, a);
      fichier(projectFile(a));
      await vi.waitFor(() => expect(opened).toHaveLength(1));
      fichier(projectFile(a));
      await vi.waitFor(() => expect(opened).toHaveLength(2));
      const ids = (await store.list()).map((p) => p.id);
      expect(new Set(ids).size).toBe(3);
      expect(await store.get("a")).toEqual(a);
      expect(await store.currentId()).toBe(opened[1]!.id);
    });

    it("un fichier refusé laisse la liste et l'escalier ouvert tels quels", async () => {
      await ouvrir({}, dupont());
      fichier("pas un fichier d'escalier");
      await vi.waitFor(() => expect(el("pjMsg").hidden).toBe(false));
      expect(await noms()).toEqual(["Dupont"]);
      expect(await store.currentId()).toBeNull();
    });

    it("« Ouvrir une copie gardée » ouvre le sélecteur de fichier", async () => {
      await ouvrir();
      const click = vi.spyOn(el<HTMLInputElement>("pjFile"), "click").mockImplementation(() => {});
      el("pjImport").click();
      expect(click).toHaveBeenCalledOnce();
    });

    it("garder une copie télécharge l'escalier ouvert", async () => {
      const a = dupont();
      current = a;
      await ouvrir({}, a);
      let blob: Blob | undefined;
      URL.createObjectURL = (b) => ((blob = b as Blob), "blob:x");
      URL.revokeObjectURL = () => {};
      const fichiers: string[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        fichiers.push(this.download);
      });
      expect(el("pjExport").hidden).toBe(false);
      el("pjExport").click();
      click.mockRestore();
      expect(fichiers).toEqual(["Dupont.escalier"]);
      expect(JSON.parse(await blob!.text())).toMatchObject({ format: "limon-projet", projet: { nom: "Dupont" } });
      expect(el("pjMsg").textContent).toBe("Copie enregistrée");
      expect(el("pjMsg").classList.contains("err")).toBe(false);
    });

    it("sans escalier ouvert : pas de copie à garder", async () => {
      await ouvrir({}, dupont());
      expect(el("pjExport").hidden).toBe(true);
    });
  });

  describe("onglets", () => {
    const choisi = () => ["dtEsc", "dtAt", "dtAc"].filter((id) => el(id).getAttribute("aria-selected") === "true");
    const fleche = (key: string) =>
      el("dtEsc").parentElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    it("les flèches passent d'un onglet à l'autre, en boucle", async () => {
      await ouvrir();
      expect(choisi()).toEqual(["dtEsc"]);
      fleche("ArrowLeft");
      expect(choisi()).toEqual(["dtAc"]);
      expect(document.activeElement).toBe(el("dtAc"));
      expect(el("dpAc").hidden).toBe(false);
      expect(el("dpEsc").hidden).toBe(true);
      fleche("ArrowRight");
      expect(choisi()).toEqual(["dtEsc"]);
      fleche("Tab");
      expect(choisi()).toEqual(["dtEsc"]);
    });

    it("l'onglet du compte prévient la page, l'invitation y mène", async () => {
      const account = vi.fn();
      await ouvrir({ account });
      expect(account).not.toHaveBeenCalled();
      el("homeAcct").click();
      expect(account).toHaveBeenCalledOnce();
      expect(choisi()).toEqual(["dtAc"]);
    });

    it("l'invitation parle de se connecter à qui a déjà eu un compte, et disparaît une fois connecté", async () => {
      await ouvrir();
      expect(el("homeInvite").hidden).toBe(false);
      expect(el("homeAcct").textContent).toBe("créer mon compte");
      await ouvrir({ known: () => true });
      expect(el("homeAcct").textContent).toBe("me connecter");
      await ouvrir({ signedIn: () => true });
      expect(el("homeInvite").hidden).toBe(true);
    });

    it("« Revenir à » nomme l'escalier ouvert et ferme l'accueil", async () => {
      const a = dupont();
      current = a;
      const home = await ouvrir({}, a);
      expect(el("homeBack").textContent).toBe("Revenir à « Dupont »");
      expect(document.body.classList.contains("home-on")).toBe(true);
      el("homeBack").click();
      expect(home.visible).toBe(false);
      expect(document.body.classList.contains("home-on")).toBe(false);
    });

    it("« Voir un exemple » est laissé à la page", async () => {
      const example = vi.fn();
      await ouvrir({ example });
      el("homeEx").click();
      expect(example).toHaveBeenCalledOnce();
    });
  });
});
