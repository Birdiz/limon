import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { atelierDefauts, newAtelier } from "../src/core/atelier";
import { ENTREPRISE_VIDE, TARIFS_VIDES } from "../src/core/tarifs";
import { DEFAULTS } from "../src/core/params";
import { buildCNC } from "../src/cnc/build";
import { quantites } from "../src/cnc/quantites";
import { MAX_OCTETS, SAISIE_DEFAUT, bloquants, devis, newDevis, remettre, type DevisProjet } from "../src/core/devis";
import { compute } from "../src/core/stair";
import { newProject, NOM_PAR_DEFAUT, SCHEMA, type Project } from "../src/core/project";
import { migrate, pgliteDb, purge, purgeComptes } from "../server/db";
import { brevoAvertissement } from "../server/mail";
import { browser, login, ORIGIN, testServer, type TestServer } from "./server";

const json = { "content-type": "application/json" };
const post = (f: typeof fetch, url: string, body: unknown, method = "POST") =>
  f(url, { method, headers: json, body: JSON.stringify(body) });

let s: TestServer;
beforeAll(async () => {
  s = await testServer();
});
beforeEach(() => s.reset());

describe("connexion par code", () => {
  it("crée le compte au premier code, puis le retrouve", async () => {
    const f = browser(s);
    const a = await login(s, f, " Jean@Exemple.fr ");
    expect(a).toMatchObject({ email: "jean@exemple.fr", statut: "testeur" });
    expect(await (await f("/api/compte")).json()).toMatchObject({ id: a.id, passkeys: [] });
    const b = await login(s, browser(s), "jean@exemple.fr");
    expect(b.id).toBe(a.id);
  });

  it("répond pareil qu'un compte existe ou non", async () => {
    await login(s, browser(s), "a@exemple.fr");
    const known = await post(browser(s), "/api/code", { email: "a@exemple.fr" });
    const unknown = await post(browser(s), "/api/code", { email: "b@exemple.fr" });
    expect([known.status, unknown.status]).toEqual([204, 204]);
  });

  it("refuse un mauvais code, puis tout code après 5 essais", async () => {
    const f = browser(s);
    await post(f, "/api/code", { email: "a@exemple.fr" });
    const good = s.codes.get("a@exemple.fr")!;
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await post(f, "/api/code/verifier", { email: "a@exemple.fr", code: bad });
      expect(await r.json()).toEqual({ erreur: "Code incorrect." });
    }
    const r = await post(f, "/api/code/verifier", { email: "a@exemple.fr", code: good });
    expect(r.status).toBe(400);
    expect((await f("/api/compte")).status).toBe(401);
  });

  it("refuse un code expiré ou déjà servi", async () => {
    const f = browser(s);
    await post(f, "/api/code", { email: "a@exemple.fr" });
    const code = s.codes.get("a@exemple.fr");
    await s.db.query("update codes set expire = now() - interval '1 second'");
    expect((await post(f, "/api/code/verifier", { email: "a@exemple.fr", code })).status).toBe(400);
    await login(s, f, "a@exemple.fr");
    const again = await post(browser(s), "/api/code/verifier", {
      email: "a@exemple.fr",
      code: s.codes.get("a@exemple.fr"),
    });
    expect(again.status).toBe(400);
  });

  it("limite les envois à 3 par heure et par adresse", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(browser(s), "/api/code", { email: "x@exemple.fr" })).status);
    expect(statuses).toEqual([204, 204, 204, 429]);
  });

  it("refuse une adresse mal formée", async () => {
    expect((await post(browser(s), "/api/code", { email: "pas une adresse" })).status).toBe(400);
  });
});

describe("sessions", () => {
  it("refuse une requête venue d'un autre site", async () => {
    const res = await s.app.request("/api/code", {
      method: "POST",
      headers: { ...json, origin: "https://ailleurs.example" },
      body: JSON.stringify({ email: "a@exemple.fr" }),
    });
    expect(res.status).toBe(403);
  });

  it("pose un cookie d'un an, réservé à /api", async () => {
    const f = browser(s);
    await post(f, "/api/code", { email: "a@exemple.fr" });
    const res = await post(f, "/api/code/verifier", { email: "a@exemple.fr", code: s.codes.get("a@exemple.fr") });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).toMatch(/Max-Age=31536000/);
  });

  it("prolonge une session vieille d'un jour", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    expect((await f("/api/compte")).headers.get("set-cookie")).toBeNull();
    await s.db.query("update sessions set expire = expire - interval '2 days'");
    expect((await f("/api/compte")).headers.get("set-cookie")).toMatch(/Max-Age=31536000/);
    const [r] = await s.db.query<{ ok: boolean }>("select expire > now() + interval '364 days' as ok from sessions");
    expect(r!.ok).toBe(true);
  });

  it("refuse une session expirée", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await s.db.query("update sessions set expire = now() - interval '1 second'");
    expect((await f("/api/compte")).status).toBe(401);
  });

  it("se déconnecte", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    expect((await f("/api/deconnexion", { method: "POST" })).status).toBe(204);
    expect((await f("/api/compte")).status).toBe(401);
    expect(await s.db.query("select * from sessions")).toEqual([]);
  });
});

describe("passkeys", () => {
  it("donne les options de connexion et garde le défi 5 minutes", async () => {
    const res = await post(browser(s), "/api/passkey/options", {});
    const options = (await res.json()) as { challenge: string; rpId: string; allowCredentials?: unknown[] };
    expect(options.rpId).toBe("quart-de-tour.fr");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(await s.db.query("select defi from defis where compte is null")).toEqual([{ defi: options.challenge }]);
  });

  it("donne les options d'ajout au compte connecté seulement", async () => {
    expect((await post(browser(s), "/api/passkey/ajout/options", {})).status).toBe(401);
    const f = browser(s);
    const a = await login(s, f, "a@exemple.fr");
    const options = (await (await post(f, "/api/passkey/ajout/options", {})).json()) as {
      user: { name: string };
      authenticatorSelection: { residentKey: string };
    };
    expect(options.user.name).toBe("a@exemple.fr");
    expect(options.authenticatorSelection.residentKey).toBe("required");
    expect(await s.db.query("select compte from defis where compte is not null")).toEqual([{ compte: a.id }]);
  });

  it("refuse une réponse sans défi en cours", async () => {
    const clientDataJSON = Buffer.from(JSON.stringify({ challenge: "inconnu" })).toString("base64url");
    const res = await post(browser(s), "/api/passkey/connexion", {
      reponse: { id: "x", response: { clientDataJSON } },
    });
    expect(await res.json()).toEqual({ erreur: "La demande a expiré : recommencez." });
  });

  it("signale une passkey inconnue", async () => {
    const options = (await (await post(browser(s), "/api/passkey/options", {})).json()) as { challenge: string };
    const clientDataJSON = Buffer.from(JSON.stringify({ challenge: options.challenge })).toString("base64url");
    const res = await post(browser(s), "/api/passkey/connexion", {
      reponse: { id: "x", response: { clientDataJSON } },
    });
    expect(res.status).toBe(404);
  });
});

describe("projets", () => {
  const p = (id: string, modifie: number, nom = id) => ({ ...newProject(id, nom, "complet", 1), modifie });

  it("refuse un identifiant hors format et garde le reste de l'envoi", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    const res = await post(
      f,
      "/api/projets",
      {
        changements: [
          { id: 'a"b', projet: p('a"b', 10) },
          { id: "c d", modifie: 10, supprime: true },
          { id: "bon", projet: p("bon", 10) },
        ],
      },
      "PUT",
    );
    expect(res.status).toBe(200);
    expect(await (await f("/api/projets")).json()).toEqual([{ id: "bon", modifie: 10, supprime: false }]);
  });

  it("garde la version modifiée en dernier", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await post(f, "/api/projets", { changements: [{ id: "a", projet: p("a", 10, "dix") }] }, "PUT");
    const res = await post(
      f,
      "/api/projets",
      {
        changements: [
          { id: "a", projet: p("a", 5, "cinq") },
          { id: "b", projet: p("b", 7) },
        ],
      },
      "PUT",
    );
    expect(await res.json()).toEqual(
      expect.arrayContaining([
        { id: "a", modifie: 10, supprime: false },
        { id: "b", modifie: 7, supprime: false },
      ]),
    );
    const [a] = (await (await post(f, "/api/projets/lire", { ids: ["a"] })).json()) as { nom: string }[];
    expect(a!.nom).toBe("dix");
  });

  it("garde la trace d'une suppression, qu'une version plus récente seule remplace", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await post(f, "/api/projets", { changements: [{ id: "a", projet: p("a", 10) }] }, "PUT");
    await post(f, "/api/projets", { changements: [{ id: "a", modifie: 20, supprime: true }] }, "PUT");
    await post(f, "/api/projets", { changements: [{ id: "a", projet: p("a", 15) }] }, "PUT");
    expect(await (await f("/api/projets")).json()).toEqual([{ id: "a", modifie: 20, supprime: true }]);
    expect(await (await post(f, "/api/projets/lire", { ids: ["a"] })).json()).toEqual([]);
    await post(f, "/api/projets", { changements: [{ id: "a", projet: p("a", 25) }] }, "PUT");
    expect(await (await f("/api/projets")).json()).toEqual([{ id: "a", modifie: 25, supprime: false }]);
  });

  it("nettoie les projets reçus", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    const projet = { ...p("a", 10), nom: "x".repeat(200), params: { H: "beaucoup" }, intrus: true };
    await post(f, "/api/projets", { changements: [{ id: "a", projet }] }, "PUT");
    const [a] = (await (await post(f, "/api/projets/lire", { ids: ["a"] })).json()) as Record<string, unknown>[];
    expect((a!.nom as string).length).toBe(80);
    expect(a!.intrus).toBeUndefined();
    expect(typeof (a!.params as { H: unknown }).H).toBe("number");
  });

  it("sépare les comptes", async () => {
    const f = browser(s);
    const g = browser(s);
    await login(s, f, "a@exemple.fr");
    await login(s, g, "b@exemple.fr");
    await post(f, "/api/projets", { changements: [{ id: "a", projet: p("a", 10) }] }, "PUT");
    expect(await (await g("/api/projets")).json()).toEqual([]);
    expect(await (await post(g, "/api/projets/lire", { ids: ["a"] })).json()).toEqual([]);
    await post(g, "/api/projets", { changements: [{ id: "a", projet: p("a", 5, "à b") }] }, "PUT");
    expect(await (await f("/api/projets")).json()).toEqual([{ id: "a", modifie: 10, supprime: false }]);
  });

  it("demande une session", async () => {
    expect((await browser(s)("/api/projets")).status).toBe(401);
  });
});

describe("numéro de schéma des projets", () => {
  const p = (id: string, modifie: number, nom = id) => ({ ...newProject(id, nom, "complet", 1), modifie });
  const devis = newDevis();
  /** Le projet tel que l'envoie une version de l'outil qui ne connaît pas ces clés. */
  const sans = (o: object, ...cles: string[]) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !cles.includes(k)));
  const envoi = (f: typeof fetch, changements: unknown[]) =>
    post(f, "/api/projets", { changements, detail: true }, "PUT");
  const lu = async (f: typeof fetch, id: string) =>
    ((await (await post(f, "/api/projets/lire", { ids: [id] })).json()) as Project[])[0]!;
  const connecte = async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    return f;
  };
  /** La ligne, telle que l'aurait écrite une version de l'outil plus récente que celle-ci. */
  const montee = (id: string) =>
    s.db.query("update projets set donnees = donnees || jsonb_build_object('schema', $1::int) where id = $2", [
      SCHEMA + 1,
      id,
    ]);

  it("un projet plus récent envoyé sans devis ni schéma garde le devis", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: { ...p("a", 10), devis } }]);
    const ancien = sans(p("a", 20, "retouché"), "devis", "schema");
    expect(await (await envoi(f, [{ id: "a", projet: ancien }])).json()).toMatchObject({ refus: [] });
    expect(await lu(f, "a")).toMatchObject({ nom: "retouché", modifie: 20, devis, schema: SCHEMA });
    expect(await (await f("/api/projets")).json()).toEqual([{ id: "a", modifie: 20, supprime: false }]);
  });

  it("sans schéma, un réglage absent reste celui du compte, un réglage envoyé le remplace", async () => {
    const f = await connecte();
    const avant = p("a", 10);
    await envoi(f, [{ id: "a", projet: { ...avant, params: { ...avant.params, H: 3100, tournant: "balance" } } }]);
    const ancien = p("a", 20);
    const params = sans({ ...ancien.params, H: 2800 }, "tournant");
    await envoi(f, [{ id: "a", projet: { ...sans(ancien, "schema"), params } }]);
    const a = await lu(f, "a");
    expect(a.params.H).toBe(2800);
    expect(a.params.tournant).toBe("balance");
  });

  it("sans schéma, une clé absente garde l'état, un devis retiré par une version qui le connaît part", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: { ...p("a", 10), devis, etat: "fini", finiLe: 9 } }]);
    const ancien = sans(p("a", 20), "schema", "etat", "finiLe");
    await envoi(f, [{ id: "a", projet: ancien }]);
    expect(await lu(f, "a")).toMatchObject({ etat: "fini", finiLe: 9, devis: null });
  });

  it("sans schéma, une version plus ancienne ne change toujours rien", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: { ...p("a", 10, "dix"), devis } }]);
    const ancien = sans(p("a", 5, "cinq"), "devis", "schema");
    await envoi(f, [{ id: "a", projet: ancien }]);
    expect(await lu(f, "a")).toMatchObject({ nom: "dix", modifie: 10, devis });
  });

  it("sans schéma, un escalier nouveau ou revenu d'une suppression arrive complet", async () => {
    const f = await connecte();
    const ancien = sans(p("a", 10), "devis", "schema", "params");
    await envoi(f, [{ id: "a", projet: ancien }]);
    expect(await lu(f, "a")).toMatchObject({ devis: null, params: DEFAULTS });
    await envoi(f, [{ id: "a", modifie: 20, supprime: true }]);
    await envoi(f, [{ id: "a", projet: { ...ancien, modifie: 30 } }]);
    expect(await lu(f, "a")).toMatchObject({ modifie: 30, devis: null, params: DEFAULTS });
  });

  it("sans schéma, une ligne de schéma plus haut garde son numéro et ce que l'envoi ignore", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: { ...p("a", 10), devis } }]);
    await montee("a");
    const ancien = sans(p("a", 20, "retouché"), "devis", "schema");
    await envoi(f, [{ id: "a", projet: ancien }]);
    expect(await lu(f, "a")).toMatchObject({ nom: "retouché", modifie: 20, devis, schema: SCHEMA + 1 });
  });

  it("un envoi de schéma plus bas n'écrase rien, et le refus est nommé", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: { ...p("a", 10, "récent"), devis } }]);
    await montee("a");
    const res = await envoi(f, [{ id: "a", projet: p("a", 20, "ancien") }]);
    expect(await res.json()).toEqual({
      index: [{ id: "a", modifie: 10, supprime: false }],
      refus: [{ id: "a", raison: expect.stringContaining("version plus récente") as string }],
    });
    expect(await lu(f, "a")).toMatchObject({ nom: "récent", modifie: 10, devis, schema: SCHEMA + 1 });
  });

  it("un envoi de schéma plus bas et plus vieux que la ligne n'est pas un refus", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: p("a", 10, "récent") }]);
    await montee("a");
    expect(await (await envoi(f, [{ id: "a", projet: p("a", 5) }])).json()).toMatchObject({ refus: [] });
  });

  it("un envoi plus récent de même schéma remplace, et sa date gagne", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: { ...p("a", 10), devis } }]);
    const sansDevis = sans(p("a", 20, "remplacé"), "devis");
    expect(await (await envoi(f, [{ id: "a", projet: sansDevis }])).json()).toMatchObject({ refus: [] });
    expect(await lu(f, "a")).toMatchObject({ nom: "remplacé", modifie: 20, devis: null, schema: SCHEMA });
  });

  it("une ligne d'avant le numéro se remplace", async () => {
    const f = await connecte();
    const ancien = sans({ ...p("a", 10), devis }, "schema");
    await envoi(f, [{ id: "a", projet: ancien }]);
    await envoi(f, [{ id: "a", projet: p("a", 20, "remplacé") }]);
    expect(await lu(f, "a")).toMatchObject({ nom: "remplacé", devis: null, schema: SCHEMA });
  });

  it("une suppression plus récente passe, quel que soit le schéma de la ligne", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: p("a", 10) }]);
    await montee("a");
    await envoi(f, [{ id: "a", modifie: 20, supprime: true }]);
    expect(await (await f("/api/projets")).json()).toEqual([{ id: "a", modifie: 20, supprime: true }]);
  });

  it("refuse un schéma que ce serveur ne connaît pas plutôt que d'en retirer des champs", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: { ...p("a", 10, "gardé"), devis } }]);
    const res = await envoi(f, [
      { id: "a", projet: { ...p("a", 20), schema: SCHEMA + 1 } },
      { id: "b", projet: p("b", 20) },
    ]);
    const { refus } = (await res.json()) as { refus: { id: string }[] };
    expect(refus.map((r) => r.id)).toEqual(["a"]);
    expect(await lu(f, "a")).toMatchObject({ nom: "gardé", modifie: 10, devis });
    expect(await lu(f, "b")).toMatchObject({ modifie: 20 });
  });

  it("un schéma mal formé compte comme absent", async () => {
    const f = await connecte();
    await envoi(f, [{ id: "a", projet: { ...p("a", 10), devis } }]);
    const sansDevis = sans(p("a", 20), "devis");
    await envoi(f, [{ id: "a", projet: { ...sansDevis, schema: "beaucoup" } }]);
    expect(await lu(f, "a")).toMatchObject({ modifie: 20, devis });
  });
});

describe("refus à l'envoi des projets", () => {
  const DAY = 86_400_000;
  const p = (id: string, modifie: number, nom = id) => ({ ...newProject(id, nom, "complet", 1), modifie });
  const put = async (f: typeof fetch, changements: unknown[]) => {
    const res = await post(f, "/api/projets", { changements, detail: true }, "PUT");
    const b = (await res.json()) as { index: { id: string }[]; refus: { id: string; raison: string }[] };
    return { status: res.status, ...b, ids: b.index.map((e) => e.id).sort() };
  };
  const signedIn = async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    return f;
  };

  it.each([1e300, 1e19, 1e30])("une date de %d n'arrête pas le reste de l'envoi", async (date) => {
    const f = await signedIn();
    const r = await put(f, [
      { id: "bon1", projet: p("bon1", 10) },
      { id: "mauvais", projet: p("mauvais", date) },
      { id: "bon2", projet: p("bon2", 10) },
    ]);
    expect(r.status).toBe(200);
    expect(r.ids).toEqual(["bon1", "bon2"]);
    expect(r.refus).toEqual([{ id: "mauvais", raison: expect.stringContaining("date") as string }]);
  });

  it("un caractère NUL dans l'identifiant n'arrête pas le reste de l'envoi", async () => {
    const f = await signedIn();
    const r = await put(f, [
      { id: "bon1", projet: p("bon1", 10) },
      { id: "a\u0000b", projet: p("x", 10) },
      { id: "c\u0000d", modifie: 10, supprime: true },
      { id: "bon2", projet: p("bon2", 10) },
    ]);
    expect(r.status).toBe(200);
    expect(r.ids).toEqual(["bon1", "bon2"]);
    expect(r.refus.map((x) => x.id)).toEqual(["a\u0000b", "c\u0000d"]);
  });

  it("retire le caractère NUL d'un nom ou d'une fiche client, et enregistre", async () => {
    const f = await signedIn();
    const devis = { ...newDevis(), client: { nom: "Du\u0000pont", adresse: "1 rue\nici\u0000", chantier: "" } };
    const r = await put(f, [
      { id: "a", projet: p("a", 10, "Es\u0000calier") },
      { id: "b", projet: { ...p("b", 10), devis } },
      { id: "c", projet: p("c", 10, "\u0000") },
    ]);
    expect(r.status).toBe(200);
    expect(r.refus).toEqual([]);
    const rows = (await (await post(f, "/api/projets/lire", { ids: ["a", "b", "c"] })).json()) as Project[];
    const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(byId.a!.nom).toBe("Escalier");
    expect(byId.b!.devis!.client).toMatchObject({ nom: "Dupont", adresse: "1 rue\nici" });
    expect(byId.c!.nom).toBe(NOM_PAR_DEFAUT);
  });

  it("un nom coupé à 80 caractères au milieu d'un emoji reste rangé", async () => {
    const f = await signedIn();
    const r = await put(f, [{ id: "a", projet: p("a", 10, `${"x".repeat(79)}😀`) }]);
    expect(r.refus).toEqual([]);
    const [a] = (await (await post(f, "/api/projets/lire", { ids: ["a"] })).json()) as Project[];
    expect(a!.nom).toBe("x".repeat(79));
  });

  it("une donnée illisible ailleurs ne rend pas de 500", async () => {
    const f = await signedIn();
    expect((await post(browser(s), "/api/code", { email: "a\u0000b@exemple.fr" })).status).toBe(400);
    expect(
      (await post(browser(s), "/api/code/verifier", { email: "a\u0000b@exemple.fr", code: "123456" })).status,
    ).toBe(400);
    expect((await post(f, "/api/projets/lire", { ids: ["a\u0000"] })).status).toBe(400);
    expect((await post(f, "/api/devis/numero", { projet: "a\u0000" })).status).toBe(400);
    expect((await f("/api/passkeys/a%00", { method: "DELETE" })).status).toBe(400);
  });

  it("borne les dates d'un projet et d'une trace de suppression", async () => {
    const f = await signedIn();
    const now = Date.now();
    const loin = now + 732 * DAY + DAY;
    const proche = now + 2 * DAY;
    const r = await put(f, [
      { id: "proche", projet: p("proche", proche) },
      { id: "zero", projet: p("zero", 0) },
      { id: "trace-proche", modifie: proche, supprime: true },
      { id: "trace-zero", modifie: 0, supprime: true },
      { id: "loin", projet: p("loin", loin) },
      { id: "negatif", projet: p("negatif", -1) },
      { id: "virgule", projet: p("virgule", 1000.5) },
      { id: "trace-loin", modifie: loin, supprime: true },
      { id: "trace-negatif", modifie: -1, supprime: true },
      { id: "trace-virgule", modifie: 1000.5, supprime: true },
      { id: "trace-texte", modifie: "1000", supprime: true },
    ]);
    expect(r.status).toBe(200);
    expect(r.ids).toEqual(["proche", "trace-proche", "trace-zero", "zero"]);
    expect(r.refus.map((x) => x.id)).toEqual([
      "loin",
      "negatif",
      "virgule",
      "trace-loin",
      "trace-negatif",
      "trace-virgule",
      "trace-texte",
    ]);
    for (const x of r.refus) expect(x.raison).toContain("date");
  });

  it("borne la date du profil de l'atelier", async () => {
    const f = await signedIn();
    const atelier = (modifie: number) => ({ ...newAtelier(atelierDefauts(DEFAULTS), 1), modifie });
    const now = Date.now();
    for (const date of [1e300, 1e19, now + 732 * DAY + DAY, -1, 1000.5]) {
      const res = await post(f, "/api/atelier", { atelier: atelier(date) }, "PUT");
      expect(res.status).toBe(400);
      expect(((await res.json()) as { erreur: string }).erreur).toContain("date");
    }
    expect(await (await f("/api/atelier")).json()).toBeNull();
    expect((await post(f, "/api/atelier", { atelier: atelier(0) }, "PUT")).status).toBe(200);
    expect((await post(f, "/api/atelier", { atelier: atelier(now + 2 * DAY) }, "PUT")).status).toBe(200);
  });

  it("retire les caractères NUL du profil de l'atelier", async () => {
    const f = await signedIn();
    const atelier = {
      ...newAtelier(atelierDefauts(DEFAULTS), 10),
      entreprise: { ...ENTREPRISE_VIDE, nom: "Ate\u0000lier" },
    };
    const res = await post(f, "/api/atelier", { atelier }, "PUT");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ entreprise: { nom: "Atelier" } });
  });

  describe("plafond de 2 000 projets", () => {
    /** Remplit le compte : traces de suppression d'abord, puis projets, jusqu'à `n` lignes. */
    const fill = async (n: number, traces = 0) => {
      const rows = await s.db.query<{ id: string }>("select id from comptes");
      await s.db.query(
        `insert into projets (compte, id, modifie, supprime, donnees)
         select $1::uuid, 'rempli' || i, 5, i <= $3::int, null from generate_series(1, $2::int) i`,
        [rows[0]!.id, n, traces],
      );
    };
    let g: typeof fetch;
    const count = async () => (await (await g("/api/projets")).json()) as { id: string }[];

    it("refuse les éléments en trop, les autres passent, le reste du compte fonctionne", async () => {
      g = await signedIn();
      await fill(1998);
      const r = await put(g, [
        { id: "n1", projet: p("n1", 10) },
        { id: "n2", projet: p("n2", 10) },
        { id: "n3", projet: p("n3", 10) },
        { id: "n4", modifie: 10, supprime: true },
      ]);
      expect(r.status).toBe(200);
      expect(r.refus.map((x) => x.id)).toEqual(["n3", "n4"]);
      expect(r.refus[0]!.raison).toContain("2000");
      expect(await count()).toHaveLength(2000);

      // Ce qui existe déjà se modifie et se supprime encore.
      const u = await put(g, [
        { id: "n1", projet: p("n1", 20, "modifié") },
        { id: "n2", modifie: 20, supprime: true },
        { id: "rempli1", projet: p("rempli1", 20) },
        { id: "n1", projet: p("n1", 15, "plus ancien") },
      ]);
      expect(u.refus).toEqual([]);
      const [n1] = (await (await post(g, "/api/projets/lire", { ids: ["n1"] })).json()) as Project[];
      expect(n1!.nom).toBe("modifié");
      expect((await post(g, "/api/atelier", { atelier: newAtelier(atelierDefauts(DEFAULTS), 1) }, "PUT")).status).toBe(
        200,
      );
    });

    it("compte les traces de suppression", async () => {
      g = await signedIn();
      await fill(2000, 2000);
      const r = await put(g, [{ id: "nouveau", projet: p("nouveau", 10) }]);
      expect(r.refus.map((x) => x.id)).toEqual(["nouveau"]);
      expect(await count()).toHaveLength(2000);
    });

    it("sépare les comptes", async () => {
      g = await signedIn();
      await fill(2000);
      const other = browser(s);
      await login(s, other, "b@exemple.fr");
      expect((await put(other, [{ id: "nouveau", projet: p("nouveau", 10) }])).refus).toEqual([]);
    });
  });

  it.each([
    ["PUT /projets", (f: typeof fetch) => post(f, "/api/projets", { changements: [] }, "PUT")],
    [
      "PUT /atelier",
      (f: typeof fetch) => post(f, "/api/atelier", { atelier: newAtelier(atelierDefauts(DEFAULTS), 1) }, "PUT"),
    ],
    ["POST /projets/lire", (f: typeof fetch) => post(f, "/api/projets/lire", { ids: [] })],
  ])("limite le débit de %s, par compte", async (_, call) => {
    const f = await signedIn();
    for (let i = 0; i < 120; i++) expect((await call(f)).status).toBe(200);
    const refused = await call(f);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { erreur: string }).erreur).toContain("Réessayez");
    const other = browser(s);
    await login(s, other, "b@exemple.fr");
    expect((await call(other)).status).toBe(200);
  });

  it("1 000 éléments passent, 1 001 dans une requête rendent 400", async () => {
    const f = await signedIn();
    const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, modifie: 10, supprime: true }));
    expect((await post(f, "/api/projets", { changements: list(1001) }, "PUT")).status).toBe(400);
    const r = await put(f, list(1000));
    expect(r.status).toBe(200);
    expect(r.index).toHaveLength(1000);
  });

  it("réduit un projet aux textes démesurés à ses bornes", async () => {
    const f = await signedIn();
    const devis = { ...newDevis(), client: { nom: "x".repeat(5000), adresse: "y".repeat(5000), chantier: "" } };
    await put(f, [{ id: "a", projet: { ...p("a", 10, "z".repeat(5000)), devis } }]);
    const [a] = (await (await post(f, "/api/projets/lire", { ids: ["a"] })).json()) as Project[];
    expect(a!.nom).toHaveLength(80);
    expect(a!.devis!.client.nom).toHaveLength(200);
    expect(a!.devis!.client.adresse).toHaveLength(2000);
  });

  it("un onglet ouvert d'avant les refus reçoit encore le tableau de l'index", async () => {
    const f = await signedIn();
    const res = await post(f, "/api/projets", { changements: [{ id: "a", projet: p("a", 10) }] }, "PUT");
    expect(await res.json()).toEqual([{ id: "a", modifie: 10, supprime: false }]);
  });
});

describe("atelier", () => {
  const a = (modifie: number, ess: "chene" | "noyer" = "chene") =>
    newAtelier({ ...atelierDefauts(DEFAULTS), ess }, modifie);

  it("garde le profil modifié en dernier", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    expect(await (await f("/api/atelier")).json()).toBeNull();
    expect(await (await post(f, "/api/atelier", { atelier: a(10, "noyer") }, "PUT")).json()).toEqual(a(10, "noyer"));
    expect(await (await post(f, "/api/atelier", { atelier: a(5) }, "PUT")).json()).toEqual(a(10, "noyer"));
    expect(await (await f("/api/atelier")).json()).toEqual(a(10, "noyer"));
  });

  it("nettoie le profil reçu et refuse celui qui n'a pas de date", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await post(
      f,
      "/api/atelier",
      { atelier: { defauts: { ess: "noyer", el: "épais", intrus: true }, modifie: 3 } },
      "PUT",
    );
    expect(await (await f("/api/atelier")).json()).toEqual(a(3, "noyer"));
    expect((await post(f, "/api/atelier", { atelier: { defauts: {} } }, "PUT")).status).toBe(400);
  });

  it("fusionne partie par partie : la plus récente gagne, à date égale celle du compte", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    const tarifs = { ...TARIFS_VIDES, taux: 45 };
    const entreprise = { ...ENTREPRISE_VIDE, nom: "Exemple" };
    const compte = { ...a(30, "noyer"), tarifs, entreprise, dates: { defauts: 30, tarifs: 20, entreprise: 10 } };
    await post(f, "/api/atelier", { atelier: compte }, "PUT");
    // Plus vieux dans l'ensemble, mais sa fiche est plus récente ; ses tarifs, à date égale, ne passent pas.
    const recu = {
      ...a(15),
      tarifs: { ...TARIFS_VIDES, taux: 50 },
      entreprise: { ...ENTREPRISE_VIDE, nom: "Autre" },
      dates: { defauts: 5, tarifs: 20, entreprise: 15 },
    };
    const attendu = { ...compte, entreprise: recu.entreprise, dates: { defauts: 30, tarifs: 20, entreprise: 15 } };
    expect(await (await post(f, "/api/atelier", { atelier: recu }, "PUT")).json()).toEqual(attendu);
    expect(await (await f("/api/atelier")).json()).toEqual(attendu);
  });

  it("deux envois en même temps : chacun garde sa partie", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await post(f, "/api/atelier", { atelier: a(1) }, "PUT");
    const tarifs = {
      ...a(10),
      tarifs: { ...TARIFS_VIDES, taux: 45 },
      dates: { defauts: 1, tarifs: 10, entreprise: 0 },
    };
    const fiche = {
      ...a(20),
      entreprise: { ...ENTREPRISE_VIDE, nom: "Exemple" },
      dates: { defauts: 1, tarifs: 0, entreprise: 20 },
    };
    await Promise.all([tarifs, fiche].map((atelier) => post(f, "/api/atelier", { atelier }, "PUT")));
    expect(await (await f("/api/atelier")).json()).toMatchObject({
      tarifs: { taux: 45 },
      entreprise: { nom: "Exemple" },
      dates: { defauts: 1, tarifs: 10, entreprise: 20 },
      modifie: 20,
    });
  });

  it("une date de partie ne dépasse pas celle du profil", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    const res = await post(
      f,
      "/api/atelier",
      { atelier: { ...a(10), dates: { defauts: 1e15, tarifs: "hier", entreprise: -5 } } },
      "PUT",
    );
    expect(await res.json()).toMatchObject({ modifie: 10, dates: { defauts: 10, tarifs: 0, entreprise: 0 } });
  });

  it("garde les tarifs et la fiche de l'entreprise", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    const avec = {
      ...a(10),
      tarifs: { ...TARIFS_VIDES, taux: 45 },
      entreprise: { ...ENTREPRISE_VIDE, nom: "Menuiserie Exemple" },
    };
    await post(f, "/api/atelier", { atelier: avec }, "PUT");
    expect(await (await f("/api/atelier")).json()).toEqual(avec);
    const d = (await (await f("/api/compte/donnees")).json()) as { atelier: typeof avec };
    expect(d.atelier.tarifs.taux).toBe(45);
  });

  it("ne perd pas les tarifs quand une version d'avant les devis envoie son profil", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    const tarifs = { ...TARIFS_VIDES, taux: 45 };
    await post(f, "/api/atelier", { atelier: { ...a(10), tarifs } }, "PUT");
    const ancien = { defauts: { ...atelierDefauts(DEFAULTS), ess: "noyer" }, modifie: 20 };
    await post(f, "/api/atelier", { atelier: ancien }, "PUT");
    expect(await (await f("/api/atelier")).json()).toEqual({ ...a(20, "noyer"), tarifs });
  });

  it("garde les tarifs et la fiche de l'entreprise", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    const avec = {
      ...a(10),
      tarifs: { ...TARIFS_VIDES, taux: 45 },
      entreprise: { ...ENTREPRISE_VIDE, nom: "Menuiserie Exemple" },
    };
    await post(f, "/api/atelier", { atelier: avec }, "PUT");
    expect(await (await f("/api/atelier")).json()).toEqual(avec);
    const d = (await (await f("/api/compte/donnees")).json()) as { atelier: typeof avec };
    expect(d.atelier.tarifs.taux).toBe(45);
  });

  it("ne perd pas les tarifs quand une version d'avant les devis envoie son profil", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    const tarifs = { ...TARIFS_VIDES, taux: 45 };
    await post(f, "/api/atelier", { atelier: { ...a(10), tarifs } }, "PUT");
    const ancien = { defauts: { ...atelierDefauts(DEFAULTS), ess: "noyer" }, modifie: 20 };
    await post(f, "/api/atelier", { atelier: ancien }, "PUT");
    expect(await (await f("/api/atelier")).json()).toEqual({ ...a(20, "noyer"), tarifs });
  });

  it("sépare les comptes", async () => {
    const f = browser(s);
    const g = browser(s);
    await login(s, f, "a@exemple.fr");
    await login(s, g, "b@exemple.fr");
    await post(f, "/api/atelier", { atelier: a(10, "noyer") }, "PUT");
    expect(await (await g("/api/atelier")).json()).toBeNull();
  });

  it("demande une session", async () => {
    expect((await browser(s)("/api/atelier")).status).toBe(401);
  });
});

describe("poids d'un escalier", () => {
  const r = compute(DEFAULTS, false);
  if (!r.ok) throw new Error("exemple");
  const Q = quantites(r.stair, buildCNC(r.stair));
  const T = "é".repeat(200);
  const saisiePleine = {
    ...SAISIE_DEFAUT,
    libres: Array.from({ length: 100 }, () => ({ designation: T, q: 1, unite: "forfait", pu: 350, tva: 20 })),
  };
  const clientPlein = { nom: T, adresse: "é".repeat(2000), chantier: "é".repeat(2000) };
  const D = devis(Q, TARIFS_VIDES, saisiePleine);
  const version = {
    numero: "2026-0001",
    nom: "a",
    params: DEFAULTS,
    tarifs: TARIFS_VIDES,
    entreprise: ENTREPRISE_VIDE,
  };
  const manqueDeLaPlace = (d: DevisProjet) =>
    bloquants(D, d, TARIFS_VIDES, ENTREPRISE_VIDE).some((m) => m.startsWith("de la place"));
  const envoi = async (f: typeof fetch, changement: unknown) => {
    const res = await post(f, "/api/projets", { changements: [changement], detail: true }, "PUT");
    return ((await res.json()) as { refus: { raison: string }[] }).refus;
  };
  const projet = (modifie: number, d: DevisProjet | null = null) => ({
    ...newProject("a", "a", "complet", 1),
    modifie,
    devis: d,
  });
  const lu = async (f: typeof fetch) =>
    ((await (await post(f, "/api/projets/lire", { ids: ["a"] })).json()) as Project[])[0];

  it("refuse trop lourd : la raison est dite, et le compte garde la version d'avant", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    expect(await envoi(f, { id: "a", projet: projet(1) })).toEqual([]);
    const plein = { ...newDevis(), client: clientPlein, saisie: saisiePleine };
    const remis = remettre(plein, { ...version, chiffrage: D }, 1).remis[0]!;
    const lourd = { ...plein, remis: Array<typeof remis>(12).fill(remis) };
    const [refus] = await envoi(f, { id: "a", projet: projet(2, lourd) });
    expect(refus!.raison).toContain("trop lourd");
    expect(refus!.raison).toContain("Aucune n'est perdue");
    expect((await lu(f))!.modifie).toBe(1);
    // Une suppression et une version plus légère passent encore.
    expect(await envoi(f, { id: "a", modifie: 3, supprime: true })).toEqual([]);
    expect(await envoi(f, { id: "a", projet: projet(4) })).toEqual([]);
    expect((await lu(f))!.modifie).toBe(4);
  });

  it("arrête la remise avant la borne : tout ce qui est remis rejoint le compte, même repris ensuite", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    let d = newDevis();
    let n = 0;
    while (!manqueDeLaPlace(d)) {
      d = remettre(d, { ...version, chiffrage: D }, ++n);
      expect(n).toBeLessThan(50);
    }
    expect(n).toBeGreaterThan(1);
    const repris = { ...d, rouvert: true, client: clientPlein, saisie: saisiePleine };
    expect(Buffer.byteLength(JSON.stringify(projet(1, repris)))).toBeLessThanOrEqual(MAX_OCTETS);
    expect(await envoi(f, { id: "a", projet: projet(1, repris) })).toEqual([]);
    expect((await lu(f))!.devis!.remis).toHaveLength(n);
  });

  describe("versions remises de deux copies", () => {
    const leger = devis(Q, TARIFS_VIDES, SAISIE_DEFAUT);
    const remise = (le: number, d = newDevis()) => remettre(d, { ...version, chiffrage: leger }, le);
    const dates = async (f: typeof fetch) => (await lu(f))!.devis!.remis.map((r) => r.remisLe);
    const connecte = async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      return f;
    };

    it("une version plus récente garde ce que seule la ligne a remis, et se date après", async () => {
      const f = await connecte();
      expect(await envoi(f, { id: "a", projet: projet(10, remise(100)) })).toEqual([]);
      expect(await envoi(f, { id: "a", projet: { ...projet(20, remise(200)), nom: "b" } })).toEqual([]);
      expect(await dates(f)).toEqual([100, 200]);
      expect(await lu(f)).toMatchObject({ modifie: 21, nom: "b" });
    });

    it("une version plus ancienne, ou de même date, rejoint la ligne sans la remplacer", async () => {
      const f = await connecte();
      expect(await envoi(f, { id: "a", projet: { ...projet(20, remise(200)), nom: "ligne" } })).toEqual([]);
      expect(await envoi(f, { id: "a", projet: { ...projet(10, remise(100)), nom: "vieille" } })).toEqual([]);
      expect(await dates(f)).toEqual([100, 200]);
      expect(await lu(f)).toMatchObject({ modifie: 21, nom: "ligne" });
      expect(await envoi(f, { id: "a", projet: projet(21, remise(300)) })).toEqual([]);
      expect(await dates(f)).toEqual([100, 200, 300]);
      expect(await lu(f)).toMatchObject({ modifie: 22, nom: "ligne" });
    });

    it("renvoyer une version déjà connue ne change rien", async () => {
      const f = await connecte();
      const d = remise(100);
      expect(await envoi(f, { id: "a", projet: projet(10, d) })).toEqual([]);
      expect(await envoi(f, { id: "a", projet: projet(10, d) })).toEqual([]);
      expect(await envoi(f, { id: "a", projet: projet(9, d) })).toEqual([]);
      expect(await lu(f)).toMatchObject({ modifie: 10 });
      expect(await dates(f)).toEqual([100]);
    });

    it("une ancienne version de l'outil, sans numéro, n'efface pas les remises en envoyant un devis vide", async () => {
      const f = await connecte();
      expect(await envoi(f, { id: "a", projet: projet(10, remise(100)) })).toEqual([]);
      const sansNumero = { ...projet(20, null), schema: undefined };
      expect(await envoi(f, { id: "a", projet: sansNumero })).toEqual([]);
      expect(await dates(f)).toEqual([100]);
      expect((await lu(f))!.modifie).toBe(21);
    });

    it("une ligne écrite par une version plus récente que ce serveur n'est pas relue : refus dit, rien d'écrit", async () => {
      const f = await connecte();
      await s.db.query(
        `insert into projets (compte, id, modifie, supprime, donnees)
         select id, 'a', 10, false, $1::jsonb from comptes`,
        [JSON.stringify({ ...projet(10), schema: SCHEMA + 1 })],
      );
      const [refus] = await envoi(f, { id: "a", projet: projet(20, remise(100)) });
      expect(refus!.raison).toContain("version plus récente");
      expect((await lu(f))!.devis).toBeNull();
    });

    it("réunies trop lourdes : refus nommé des deux côtés, rien d'écrit", async () => {
      const f = await connecte();
      const plein = { ...newDevis(), client: clientPlein, saisie: saisiePleine };
      const unePleine = (le: number) => remettre(plein, { ...version, chiffrage: D }, le).remis[0]!;
      const avec = (debut: number) => ({
        ...plein,
        remis: Array.from({ length: 6 }, (_, i) => unePleine(debut + i)),
      });
      expect(await envoi(f, { id: "a", projet: projet(10, avec(100)) })).toEqual([]);
      const [plusRecente] = await envoi(f, { id: "a", projet: projet(20, avec(200)) });
      expect(plusRecente!.raison).toContain("trop lourd");
      const [plusAncienne] = await envoi(f, { id: "a", projet: projet(5, avec(300)) });
      expect(plusAncienne!.raison).toContain("trop lourd");
      expect((await lu(f))!.modifie).toBe(10);
      expect(await dates(f)).toEqual([100, 101, 102, 103, 104, 105]);
    });
  });

  it("arrête la remise à la dernière version gardée, plutôt que d'effacer la première", () => {
    const pleine = remettre(newDevis(), { ...version, chiffrage: devis(Q, TARIFS_VIDES, SAISIE_DEFAUT) }, 1).remis[0]!;
    expect(manqueDeLaPlace({ ...newDevis(), remis: Array<typeof pleine>(49).fill(pleine) })).toBe(false);
    expect(manqueDeLaPlace({ ...newDevis(), remis: Array<typeof pleine>(50).fill(pleine) })).toBe(true);
  });
});

describe("numéros de devis", () => {
  const numero = async (f: typeof fetch, projet: unknown) => {
    const r = await post(f, "/api/devis/numero", { projet });
    return r.ok ? ((await r.json()) as { numero: string }).numero : r.status;
  };
  const escaliers = (f: typeof fetch, ...ids: string[]) =>
    post(
      f,
      "/api/projets",
      { changements: ids.map((id) => ({ id, projet: newProject(id, id, "complet", 1) })) },
      "PUT",
    );
  const annee = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric" }).format(new Date());

  it("suivent l'année, sans trou, et redonnent le même numéro au même escalier", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await escaliers(f, "a", "b", "c");
    expect(await numero(f, "a")).toBe(`${annee}-0001`);
    expect(await numero(f, "b")).toBe(`${annee}-0002`);
    expect(await numero(f, "a")).toBe(`${annee}-0001`);
    expect(await numero(f, "c")).toBe(`${annee}-0003`);
  });

  it("ont une suite par compte et par année", async () => {
    const f = browser(s),
      g = browser(s);
    const a = await login(s, f, "a@exemple.fr");
    await login(s, g, "b@exemple.fr");
    await s.db.query("insert into devis_numeros (compte, projet, annee, rang) values ($1, 'vieux', 2001, 57)", [a.id]);
    await escaliers(f, "a");
    await escaliers(g, "a", "b");
    expect(await numero(f, "a")).toBe(`${annee}-0001`);
    expect(await numero(g, "a")).toBe(`${annee}-0001`);
    expect(await numero(g, "b")).toBe(`${annee}-0002`);
    expect(await numero(f, "vieux")).toBe("2001-0057");
  });

  it("tiennent quand deux demandes arrivent ensemble", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await escaliers(f, "a", "b", "c", "d");
    const got = await Promise.all(["a", "b", "c", "d", "a"].map((p) => numero(f, p)));
    expect(new Set(got.slice(0, 4)).size).toBe(4);
    expect(got[4]).toBe(got[0]);
    expect([...got].sort()).toEqual([1, 1, 2, 3, 4].map((n) => `${annee}-${String(n).padStart(4, "0")}`));
  });

  it("demandent une session et un escalier", async () => {
    expect(await numero(browser(s), "a")).toBe(401);
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    expect(await numero(f, "")).toBe(400);
    expect(await numero(f, 12)).toBe(400);
  });

  it("refusent un identifiant hors format, sans rien écrire", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    expect(await numero(f, '"><img src=x>')).toBe(400);
    expect(await numero(f, "x".repeat(101))).toBe(400);
    expect(await s.db.query("select * from devis_numeros")).toEqual([]);
  });

  it("attendent que l'escalier soit dans le compte, sans perdre de rang", async () => {
    const f = browser(s),
      g = browser(s);
    await login(s, f, "a@exemple.fr");
    await login(s, g, "b@exemple.fr");
    await escaliers(g, "fait-hors-ligne");
    const r = await post(f, "/api/devis/numero", { projet: "fait-hors-ligne" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { erreur: string }).erreur).toContain("Réessayez");
    expect(await s.db.query("select * from devis_numeros")).toEqual([]);
    await escaliers(f, "fait-hors-ligne");
    expect(await numero(f, "fait-hors-ligne")).toBe(`${annee}-0001`);
  });

  it("ne s'attribuent pas à un escalier supprimé, mais lui restent s'il en avait un", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await escaliers(f, "a", "b");
    expect(await numero(f, "a")).toBe(`${annee}-0001`);
    const traces = ["a", "b"].map((id) => ({ id, modifie: Date.now(), supprime: true }));
    await post(f, "/api/projets", { changements: traces }, "PUT");
    expect(await numero(f, "a")).toBe(`${annee}-0001`);
    expect(await numero(f, "b")).toBe(409);
  });

  it("limitent le débit par compte", async () => {
    const f = browser(s),
      g = browser(s);
    await login(s, f, "a@exemple.fr");
    await login(s, g, "b@exemple.fr");
    await escaliers(f, "a");
    await escaliers(g, "a");
    for (let i = 0; i < 120; i++) expect(typeof (await numero(f, "a"))).toBe("string");
    expect(await numero(f, "a")).toBe(429);
    expect(await numero(g, "a")).toBe(`${annee}-0001`);
  });

  it("partent avec le compte", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await escaliers(f, "a");
    expect(await numero(f, "a")).toBe(`${annee}-0001`);
    await f("/api/compte", { method: "DELETE" });
    expect(await s.db.query("select * from devis_numeros")).toEqual([]);
  });

  it("arrivent par migration dans une base d'avant les devis, sans rien perdre", async () => {
    const db = await pgliteDb();
    await migrate(db);
    // La base telle qu'elle était avant cette migration.
    await db.exec(
      `drop table devis_numeros; alter table ateliers drop column dates;
       drop table purge_passage; alter table comptes drop column essai;
       alter table comptes drop column vu, drop column averti; delete from schema_version where v >= 4;`,
    );
    await db.query("insert into comptes (id, email) values ('00000000-0000-0000-0000-000000000001', 'a@exemple.fr')");
    await migrate(db);
    expect(await db.query("select max(v) as v from schema_version")).toEqual([{ v: 7 }]);
    expect(await db.query("select email from comptes")).toEqual([{ email: "a@exemple.fr" }]);
    await db.query(
      "insert into devis_numeros (compte, projet, annee, rang) values ('00000000-0000-0000-0000-000000000001', 'a', 2026, 1)",
    );
    await migrate(db);
    expect(await db.query("select count(*)::int as n from devis_numeros")).toEqual([{ n: 1 }]);
    await db.close();
  });
});

/** Une ligne de la base ou de l'export, relue comme du JSON : les dates y sont du texte. */
type Ligne = Record<string, unknown>;
const relue = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Donnees {
  compte: Ligne;
  passkeys: Ligne[];
  sessions: Ligne[];
  atelier: Ligne;
  projets: Ligne[];
  suppressions: Ligne[];
  numerosDevis: Ligne[];
}

/** Où l'export rend une ligne de la base, sous le nom de ses colonnes. */
const RENDU: Record<string, (d: Donnees, l: Ligne) => Ligne | undefined> = {
  comptes: (d) => d.compte,
  passkeys: (d, l) => d.passkeys.find((p) => p.id === l.id),
  sessions: (d, l) => d.sessions.find((x) => x.cree === l.cree),
  ateliers: (d) => ({ ...d.atelier, donnees: d.atelier.defauts }),
  projets: (d, l) => {
    if (l.supprime) return { ...d.suppressions.find((x) => x.id === l.id), supprime: true, donnees: null };
    const p = d.projets.find((x) => x.id === l.id);
    return p && { id: p.id, modifie: p.modifie, supprime: false, donnees: p };
  },
  devis_numeros: (d, l) => d.numerosDevis.find((n) => n.projet === l.projet),
};

const DEJA_RENDU = "L'identifiant du compte, déjà rendu dans `compte`.";
/** Ce que l'export ne rend pas, table entière ou colonne, et pourquoi. Une colonne ajoutée à la base doit être rendue
    par la route ou écrite ici : l'export est la copie à laquelle la personne a droit (RGPD, art. 15). */
const HORS_EXPORT: Record<string, string> = {
  "passkeys.compte": DEJA_RENDU,
  "sessions.compte": DEJA_RENDU,
  "ateliers.compte": DEJA_RENDU,
  "projets.compte": DEJA_RENDU,
  "devis_numeros.compte": DEJA_RENDU,
  "sessions.hash": "Empreinte du jeton de session : un secret, qui ne dit rien de la personne et ne sort jamais.",
  codes: "Code de connexion haché : valable 10 minutes, effacé à l'usage ou à la purge, rien de durable à copier.",
  defis: "Défi de passkey : valable 5 minutes, effacé à l'usage ou à la purge, rien de durable à copier.",
  purge_passage: "L'heure du dernier passage de la purge : rien sur une personne.",
  schema_version: "Le numéro de la dernière migration : rien sur une personne.",
};
const raisonHors = (table: string, colonne: string) => HORS_EXPORT[table] ?? HORS_EXPORT[`${table}.${colonne}`];

describe("compte", () => {
  it("donne ses données", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await post(f, "/api/projets", { changements: [{ id: "a", projet: newProject("a", "Dupont", "guide", 3) }] }, "PUT");
    const res = await f("/api/compte/donnees");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    const d = (await res.json()) as { compte: { email: string }; projets: { nom: string }[] };
    expect(d.compte.email).toBe("a@exemple.fr");
    expect(d.projets.map((p) => p.nom)).toEqual(["Dupont"]);
  });

  describe("export complet", () => {
    /** Un compte dont toutes les tables et toutes les colonnes sont remplies, à côté d'un autre compte. */
    async function compteRempli() {
      const f = browser(s);
      const { id } = await login(s, f, "a@exemple.fr");
      await s.db.query(
        `update comptes set droits_jusqu_a = now() + interval '1 year', averti = now() - interval '2 days',
           essai = now() - interval '3 days' where id = $1`,
        [id],
      );
      await s.db.query(
        `insert into passkeys (id, compte, cle, compteur, transports, nom, utilise)
         values ('cle-a', $1, 'publique', 7, 'internal,hybrid', 'Mon téléphone', now())`,
        [id],
      );
      const devis = { ...newDevis(), client: { nom: "Mme Martin", adresse: "1 rue Ici", chantier: "" } };
      const changements = [
        { id: "a", projet: { ...newProject("a", "Dupont", "complet", 3), devis } },
        { id: "b", projet: newProject("b", "Parti", "complet", 3) },
      ];
      await post(f, "/api/projets", { changements }, "PUT");
      // Le numéro d'un devis remis reste une fois l'escalier supprimé.
      await post(f, "/api/devis/numero", { projet: "b" });
      await post(f, "/api/projets", { changements: [{ id: "b", modifie: 20, supprime: true }] }, "PUT");
      const atelier = {
        ...newAtelier(atelierDefauts(DEFAULTS), 10),
        tarifs: { ...TARIFS_VIDES, taux: 45 },
        entreprise: { ...ENTREPRISE_VIDE, nom: "Menuiserie Exemple" },
      };
      await post(f, "/api/atelier", { atelier }, "PUT");
      // Un code de connexion en cours pour cette adresse, et un autre compte.
      await post(browser(s), "/api/code", { email: "a@exemple.fr" });
      const g = browser(s);
      await login(s, g, "b@exemple.fr");
      await post(
        g,
        "/api/projets",
        { changements: [{ id: "c", projet: newProject("c", "Voisin", "guide", 3) }] },
        "PUT",
      );
      await post(g, "/api/projets", { changements: [{ id: "d", modifie: 30, supprime: true }] }, "PUT");
      const res = await f("/api/compte/donnees");
      expect(res.status).toBe(200);
      const texte = await res.text();
      return { id, texte, d: JSON.parse(texte) as Donnees };
    }

    it("rend chaque colonne, ou écrit pourquoi elle reste dehors", async () => {
      const { id, d } = await compteRempli();
      const colonnes = await s.db.query<{ table_name: string; column_name: string }>(
        "select table_name, column_name from information_schema.columns where table_schema = 'public'",
      );
      const oublis = colonnes
        .filter((c) => !raisonHors(c.table_name, c.column_name) && !RENDU[c.table_name])
        .map((c) => `${c.table_name}.${c.column_name}`);
      expect(oublis).toEqual([]);
      // Une raison pour une colonne qui n'existe plus ne couvre plus rien.
      const connues = new Set(colonnes.flatMap((c) => [c.table_name, `${c.table_name}.${c.column_name}`]));
      expect(Object.keys(HORS_EXPORT).filter((k) => !connues.has(k))).toEqual([]);

      for (const table of Object.keys(RENDU)) {
        const lignes = relue(
          await s.db.query<Ligne>(`select * from ${table} where ${table === "comptes" ? "id" : "compte"} = $1`, [id]),
        );
        expect(lignes.length, table).toBeGreaterThan(0);
        const visees = colonnes.filter((c) => c.table_name === table && !raisonHors(table, c.column_name));
        for (const ligne of lignes) {
          const rendu = RENDU[table]!(d, ligne) as Ligne;
          for (const { column_name: c } of visees) {
            // Une colonne vide ne prouverait rien, sauf le contenu d'une trace de suppression.
            if (!(table === "projets" && c === "donnees" && ligne.supprime))
              expect(ligne[c], `${table}.${c} à remplir dans le test`).not.toBeNull();
            expect(rendu?.[c], `${table}.${c}`).toEqual(ligne[c]);
          }
        }
      }
    });

    it("rend les clés attendues et ne laisse aucune empreinte", async () => {
      const { texte, d } = await compteRempli();
      expect(Object.keys(d.compte).sort()).toEqual(
        ["averti", "cree", "droits_jusqu_a", "email", "essai", "id", "statut", "vu"].sort(),
      );
      expect(d.passkeys).toEqual([
        expect.objectContaining({ id: "cle-a", transports: "internal,hybrid", utilise: expect.any(String) }),
      ]);
      expect(d.sessions).toEqual([{ cree: expect.any(String), expire: expect.any(String) }]);
      expect(d.suppressions).toEqual([{ id: "b", modifie: 20 }]);
      expect(d.numerosDevis).toEqual([expect.objectContaining({ projet: "b", rang: 1 })]);
      const empreintes = [
        ...(await s.db.query<{ hash: string }>("select hash from sessions")),
        ...(await s.db.query<{ hash: string }>("select hash from codes")),
      ];
      expect(empreintes.length).toBeGreaterThan(2);
      for (const { hash } of empreintes) expect(texte).not.toContain(hash);
      expect(texte).not.toContain('"hash"');
    });

    it("garde l'e-mail, l'atelier, les tarifs, la fiche, les projets et les clients", async () => {
      const { d } = await compteRempli();
      expect(d.compte.email).toBe("a@exemple.fr");
      expect(d.atelier).toMatchObject({
        defauts: atelierDefauts(DEFAULTS),
        tarifs: { taux: 45 },
        entreprise: { nom: "Menuiserie Exemple" },
      });
      expect(d.projets).toEqual([
        expect.objectContaining({
          nom: "Dupont",
          devis: expect.objectContaining({ client: expect.objectContaining({ nom: "Mme Martin" }) }),
        }),
      ]);
    });

    it("ne rend rien d'un autre compte", async () => {
      const { texte } = await compteRempli();
      for (const autre of ["b@exemple.fr", "Voisin", '"d"']) expect(texte).not.toContain(autre);
    });
  });

  it("s'efface entièrement", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await post(f, "/api/projets", { changements: [{ id: "a", projet: newProject("a", "A", "guide", 3) }] }, "PUT");
    expect((await f("/api/compte", { method: "DELETE" })).status).toBe(204);
    for (const t of ["comptes", "sessions", "projets", "passkeys"])
      expect(await s.db.query(`select * from ${t}`)).toEqual([]);
    expect((await f("/api/compte")).status).toBe(401);
  });

  it("ne garde pas les réponses en cache", async () => {
    expect((await browser(s)("/api/sante")).headers.get("cache-control")).toBe("no-store");
    expect(ORIGIN).toMatch(/^https:/);
  });
});

describe("comptes sans connexion", () => {
  /** Avertissements envoyés par les passages de la purge. */
  let avertis: { email: string; limite: Date }[];
  const passe = () => purgeComptes(s.db, async (email, limite) => void avertis.push({ email, limite }));
  /** Dernier passage de la purge il y a `depuis` : plus de 2 h 30, le service était coupé depuis. */
  const passage = (depuis: string) =>
    s.db.query(
      `insert into purge_passage (dernier) values (now() - $1::interval)
       on conflict (seul) do update set dernier = excluded.dernier`,
      [depuis],
    );
  beforeEach(async () => {
    avertis = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    await passage("1 hour");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Vu il y a `depuis` ; averti il y a `averti`, ou jamais. */
  const date = (email: string, depuis: string, averti: string | null = null) =>
    s.db.query(
      `update comptes set vu = now() - $2::interval, cree = now() - $2::interval,
         averti = now() - $3::interval where email = $1`,
      [email, depuis, averti],
    );
  const comptes = async () =>
    (await s.db.query<{ email: string }>("select email from comptes order by email")).map((c) => c.email);
  const etat = async (email: string) =>
    (
      await s.db.query<{ recent: boolean; averti: Date | null }>(
        "select vu > now() - interval '1 minute' as recent, averti from comptes where email = $1",
        [email],
      )
    )[0]!;

  it("efface après avertissement, avec tout ce qui tient au compte", async () => {
    const f = browser(s);
    const a = await login(s, f, "a@exemple.fr");
    await s.db.query("delete from defis");
    await post(f, "/api/projets", { changements: [{ id: "p", projet: newProject("p", "Dupont", "guide", 3) }] }, "PUT");
    await post(f, "/api/atelier", { atelier: newAtelier(atelierDefauts(DEFAULTS), 1) }, "PUT");
    await post(f, "/api/devis/numero", { projet: "p" });
    await s.db.query("insert into passkeys (id, compte, cle, compteur, nom) values ('k', $1, 'c', 0, 'Appareil')", [
      a.id,
    ]);
    await s.db.query("insert into defis (defi, compte, expire) values ('d', $1, now() + interval '1 day')", [a.id]);
    const tables = ["passkeys", "sessions", "defis", "projets", "ateliers", "devis_numeros"];
    for (const t of tables) expect(await s.db.query(`select 1 from ${t}`), t).toHaveLength(1);

    await date("a@exemple.fr", "25 months");
    await passe();
    // Averti seulement : le préavis court, même au-delà de la durée.
    expect(avertis.map((v) => v.email)).toEqual(["a@exemple.fr"]);
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    await passe();
    expect(avertis).toHaveLength(1);

    await s.db.query("update comptes set averti = now() - interval '32 days'");
    await passe();
    expect(await comptes()).toEqual([]);
    for (const t of tables) expect(await s.db.query(`select 1 from ${t}`), t).toEqual([]);
    expect(avertis).toHaveLength(1);
  });

  it("épargne un compte récent, sans lui écrire", async () => {
    await login(s, browser(s), "neuf@exemple.fr");
    await login(s, browser(s), "ancien@exemple.fr");
    await date("ancien@exemple.fr", "22 months");
    await passe();
    expect(avertis).toEqual([]);
    expect(await comptes()).toEqual(["ancien@exemple.fr", "neuf@exemple.fr"]);
  });

  it("n'efface rien sans avertissement parti, et réessaie", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "30 months");
    await purgeComptes(s.db, () => Promise.reject(new Error("Brevo 500")));
    expect((await etat("a@exemple.fr")).averti).toBeNull();
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    await passe();
    expect(avertis).toHaveLength(1);
    expect((await etat("a@exemple.fr")).averti).not.toBeNull();
  });

  it("une panne d'envoi sur une adresse n'arrête pas les suivantes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await login(s, browser(s), "a@exemple.fr");
    await login(s, browser(s), "b@exemple.fr");
    await date("a@exemple.fr", "30 months");
    await date("b@exemple.fr", "29 months");
    await purgeComptes(s.db, async (email, limite) => {
      if (email === "a@exemple.fr") throw new Error("Brevo 500");
      avertis.push({ email, limite });
    });
    expect(avertis.map((v) => v.email)).toEqual(["b@exemple.fr"]);
    expect((await etat("a@exemple.fr")).averti).toBeNull();
  });

  it("ne passe ni avant la durée ni avant le préavis", async () => {
    for (const email of ["duree@exemple.fr", "preavis@exemple.fr"]) await login(s, browser(s), email);
    await date("duree@exemple.fr", "23 months 25 days", "40 days");
    await date("preavis@exemple.fr", "30 months", "29 days");
    await passe();
    expect(await comptes()).toEqual(["duree@exemple.fr", "preavis@exemple.fr"]);
  });

  it("ne tient pas compte d'un avertissement d'avant la dernière activité", async () => {
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months", "26 months");
    await passe();
    expect(await comptes()).toEqual(["a@exemple.fr"]);
  });

  it("avertit à 24 mois moins 30 jours, et laisse le préavis entier à partir de l'envoi", async () => {
    for (const email of ["avant@exemple.fr", "dans@exemple.fr", "tard@exemple.fr"]) await login(s, browser(s), email);
    await date("avant@exemple.fr", "22 months 25 days");
    await date("dans@exemple.fr", "23 months 15 days");
    await date("tard@exemple.fr", "30 months");
    await passe();
    expect(avertis.map((v) => v.email)).toEqual(["tard@exemple.fr", "dans@exemple.fr"]);
    for (const { limite } of avertis) expect((limite.getTime() - Date.now()) / 86_400_000).toBeCloseTo(30, 0);

    // Passé les 24 mois, averti depuis moins de 30 jours : la date annoncée n'est pas encore là.
    await date("tard@exemple.fr", "30 months", "29 days");
    await passe();
    expect(await comptes()).toContain("tard@exemple.fr");
    await date("tard@exemple.fr", "30 months", "30 days 1 minute");
    await passe();
    expect(await comptes()).toContain("tard@exemple.fr");
    await date("tard@exemple.fr", "30 months", "31 days 1 minute");
    await passe();
    expect(await comptes()).not.toContain("tard@exemple.fr");
    expect(await comptes()).toContain("dans@exemple.fr");
  });

  it("ne dépasse pas le nombre d'avertissements par passage, les plus anciens d'abord", async () => {
    for (let i = 0; i < 12; i++) {
      await login(s, browser(s), `c${i}@exemple.fr`);
      await date(`c${i}@exemple.fr`, `${30 + i} months`);
    }
    await passe();
    expect(avertis).toHaveLength(10);
    expect(avertis[0]!.email).toBe("c11@exemple.fr");
    await passe();
    expect(avertis).toHaveLength(12);
  });

  it("une connexion avance `vu` et annule l'avertissement", async () => {
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months", "31 days");
    await login(s, browser(s), "a@exemple.fr");
    expect(await etat("a@exemple.fr")).toEqual({ recent: true, averti: null });
    await passe();
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    expect(avertis).toEqual([]);
  });

  it("une session en cours avance `vu` sans nouvelle connexion, une fois par jour au plus", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await date("a@exemple.fr", "25 months", "31 days");
    expect((await f("/api/projets")).status).toBe(200);
    expect(await etat("a@exemple.fr")).toEqual({ recent: true, averti: null });
    await passe();
    expect(await comptes()).toEqual(["a@exemple.fr"]);

    await date("a@exemple.fr", "23 hours");
    await f("/api/compte");
    expect((await etat("a@exemple.fr")).recent).toBe(false);
    await date("a@exemple.fr", "25 hours");
    await f("/api/compte");
    expect((await etat("a@exemple.fr")).recent).toBe(true);
  });

  it("demander un code ne suffit pas à garder un compte", async () => {
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months");
    await post(browser(s), "/api/code", { email: "a@exemple.fr" });
    expect((await etat("a@exemple.fr")).recent).toBe(false);
  });

  it("revenu pendant l'envoi : l'avertissement n'est pas retenu", async () => {
    const f = browser(s);
    await login(s, f, "a@exemple.fr");
    await date("a@exemple.fr", "25 months");
    await purgeComptes(s.db, async () => {
      await f("/api/compte");
    });
    expect(await etat("a@exemple.fr")).toEqual({ recent: true, averti: null });
  });

  it("épargne un compte dont les droits courent encore", async () => {
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "30 months", "60 days");
    await s.db.query("update comptes set droits_jusqu_a = now() + interval '1 month'");
    await passe();
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    await s.db.query("update comptes set averti = null");
    await passe();
    expect(avertis).toEqual([]);
  });

  it("un préavis fini pendant une coupure repart entier au retour du service", async () => {
    // Averti il y a 35 jours pour il y a 5 jours ; le service était coupé depuis 6 jours.
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months", "35 days");
    await passage("6 days");
    await passe();
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    expect(avertis.map((v) => v.email)).toEqual(["a@exemple.fr"]);
    expect((avertis[0]!.limite.getTime() - Date.now()) / 86_400_000).toBeCloseTo(30, 0);

    // Le service tourne de nouveau : ni nouvel e-mail ni effacement avant la nouvelle date.
    await passe();
    expect(avertis).toHaveLength(1);
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    await s.db.query("update comptes set averti = now() - interval '32 days'");
    await passe();
    expect(await comptes()).toEqual([]);
  });

  it("une coupure en plein préavis laisse aussi un préavis entier", async () => {
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months", "20 days");
    await passage("1 day");
    await passe();
    expect(avertis).toHaveLength(1);
    expect((avertis[0]!.limite.getTime() - Date.now()) / 86_400_000).toBeCloseTo(30, 0);
  });

  it("au retour du service, Brevo en panne : rien n'est effacé, l'avertissement repart ensuite", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months", "35 days");
    await passage("6 days");
    await purgeComptes(s.db, () => Promise.reject(new Error("Brevo 500")));
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    expect((await etat("a@exemple.fr")).averti).toBeNull();
    await passe();
    expect(avertis).toHaveLength(1);
  });

  it("sans passage connu (base restaurée, ou première fois) : compté comme une coupure", async () => {
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months", "35 days");
    await s.db.query("delete from purge_passage");
    await passe();
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    expect(avertis).toHaveLength(1);
  });

  it("une coupure trop courte pour être vue ne prend rien à la date annoncée", async () => {
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months", "30 days 1 hour");
    await passage("2 hours");
    await passe();
    expect(await comptes()).toEqual(["a@exemple.fr"]);
    expect(avertis).toEqual([]);
    await date("a@exemple.fr", "25 months", "31 days 1 minute");
    await passage("1 hour");
    await passe();
    expect(await comptes()).toEqual([]);
  });

  it("un avertissement d'avant la fin des droits ne sert pas : il en faut un nouveau", async () => {
    await login(s, browser(s), "ancien@exemple.fr");
    await login(s, browser(s), "recent@exemple.fr");
    await date("ancien@exemple.fr", "25 months", "400 days");
    await date("recent@exemple.fr", "25 months", "35 days");
    await s.db.query("update comptes set droits_jusqu_a = now() - interval '1 hour'");
    await passe();
    expect(await comptes()).toEqual(["ancien@exemple.fr", "recent@exemple.fr"]);
    expect(avertis.map((v) => v.email).sort()).toEqual(["ancien@exemple.fr", "recent@exemple.fr"]);
    expect((await etat("ancien@exemple.fr")).averti).not.toBeNull();
    await passe();
    expect(avertis).toHaveLength(2);

    // Le nouvel avertissement, lui, sert une fois son préavis passé.
    await s.db.query(
      "update comptes set averti = now() - interval '32 days', droits_jusqu_a = now() - interval '33 days'",
    );
    await passe();
    expect(await comptes()).toEqual([]);
  });

  it("un avertissement périmé ne sert pas, même sans droits", async () => {
    await login(s, browser(s), "garde@exemple.fr");
    await login(s, browser(s), "part@exemple.fr");
    await date("garde@exemple.fr", "25 months", "61 days");
    await date("part@exemple.fr", "25 months", "59 days");
    await passe();
    expect(await comptes()).toEqual(["garde@exemple.fr"]);
    expect(avertis.map((v) => v.email)).toEqual(["garde@exemple.fr"]);
    const [a] = await s.db.query<{ recent: boolean }>(
      "select averti > now() - interval '1 minute' as recent from comptes",
    );
    expect(a!.recent).toBe(true);
  });

  it("dix adresses refusées ne bloquent pas les suivantes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 10; i++) {
      await login(s, browser(s), `rejet${i}@exemple.fr`);
      await date(`rejet${i}@exemple.fr`, "30 months");
    }
    await login(s, browser(s), "bonne@exemple.fr");
    await date("bonne@exemple.fr", "25 months");
    const essais: string[][] = [];
    const tour = async () => {
      const essai: string[] = [];
      await purgeComptes(s.db, async (email, limite) => {
        essai.push(email);
        if (email.startsWith("rejet")) throw new Error("Brevo 400");
        avertis.push({ email, limite });
      });
      essais.push(essai);
    };
    await tour();
    await tour();
    expect(avertis.map((v) => v.email)).toEqual(["bonne@exemple.fr"]);
    expect(essais.map((e) => e.length)).toEqual([10, 10]);
    // La bonne adresse passe devant dès qu'elle n'a jamais été essayée ; ensuite, le plus ancien essai d'abord.
    expect(essais[1]![0]).toBe("bonne@exemple.fr");
    expect(essais[1]!.slice(1)).toEqual(essais[0]!.slice(0, 9));
    // Le suivant : celui qui restait, puis les autres. Nul n'est effacé sans avertissement.
    await tour();
    expect(essais[2]![0]).toBe(essais[0]![9]);
    expect(await comptes()).toHaveLength(11);
  });

  it("une adresse qui repasse après des refus est avertie, et l'échec n'est plus noté", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "25 months");
    await purgeComptes(s.db, () => Promise.reject(new Error("Brevo 400")));
    expect(await s.db.query<{ note: boolean }>("select essai is not null as note from comptes")).toEqual([
      { note: true },
    ]);
    await passe();
    expect(await s.db.query<{ note: boolean }>("select essai is not null as note from comptes")).toEqual([
      { note: false },
    ]);
  });

  it("aucun compte actif n'est effacé, quel que soit l'état de l'avertissement ou du service", async () => {
    const actifs = ["0 days", "1 day", "23 months", "23 months 29 days"];
    const avertissements = [null, "1 day", "31 days", "32 days", "59 days", "61 days", "400 days"];
    const droits = [null, "now() - interval '1 hour'", "now() + interval '1 month'"];
    const ajoute = (email: string, vu: string, averti: string | null, d: string | null) =>
      s.db.query(
        `insert into comptes (id, email, vu, averti, droits_jusqu_a)
         values (gen_random_uuid(), $1, now() - $2::interval, now() - $3::interval, ${d ?? "null"})`,
        [email, vu, averti],
      );
    let n = 0;
    for (const vu of actifs)
      for (const averti of avertissements) for (const d of droits) await ajoute(`c${n++}@exemple.fr`, vu, averti, d);
    // Le témoin : la même purge efface bien un compte inactif et averti.
    await ajoute("inactif@exemple.fr", "25 months", "32 days", null);
    await passe();
    expect(await comptes()).not.toContain("inactif@exemple.fr");
    expect(await comptes()).toHaveLength(n);
    for (const depuis of ["2 hours", "6 days"]) {
      await passage(depuis);
      await passe();
      expect(await comptes()).toHaveLength(n);
    }
  });

  it("purge retire les traces de suppression anciennes, et rien d'autre", async () => {
    const a = await login(s, browser(s), "a@exemple.fr");
    const il_y_a = (mois: number) => Date.now() - mois * 31 * 86_400_000;
    const ligne = (id: string, modifie: number, supprime: boolean) =>
      s.db.query("insert into projets (compte, id, modifie, supprime, donnees) values ($1, $2, $3, $4, $5::jsonb)", [
        a.id,
        id,
        modifie,
        supprime,
        supprime ? null : "{}",
      ]);
    await ligne("vieille-trace", il_y_a(25), true);
    await ligne("trace-recente", il_y_a(12), true);
    await ligne("trace-a-venir", Date.now() + 86_400_000, true);
    await ligne("vieil-escalier", il_y_a(40), false);
    await purge(s.db);
    const ids = await s.db.query<{ id: string }>("select id from projets order by id");
    expect(ids.map((r) => r.id)).toEqual(["trace-a-venir", "trace-recente", "vieil-escalier"]);
    expect(await comptes()).toEqual(["a@exemple.fr"]);
  });

  it("purge seule ne touche à aucun compte", async () => {
    await login(s, browser(s), "a@exemple.fr");
    await date("a@exemple.fr", "40 months", "60 days");
    await purge(s.db);
    expect(await comptes()).toEqual(["a@exemple.fr"]);
  });

  it("la migration date un compte existant de sa dernière activité connue", async () => {
    const db = await pgliteDb();
    await migrate(db);
    await db.exec(
      `drop table purge_passage; alter table comptes drop column essai;
       alter table comptes drop column vu, drop column averti; delete from schema_version where v >= 6;`,
    );
    const compte = async (n: number, age: string) => {
      const id = `00000000-0000-0000-0000-00000000000${n}`;
      await db.query("insert into comptes (id, email, cree) values ($1, $2, now() - $3::interval)", [
        id,
        `c${n}@exemple.fr`,
        age,
      ]);
      return id;
    };
    const ms = (mois: number) => Date.now() - mois * 31 * 86_400_000;
    await compte(1, "40 months");
    const passkey = await compte(2, "40 months");
    await db.query(
      "insert into passkeys (id, compte, cle, compteur, nom, cree, utilise) values ('k', $1, 'c', 0, 'A', now() - interval '40 months', now() - interval '3 months')",
      [passkey],
    );
    const session = await compte(3, "40 months");
    await db.query(
      "insert into sessions (hash, compte, cree, expire) values ('h', $1, now() - interval '30 months', now() + interval '360 days')",
      [session],
    );
    const projet = await compte(4, "40 months");
    await db.query(
      "insert into projets (compte, id, modifie, supprime) values ($1, 'a', $2, true), ($1, 'b', $3, true)",
      [projet, ms(30), ms(6)],
    );
    // Dates d'appareil impossibles : à venir, elle compte pour aujourd'hui ; avant 1970, elle ne fait pas tomber la migration.
    const avenir = await compte(5, "40 months");
    await db.query("insert into projets (compte, id, modifie, supprime) values ($1, 'a', $2, true)", [
      avenir,
      Number.MAX_SAFE_INTEGER,
    ]);
    const negatif = await compte(6, "40 months");
    await db.query("insert into projets (compte, id, modifie, supprime) values ($1, 'a', -9000000000000000, true)", [
      negatif,
    ]);
    const atelier = await compte(7, "40 months");
    await db.query("insert into ateliers (compte, modifie, donnees) values ($1, $2, '{}'::jsonb)", [atelier, ms(2)]);
    const devis = await compte(8, "40 months");
    await db.query(
      "insert into devis_numeros (compte, projet, annee, rang, cree) values ($1, 'a', 2026, 1, now() - interval '1 month')",
      [devis],
    );

    await migrate(db);
    const rows = await db.query<{ email: string; mois: number; averti: Date | null }>(
      "select email, round(extract(epoch from now() - vu) / 2678400)::int as mois, averti from comptes order by email",
    );
    expect(rows.map((r) => [r.email, r.mois])).toEqual([
      ["c1@exemple.fr", 39],
      ["c2@exemple.fr", 3],
      ["c3@exemple.fr", 0],
      ["c4@exemple.fr", 6],
      ["c5@exemple.fr", 0],
      ["c6@exemple.fr", 39],
      ["c7@exemple.fr", 2],
      ["c8@exemple.fr", 1],
    ]);
    expect(rows.every((r) => r.averti === null)).toBe(true);

    // Vieux de 40 mois, le plus ancien est averti d'abord, et n'est effacé qu'après son préavis.
    const envoyes: string[] = [];
    await purgeComptes(db, async (email) => void envoyes.push(email));
    expect(envoyes.sort()).toEqual(["c1@exemple.fr", "c6@exemple.fr"]);
    expect(await db.query("select 1 from comptes")).toHaveLength(8);
    await db.close();
  });

  it("l'e-mail dit la date et le geste à faire", async () => {
    let envoi: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      envoi = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response("{}", { status: 201 });
    });
    await brevoAvertissement("cle")("a@exemple.fr", new Date("2029-01-14T12:00:00Z"));
    expect(envoi.to).toEqual([{ email: "a@exemple.fr" }]);
    expect(envoi.subject).toContain("14 janvier 2029");
    expect(envoi.textContent).toContain("avant le 14 janvier 2029");
    expect(envoi.textContent).toContain("https://quart-de-tour.fr/app/");
    expect(envoi.htmlContent).toContain("avant le 14 janvier 2029");
  });

  it("un refus de Brevo se voit comme un échec", async () => {
    vi.stubGlobal("fetch", async () => new Response("non", { status: 500 }));
    await expect(brevoAvertissement("cle")("a@exemple.fr", new Date())).rejects.toThrow(/Brevo 500/);
  });
});
