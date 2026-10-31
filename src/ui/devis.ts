import { buildCNC } from "../cnc/build";
import { quantites } from "../cnc/quantites";
import {
  TAUX,
  devis,
  newDevis,
  type Correction,
  type Devis,
  type DevisProjet,
  type Ligne,
  type Quantites,
} from "../core/devis";
import { fmt } from "../core/format";
import type { Project } from "../core/project";
import type { Stair } from "../core/stair";
import { POSTE_LABEL, isEmptyTarifs, type Tarifs } from "../core/tarifs";
import { byId, esc } from "./dom";

/** Ce que la page fournit à l'onglet Devis. */
export interface DevisHost {
  project(): Project | null;
  /** Escalier calculé, null si ses réglages ne permettent pas le calcul. */
  stair(): Stair | null;
  tarifs(): Tarifs;
  /** Le devis a changé : à enregistrer avec l'escalier. */
  saved(d: DevisProjet): void;
  /** Ouvre Mon atelier, où sont les tarifs. */
  openTarifs(): void;
}

const eur = (v: number) => `${fmt(v, 2)}\u00a0€`;
const num = (v: number | null, d = 2) => (v === null ? "" : String(Math.round(v * 10 ** d) / 10 ** d));
const tauxTxt = (t: number) => `${fmt(t, t % 1 ? 1 : 0)}\u00a0%`;

/** Nombre saisi, virgule permise ; null si le champ est vide ou illisible. */
function lu(v: string): number | null {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Unité d'un poste (« par marche ») pour une quantité : « 7 marches », « 9,4 m ». */
const UNITES: Record<string, [string, string]> = {
  escalier: ["escalier", "escaliers"],
  marche: ["marche", "marches"],
  pièce: ["pièce", "pièces"],
  mètre: ["m", "m"],
  poteau: ["poteau", "poteaux"],
  balustre: ["balustre", "balustres"],
  "m²": ["m²", "m²"],
};
function unite(par: string, q: number): string {
  const w = UNITES[par.replace(/^par /, "")];
  return w ? w[q > 1 ? 1 : 0] : par;
}

function ligneHTML(l: Ligne, base: Ligne | undefined): string {
  const cls = `dl${l.corrigee ? " corrigee" : ""}${l.total === null ? " manque" : ""}`;
  const unite = l.auto
    ? `<span class="dl-u">${esc(l.unite)}</span>`
    : `<input class="dl-u" type="text" maxlength="20" value="${esc(l.unite)}" aria-label="Unité" />`;
  const tva = l.auto
    ? `<span class="dl-tva">${tauxTxt(l.tva)}</span>`
    : `<select class="dl-tva" aria-label="TVA">${TAUX.map((t) => `<option value="${t}"${t === l.tva ? " selected" : ""}>${tauxTxt(t)}</option>`).join("")}</select>`;
  const reset =
    l.auto && l.corrigee
      ? `<button class="ibtn" type="button" data-act="reset" aria-label="Revenir au calcul" title="Revenir au calcul"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h8.5a4.5 4.5 0 0 1 0 9H9" /></svg></button>`
      : "";
  const del = `<button class="ibtn" type="button" data-act="del" aria-label="${l.auto ? "Retirer la ligne" : "Supprimer la ligne"}" title="${l.auto ? "Retirer la ligne" : "Supprimer la ligne"}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>`;
  return (
    `<div class="${cls}" data-id="${l.id}">` +
    `<input class="dl-des" type="text" maxlength="200" value="${esc(l.designation)}" placeholder="${esc(base?.designation ?? "Désignation")}" aria-label="Désignation" />` +
    `<div class="num nounit dl-q"><input type="number" inputmode="decimal" step="any" min="0" value="${num(l.q, 3)}" aria-label="Quantité" /></div>` +
    unite +
    `<div class="num dl-pu"><input type="number" inputmode="decimal" step="any" value="${num(l.pu)}" aria-label="Prix unitaire hors taxes" /><span>€</span></div>` +
    tva +
    `<span class="dl-tot">${l.total === null ? "à compléter" : eur(l.total)}</span>` +
    `<span class="dl-act">${reset}${del}</span></div>`
  );
}

/**
 * Onglet Devis de l'escalier ouvert : client, réglages du chantier, lignes calculées et corrigées, lignes libres,
 * remise et totaux, avec pour l'artisan seul le déboursé et les heures. Les lignes se recalculent à chaque
 * changement de l'escalier ou des tarifs ; seules la saisie et les corrections sont enregistrées.
 */
export class DevisView {
  private d: DevisProjet = newDevis();
  private Q: Quantites | null = null;

  constructor(private host: DevisHost) {
    const view = byId("devisView");
    view.addEventListener("change", (e) => this.changed(e.target as HTMLElement));
    view.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (b) this.act(b);
    });
    byId("dvAdd").addEventListener("click", () => {
      this.d.saisie.libres.push({ designation: "", q: 1, unite: "u", pu: 0, tva: this.d.saisie.tva });
      this.save();
      byId("dvLines").querySelector<HTMLInputElement>(".dl:last-child .dl-des")?.focus();
    });
    byId("dvTarifs").addEventListener("click", () => host.openTarifs());
  }

  /** Visible seulement dans l'onglet Devis : ailleurs, rien n'est recalculé. */
  private get shown(): boolean {
    return document.body.dataset.tab === "devis";
  }

  /** À appeler quand l'escalier, son devis ou les tarifs changent. */
  refresh(): void {
    if (!this.shown) return;
    const p = this.host.project();
    const R = this.host.stair();
    // Une copie : le devis enregistré ne change que par `save`.
    this.d = structuredClone(p?.devis ?? newDevis());
    this.Q = R ? quantites(R, buildCNC(R)) : null;
    byId("dvLead").textContent = p ? `Pour « ${p.nom} ».` : "";
    this.renderSaisie();
    this.renderLignes();
  }

  private renderSaisie(): void {
    const { client: c, saisie: s } = this.d;
    byId<HTMLInputElement>("dvNom").value = c.nom;
    byId<HTMLTextAreaElement>("dvAdresse").value = c.adresse;
    byId<HTMLTextAreaElement>("dvChantier").value = c.chantier;
    byId<HTMLSelectElement>("dvTva").value = String(s.tva);
    byId<HTMLInputElement>("dvPose").checked = s.pose;
    byId<HTMLInputElement>("dvKm").value = s.km ? String(s.km) : "";
    byId<HTMLInputElement>("dvLiv").checked = s.livraison;
    byId<HTMLInputElement>("dvDetail").checked = s.faconDetail;
    const r = s.remise;
    byId<HTMLSelectElement>("dvRemiseKind").value = r ? ("pct" in r ? "pct" : "eur") : "";
    byId<HTMLInputElement>("dvRemise").value = r ? String("pct" in r ? r.pct : r.eur) : "";
    byId("dvRemiseBox").hidden = !r;
    byId("dvRemiseU").textContent = r && "eur" in r ? "€" : "%";
  }

  /** Lignes telles que calculées, sans les corrections : la référence d'une ligne corrigée. */
  private base(): Ligne[] {
    if (!this.Q) return [];
    return devis(this.Q, this.host.tarifs(), { ...this.d.saisie, corrections: {} }).lignes;
  }

  private renderLignes(): void {
    const T = this.host.tarifs();
    const vide = isEmptyTarifs(T);
    const need = byId("dvNeed");
    if (!this.Q) {
      need.hidden = false;
      byId("dvNeedTxt").textContent = "Corrigez d'abord les réglages de l'escalier : le devis se calcule sur lui.";
      byId("dvTarifs").hidden = true;
      byId("dvBody").hidden = true;
      return;
    }
    byId("dvBody").hidden = false;
    const D = devis(this.Q, T, this.d.saisie);
    const base = this.base();
    need.hidden = !vide && !D.aCompleter.length;
    byId("dvTarifs").hidden = false;
    byId("dvNeedTxt").textContent = vide
      ? "Vos tarifs ne sont pas encore remplis : les lignes restent à compléter."
      : `À compléter dans vos tarifs : ${D.aCompleter.join(", ").toLowerCase()}.`;

    byId("dvLines").innerHTML =
      `<div class="dl dl-head" aria-hidden="true"><span>Désignation</span><span>Quantité</span><span></span>` +
      `<span>Prix HT</span><span>TVA</span><span>Total HT</span><span></span></div>` +
      D.lignes
        .map((l) =>
          ligneHTML(
            l,
            base.find((b) => b.id === l.id),
          ),
        )
        .join("");

    const retirees = base.filter((b) => this.d.saisie.corrections[b.id]?.retiree);
    const ret = byId("dvRetirees");
    ret.hidden = !retirees.length;
    ret.innerHTML = retirees.length
      ? `Lignes retirées : ${retirees.map((b) => `<button class="lnk" type="button" data-act="restore" data-id="${b.id}">${esc(b.designation)}</button>`).join(", ")}.`
      : "";

    this.renderTotaux(D);
    byId("dvNotes").innerHTML = D.alertes.map((a) => `<div class="note warn">${esc(a)}</div>`).join("");
    this.renderSelf(D);
  }

  private renderTotaux(D: Devis): void {
    const row = (l: string, v: string, cls = "") =>
      `<tr${cls ? ` class="${cls}"` : ""}><th>${l}</th><td>${v}</td></tr>`;
    byId("dvTot").innerHTML =
      (D.remise ? row("Total des lignes HT", eur(D.totalLignes)) + row("Remise", `− ${eur(D.remise)}`) : "") +
      row("Total HT", eur(D.totalHT), "fort") +
      D.tva.map((t) => row(`TVA ${tauxTxt(t.taux)} sur ${eur(t.base)}`, eur(t.montant))).join("") +
      row("Total TTC", eur(D.totalTTC), "fort ttc") +
      (D.aCompleter.length ? `<tr class="manque"><td colspan="2">Sans les lignes à compléter.</td></tr>` : "");
  }

  /** Pour l'artisan seul, jamais sur le document du client : déboursé, marge sur fournitures, heures. */
  private renderSelf(D: Devis): void {
    const vendu = D.lignes
      .filter((l) => l.id === "bois" || l.id === "quincaillerie")
      .reduce((s, l) => s + (l.total ?? 0), 0);
    const heures = D.facon
      .map(
        (f) =>
          `<tr><td>${POSTE_LABEL[f.poste].l}</td><td>${fmt(f.q, Number.isInteger(f.q) ? 0 : 2)} ${unite(POSTE_LABEL[f.poste].par, f.q)}</td>` +
          `<td>${f.h === null ? "—" : `${fmt(f.q * f.h, 1)}\u00a0h`}</td></tr>`,
      )
      .join("");
    byId("dvSelfBody").innerHTML =
      `<p>Fournitures achetées : <b>${eur(D.debourse.fournitures)}</b>, revendues ${eur(vendu)}, soit ` +
      `<b>${eur(vendu - D.debourse.fournitures)}</b> de marge sur fournitures. Heures d'atelier et de pose : ` +
      `<b>${fmt(D.debourse.heures, 1)}\u00a0h</b>.</p>` +
      `<div class="tablewrap"><table><thead><tr><th>Poste</th><th>Quantité</th><th>Heures</th></tr></thead><tbody>${heures}</tbody></table></div>`;
  }

  private save(): void {
    this.host.saved(structuredClone(this.d));
  }

  private corr(id: string, f: (c: Correction) => void): void {
    const all = this.d.saisie.corrections;
    const c = { ...all[id] };
    f(c);
    if (Object.keys(c).length) all[id] = c;
    else this.d.saisie.corrections = Object.fromEntries(Object.entries(all).filter(([k]) => k !== id));
  }

  private changed(el: HTMLElement): void {
    const s = this.d.saisie,
      c = this.d.client;
    const v = (el as HTMLInputElement).value;
    switch (el.id) {
      case "dvNom":
        c.nom = v.trim();
        break;
      case "dvAdresse":
        c.adresse = v.trim();
        break;
      case "dvChantier":
        c.chantier = v.trim();
        break;
      case "dvTva":
        s.tva = v === "10" ? 10 : 20;
        break;
      case "dvPose":
        s.pose = (el as HTMLInputElement).checked;
        break;
      case "dvKm":
        s.km = Math.max(0, lu(v) ?? 0);
        break;
      case "dvLiv":
        s.livraison = (el as HTMLInputElement).checked;
        break;
      case "dvDetail":
        s.faconDetail = (el as HTMLInputElement).checked;
        break;
      case "dvRemiseKind":
        s.remise = v === "pct" ? { pct: 0 } : v === "eur" ? { eur: 0 } : null;
        break;
      case "dvRemise": {
        const n = Math.max(0, lu(v) ?? 0);
        if (s.remise) s.remise = "pct" in s.remise ? { pct: Math.min(n, 100) } : { eur: n };
        break;
      }
      default:
        if (!this.changedLine(el)) return;
    }
    this.save();
  }

  /** Champ d'une ligne : correction d'une ligne calculée, ou ligne libre. */
  private changedLine(el: HTMLElement): boolean {
    const row = el.closest<HTMLElement>(".dl[data-id]");
    if (!row) return false;
    const id = row.dataset.id!;
    const v = (el as HTMLInputElement).value;
    const field = el.closest(".dl-q")
      ? "q"
      : el.closest(".dl-pu")
        ? "pu"
        : el.classList.contains("dl-des")
          ? "des"
          : el.classList.contains("dl-u")
            ? "u"
            : el.classList.contains("dl-tva")
              ? "tva"
              : null;
    if (!field) return false;
    const libre = /^libre-(\d+)$/.exec(id);
    if (libre) {
      const l = this.d.saisie.libres[Number(libre[1]) - 1];
      if (!l) return false;
      if (field === "des") l.designation = v.trim();
      else if (field === "u") l.unite = v.trim();
      else if (field === "tva") l.tva = Number(v);
      else if (field === "q") l.q = Math.max(0, lu(v) ?? 0);
      else l.pu = lu(v) ?? 0;
      return true;
    }
    // Ligne calculée : la valeur du calcul efface la correction.
    const b = this.base().find((x) => x.id === id);
    this.corr(id, (c) => {
      if (field === "des") {
        const t = v.trim();
        if (!t || t === b?.designation) delete c.designation;
        else c.designation = t;
      } else if (field === "q" || field === "pu") {
        const n = lu(v);
        const keep = n !== null && n !== b?.[field];
        if (field === "q") {
          if (keep) c.q = Math.max(0, n);
          else delete c.q;
        } else if (keep) c.pu = n;
        else delete c.pu;
      }
    });
    return true;
  }

  private act(b: HTMLButtonElement): void {
    const id = b.dataset.id ?? b.closest<HTMLElement>(".dl[data-id]")?.dataset.id;
    if (!id) return;
    const libre = /^libre-(\d+)$/.exec(id);
    if (b.dataset.act === "del" && libre) this.d.saisie.libres.splice(Number(libre[1]) - 1, 1);
    else if (b.dataset.act === "del") this.corr(id, (c) => (c.retiree = true));
    else if (b.dataset.act === "reset")
      this.corr(id, (c) => {
        delete c.designation;
        delete c.q;
        delete c.pu;
      });
    else if (b.dataset.act === "restore") this.corr(id, (c) => delete c.retiree);
    else return;
    this.save();
  }
}
