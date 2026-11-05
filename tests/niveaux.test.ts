import { describe, expect, it } from "vitest";
import { DROITS, enLecture, formeOuverte, niveauActif, niveauDe } from "../src/core/niveaux";

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
