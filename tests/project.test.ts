import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import {
  canFinish,
  edited,
  fileBase,
  fromNewerVersion,
  newProject,
  NOM_PAR_DEFAUT,
  parseProjectFile,
  projectFile,
  sanitizeProject,
  SCHEMA,
  stamped,
  touched,
  withDevis,
  withEtat,
} from "../src/core/project";
import { compute, type ComputeResult } from "../src/core/stair";

const PAS_UN_PROJET = "Ce fichier n'est pas un projet Quart de tour.";
const ABIME = "Ce fichier est abîmé : les cotes de l'escalier ne s'y lisent pas.";
/** Fichier de projet écrit à la main, version 1 sauf si elle est donnée. */
const fichier = (champs: object) => JSON.stringify({ format: "limon-projet", version: 1, ...champs }, null, 2);

describe("numéro de schéma", () => {
  const p = newProject("id", "A", "complet", 1000);

  it("un nouvel escalier porte le numéro de cette version", () => {
    expect(p.schema).toBe(SCHEMA);
  });

  it("relire n'élève pas le numéro : absent ou mal formé il reste 0, plus haut il revient à ce qu'on a relu", () => {
    expect(sanitizeProject({ ...p, schema: undefined })!.schema).toBe(0);
    for (const schema of ["1", 1.5, -1, null, 1e300]) expect(sanitizeProject({ ...p, schema })!.schema).toBe(0);
    expect(sanitizeProject(p)!.schema).toBe(SCHEMA);
    expect(sanitizeProject({ ...p, schema: SCHEMA + 1 })!.schema).toBe(SCHEMA);
  });

  it("reconnaît un projet d'une version plus récente", () => {
    expect(fromNewerVersion({ ...p, schema: SCHEMA + 1 })).toBe(true);
    expect(fromNewerVersion(p)).toBe(false);
    expect(fromNewerVersion({ id: "id" })).toBe(false);
    expect(fromNewerVersion(null)).toBe(false);
  });

  it("toute modification porte le numéro de cette version, pas la simple relecture", () => {
    const ancien = { ...p, schema: 0 };
    expect(touched(ancien, 2000)).toEqual({ modifie: 2000, schema: SCHEMA });
    expect(withDevis(ancien, null, 2000).schema).toBe(SCHEMA);
    expect(withEtat(ancien, "fini", 2000).schema).toBe(SCHEMA);
    expect(edited(ancien, { ...p.params, H: 2900 }, 2000).schema).toBe(SCHEMA);
    expect(edited(ancien, ancien.params, 2000)).toBe(ancien);
  });

  it("un fichier ouvert est un nouvel escalier, au numéro de cette version", () => {
    const r = parseProjectFile(projectFile(p), "autre");
    expect("projet" in r && r.projet.schema).toBe(SCHEMA);
  });
});

describe("textes d'un projet relu", () => {
  it("retire les caractères de contrôle et garde les retours à la ligne", () => {
    const p = sanitizeProject({
      id: "a",
      nom: "\u0000Du\u0007pont\ud83d",
      devis: { client: { nom: "A\u0000", adresse: "1 rue\n\u001fici\ttoit", chantier: "😀" } },
    })!;
    expect(p.nom).toBe("Dupont");
    expect(p.devis!.client).toEqual({ nom: "A", adresse: "1 rue\nici\ttoit", chantier: "😀" });
  });

  it("un nom fait seulement de caractères de contrôle prend le nom par défaut", () => {
    expect(sanitizeProject({ id: "a", nom: "\u0000 \u0001" })!.nom).toBe(NOM_PAR_DEFAUT);
  });
});

describe("projets", () => {
  const p = newProject("a1", "  Escalier Dupont ", "guide", 1000, { ...DEFAULTS, forme: "droit", H: 2800 });

  it("une modification est toujours plus récente que ce qu'elle remplace", () => {
    expect(stamped(p, 9000)).toBe(9000);
    // L'horloge de cet appareil retarde sur la version reçue.
    expect(stamped(p, 500)).toBe(1001);
    expect(stamped(p, 1000)).toBe(1001);
    expect(stamped({ modifie: 5000.5 }, 500)).toBe(5001);
    expect(withDevis(p, null, 500).modifie).toBe(1001);
    expect(withEtat(p, "fini", 500)).toMatchObject({ modifie: 1001, finiLe: 500 });
    expect(withEtat(withEtat(p, "fini", 500), "brouillon", 500).modifie).toBe(1002);
    expect(edited(p, { ...p.params, H: 2900 }, 500).modifie).toBe(1001);
    expect(edited(withEtat(p, "fini", 500), { ...p.params, H: 2900 }, 500).modifie).toBe(1002);
  });

  it("crée un projet aux réglages donnés", () => {
    expect(p).toMatchObject({ id: "a1", nom: "Escalier Dupont", cree: 1000, modifie: 1000, mode: "guide", etape: 0 });
    expect(p.params.H).toBe(2800);
    expect(newProject("a2", " ", "complet", 0).nom).toBe("Mon escalier");
  });

  it("refuse un identifiant hors format : il finit dans des attributs HTML", () => {
    for (const id of ['a"b', "a b", "<b>", "é", "x".repeat(101), ""]) expect(sanitizeProject({ id })).toBeNull();
    // randomUUID, le secours de newId, la plus longue permise.
    for (const id of ["3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b", "lr5k2x0abc123def", "x".repeat(100)])
      expect(sanitizeProject({ id })?.id).toBe(id);
  });

  it("nettoie un projet enregistré", () => {
    expect(sanitizeProject(null)).toBeNull();
    expect(sanitizeProject({ nom: "sans identifiant" })).toBeNull();
    const q = sanitizeProject({ id: "b", nom: 3, mode: "autre", etape: 2.6, params: { W: 900, forme: "spirale" } })!;
    expect(q).toMatchObject({ id: "b", nom: "Mon escalier", mode: "complet", etape: 3, cree: 0 });
    expect(q.params.W).toBe(900);
    expect(q.params.forme).toBe(DEFAULTS.forme);
  });

  it("part en brouillon et passe à fini, date comprise", () => {
    expect(p).toMatchObject({ etat: "brouillon", finiLe: 0 });
    const f = withEtat(p, "fini", 5000);
    expect(f).toMatchObject({ etat: "fini", finiLe: 5000, modifie: 5000 });
    expect(withEtat(f, "brouillon", 6000)).toMatchObject({ etat: "brouillon", finiLe: 0, modifie: 6000 });
    // Les escaliers d'avant l'état, ou un état inconnu, sont des brouillons.
    expect(sanitizeProject({ id: "c" })).toMatchObject({ etat: "brouillon", finiLe: 0 });
    expect(sanitizeProject({ id: "c", etat: "posé", finiLe: 9 })).toMatchObject({ etat: "brouillon", finiLe: 0 });
    expect(sanitizeProject({ id: "c", etat: "fini", finiLe: 9 })).toMatchObject({ etat: "fini", finiLe: 9 });
    expect(parseProjectFile(projectFile(f), "z")).toMatchObject({ projet: { etat: "fini", finiLe: 5000 } });
  });

  it("ne change rien tant que les réglages sont les mêmes", () => {
    expect(edited(p, { ...p.params }, 9000)).toBe(p);
    const f = withEtat(p, "fini", 5000);
    expect(edited(f, { ...f.params }, 9000)).toBe(f);
  });

  it("enregistre un réglage changé, et repasse un escalier terminé en brouillon", () => {
    const params = { ...p.params, H: 2900 };
    expect(edited(p, params, 9000)).toEqual({ ...p, params, modifie: 9000 });
    const f = withEtat(p, "fini", 5000);
    expect(edited(f, params, 9000)).toEqual({ ...f, params, etat: "brouillon", finiLe: 0, modifie: 9000 });
  });

  it("dit si un escalier peut être terminé", () => {
    const ok = compute(DEFAULTS);
    expect(canFinish(ok)).toBe("oui");
    expect(canFinish(compute({ ...DEFAULTS, H: 120 }))).toBe("non");
    expect(canFinish(null)).toBe("non");
    if (!ok.ok) throw new Error("calcul attendu en réussite");
    const bad: ComputeResult = { ok: true, stair: { ...ok.stair, notes: [["warn", "à voir"]] } };
    expect(canFinish(bad)).toBe("oui");
    bad.stair.notes = [
      ["warn", "à voir"],
      ["bad", "non respecté"],
    ];
    expect(canFinish(bad)).toBe("confirmer");
  });

  it("relit son fichier .escalier sous un nouvel identifiant", () => {
    const back = parseProjectFile(projectFile(p), "z9");
    expect(back).toEqual({ projet: { ...p, id: "z9" }, ignores: [] });
    expect(projectFile(p)).not.toContain("a1");
  });

  it("relit sans rien signaler un fichier d'avant les derniers réglages", () => {
    const { J, tournant, mp, ...anciens } = p.params;
    const back = parseProjectFile(fichier({ projet: { nom: "Ancien", params: anciens } }), "z");
    expect(back).toMatchObject({ projet: { nom: "Ancien", params: { H: 2800 } }, ignores: [] });
    expect(back).toMatchObject({ projet: { params: { J, tournant, mp } } });
  });

  it("refuse un fichier qui n'est pas un projet", () => {
    expect(parseProjectFile("pas du json", "x")).toEqual({ erreur: PAS_UN_PROJET });
    expect(parseProjectFile('{"format":"autre"}', "x")).toEqual({ erreur: PAS_UN_PROJET });
    expect(parseProjectFile("null", "x")).toEqual({ erreur: PAS_UN_PROJET });
    expect(parseProjectFile('{"format":"limon-projet","version":9,"projet":{}}', "x")).toEqual({
      erreur: "Ce projet vient d'une version plus récente de Quart de tour.",
    });
  });

  it("refuse un fichier tronqué", () => {
    const text = projectFile(p);
    expect(parseProjectFile(text.slice(0, text.length / 2), "x")).toEqual({ erreur: PAS_UN_PROJET });
  });

  it("refuse un fichier sans cotes, au lieu d'ouvrir celles de l'exemple", () => {
    const sain = { nom: "Dupont", params: p.params };
    const abimes = [
      { projet: { nom: "Dupont" } },
      { projet: { nom: "Dupont", params: null } },
      { projet: { nom: "Dupont", params: [] } },
      { projet: { nom: "Dupont", params: "H=2800" } },
      { projet: { nom: "Dupont", params: {} } },
      { projet: { nom: "Dupont", params: { H: "2800", W: null } } },
      { projet: null },
      { projet: [] },
      { projet: [sain] },
      { projet: "Dupont" },
      { projet: sain, version: -1 },
      { projet: sain, version: 0 },
      { projet: sain, version: 0.5 },
      { projet: sain, version: "1" },
      { projet: sain, version: null },
    ];
    for (const a of abimes) expect(parseProjectFile(fichier(a), "x"), JSON.stringify(a)).toEqual({ erreur: ABIME });
    expect(parseProjectFile(`{"format":"limon-projet","projet":${JSON.stringify(sain)}}`, "x")).toEqual({
      erreur: ABIME,
    });
  });

  it("nomme les cotes illisibles au lieu de les remplacer sans mot", () => {
    const back = parseProjectFile(fichier({ projet: { nom: "Dupont", params: { ...p.params, H: "2800" } } }), "z");
    expect(back).toMatchObject({ projet: { params: { H: DEFAULTS.H, W: p.params.W } }, ignores: ["H"] });
    // null : ce que JSON écrit pour un nombre perdu ; 1e999 : un nombre qui ne tient plus ; une clé déformée.
    const q = { ...p.params, W: null, forme: "spirale", cm: "oui", el: Infinity, Hh: 2800 };
    expect(
      parseProjectFile(fichier({ projet: { params: q } }).replace('"el": null', '"el": 1e999'), "z"),
    ).toMatchObject({
      ignores: ["forme", "W", "cm", "el", "Hh"],
    });
  });

  it("repasse en brouillon un escalier terminé dont une cote est illisible", () => {
    const f = withEtat(p, "fini", 5000);
    const projet = { ...JSON.parse(projectFile(f)).projet, params: { ...p.params, H: "2800" } };
    expect(parseProjectFile(fichier({ projet }), "z")).toMatchObject({
      projet: { etat: "brouillon", finiLe: 0 },
      ignores: ["H"],
    });
  });

  it("donne un nom de fichier sûr", () => {
    expect(fileBase('Esc. "Dupont" 2/3 ')).toBe("Esc. Dupont 2 3");
    expect(fileBase(" ... ")).toBe("escalier");
  });
});
