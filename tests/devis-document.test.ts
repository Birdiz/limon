import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCNC } from "../src/cnc/build";
import { quantites } from "../src/cnc/quantites";
import {
  SAISIE_DEFAUT,
  devis,
  etatRemis,
  finValidite,
  newDevis,
  noterReponse,
  remettre,
  sanitizeDevis,
  versionRemise,
  type DevisProjet,
  type Saisie,
} from "../src/core/devis";
import { DEFAULTS } from "../src/core/params";
import { newProject, parseProjectFile, projectFile, withDevis, type Project } from "../src/core/project";
import { compute } from "../src/core/stair";
import { ENTREPRISE_VIDE, TARIFS_VIDES, type Entreprise, type Tarifs } from "../src/core/tarifs";
import { TVA_REDUITE, devisPDF, type DevisPdf } from "../src/pdf/devis";

const r = compute(DEFAULTS, false);
if (!r.ok) throw new Error("exemple");
const R = r.stair;
const Q = quantites(R, buildCNC(R));

const T: Tarifs = {
  ...TARIFS_VIDES,
  bois: { ...TARIFS_VIDES.bois, chene: 1800 },
  perte: 10,
  coef: 1.2,
  quincEscalier: 30,
  quincMarche: 2,
  finition: 8,
  taux: 45,
  validite: 30,
  deplForfait: 50,
  heures: { ...TARIFS_VIDES.heures, prepa: 4, marche: 1.5, balancee: 3, limon: 2, poteau: 3, contremarche: 0.5 },
};
T.heures.poseEscalier = 4;
T.heures.poseMarche = 0.25;
T.heures.finition = 0.2;

const E: Entreprise = {
  ...ENTREPRISE_VIDE,
  nom: "Menuiserie Bouzy",
  forme: "EI",
  adresse: "12 rue des Ateliers\n44000 Nantes",
  telephone: "06 12 34 56 78",
  siren: "732 829 320",
  immat: "RM 44",
  tva: "FR40732829320",
  assureur: "MAAF Assurances",
  assureurAdresse: "Chaban\n79180 Chauray",
  contrat: "123456789",
  couverture: "France métropolitaine",
  mediateur: "CNPM Médiation consommation",
  paiement: "Solde à la fin de la pose, par virement.",
  dechets: "Déchets repris par l'entreprise.",
};

const S: Saisie = {
  ...SAISIE_DEFAUT,
  tva: 10,
  acompte: 30,
  delai: "semaine 48",
  libres: [{ designation: "Dépose de l'ancien escalier", q: 1, unite: "forfait", pu: 350, tva: 20 }],
  remise: { pct: 5 },
};

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
const options = (over: Partial<DevisPdf> = {}): DevisPdf => ({
  entreprise: E,
  client: { nom: "M. et Mme Dupont", adresse: "8 allée des Tilleuls\n44300 Nantes", chantier: "" },
  saisie: S,
  chiffrage: devis(Q, T, S),
  nom: "Escalier Dupont",
  params: R.params,
  stair: R,
  numero: "2026-0012",
  version: 1,
  date: "31/10/2026",
  validite: 30,
  jusquAu: "30/11/2026",
  ...over,
});

describe("versions remises", () => {
  const d0: DevisProjet = { ...newDevis(10), client: { nom: "Dupont", adresse: "Nantes", chantier: "" }, saisie: S };
  const v = {
    numero: "2026-0012",
    nom: "Escalier Dupont",
    params: R.params,
    tarifs: T,
    entreprise: E,
    chiffrage: devis(Q, T, S),
  };
  const now = new Date(2026, 9, 31, 15).getTime();
  const d1 = remettre(d0, v, now);

  it("figent une copie, indépendante de ce qui suit", () => {
    expect(d1.remis[0]).toMatchObject({ version: 1, remisLe: now, validite: 30, etat: "remis", etatLe: 0 });
    d1.saisie.libres.push({ designation: "Option", q: 1, unite: "u", pu: 10, tva: 20 });
    expect(d1.remis[0]!.saisie.libres).toHaveLength(1);
    d1.saisie.libres.pop();
  });

  it("tiennent lieu de devis tant que l'escalier ne change pas", () => {
    expect(versionRemise(d0, R.params)).toBeNull();
    expect(versionRemise(d1, R.params)).toBe(d1.remis[0]);
    expect(versionRemise(d1, { ...R.params, W: R.params.W + 10 })).toBeNull();
    expect(versionRemise({ ...d1, rouvert: true }, R.params)).toBeNull();
    const d2 = remettre({ ...d1, rouvert: true }, v, now + 1);
    expect(d2.remis.map((x) => x.version)).toEqual([1, 2]);
    expect(d2.rouvert).toBe(false);
  });

  it("valent jusqu'au soir du dernier jour, puis expirent sans réponse", () => {
    const r1 = d1.remis[0]!;
    expect(finValidite(r1)).toBe(new Date(2026, 10, 30, 23, 59, 59, 999).getTime());
    expect(etatRemis(r1, finValidite(r1))).toBe("remis");
    expect(etatRemis(r1, finValidite(r1) + 1)).toBe("expire");
    const ok = noterReponse(d1, 1, "accepte", now + 5).remis[0]!;
    expect(etatRemis(ok, finValidite(r1) + 1)).toBe("accepte");
    expect(ok.etatLe).toBe(now + 5);
  });

  it("suivent l'escalier dans le fichier et se relisent sans rien garder de faux", () => {
    const p = withDevis(newProject("a", "Escalier Dupont", "complet", 1), d1, 5);
    expect((parseProjectFile(projectFile(p), "b") as Project).devis).toEqual(d1);
    const bad = sanitizeDevis({
      ...JSON.parse(JSON.stringify(d1)),
      rouvert: "oui",
      remis: [
        { ...JSON.parse(JSON.stringify(d1.remis[0])), etat: "signé", version: -2, validite: "30" },
        { numero: "12" },
        null,
      ],
    })!;
    expect(bad.remis).toHaveLength(1);
    expect(bad.remis[0]).toMatchObject({ etat: "remis", version: 1, validite: 30 });
    expect(bad.rouvert).toBe(false);
    expect(bad.remis[0]!.chiffrage).toEqual(d1.remis[0]!.chiffrage);
  });

  it("calculent l'acompte sur le TTC, arrondi au centime", () => {
    const D = devis(Q, T, S);
    expect(D.acompte).toBe(Math.round(D.totalTTC * 30) / 100);
    expect(devis(Q, T, { ...S, acompte: null }).acompte).toBeNull();
  });
});

describe("document du devis", () => {
  const pdf = devisPDF(options());
  const s = latin1(pdf);

  it("produit le même PDF", () => {
    const file = new URL("__snapshots__/devis.pdf", import.meta.url);
    if (!existsSync(file)) writeFileSync(file, pdf);
    expect(Buffer.from(pdf).equals(readFileSync(file))).toBe(true);
  });

  it("porte l'entreprise, le client, le numéro, les totaux et les mentions", () => {
    expect(s.startsWith("%PDF-1.4\n%")).toBe(true);
    for (const t of [
      "(DEVIS) Tj",
      "(N\\260 2026-0012) Tj",
      "(Valable jusqu'au 30/11/2026) Tj",
      "(M. et Mme Dupont) Tj",
      "(Menuiserie Bouzy) Tj",
      "(Total TTC) Tj",
      "(TVA \\300 TAUX R\\311DUIT) Tj",
      "(ASSURANCE D\\311CENNALE) Tj",
      "(M\\311DIATION) Tj",
      "(BON POUR ACCORD) Tj",
      "(SIGNATURE DU CLIENT) Tj",
      "(Annexe : l'escalier) Tj",
      "(Couverture g\\351ographique : France m\\351tropolitaine) Tj",
    ])
      expect(s).toContain(t);
    expect(s).toMatch(/\(Acompte \\340 la commande : 30 % du total TTC, soit [\d ,\\]+\\200\.\) Tj/);
    expect(s).toContain("(Remise) Tj");
    expect(s).not.toContain("BROUILLON");
    // Rien de l'atelier : ni liste de débit, ni marge, ni fichiers pour la machine.
    for (const t of ["bit) Tj", "marge", "DXF", "Fournitures achet"])
      expect(s.toLowerCase()).not.toContain(t.toLowerCase());
  });

  it("ne met la mention de TVA réduite que s'il y a une ligne à taux réduit", () => {
    expect(TVA_REDUITE.startsWith("En signant ce devis, le client certifie")).toBe(true);
    expect(s).toContain("(En signant ce devis, le client certifie");
    const S20 = { ...S, tva: 20 as const };
    const plein = latin1(devisPDF(options({ saisie: S20, chiffrage: devis(Q, T, S20) })));
    expect(plein).not.toContain("TAUX R\\311DUIT");
  });

  it("passe à la page suivante avec beaucoup de lignes, en reprenant l'en-tête du tableau", () => {
    const S2 = {
      ...S,
      libres: Array.from({ length: 60 }, (_, i) => ({
        designation: `Option ${i + 1}`,
        q: 1,
        unite: "u",
        pu: 10,
        tva: 20,
      })),
    };
    const long = latin1(devisPDF(options({ saisie: S2, chiffrage: devis(Q, T, S2) })));
    const pages = long.match(/\/Type \/Page /g)!.length;
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(long.match(/\(D\\311SIGNATION\) Tj/g)!.length).toBeGreaterThanOrEqual(2);
    expect(long).toContain("(Devis n\\260 2026-0012 \\267 suite) Tj");
    expect(long).toContain(`(page ${pages}/${pages}) Tj`);
    expect(long).toContain("(Option 60) Tj");
  });

  it("marque le brouillon, sans numéro, et se passe d'annexe sans escalier", () => {
    const b = latin1(devisPDF(options({ numero: null, stair: null, jusquAu: null })));
    expect(b).toContain("(Brouillon : num\\351ro donn\\351 \\340 la remise) Tj");
    expect(b.match(/1 Tr \(BROUILLON\) Tj/g)!.length).toBe(b.match(/\/Type \/Page /g)!.length);
    expect(b).not.toContain("Annexe");
    expect(b).toContain("(Valable 30 jours) Tj");
  });
});
