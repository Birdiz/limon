// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ATELIER_KEYS, atelierDefauts, atelierParams, isDefaultAtelier, sanitizeAtelier } from "../src/core/atelier";
import { DEFAULTS } from "../src/core/params";
import { AtelierPanel, AtelierStore } from "../src/ui/atelier";
import type { KeyValue } from "../src/ui/store";

const html = fs.readFileSync(path.resolve("index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

function memory(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("réglages de l'atelier", () => {
  it("ne garde que les habitudes, pas les cotes du chantier", () => {
    const d = atelierDefauts({ ...DEFAULTS, H: 3200, W: 1000, ess: "noyer" });
    expect(Object.keys(d).sort()).toEqual([...ATELIER_KEYS].sort());
    expect(d.ess).toBe("noyer");
  });

  it("donne les réglages d'un nouvel escalier : l'atelier d'abord, l'exemple pour le reste", () => {
    const p = atelierParams({ defauts: { ...atelierDefauts(DEFAULTS), ess: "sapin", el: 60 }, modifie: 1 });
    expect([p.ess, p.el]).toEqual(["sapin", 60]);
    expect([p.H, p.A, p.B, p.W]).toEqual([DEFAULTS.H, DEFAULTS.A, DEFAULTS.B, DEFAULTS.W]);
    expect(atelierParams(null)).toEqual(DEFAULTS);
  });

  it("reconnaît un profil qui ne dit rien de plus que l'exemple", () => {
    expect(isDefaultAtelier(atelierDefauts(DEFAULTS))).toBe(true);
    expect(isDefaultAtelier({ ...atelierDefauts(DEFAULTS), et: 41 })).toBe(false);
  });

  it("nettoie un profil relu, et refuse celui qui n'a pas de date", () => {
    expect(sanitizeAtelier({ defauts: { ess: "hetre", et: "épais" }, modifie: 7.4 })).toEqual({
      defauts: { ...atelierDefauts(DEFAULTS), ess: "hetre" },
      modifie: 7,
    });
    expect(sanitizeAtelier({ defauts: { ess: "hetre" } })).toBeNull();
    expect(sanitizeAtelier(null)).toBeNull();
  });
});

describe("profil gardé sur l'appareil", () => {
  it("se relit, et quitte l'appareil quand on le vide", () => {
    const storage = memory();
    const a = new AtelierStore(storage);
    expect(a.get()).toBeNull();
    a.set({ ...atelierDefauts(DEFAULTS), ess: "frene" }, 1000);
    expect(new AtelierStore(storage).get()).toEqual({
      defauts: { ...atelierDefauts(DEFAULTS), ess: "frene" },
      modifie: 1000,
    });
    a.clear();
    expect(new AtelierStore(storage).get()).toBeNull();
  });
});

describe("Mon atelier dans le dialogue du compte", () => {
  let store: AtelierStore;
  let saved: number;
  let panel: AtelierPanel;

  beforeEach(() => {
    document.body.innerHTML = body;
    store = new AtelierStore(memory());
    saved = 0;
    panel = new AtelierPanel(store, { params: () => ({ ...DEFAULTS, ess: "noyer", et: 45 }), saved: () => saved++ });
  });

  it("montre les réglages de l'exemple tant qu'il n'y a pas de profil", () => {
    expect(field("at-et").value).toBe("40");
    expect(field("at-ess").value).toBe("chene");
    expect(field("at-cm").checked).toBe(true);
    expect(document.getElementById("atSum")!.textContent).toBe("comme l'exemple");
  });

  it("enregistre un champ modifié et annonce qu'il faut l'envoyer", () => {
    field("at-el").value = "60";
    field("at-el").dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.get()!.defauts.el).toBe(60);
    expect(saved).toBe(1);
    expect(document.getElementById("atSum")!.textContent).toBe("chêne, marches de 40 mm, limons de 60 mm");
  });

  it("garde un champ vide à sa valeur enregistrée", () => {
    field("at-et").value = "";
    field("at-et").dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.get()!.defauts.et).toBe(DEFAULTS.et);
  });

  it("reprend les réglages de l'escalier ouvert", () => {
    panel.keep();
    expect(store.get()!.defauts).toEqual({ ...atelierDefauts(DEFAULTS), ess: "noyer", et: 45 });
    expect(field("at-ess").value).toBe("noyer");
    expect(document.getElementById("atMsg")!.hidden).toBe(false);
  });

  it("revient à l'exemple", () => {
    panel.keep();
    document.getElementById("atReset")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isDefaultAtelier(store.get()!.defauts)).toBe(true);
    expect(field("at-ess").value).toBe("chene");
  });
});
