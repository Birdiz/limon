// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { newProject } from "../src/core/project";
import { Home } from "../src/ui/home";
import type { ProjectStore } from "../src/ui/store";

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const host = {
  current: () => null,
  params: () => DEFAULTS,
  open() {},
  example() {},
  signedIn: () => false,
  known: () => false,
  account() {},
};

/** Un magasin qui ne filtre rien : la carte doit tenir toute seule. */
function storeOf(...list: ReturnType<typeof newProject>[]): ProjectStore {
  return { list: () => Promise.resolve(list) } as unknown as ProjectStore;
}

describe("cartes de l'accueil", () => {
  beforeEach(() => {
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    window.scrollTo = () => {};
  });

  it("un identifiant ne crée aucun nœud dans la carte", async () => {
    const id = 'x"><img data-intrus="1"><b title="';
    await new Home(storeOf(newProject(id, "Dupont", "complet", 1)), host).show();
    const box = document.getElementById("homeDraft")!;
    expect(box.querySelector("[data-intrus]")).toBeNull();
    const ids = [...box.querySelectorAll<HTMLButtonElement>("button[data-act]")].map((b) => b.dataset.id);
    expect(ids).toEqual([id, id, id]);
  });
});
