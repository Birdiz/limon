import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { atelierDefauts } from "../src/core/atelier";
import { DEFAULTS } from "../src/core/params";
import { newProject, type Project } from "../src/core/project";
import { AtelierStore } from "../src/ui/atelier";
import { Api } from "../src/ui/api";
import { LocalStore, type KeyValue } from "../src/ui/store";
import { SyncStore } from "../src/ui/sync";
import { browser, login, testServer, type TestServer } from "./server";

/** Stockage d'un appareil. */
function memory(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

let s: TestServer;
beforeAll(async () => {
  s = await testServer();
});
beforeEach(() => s.reset());

/** Un appareil : son stockage, son navigateur (cookie), et un réseau qu'on peut couper. */
function device() {
  const storage = memory();
  const f = browser(s);
  const atelier = new AtelierStore(storage);
  const d = {
    online: true,
    requests: 0,
    f,
    atelier,
    store: new SyncStore(
      new LocalStore(storage),
      new Api(async (input, init) => {
        d.requests++;
        if (!d.online) throw new TypeError("Failed to fetch");
        return f(input, init);
      }),
      storage,
      atelier,
    ),
    async signIn(email: string) {
      await d.store.signIn(await login(s, f, email));
    },
    async names() {
      return (await d.store.list()).map((p) => p.nom).sort();
    },
  };
  return d;
}

const project = (id: string, nom: string, modifie: number): Project => ({
  ...newProject(id, nom, "complet", modifie),
  modifie,
});

describe("synchronisation des projets", () => {
  it("sans compte, tout reste sur l'appareil", async () => {
    const a = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.store.remove("p");
    await a.store.sync();
    expect(a.requests).toBe(0);
    expect(await a.store.status()).toEqual({ compte: null, pending: 0, offline: false });
  });

  it("à la première connexion, les projets de l'appareil montent dans le compte", async () => {
    const a = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.signIn("jean@exemple.fr");
    const b = device();
    await b.store.save(project("q", "Martin", 2));
    await b.signIn("jean@exemple.fr");
    expect(await b.names()).toEqual(["Dupont", "Martin"]);
    await a.store.sync();
    expect(await a.names()).toEqual(["Dupont", "Martin"]);
  });

  it("garde la version modifiée en dernier, projet par projet", async () => {
    const a = device();
    const b = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.store.save(project("q", "Martin", 1));
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    await a.store.save(project("p", "Dupont (a)", 10));
    await b.store.save(project("p", "Dupont (b)", 5));
    await b.store.save(project("q", "Martin (b)", 20));
    await b.store.sync();
    await a.store.sync();
    await b.store.sync();
    expect(await a.names()).toEqual(["Dupont (a)", "Martin (b)"]);
    expect(await b.names()).toEqual(["Dupont (a)", "Martin (b)"]);
  });

  it("hors ligne, écrit tout de suite et envoie au retour du réseau", async () => {
    const a = device();
    await a.signIn("jean@exemple.fr");
    a.online = false;
    await a.store.save(project("p", "Dupont", 1));
    await a.store.sync();
    expect(await a.names()).toEqual(["Dupont"]);
    expect(await a.store.status()).toMatchObject({ pending: 1, offline: true });
    a.online = true;
    await a.store.sync();
    expect(await a.store.status()).toMatchObject({ pending: 0, offline: false });
    const b = device();
    await b.signIn("jean@exemple.fr");
    expect(await b.names()).toEqual(["Dupont"]);
  });

  it("une suppression ne revient pas, sauf modification plus récente ailleurs", async () => {
    const a = device();
    const b = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    await a.store.remove("p");
    await a.store.sync();
    await b.store.sync();
    expect(await b.names()).toEqual([]);
    await a.store.sync();
    expect(await a.names()).toEqual([]);

    await b.store.save(project("q", "Martin", 1));
    await b.store.sync();
    await a.store.sync();
    b.online = false;
    await a.store.remove("q");
    await b.store.save({ ...project("q", "Martin repris", Date.now() + 1000) });
    await a.store.sync();
    b.online = true;
    await b.store.sync();
    await a.store.sync();
    expect(await a.names()).toEqual(["Martin repris"]);
  });

  it("garde le projet ouvert propre à chaque appareil", async () => {
    const a = device();
    const b = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.store.save(project("q", "Martin", 1));
    await a.store.setCurrent("p");
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    await b.store.setCurrent("q");
    await a.store.sync();
    expect(await a.store.currentId()).toBe("p");
    expect(await b.store.currentId()).toBe("q");
  });

  it("signale les projets changés par un échange", async () => {
    const a = device();
    const b = device();
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    const seen: string[][] = [];
    b.store.onChange((ids) => seen.push(ids));
    await a.store.save(project("p", "Dupont", 1));
    await a.store.sync();
    await b.store.sync();
    expect(seen).toEqual([["p"]]);
  });

  it("à la déconnexion, les projets du compte quittent l'appareil", async () => {
    const a = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.signIn("jean@exemple.fr");
    a.online = false;
    await a.store.save(project("p", "Dupont modifié", 2));
    await expect(a.store.signOut()).rejects.toThrow(/retrouvez du réseau/);
    expect(await a.names()).toEqual(["Dupont modifié"]);
    a.online = true;
    await a.store.signOut();
    expect(await a.names()).toEqual([]);
    expect(await a.store.status()).toEqual({ compte: null, pending: 0, offline: false });
    expect((await a.f("/api/compte")).status).toBe(401);
    const b = device();
    await b.signIn("jean@exemple.fr");
    expect(await b.names()).toEqual(["Dupont modifié"]);
  });

  it("session expirée : les projets restent, et suivent le compte suivant s'ils n'étaient pas envoyés", async () => {
    const a = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.signIn("jean@exemple.fr");
    await s.db.query("delete from sessions");
    await a.store.save(project("q", "Martin", 2));
    await a.store.sync();
    expect(a.store.account()).toBeNull();
    expect(await a.names()).toEqual(["Dupont", "Martin"]);
    // Même compte : rien ne quitte l'appareil.
    await a.signIn("jean@exemple.fr");
    expect(await a.names()).toEqual(["Dupont", "Martin"]);
    await s.db.query("delete from sessions");
    await a.store.save(project("r", "Durand", 3));
    await a.store.sync();
    // Autre compte : Dupont et Martin restent dans le compte de Jean, Durand suit Marie.
    await a.signIn("marie@exemple.fr");
    expect(await a.names()).toEqual(["Durand"]);
    const b = device();
    await b.signIn("jean@exemple.fr");
    expect(await b.names()).toEqual(["Dupont", "Martin"]);
  });

  it("compte supprimé ailleurs puis recréé avec la même adresse : les projets restent et remontent", async () => {
    const a = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.signIn("jean@exemple.fr");
    await s.db.query("delete from comptes");
    await a.store.sync();
    expect(a.store.account()).toBeNull();
    await a.signIn("jean@exemple.fr");
    expect(await a.names()).toEqual(["Dupont"]);
    const b = device();
    await b.signIn("jean@exemple.fr");
    expect(await b.names()).toEqual(["Dupont"]);
  });

  it("compte supprimé : les projets restent sur l'appareil", async () => {
    const a = device();
    await a.store.save(project("p", "Dupont", 1));
    await a.signIn("jean@exemple.fr");
    await a.store.deleteAccount();
    expect(await a.names()).toEqual(["Dupont"]);
    expect(a.store.account()).toBeNull();
    expect(await s.db.query("select * from projets")).toEqual([]);
  });
});

describe("synchronisation du profil de l'atelier", () => {
  const defauts = (ess: "chene" | "noyer" | "frene" | "sapin") => ({ ...atelierDefauts(DEFAULTS), ess });

  it("monte dans le compte à la connexion et descend sur l'autre appareil", async () => {
    const a = device();
    a.atelier.set(defauts("noyer"), 1000);
    await a.signIn("jean@exemple.fr");
    const b = device();
    await b.signIn("jean@exemple.fr");
    expect(b.atelier.get()).toEqual({ defauts: defauts("noyer"), modifie: 1000 });
  });

  it("garde la version modifiée en dernier", async () => {
    const a = device();
    const b = device();
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    b.atelier.set(defauts("frene"), 2000);
    await b.store.sync();
    await a.store.sync();
    expect(a.atelier.get()!.defauts.ess).toBe("frene");
    // Une version plus ancienne ne reprend pas la main, même envoyée après.
    a.atelier.set(defauts("sapin"), 500);
    await a.store.sync();
    expect(a.atelier.get()!.defauts.ess).toBe("frene");
  });

  it("quitte l'appareil à la déconnexion, et ne suit pas sur un autre compte", async () => {
    const a = device();
    a.atelier.set(defauts("noyer"), 1000);
    await a.signIn("jean@exemple.fr");
    await a.store.signOut();
    expect(a.atelier.get()).toBeNull();

    a.atelier.set(defauts("sapin"), 3000);
    await a.signIn("jean@exemple.fr");
    await a.signIn("marie@exemple.fr");
    expect(a.atelier.get()).toBeNull();
  });
});
