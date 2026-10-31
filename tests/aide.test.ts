// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIDE, aideOf, type AideKey } from "../src/core/aide";
import { DEFAULTS } from "../src/core/params";
import { BOIS_SOUS_LOGEMENT } from "../src/core/pockets";
import { GC } from "../src/core/railing";
import { CONFORT, ECHAPPEE, ECHAPPEE_MIN, comfortStatus } from "../src/core/stair";
import { AIDE_ZONES, Aide, aideBlocks, aideKey } from "../src/ui/aide";
import { AtelierPanel, AtelierStore } from "../src/ui/atelier";
import type { KeyValue } from "../src/ui/store";

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

function memory(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** Page de l'outil avec les lignes de Mon atelier, créées par leur panneau. */
function page(): void {
  document.body.innerHTML = body;
  new AtelierPanel(new AtelierStore(memory()), { params: () => null, saved: () => {} });
}

/** Champs de réglage de la page : tout ce qui se saisit dans les zones de réglage. */
const controls = () =>
  [...document.querySelectorAll(AIDE_ZONES)].flatMap((z) => [
    ...z.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=file]), select"),
  ]);

const btn = (key: string) => document.querySelector<HTMLButtonElement>(`.aidebtn[data-key="${key}"]`)!;
const box = () => document.getElementById("aide")!;
const isOpen = () => !!document.getElementById("aide") && !box().hidden;

/** Nombres d'un texte, séparateurs de milliers retirés. */
const nums = (s: string | undefined) =>
  (s?.match(/\d[\d\u202f]*(,\d+)?/g) ?? []).map((t) => parseFloat(t.replace(/\u202f/g, "").replace(",", ".")));

let aide: Aide;
beforeAll(() => {
  aide = new Aide(() => "quart-d");
});
beforeEach(() => {
  aide.close(false);
  page();
  aide.attach();
});

describe("chaque champ de réglage a son aide", () => {
  // Un champ ajouté sans texte dans src/core/aide.ts fait échouer ce test.
  it("dans app/index.html et Mon atelier", () => {
    const list = controls();
    expect(list.length).toBeGreaterThan(50);
    const sans = list.filter((el) => {
      const block = el.closest(".row, [role=radiogroup]");
      const key = block && aideKey(block);
      return !key || !aideOf(key);
    });
    expect(sans.map((el) => el.id || el.getAttribute("name"))).toEqual([]);
  });

  it("avec un bouton par ligne et par groupe de choix, posé une seule fois", () => {
    aide.attach();
    const blocks = [...document.querySelectorAll(AIDE_ZONES)].flatMap(aideBlocks);
    for (const b of blocks) {
      const own = b.matches("[role=radiogroup]") ? b.previousElementSibling : b.querySelector(".aidebtn");
      expect(own?.matches(".aidebtn"), aideKey(b) ?? "?").toBe(true);
    }
    expect(document.querySelectorAll(".aidebtn")).toHaveLength(blocks.length);
  });

  it("et aucun texte ne reste sans champ", () => {
    const keys = new Set(
      [...document.querySelectorAll(AIDE_ZONES)].flatMap(aideBlocks).map((b) => aideKey(b)!.replace(/^at-/, "")),
    );
    expect(Object.keys(AIDE).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("nomme le bouton d'après l'intitulé du champ", () => {
    expect(btn("H").getAttribute("aria-label")).toBe("Aide : Hauteur à monter");
    expect(btn("forme").getAttribute("aria-label")).toBe("Aide : Forme de l'escalier");
    expect(btn("tAuto").nextElementSibling!.matches("[role=radiogroup]")).toBe(true);
    expect(btn("at-et").getAttribute("aria-label")).toBe("Aide : Épaisseur de marche");
  });
});

describe("bulle d'aide", () => {
  it("s'ouvre sous la ligne du champ et se referme par le même bouton", () => {
    btn("H").click();
    expect(isOpen()).toBe(true);
    expect(btn("H").getAttribute("aria-expanded")).toBe("true");
    expect(btn("H").getAttribute("aria-controls")).toBe("aide");
    expect(btn("H").closest(".row")!.nextElementSibling).toBe(box());
    expect(box().textContent).toContain(AIDE.H!.texte);
    expect(box().textContent).toContain(AIDE.H!.conseil);
    expect(box().querySelector("svg")).not.toBeNull();

    btn("H").click();
    expect(isOpen()).toBe(false);
    expect(btn("H").getAttribute("aria-expanded")).toBe("false");
  });

  it("une seule à la fois", () => {
    btn("H").click();
    btn("W").click();
    expect(btn("H").getAttribute("aria-expanded")).toBe("false");
    expect(btn("W").getAttribute("aria-expanded")).toBe("true");
    expect(box().textContent).toContain(AIDE.W!.texte);
    expect(document.querySelectorAll(".aide")).toHaveLength(1);
  });

  it("se ferme par Échap, seule, et rend le focus au bouton", () => {
    document.getElementById("home")!.hidden = document.getElementById("dpAt")!.hidden = false;
    btn("at-et").click();
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.getElementById("dpAt")!.dispatchEvent(e);
    expect(isOpen()).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(btn("at-et"));
  });

  it("se ferme en touchant ailleurs, pas en touchant la bulle", () => {
    btn("ep").click();
    box().querySelector("p")!.click();
    expect(isOpen()).toBe(true);
    document.querySelector<HTMLElement>("label[for=H]")!.click();
    expect(isOpen()).toBe(false);
  });

  it("se ferme par « × »", () => {
    btn("forme").click();
    expect(btn("forme").nextElementSibling).toBe(box());
    box().querySelector<HTMLButtonElement>(".aidex")!.click();
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(btn("forme"));
  });

  it("n'insère pas de HTML venu des textes", () => {
    btn("n").click();
    expect(box().querySelectorAll("p")).toHaveLength(2);
    expect(box().querySelector(".conseil")!.textContent).toBe(AIDE.n!.conseil);
  });
});

describe("valeurs conseillées", () => {
  // Les chiffres de l'aide sont ceux qui font passer les contrôles de « Bon » à « Limite ».
  it("hauteur de marche", () => {
    const [min, max] = nums(AIDE.H!.conseil) as [number, number];
    expect([min, max]).toEqual([CONFORT.h.min, CONFORT.h.max]);
    expect(comfortStatus(min, 270).h).toBe("ok");
    expect(comfortStatus(min - 0.1, 270).h).toBe("warn");
    expect(comfortStatus(max, 270).h).toBe("ok");
    expect(comfortStatus(max + 0.1, 270).h).toBe("warn");
  });

  it("giron", () => {
    const [min, max] = nums(AIDE.L!.conseil) as [number, number];
    expect(comfortStatus(170, min).g).toBe("ok");
    expect(comfortStatus(170, min - 0.1).g).toBe("warn");
    expect(comfortStatus(170, max).g).toBe("ok");
    expect(comfortStatus(170, max + 0.1).g).toBe("warn");
    for (const k of ["A", "B", "f"] as AideKey[]) expect(AIDE[k]!.conseil).toBe(AIDE.L!.conseil);
  });

  it("loi de Blondel", () => {
    const [min, max, cible] = nums(AIDE.n!.conseil).slice(-3);
    expect(cible).toBe(CONFORT.blondel.cible);
    const h = 170;
    expect(comfortStatus(h, min! - 2 * h).bl).toBe("ok");
    expect(comfortStatus(h, min! - 2 * h - 0.1).bl).toBe("warn");
    expect(comfortStatus(h, max! - 2 * h).bl).toBe("ok");
    expect(comfortStatus(h, max! - 2 * h + 0.1).bl).toBe("warn");
  });

  it("échappée, giron au jour, limons et garde-corps", () => {
    expect(nums(AIDE.tAuto!.conseil)).toEqual([ECHAPPEE, ECHAPPEE_MIN]);
    expect(nums(AIDE.mb!.conseil)).toEqual([CONFORT.gIn.min]);
    expect(nums(AIDE.hl!.conseil)).toEqual([BOIS_SOUS_LOGEMENT]);
    expect(nums(AIDE.gc!.conseil)).toEqual([GC.h, GC.ecart]);
  });

  it("épaisseurs courantes : celles de l'exemple", () => {
    for (const k of ["et", "deb", "rn", "ecm", "el", "enc", "jeu"] as const)
      expect(nums(AIDE[k]!.conseil), k).toEqual([DEFAULTS[k]]);
  });
});
