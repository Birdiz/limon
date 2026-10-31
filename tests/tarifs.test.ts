// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { atelierDefauts, newAtelier, sanitizeAtelier } from "../src/core/atelier";
import { DEFAULTS } from "../src/core/params";
import {
  ENTREPRISE_VIDE,
  TARIFS_VIDES,
  isEmptyEntreprise,
  isEmptyTarifs,
  sanitizeEntreprise,
  sanitizeTarifs,
  sirenOk,
} from "../src/core/tarifs";
import { AtelierPanel, AtelierStore } from "../src/ui/atelier";
import type { KeyValue } from "../src/ui/store";
import { TarifsPanel } from "../src/ui/tarifs";

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const change = (id: string, v: string) => {
  field(id).value = v;
  field(id).dispatchEvent(new Event("change", { bubbles: true }));
};

function memory(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("tarifs relus", () => {
  it("gardent les montants positifs et laissent vide tout le reste", () => {
    const t = sanitizeTarifs({
      taux: 45,
      perte: -3,
      coef: "1,2",
      finition: Number.NaN,
      livKm: 1e9,
      bois: { chene: 1800, sapin: "cher", acajou: 3000 },
      heures: { marche: 1.5, intrus: 2 },
    });
    expect([t.taux, t.perte, t.coef, t.finition, t.livKm]).toEqual([45, null, null, null, null]);
    expect(t.bois).toEqual({ ...TARIFS_VIDES.bois, chene: 1800 });
    expect(t.heures).toEqual({ ...TARIFS_VIDES.heures, marche: 1.5 });
    expect(sanitizeTarifs("abîmé")).toEqual(TARIFS_VIDES);
    expect(isEmptyTarifs(TARIFS_VIDES)).toBe(true);
    expect(isEmptyTarifs({ ...TARIFS_VIDES, taux: 0 })).toBe(false);
  });

  it("une fiche d'entreprise relue ne garde que du texte, sans espaces de bord, coupé s'il est trop long", () => {
    const e = sanitizeEntreprise({ nom: "  Menuiserie Exemple ", siren: 123, adresse: "x".repeat(3000), intrus: "?" });
    expect(e.nom).toBe("Menuiserie Exemple");
    expect(e.siren).toBe("");
    expect(e.adresse).toHaveLength(2000);
    expect(Object.keys(e).sort()).toEqual(Object.keys(ENTREPRISE_VIDE).sort());
    expect(isEmptyEntreprise(sanitizeEntreprise(null))).toBe(true);
  });

  it("vérifie la clé d'un SIREN", () => {
    expect(sirenOk("123 456 782")).toBe(true);
    expect(sirenOk("123456789")).toBe(false);
    expect(sirenOk("12345678")).toBe(false);
    expect(sirenOk("12345678A")).toBe(false);
  });

  it("un profil d'avant les devis revient sans tarifs ni fiche", () => {
    expect(sanitizeAtelier({ defauts: { ess: "noyer" }, modifie: 4 })).toEqual(
      newAtelier({ ...atelierDefauts(DEFAULTS), ess: "noyer" }, 4),
    );
  });
});

describe("profil de l'atelier, par parties", () => {
  it("garde les tarifs quand les réglages changent, et l'inverse", () => {
    const a = new AtelierStore(memory());
    a.set({ tarifs: { ...TARIFS_VIDES, taux: 45 } }, 1);
    expect(a.get()!.defauts).toEqual(atelierDefauts(DEFAULTS));
    a.set({ defauts: { ...atelierDefauts(DEFAULTS), ess: "noyer" } }, 2);
    a.set({ entreprise: { ...ENTREPRISE_VIDE, nom: "Exemple" } }, 3);
    expect(a.get()).toMatchObject({ defauts: { ess: "noyer" }, tarifs: { taux: 45 }, entreprise: { nom: "Exemple" } });
    expect(a.get()!.modifie).toBe(3);
  });
});

describe("tarifs et entreprise dans Mon atelier", () => {
  let store: AtelierStore;
  let saved: number;

  beforeEach(() => {
    document.body.innerHTML = body;
    store = new AtelierStore(memory());
    saved = 0;
    const host = { params: () => ({ ...DEFAULTS, ess: "noyer" as const }), saved: () => saved++ };
    new AtelierPanel(store, host);
    new TarifsPanel(store, host);
  });

  it("sont vides tant que rien n'est saisi", () => {
    expect(field("tf-taux").value).toBe("");
    expect(field("tf-bois-chene").value).toBe("");
    expect(field("te-nom").value).toBe("");
  });

  it("enregistrent un montant, et un champ vidé reste vide", () => {
    change("tf-taux", "45");
    change("tf-heures-balancee", "2.5");
    change("tf-bois-noyer", "4200");
    expect(store.get()!.tarifs).toMatchObject({ taux: 45, heures: { balancee: 2.5 }, bois: { noyer: 4200 } });
    expect(saved).toBe(3);
    change("tf-taux", "");
    expect(store.get()!.tarifs.taux).toBeNull();
  });

  it("enregistrent la fiche de l'entreprise", () => {
    change("te-nom", " Menuiserie Exemple ");
    change("te-dechets", "Déchets triés et portés en déchetterie.");
    expect(store.get()!.entreprise).toMatchObject({
      nom: "Menuiserie Exemple",
      dechets: "Déchets triés et portés en déchetterie.",
    });
  });

  it("signalent un SIREN mal tapé sans le refuser", () => {
    change("te-siren", "123 456 789");
    expect(store.get()!.entreprise.siren).toBe("123 456 789");
    expect(field("te-siren").getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector("#te-siren + .fielderr")).not.toBeNull();
    change("te-siren", "123 456 782");
    expect(field("te-siren").hasAttribute("aria-invalid")).toBe(false);
    expect(document.querySelector("#te-siren + .fielderr")).toBeNull();
  });

  it("restent quand on revient aux réglages de l'exemple", () => {
    change("tf-taux", "45");
    document.getElementById("atReset")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(store.get()!.tarifs.taux).toBe(45);
    expect(field("tf-taux").value).toBe("45");
  });

  it("sont masqués sans l'option des devis", () => {
    expect(document.getElementById("atDevis")!.hasAttribute("data-devis")).toBe(true);
  });
});
