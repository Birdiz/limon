// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ATELIER_KEYS } from "../src/core/atelier";
import {
  BOOLEAN_KEYS,
  CLES,
  DEFAULTS,
  FORMES,
  NUMERIC_KEYS,
  TEXT_KEYS,
  TOURS,
  anglaise,
  cotesLues,
  etatReglage,
  isDemi,
  type NumericKey,
  type Params,
} from "../src/core/params";
import { COTE_LABEL } from "../src/core/summary";
import { syncInputs, writeInputs } from "../src/ui/settings";

/*
 * Catalogue des réglages (REGLAGES, src/core/params.ts) : il remplace des règles écrites à plusieurs endroits.
 * Les règles d'avant sont figées ici, le temps de la migration, pour montrer qu'il les redonne à l'identique.
 */

/** `cotesLues` de src/core/stair.ts avant le catalogue. */
function cotesLuesAvant(p: Params, tours: number): NumericKey[] {
  return [
    "H",
    "W",
    "et",
    "deb",
    "rn",
    "el",
    "hl",
    "ep",
    "enc",
    "jeu",
    "pL",
    "pW",
    ...(tours ? ["A", "B", "ps"] : ["L"]),
    ...(tours === 2 ? [isDemi(p.forme) ? "J" : "C"] : []),
    ...(p.cm ? ["ecm", "cmEmb"] : []),
    ...(p.rai ? ["raiN", "raiL", "raiP", "raiD", "raiE"] : []),
    ...(anglaise(p) ? ["debJ"] : []),
    ...(p.fAuto ? [] : ["f"]),
    ...(tours && !p.hljAuto ? ["hlj"] : []),
    ...(p.tAuto ? [] : tours ? ["tX", "tY", ...(p.tForme === "L" ? ["tbD", "tbA"] : [])] : ["tL"]),
    ...(p.gc === "aucun" ? [] : ["bs", "mcL", "mcH"]),
    ...(p.mp ? ["mpP", "mpE"] : []),
  ] as NumericKey[];
}

const DEFAULTS_AVANT = {
  forme: "quart-d",
  H: 2700,
  L: 3650,
  A: 2900,
  B: 1800,
  C: 2400,
  J: 200,
  W: 850,
  fAuto: true,
  f: 425,
  nAuto: true,
  n: 15,
  mb: 7,
  prog: 60,
  tournant: "balance",
  ess: "chene",
  et: 40,
  deb: 30,
  rn: 10,
  nez: "arrondi",
  rai: false,
  raiN: 2,
  raiL: 6,
  raiP: 3,
  raiD: 25,
  raiE: 15,
  cm: true,
  ecm: 22,
  cmPose: "sur",
  cmEmb: 0,
  mdeb: false,
  debJ: 30,
  el: 45,
  hl: 340,
  hljAuto: true,
  hlj: 470,
  tAuto: false,
  ps: 100,
  gc: "aucun",
  gcPose: "chant",
  mcL: 50,
  mcH: 70,
  bs: 30,
  tL: 3200,
  tX: 1845,
  tY: 2550,
  tForme: "rect",
  tbD: 950,
  tbA: 950,
  mp: false,
  mpP: 300,
  mpE: 40,
  ep: 200,
  enc: 15,
  jeu: 0.5,
  pL: 5000,
  pW: 600,
};

const ATELIER_AVANT = [
  "ess",
  "et",
  "deb",
  "rn",
  "nez",
  "rai",
  "raiN",
  "raiL",
  "raiP",
  "raiD",
  "raiE",
  "cm",
  "ecm",
  "cmPose",
  "cmEmb",
  "mdeb",
  "debJ",
  "el",
  "hl",
  "hljAuto",
  "ps",
  "enc",
  "jeu",
  "pL",
  "pW",
  "gc",
  "gcPose",
  "mcL",
  "mcH",
  "bs",
  "mp",
  "mpP",
  "mpE",
];

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

describe("catalogue des réglages", () => {
  it("redonne les valeurs de l'exemple, dans le même ordre", () => {
    expect(JSON.stringify(DEFAULTS)).toBe(JSON.stringify(DEFAULTS_AVANT));
  });

  it("classe chaque réglage dans une seule des trois listes", () => {
    expect([...TEXT_KEYS, ...NUMERIC_KEYS, ...BOOLEAN_KEYS].sort()).toEqual([...CLES].sort());
  });

  it("redonne les réglages du profil de l'atelier", () => {
    expect([...ATELIER_KEYS].sort()).toEqual([...ATELIER_AVANT].sort());
  });

  it("nomme chaque réglage, d'un nom propre à chacun", () => {
    const noms = CLES.map((k) => COTE_LABEL[k]);
    expect(noms.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(noms).size).toBe(noms.length);
  });

  it("relit et borne les mêmes cotes qu'avant, sauf le rayon du nez masqué des arêtes cassées", () => {
    let n = 0;
    for (const p of combinaisons()) {
      const avant = cotesLuesAvant(p, TOURS[p.forme]).filter((k) => !(k === "rn" && p.nez === "casse"));
      expect([...cotesLues(p)].sort(), JSON.stringify(p)).toEqual([...avant].sort());
      n++;
    }
    expect(n).toBe(7 * 2 * 2 * 2 * 2 * 256);
  });
});

describe("catalogue et formulaire", () => {
  const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

  /** Visible à l'écran : aucun parent masqué, l'export CNC compté ouvert (il est replié au chargement). */
  const visible = (el: HTMLElement) => {
    for (let e: HTMLElement | null = el; e && e !== document.body; e = e.parentElement)
      if (e.hidden && e.id !== "cncBody") return false;
    return true;
  };

  it("montre, grise et calcule les champs comme le dit le catalogue", { timeout: 60_000 }, () => {
    document.body.innerHTML = body;
    writeInputs(DEFAULTS);
    const champs = CLES.map((k) => [k, document.getElementById(k)] as const).filter(
      (c): c is readonly [keyof Params, HTMLInputElement] => c[1] !== null,
    );
    // Chaque réglage a son champ, sauf la forme, choisie par deux groupes de boutons (forme et sens).
    expect(CLES.filter((k) => !champs.some(([c]) => c === k))).toEqual(["forme"]);
    // Les règles croisent la forme avec une seule case à la fois : toutes les cases ensemble suffisent, plus chacune
    // seule sur deux formes.
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
      for (const [k, el] of champs) {
        const { montre, mode } = etatReglage(k, p);
        if (visible(el) !== montre || el.disabled !== (mode !== "saisi"))
          ecarts.push(`${k} (montré ${visible(el)}, grisé ${el.disabled}) avec ${JSON.stringify(p)}`);
      }
    }
    expect(ecarts.slice(0, 5)).toEqual([]);
  });
});
