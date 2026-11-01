// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { newProject } from "../src/core/project";
import { LocalStore, write, type KeyValue } from "../src/ui/store";

describe("projets dans le navigateur", () => {
  beforeEach(() => localStorage.clear());

  it("laisse tomber à la lecture un projet déjà enregistré hors format", async () => {
    const bad = newProject('a"b', "Hors format", "complet", 1);
    localStorage.setItem("limon-projets", JSON.stringify([bad, newProject("bon", "Bon", "complet", 1)]));
    localStorage.setItem("limon-courant", bad.id);
    const s = new LocalStore();
    expect((await s.list()).map((p) => p.id)).toEqual(["bon"]);
    expect(await s.get(bad.id)).toBeNull();
    // L'écriture suivante ne le remet pas, et la relance ne le retrouve pas.
    await s.save(newProject("autre", "Autre", "complet", 2));
    expect((await new LocalStore().list()).map((p) => p.id).sort()).toEqual(["autre", "bon"]);
  });

  it("reprend les réglages de l'ancienne version comme premier projet", async () => {
    localStorage.setItem("limon-v2", JSON.stringify({ ...DEFAULTS, forme: "droit", H: 2850 }));
    const s = new LocalStore();
    const [p, ...rest] = await s.list();
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({ nom: "Mon escalier", mode: "complet" });
    expect(p!.params).toMatchObject({ forme: "droit", H: 2850 });
    expect(await s.currentId()).toBe(p!.id);
    expect(localStorage.getItem("limon-v2")).not.toBeNull();
    // Une seule fois : un second chargement relit la liste, sans recréer de projet.
    expect(await new LocalStore().list()).toEqual([p]);
  });

  it("commence vide sans ancienne version", async () => {
    expect(await new LocalStore().list()).toEqual([]);
  });

  it("enregistre, classe par date et supprime", async () => {
    const s = new LocalStore();
    await s.save(newProject("a", "A", "guide", 1));
    await s.save(newProject("b", "B", "complet", 2));
    await s.setCurrent("a");
    expect((await new LocalStore().list()).map((p) => p.id)).toEqual(["b", "a"]);
    await s.remove("a");
    const again = new LocalStore();
    expect((await again.list()).map((p) => p.id)).toEqual(["b"]);
    expect(await again.currentId()).toBeNull();
  });
});

const project = (id: string, modifie = 1, nom = id) => ({ ...newProject(id, nom, "complet", modifie), modifie });
const ids = async (s: LocalStore) => (await s.list()).map((p) => p.id).sort();
/** Ce que le navigateur envoie aux autres onglets après une écriture. */
const otherTabWrote = () => window.dispatchEvent(new StorageEvent("storage", { key: "limon-projets" }));

describe("deux onglets sur le même stockage", () => {
  beforeEach(() => localStorage.clear());

  it("changer de projet ouvert puis enregistrer ne retire pas ce que l'autre a écrit", async () => {
    const a = new LocalStore();
    const b = new LocalStore();
    await b.save(project("b"));
    await a.setCurrent("x");
    expect(await ids(new LocalStore())).toEqual(["b"]);
    await a.save(project("a"));
    expect(await ids(new LocalStore())).toEqual(["a", "b"]);
  });

  it("changer de projet ouvert n'écrit que le projet ouvert", async () => {
    const a = new LocalStore();
    const avant = localStorage.getItem("limon-projets");
    await a.setCurrent("x");
    expect(localStorage.getItem("limon-projets")).toBe(avant);
    expect(localStorage.getItem("limon-courant")).toBe("x");
  });

  it("une saisie dans A n'efface pas ce que B a créé, ni B ce que A a changé", async () => {
    const a = new LocalStore();
    await a.save(project("x", 1, "ancien"));
    const b = new LocalStore();
    await b.save(project("b", 2));
    await a.save(project("x", 3, "modifié dans A"));
    // B est resté ouvert, sa copie de x est ancienne : sa prochaine écriture ne la remet pas.
    await b.save(project("b", 4));
    // B fermé, A actualisé : tout est là.
    const reloaded = new LocalStore();
    expect(await ids(reloaded)).toEqual(["b", "x"]);
    expect((await reloaded.get("x"))!.nom).toBe("modifié dans A");
    expect((await b.get("x"))!.nom).toBe("modifié dans A");
  });

  it("le plus récent gagne, même enregistré après", async () => {
    const a = new LocalStore();
    const b = new LocalStore();
    await a.save(project("x", 5, "récent"));
    await b.save(project("x", 3, "ancien"));
    expect((await new LocalStore().get("x"))!.nom).toBe("récent");
    expect((await b.get("x"))!.nom).toBe("récent");
  });

  it("une suppression reste une suppression", async () => {
    const a = new LocalStore();
    await a.save(project("x"));
    const b = new LocalStore();
    await a.remove("x");
    // B a encore x en mémoire : l'écriture d'un autre projet ne le fait pas revenir.
    await b.save(project("b"));
    expect(await ids(new LocalStore())).toEqual(["b"]);
    expect(await b.get("x")).toBeNull();
  });

  it("une suppression demandée ici l'emporte sur une version plus récente écrite ailleurs", async () => {
    const a = new LocalStore();
    await a.save(project("x", 1));
    const b = new LocalStore();
    await b.save(project("x", 9));
    await a.remove("x");
    expect(await ids(new LocalStore())).toEqual([]);
  });

  it("un escalier créé dans B apparaît dans A, et la page est prévenue", async () => {
    const a = new LocalStore();
    a.watch();
    const seen: string[][] = [];
    a.onChange((changed) => seen.push(changed));
    await new LocalStore().save(project("b"));
    otherTabWrote();
    expect(await ids(a)).toEqual(["b"]);
    expect(seen).toEqual([["b"]]);
    // Rien de nouveau : la page n'est pas dérangée.
    otherTabWrote();
    expect(seen).toHaveLength(1);
  });

  it("la page apprend aussi ce qu'une écriture a découvert avant l'événement du navigateur", async () => {
    const a = new LocalStore();
    const b = new LocalStore();
    const seen: string[][] = [];
    a.onChange((changed) => seen.push(changed));
    await b.save(project("b"));
    await a.save(project("a"));
    expect(seen).toEqual([["b"]]);
  });

  it("ses propres écritures ne préviennent pas la page", async () => {
    const a = new LocalStore();
    const seen: string[][] = [];
    a.onChange((changed) => seen.push(changed));
    await a.save(project("a"));
    await a.remove("a");
    expect(seen).toEqual([]);
  });

  it("garde la copie en mémoire si le stockage ne dit plus rien", async () => {
    const a = new LocalStore();
    await a.save(project("a"));
    localStorage.clear();
    otherTabWrote();
    expect(await ids(a)).toEqual(["a"]);
  });
});

/** Stockage qu'on peut remplir ou interdire d'écriture. */
function refusing(name: "QuotaExceededError" | "SecurityError") {
  const m = new Map<string, string>();
  const d = {
    refuse: false,
    /** Le refus ne vise que cette clé ; toutes si rien n'est dit. */
    only: null as string | null,
    storage: {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => {
        if (d.refuse && (!d.only || d.only === k)) throw new DOMException("refusé", name);
        m.set(k, v);
      },
      removeItem: (k) => void m.delete(k),
    } as KeyValue,
  };
  return d;
}

describe("écriture refusée", () => {
  it("write dit si l'écriture a eu lieu", () => {
    const d = refusing("QuotaExceededError");
    expect(write(d.storage, "k", "v")).toBe(true);
    expect(write(d.storage, "k", null)).toBe(true);
    d.refuse = true;
    expect(write(d.storage, "k", "v")).toBe(false);
    expect(write(null, "k", "v")).toBe(false);
  });

  for (const name of ["QuotaExceededError", "SecurityError"] as const)
    it(`${name} : signalé puis retiré dès qu'une écriture réussit`, async () => {
      const d = refusing(name);
      const s = new LocalStore(d.storage);
      let notes = 0;
      s.onStored(() => notes++);
      expect(s.stored()).toBe(true);

      d.refuse = true;
      await s.save(project("a"));
      expect(s.stored()).toBe(false);
      expect(notes).toBe(1);
      await s.save(project("b"));
      expect(notes).toBe(1);
      // Rien de perdu : ni à l'écran, ni à l'écriture suivante.
      expect(await ids(s)).toEqual(["a", "b"]);

      d.refuse = false;
      await s.save(project("c"));
      expect(s.stored()).toBe(true);
      expect(notes).toBe(2);
      expect(await ids(new LocalStore(d.storage))).toEqual(["a", "b", "c"]);
    });

  it("une suppression refusée n'est pas oubliée à l'écriture suivante", async () => {
    const d = refusing("QuotaExceededError");
    const s = new LocalStore(d.storage);
    await s.save(project("x"));
    d.refuse = true;
    await s.remove("x");
    await s.save(project("a"));
    expect(await ids(s)).toEqual(["a"]);
    d.refuse = false;
    await s.save(project("b"));
    expect(await ids(new LocalStore(d.storage))).toEqual(["a", "b"]);
  });

  it("le projet ouvert écrit à côté ne fait pas croire que l'escalier est gardé", async () => {
    const d = refusing("QuotaExceededError");
    const s = new LocalStore(d.storage);
    d.refuse = true;
    d.only = "limon-projets";
    await s.save(project("a"));
    await s.setCurrent("a");
    expect(s.stored()).toBe(false);
  });

  it("de la place libérée par un autre onglet : les changements en attente sont écrits", async () => {
    const d = refusing("QuotaExceededError");
    const s = new LocalStore(d.storage);
    s.watch();
    d.refuse = true;
    await s.save(project("a"));
    d.refuse = false;
    otherTabWrote();
    expect(s.stored()).toBe(true);
    expect(await ids(new LocalStore(d.storage))).toEqual(["a"]);
  });

  it("stockage inaccessible : signalé dès le départ, et les projets restent le temps de la visite", async () => {
    const s = new LocalStore(null);
    expect(s.stored()).toBe(false);
    await s.save(project("a"));
    expect(await ids(s)).toEqual(["a"]);
    expect(s.stored()).toBe(false);
  });

  it("la reprise de l'ancienne version refusée reste à écrire", async () => {
    const d = refusing("QuotaExceededError");
    d.storage.setItem("limon-v2", JSON.stringify({ ...DEFAULTS, H: 2850 }));
    d.refuse = true;
    const s = new LocalStore(d.storage);
    expect(s.stored()).toBe(false);
    d.refuse = false;
    await s.save(project("a"));
    expect(s.stored()).toBe(true);
    expect(await new LocalStore(d.storage).list()).toHaveLength(2);
  });
});
