import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { atelierDefauts, newAtelier } from "../src/core/atelier";
import { ENTREPRISE_VIDE, TARIFS_VIDES } from "../src/core/tarifs";
import { DEFAULTS } from "../src/core/params";
import { edited, newProject, parseProjectFile, projectFile, SCHEMA, withEtat, type Project } from "../src/core/project";
import { compute } from "../src/core/stair";
import { AtelierStore } from "../src/ui/atelier";
import { Api } from "../src/ui/api";
import { LocalStore, type KeyValue } from "../src/ui/store";
import { lots, SyncStore } from "../src/ui/sync";
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
function device(storage = memory()) {
  const f = browser(s);
  const atelier = new AtelierStore(storage);
  const d = {
    online: true,
    requests: 0,
    /** Réponse d'erreur du serveur, à la place du serveur. */
    panne: null as number | null,
    /** Éléments de chaque envoi de projets. */
    envois: [] as number[],
    storage,
    f,
    atelier,
    store: new SyncStore(
      new LocalStore(storage),
      new Api(async (input, init): Promise<Response> => {
        d.requests++;
        if (!d.online) throw new TypeError("Failed to fetch");
        if (d.panne) return new Response("<html>", { status: d.panne });
        if (init?.method === "PUT" && String(input).endsWith("projets"))
          d.envois.push((JSON.parse(init.body as string) as { changements: unknown[] }).changements.length);
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

  it("un escalier hors bornes reçu du compte se signale sur son champ et se supprime", async () => {
    const a = device();
    const b = device();
    await a.signIn("jean@exemple.fr");
    await a.store.save({ ...project("p", "Dupont", 1), params: { ...DEFAULTS, H: 1e15 } });
    await a.store.sync();
    await b.signIn("jean@exemple.fr");
    const [recu] = await b.store.list();
    const r = compute(recu!.params);
    expect(r.ok ? [] : r.errors.map((e) => e.key)).toEqual(["H"]);
    await b.store.remove("p");
    await b.store.sync();
    await a.store.sync();
    expect(await a.names()).toEqual([]);
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
      const importe = (parseProjectFile(projectFile(futur), "p") as { projet: Project }).projet;
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

describe("projet d'une version plus récente de l'outil", () => {
  /** La ligne, telle que l'aurait écrite une version plus récente que cette page, ou redevenue lisible par elle. */
  const schemaEnLigne = (id: string, schema: number) =>
    s.db.query("update projets set donnees = donnees || jsonb_build_object('schema', $1::int) where id = $2", [
      schema,
      id,
    ]);
  const enLigne = async (id: string) =>
    (
      await s.db.query<{ modifie: number; nom: string }>(
        "select modifie, donnees->>'nom' as nom from projets where id = $1",
        [id],
      )
    )[0]!;
  const deuxAppareils = async () => {
    const [a, b] = [device(), device()];
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    return { a, b };
  };

  it("une page ne range pas un projet de schéma plus haut et l'indique, sans parler de conflit", async () => {
    const { a, b } = await deuxAppareils();
    await b.store.save(project("p", "Dupont", 5));
    await b.store.sync();
    await schemaEnLigne("p", SCHEMA + 1);
    await a.store.sync();
    expect(await a.store.get("p")).toBeNull();
    expect(await a.store.status()).toMatchObject({
      plusRecents: 1,
      pending: 0,
      refuses: [],
      erreur: null,
      offline: false,
    });
    await a.store.signOut();
    expect((await a.store.status()).compte).toBeNull();
  });

  it("garde sa copie plus ancienne, et ne l'envoie pas", async () => {
    const { a, b } = await deuxAppareils();
    await a.store.save(project("p", "Dupont", 5));
    await a.store.sync();
    await b.store.sync();
    await b.store.save(project("p", "Dupont (b)", 10));
    await b.store.sync();
    await schemaEnLigne("p", SCHEMA + 1);
    await a.store.sync();
    expect((await a.store.get("p"))!.nom).toBe("Dupont");
    expect(await a.store.status()).toMatchObject({ plusRecents: 1, pending: 0, refuses: [] });
    expect(await enLigne("p")).toMatchObject({ nom: "Dupont (b)" });
  });

  it("le projet arrive une fois lisible, et l'indication s'en va", async () => {
    const { a, b } = await deuxAppareils();
    await b.store.save(project("p", "Dupont", 5));
    await b.store.sync();
    await schemaEnLigne("p", SCHEMA + 1);
    await a.store.sync();
    await schemaEnLigne("p", SCHEMA);
    await a.store.sync();
    expect(await a.names()).toEqual(["Dupont"]);
    expect((await a.store.status()).plusRecents).toBe(0);
  });

  it("une copie retouchée sur l'ancienne page n'écrase pas la ligne, reste ici, et le refus tient au chargement suivant", async () => {
    const { a, b } = await deuxAppareils();
    await a.store.save(project("p", "Dupont", 5));
    await a.store.sync();
    await b.store.sync();
    await b.store.save(project("p", "Dupont (b)", 10));
    await b.store.sync();
    await schemaEnLigne("p", SCHEMA + 1);
    await a.store.sync();
    const copie = (await a.store.get("p"))!;
    await a.store.save({ ...copie, nom: "Dupont (a)", modifie: 20 });
    await a.store.sync();
    expect(await enLigne("p")).toMatchObject({ nom: "Dupont (b)", modifie: 10 });
    const st = await a.store.status();
    expect(st).toMatchObject({ pending: 0, erreur: null, offline: false });
    expect(st.refuses).toEqual([
      { id: "p", nom: "Dupont (a)", raison: expect.stringContaining("version plus récente") as string },
    ]);

    const rechargee = device(a.storage);
    await rechargee.signIn("jean@exemple.fr");
    expect(await enLigne("p")).toMatchObject({ nom: "Dupont (b)", modifie: 10 });
    expect((await rechargee.store.status()).refuses.map((r) => r.nom)).toEqual(["Dupont (a)"]);
    await rechargee.store.signOut();
    expect(await rechargee.names()).toEqual(["Dupont (a)"]);
  });

  it("une copie d'avant le numéro, encore à envoyer, garde en ligne ce qu'elle n'a jamais connu", async () => {
    const { a, b } = await deuxAppareils();
    const neuf = { lignes: "du futur" };
    await a.store.save(project("p", "Dupont", 5));
    await a.store.sync();
    await s.db.query("update projets set donnees = donnees || jsonb_build_object('champNeuf', $1::jsonb)", [
      JSON.stringify(neuf),
    ]);
    a.storage.setItem(
      "limon-projets",
      // Sans le numéro, comme l'a écrit une version d'avant lui.
      JSON.stringify([{ ...project("p", "Dupont (a)", 20), schema: undefined }]),
    );
    const rechargee = device(a.storage);
    await rechargee.signIn("jean@exemple.fr");
    expect(await enLigne("p")).toMatchObject({ nom: "Dupont (a)", modifie: 20 });
    const [row] = await s.db.query<{ neuf: unknown }>("select donnees->'champNeuf' as neuf from projets");
    expect(row!.neuf).toEqual(neuf);
    await b.store.sync();
    expect((await b.store.get("p"))!.nom).toBe("Dupont (a)");
  });
});

describe("refus du serveur à l'envoi", () => {
  /** Compte connecté, avec un projet déjà en ligne et un autre qui attend de descendre. */
  const connected = async () => {
    const a = device();
    const other = device();
    await other.store.save(project("autre", "Sur l'autre appareil", 5));
    await other.signIn("jean@exemple.fr");
    await a.signIn("jean@exemple.fr");
    return a;
  };
  /** Fichier .escalier relu, tel que l'accueil l'ouvre. */
  const opened = (id: string, nom: string, modifie: number) => {
    const r = parseProjectFile(projectFile({ ...newProject("x", nom, "complet", 1), modifie }), id);
    if ("erreur" in r) throw new Error(r.erreur);
    return r.projet;
  };
  const onServer = async () =>
    (await s.db.query<{ id: string }>("select id from projets where not supprime order by id")).map((r) => r.id);

  it.each([1e300, 1e19])("un fichier à une date de %d n'arrête pas les escaliers sains", async (date) => {
    const a = await connected();
    await a.store.save(project("sain", "Sain", 10));
    await a.store.save(opened("abime", "Abîmé", date));
    await a.store.save(project("sain2", "Sain 2", 10));
    // Un second appareil a fait monter un escalier après la dernière descente.
    const c = device();
    await c.signIn("jean@exemple.fr");
    await c.store.save(project("neuf", "Neuf", 11));
    await c.store.sync();
    await a.store.sync();

    expect(await onServer()).toEqual(["autre", "neuf", "sain", "sain2"]);
    expect(await a.names()).toEqual(["Abîmé", "Neuf", "Sain", "Sain 2", "Sur l'autre appareil"]);
    const st = await a.store.status();
    expect(st).toMatchObject({ offline: false, erreur: null, pending: 0 });
    expect(st.refuses).toEqual([{ id: "abime", nom: "Abîmé", raison: expect.stringContaining("date") as string }]);

    // La déconnexion est possible, et l'escalier refusé, qui n'est nulle part ailleurs, reste sur l'appareil.
    await a.store.signOut();
    expect(await a.names()).toEqual(["Abîmé"]);
    expect((await a.store.status()).compte).toBeNull();
  });

  it("un nom avec un caractère NUL arrive sans lui", async () => {
    const a = await connected();
    await a.store.save(opened("nul", "Du\u0000pont", 10));
    await a.store.sync();
    expect(await onServer()).toEqual(["autre", "nul"]);
    expect(await a.store.status()).toMatchObject({ offline: false, pending: 0, refuses: [] });
    expect((await a.store.get("nul"))!.nom).toBe("Dupont");
  });

  it("une suppression à identifiant de plus de 100 caractères est nommée, sans attente sans fin", async () => {
    const a = await connected();
    const long = "x".repeat(101);
    await a.store.remove(long);
    await a.store.sync();
    const st = await a.store.status();
    expect(st).toMatchObject({ offline: false, pending: 0 });
    expect(st.refuses).toEqual([{ id: long, nom: null, raison: expect.stringContaining("identifiant") as string }]);
    await a.store.signOut();
    expect((await a.store.status()).compte).toBeNull();
  });

  it("plus de 1 000 escaliers : tous arrivent, par lots de 500", async () => {
    const storage = memory();
    const list = Array.from({ length: 1201 }, (_, i) => project(`p${i}`, `P${i}`, 10));
    storage.setItem("limon-projets", JSON.stringify(list));
    const a = device(storage);
    await a.signIn("jean@exemple.fr");
    expect(a.envois).toEqual([500, 500, 201]);
    expect(await onServer()).toHaveLength(1201);
    expect(await a.store.status()).toMatchObject({ pending: 0, offline: false, refuses: [] });
  }, 60_000);

  it("les lots tiennent aussi dans ce que le serveur accepte", () => {
    const gros = (id: string) => ({ id, projet: { ...project(id, "x".repeat(1 << 20), 1) } });
    const sizes = lots(["a", "b", "c", "d"].map(gros)).map((l) => l.length);
    expect(sizes).toEqual([2, 2]);
    expect(lots([])).toEqual([]);
  });

  it("un escalier trop gros pour le serveur est refusé seul, les autres partent", async () => {
    const a = await connected();
    await a.store.save(project("sain", "Sain", 10));
    await a.store.save(project("gros", "x".repeat(5 << 20), 10));
    await a.store.save(project("sain2", "Sain 2", 10));
    await a.store.sync();
    expect(await onServer()).toEqual(["autre", "sain", "sain2"]);
    const st = await a.store.status();
    expect(st).toMatchObject({ offline: false, erreur: null, pending: 0 });
    expect(st.refuses.map((r) => r.id)).toEqual(["gros"]);
  });

  it("une vraie coupure reste une coupure, le projet reste à envoyer", async () => {
    const a = await connected();
    a.online = false;
    await a.store.save(project("p", "Dupont", 10));
    await a.store.sync();
    expect(await a.store.status()).toMatchObject({ offline: true, erreur: null, pending: 1, refuses: [] });
    await expect(a.store.signOut()).rejects.toThrow("réseau");
    a.online = true;
    await a.store.sync();
    expect(await a.store.status()).toMatchObject({ offline: false, erreur: null, pending: 0 });
    expect(await onServer()).toEqual(["autre", "p"]);
  });

  it("un serveur en panne n'est pas une coupure : l'écran dit ses mots, le projet reste à envoyer", async () => {
    const a = await connected();
    a.panne = 503;
    await a.store.save(project("p", "Dupont", 10));
    await a.store.sync();
    const st = await a.store.status();
    expect(st).toMatchObject({ offline: false, pending: 1 });
    expect(st.erreur).toContain("Le serveur ne répond pas");
    await expect(a.store.signOut()).rejects.toThrow("Le serveur ne répond pas");
    a.panne = null;
    await a.store.sync();
    expect(await a.store.status()).toMatchObject({ offline: false, erreur: null, pending: 0 });
  });

  it("un profil de l'atelier refusé n'arrête pas les escaliers", async () => {
    const a = await connected();
    a.atelier.set({ defauts: atelierDefauts(DEFAULTS) }, 1e300);
    await a.store.save(project("p", "Dupont", 10));
    await a.store.sync();
    expect(await onServer()).toEqual(["autre", "p"]);
    const st = await a.store.status();
    expect(st).toMatchObject({ offline: false, pending: 0 });
    expect(st.erreur).toContain("profil de l'atelier");
    await a.store.signOut();
  });

  it("une autre version d'un escalier refusé repart", async () => {
    const a = await connected();
    const refused = opened("p", "Dupont", 1000.5);
    await a.store.save(refused);
    await a.store.sync();
    expect((await a.store.status()).refuses).toHaveLength(1);
    // La modification suivante lui donne une date valable.
    await a.store.save(edited(refused, { ...refused.params, H: refused.params.H + 10 }, Date.now()));
    expect(await a.store.status()).toMatchObject({ pending: 1, refuses: [] });
    await a.store.sync();
    expect(await a.store.status()).toMatchObject({ pending: 0, refuses: [] });
    expect(await onServer()).toEqual(["autre", "p"]);
  });

  it("modifié, un escalier trop loin dans le futur reste refusé et nommé", async () => {
    const a = await connected();
    const refused = project("p", "Dupont", Date.now() + 800 * 86_400_000);
    await a.store.save(refused);
    await a.store.sync();
    await a.store.save(edited(refused, { ...refused.params, H: refused.params.H + 10 }, Date.now()));
    await a.store.sync();
    expect(await a.store.status()).toMatchObject({ pending: 0, offline: false });
    expect((await a.store.status()).refuses.map((r) => r.nom)).toEqual(["Dupont"]);
    expect(await onServer()).toEqual(["autre"]);
  });

  it("un refus ne repart pas à chaque échange, mais une fois au chargement suivant", async () => {
    const a = await connected();
    await a.store.save(project("p", "Dupont", Date.now() + 800 * 86_400_000));
    await a.store.sync();
    expect(a.envois).toHaveLength(1);
    await a.store.sync();
    expect(a.envois).toHaveLength(1);

    // Page rechargée : l'état du refus est encore là, l'envoi repart une fois.
    let puts = 0;
    const reloaded = new SyncStore(
      new LocalStore(a.storage),
      new Api(async (input, init) => {
        if (init?.method === "PUT") puts++;
        return a.f(input, init);
      }),
      a.storage,
    );
    expect((await reloaded.status()).refuses).toHaveLength(1);
    await reloaded.sync();
    expect(puts).toBe(1);
    await reloaded.sync();
    expect(puts).toBe(1);
    expect(await reloaded.status()).toMatchObject({ pending: 0, offline: false });
    expect((await reloaded.status()).refuses).toHaveLength(1);
  });

  it("un escalier refusé qu'on supprime ne laisse pas de suppression à envoyer", async () => {
    const a = await connected();
    await a.store.save(project("p", "Dupont", 1e300));
    await a.store.sync();
    await a.store.remove("p");
    expect(await a.store.status()).toMatchObject({ pending: 0, refuses: [] });
    await a.store.sync();
    expect(await s.db.query("select id from projets where id = 'p'")).toEqual([]);
  });

  it("le plafond du compte refuse les escaliers en trop, le reste fonctionne", async () => {
    const a = await connected();
    const [row] = await s.db.query<{ compte: string }>("select compte from projets");
    await s.db.query(
      `insert into projets (compte, id, modifie, supprime, donnees)
       select $1::uuid, 'plein' || i, 1, true, null from generate_series(1, 1999) i`,
      [row!.compte],
    );
    await a.store.save(project("autre", "Modifié", 50));
    await a.store.save(project("trop", "De trop", 50));
    await a.store.sync();
    const st = await a.store.status();
    expect(st).toMatchObject({ offline: false, erreur: null, pending: 0 });
    expect(st.refuses).toEqual([{ id: "trop", nom: "De trop", raison: expect.stringContaining("2000") as string }]);
    const [autre] = await s.db.query<{ nom: string }>("select donnees->>'nom' as nom from projets where id = 'autre'");
    expect(autre!.nom).toBe("Modifié");
  });
});

describe("synchronisation du profil de l'atelier", () => {
  const defauts = (ess: "chene" | "noyer" | "frene" | "sapin") => ({ ...atelierDefauts(DEFAULTS), ess });
  /** Le profil tel que le serveur le garde. */
  const atelierEnLigne = async () => {
    const rows = await s.db.query<{ modifie: string; ess: string }>(
      "select modifie, donnees->>'ess' as ess from ateliers",
    );
    return { modifie: Number(rows[0]!.modifie), ess: rows[0]!.ess };
  };

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

  it("deux modifications concurrentes hors ligne : garde la version modifiée en dernier", async () => {
    const a = device();
    const b = device();
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    a.atelier.set({ defauts: defauts("noyer") }, 1000);
    await a.store.sync();
    await b.store.sync();
    expect(b.atelier.get()!.modifie).toBe(1000);

    a.online = b.online = false;
    a.atelier.set({ defauts: defauts("sapin") }, 2000);
    b.atelier.set({ defauts: defauts("frene") }, 3000);
    a.online = b.online = true;
    // B modifie en dernier mais envoie en premier : l'ordre d'envoi ne décide pas.
    await b.store.sync();
    await a.store.sync();
    await b.store.sync();
    expect(a.atelier.get()!.defauts.ess).toBe("frene");
    expect(b.atelier.get()!.defauts.ess).toBe("frene");
    expect(await atelierEnLigne()).toEqual({ modifie: 3000, ess: "frene" });
  });

  it("avec une horloge en retard, une modification l'emporte sur la version qu'elle remplace", async () => {
    const a = device();
    const b = device();
    await a.signIn("jean@exemple.fr");
    await b.signIn("jean@exemple.fr");
    b.atelier.set({ defauts: defauts("frene") }, 2000);
    await b.store.sync();
    await a.store.sync();
    expect(a.atelier.get()!.defauts.ess).toBe("frene");

    // L'horloge de A retarde sur celle de B : sa modification tient quand même, et la suivante aussi.
    for (const ess of ["sapin", "noyer"] as const) {
      a.atelier.set({ defauts: defauts(ess) }, 500);
      await a.store.sync();
      await b.store.sync();
      expect(a.atelier.get()!.defauts.ess).toBe(ess);
      expect(b.atelier.get()!.defauts.ess).toBe(ess);
      expect(await atelierEnLigne()).toEqual({ modifie: a.atelier.get()!.modifie, ess });
    }
    expect(a.atelier.get()!.modifie).toBe(2002);
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
