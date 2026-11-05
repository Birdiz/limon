import { describe, expect, it } from "vitest";
import { DATE_REFUSEE } from "../src/core/account";
import { buildCNC } from "../src/cnc/build";
import { quantites } from "../src/cnc/quantites";
import { MAX_OCTETS, SAISIE_DEFAUT, devis, newDevis, remettre, type DevisProjet } from "../src/core/devis";
import { DEFAULTS } from "../src/core/params";
import { newProject, SCHEMA, type Project } from "../src/core/project";
import { compute } from "../src/core/stair";
import { ENTREPRISE_VIDE, TARIFS_VIDES } from "../src/core/tarifs";
import {
  fusionne,
  ID_REFUSE,
  ILLISIBLE,
  lisEnvoi,
  pese,
  SCHEMA_INCONNU,
  SCHEMA_PLUS_HAUT,
  TROP_LOURD,
  type Envoi,
  type Ligne,
} from "../server/fusion";

/* La décision de `PUT /projets`, sans la base : ce que `rangeProjet` écrit, la ligne lue. */

const JOUR = 86_400_000;
const r = compute(DEFAULTS, false);
if (!r.ok) throw new Error("exemple");
const Q = quantites(r.stair, buildCNC(r.stair));
const leger = devis(Q, TARIFS_VIDES, SAISIE_DEFAUT);
const T = "é".repeat(200);
/** Un devis rempli jusqu'aux bornes : chaque version remise pèse près de 100 ko. */
const plein: DevisProjet = {
  ...newDevis(),
  client: { nom: T, adresse: "é".repeat(2000), chantier: "é".repeat(2000) },
  saisie: {
    ...SAISIE_DEFAUT,
    libres: Array.from({ length: 100 }, () => ({ designation: T, q: 1, unite: "forfait", pu: 350, tva: 20 as const })),
  },
};
const lourd = devis(Q, TARIFS_VIDES, plein.saisie);
const version = { numero: "2026-0001", nom: "a", params: DEFAULTS, tarifs: TARIFS_VIDES, entreprise: ENTREPRISE_VIDE };

const projet = (modifie: number, d: DevisProjet | null = null, autre: Partial<Project> = {}): Project => ({
  ...newProject("a", "a", "complet", 1),
  modifie,
  devis: d,
  ...autre,
});
/** Versions remises aux dates données, l'une après l'autre. */
const remises = (dates: number[], depart: DevisProjet = newDevis(), chiffrage = leger) =>
  dates.reduce((d, le) => remettre(d, { ...version, chiffrage }, le), depart);
const ligne = (p: Project): Ligne => ({ modifie: p.modifie, donnees: p });
/** Version reçue telle que la route la relit. */
function envoi(p: unknown): Envoi {
  const e = lisEnvoi({ id: "a", projet: p });
  if (typeof e === "string") throw new Error(e);
  return e;
}
const suppression = (modifie: number): Envoi => ({ id: "a", supprime: true, modifie });
/** `o` sans les clés données, comme l'envoie une version qui ne les connaît pas. */
const sans = (o: object, ...cles: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !cles.includes(k)));
const datesRemises = (p: Project | null) => p?.devis?.remis.map((v) => v.remisLe);

describe("lisEnvoi", () => {
  it("refuse un identifiant hors format, ou absent", () => {
    expect(lisEnvoi({ id: "a b", projet: projet(1) })).toBe(ID_REFUSE);
    expect(lisEnvoi(null)).toBe(ID_REFUSE);
    expect(lisEnvoi("a")).toBe(ID_REFUSE);
  });

  it("relit une suppression sans regarder le projet, à une date possible", () => {
    expect(lisEnvoi({ id: "a", supprime: true, modifie: 5, projet: "illisible" })).toEqual(suppression(5));
    expect(lisEnvoi({ id: "a", supprime: true, modifie: 1.5 })).toBe(DATE_REFUSEE);
    expect(lisEnvoi({ id: "a", supprime: true })).toBe(DATE_REFUSEE);
    expect(lisEnvoi({ id: "a", supprime: true, modifie: Date.now() + 800 * JOUR })).toBe(DATE_REFUSEE);
  });

  it("refuse un schéma plus haut que le serveur, un projet illisible, une date impossible", () => {
    expect(lisEnvoi({ id: "a", projet: projet(1, null, { schema: SCHEMA + 1 }) })).toBe(SCHEMA_INCONNU);
    expect(lisEnvoi({ id: "a", projet: "a" })).toBe(ILLISIBLE);
    expect(lisEnvoi({ id: "a" })).toBe(ILLISIBLE);
    expect(lisEnvoi({ id: "a", projet: projet(-1) })).toBe(DATE_REFUSEE);
    expect(lisEnvoi({ id: "a", projet: projet(Date.now() + 800 * JOUR) })).toBe(DATE_REFUSEE);
    expect(typeof lisEnvoi({ id: "a", projet: projet(Date.now() + 700 * JOUR) })).toBe("object");
  });

  it("garde l'identifiant de l'envoi, coupe le nom, et retient ce qui a vraiment été envoyé", () => {
    const brut = { ...projet(1), id: "b", nom: `x\u0007${"y".repeat(100)}` };
    const e = envoi(brut);
    if (e.supprime) throw new Error("suppression");
    expect(e.projet.id).toBe("a");
    expect(e.projet.nom).toBe("x" + "y".repeat(79));
    expect(e.brut).toEqual({ ...brut, id: "a" });
  });

  it("refuse un projet trop lourd", () => {
    const p = projet(1, remises([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], plein, lourd));
    expect(pese(p)).toBeGreaterThan(MAX_OCTETS);
    expect(lisEnvoi({ id: "a", projet: p })).toBe(TROP_LOURD);
  });
});

describe("fusionne", () => {
  it("un nouvel escalier crée la ligne, tel quel", () => {
    const e = envoi(projet(5));
    expect(fusionne(undefined, e)).toEqual({ geste: "remplacer", modifie: 5, donnees: projet(5), partie: null });
  });

  it("la plus récente gagne sur `modifie` ; à date égale, la ligne reste", () => {
    const f = fusionne(ligne(projet(4)), envoi(projet(5, null, { nom: "b" })));
    expect(f).toMatchObject({ geste: "remplacer", modifie: 5, donnees: { nom: "b" } });
    expect(fusionne(ligne(projet(5)), envoi(projet(5, null, { nom: "b" })))).toEqual({
      geste: "repondre",
      raison: null,
    });
    expect(fusionne(ligne(projet(6)), envoi(projet(5)))).toEqual({ geste: "repondre", raison: null });
  });

  it("une suppression plus récente passe, quel que soit le schéma de la ligne ; plus ancienne, rien ne change", () => {
    const remplace = { geste: "remplacer", modifie: 7, donnees: null, partie: null };
    expect(fusionne(undefined, suppression(7))).toEqual(remplace);
    expect(fusionne(ligne(projet(6)), suppression(7))).toEqual(remplace);
    expect(fusionne(ligne(projet(6, null, { schema: SCHEMA + 1 })), suppression(7))).toEqual(remplace);
    expect(fusionne({ modifie: 6, donnees: null }, suppression(7))).toEqual(remplace);
    expect(fusionne(ligne(projet(8)), suppression(7))).toEqual({ geste: "repondre", raison: null });
  });

  it("une version récente qui remplace une trace de suppression n'en garde rien", () => {
    expect(fusionne({ modifie: 6, donnees: null }, envoi(projet(7)))).toMatchObject({
      geste: "remplacer",
      modifie: 7,
      partie: null,
    });
  });

  it("plus récente mais de schéma plus bas que la ligne : refusée et nommée", () => {
    const haute = ligne(projet(4, null, { schema: SCHEMA + 1 }));
    expect(fusionne(haute, envoi(projet(5)))).toEqual({ geste: "repondre", raison: SCHEMA_PLUS_HAUT });
    // Plus ancienne, elle ne passait pas de toute façon : pas de refus.
    expect(fusionne(ligne(projet(6, null, { schema: SCHEMA + 1 })), envoi(projet(5)))).toEqual({
      geste: "repondre",
      raison: null,
    });
  });

  describe("envoi sans numéro de schéma", () => {
    const ancien = sans(projet(5, null, { nom: "b" }), "schema");
    const brut = { ...ancien, params: { H: 2800, L: "abîmé" } };

    it("ne fusionne que les clés vraiment envoyées, et les réglages lisibles", () => {
      const f = fusionne(ligne(projet(4)), envoi(brut));
      if (f.geste !== "remplacer") throw new Error(f.geste);
      expect(f.donnees).toMatchObject({ schema: 0, nom: "b", modifie: 5 });
      expect(f.partie).toEqual({ ...ancien, params: { H: 2800 } });
      expect(f.partie).not.toHaveProperty("schema");
    });

    it("se fusionne aussi dans une ligne de schéma plus haut : il n'y écrase que ce qu'il connaît", () => {
      const f = fusionne(ligne(projet(4, null, { schema: SCHEMA + 1 })), envoi(brut));
      expect(f).toMatchObject({ geste: "remplacer", modifie: 5, partie: { nom: "b", params: { H: 2800 } } });
    });

    it("garde ce qui manque au projet : `sanitizeProject` l'a rempli, la ligne garde le sien", () => {
      const f = fusionne(ligne(projet(4)), envoi(sans(ancien, "devis", "etat")));
      if (f.geste !== "remplacer") throw new Error(f.geste);
      expect(f.partie).not.toHaveProperty("devis");
      expect(f.partie).not.toHaveProperty("etat");
    });
  });

  describe("versions remises", () => {
    it("une version plus récente garde ce que seule la ligne a remis, et se date après elle", () => {
      const f = fusionne(ligne(projet(10, remises([100]))), envoi(projet(20, remises([200]))));
      if (f.geste !== "remplacer") throw new Error(f.geste);
      expect(datesRemises(f.donnees)).toEqual([100, 200]);
      expect(f.modifie).toBe(21);
      expect(f.donnees!.modifie).toBe(21);
    });

    it("une version perdante ajoute à la ligne ce qu'elle a remis, datée juste après la ligne", () => {
      const l = ligne(projet(20, remises([200]), { nom: "ligne" }));
      const f = fusionne(l, envoi(projet(10, remises([100]), { nom: "perdante" })));
      if (f.geste !== "completer") throw new Error(f.geste);
      expect(f.raison).toBeNull();
      expect(f.donnees.nom).toBe("ligne");
      expect(f.donnees.modifie).toBe(21);
      expect(datesRemises(f.donnees)).toEqual([100, 200]);
    });

    it("une version perdante sans rien de neuf ne change rien", () => {
      const d = remises([100]);
      expect(fusionne(ligne(projet(20, d)), envoi(projet(10, d)))).toEqual({ geste: "repondre", raison: null });
      expect(fusionne(ligne(projet(20, d)), envoi(projet(10)))).toEqual({ geste: "repondre", raison: null });
    });

    it("refusée pour son schéma, elle complète quand même la ligne, et le refus reste nommé", () => {
      // Une ligne de schéma plus haut que ce serveur n'est pas relue : rien ne la rejoint.
      const haute = ligne(projet(10, remises([100]), { schema: SCHEMA + 1 }));
      expect(fusionne(haute, envoi(projet(20, remises([200]))))).toEqual({
        geste: "repondre",
        raison: SCHEMA_PLUS_HAUT,
      });
    });

    it("trop lourdes une fois réunies : rien ne s'écrit, que la version reçue gagne ou perde", () => {
      const une = pese(projet(1, remises([1], plein, lourd))) - pese(projet(1, plein));
      const n = Math.floor((0.8 * MAX_OCTETS) / une);
      const dates = (depart: number) => Array.from({ length: n }, (_, i) => depart + i);
      const a = projet(10, remises(dates(1000), plein, lourd));
      const b = projet(20, remises(dates(5000), plein, lourd));
      expect(n).toBeGreaterThan(1);
      expect(pese(a)).toBeLessThanOrEqual(MAX_OCTETS);
      expect(pese(b)).toBeLessThanOrEqual(MAX_OCTETS);
      expect(fusionne(ligne(a), envoi(b))).toEqual({ geste: "repondre", raison: TROP_LOURD });
      expect(fusionne(ligne(b), envoi(a))).toEqual({ geste: "repondre", raison: TROP_LOURD });
    });
  });
});
