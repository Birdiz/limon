import { describe, expect, it } from "vitest";
import { buildCNC, stockVolume } from "../src/cnc/build";
import { quantites } from "../src/cnc/quantites";
import { SAISIE_DEFAUT, devis, type Quantites, type Saisie } from "../src/core/devis";
import { DEFAULTS, type Params } from "../src/core/params";
import { compute, type Stair } from "../src/core/stair";
import { TARIFS_VIDES, type Tarifs } from "../src/core/tarifs";

function stair(p: Partial<Params> = {}): Stair {
  const r = compute({ ...DEFAULTS, ...p }, false);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join(" ; "));
  return r.stair;
}

/** Un escalier compté à la main : 10 marches droites, 4 balancées. */
const Q: Quantites = {
  ess: "chene",
  volume: 0.4,
  marches: 10,
  balancees: 4,
  paliers: 0,
  contremarches: 15,
  limons: 9.5,
  poteaux: 1,
  mainCourante: 0,
  balustres: 0,
  lisses: 0,
  surface: 12.5,
};

const T: Tarifs = {
  ...TARIFS_VIDES,
  bois: { ...TARIFS_VIDES.bois, chene: 1800 },
  perte: 10,
  coef: 1.2,
  quincEscalier: 30,
  quincMarche: 2,
  finition: 8,
  taux: 45,
  heures: {
    ...TARIFS_VIDES.heures,
    prepa: 4,
    marche: 1.5,
    balancee: 3,
    palier: 2,
    contremarche: 0.5,
    limon: 2,
    poteau: 3,
    finition: 0.2,
    poseEscalier: 4,
    poseMarche: 0.25,
  },
  deplForfait: 50,
  deplKm: 0.5,
};

const S: Saisie = { ...SAISIE_DEFAUT, tva: 10, km: 20 };
const total = (d: ReturnType<typeof devis>, id: string) => d.lignes.find((l) => l.id === id)?.total;

describe("devis chiffré", () => {
  it("donne chaque ligne au centime, depuis les quantités et les tarifs", () => {
    const d = devis(Q, T, S);
    expect(d.lignes.map((l) => l.id)).toEqual(["bois", "quincaillerie", "facon", "finition", "pose", "deplacement"]);
    // 0,4 m³ + 10 % = 0,44 m³ à 1 800 € × 1,2
    expect(d.lignes[0]).toMatchObject({ q: 0.44, unite: "m³", pu: 2160, total: 950.4 });
    // (30 + 2 × 14 marches) × 1,2
    expect(total(d, "quincaillerie")).toBe(69.6);
    // 4 + 10 × 1,5 + 4 × 3 + 15 × 0,5 + 9,5 × 2 + 3 + 12,5 × 0,2 = 63 h
    expect(d.lignes[2]).toMatchObject({ designation: "Fabrication de l'escalier", q: 63, pu: 45, total: 2835 });
    expect(total(d, "finition")).toBe(100);
    // 4 + 14 × 0,25 = 7,5 h ; 50 + 20 km × 0,5
    expect(total(d, "pose")).toBe(337.5);
    expect(total(d, "deplacement")).toBe(60);
    expect(d.totalLignes).toBe(4352.5);
    expect(d.tva).toEqual([{ taux: 10, base: 4352.5, montant: 435.25 }]);
    expect(d.totalTTC).toBe(4787.75);
    expect(d.aCompleter).toEqual([]);
    // Achat : 0,44 m³ × 1 800 € + 58 € de quincaillerie, sans coefficient ; 63 h d'atelier + 7,5 h de pose
    expect(d.debourse).toEqual({ fournitures: 850, heures: 70.5 });
  });

  it("applique une remise en pourcentage, arrondie au centime", () => {
    const d = devis(Q, T, { ...S, remise: { pct: 5 } });
    expect(d.remise).toBe(217.63);
    expect(d.totalHT).toBe(4134.87);
    expect(d.tva).toEqual([{ taux: 10, base: 4134.87, montant: 413.49 }]);
    expect(d.totalTTC).toBe(4548.36);
  });

  it("répartit la remise sur les taux de TVA sans perdre un centime", () => {
    const libre = { designation: "Garde-corps d'étage", q: 3, unite: "m", pu: 333.33, tva: 20 };
    const d = devis(Q, T, { ...S, libres: [libre], remise: { eur: 100 } });
    expect(total(d, "libre-1")).toBe(999.99);
    expect(d.tva.map((t) => t.taux)).toEqual([20, 10]);
    const bases = d.tva.reduce((s, t) => s + Math.round(t.base * 100), 0);
    expect(bases).toBe(Math.round(d.totalHT * 100));
    expect(d.totalHT).toBe(Math.round((4352.5 + 999.99 - 100) * 100) / 100);
    expect(d.totalTTC).toBe(Math.round((d.totalHT + d.tva[0]!.montant + d.tva[1]!.montant) * 100) / 100);
  });

  it("laisse à compléter les lignes dont le tarif est vide, sans les compter", () => {
    const d = devis(Q, TARIFS_VIDES, S);
    expect(d.lignes.every((l) => l.total === null)).toBe(true);
    expect(d.totalTTC).toBe(0);
    expect(d.aCompleter).toEqual([
      "Prix du bois : chêne",
      "Quincaillerie",
      "Heures : dessin et préparation (par escalier)",
      "Heures : marche droite (par marche)",
      "Heures : marche balancée (par marche)",
      "Heures : contremarche (par pièce)",
      "Heures : limon (par mètre)",
      "Heures : poteau (par poteau)",
      "Heures : finition (par m²)",
      "Taux horaire",
      "Produit de finition",
      "Heures : pose (par escalier)",
      "Heures : pose (par marche)",
      "Déplacement de pose",
    ]);
  });

  it("garde les corrections de l'artisan et retire ce qu'il enlève", () => {
    const d = devis(
      Q,
      { ...T, finition: null },
      { ...S, corrections: { bois: { pu: 2000 }, finition: { retiree: true }, deplacement: { designation: "Venue" } } },
    );
    expect(d.lignes.find((l) => l.id === "bois")).toMatchObject({ pu: 2000, total: 880, corrigee: true });
    expect(d.lignes.find((l) => l.id === "finition")).toBeUndefined();
    expect(d.lignes.find((l) => l.id === "deplacement")).toMatchObject({ designation: "Venue", corrigee: true });
    expect(d.lignes.find((l) => l.id === "facon")!.corrigee).toBe(false);
    expect(d.aCompleter).toEqual([]);
  });

  it("met la fourniture seule à 20 %, en le disant", () => {
    const d = devis(Q, T, { ...S, pose: false });
    expect(d.lignes.map((l) => l.id)).not.toContain("pose");
    expect(d.lignes.every((l) => l.tva === 20)).toBe(true);
    expect(d.alertes).toEqual(["Fourniture seule, sans pose : TVA à 20 %."]);
  });

  it("détaille la façon par poste quand l'artisan le veut, aux mêmes heures", () => {
    const d = devis(Q, { ...T, heures: { ...T.heures, poteau: null } }, { ...S, faconDetail: true });
    const facon = d.lignes.filter((l) => l.id.startsWith("facon-"));
    expect(facon.map((l) => l.id)).toEqual([
      "facon-prepa",
      "facon-marche",
      "facon-balancee",
      "facon-contremarche",
      "facon-limon",
      "facon-poteau",
      "facon-finition",
    ]);
    expect(facon.find((l) => l.id === "facon-marche")!.designation).toBe("Façon : marche droite (10 × 1,5 h)");
    // Seul le poteau, sans temps, reste à compléter.
    expect(facon.filter((l) => l.total === null).map((l) => l.id)).toEqual(["facon-poteau"]);
    expect(d.aCompleter).toEqual(["Heures : poteau (par poteau)"]);
    expect(facon.reduce((s, l) => s + (l.q ?? 0), 0)).toBe(63 - 3);
  });

  it("ajoute la livraison à la distance du chantier", () => {
    const d = devis(Q, { ...T, livForfait: 80, livKm: 1 }, { ...S, livraison: true });
    expect(total(d, "livraison")).toBe(100);
  });
});

describe("quantités tirées de l'escalier", () => {
  it("comptent les marches, les pièces débitées et le bois de l'exemple", () => {
    const R = stair();
    const cnc = buildCNC(R);
    const q = quantites(R, cnc);
    expect(q.marches + q.balancees + q.paliers).toBe(R.treads.length + (R.mp ? 1 : 0));
    expect(q.balancees).toBeGreaterThan(0);
    expect(q.contremarches).toBe(cnc.riserParts.length);
    expect(q.poteaux).toBe(R.newels.length);
    expect(q.volume).toBe(stockVolume(cnc, R));
    expect(q.limons).toBeCloseTo(cnc.boardParts.reduce((s, b) => s + b.L, 0) / 1000, 6);
    expect(q.surface).toBeGreaterThan(2 * q.volume);
    expect([q.mainCourante, q.balustres, q.lisses]).toEqual([0, 0, 0]);
  });

  it("comptent le palier et le garde-corps quand il y en a", () => {
    const R = stair({ tournant: "palier", gc: "balustres" });
    const q = quantites(R, buildCNC(R));
    expect(q.balancees).toBe(0);
    expect(q.paliers).toBeGreaterThan(0);
    expect(q.balustres).toBeGreaterThan(0);
    expect(q.mainCourante).toBeGreaterThan(0);
  });

  it("donnent un devis complet avec des tarifs complets", () => {
    const R = stair({ gc: "lisses" });
    const full: Tarifs = { ...T, heures: { ...T.heures, mainCourante: 1, balustre: 0.5, lisse: 0.5 } };
    const d = devis(quantites(R, buildCNC(R)), full, S);
    expect(d.aCompleter).toEqual([]);
    expect(d.lignes.every((l) => l.total !== null && l.total > 0)).toBe(true);
    const sum = d.lignes.reduce((s, l) => s + Math.round(l.total! * 100), 0);
    expect(Math.round(d.totalLignes * 100)).toBe(sum);
  });
});
