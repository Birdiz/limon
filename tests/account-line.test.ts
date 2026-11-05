// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { newProject, SCHEMA } from "../src/core/project";
import { TARIFS_VIDES } from "../src/core/tarifs";
import { AccountPanel } from "../src/ui/account";
import { Api } from "../src/ui/api";
import { AtelierStore } from "../src/ui/atelier";
import { LocalStore, type KeyValue } from "../src/ui/store";
import { SyncStore } from "../src/ui/sync";

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

/** Laisse `refreshLine`, asynchrone, écrire l'en-tête. */
const settled = () => new Promise((r) => setTimeout(r));
const line = () => document.querySelector<HTMLElement>("#saved")!;
const COMPTE = { id: "c", email: "a@exemple.fr", statut: "testeur" as const };

function panel(storage: KeyValue | null) {
  const store = new SyncStore(
    new LocalStore(storage),
    new Api(async () => new Response("[]", { status: 200 })),
    storage,
  );
  new AccountPanel(store, new Api(), null);
  return store;
}

function memoire(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

function refusing() {
  const m = new Map<string, string>();
  const d = {
    refuse: false,
    storage: {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => {
        if (d.refuse) throw new DOMException("plein", "QuotaExceededError");
        m.set(k, v);
      },
      removeItem: (k) => void m.delete(k),
    } as KeyValue,
  };
  return d;
}

describe("état de l'enregistrement dans l'en-tête", () => {
  beforeEach(() => {
    document.body.innerHTML = body;
  });

  it("sans compte : dit l'échec, invite à garder une copie, puis le retire", async () => {
    const d = refusing();
    const store = panel(d.storage);
    await settled();
    expect(line().textContent).toBe("Enregistré sur cet appareil");
    expect(line().classList.contains("fail")).toBe(false);

    d.refuse = true;
    await store.save(newProject("a", "A", "complet", 1));
    await settled();
    expect(line().textContent).not.toContain("Enregistré");
    expect(line().textContent).toContain("pas gardé sur cet appareil");
    expect(line().textContent).toContain("copie en fichier");
    expect(line().classList.contains("fail")).toBe(true);

    d.refuse = false;
    await store.save(newProject("a", "A", "complet", 2));
    await settled();
    expect(line().textContent).toBe("Enregistré sur cet appareil");
    expect(line().classList.contains("fail")).toBe(false);
  });

  it("accès refusé dès l'ouverture : l'en-tête ne dit jamais « Enregistré »", async () => {
    panel(null);
    await settled();
    expect(line().textContent).toContain("pas gardé sur cet appareil");
  });

  it("avec un compte : l'échec passe aussi avant « Enregistré sur tous vos appareils »", async () => {
    const d = refusing();
    d.refuse = true;
    const store = panel(d.storage);
    await store.signIn(COMPTE);
    await store.save(newProject("a", "A", "complet", 1));
    await settled();
    expect(line().textContent).toContain("pas gardé sur cet appareil");
    expect(line().classList.contains("fail")).toBe(true);
  });

  it("un escalier d'une version plus récente : ni échec, ni attente, et rien à faire pour l'artisan", async () => {
    const m = new Map<string, string>();
    const storage: KeyValue = {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
    const api = new Api(async (input) => {
      const url = String(input);
      const body = url.endsWith("lire")
        ? [{ ...newProject("r", "Récent", "complet", 5), schema: SCHEMA + 1 }]
        : url.endsWith("projets")
          ? [{ id: "r", modifie: 5, supprime: false }]
          : [];
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const store = new SyncStore(new LocalStore(storage), api, storage);
    new AccountPanel(store, api, null);
    await store.signIn(COMPTE);
    await settled();
    expect(line().textContent).toContain("1 escalier d'un autre appareil arrivera tout seul");
    expect(line().textContent).not.toContain("Enregistré sur tous");
    expect(line().classList.contains("fail")).toBe(false);
    expect(line().classList.contains("wait")).toBe(false);
  });

  describe("envoi au compte", () => {
    /** Panneau sur un serveur simulé : `reponse` donne ce que répond un envoi de projets. */
    function connected(reponse: () => Response | Promise<Response>) {
      const m = new Map<string, string>();
      const storage: KeyValue = {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
      };
      const api = new Api(async (input, init) => {
        if (init?.method === "PUT") return reponse();
        const body = String(input).endsWith("compte") ? { ...COMPTE, passkeys: [], appareils: [] } : [];
        return new Response(JSON.stringify(body), { status: 200 });
      });
      const store = new SyncStore(new LocalStore(storage), api, storage);
      return { store, panel: new AccountPanel(store, api, null) };
    }
    const refus = (id: string, raison: string) =>
      new Response(JSON.stringify({ index: [], refus: [{ id, raison }] }), { status: 200 });

    it("nomme l'escalier refusé et sa raison, sans parler de réseau, et en donne une copie", async () => {
      const { store, panel } = connected(() => refus("a", "Sa date de modification est impossible."));
      await store.signIn(COMPTE);
      await store.save(newProject("a", 'Du<pont & "fils"', "complet", 1));
      await store.sync();
      await panel.show();
      await settled();

      expect(line().textContent).toContain('« Du<pont & "fils" »');
      expect(line().classList.contains("fail")).toBe(true);
      const state = document.querySelector("#acState")!.textContent;
      for (const text of [line().textContent, state]) {
        expect(text).not.toContain("réseau");
        expect(text).not.toContain("en cours d'envoi");
      }
      const item = document.querySelector<HTMLElement>("#acRefus")!;
      expect(item.hidden).toBe(false);
      expect(item.querySelector("b")!.textContent).toBe('Du<pont & "fils"');
      expect(item.textContent).toContain("Sa date de modification est impossible.");

      const files: { name: string; blob: Blob }[] = [];
      let lastBlob: Blob;
      URL.createObjectURL = (b) => {
        lastBlob = b as Blob;
        return "blob:x";
      };
      URL.revokeObjectURL = () => {};
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        files.push({ name: this.download, blob: lastBlob });
      };
      try {
        item.querySelector<HTMLButtonElement>("button[data-copie]")!.click();
        await settled();
      } finally {
        HTMLAnchorElement.prototype.click = click;
      }
      expect(files.map((f) => f.name)).toEqual(["Du pont & fils.escalier"]);
      const copie = JSON.parse(await files[0]!.blob.text()) as { format: string; projet: { nom: string } };
      expect(copie).toMatchObject({ format: "limon-projet", projet: { nom: 'Du<pont & "fils"' } });
    });

    it("un serveur qui refuse tout l'envoi est dit dans ses mots", async () => {
      const { store } = connected(
        () => new Response(JSON.stringify({ erreur: "Trop d'envois en peu de temps." }), { status: 429 }),
      );
      await store.signIn(COMPTE);
      await store.save(newProject("a", "A", "complet", 1));
      await store.sync();
      await settled();
      expect(line().textContent).toContain("Trop d'envois en peu de temps.");
      expect(line().textContent).toContain("1 escalier pas encore envoyé");
      expect(line().textContent).not.toContain("réseau");
    });

    it("le profil de l'atelier en attente est nommé, sans parler d'escalier", async () => {
      const storage = memoire();
      const atelier = new AtelierStore(storage);
      const store = new SyncStore(
        new LocalStore(storage),
        new Api(() => Promise.reject(new TypeError("Failed to fetch"))),
        storage,
        atelier,
      );
      new AccountPanel(store, new Api(), null);
      await store.signIn(COMPTE);
      atelier.set({ tarifs: { ...TARIFS_VIDES, taux: 45 } }, 1000);
      store.atelierChanged();
      await settled();
      expect(line().textContent).toBe("Votre atelier à envoyer dès que le réseau revient");
      expect(line().classList.contains("wait")).toBe(true);
      await store.save(newProject("a", "A", "complet", 1));
      await store.sync();
      await settled();
      expect(line().textContent).toBe("1 escalier et votre atelier à envoyer dès que le réseau revient");
    });

    it("une vraie coupure reste annoncée comme une coupure", async () => {
      const { store } = connected(() => Promise.reject(new TypeError("Failed to fetch")));
      await store.signIn(COMPTE);
      await store.save(newProject("a", "A", "complet", 1));
      await store.sync();
      await settled();
      expect(line().textContent).toBe("1 escalier à envoyer dès que le réseau revient");
      expect(line().classList.contains("fail")).toBe(false);
    });
  });
});
