// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { newProject } from "../src/core/project";
import { storeMoved, takeMoved } from "../src/ui/move";
import { LocalStore } from "../src/ui/store";

describe("déménagement depuis l'ancienne adresse", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", "/");
  });

  it("lit les projets dans l'ancre puis la retire", () => {
    const p = newProject("a", "Dupont", "guide", 5, { ...DEFAULTS, H: 2900 });
    const data = { projets: [p, { nom: "sans identifiant" }], courant: "a", lien: "#H=3100" };
    history.replaceState(null, "", "/#transfert=" + encodeURIComponent(JSON.stringify(data)));
    expect(takeMoved()).toEqual({ projets: [p], courant: "a", lien: "#H=3100" });
    expect(location.hash).toBe("");
  });

  it("ignore une ancre sans transfert ou illisible", () => {
    history.replaceState(null, "", "/#H=3100");
    expect(takeMoved()).toBeNull();
    expect(location.hash).toBe("#H=3100");
    history.replaceState(null, "", "/#transfert=%7Bpas");
    expect(takeMoved()).toBeNull();
  });

  it("garde la version la plus récente de chaque projet et rouvre le projet en cours", async () => {
    const s = new LocalStore();
    await s.save(newProject("a", "Ici, plus récent", "guide", 10));
    await s.save(newProject("b", "Ici, plus ancien", "guide", 1));
    await storeMoved(s, {
      projets: [
        newProject("a", "Là-bas", "guide", 5),
        newProject("b", "Là-bas", "guide", 8),
        newProject("c", "Nouveau", "complet", 3),
      ],
      courant: "c",
      lien: "",
    });
    expect((await s.list()).map((p) => [p.id, p.nom])).toEqual([
      ["a", "Ici, plus récent"],
      ["b", "Là-bas"],
      ["c", "Nouveau"],
    ]);
    expect(await s.currentId()).toBe("c");
  });
});
