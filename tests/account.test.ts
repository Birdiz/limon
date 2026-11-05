// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import * as webauthn from "@simplewebauthn/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Appareil, Changement, CompteDetail, Passkey } from "../src/core/account";
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
const detail = (...passkeys: Passkey[]): CompteDetail => ({ ...COMPTE, passkeys, appareils: [ICI] });
const ICI: Appareil = {
  id: "ici",
  nom: "Mac",
  cree: Date.UTC(2026, 0, 10),
  utilise: Date.UTC(2026, 0, 12),
  actuel: true,
};
const LOIN: Appareil = { ...ICI, id: "loin/1", nom: "iPhone", utilise: Date.UTC(2026, 1, 20), actuel: false };
const avec = (...autres: Appareil[]): CompteDetail => ({ ...detail(), appareils: [ICI, ...autres] });

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const vide = () => new Response(null, { status: 204 });
const coupure = () => {
  throw new TypeError("Failed to fetch");
};
const refus = (status: number, erreur: string) => () => json({ erreur }, status);

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const msg = () => el("acMsg");
const settled = () => new Promise((r) => setTimeout(r));
const vue = () => ["acLogin", "acOffer", "acRetenus", "acAccount", "acProof"].filter((id) => !el(id).hidden);
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

  it.each(["acCode", "acNewCode", "acProofCode"])("le champ %s prend un code à 8 chiffres, espace comprise", (id) => {
    monter({});
    const champ = el<HTMLInputElement>(id);
    expect(champ.maxLength).toBe(9);
    const forme = new RegExp(`^(?:${champ.pattern})$`);
    expect(forme.test("12345678")).toBe(true);
    expect(forme.test("1234 5678")).toBe(true);
    expect(forme.test("123456")).toBe(false);
  });

  it("un code refusé reste à l'étape du code, sans connecter", async () => {
    const { store } = await auCode({ "POST code/verifier": refus(400, "Code incorrect.") });
    el<HTMLInputElement>("acCode").value = "00000000";
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(msg().textContent).toBe("Code incorrect."));
    expect(store.account()).toBeNull();
    expect(el("acCodeForm").hidden).toBe(false);
    expect(vue()).toEqual(["acLogin"]);
  });

  it("« Changer d'adresse » revient à l'adresse et vide le code", async () => {
    await auCode();
    el<HTMLInputElement>("acCode").value = "12345678";
    el("acBack").click();
    expect(el("acEmailForm").hidden).toBe(false);
    expect(el("acCodeForm").hidden).toBe(true);
    expect(el<HTMLInputElement>("acCode").value).toBe("");
  });

  it("un bon code connecte et fait monter les escaliers de l'appareil", async () => {
    const { store, appels } = await auCode({ "POST code/verifier": () => json(COMPTE) });
    await store.save(newProject("a", "Dupont", "complet", 1));
    el<HTMLInputElement>("acCode").value = "12345678";
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
    expect(appels).toContainEqual({
      route: "POST code/verifier",
      corps: { email: "a@exemple.fr", code: "12345678", appareil: "Ordinateur" },
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
    expect(appels).toContainEqual({
      route: "POST passkey/connexion",
      corps: { reponse: { id: "r" }, appareil: "Ordinateur" },
    });
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

describe("appareils connectés", () => {
  it("liste les appareils, leur nom échappé, et leur dernier usage ; celui-ci sans bouton", async () => {
    const nom = '<img data-intrus="1">';
    await connecte({ "GET compte": () => json(avec({ ...LOIN, nom })) });
    const list = el("acDevices");
    await vi.waitFor(() => expect(list.querySelectorAll("button[data-device]")).toHaveLength(1));
    expect(list.querySelector("[data-intrus]")).toBeNull();
    expect(list.children[0]!.textContent).toContain("Mac");
    expect(list.children[0]!.textContent).toContain("cet appareil");
    expect(list.children[0]!.querySelector("button")).toBeNull();
    expect(list.children[1]!.querySelector("b")!.textContent).toBe(nom);
    expect(list.children[1]!.textContent).toContain("utilisé le 20/02/2026");
    expect(el("acCloseOthers").hidden).toBe(false);
  });

  it("seul connecté : pas de quoi déconnecter les autres", async () => {
    await connecte();
    await vi.waitFor(() => expect(el("acDevices").querySelector("li.cur")).not.toBeNull());
    expect(el("acCloseOthers").hidden).toBe(true);
  });

  it("en déconnecte un, identifiant encodé, sans quitter ce compte", async () => {
    const route = `DELETE sessions/${encodeURIComponent(LOIN.id)}`;
    const { routes, store } = await connecte({ "GET compte": () => json(avec(LOIN)), [route]: () => json(detail()) });
    await vi.waitFor(() => expect(el("acDevices").querySelector("button[data-device]")).not.toBeNull());
    el("acDevices").querySelector<HTMLButtonElement>("button[data-device]")!.click();
    await vi.waitFor(() => expect(routes()).toContain(route));
    await vi.waitFor(() => expect(el("acDevices").querySelector("button[data-device]")).toBeNull());
    expect(msg().textContent).toBe("Appareil déconnecté");
    expect(store.account()).toEqual(COMPTE);
    expect(el("acCloseOthers").hidden).toBe(true);
  });

  it("déconnecte les autres d'un coup", async () => {
    const { routes, store } = await connecte({
      "GET compte": () => json(avec(LOIN, { ...LOIN, id: "loin2" })),
      "DELETE sessions": () => json(detail()),
    });
    await vi.waitFor(() => expect(el("acCloseOthers").hidden).toBe(false));
    el("acCloseOthers").click();
    await vi.waitFor(() => expect(routes()).toContain("DELETE sessions"));
    await vi.waitFor(() => expect(el("acDevices").querySelector("button[data-device]")).toBeNull());
    expect(store.account()).toEqual(COMPTE);
  });

  it("hors ligne : la liste dit pourquoi elle manque", async () => {
    await connecte({ "GET compte": coupure });
    expect(el("acDevices").textContent).toContain("sans réseau");
    expect(el("acCloseOthers").hidden).toBe(true);
  });

  it("cet appareil déconnecté d'ailleurs : l'appel suivant rend la session perdue", async () => {
    const route = `DELETE sessions/${encodeURIComponent(LOIN.id)}`;
    const { store } = await connecte({
      "GET compte": () => json(avec(LOIN)),
      [route]: refus(401, "Vous n'êtes plus connecté."),
    });
    await vi.waitFor(() => expect(el("acDevices").querySelector("button[data-device]")).not.toBeNull());
    el("acDevices").querySelector<HTMLButtonElement>("button[data-device]")!.click();
    await vi.waitFor(() => expect(store.account()).toBeNull());
  });

  it("le nom de cet appareil part avec le code", async () => {
    const { appels } = await auCode({ "POST code/verifier": () => json(COMPTE) });
    vi.stubGlobal("navigator", { userAgent: "iPhone", maxTouchPoints: 5 });
    el<HTMLInputElement>("acCode").value = "12345678";
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(appels.some((a) => a.route === "POST code/verifier")).toBe(true));
    expect(appels).toContainEqual({
      route: "POST code/verifier",
      corps: { email: "a@exemple.fr", code: "12345678", appareil: "iPhone" },
    });
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

describe("changer d'adresse", () => {
  const NEUVE = "neuve@exemple.fr";
  const change = async (reponses: Record<string, () => Response> = {}) => {
    const d = await connecte({ "PUT compte/email": () => json({ ...detail(), email: NEUVE }), ...reponses });
    el("acEmailChange").click();
    return d;
  };
  const auCodeNeuf = async (reponses: Record<string, () => Response> = {}) => {
    const d = await change(reponses);
    el<HTMLInputElement>("acNewEmail").value = ` ${NEUVE} `;
    soumettre("acNewEmailForm");
    await vi.waitFor(() => expect(el("acNewCodeForm").hidden).toBe(false));
    return d;
  };

  it("ne montre que le bouton, jusqu'à ce qu'on le demande", async () => {
    await connecte();
    expect(el("acEmailChange").hidden).toBe(false);
    expect(el("acNewEmailForm").hidden).toBe(true);
    expect(el("acNewCodeForm").hidden).toBe(true);
    el("acEmailChange").click();
    expect(el("acEmailChange").hidden).toBe(true);
    expect(el("acNewEmailForm").hidden).toBe(false);
    el("acNewEmailNo").click();
    expect(el("acEmailChange").hidden).toBe(false);
    expect(el("acNewEmailForm").hidden).toBe(true);
  });

  it("le bon code : l'adresse change partout, sans déconnecter, et l'en-tête suit", async () => {
    const { store, appels } = await auCodeNeuf();
    expect(el("acNewCodeTo").textContent).toBe(NEUVE);
    expect(appels.find((a) => a.route === "POST compte/email/code")?.corps).toEqual({ email: NEUVE });
    el<HTMLInputElement>("acNewCode").value = "12345678";
    soumettre("acNewCodeForm");
    await vi.waitFor(() => expect(el("acMe").textContent).toBe(NEUVE));
    expect(appels.find((a) => a.route === "PUT compte/email")?.corps).toEqual({ email: NEUVE, code: "12345678" });
    expect(store.account()).toMatchObject({ id: COMPTE.id, email: NEUVE });
    expect(el("acOpen").querySelector(".avatar")?.textContent).toBe("N");
    expect(msg().textContent).toContain("connectez-vous désormais");
    expect(el("acNewCodeForm").hidden).toBe(true);
    expect(el("acEmailChange").hidden).toBe(false);
    expect(el<HTMLInputElement>("acNewEmail").value).toBe("");
  });

  it("une adresse qui a déjà un compte : le refus est dit, et l'adresse reste", async () => {
    const non = "Cette adresse a déjà son propre compte. Votre compte garde son adresse actuelle.";
    const { store } = await auCodeNeuf({ "PUT compte/email": refus(409, non) });
    el<HTMLInputElement>("acNewCode").value = "12345678";
    soumettre("acNewCodeForm");
    await vi.waitFor(() => expect(msg().textContent).toBe(non));
    expect(enErreur()).toBe(true);
    expect(store.account()!.email).toBe(COMPTE.email);
    expect(el("acMe").textContent).toBe(COMPTE.email);
    // Le code est usé : retour à l'adresse, pour en donner une autre.
    expect(el("acNewEmailForm").hidden).toBe(false);
    expect(el("acNewCodeForm").hidden).toBe(true);
  });

  it("un mauvais code : on reste sur le code, pour réessayer", async () => {
    await auCodeNeuf({ "PUT compte/email": refus(400, "Code incorrect.") });
    el<HTMLInputElement>("acNewCode").value = "00000000";
    soumettre("acNewCodeForm");
    await vi.waitFor(() => expect(msg().textContent).toBe("Code incorrect."));
    expect(el("acNewCodeForm").hidden).toBe(false);
  });

  it("le code qui ne part pas : on reste sur l'adresse, pour réessayer", async () => {
    await change({ "POST compte/email/code": refus(502, "L'e-mail n'a pas pu partir. Réessayez dans un instant.") });
    el<HTMLInputElement>("acNewEmail").value = NEUVE;
    soumettre("acNewEmailForm");
    await vi.waitFor(() => expect(enErreur()).toBe(true));
    expect(el("acNewEmailForm").hidden).toBe(false);
    expect(el("acNewCodeForm").hidden).toBe(true);
  });

  it("revient à l'adresse pour la corriger ou renvoyer un code", async () => {
    await auCodeNeuf();
    el("acNewCodeBack").click();
    expect(el("acNewEmailForm").hidden).toBe(false);
    expect(el<HTMLInputElement>("acNewEmail").value.trim()).toBe(NEUVE);
  });

  it("revenir sur l'onglet repart du bouton", async () => {
    const { panel } = await auCodeNeuf();
    await panel.show();
    expect(el("acEmailChange").hidden).toBe(false);
    expect(el("acNewCodeForm").hidden).toBe(true);
  });

  it("une adresse changée sur un autre appareil se voit en ouvrant Mon compte", async () => {
    const { store } = await connecte({ "GET compte": () => json({ ...detail(), email: NEUVE }) });
    expect(el("acMe").textContent).toBe(NEUVE);
    expect(store.account()!.email).toBe(NEUVE);
  });

  it("la réponse d'un autre compte ne remplace pas celui de l'appareil", async () => {
    const { store } = await connecte({ "GET compte": () => json({ ...detail(), id: "autre", email: NEUVE }) });
    expect(store.account()).toMatchObject({ id: COMPTE.id, email: COMPTE.email });
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

  it("sa passkey retirée, propose de déconnecter les autres appareils, et s'en tient à la réponse", async () => {
    const route = `DELETE passkeys/${encodeURIComponent(CLE.id)}`;
    const reste = () => json({ ...detail(), appareils: [ICI, LOIN, { ...LOIN, id: "loin2" }] });
    const { routes } = await connecte({ "GET compte": () => json(detail(CLE)), [route]: reste });
    await vi.waitFor(() => expect(el("acKeys").querySelector("button[data-key]")).not.toBeNull());
    vi.mocked(confirm).mockReturnValueOnce(true).mockReturnValueOnce(false);
    el("acKeys").querySelector<HTMLButtonElement>("button[data-key]")!.click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(vi.mocked(confirm).mock.lastCall![0]).toContain("vos 2 autres appareils");
    await settled();
    expect(routes()).not.toContain("DELETE sessions");
    expect(el("acDevices").querySelectorAll("button[data-device]")).toHaveLength(2);
  });

  it("sa passkey retirée, accepte de déconnecter les autres ; rien à proposer s'il n'y en a pas", async () => {
    const route = `DELETE passkeys/${encodeURIComponent(CLE.id)}`;
    const seul = await connecte({ "GET compte": () => json(detail(CLE)), [route]: () => json(detail()) });
    await vi.waitFor(() => expect(el("acKeys").querySelector("button[data-key]")).not.toBeNull());
    el("acKeys").querySelector<HTMLButtonElement>("button[data-key]")!.click();
    await vi.waitFor(() => expect(seul.routes()).toContain(route));
    await settled();
    expect(confirm).toHaveBeenCalledOnce();
    expect(seul.routes()).not.toContain("DELETE sessions");

    vi.mocked(confirm).mockClear();
    const { routes } = await connecte({
      "GET compte": () => json(detail(CLE)),
      [route]: () => json(avec(LOIN)),
      "DELETE sessions": () => json(detail()),
    });
    await vi.waitFor(() => expect(el("acKeys").querySelector("button[data-key]")).not.toBeNull());
    el("acKeys").querySelector<HTMLButtonElement>("button[data-key]")!.click();
    await vi.waitFor(() => expect(routes()).toContain("DELETE sessions"));
    expect(vi.mocked(confirm).mock.lastCall![0]).toContain("votre autre appareil");
    await vi.waitFor(() => expect(el("acDevices").querySelector("button[data-device]")).toBeNull());
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

describe("preuve récente", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  const demandee = () => json({ erreur: "Par sécurité, reconnectez-vous.", preuve: true }, 403);
  /** Répond « preuve demandée » une fois, comme le serveur à une session sans preuve, puis `ensuite`. */
  const uneFois = (ensuite: () => Response) => {
    let n = 0;
    return () => (n++ ? ensuite() : demandee());
  };
  async function supprimer(reponses: Record<string, () => Response>) {
    const d = await connecte({ "DELETE compte": uneFois(vide), ...reponses });
    el("acDelete").click();
    await vi.waitFor(() => expect(el("acDeleteBox").hidden).toBe(false));
    el("acDeleteYes").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acProof"]));
    await settled();
    return d;
  }

  it("sans passkey : ne propose que le code, dit où il part et à qui écrire sans cette adresse", async () => {
    const { routes } = await supprimer({});
    expect(el("acProofPk").hidden).toBe(true);
    expect(el("acProofMail").classList.contains("go")).toBe(true);
    expect(el("acProofTo").textContent).toBe(COMPTE.email);
    expect(el("acProof").querySelector<HTMLAnchorElement>("a[href^='mailto:']")).not.toBeNull();
    expect(enErreur()).toBe(false);
    // Rien ne part sans qu'on l'ait demandé.
    expect(routes()).not.toContain("POST preuve/code");
  });

  it("par code : le geste repart sur « Continuer », avec le choix fait pour cet appareil", async () => {
    const { store, appels, routes } = await connecte({ "DELETE compte": uneFois(vide) });
    await store.save(newProject("a", "Dupont", "complet", 1));
    el("acDelete").click();
    await vi.waitFor(() => expect(el("acDeleteBox").hidden).toBe(false));
    el<HTMLInputElement>("acWipe").checked = true;
    el("acDeleteYes").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acProof"]));

    el("acProofMail").click();
    await vi.waitFor(() => expect(el("acProofCodeForm").hidden).toBe(false));
    expect(msg().textContent).toContain("Code envoyé");
    el<HTMLInputElement>("acProofCode").value = "123 456";
    soumettre("acProofCodeForm");
    await vi.waitFor(() => expect(el("acProofDone").hidden).toBe(false));
    expect(appels).toContainEqual({ route: "POST preuve/code/verifier", corps: { code: "123 456" } });
    expect(routes().filter((r) => r === "DELETE compte")).toHaveLength(1);

    el("acProofGo").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(routes().filter((r) => r === "DELETE compte")).toHaveLength(2);
    expect(await store.list()).toEqual([]);
  });

  it("un mauvais code est dit, et on reste à le saisir", async () => {
    await supprimer({ "POST preuve/code/verifier": refus(400, "Code incorrect.") });
    el("acProofMail").click();
    await vi.waitFor(() => expect(el("acProofCodeForm").hidden).toBe(false));
    el<HTMLInputElement>("acProofCode").value = "00000000";
    soumettre("acProofCodeForm");
    await vi.waitFor(() => expect(msg().textContent).toBe("Code incorrect."));
    expect(enErreur()).toBe(true);
    expect(el("acProofCodeForm").hidden).toBe(false);
    expect(el("acProofDone").hidden).toBe(true);
  });

  it("avec une passkey : Face ID d'abord, et le code reste proposé", async () => {
    vi.stubGlobal("PublicKeyCredential", function () {});
    vi.mocked(webauthn.startAuthentication).mockResolvedValue({ id: "k" } as never);
    const { appels } = await supprimer({
      "GET compte": () => json(detail(CLE)),
      "POST preuve/passkey/options": () => json({ challenge: "x" }),
    });
    expect(el("acProofPk").hidden).toBe(false);
    expect(el("acProofPk").classList.contains("go")).toBe(true);
    expect(el("acProofMail").hidden).toBe(false);
    expect(el("acProofMail").classList.contains("go")).toBe(false);
    el("acProofPk").click();
    await vi.waitFor(() => expect(el("acProofDone").hidden).toBe(false));
    expect(appels).toContainEqual({ route: "POST preuve/passkey", corps: { reponse: { id: "k" } } });
    expect(webauthn.startAuthentication).toHaveBeenLastCalledWith({ optionsJSON: { challenge: "x" } });
  });

  it("Face ID annulé ou passkey refusée : le code reste la sortie", async () => {
    vi.stubGlobal("PublicKeyCredential", function () {});
    vi.mocked(webauthn.startAuthentication).mockRejectedValueOnce(
      Object.assign(new Error("annulé"), { name: "NotAllowedError" }),
    );
    await supprimer({
      "GET compte": () => json(detail(CLE)),
      "POST preuve/passkey/options": () => json({ challenge: "x" }),
      "POST preuve/passkey": refus(400, "La passkey n'a pas pu être vérifiée : demandez un code par e-mail."),
    });
    el("acProofPk").click();
    await settled();
    await settled();
    expect(enErreur()).toBe(false);
    expect(el("acProofAsk").hidden).toBe(false);

    vi.mocked(webauthn.startAuthentication).mockResolvedValue({ id: "k" } as never);
    el("acProofPk").click();
    await vi.waitFor(() => expect(msg().textContent).toContain("demandez un code"));
    expect(el("acProofMail").hidden).toBe(false);
    el("acProofMail").click();
    await vi.waitFor(() => expect(el("acProofCodeForm").hidden).toBe(false));
  });

  it("sans réseau pour lire le compte : le code reste proposé", async () => {
    vi.stubGlobal("PublicKeyCredential", function () {});
    await supprimer({ "GET compte": coupure });
    expect(el("acProofPk").hidden).toBe(true);
    expect(el("acProofMail").hidden).toBe(false);
  });

  it("« Annuler » revient là où on était, et le geste ne part pas", async () => {
    const { routes } = await supprimer({});
    el("acProofNo").click();
    expect(vue()).toEqual(["acAccount"]);
    expect(el("acDeleteBox").hidden).toBe(false);
    await settled();
    expect(routes().filter((r) => r === "DELETE compte")).toHaveLength(1);
  });

  it("une preuve de nouveau trop vieille au moment de continuer est redemandée", async () => {
    await supprimer({ "DELETE compte": demandee });
    el("acProofMail").click();
    await vi.waitFor(() => expect(el("acProofCodeForm").hidden).toBe(false));
    el<HTMLInputElement>("acProofCode").value = "12345678";
    soumettre("acProofCodeForm");
    await vi.waitFor(() => expect(el("acProofDone").hidden).toBe(false));
    el("acProofGo").click();
    await vi.waitFor(() => expect(el("acProofAsk").hidden).toBe(false));
    expect(vue()).toEqual(["acProof"]);
    el("acProofNo").click();
    expect(vue()).toEqual(["acAccount"]);
  });

  it("changer d'adresse : la demande repart après la preuve, à la même adresse", async () => {
    const { appels } = await connecte({ "POST compte/email/code": uneFois(vide) });
    el("acEmailChange").click();
    el<HTMLInputElement>("acNewEmail").value = "neuve@exemple.fr";
    soumettre("acNewEmailForm");
    await vi.waitFor(() => expect(vue()).toEqual(["acProof"]));
    el("acProofMail").click();
    await vi.waitFor(() => expect(el("acProofCodeForm").hidden).toBe(false));
    el<HTMLInputElement>("acProofCode").value = "12345678";
    soumettre("acProofCodeForm");
    await vi.waitFor(() => expect(el("acProofDone").hidden).toBe(false));
    el("acProofGo").click();
    await vi.waitFor(() => expect(el("acNewCodeForm").hidden).toBe(false));
    expect(vue()).toEqual(["acAccount"]);
    expect(appels.filter((a) => a.route === "POST compte/email/code").at(-1)?.corps).toEqual({
      email: "neuve@exemple.fr",
    });
  });

  it("ajouter une passkey : Face ID ne s'ouvre pas tout seul, seulement sur « Continuer »", async () => {
    vi.mocked(webauthn.startRegistration).mockClear();
    vi.mocked(webauthn.startRegistration).mockResolvedValue({ id: "r" } as never);
    await connecte({
      "POST passkey/ajout/options": uneFois(() => json({ challenge: "x" })),
      "POST passkey/ajout": () => json(detail(CLE)),
    });
    el("acAddKey").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acProof"]));
    el("acProofMail").click();
    await vi.waitFor(() => expect(el("acProofCodeForm").hidden).toBe(false));
    el<HTMLInputElement>("acProofCode").value = "12345678";
    soumettre("acProofCodeForm");
    await vi.waitFor(() => expect(el("acProofDone").hidden).toBe(false));
    await settled();
    expect(webauthn.startRegistration).not.toHaveBeenCalled();
    el("acProofGo").click();
    await vi.waitFor(() => expect(el("acKeys").querySelector("b")?.textContent).toBe("iPhone"));
    expect(vue()).toEqual(["acAccount"]);
  });

  it("l'offre restée ouverte trop longtemps : la preuve, puis retour à l'offre si on annule", async () => {
    vi.mocked(webauthn.platformAuthenticatorIsAvailable).mockResolvedValue(true);
    await auCode({ "POST code/verifier": () => json(COMPTE), "POST passkey/ajout/options": demandee });
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(vue()).toEqual(["acOffer"]));
    el("acOfferYes").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acProof"]));
    el("acProofNo").click();
    expect(vue()).toEqual(["acOffer"]);
  });

  it("déconnecté pendant la preuve : revient à la connexion", async () => {
    const { store } = await supprimer({ "POST preuve/code": () => new Response(null, { status: 401 }) });
    el("acProofMail").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect(store.account()).toBeNull();
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

describe("escaliers de l'appareil qui ne sont dans aucun compte", () => {
  const noms = () => [...el("acRetenusNoms").querySelectorAll("li")].map((li) => li.textContent);
  const ligne = () => el("saved");

  /** Déconnecté, quelqu'un dessine ces escaliers sans compte. */
  async function dessines(reponses: Record<string, () => Response>, ...escaliers: string[]) {
    const d = monter(reponses);
    await d.store.signIn(COMPTE);
    await d.store.signOut();
    for (const [i, nom] of escaliers.entries()) await d.store.save(newProject(`p${i}`, nom, "complet", i + 1));
    return d;
  }

  /** Puis une personne se connecte : la question est à l'écran. */
  async function question(...escaliers: string[]) {
    const d = await dessines({}, ...escaliers);
    await d.store.signIn(COMPTE);
    await d.panel.show();
    await vi.waitFor(() => expect(vue()).toEqual(["acRetenus"]));
    d.appels.length = 0;
    return d;
  }

  it("un seul : la question au singulier, avec son nom, et un seul bouton orange", async () => {
    await question("Dupont");
    expect(el("acRetenusTxt").textContent).toBe(
      "Un escalier de cet appareil n'est dans aucun compte. Il est peut-être à quelqu'un d'autre.",
    );
    expect(noms()).toEqual(["Dupont"]);
    expect(el("acRetenusNote").textContent).toBe(
      "Laissé ici, il reste à l'écart de votre compte, et la question reviendra à votre prochaine connexion.",
    );
    expect(el("acRetenusPrendre").textContent).toBe("Le mettre dans mon compte");
    expect(el("acRetenusLaisser").textContent).toBe("Le laisser sur cet appareil");
    expect(el("acRetenusEffacer").textContent).toBe("L'effacer");
    expect([...el("acRetenus").querySelectorAll(".btn.go")].map((b) => b.id)).toEqual(["acRetenusPrendre"]);
  });

  it("plusieurs : la question au pluriel, avec leurs noms", async () => {
    await question("Dupont", "Martin");
    expect(el("acRetenusTxt").textContent).toBe(
      "2 escaliers de cet appareil ne sont dans aucun compte. Ils sont peut-être à quelqu'un d'autre.",
    );
    // Le plus récent d'abord, comme dans Mes escaliers.
    expect(noms()).toEqual(["Martin", "Dupont"]);
    expect(el("acRetenusNote").textContent).toBe(
      "Laissés ici, ils restent à l'écart de votre compte, et la question reviendra à votre prochaine connexion.",
    );
    expect(el("acRetenusPrendre").textContent).toBe("Les mettre dans mon compte");
    expect(el("acRetenusLaisser").textContent).toBe("Les laisser sur cet appareil");
    expect(el("acRetenusEffacer").textContent).toBe("Les effacer");
  });

  it("un nom d'escalier reste du texte", async () => {
    await question("<img src=x onerror=alert(1)>");
    expect(el("acRetenusNoms").querySelector("img")).toBeNull();
    expect(noms()).toEqual(["<img src=x onerror=alert(1)>"]);
  });

  it("les mettre dans le compte : ils partent et se revoient, et le compte s'affiche", async () => {
    const { store, routes } = await question("Dupont");
    el("acRetenusPrendre").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
    expect(routes()).toContain("PUT projets");
    expect((await store.get("p0"))?.nom).toBe("Dupont");
    expect((await store.status()).aDecider).toEqual([]);
  });

  it("les laisser : rien ne part, ils restent cachés, et le compte s'affiche", async () => {
    const { store, routes } = await question("Dupont");
    el("acRetenusLaisser").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
    await store.sync();
    expect(routes()).not.toContain("PUT projets");
    expect(await store.get("p0")).toBeNull();
    expect((await store.status()).aDecider).toEqual([]);

    await store.signOut();
    await store.signIn(COMPTE);
    expect((await store.status()).aDecider).toEqual([{ id: "p0", nom: "Dupont" }]);
  });

  it("les effacer : le dit d'abord, et sans accord rien ne bouge", async () => {
    const { store } = await question("Dupont", "Martin");
    vi.mocked(confirm).mockReturnValueOnce(false);
    el("acRetenusEffacer").click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await settled();
    expect(vi.mocked(confirm).mock.calls[0]![0]).toContain("plus nulle part");
    expect(vi.mocked(confirm).mock.calls[0]![0]).toContain("2 escaliers");
    expect(vue()).toEqual(["acRetenus"]);
    expect((await store.status()).aDecider).toHaveLength(2);
  });

  it("les effacer, avec accord : plus rien sur l'appareil, rien d'envoyé", async () => {
    const { store, routes } = await question("Dupont");
    el("acRetenusEffacer").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
    expect(vi.mocked(confirm).mock.calls[0]![0]).toBe("Effacer cet escalier ? Il ne sera plus nulle part.");
    expect(routes()).not.toContain("PUT projets");
    await store.signOut();
    expect(await store.list()).toEqual([]);
  });

  it("l'en-tête le dit tant que la question attend, sans parler d'échec", async () => {
    const { store } = await question("Dupont");
    await vi.waitFor(() => expect(ligne().textContent).toBe("1 escalier attend votre réponse : voir Mon compte"));
    expect(ligne().classList.contains("ask")).toBe(true);
    expect(ligne().classList.contains("fail")).toBe(false);

    await store.takeRetained();
    await vi.waitFor(() => expect(ligne().textContent).toBe("Enregistré sur tous vos appareils"));
    expect(ligne().classList.contains("ask")).toBe(false);
  });

  it("l'en-tête au pluriel, même si un envoi a échoué", async () => {
    const d = await dessines({ "GET projets": refus(500, "Base indisponible.") }, "Dupont", "Martin");
    await d.store.signIn(COMPTE);
    await vi.waitFor(() => expect(ligne().textContent).toBe("2 escaliers attendent votre réponse : voir Mon compte"));
    expect(ligne().classList.contains("fail")).toBe(false);
  });

  it("revenir sur l'onglet repose la question tant qu'elle attend", async () => {
    const { panel } = await question("Dupont");
    await panel.show();
    await settled();
    expect(vue()).toEqual(["acRetenus"]);
  });

  it("après le code : pas de Face ID tant que la question attend, ni après la réponse", async () => {
    vi.mocked(webauthn.platformAuthenticatorIsAvailable).mockResolvedValue(true);
    const { panel } = await dessines({ "POST code/verifier": () => json(COMPTE) }, "Dupont");
    await ouvrir(panel);
    el<HTMLInputElement>("acEmail").value = "a@exemple.fr";
    soumettre("acEmailForm");
    await vi.waitFor(() => expect(el("acCodeForm").hidden).toBe(false));
    soumettre("acCodeForm");
    await vi.waitFor(() => expect(vue()).toEqual(["acRetenus"]));
    el("acRetenusLaisser").click();
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
  });

  it("répondu dans un autre onglet : l'écran suit", async () => {
    const { store } = await question("Dupont");
    store.leaveRetained();
    await vi.waitFor(() => expect(vue()).toEqual(["acAccount"]));
  });

  it("la session se perd pendant la question : retour à la connexion", async () => {
    const { store } = await question("Dupont");
    await store.sessionLost();
    await vi.waitFor(() => expect(vue()).toEqual(["acLogin"]));
    expect((await store.status()).aDecider).toEqual([]);
  });
});
