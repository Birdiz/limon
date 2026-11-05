import { describe, expect, it } from "vitest";
import {
  DROITS,
  enLecture,
  formeOuverte,
  niveauActif,
  niveauDe,
  offreVue,
  prixEuros,
  statutReel,
  PRIX,
} from "../src/core/niveaux";

describe("niveaux", () => {
  it("donne son niveau à chaque compte, le gratuit sans compte ou après l'abonnement", () => {
    expect(niveauDe(null)).toBe("gratuit");
    expect(niveauDe("expire")).toBe("gratuit");
    expect(niveauDe("abonne")).toBe("payant");
    expect(niveauDe("premium")).toBe("premium");
    expect(niveauDe("essai")).toBe("premium");
    expect(niveauDe("testeur")).toBe("premium");
  });

  it("laisse tout ouvert sans la préférence, avant le paiement en ligne", () => {
    expect(niveauActif(null, null)).toBe("premium");
    expect(niveauActif(null, "expire")).toBe("premium");
    expect(niveauActif("n'importe quoi", null)).toBe("premium");
  });

  it("applique un niveau forcé, ou celui du compte sur demande", () => {
    expect(niveauActif("gratuit", "testeur")).toBe("gratuit");
    expect(niveauActif("payant", null)).toBe("payant");
    expect(niveauActif("compte", "abonne")).toBe("payant");
    expect(niveauActif("compte", null)).toBe("gratuit");
  });

  it("une fois activé, suit le compte, et une préférence ne peut que baisser", () => {
    expect(niveauActif(null, "abonne", true)).toBe("payant");
    expect(niveauActif(null, "expire", true)).toBe("gratuit");
    expect(niveauActif(null, null, true)).toBe("gratuit");
    expect(niveauActif("gratuit", "testeur", true)).toBe("gratuit");
    expect(niveauActif("payant", "premium", true)).toBe("payant");
    expect(niveauActif("payant", "expire", true)).toBe("gratuit");
    expect(niveauActif("payant", null, true)).toBe("gratuit");
    expect(niveauActif("premium", "expire", true)).toBe("gratuit");
  });

  it("une date passée ramène au gratuit, sauf le testeur, à vie", () => {
    const J = 86_400_000;
    const now = 1000 * J;
    expect(statutReel(null, now)).toBeNull();
    expect(statutReel({ statut: "testeur", droitsJusquA: null }, now)).toBe("testeur");
    expect(statutReel({ statut: "testeur" }, now)).toBe("testeur");
    expect(statutReel({ statut: "essai", droitsJusquA: now + 1 }, now)).toBe("essai");
    expect(statutReel({ statut: "essai", droitsJusquA: now }, now)).toBe("expire");
    expect(statutReel({ statut: "essai", droitsJusquA: null }, now)).toBe("expire");
    // Une période payée a sa marge : le site a pu ne pas entendre le renouvellement.
    expect(statutReel({ statut: "abonne", droitsJusquA: now - 6 * J }, now)).toBe("abonne");
    expect(statutReel({ statut: "premium", droitsJusquA: now - 8 * J }, now)).toBe("expire");
    expect(statutReel({ statut: "expire", droitsJusquA: null }, now)).toBe("expire");
  });

  it("écrit les prix comme sur la page publique", () => {
    expect([PRIX.payant.mois, PRIX.payant.an, PRIX.premium.mois, PRIX.premium.an].map(prixEuros)).toEqual([
      "9 €",
      "100 €",
      "12,50 €",
      "140 €",
    ]);
  });

  describe("l'offre dans Mon compte", () => {
    const now = Date.UTC(2026, 10, 5, 12);
    const J = 86_400_000;
    const base = { droitsJusquA: now + 20 * J, resilie: false, gestion: false };
    it("essai : la date, le choix, et le premier prélèvement qui attend sa fin", () => {
      const v = offreVue({ ...base, statut: "essai" }, now);
      expect(v.texte).toContain("jusqu'au 25/11/2026");
      expect(v.choix).toBe(true);
      expect(v.note).toContain("25/11/2026");
      expect(offreVue({ ...base, statut: "essai", droitsJusquA: now + J }, now).note).toBe("");
    });
    it("abonné : la prochaine échéance, ou l'arrêt demandé, et la gestion", () => {
      const v = offreVue({ ...base, statut: "abonne", gestion: true }, now);
      expect(v).toMatchObject({ choix: false, gerer: true });
      expect(v.texte).toContain("Pour fabriquer");
      expect(v.texte).toContain("Prochain prélèvement");
      const r = offreVue({ ...base, statut: "premium", gestion: true, resilie: true }, now);
      expect(r.texte).toContain("Pour vendre");
      expect(r.texte).toContain("s'arrête");
      expect(r.texte).toContain("tous vos escaliers");
    });
    it("gratuit : le choix, et les factures d'un ancien abonné", () => {
      const v = offreVue({ ...base, statut: "expire", droitsJusquA: null }, now);
      expect(v).toMatchObject({ choix: true, gerer: false });
      expect(offreVue({ ...base, statut: "expire", droitsJusquA: null, gestion: true }, now).gerer).toBe(true);
    });
    it("testeur : rien à choisir", () => {
      expect(offreVue({ ...base, statut: "testeur", droitsJusquA: null }, now)).toMatchObject({
        choix: false,
        gerer: false,
      });
    });
    it("aucun mot de l'informatique ni de réseau", () => {
      for (const statut of ["essai", "abonne", "premium", "expire", "testeur"] as const)
        expect(offreVue({ ...base, statut }, now).texte).not.toMatch(/réseau|serveur|premium|Stripe/i);
    });
  });

  it("ouvre au gratuit le droit et le quart tournant, pas les formes en U", () => {
    expect(formeOuverte(DROITS.gratuit, "droit")).toBe(true);
    expect(formeOuverte(DROITS.gratuit, "quart-g")).toBe(true);
    expect(formeOuverte(DROITS.gratuit, "dq-d")).toBe(false);
    expect(formeOuverte(DROITS.gratuit, "demi-g")).toBe(false);
    expect(formeOuverte(DROITS.payant, "demi-g")).toBe(true);
  });

  it("réserve le devis au premium et la fabrication aux abonnés", () => {
    expect(DROITS.payant.devis).toBe(false);
    expect(DROITS.premium.devis).toBe(true);
    expect(DROITS.gratuit.fabrication).toBe(false);
    expect(DROITS.payant.fabrication).toBe(true);
  });

  it("garde modifiable le plus récent au gratuit, et ne verrouille rien au-dessus", () => {
    const projets = [{ id: "recent" }, { id: "b" }, { id: "c" }];
    expect([...enLecture(DROITS.gratuit, projets)]).toEqual(["b", "c"]);
    expect(enLecture(DROITS.payant, projets).size).toBe(0);
    expect(enLecture(DROITS.gratuit, []).size).toBe(0);
  });
});
