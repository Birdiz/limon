// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import * as webauthn from "@simplewebauthn/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Changement, CompteDetail, Passkey } from "../src/core/account";
import { newDevis } from "../src/core/devis";
import { newProject } from "../src/core/project";
import { AccountPanel } from "../src/ui/account";
import { Api } from "../src/ui/api";
import { LocalStore, type KeyValue } from "../src/ui/store";
import { SyncStore } from "../src/ui/sync";

// Le navigateur de jsdom n'a ni Face ID ni passkeys : chaque test dit ce que l'appareil sait faire.
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthnAutofill: vi.fn(),
  platformAuthenticatorIsAvailable: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

const COMPTE = { id: "c", email: "a@exemple.fr", statut: "testeur" as const };
const CLE: Passkey = { id: "k/1", nom: "iPhone", cree: Date.UTC(2026, 0, 15), utilise: null };
const detail = (...passkeys: Passkey[]): CompteDetail => ({ ...COMPTE, passkeys });

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const vide = () => new Response(null, { status: 204 });
const coupure = () => {
  throw new TypeError("Failed to fetch");
};
const refus = (status: number, erreur: string) => () => json({ erreur }, status);

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const msg = () => el("acMsg");
const settled = () => new Promise((r) => setTimeout(r));
const vue = () => ["acLogin", "acOffer", "acAccount"].filter((id) => !el(id).hidden);
const enErreur = () => !msg().hidden && msg().classList.contains("err");

function soumettre(id: string): void {
  el(id).dispatchEvent(new Event("submit", { cancelable: true }));
}

/** Le panneau sur un serveur simulé. `reponses` remplace une route, « POST code » par exemple. */
function monter(reponses: Record<string, () => Response> = {}) {
  const m = new Map<string, string>();
  const storage: KeyValue = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
  const appels: { route: string; corps?: unknown }[] = [];
  const index: { id: string; modifie: number; supprime: boolean }[] = [];
  const api = new Api((input, init) => {
    const route = `${init?.method} ${String(input).replace("/api/", "")}`;
    const corps = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    appels.push({ route, corps });
    const reponse = reponses[route];
    if (reponse) return Promise.resolve().then(reponse);
    if (route === "GET compte") return Promise.resolve(json(detail()));
    if (route === "GET projets") return Promise.resolve(json(index));
    if (route === "PUT projets") {
      for (const ch of (corps as { changements: Changement[] }).changements)
        index.push("projet" in ch ? { id: ch.id, modifie: ch.projet.modifie, supprime: false } : { ...ch });
      return Promise.resolve(json({ index, refus: [] }));
    }
    return Promise.resolve(vide());
  });
  const store = new SyncStore(new LocalStore(storage), api, storage);
  const panel = new AccountPanel(store, api);
  const routes = () => appels.map((a) => a.route);
  return { store, panel, appels, routes };
}

/**
 * Ouvre l'onglet de connexion et attend le chargement de WebAuthn qu'il lance : Vitest donne le vrai module à un second
 * `import()` parti avant la fin du premier, et le geste suivant ne passerait plus par le simulacre.
 */
async function ouvrir(panel: AccountPanel): Promise<void> {
  vi.mocked(webauthn.browserSupportsWebAuthnAutofill).mockClear();
  await panel.show();
  await vi.waitFor(() => expect(webauthn.browserSupportsWebAuthnAutofill).toHaveBeenCalled());
}

async function connecte(reponses: Record<string, () => Response> = {}) {
  const d = monter(reponses);
  await d.store.signIn(COMPTE);
  await d.panel.show();
  await settled();
  return d;
}

/** Sur l'onglet de connexion, le code déjà demandé. */
async function auCode(reponses: Record<string, () => Response> = {}) {
  const d = monter(reponses);
  await ouvrir(d.panel);
  el<HTMLInputElement>("acEmail").value = "a@exemple.fr";
  soumettre("acEmailForm");
  await vi.waitFor(() => expect(el("acCodeForm").hidden).toBe(false));
  return d;
}

beforeEach(() => {
  document.body.innerHTML = body;
  vi.mocked(webauthn.browserSupportsWebAuthnAutofill).mockResolvedValue(false);
  vi.mocked(webauthn.platformAuthenticatorIsAvailable).mockResolvedValue(false);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("connexion par code", () => {
  it("envoie le code à l'adresse saisie, sans ses espaces, puis passe à l'étape du code", async () => {
    const { appels, panel } = monter();
    await ouvrir(panel);
    el<HTMLInputElement>("acEmail").value = "  a@exemple.fr ";
    soumettre("acEmailForm");
    await vi.waitFor(() => expect(el("acCodeForm").hidden).toBe(false));
    expect(appels).toContainEqual({ route: "POST code", corps: { email: "a@exemple.fr" } });
    expect(el("acEmailForm").hidden).toBe(true);
    expect(el("acCodeTo").textContent).toBe("a@exemple.fr");
    expect(msg().textContent).toContain("Code envoyé");
    expect(enErreur()).toBe(false);
  });

  it("un refus du serveur est dit dans ses mots, et reste à l'étape de l'adresse", async () => {
    const { panel } = monter({ "POST code": refus(429, "Trop de codes demandés.") });
    await ouvrir(panel);
    soumettre("acEmailForm");
    await vi.waitFor(() => expect(msg().textContent).toBe("Trop de codes demandés."));
    expect(enErreur()).toBe(true);
    expect(el("acCodeForm").hidden).toBe(true);
  });

  it("un serveur en panne sans message ne laisse pas l'artisan sans réponse", async () => {
    const { panel } = monter({ "POST code": () => new Response("<html>", { status: 502 }) });
    await ouvrir(panel);
    soumettre("acEmailForm");
    await vi.waitFor(() => expect(msg().textContent).toContain("Le serveur ne répond pas"));
    expect(enErreur()).toBe(true);
  });

  it("une coupure parle du réseau, pas du serveur", async () => {
    const { panel } = monter({ "POST code": coupure });
    await ouvrir(panel);
    soumettre("acEmailForm");
    await vi.waitFor(() => expect(msg().textContent).toContain("Pas de réseau"));
    expect(enErreur()).toBe(true);
  });

  it("un code refusé reste à l'étape du code, sans connecter", async () => {
    const { store } = await auCode({ "POST code/verifier": refus(400, "Code incorrect.") });
    el<HTMLInputElement>("acCode").value = "000000";
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(msg().textContent).toBe("Code incorrect."));
    expect(store.account()).toBeNull();
    expect(el("acCodeForm").hidden).toBe(false);
    expect(vue()).toEqual(["acLogin"]);
  });

  it("« Changer d'adresse » revient à l'adresse et vide le code", async () => {
    await auCode();
    el<HTMLInputElement>("acCode").value = "123456";
    el("acBack").click();
    expect(el("acEmailForm").hidden).toBe(false);
    expect(el("acCodeForm").hidden).toBe(true);
    expect(el<HTMLInputElement>("acCode").value).toBe("");
  });

  it("un bon code connecte et fait monter les escaliers de l'appareil", async () => {
    const { store, appels } = await auCode({ "POST code/verifier": () => json(COMPTE) });
    await store.save(newProject("a", "Dupont", "complet", 1));
    el<HTMLInputElement>("acCode").value = "123456";
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
    expect(appels).toContainEqual({
      route: "POST code/verifier",
      corps: { email: "a@exemple.fr", code: "123456" },
    });
    expect(store.account()).toEqual(COMPTE);
    expect(el("acMe").textContent).toBe(COMPTE.email);
    expect((await store.status()).pending).toBe(0);
    expect(appels.some((a) => a.route === "PUT projets")).toBe(true);
  });

  it("propose Face ID après le code là où l'appareil l'a, et « Plus tard » mène au compte", async () => {
    vi.mocked(webauthn.platformAuthenticatorIsAvailable).mockResolvedValue(true);
    await auCode({ "POST code/verifier": () => json(COMPTE) });
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(vue()).toEqual(["acOffer"]));
    el("acOfferNo").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
  });
});

describe("onglet de connexion", () => {
  it("parle de créer un compte à qui n'en a jamais eu, de se connecter à qui en a eu un", async () => {
    const neuf = monter();
    await ouvrir(neuf.panel);
    expect(el("acIntro").textContent).toContain("Avec un compte");
    expect(el("acEmailLbl").textContent).toMatch(/^Créer un compte/);

    await neuf.store.signIn(COMPTE);
    await neuf.store.signOut();
    await ouvrir(neuf.panel);
    expect(el("acIntro").textContent).toContain("Connectez-vous");
    expect(el("acEmailLbl").textContent).toMatch(/^Se connecter/);
  });

  it("n'offre la passkey que là où le navigateur la connaît", async () => {
    const { panel } = monter();
    await ouvrir(panel);
    expect(el("acPkBox").hidden).toBe(true);
    vi.stubGlobal("PublicKeyCredential", function () {});
    await ouvrir(panel);
    expect(el("acPkBox").hidden).toBe(false);
  });
});

describe("connexion par passkey", () => {
  const options = { "POST passkey/options": () => json({ challenge: "x" }) };

  it("connecte et mène au compte", async () => {
    vi.mocked(webauthn.startAuthentication).mockResolvedValue({ id: "r" } as never);
    const { panel, store, appels } = monter({ ...options, "POST passkey/connexion": () => json(COMPTE) });
    await ouvrir(panel);
    el("acPk").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
    expect(store.account()).toEqual(COMPTE);
    expect(appels).toContainEqual({ route: "POST passkey/connexion", corps: { reponse: { id: "r" } } });
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "x" },
      useBrowserAutofill: false,
    });
  });

  it.each(["NotAllowedError", "AbortError"])("%s : annuler n'est pas une erreur à afficher", async (name) => {
    vi.mocked(webauthn.startAuthentication).mockRejectedValue(Object.assign(new Error("annulé"), { name }));
    const { panel, store } = monter(options);
    await ouvrir(panel);
    el("acPk").click();
    await vi.waitFor(() => expect(webauthn.startAuthentication).toHaveBeenCalled());
    await settled();
    expect(msg().hidden).toBe(true);
    expect(store.account()).toBeNull();
  });

  it("une autre erreur de la passkey est dite", async () => {
    vi.mocked(webauthn.startAuthentication).mockRejectedValue(new Error("Passkey illisible"));
    const { panel } = monter(options);
    await ouvrir(panel);
    el("acPk").click();
    await vi.waitFor(() => expect(msg().textContent).toBe("Passkey illisible"));
    expect(enErreur()).toBe(true);
  });

  it("le remplissage automatique du champ propose la passkey sans clic", async () => {
    vi.mocked(webauthn.browserSupportsWebAuthnAutofill).mockResolvedValue(true);
    vi.mocked(webauthn.startAuthentication).mockResolvedValue({ id: "r" } as never);
    const { panel } = monter({ ...options, "POST passkey/connexion": () => json(COMPTE) });
    await ouvrir(panel);
    await vi.waitFor(() =>
      expect(webauthn.startAuthentication).toHaveBeenCalledWith(expect.objectContaining({ useBrowserAutofill: true })),
    );
  });
});

describe("compte affiché", () => {
  it("liste les passkeys, leur nom échappé, et leurs dates", async () => {
    const nom = '<img data-intrus="1">';
    await connecte({
      "GET compte": () => json(detail({ ...CLE, nom, id: "a" }, { ...CLE, id: "b", utilise: Date.UTC(2026, 1, 20) })),
    });
    const list = el("acKeys");
    await vi.waitFor(() => expect(list.querySelectorAll("button[data-key]")).toHaveLength(2));
    expect(list.querySelector("[data-intrus]")).toBeNull();
    expect(list.querySelector("b")!.textContent).toBe(nom);
    expect(list.children[0]!.textContent).toContain("ajoutée le 15/01/2026");
    expect(list.children[0]!.textContent).not.toContain("utilisée");
    expect(list.children[1]!.textContent).toContain("utilisée le 20/02/2026");
  });

  it("sans passkey : dit qu'on se connecte par code", async () => {
    await connecte();
    expect(el("acKeys").textContent).toContain("code par e-mail");
  });

  it("n'offre d'en ajouter une que là où le navigateur la connaît", async () => {
    await connecte();
    expect(el("acAddKey").hidden).toBe(true);
    vi.stubGlobal("PublicKeyCredential", function () {});
    const { panel } = await connecte();
    await panel.show();
    expect(el("acAddKey").hidden).toBe(false);
  });

  it("hors ligne : le compte s'affiche quand même, la liste dit pourquoi elle manque", async () => {
    await connecte({ "GET compte": coupure });
    expect(vue()).toEqual(["acAccount"]);
    expect(el("acMe").textContent).toBe(COMPTE.email);
    expect(el("acKeys").textContent).toContain("sans réseau");
    expect(msg().hidden).toBe(true);
  });

  it("un refus du serveur à l'ouverture est dit", async () => {
    await connecte({ "GET compte": refus(500, "Base indisponible.") });
    expect(msg().textContent).toBe("Base indisponible.");
    expect(enErreur()).toBe(true);
  });

  it("session expirée : dit qu'on n'est plus connecté, et le compte quitte l'en-tête", async () => {
    const { store } = await connecte({ "GET compte": () => new Response(null, { status: 401 }) });
    expect(store.account()).toBeNull();
    expect(msg().textContent).toBe("Vous n'êtes plus connecté.");
    expect(el("saved").textContent).toBe("Enregistré sur cet appareil");
    expect(el("acOpen").classList.contains("guest")).toBe(true);
  });
});

describe("session perdue", () => {
  it("revient à la connexion, sans plus dire « Connecté avec… »", async () => {
    await connecte({ "GET compte": () => new Response(null, { status: 401 }) });
    expect(vue()).toEqual(["acLogin"]);
    expect(msg().textContent).toBe("Vous n'êtes plus connecté.");
  });

  it("découverte par un échange en arrière-plan, le compte à l'écran : revient aussi à la connexion", async () => {
    let perdue = false;
    const { store } = await connecte({
      "GET projets": () => (perdue ? new Response(null, { status: 401 }) : json([])),
    });
    expect(vue()).toEqual(["acAccount"]);
    perdue = true;
    await store.sync();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(store.account()).toBeNull();
  });

  it("l'offre de passkey à l'écran : revient à la connexion", async () => {
    vi.mocked(webauthn.platformAuthenticatorIsAvailable).mockResolvedValue(true);
    await auCode({
      "POST code/verifier": () => json(COMPTE),
      "POST passkey/ajout/options": () => new Response(null, { status: 401 }),
    });
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(vue()).toEqual(["acOffer"]));
    el("acOfferYes").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
  });

  it("sans compte à l'écran, ne lance pas la connexion au chargement de la page", async () => {
    monter();
    await settled();
    expect(webauthn.browserSupportsWebAuthnAutofill).not.toHaveBeenCalled();
  });
});

describe("passkeys du compte", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", 5, "iPhone"],
    ["Mozilla/5.0 (iPad; CPU OS 18_0)", 5, "iPad"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "iPad"],
    ["Mozilla/5.0 (Linux; Android 15)", 5, "Android"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, "Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64)", 0, "Ordinateur"],
  ])("%s, %i points de contact : s'ajoute au nom de %s", async (userAgent, maxTouchPoints, nom) => {
    vi.mocked(webauthn.startRegistration).mockResolvedValue({ id: "r" } as never);
    const { appels } = await connecte({
      "POST passkey/ajout/options": () => json({ challenge: "x" }),
      "POST passkey/ajout": () => json(detail({ ...CLE, nom })),
    });
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
    el("acAddKey").click();
    await vi.waitFor(() => expect(el("acKeys").querySelector("b")?.textContent).toBe(nom));
    expect(appels).toContainEqual({ route: "POST passkey/ajout", corps: { reponse: { id: "r" }, nom } });
    expect(msg().textContent).toContain("activé sur cet appareil");
    expect(enErreur()).toBe(false);
  });

  it("l'offre après le code active la passkey et mène au compte", async () => {
    vi.mocked(webauthn.platformAuthenticatorIsAvailable).mockResolvedValue(true);
    vi.mocked(webauthn.startRegistration).mockResolvedValue({ id: "r" } as never);
    await auCode({
      "POST code/verifier": () => json(COMPTE),
      "POST passkey/ajout/options": () => json({ challenge: "x" }),
      "POST passkey/ajout": () => json(detail(CLE)),
    });
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(vue()).toEqual(["acOffer"]));
    el("acOfferYes").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
    expect(el("acKeys").querySelector("b")!.textContent).toBe("iPhone");
  });

  it("n'en retire une qu'après confirmation, et son identifiant passe encodé", async () => {
    const route = `DELETE passkeys/${encodeURIComponent(CLE.id)}`;
    const { routes } = await connecte({ "GET compte": () => json(detail(CLE)), [route]: () => json(detail()) });
    await vi.waitFor(() => expect(el("acKeys").querySelector("button[data-key]")).not.toBeNull());
    const retirer = el("acKeys").querySelector<HTMLButtonElement>("button[data-key]")!;

    vi.mocked(confirm).mockReturnValueOnce(false);
    retirer.click();
    await settled();
    expect(routes()).not.toContain(route);
    expect(el("acKeys").querySelector("button[data-key]")).not.toBeNull();

    retirer.click();
    await vi.waitFor(() => expect(routes()).toContain(route));
    await vi.waitFor(() => expect(el("acKeys").querySelector("button[data-key]")).toBeNull());
  });

  it("un retrait refusé par le serveur laisse la passkey à l'écran", async () => {
    const route = `DELETE passkeys/${encodeURIComponent(CLE.id)}`;
    await connecte({ "GET compte": () => json(detail(CLE)), [route]: refus(500, "Base indisponible.") });
    await vi.waitFor(() => expect(el("acKeys").querySelector("button[data-key]")).not.toBeNull());
    el("acKeys").querySelector<HTMLButtonElement>("button[data-key]")!.click();
    await vi.waitFor(() => expect(msg().textContent).toBe("Base indisponible."));
    expect(el("acKeys").querySelector("button[data-key]")).not.toBeNull();
  });
});

describe("se déconnecter", () => {
  it("demande d'abord, et ne fait rien sans accord", async () => {
    const { store, routes } = await connecte();
    vi.mocked(confirm).mockReturnValueOnce(false);
    el("acLogout").click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await settled();
    expect(store.account()).toEqual(COMPTE);
    expect(routes()).not.toContain("POST deconnexion");
    expect(vue()).toEqual(["acAccount"]);
  });

  it("revient à la connexion, et les escaliers envoyés quittent l'appareil", async () => {
    const { store, routes } = await connecte();
    await store.save(newProject("a", "Dupont", "complet", 1));
    await store.sync();
    el("acLogout").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(routes()).toContain("POST deconnexion");
    expect(store.account()).toBeNull();
    expect(await store.get("a")).toBeNull();
  });

  it("prévient qu'un escalier refusé reste sur l'appareil", async () => {
    const { store } = await connecte({
      "PUT projets": () => json({ index: [], refus: [{ id: "a", raison: "Sa date est impossible." }] }),
    });
    await store.save(newProject("a", "Dupont", "complet", 1));
    await store.sync();
    el("acLogout").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(vi.mocked(confirm).mock.lastCall![0]).toContain("restent sur cet appareil");
    expect(await store.get("a")).not.toBeNull();
  });

  it("hors ligne : refuse tant que des modifications attendent, et les garde", async () => {
    const { store, routes } = await connecte({ "PUT projets": coupure });
    await store.save(newProject("a", "Dupont", "complet", 1));
    el("acLogout").click();
    await vi.waitFor(() => expect(msg().textContent).toContain("retrouvez du réseau"));
    expect(enErreur()).toBe(true);
    expect(routes()).not.toContain("POST deconnexion");
    expect(store.account()).toEqual(COMPTE);
    expect(await store.get("a")).not.toBeNull();
    expect(vue()).toEqual(["acAccount"]);
  });

  it("serveur qui refuse : dit sa raison, et garde les modifications", async () => {
    const { store } = await connecte({ "PUT projets": refus(500, "Base indisponible.") });
    await store.save(newProject("a", "Dupont", "complet", 1));
    el("acLogout").click();
    await vi.waitFor(() => expect(msg().textContent).toContain("Base indisponible."));
    expect(store.account()).toEqual(COMPTE);
    expect(await store.get("a")).not.toBeNull();
  });

  it("session déjà expirée côté serveur : la déconnexion aboutit quand même", async () => {
    const { store } = await connecte({ "POST deconnexion": () => new Response(null, { status: 401 }) });
    el("acLogout").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(store.account()).toBeNull();
    expect(msg().hidden).toBe(true);
  });
});

describe("supprimer le compte", () => {
  const demander = async () => {
    el("acDelete").click();
    await vi.waitFor(() => expect(el("acDeleteBox").hidden).toBe(false));
  };
  const avecClient = (id: string) => ({
    ...newProject(id, "Dupont", "complet", 1),
    devis: { ...newDevis(), client: { nom: "M. Martin", adresse: "1 rue des Lilas", chantier: "" } },
  });

  it("demande d'abord, et « Garder mon compte » ne fait rien", async () => {
    const { store, routes } = await connecte();
    await demander();
    expect(routes()).not.toContain("DELETE compte");
    el("acDeleteNo").click();
    await settled();
    expect(el("acDeleteBox").hidden).toBe(true);
    expect(routes()).not.toContain("DELETE compte");
    expect(store.account()).toEqual(COMPTE);
  });

  it("dit ce qui est effacé, et ce que contient « Effacer aussi de cet appareil »", async () => {
    const { store } = await connecte();
    await store.save(newProject("a", "Dupont", "complet", 1));
    await store.save(avecClient("b"));
    await demander();
    expect(el("acDeleteBox").textContent).toContain("profil de votre atelier");
    expect(el("acDeleteBox").textContent).toContain("tarifs");
    expect(el("acDeleteBox").textContent).toContain("Effacer aussi de cet appareil");
    expect(el("acWipeWhat").textContent).toContain("Vos 2 escaliers, avec leurs devis et leurs clients");
    expect(el<HTMLInputElement>("acWipe").checked).toBe(false);
  });

  it("un seul escalier, sans devis : ne parle ni de plusieurs, ni de clients", async () => {
    const { store } = await connecte();
    await store.save(newProject("a", "Dupont", "complet", 1));
    await demander();
    expect(el("acWipeWhat").textContent).toMatch(/^Votre escalier\. Sinon, il reste ici/);
  });

  it("aucun escalier sur l'appareil : le choix n'est pas proposé, et le compte part quand même", async () => {
    const { routes } = await connecte();
    await demander();
    expect(el("acWipeBox").hidden).toBe(true);
    el("acDeleteYes").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(routes()).toContain("DELETE compte");
  });

  it("sans le choix : revient à la connexion, et les escaliers restent sur l'appareil", async () => {
    const { store, routes } = await connecte();
    await store.save(newProject("a", "Dupont", "complet", 1));
    await store.sync();
    await demander();
    el("acDeleteYes").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(routes()).toContain("DELETE compte");
    expect(store.account()).toBeNull();
    expect(await store.get("a")).not.toBeNull();
    expect(el("acDeleteBox").hidden).toBe(true);
  });

  it("avec le choix : les escaliers quittent l'appareil, envoyés ou non", async () => {
    const { store, routes } = await connecte({
      "PUT projets": () => json({ index: [], refus: [{ id: "b", raison: "Sa date est impossible." }] }),
    });
    await store.save(newProject("a", "Dupont", "complet", 1));
    await store.save(avecClient("b"));
    await store.sync();
    await demander();
    el<HTMLInputElement>("acWipe").checked = true;
    el("acDeleteYes").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(routes()).toContain("DELETE compte");
    expect(await store.list()).toEqual([]);
  });

  it("un refus du serveur est dit, et le compte comme les escaliers restent", async () => {
    const { store } = await connecte({ "DELETE compte": refus(500, "Base indisponible.") });
    await store.save(newProject("a", "Dupont", "complet", 1));
    await demander();
    el<HTMLInputElement>("acWipe").checked = true;
    el("acDeleteYes").click();
    await vi.waitFor(() => expect(msg().textContent).toBe("Base indisponible."));
    expect(store.account()).toEqual(COMPTE);
    expect(await store.get("a")).not.toBeNull();
    expect(vue()).toEqual(["acAccount"]);
  });
});
