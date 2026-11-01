import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { atelierDefauts, newAtelier } from "../src/core/atelier";
import { ENTREPRISE_VIDE, TARIFS_VIDES } from "../src/core/tarifs";
import { DEFAULTS } from "../src/core/params";
import { edited, newProject, parseProjectFile, projectFile, withEtat, type Project } from "../src/core/project";
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
    storage,
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
    expect(await a.store.status()).toMatchObject({ compte: null, pending: 0, offline: false });
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

  it("un identifiant hors format ne monte pas et ne descend pas", async () => {
    const a = device();
    await a.store.save(newProject("bon", "Bon", "complet", 1));
    await a.signIn("a@exemple.fr");
    // Une ligne d'avant le contrôle, déjà dans le compte : un appareil neuf ne la prend pas.
    const bad = newProject('a"b', "Hors format", "complet", 2);
    await s.db.query(
      "insert into projets (compte, id, modifie, supprime, donnees) select compte, $1, 2, false, $2 from projets limit 1",
      [bad.id, JSON.stringify(bad)],
    );
    const b = device();
    await b.signIn("a@exemple.fr");
    expect((await b.store.list()).map((p) => p.id)).toEqual(["bon"]);

    // Déjà sur un appareil : il tombe à la lecture, avant tout envoi.
    const storage = memory();
    storage.setItem("limon-projets", JSON.stringify([bad]));
    expect(await new LocalStore(storage).list()).toEqual([]);
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

  describe("avec une horloge en avance", () => {
    const HEURE = 3_600_000;
    const MINUTE = 60_000;
    /** Date du projet sur le serveur. */
    const onServer = async (id: string) =>
      (await s.db.query<{ modifie: string }>("select modifie from projets where id = $1", [id])).map((r) =>
        Number(r.modifie),
      )[0];
    const hauteur = async (d: ReturnType<typeof device>, id: string) => (await d.store.get(id))!.params.H;

    it("une modification reste chez les deux appareils, même faite avant l'heure de la version reçue", async () => {
      const t = Date.now();
      const a = device();
      const b = device();
      await a.signIn("jean@exemple.fr");
      await b.signIn("jean@exemple.fr");

      // A a une heure d'avance ; B reçoit sa version, puis la corrige cinq minutes plus tard.
      await a.store.save(newProject("p", "Dupont", "complet", t + HEURE, { ...DEFAULTS, H: 2700 }));
      await a.store.sync();
      await b.store.sync();
      const recu = (await b.store.get("p"))!;
      expect(recu.params.H).toBe(2700);
      const corrige = edited(recu, { ...recu.params, H: 3300 }, t + 5 * MINUTE);
      await b.store.save(corrige);

      await b.store.sync();
      // Le champ ne revient pas en arrière, et le serveur garde la correction.
      expect(await hauteur(b, "p")).toBe(3300);
      expect(await b.store.status()).toMatchObject({ pending: 0, offline: false });
      expect(await onServer("p")).toBe(corrige.modifie);
      await a.store.sync();
      expect(await hauteur(a, "p")).toBe(3300);
      await b.store.sync();
      expect(await hauteur(b, "p")).toBe(3300);
    });

    it("un fichier daté du futur : chaque modification suivante tient", async () => {
      const t = Date.now();
      const a = device();
      await a.signIn("jean@exemple.fr");
      const futur = { ...newProject("x", "Importé", "complet", t), modifie: t + 365 * 24 * HEURE };
      const importe = parseProjectFile(projectFile(futur), "p") as Project;
      await a.store.save(importe);
      await a.store.sync();

      let p = importe;
      for (const H of [2800, 2900, 3000]) {
        p = edited(p, { ...p.params, H }, Date.now());
        await a.store.save(p);
        await a.store.sync();
        expect(await hauteur(a, "p")).toBe(H);
        expect(await onServer("p")).toBe(p.modifie);
      }
      p = withEtat(p, "fini", Date.now());
      await a.store.save(p);
      await a.store.sync();
      expect((await a.store.get("p"))!.etat).toBe("fini");
      expect(await onServer("p")).toBe(p.modifie);

      const b = device();
      await b.signIn("jean@exemple.fr");
      expect((await b.store.get("p"))!).toMatchObject({ etat: "fini", params: { H: 3000 } });
    });

    it("un escalier daté du futur se supprime pour de bon", async () => {
      const t = Date.now();
      const a = device();
      const b = device();
      await a.signIn("jean@exemple.fr");
      await b.signIn("jean@exemple.fr");
      await a.store.save(newProject("p", "Dupont", "complet", t + HEURE));
      await a.store.sync();
      await b.store.sync();
      await b.store.remove("p");
      await b.store.sync();
      expect(await b.names()).toEqual([]);
      await a.store.sync();
      expect(await a.names()).toEqual([]);
      await b.store.sync();
      expect(await b.names()).toEqual([]);
    });

    it("deux modifications concurrentes hors ligne : la plus récente gagne toujours", async () => {
      const t = Date.now();
      const a = device();
      const b = device();
      await a.signIn("jean@exemple.fr");
      await b.signIn("jean@exemple.fr");
      await a.store.save(newProject("p", "Dupont", "complet", t, { ...DEFAULTS, H: 2700 }));
      await a.store.sync();
      await b.store.sync();

      a.online = b.online = false;
      const pa = (await a.store.get("p"))!;
      const pb = (await b.store.get("p"))!;
      // B modifie en dernier mais envoie en premier : l'ordre d'envoi ne décide pas.
      await a.store.save(edited(pa, { ...pa.params, H: 2800 }, t + MINUTE));
      await b.store.save(edited(pb, { ...pb.params, H: 2900 }, t + 2 * MINUTE));
      a.online = b.online = true;
      await b.store.sync();
      await a.store.sync();
      await b.store.sync();
      expect(await hauteur(a, "p")).toBe(2900);
      expect(await hauteur(b, "p")).toBe(2900);
      expect(await onServer("p")).toBe(t + 2 * MINUTE);
    });
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
    expect(await a.store.status()).toMatchObject({ compte: null, pending: 0, offline: false });
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
    expect(a.store.known()).toBe(false);
    expect(await s.db.query("select * from projets")).toEqual([]);
  });

  it("après une déconnexion, l'appareil se souvient qu'un compte existe", async () => {
    const a = device();
    expect(a.store.known()).toBe(false);
    await a.signIn("jean@exemple.fr");
    await a.store.signOut();
    expect(a.store.known()).toBe(true);
  });
});

describe("synchronisation du profil de l'atelier", () => {
  const defauts = (ess: "chene" | "noyer" | "frene" | "sapin") => ({ ...atelierDefauts(DEFAULTS), ess });

  it("monte dans le compte à la connexion et descend sur l'autre appareil", async () => {
    const a = device();
    a.atelier.set({ defauts: defauts("noyer") }, 1000);
    await a.signIn("jean@exemple.fr");
    const b = device();
    await b.signIn("jean@exemple.fr");
    expect(b.atelier.get()).toEqual(newAtelier(defauts("noyer"), 1000));
  });

  it("emporte les tarifs et la fiche de l'entreprise", async () => {
    const a = device();
    await a.signIn("jean@exemple.fr");
    a.atelier.set({ tarifs: { ...TARIFS_VIDES, taux: 45 }, entreprise: { ...ENTREPRISE_VIDE, nom: "Exemple" } }, 1000);
    await a.store.sync();
    const b = device();
    await b.signIn("jean@exemple.fr");
    expect(b.atelier.get()).toMatchObject({ tarifs: { taux: 45 }, entreprise: { nom: "Exemple" } });
  });

  it("garde la version modifiée en dernier", async () => {
    const a = device();
    const b = device();
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    b.atelier.set({ defauts: defauts("frene") }, 2000);
    await b.store.sync();
    await a.store.sync();
    expect(a.atelier.get()!.defauts.ess).toBe("frene");
    // Une version plus ancienne ne reprend pas la main, même envoyée après.
    a.atelier.set({ defauts: defauts("sapin") }, 500);
    await a.store.sync();
    expect(a.atelier.get()!.defauts.ess).toBe("frene");
  });

  it("quitte l'appareil à la déconnexion, et ne suit pas sur un autre compte", async () => {
    const a = device();
    a.atelier.set({ defauts: defauts("noyer") }, 1000);
    await a.signIn("jean@exemple.fr");
    await a.store.signOut();
    expect(a.atelier.get()).toBeNull();

    a.atelier.set({ defauts: defauts("sapin") }, 3000);
    await a.signIn("jean@exemple.fr");
    await a.signIn("marie@exemple.fr");
    expect(a.atelier.get()).toBeNull();
  });

  it("l'état dit si l'appareil garde les escaliers, et prévient quand cela change", async () => {
    const d = device();
    let notes = 0;
    d.store.onStatus(() => notes++);
    expect((await d.store.status()).stored).toBe(true);
    const full = () => {
      throw new DOMException("plein", "QuotaExceededError");
    };
    const setItem = d.storage.setItem;
    d.storage.setItem = full;
    await d.store.save(project("a", "A", 1));
    expect((await d.store.status()).stored).toBe(false);
    expect(notes).toBe(1);
    d.storage.setItem = setItem;
    await d.store.save(project("a", "A", 2));
    expect((await d.store.status()).stored).toBe(true);
    expect(notes).toBe(2);
  });

  it("ce qu'un autre onglet a changé arrive à la page et à l'état", async () => {
    const d = device();
    const seen: string[][] = [];
    let notes = 0;
    d.store.onChange((ids) => seen.push(ids));
    d.store.onStatus(() => notes++);
    await new LocalStore(d.storage).save(project("b", "Dans l'autre onglet", 1));
    await d.store.save(project("a", "Ici", 2));
    expect(seen).toEqual([["b"]]);
    expect(notes).toBe(1);
    expect(await d.names()).toEqual(["Dans l'autre onglet", "Ici"]);
  });
});
