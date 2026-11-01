// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { newProject } from "../src/core/project";
import { AccountPanel } from "../src/ui/account";
import { Api } from "../src/ui/api";
import { LocalStore, type KeyValue } from "../src/ui/store";
import { SyncStore } from "../src/ui/sync";

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

/** Laisse `refreshLine`, asynchrone, écrire l'en-tête. */
const settled = () => new Promise((r) => setTimeout(r));
const line = () => document.querySelector<HTMLElement>("#saved")!;
const COMPTE = { id: "c", email: "a@exemple.fr", statut: "testeur" as const };

function panel(storage: KeyValue | null) {
  const store = new SyncStore(
    new LocalStore(storage),
    new Api(async () => new Response("[]", { status: 200 })),
    storage,
  );
  new AccountPanel(store, new Api());
  return store;
}

function refusing() {
  const m = new Map<string, string>();
  const d = {
    refuse: false,
    storage: {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => {
        if (d.refuse) throw new DOMException("plein", "QuotaExceededError");
        m.set(k, v);
      },
      removeItem: (k) => void m.delete(k),
    } as KeyValue,
  };
  return d;
}

describe("état de l'enregistrement dans l'en-tête", () => {
  beforeEach(() => {
    document.body.innerHTML = body;
  });

  it("sans compte : dit l'échec, invite à garder une copie, puis le retire", async () => {
    const d = refusing();
    const store = panel(d.storage);
    await settled();
    expect(line().textContent).toBe("Enregistré sur cet appareil");
    expect(line().classList.contains("fail")).toBe(false);

    d.refuse = true;
    await store.save(newProject("a", "A", "complet", 1));
    await settled();
    expect(line().textContent).not.toContain("Enregistré");
    expect(line().textContent).toContain("pas gardé sur cet appareil");
    expect(line().textContent).toContain("copie en fichier");
    expect(line().classList.contains("fail")).toBe(true);

    d.refuse = false;
    await store.save(newProject("a", "A", "complet", 2));
    await settled();
    expect(line().textContent).toBe("Enregistré sur cet appareil");
    expect(line().classList.contains("fail")).toBe(false);
  });

  it("accès refusé dès l'ouverture : l'en-tête ne dit jamais « Enregistré »", async () => {
    panel(null);
    await settled();
    expect(line().textContent).toContain("pas gardé sur cet appareil");
  });

  it("avec un compte : l'échec passe aussi avant « Enregistré sur tous vos appareils »", async () => {
    const d = refusing();
    d.refuse = true;
    const store = panel(d.storage);
    await store.signIn(COMPTE);
    await store.save(newProject("a", "A", "complet", 1));
    await settled();
    expect(line().textContent).toContain("pas gardé sur cet appareil");
    expect(line().classList.contains("fail")).toBe(true);
  });
});
