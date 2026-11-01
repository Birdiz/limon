// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { newProject, type Project } from "../src/core/project";

// La page entière, sans la 3D (pas de WebGL dans jsdom).
vi.mock("../src/ui/scene3d", () => ({
  Scene3D: class {
    draw() {}
    showError() {}
    applyTheme() {}
  },
}));

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
let now = 0;

/** Frappe d'une valeur dans un champ, caractère par caractère, 150 ms entre deux touches. */
function type(id: string, value: string): void {
  const el = field(id);
  el.focus();
  for (let i = 1; i <= value.length; i++) {
    now += 150;
    el.value = value.slice(0, i);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function key(k: string, mods: KeyboardEventInit = {}, target: Element = document.body): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(e);
  return e;
}
/** Projet ouvert tel qu'enregistré sur l'appareil. */
function saved(): Project {
  const all = JSON.parse(localStorage.getItem("limon-projets")!) as Project[];
  return all.find((p) => p.id === localStorage.getItem("limon-courant"))!;
}
const pause = () => (now += 5000);
const homeOn = () => document.body.classList.contains("home-on");
/** Les escaliers de l'appareil remplacés comme par un autre onglet, seule source d'échange sans serveur. */
function received(change: (all: Project[]) => Project[]): void {
  const all = JSON.parse(localStorage.getItem("limon-projets")!) as Project[];
  localStorage.setItem("limon-projets", JSON.stringify(change(all)));
  window.dispatchEvent(new StorageEvent("storage", { key: "limon-projets" }));
}
/** Une version plus récente de l'escalier ouvert arrive, avec une hauteur de 2800 mm. */
async function newerVersion(): Promise<void> {
  const id = saved().id;
  pause();
  received((all) => all.map((p) => (p.id === id ? { ...p, params: { ...p.params, H: 2800 }, modifie: now } : p)));
  await vi.waitFor(() => expect(field("H").value).toBe("2800"));
}
/** Ouvre l'accueil sur un onglet, avec un réglage à annuler sur l'escalier ouvert. */
async function homeOnTab(tab: string): Promise<void> {
  type("W", "900");
  expect(button("undo").disabled).toBe(false);
  button("pjOpen").click();
  await vi.waitFor(() => expect(homeOn()).toBe(true));
  button(tab).click();
  await vi.waitFor(() => expect(button(tab).getAttribute("aria-selected")).toBe("true"));
}

beforeAll(async () => {
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
    },
  );
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 401 })));
  // Calcul immédiat : la page attend sinon l'image suivante.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 0));
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
  vi.spyOn(Date, "now").mockImplementation(() => now);
  localStorage.clear();
  await import("../src/main");
  // Aucun escalier sur l'appareil : l'accueil, puis un nouvel escalier.
  await vi.waitFor(() => expect(document.body.classList.contains("home-on")).toBe(true));
});

/** Nouvel escalier, ouvert une fois enregistré comme escalier courant. */
async function startNew(): Promise<void> {
  const before = localStorage.getItem("limon-courant");
  pause();
  button("pjNew").click();
  await vi.waitFor(() => expect(localStorage.getItem("limon-courant")).not.toBe(before));
  expect(document.body.classList.contains("home-on")).toBe(false);
}
beforeEach(startNew);

describe("annuler et rétablir", () => {
  it("n'a rien à faire sur un escalier qu'on vient d'ouvrir", () => {
    expect(button("undo").disabled).toBe(true);
    expect(button("redo").disabled).toBe(true);
    expect(document.getElementById("undoBox")!.classList.contains("idle")).toBe(true);
  });

  it("annule une frappe continue d'un coup, puis la rétablit", () => {
    const before = saved();
    type("H", "2800");
    expect(button("undo").disabled).toBe(false);
    expect(document.getElementById("undoBox")!.classList.contains("idle")).toBe(false);
    expect(saved().params.H).toBe(2800);

    pause();
    button("undo").click();
    expect(field("H").value).toBe(String(DEFAULTS.H));
    expect(button("undo").disabled).toBe(true);
    expect(button("redo").disabled).toBe(false);
    // Enregistré comme toute modification.
    expect(saved().params).toEqual(before.params);
    expect(saved().modifie).toBeGreaterThan(before.modifie);

    button("redo").click();
    expect(field("H").value).toBe("2800");
    expect(saved().params.H).toBe(2800);
    expect(button("redo").disabled).toBe(true);
  });

  it("répond à Ctrl+Z, Cmd+Z, Ctrl+Maj+Z et Ctrl+Y", () => {
    type("H", "2800");
    pause();
    type("W", "900");
    pause();

    expect(key("z").defaultPrevented).toBe(true);
    expect(field("W").value).toBe(String(DEFAULTS.W));
    expect(key("z", { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
    expect(field("H").value).toBe(String(DEFAULTS.H));
    expect(key("Z", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(field("H").value).toBe("2800");
    key("y");
    expect(field("W").value).toBe("900");
    expect(button("redo").disabled).toBe(true);
  });

  it("annule dans un champ de réglage la frappe en cours", () => {
    type("H", "2800");
    pause();
    const el = field("H");
    el.focus();
    el.value = "29";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    expect(key("z", {}, el).defaultPrevented).toBe(true);
    expect(el.value).toBe("2800");
    expect(key("z", {}, el).defaultPrevented).toBe(true);
    expect(el.value).toBe(String(DEFAULTS.H));
  });

  it("laisse Ctrl+Z au nom de l'escalier et à l'accueil", () => {
    type("H", "2800");
    const e = key("z", {}, field("pjName"));
    expect(e.defaultPrevented).toBe(false);
    expect(field("H").value).toBe("2800");

    document.body.classList.add("home-on");
    expect(key("z").defaultPrevented).toBe(false);
    document.body.classList.remove("home-on");
    expect(field("H").value).toBe("2800");

    // Sans Ctrl ni Cmd, ou avec Alt : rien.
    expect(key("z", { ctrlKey: false }).defaultPrevented).toBe(false);
    expect(key("z", { altKey: true }).defaultPrevented).toBe(false);
    expect(field("H").value).toBe("2800");
  });

  it("compte une correction proposée et le retour à l'exemple comme une étape", () => {
    type("hl", "200");
    pause();
    const fix = document.querySelector<HTMLButtonElement>("#notes button[data-fix]")!;
    expect(fix).not.toBeNull();
    fix.click();
    const fixed = Number(field("hl").value);
    expect(fixed).toBeGreaterThan(200);

    pause();
    type("H", "3000");
    button("reset").click();
    expect(field("H").value).toBe(String(DEFAULTS.H));
    expect(field("hl").value).toBe(String(DEFAULTS.hl));

    button("undo").click();
    expect([field("H").value, field("hl").value]).toEqual(["3000", String(fixed)]);
    button("undo").click();
    expect([field("H").value, field("hl").value]).toEqual([String(DEFAULTS.H), String(fixed)]);
    button("undo").click();
    expect(field("hl").value).toBe("200");
    button("undo").click();
    expect(field("hl").value).toBe(String(DEFAULTS.hl));
    expect(button("undo").disabled).toBe(true);
  });

  it("perd ce qui restait à rétablir après un nouveau réglage", () => {
    type("H", "2800");
    pause();
    button("undo").click();
    expect(button("redo").disabled).toBe(false);
    type("W", "900");
    expect(button("redo").disabled).toBe(true);
    expect(key("Z", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(field("W").value).toBe("900");
  });

  it("vide l'historique en changeant d'escalier", async () => {
    type("H", "2800");
    pause();
    button("undo").click();
    type("W", "900");
    expect(button("undo").disabled).toBe(false);

    await startNew();
    expect(field("W").value).toBe(String(DEFAULTS.W));
    expect(button("undo").disabled).toBe(true);
    expect(button("redo").disabled).toBe(true);
    key("z");
    expect(field("W").value).toBe(String(DEFAULTS.W));
  });

  it("ne garde l'historique ni sur l'appareil ni dans le projet", () => {
    const keys = Object.keys(localStorage).sort();
    type("H", "2800");
    pause();
    type("W", "900");
    expect(Object.keys(localStorage).sort()).toEqual(keys);
    expect(Object.keys(saved()).sort()).toEqual(Object.keys(newProject("x", "", "guide", 0, DEFAULTS)).sort());
  });
});

describe("échange avec un autre appareil ou un autre onglet", () => {
  it("laisse l'accueil ouvert et met l'escalier à jour derrière", async () => {
    await homeOnTab("dtAt");
    const typing = field("at-et");
    typing.value = "31";

    await newerVersion();
    expect(homeOn()).toBe(true);
    expect(document.getElementById("dpAt")!.hidden).toBe(false);
    // La saisie en cours dans Mon atelier reste.
    expect(typing.value).toBe("31");

    button("homeBack").click();
    expect(homeOn()).toBe(false);
    expect(field("H").value).toBe("2800");
    expect(saved().params.H).toBe(2800);
  });

  it("n'ajoute pas d'étape : l'historique ne propose plus les anciennes copies", async () => {
    await homeOnTab("dtEsc");
    await newerVersion();
    button("homeBack").click();
    expect(button("undo").disabled).toBe(true);
    expect(button("redo").disabled).toBe(true);
    key("z");
    expect(field("H").value).toBe("2800");
    expect(field("W").value).toBe("900");
  });

  it("laisse ouverts les fichiers pour la machine", async () => {
    button("cncOpen").click();
    expect(field("cncBody").hidden).toBe(false);
    await newerVersion();
    expect(field("cncBody").hidden).toBe(false);
    expect(button("cncOpen").hidden).toBe(true);
  });

  it("garde l'accueil quand l'escalier ouvert est supprimé ailleurs, et passe au suivant", async () => {
    await newerVersion();
    const gone = saved().id;
    button("cncOpen").click();
    await homeOnTab("dtAt");
    received((all) => all.filter((p) => p.id !== gone));
    await vi.waitFor(() => expect(localStorage.getItem("limon-courant")).not.toBe(gone));

    expect(homeOn()).toBe(true);
    expect(document.getElementById("dpAt")!.hidden).toBe(false);
    expect(document.getElementById("homeBack")!.hidden).toBe(false);
    // Un autre escalier : les fichiers de celui d'avant se replient, son historique disparaît.
    expect(field("cncBody").hidden).toBe(true);
    button("homeBack").click();
    expect(button("undo").disabled).toBe(true);
  });

  it("reste sur l'onglet quand il ne reste plus aucun escalier", async () => {
    await homeOnTab("dtAt");
    expect(button("atTake").disabled).toBe(false);
    received(() => []);
    await vi.waitFor(() => expect(button("atTake").disabled).toBe(true));
    expect(homeOn()).toBe(true);
    expect(document.getElementById("dpAt")!.hidden).toBe(false);
    await vi.waitFor(() => expect(document.getElementById("homeBack")!.hidden).toBe(true));
  });

  it("n'empêche pas une carte de fermer l'accueil et de replier les fichiers", async () => {
    await startNew();
    button("cncOpen").click();
    await homeOnTab("dtEsc");
    await newerVersion();
    expect(field("cncBody").hidden).toBe(false);

    const card = document.querySelector<HTMLElement>('#homeDraft button[data-act="open"]')!;
    card.click();
    await vi.waitFor(() => expect(homeOn()).toBe(false));
    expect(field("cncBody").hidden).toBe(true);
    expect(button("cncOpen").hidden).toBe(false);
  });
});
