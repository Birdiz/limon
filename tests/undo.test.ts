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

  it("laisse Ctrl+Z au nom de l'escalier et aux dialogues", () => {
    type("H", "2800");
    const e = key("z", {}, field("pjName"));
    expect(e.defaultPrevented).toBe(false);
    expect(field("H").value).toBe("2800");

    const dlg = document.getElementById("compte")!;
    dlg.setAttribute("open", "");
    expect(key("z").defaultPrevented).toBe(false);
    dlg.removeAttribute("open");
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
