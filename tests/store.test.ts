// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { newProject } from "../src/core/project";
import { LocalStore } from "../src/ui/store";

describe("projets dans le navigateur", () => {
  beforeEach(() => localStorage.clear());

  it("reprend les réglages de l'ancienne version comme premier projet", async () => {
    localStorage.setItem("limon-v2", JSON.stringify({ ...DEFAULTS, forme: "droit", H: 2850 }));
    const s = new LocalStore();
    const [p, ...rest] = await s.list();
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({ nom: "Mon escalier", mode: "complet" });
    expect(p!.params).toMatchObject({ forme: "droit", H: 2850 });
    expect(await s.currentId()).toBe(p!.id);
    expect(localStorage.getItem("limon-v2")).not.toBeNull();
    // Une seule fois : un second chargement relit la liste, sans recréer de projet.
    expect(await new LocalStore().list()).toEqual([p]);
  });

  it("commence vide sans ancienne version", async () => {
    expect(await new LocalStore().list()).toEqual([]);
  });

  it("enregistre, classe par date et supprime", async () => {
    const s = new LocalStore();
    await s.save(newProject("a", "A", "guide", 1));
    await s.save(newProject("b", "B", "complet", 2));
    await s.setCurrent("a");
    expect((await new LocalStore().list()).map((p) => p.id)).toEqual(["b", "a"]);
    await s.remove("a");
    const again = new LocalStore();
    expect((await again.list()).map((p) => p.id)).toEqual(["b"]);
    expect(await again.currentId()).toBeNull();
  });
});
