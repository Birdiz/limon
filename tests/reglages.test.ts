// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ATELIER_KEYS } from "../src/core/atelier";
import {
  BOOLEAN_KEYS,
  CLES,
  DEFAULTS,
  FORMES,
  NUMERIC_KEYS,
  TEXT_KEYS,
  cotesLues,
  etatReglage,
  reglage,
  type Params,
} from "../src/core/params";
import { COTE_LABEL } from "../src/core/summary";
import { AtelierPanel, AtelierStore } from "../src/ui/atelier";
import { syncInputs, writeInputs } from "../src/ui/settings";

/*
 * Catalogue des réglages (REGLAGES, src/core/params.ts) : le calcul, le formulaire du gabarit (app/index.html) et
 * Mon atelier en découlent. Le gabarit est écrit à la main : ces tests le tiennent d'accord avec le catalogue.
 */

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

/** Toutes les combinaisons des réglages dont dépendent les règles, sur les autres valeurs de l'exemple. */
function* combinaisons(cases: readonly (typeof BOOLEAN_KEYS)[number][] = BOOLEAN_KEYS): Generator<Params> {
  for (const forme of FORMES)
    for (const tournant of ["balance", "palier"] as const)
      for (const nez of ["arrondi", "casse"] as const)
        for (const tForme of ["rect", "L"] as const)
          for (const gc of ["aucun", "balustres"] as const)
            for (let bits = 0; bits < 1 << cases.length; bits++) {
              const p: Params = { ...DEFAULTS, forme, tournant, nez, tForme, gc };
              cases.forEach((k, i) => (p[k] = !!(bits & (1 << i))));
              yield p;
            }
}

/** Ce que montre un champ de réglage, pour comparer le gabarit, le catalogue et Mon atelier. */
function champ(el: HTMLElement) {
  const avance = !!el.closest("[data-adv]");
  if (el instanceof HTMLSelectElement)
    return { avance, options: [...el.options].map((o) => [o.value, o.textContent?.trim()]) };
  const i = el as HTMLInputElement;
  if (i.type === "checkbox") return { avance, mot: i.closest("label")?.textContent?.trim() };
  return {
    avance,
    curseur: i.type === "range",
    pas: Number(i.step),
    min: Number(i.min),
    max: i.max === "" ? undefined : Number(i.max),
    clavier: i.getAttribute("inputmode"),
    unite: i.nextElementSibling?.textContent ?? "",
  };
}

/** Le même, d'après le catalogue. */
function attendu(k: keyof Params) {
  const r = reglage(k);
  const avance = !!r.avance;
  if (r.valeurs) return { avance, options: r.valeurs.map((v) => [v, r.noms?.[v]]) };
  const s = r.saisie;
  if (!s) return { avance, mot: r.mot };
  return {
    avance,
    curseur: !!s.curseur,
    pas: s.pas,
    min: s.min,
    max: s.max,
    clavier: s.curseur ? null : s.pas < 1 ? "decimal" : "numeric",
    unite: s.sansUnite ? "" : "mm",
  };
}

describe("catalogue des réglages", () => {
  it("classe chaque réglage dans une seule des trois listes", () => {
    expect([...TEXT_KEYS, ...NUMERIC_KEYS, ...BOOLEAN_KEYS].sort()).toEqual([...CLES].sort());
  });

  it("nomme chaque réglage, d'un nom propre à chacun", () => {
    const noms = CLES.map((k) => COTE_LABEL[k]);
    expect(noms.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(noms).size).toBe(noms.length);
  });

  it("nomme chaque valeur des listes", () => {
    for (const k of TEXT_KEYS) {
      const { valeurs, noms } = reglage(k);
      expect(Object.keys(noms ?? {}), k).toEqual(valeurs);
    }
  });

  it(
    "ne relit que des cotes montrées et saisies, jamais celles que le calcul ramène dans leurs bornes",
    { timeout: 60_000 },
    () => {
      for (const p of combinaisons()) {
        for (const k of cotesLues(p)) {
          expect(reglage(k).ramene, k).toBeUndefined();
          expect(etatReglage(k, p), k).toEqual({ montre: true, mode: "saisi" });
        }
      }
    },
  );
});

describe("catalogue et gabarit", () => {
  beforeEach(() => {
    document.body.innerHTML = body;
    writeInputs(DEFAULTS);
  });

  const champs = () =>
    CLES.map((k) => [k, document.getElementById(k)] as const).filter(
      (c): c is readonly [keyof Params, HTMLInputElement] => c[1] !== null,
    );

  it("a un champ par réglage, avec la saisie, les options et le mot du catalogue", () => {
    // Sauf la forme, choisie par deux groupes de boutons (forme et sens), et la trémie à calculer, par deux boutons.
    expect(CLES.filter((k) => !champs().some(([c]) => c === k))).toEqual(["forme"]);
    for (const [k, el] of champs()) {
      if (k === "tAuto") continue;
      expect({ k, ...champ(el) }).toEqual({ k, ...attendu(k) });
    }
  });

  /** Visible à l'écran : aucun parent masqué, l'export CNC compté ouvert (il est replié au chargement). */
  const visible = (el: HTMLElement) => {
    for (let e: HTMLElement | null = el; e && e !== document.body; e = e.parentElement)
      if (e.hidden && e.id !== "cncBody") return false;
    return true;
  };

  it("montre, grise et calcule les champs comme le dit le catalogue", { timeout: 60_000 }, () => {
    // Les règles croisent la forme avec une seule case à la fois : toutes les cases ensemble suffisent, plus un
    // échantillon des cases mêlées sur deux formes.
    const essais = [
      ...[...combinaisons([])].flatMap((p) => [
        { ...p, ...Object.fromEntries(BOOLEAN_KEYS.map((k) => [k, false])) },
        { ...p, ...Object.fromEntries(BOOLEAN_KEYS.map((k) => [k, true])) },
      ]),
      ...[...combinaisons()].filter((p) => p.forme === "droit" || p.forme === "dq-g").filter((_, i) => i % 29 === 0),
    ];
    const ecarts: string[] = [];
    for (const p of essais) {
      syncInputs(p, null);
      for (const [k, el] of champs()) {
        const { montre, mode } = etatReglage(k, p);
        if (visible(el) !== montre || el.disabled !== (mode !== "saisi"))
          ecarts.push(`${k} (montré ${visible(el)}, grisé ${el.disabled}) avec ${JSON.stringify(p)}`);
      }
    }
    expect(ecarts.slice(0, 5)).toEqual([]);
  });

  it("a dans Mon atelier un champ par réglage du profil, pareil à celui de la colonne de réglages", () => {
    new AtelierPanel(new AtelierStore(null), { params: () => null, saved: () => {} });
    const ids = [...document.querySelectorAll<HTMLElement>("#atBody [id^=at-]")].map((el) => el.id.slice(3));
    expect([...ids].sort()).toEqual([...ATELIER_KEYS].sort());
    for (const k of ATELIER_KEYS)
      expect({ k, ...champ(document.getElementById(`at-${k}`)!) }).toEqual({ k, ...attendu(k) });
  });
});
