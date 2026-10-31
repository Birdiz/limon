import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { atelierDefauts, newAtelier } from "../src/core/atelier";
import { ENTREPRISE_VIDE, TARIFS_VIDES } from "../src/core/tarifs";
import { DEFAULTS } from "../src/core/params";
import { newProject } from "../src/core/project";
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
