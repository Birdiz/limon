// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newDevis } from "../src/core/devis";
import { DEFAULTS } from "../src/core/params";
import { newProject, withDevis, withEtat, type Project } from "../src/core/project";

// La page entière, sans la 3D (pas de WebGL dans jsdom), lancée autant de fois qu'elle est rechargée.
vi.mock("../src/ui/scene3d", () => ({
  Scene3D: class {
    draw() {}
    showError() {}
    applyTheme() {}
  },
}));

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
let now = 1000;

const projects = () => JSON.parse(localStorage.getItem("limon-projets") ?? "[]") as Project[];
const openId = () => localStorage.getItem("limon-courant");
/** Projet ouvert tel qu'enregistré sur l'appareil. */
const saved = () => projects().find((p) => p.id === openId())!;

/** Le démarrage de la page est asynchrone et ne signale pas sa fin : une copie éventuelle a le temps de se créer. */
const settle = () => new Promise((r) => setTimeout(r, 30));

/** Relance `src/main` sur une page neuve : l'adresse et l'appareil restent, comme à l'actualisation. */
async function reload(): Promise<void> {
  document.body.innerHTML = body;
  vi.resetModules();
  await import("../src/main");
  await settle();
}

/** Saisie d'une cote, puis on quitte le champ. */
function type(id: string, value: string): void {
  now += 5000;
  const el = field(id);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function tick(id: string, on: boolean): void {
  now += 5000;
  const el = field(id);
  el.checked = on;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function click(el: HTMLElement): void {
  now += 5000;
  el.click();
}
function name(nom: string): void {
  now += 5000;
  const el = field("pjName");
  el.value = nom;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
async function newStair(): Promise<void> {
  click(button("pjNew"));
  await settle();
}
/** Une correction d'un clic : les réglages changent d'un coup, les champs calculés suivent après. */
function oneClickFix(): void {
  type("A", "2300");
  const fix = document.querySelector<HTMLButtonElement>("#notes button[data-fix]")!;
  expect(fix.textContent).toBe("Passer à 2 600 mm");
  click(fix);
}
function storeProject(p: Project): void {
  localStorage.setItem("limon-projets", JSON.stringify([p]));
  localStorage.setItem("limon-courant", p.id);
}

beforeAll(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
    },
  );
  vi.stubGlobal("scrollTo", () => {});
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 401 })));
  // Calcul immédiat : la page attend sinon l'image suivante.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 0));
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

beforeEach(async () => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  await reload();
  await newStair();
});

describe("horloge en retard sur l'escalier ouvert", () => {
  const avance = 3_600_000;
  beforeEach(async () => {
    storeProject(newProject("futur", "Reçu", "guide", now + avance));
    await reload();
  });

  it("le nom, l'étape, les cotes et l'état avancent quand même la date", () => {
    const steps: [string, () => void][] = [
      ["nom", () => name("Renommé")],
      ["étape", () => click(button("stNext"))],
      ["cote", () => type("H", "3100")],
      ["état", () => click(button("etatBtn"))],
    ];
    for (const [quoi, geste] of steps) {
      const avant = saved().modifie;
      geste();
      expect(saved().modifie, quoi).toBe(avant + 1);
    }
    expect(saved()).toMatchObject({ nom: "Renommé", etape: 1, etat: "fini", params: { H: 3100 } });
  });
});

describe("actualiser la page", () => {
  it("garde le même escalier après une seule cote tapée", async () => {
    const id = openId();
    type("H", "3000");
    expect(location.hash).toBe("#H=3000");
    await reload();
    expect(projects()).toHaveLength(1);
    expect(openId()).toBe(id);
    expect(field("H").value).toBe("3000");
  });

  it("garde le nom, l'état et le devis d'un escalier terminé, même après d'autres saisies", async () => {
    name("Chantier Dupont");
    type("H", "3200");
    type("W", "950");
    click(button("etatBtn"));
    storeProject(withDevis(saved(), newDevis(), now));
    await reload();
    expect(projects()).toHaveLength(1);
    expect(saved()).toMatchObject({ nom: "Chantier Dupont", etat: "fini" });
    expect(saved().devis).not.toBeNull();
    expect(field("pjName").value).toBe("Chantier Dupont");

    // Une saisie de plus le repasse en brouillon, sans le copier.
    type("W", "900");
    await reload();
    expect(projects()).toHaveLength(1);
    expect(saved()).toMatchObject({ nom: "Chantier Dupont", etat: "brouillon" });
    expect(saved().params.W).toBe(900);
    expect(saved().devis).not.toBeNull();
  });

  it("garde le même escalier après deux saisies et une relance, ancre conservée", async () => {
    const id = openId();
    type("H", "3000");
    type("W", "900");
    const hash = location.hash;
    await reload();
    expect(location.hash).toBe(hash);
    await reload();
    expect(projects().map((p) => p.id)).toEqual([id]);
    expect(openId()).toBe(id);
  });

  it("garde le même escalier avec une trémie à calculer", async () => {
    const id = openId();
    tick("tAuto", true);
    type("H", "3000");
    type("W", "900");
    await reload();
    expect(projects().map((p) => p.id)).toEqual([id]);
  });

  it("garde un projet enregistré avant la correction, ses valeurs relues comprises", async () => {
    const p = newProject("ancien", "Ancien", "complet", now, { ...DEFAULTS, H: 3000, n: 16, f: 400, hlj: 380 });
    const fini = withEtat(p, "fini", now);
    storeProject(fini);
    history.replaceState(null, "", "#H=3000");
    await reload();
    expect(projects().map((q) => q.id)).toEqual(["ancien"]);
    expect(saved()).toMatchObject({ nom: "Ancien", etat: "fini", modifie: fini.modifie });
  });

  it("ne copie rien en rouvrant sans ancre, ni l'exemple intact", async () => {
    const id = openId();
    type("H", "3000");
    history.replaceState(null, "", "/");
    await reload();
    expect(projects().map((p) => p.id)).toEqual([id]);

    history.replaceState(null, "", "/?exemple");
    await reload();
    expect(saved().nom).toBe("Exemple");
    expect(location.hash).toBe("");
    await reload();
    expect(projects()).toHaveLength(2);
    expect(saved().nom).toBe("Exemple");
  });

  it("crée l'escalier demandé par ?nouveau, sans le copier ensuite", async () => {
    history.replaceState(null, "", "/?nouveau");
    await reload();
    expect(projects()).toHaveLength(2);
    const id = openId();
    expect(saved().mode).toBe("guide");
    await reload();
    expect(projects()).toHaveLength(2);
    expect(openId()).toBe(id);
  });
});

describe("escalier reçu par lien", () => {
  const LIEN = "#H=3100&W=900";
  const recu = () => document.getElementById("recu")!;
  /** Ce que l'appareil garde des escaliers : rien ne doit y bouger avant un geste. */
  const device = () => [localStorage.getItem("limon-projets"), localStorage.getItem("limon-courant")];

  async function open(hash = LIEN): Promise<void> {
    history.replaceState(null, "", hash);
    await reload();
  }

  it("s'ouvre et se calcule sans rien écrire sur l'appareil", async () => {
    const before = device();
    await open();
    expect(field("H").value).toBe("3100");
    expect(field("W").value).toBe("900");
    expect(field("pjName").value).toBe("Escalier reçu par lien");
    expect(document.getElementById("tiles")!.innerHTML).not.toBe("");
    expect(recu().hidden).toBe(false);
    expect(location.hash).toBe(LIEN);
    expect(device()).toEqual(before);
  });

  it("s'ouvre aussi sur un appareil vide, sans accueil par-dessus", async () => {
    localStorage.clear();
    await open();
    await settle();
    expect(field("H").value).toBe("3100");
    expect(document.getElementById("home")!.hidden).toBe(true);
    expect(recu().hidden).toBe(false);
    expect(device()).toEqual([null, null]);
  });

  it("ne compte pas comme un geste : actualiser, ouvrir les fichiers pour la machine", async () => {
    const before = device();
    await open();
    click(button("cncOpen"));
    await reload();
    expect(field("H").value).toBe("3100");
    expect(device()).toEqual(before);
  });

  it("ne laisse rien une fois fermé sans geste", async () => {
    const id = openId();
    const before = device();
    await open();
    history.replaceState(null, "", "/");
    await reload();
    expect(device()).toEqual(before);
    expect(openId()).toBe(id);
    expect(recu().hidden).toBe(true);
    expect(field("H").value).toBe(String(DEFAULTS.H));
  });

  it.each([
    ["une cote", () => type("L", "2500")],
    ["le nom", () => name("Chantier Martin")],
    ["l'état", () => click(button("etatBtn"))],
    ["le bouton", () => click(button("recuGarde"))],
    ["le retour à l'exemple", () => click(button("reset"))],
  ])("est enregistré au premier geste : %s", async (_quoi, geste) => {
    const first = openId();
    await open();
    geste();
    await settle();
    expect(projects()).toHaveLength(2);
    expect(openId()).not.toBe(first);
    expect(recu().hidden).toBe(true);
    await reload();
    expect(projects()).toHaveLength(2);
  });

  it("garde ses réglages et rouvre le même escalier ensuite", async () => {
    await open();
    click(button("recuGarde"));
    const id = openId();
    expect(saved()).toMatchObject({ id, nom: "Escalier reçu par lien", etat: "brouillon" });
    expect(saved().params).toMatchObject({ H: 3100, W: 900 });
    await reload();
    expect(openId()).toBe(id);
    expect(recu().hidden).toBe(true);
  });

  it("n'ajoute pas de copie quand on rouvre le lien, même avec un autre escalier ouvert", async () => {
    await open();
    click(button("recuGarde"));
    const id = openId();
    await newStair();
    const before = projects().length;
    expect(openId()).not.toBe(id);
    await open();
    expect(openId()).toBe(id);
    expect(recu().hidden).toBe(true);
    type("L", "2500");
    expect(projects()).toHaveLength(before);
  });

  it("n'écrit rien pour une adresse d'ancien transfert, ni après relance", async () => {
    const before = device();
    const moved = { projets: [newProject("venu", "Venu d'ailleurs", "complet", now)], courant: "venu", lien: LIEN };
    await open("#transfert=" + encodeURIComponent(JSON.stringify(moved)));
    expect(device()).toEqual(before);
    expect(recu().hidden).toBe(true);
    expect(location.hash).not.toContain("transfert");
    await reload();
    expect(device()).toEqual(before);
  });

  describe("connecté", () => {
    const envois: string[] = [];
    const exchange = async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
    };

    beforeEach(() => {
      envois.length = 0;
      localStorage.clear();
      const compte = { id: "c", email: "a@exemple.fr", statut: "essai" };
      localStorage.setItem("limon-synchro", JSON.stringify({ compte, dernier: compte.email, connu: true }));
      vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
        if (url === "/api/projets" && init.method === "PUT") envois.push(String(init.body));
        const body = url === "/api/projets" && init.method === "PUT" ? { index: [], refus: [] } : [];
        return Promise.resolve(Response.json(url === "/api/atelier" ? null : body));
      });
    });
    afterEach(() => {
      vi.stubGlobal("fetch", () => Promise.resolve(new Response(null, { status: 401 })));
    });

    it("n'envoie rien au compte avant un geste, puis l'envoie", async () => {
      await open();
      await exchange();
      expect(envois).toEqual([]);
      click(button("recuGarde"));
      await exchange();
      expect(envois.join()).toContain('"H":3100');
    });
  });
});

describe("escalier terminé", () => {
  /** Terminé, puis ouverture des fichiers pour la machine : l'état et la date ne bougent pas. */
  function finishThenExport(): void {
    click(button("etatBtn"));
    expect(saved().etat).toBe("fini");
    const before = saved();
    document.getElementById("etatMsg")!.textContent = "";
    click(button("cncOpen"));
    expect(document.getElementById("cncBody")!.hidden).toBe(false);
    expect(saved()).toEqual(before);
    expect(document.getElementById("etatMsg")!.textContent).toBe("");
    expect(document.getElementById("pjEtat")!.textContent).toBe("Terminé");
  }

  it("le reste à l'ouverture de l'export après une correction d'un clic", () => {
    oneClickFix();
    finishThenExport();
  });

  it("le reste à l'ouverture de l'export après annuler", () => {
    oneClickFix();
    type("W", "900");
    click(button("undo"));
    expect(field("W").value).toBe(String(DEFAULTS.W));
    finishThenExport();
  });

  it("le reste après une saisie au clavier", () => {
    type("H", "3000");
    finishThenExport();
  });

  it("le reste sur un projet relu dont le nombre de hauteurs enregistré diffère du calcul", async () => {
    storeProject(withEtat(newProject("relu", "Relu", "complet", now, { ...DEFAULTS, n: 16 }), "fini", now));
    await reload();
    const before = saved();
    expect(before.params.n).toBe(16);
    click(button("cncOpen"));
    expect(saved()).toEqual(before);
    expect(document.getElementById("etatMsg")!.textContent).toBe("");
  });

  it("repasse en brouillon quand un réglage change vraiment", () => {
    type("H", "3000");
    click(button("etatBtn"));
    const before = saved();
    type("H", "3100");
    expect(saved()).toMatchObject({ etat: "brouillon", finiLe: 0 });
    expect(saved().modifie).toBeGreaterThan(before.modifie);
    expect(document.getElementById("etatMsg")!.textContent).toContain("Modifié");
  });
});

describe("champs automatiques", () => {
  it("ne font pas partie des réglages tant que l'automatique est actif", () => {
    tick("tAuto", true);
    type("H", "3200");
    type("W", "950");
    const { n, f, hlj, tL, tX, tY, tbD, tbA } = saved().params;
    expect({ n, f, hlj, tL, tX, tY, tbD, tbA }).toEqual({
      n: DEFAULTS.n,
      f: DEFAULTS.f,
      hlj: DEFAULTS.hlj,
      tL: DEFAULTS.tL,
      tX: DEFAULTS.tX,
      tY: DEFAULTS.tY,
      tbD: DEFAULTS.tbD,
      tbA: DEFAULTS.tbA,
    });
    expect(field("n").value).not.toBe(String(DEFAULTS.n));
  });

  it.each([
    ["n", "nAuto"],
    ["f", "fAuto"],
    ["hlj", "hljAuto"],
  ] as const)("%s part du chiffre affiché en passant en manuel", (k, auto) => {
    type("H", "3200");
    type("W", "950");
    const shown = Number(field(k).value);
    expect(shown).not.toBe(DEFAULTS[k]);
    expect(saved().params[k]).toBe(DEFAULTS[k]);
    tick(auto, false);
    expect(saved().params[auto]).toBe(false);
    expect(saved().params[k]).toBe(shown);
    expect(field(k).value).toBe(String(shown));
  });

  it("la trémie mesurée part des cotes affichées", () => {
    tick("tAuto", true);
    type("H", "3200");
    const shown = Number(field("tY").value);
    expect(shown).not.toBe(DEFAULTS.tY);
    expect(saved().params.tY).toBe(DEFAULTS.tY);
    tick("tAuto", false);
    expect(saved().params.tAuto).toBe(false);
    expect(saved().params.tY).toBe(shown);
  });

  it("reprend le calcul en revenant en automatique", () => {
    type("H", "3200");
    tick("nAuto", false);
    type("n", "20");
    expect(saved().params.n).toBe(20);
    tick("nAuto", true);
    expect(saved().params).toMatchObject({ nAuto: true, n: 20 });
    expect(field("n").value).not.toBe("20");
  });
});
