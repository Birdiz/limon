import { ESSENCES } from "../core/params";
import { ESSENCE_LABEL } from "../core/summary";
import {
  ENTREPRISE_LONGS,
  POSTES,
  POSTE_LABEL,
  sanitizeEntreprise,
  sanitizeTarifs,
  sirenOk,
  type Entreprise,
} from "../core/tarifs";
import type { AtelierHost, AtelierStore } from "./atelier";
import { byId } from "./dom";

/** Un champ de la fiche de l'entreprise. */
interface Texte {
  k: keyof Entreprise;
  l: string;
  s?: string;
  /** Aide de saisie du navigateur. */
  auto?: string;
  mode?: string;
  ex?: string;
}

/** Un montant des tarifs : chemin dans `Tarifs` (« taux », « bois.chene », « heures.marche »). */
interface Montant {
  k: string;
  l: string;
  s?: string;
  u: string;
  pas: number;
}

const ENTREPRISE: readonly { t: string; champs: readonly Texte[] }[] = [
  {
    t: "Mon entreprise",
    champs: [
      { k: "nom", l: "Nom ou raison sociale", auto: "organization" },
      { k: "forme", l: "Forme juridique", s: "EI pour un entrepreneur individuel", ex: "EI, SARL, SAS…" },
      { k: "capital", l: "Capital social", s: "pour une société" },
      { k: "adresse", l: "Adresse", auto: "street-address" },
      { k: "telephone", l: "Téléphone", auto: "tel", mode: "tel" },
      { k: "email", l: "E-mail", auto: "email", mode: "email" },
      { k: "siren", l: "SIREN", s: "9 chiffres", mode: "numeric" },
      { k: "immat", l: "Immatriculation", s: "RCS ou répertoire des métiers", ex: "RM 69" },
      { k: "tva", l: "N° de TVA intracommunautaire", ex: "FR…" },
    ],
  },
  {
    t: "Assurance décennale",
    champs: [
      { k: "assureur", l: "Assureur" },
      { k: "assureurAdresse", l: "Coordonnées de l'assureur" },
      { k: "contrat", l: "N° de contrat" },
      { k: "couverture", l: "Couverture géographique", ex: "France métropolitaine" },
    ],
  },
  {
    t: "Textes du devis",
    champs: [
      { k: "mediateur", l: "Médiateur de la consommation", s: "nom et coordonnées" },
      { k: "paiement", l: "Conditions de paiement", s: "acompte, solde, délais" },
      { k: "dechets", l: "Gestion des déchets du chantier" },
    ],
  },
];

const TARIFS: readonly { t: string; s?: string; champs: readonly Montant[] }[] = [
  {
    t: "Prix du bois",
    s: "bois brut, hors taxes",
    champs: ESSENCES.map((e) => ({ k: `bois.${e}`, l: ESSENCE_LABEL[e], u: "€/m³", pas: 1 })),
  },
  {
    t: "Fournitures et finition",
    champs: [
      { k: "perte", l: "Perte et chutes", s: "ajoutées au volume débité", u: "%", pas: 1 },
      { k: "coef", l: "Coefficient sur fournitures", s: "bois et quincaillerie", u: "×", pas: 0.01 },
      { k: "quincEscalier", l: "Quincaillerie", s: "par escalier", u: "€", pas: 0.01 },
      { k: "quincMarche", l: "Quincaillerie", s: "par marche", u: "€", pas: 0.01 },
      { k: "finition", l: "Finition", s: "vernis, huile ou peinture, surfaces vues", u: "€/m²", pas: 0.01 },
    ],
  },
  {
    t: "Main-d'œuvre",
    champs: [
      { k: "taux", l: "Taux horaire", s: "atelier et pose, hors taxes", u: "€/h", pas: 0.01 },
      ...POSTES.map((p) => ({
        k: `heures.${p}`,
        l: POSTE_LABEL[p].l,
        s: `heures ${POSTE_LABEL[p].par}`,
        u: "h",
        pas: 0.1,
      })),
    ],
  },
  {
    t: "Livraison et pose",
    champs: [
      { k: "livForfait", l: "Livraison", s: "forfait", u: "€", pas: 0.01 },
      { k: "livKm", l: "Livraison", s: "par kilomètre", u: "€/km", pas: 0.01 },
      { k: "deplForfait", l: "Déplacement de pose", s: "forfait", u: "€", pas: 0.01 },
      { k: "deplKm", l: "Déplacement de pose", s: "par kilomètre", u: "€/km", pas: 0.01 },
    ],
  },
  {
    t: "Devis",
    champs: [{ k: "validite", l: "Durée de validité", u: "jours", pas: 1 }],
  },
];

const TEXTES = ENTREPRISE.flatMap((g) => g.champs);
const MONTANTS = TARIFS.flatMap((g) => g.champs);
const tid = (k: string) => `te-${k}`;
const mid = (k: string) => `tf-${k.replace(".", "-")}`;
const lab = (id: string, l: string, s?: string) => `<label for="${id}">${l}${s ? `<small>${s}</small>` : ""}</label>`;

function texteHTML(c: Texte): string {
  const id = tid(c.k);
  const attrs =
    (c.auto ? ` autocomplete="${c.auto}"` : ' autocomplete="off"') +
    (c.mode ? ` inputmode="${c.mode}"` : "") +
    (c.ex ? ` placeholder="${c.ex}"` : "");
  const field = ENTREPRISE_LONGS.includes(c.k)
    ? `<textarea id="${id}" rows="3" maxlength="2000"${attrs}></textarea>`
    : `<input id="${id}" type="text" maxlength="200"${attrs} />`;
  return `<div class="row texte">${lab(id, c.l, c.s)}${field}</div>`;
}

function montantHTML(c: Montant): string {
  const id = mid(c.k);
  const long = c.u.length > 3 ? " long" : "";
  return (
    `<div class="row">${lab(id, c.l, c.s)}<div class="num${long}">` +
    `<input id="${id}" type="number" inputmode="decimal" step="${c.pas}" min="0" /><span>${c.u}</span>` +
    `</div></div>`
  );
}

const group = (t: string, rows: string, s?: string) =>
  `<div class="group"><h3>${t}${s ? ` <small>${s}</small>` : ""}</h3>${rows}</div>`;

/** Montant au bout d'un chemin « a » ou « a.b ». */
function at(o: object, k: string): unknown {
  return k.split(".").reduce<unknown>((v, p) => (v as Record<string, unknown> | undefined)?.[p], o);
}

/**
 * Fiche de l'entreprise et tarifs, dans Mon atelier : ce que les devis reprendront. Un champ vidé reste vide :
 * le devis en fera une ligne à compléter.
 */
export class TarifsPanel {
  private body = byId("atDevis");

  constructor(
    private store: AtelierStore,
    private host: AtelierHost,
  ) {
    this.body.insertAdjacentHTML(
      "beforeend",
      ENTREPRISE.map((g) => group(g.t, g.champs.map(texteHTML).join(""))).join("") +
        TARIFS.map((g) => group(g.t, g.champs.map(montantHTML).join(""), g.s)).join(""),
    );
    this.body.addEventListener("change", (e) => {
      const id = (e.target as HTMLElement).id;
      if (id.startsWith("te-")) this.saveEntreprise();
      else if (id.startsWith("tf-")) this.saveTarifs();
    });
    store.onChange(() => this.render());
    this.render();
  }

  private render(): void {
    const a = this.store.get();
    const e = a?.entreprise,
      t = a?.tarifs;
    for (const c of TEXTES) byId<HTMLInputElement>(tid(c.k)).value = e?.[c.k] ?? "";
    for (const c of MONTANTS) {
      const v = t ? at(t, c.k) : null;
      byId<HTMLInputElement>(mid(c.k)).value = typeof v === "number" ? String(v) : "";
    }
    this.checkSiren();
  }

  private saveEntreprise(): void {
    const raw: Record<string, string> = {};
    for (const c of TEXTES) raw[c.k] = byId<HTMLInputElement>(tid(c.k)).value;
    this.store.set({ entreprise: sanitizeEntreprise(raw) });
    this.host.saved();
  }

  private saveTarifs(): void {
    const raw: Record<string, Record<string, number> | number> = { bois: {}, heures: {} };
    for (const c of MONTANTS) {
      const v = parseFloat(byId<HTMLInputElement>(mid(c.k)).value.replace(",", "."));
      if (Number.isNaN(v)) continue;
      const [a, b] = c.k.split(".");
      if (b) (raw[a!] as Record<string, number>)[b] = v;
      else raw[a!] = v;
    }
    this.store.set({ tarifs: sanitizeTarifs(raw) });
    this.host.saved();
  }

  /** Un SIREN mal tapé se signale sous son champ, sans empêcher de l'enregistrer. */
  private checkSiren(): void {
    const el = byId<HTMLInputElement>(tid("siren"));
    const bad = el.value.trim() !== "" && !sirenOk(el.value);
    if (bad) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
    let err = el.parentElement!.querySelector(".fielderr");
    if (bad && !err) {
      err = document.createElement("p");
      err.className = "fielderr";
      err.textContent = "Numéro à vérifier : 9 chiffres, dont le dernier sert de contrôle.";
      el.after(err);
    } else if (!bad) err?.remove();
  }
}
