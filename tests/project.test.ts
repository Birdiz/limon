import { describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import {
  canFinish,
  edited,
  fileBase,
  newProject,
  parseProjectFile,
  projectFile,
  sanitizeProject,
  withEtat,
} from "../src/core/project";
import { compute, type ComputeResult } from "../src/core/stair";

describe("projets", () => {
  const p = newProject("a1", "  Escalier Dupont ", "guide", 1000, { ...DEFAULTS, forme: "droit", H: 2800 });

  it("crée un projet aux réglages donnés", () => {
    expect(p).toMatchObject({ id: "a1", nom: "Escalier Dupont", cree: 1000, modifie: 1000, mode: "guide", etape: 0 });
    expect(p.params.H).toBe(2800);
    expect(newProject("a2", " ", "complet", 0).nom).toBe("Mon escalier");
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
    expect(parseProjectFile(projectFile(f), "z")).toMatchObject({ etat: "fini", finiLe: 5000 });
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
    expect(back).toEqual({ ...p, id: "z9" });
    expect(projectFile(p)).not.toContain("a1");
  });

  it("refuse un fichier qui n'est pas un projet", () => {
    expect(parseProjectFile("pas du json", "x")).toEqual({ erreur: "Ce fichier n'est pas un projet Quart de tour." });
    expect(parseProjectFile('{"format":"autre"}', "x")).toEqual({
      erreur: "Ce fichier n'est pas un projet Quart de tour.",
    });
    expect(parseProjectFile('{"format":"limon-projet","version":9,"projet":{}}', "x")).toEqual({
      erreur: "Ce projet vient d'une version plus récente de Quart de tour.",
    });
  });

  it("donne un nom de fichier sûr", () => {
    expect(fileBase('Esc. "Dupont" 2/3 ')).toBe("Esc. Dupont 2 3");
    expect(fileBase(" ... ")).toBe("escalier");
  });
});
