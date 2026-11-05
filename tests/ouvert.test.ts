import { beforeEach, describe, expect, it, vi } from "vitest";
import { newDevis } from "../src/core/devis";
import { DROITS, type Droits } from "../src/core/niveaux";
import { DEFAULTS, type Params } from "../src/core/params";
import { newProject, renamed, withEtat, type Project } from "../src/core/project";
import { EscalierOuvert, type Raison } from "../src/ui/ouvert";
import { LocalStore, type KeyValue } from "../src/ui/store";

let now = 1000;
const LIEN: Params = { ...DEFAULTS, H: 3100, W: 900 };
const ATELIER: Params = { ...DEFAULTS, H: 2600 };

function memoire(): KeyValue {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** L'escalier ouvert sur un appareil qui garde `deja`, du plus ancien au plus récent ; la page est un journal. */
function page(droits: Droits = DROITS.premium, ...deja: Project[]) {
  const store = new LocalStore(memoire());
  for (const p of deja) void store.save(p);
  const vus: [string | null, Raison][] = [];
  let affiches = 0;
  let place = true;
  const host = {
    montrer: (p: Project | null, raison: Raison) => void vus.push([p?.id ?? null, raison]),
    affiche: () => void affiches++,
    // Au gratuit, la page fait remplacer le seul escalier gardé, après confirmation.
    makeRoom: vi.fn(async () => {
      if (!place) return false;
      const all = await store.list();
      if (all.length >= droits.escaliers) for (const p of all) await store.remove(p.id);
      return true;
    }),
    atelier: () => ATELIER,
  };
  const ouvert = new EscalierOuvert(store, host, droits);
  return {
    ouvert,
    store,
    host,
    vus,
    affiches: () => affiches,
    refuse: () => void (place = false),
    gardes: async () => (await store.list()).map((p) => p.id),
  };
}

/** Escalier gardé, modifié à cette date. */
const garde = (id: string, modifie: number) => newProject(id, id, "complet", modifie);

beforeEach(() => {
  now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
});

describe("escalier reçu par lien", () => {
  it("se montre sans rien écrire, puis le premier geste le garde et en fait l'escalier courant", async () => {
    const t = page(DROITS.premium, garde("a", 10));
    await t.ouvert.lien(LIEN);
    const recu = t.ouvert.projet!;
    expect(recu.params).toMatchObject({ H: 3100, W: 900 });
    expect(t.ouvert.recu).toBe("lien");
    expect(t.vus.at(-1)).toEqual([recu.id, "ouvert"]);
    expect(await t.gardes()).toEqual(["a"]);

    t.ouvert.geste();
    expect(t.ouvert.recu).toBeNull();
    expect(await t.gardes()).toContain(recu.id);
    expect(await t.store.currentId()).toBe(recu.id);
  });

  it("ne se garde pas sur un simple écart de relecture des champs", async () => {
    const t = page();
    await t.ouvert.lien(LIEN);
    expect(t.ouvert.regle({ ...LIEN, H: 3000 })).toBe("modifie");
    expect(t.ouvert.projet!.params.H).toBe(3000);
    expect(await t.gardes()).toEqual([]);
    expect(t.ouvert.recu).toBe("lien");
  });

  it("se garde au premier changement de l'artisan (nom, état, étape, devis)", async () => {
    const t = page();
    await t.ouvert.lien(LIEN);
    t.ouvert.change((p) => renamed(p, "Chantier Martin", Date.now()));
    expect(t.ouvert.recu).toBeNull();
    expect((await t.store.list())[0]).toMatchObject({ nom: "Chantier Martin", params: { H: 3100 } });
  });

  it("rouvre l'escalier déjà gardé au lieu d'en préparer une copie, et rien quand il est déjà ouvert", async () => {
    const t = page(DROITS.premium, { ...garde("k", 10), params: { ...LIEN } }, garde("b", 20));
    await t.ouvert.demarrer(null);
    expect(t.ouvert.projet!.id).toBe("b");
    await t.ouvert.lien(LIEN);
    expect(t.ouvert.projet!.id).toBe("k");
    expect(t.ouvert.recu).toBeNull();
    expect(await t.store.currentId()).toBe("k");
    const avant = t.vus.length;
    await t.ouvert.lien(LIEN);
    expect(t.vus).toHaveLength(avant);
  });

  it("s'ouvre seul sur un appareil vide : pas d'accueil vide d'abord", async () => {
    const t = page();
    await t.ouvert.demarrer(LIEN);
    expect(t.vus).toEqual([[t.ouvert.projet!.id, "ouvert"]]);
    expect(t.ouvert.recu).toBe("lien");
  });
});

describe("offre gratuite", () => {
  it("montre le lien reçu sans prendre la place de l'escalier gardé, même après un geste", async () => {
    const t = page(DROITS.gratuit, garde("a", 10));
    await t.ouvert.demarrer(LIEN);
    t.ouvert.geste();
    t.ouvert.change((p) => renamed(p, "Autre", Date.now()));
    expect(await t.gardes()).toEqual(["a"]);
    expect(t.ouvert.recu).toBe("lien");
    expect(t.ouvert.projet!.nom).toBe("Autre");
  });

  it("« Garder cet escalier » le met à la place du seul escalier, après confirmation", async () => {
    const t = page(DROITS.gratuit, garde("a", 10));
    await t.ouvert.demarrer(LIEN);
    const id = t.ouvert.projet!.id;
    await t.ouvert.garder();
    expect(t.host.makeRoom).toHaveBeenCalledOnce();
    expect(await t.gardes()).toEqual([id]);
    expect(t.ouvert.recu).toBeNull();
  });

  it("ne garde rien quand l'artisan refuse de remplacer son escalier", async () => {
    const t = page(DROITS.gratuit, garde("a", 10));
    await t.ouvert.demarrer(LIEN);
    t.refuse();
    await t.ouvert.garder();
    expect(await t.gardes()).toEqual(["a"]);
    expect(t.ouvert.recu).toBe("lien");
  });

  it("garde le lien reçu sans rien demander tant qu'il reste de la place", async () => {
    const t = page(DROITS.gratuit);
    await t.ouvert.demarrer(LIEN);
    await t.ouvert.garder();
    expect(t.host.makeRoom).not.toHaveBeenCalled();
    expect(await t.gardes()).toEqual([t.ouvert.projet!.id]);
  });

  it("montre l'exemple sans le garder quand la place est prise ; sinon c'est un nouvel escalier", async () => {
    const plein = page(DROITS.gratuit, garde("a", 10));
    await plein.ouvert.exemple();
    expect(plein.ouvert.recu).toBe("exemple");
    expect(plein.ouvert.projet!.params).toEqual(DEFAULTS);
    expect(await plein.gardes()).toEqual(["a"]);

    const vide = page(DROITS.gratuit);
    await vide.ouvert.exemple();
    expect(vide.ouvert.recu).toBeNull();
    expect(await vide.gardes()).toEqual([vide.ouvert.projet!.id]);
    expect(vide.ouvert.projet).toMatchObject({ nom: "Exemple", mode: "complet" });
  });

  it("part de l'exemple pour un nouvel escalier ; les niveaux payants, des réglages de l'atelier", async () => {
    expect(page(DROITS.gratuit).ouvert.depart()).toEqual(DEFAULTS);
    expect(page(DROITS.payant).ouvert.depart()).toBe(ATELIER);
    const t = page(DROITS.payant);
    await t.ouvert.nouveau();
    expect(t.ouvert.projet).toMatchObject({ mode: "guide", params: { H: 2600 } });
    expect(await t.store.currentId()).toBe(t.ouvert.projet!.id);
  });

  it("met la fiche en brouillon et en extrait, même terminée", async () => {
    const t = page(DROITS.gratuit, withEtat(garde("a", 10), "fini", 10));
    await t.ouvert.demarrer(null);
    expect(t.ouvert.fiche()).toEqual({ brouillon: true, extrait: true });
    t.ouvert.niveau(DROITS.payant);
    expect(t.ouvert.fiche()).toEqual({ brouillon: false, extrait: false });
  });
});

describe("lecture seule", () => {
  /** Deux escaliers restés d'un abonnement : « vieux » est le moins récemment modifié. */
  async function deux() {
    const t = page(DROITS.gratuit, garde("vieux", 10), garde("recent", 20));
    await t.ouvert.demarrer(null);
    await t.store.setCurrent("vieux");
    t.ouvert.ouvrir((await t.store.get("vieux"))!);
    await t.ouvert.relire();
    return t;
  }

  it("touche le moins récent au-delà de la limite, et rien ne s'y enregistre", async () => {
    const t = await deux();
    expect(t.ouvert.lectureSeule).toBe(true);
    t.ouvert.change((p) => renamed(p, "Renommé", Date.now()));
    t.ouvert.regle({ ...DEFAULTS, H: 3000 });
    expect((await t.store.get("vieux"))!).toMatchObject({ nom: "vieux", modifie: 10 });
  });

  it("épargne l'escalier le plus récent", async () => {
    const t = await deux();
    t.ouvert.ouvrir((await t.store.get("recent"))!);
    expect(t.ouvert.lectureSeule).toBe(false);
    t.ouvert.change((p) => renamed(p, "Renommé", Date.now()));
    expect((await t.store.get("recent"))!.nom).toBe("Renommé");
  });

  it("se lève avec un abonnement, et l'écran est prévenu", async () => {
    const t = await deux();
    const avant = t.affiches();
    t.ouvert.niveau(DROITS.payant);
    await t.ouvert.relire();
    expect(t.ouvert.lectureSeule).toBe(false);
    expect(t.affiches()).toBeGreaterThan(avant);
  });

  it("ne vaut pas pour un escalier reçu, qui n'est pas encore dans la liste", async () => {
    const t = await deux();
    await t.ouvert.lien(LIEN);
    expect(t.ouvert.lectureSeule).toBe(false);
  });
});

describe("réglages changés", () => {
  it("enregistre l'escalier ouvert, et repasse un escalier terminé en brouillon", async () => {
    const t = page(DROITS.premium, withEtat(garde("a", 10), "fini", 10));
    await t.ouvert.demarrer(null);
    expect(t.ouvert.regle(t.ouvert.projet!.params)).toBe("inchange");
    expect(t.ouvert.regle({ ...DEFAULTS, H: 3000 })).toBe("brouillon");
    expect((await t.store.get("a"))!).toMatchObject({ etat: "brouillon", params: { H: 3000 } });
    expect(t.ouvert.regle({ ...DEFAULTS, H: 3050 })).toBe("modifie");
    expect((await t.store.get("a"))!.params.H).toBe(3050);
  });

  it("n'a rien à faire sans escalier ouvert", () => {
    const t = page();
    expect(t.ouvert.regle({ ...DEFAULTS, H: 3000 })).toBe("inchange");
    t.ouvert.change(() => {
      throw new Error("pas d'escalier");
    });
  });
});

describe("changé ou supprimé ailleurs", () => {
  it("prend la version reçue d'ailleurs", async () => {
    const t = page(DROITS.premium, garde("a", 10));
    await t.ouvert.demarrer(null);
    await t.store.save({ ...garde("a", 50), nom: "Modifié ailleurs" });
    await t.ouvert.ailleurs(["a"]);
    expect(t.ouvert.projet!.nom).toBe("Modifié ailleurs");
    expect(t.vus.at(-1)).toEqual(["a", "version"]);
  });

  it("ne reprend que le devis d'une même version", async () => {
    const t = page(DROITS.premium, garde("a", 10));
    await t.ouvert.demarrer(null);
    const devis = newDevis();
    await t.store.save({ ...garde("a", 10), nom: "ignoré", devis });
    await t.ouvert.ailleurs(["a"]);
    expect(t.ouvert.projet).toMatchObject({ nom: "a", devis });
    expect(t.vus.at(-1)).toEqual(["a", "devis"]);
  });

  it("laisse la place au plus récent quand l'escalier ouvert est supprimé, et il devient courant", async () => {
    const t = page(DROITS.premium, garde("b", 10), garde("a", 20));
    await t.ouvert.demarrer(null);
    expect(t.ouvert.projet!.id).toBe("a");
    await t.store.remove("a");
    await t.ouvert.ailleurs(["a"]);
    expect(t.ouvert.projet!.id).toBe("b");
    expect(t.vus.at(-1)).toEqual(["b", "supprime"]);
    expect(await t.store.currentId()).toBe("b");
  });

  it("ne laisse aucun escalier quand il n'en reste pas", async () => {
    const t = page(DROITS.premium, garde("a", 10));
    await t.ouvert.demarrer(null);
    await t.store.remove("a");
    await t.ouvert.ailleurs(["a"]);
    expect(t.ouvert.projet).toBeNull();
    expect(t.vus.at(-1)).toEqual([null, "supprime"]);
  });

  it("ignore les changements d'autres escaliers", async () => {
    const t = page(DROITS.premium, garde("b", 10), garde("a", 20));
    await t.ouvert.demarrer(null);
    const avant = t.vus.length;
    await t.ouvert.ailleurs(["b"]);
    expect(t.vus).toHaveLength(avant);
  });
});
