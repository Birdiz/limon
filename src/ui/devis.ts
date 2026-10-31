import { buildCNC } from "../cnc/build";
import { quantites } from "../cnc/quantites";
import {
  ETAT_DEVIS_LABEL,
  TAUX,
  bloquants,
  devis,
  etatRemis,
  finValidite,
  memesParams,
  mentionsManquantes,
  newDevis,
  noterReponse,
  remettre,
  versionRemise,
  versionSuivante,
  type Correction,
  type Devis,
  type DevisProjet,
  type DevisRemis,
  type EtatDevis,
  type EtatRemis,
  type Ligne,
  type Quantites,
} from "../core/devis";
import { fmt } from "../core/format";
import { fileBase, type Project } from "../core/project";
import { compute, type Stair } from "../core/stair";
import { POSTE_LABEL, isEmptyTarifs, type Entreprise, type Tarifs } from "../core/tarifs";
import { devisPDF, type DevisPdf } from "../pdf/devis";
import { NotSignedIn } from "./api";
import { byId, esc } from "./dom";

/** Ce que la page fournit à l'onglet Devis. */
export interface DevisHost {
  project(): Project | null;
  /** Escalier calculé, null si ses réglages ne permettent pas le calcul. */
  stair(): Stair | null;
  tarifs(): Tarifs;
  entreprise(): Entreprise;
  /** Le devis a changé : à enregistrer avec l'escalier. */
  saved(d: DevisProjet): void;
  /** Ouvre Mon atelier, où sont les tarifs. */
  openTarifs(): void;
  /** Ouvre Mon compte, pour se connecter. */
  openCompte(): void;
  /** Numéro du devis de l'escalier, donné par le serveur ; lève NotSignedIn sans compte, TypeError sans réseau. */
  numero(projet: string): Promise<string>;
  /** Capture de la vue 3D de cet escalier, si la page en a une. */
  vue3d(R: Stair): DevisPdf["vue3d"] | null;
  download(data: Uint8Array<ArrayBuffer>, filename: string): void;
}

const eur = (v: number) => `${fmt(v, 2)}\u00a0€`;
const num = (v: number | null, d = 2) => (v === null ? "" : String(Math.round(v * 10 ** d) / 10 ** d));
const tauxTxt = (t: number) => `${fmt(t, t % 1 ? 1 : 0)}\u00a0%`;
const day = (ms: number) => new Date(ms).toLocaleDateString("fr-FR");
const CHIP: Record<EtatDevis, string> = {
  brouillon: "",
  remis: "warn",
  accepte: "ok",
  refuse: "bad",
  expire: "bad",
};

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
  /** Version remise affichée à la place du brouillon, figée ; null pour un brouillon. */
  private fige: DevisRemis | null = null;
  /** Devis calculé du brouillon à l'écran. */
  private D: Devis | null = null;
  private busy = false;

  constructor(private host: DevisHost) {
    const view = byId("devisView");
    view.addEventListener("change", (e) => this.changed(e.target as HTMLElement));
    view.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (b?.dataset.act === "pdf") this.pdfVersion(Number(b.dataset.v));
      else if (b) this.act(b);
    });
    byId("dvPdf").addEventListener("click", () =>
      this.fige ? this.pdfVersion(this.fige.version) : this.pdfBrouillon(),
    );
    byId("dvRemettre").addEventListener("click", () => void this.remettre());
    const reponse = (etat: EtatRemis) => () => {
      if (!this.fige) return;
      this.d = noterReponse(this.d, this.fige.version, etat, Date.now());
      this.save();
    };
    byId("dvAccepte").addEventListener("click", reponse("accepte"));
    byId("dvRefuse").addEventListener("click", reponse("refuse"));
    byId("dvSansReponse").addEventListener("click", reponse("remis"));
    byId("dvRouvrir").addEventListener("click", () => {
      this.d.rouvert = true;
      this.save();
    });
    // Le brouillon repris sans changer l'escalier revient à la version remise, saisie comprise.
    byId("dvAnnuler").addEventListener("click", () => {
      const last = this.d.remis.at(-1);
      if (!last) return;
      this.d = {
        ...this.d,
        client: structuredClone(last.client),
        saisie: structuredClone(last.saisie),
        rouvert: false,
      };
      this.save();
    });
    byId("dvCompte").addEventListener("click", () => host.openCompte());
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
    this.fige = p ? versionRemise(this.d, p.params) : null;
    this.Q = R && !this.fige ? quantites(R, buildCNC(R)) : null;
    byId("dvLead").textContent = p ? `Pour « ${p.nom} ».` : "";
    byId("dvMsg").hidden = true;
    this.renderSaisie();
    this.renderLignes();
    this.renderEtat();
    this.renderVersions();
    this.lock();
  }

  /** Client et saisie à l'écran : ceux de la version remise quand elle est figée. */
  private get shownClient() {
    return this.fige?.client ?? this.d.client;
  }

  private renderSaisie(): void {
    const c = this.shownClient,
      s = this.fige?.saisie ?? this.d.saisie;
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
    byId<HTMLInputElement>("dvAcompte").value = s.acompte ? String(s.acompte) : "";
    byId<HTMLInputElement>("dvDelai").value = s.delai;
  }

  /** Version figée : rien ne se modifie, sauf en reprenant le devis. */
  private lock(): void {
    const f = !!this.fige;
    byId("dvBody").classList.toggle("fige", f);
    for (const el of byId("dvBody").querySelectorAll<HTMLInputElement>("input, select, textarea, .dl-act button"))
      el.disabled = f;
    byId("dvAdd").hidden = f;
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
    this.D = null;
    if (this.fige) {
      need.hidden = true;
      byId("dvBody").hidden = false;
      this.renderTable(this.fige.chiffrage, []);
      byId("dvRetirees").hidden = true;
      return;
    }
    if (!this.Q) {
      need.hidden = false;
      byId("dvNeedTxt").textContent = "Corrigez d'abord les réglages de l'escalier : le devis se calcule sur lui.";
      byId("dvTarifs").hidden = true;
      byId("dvBody").hidden = true;
      return;
    }
    byId("dvBody").hidden = false;
    const D = devis(this.Q, T, this.d.saisie);
    this.D = D;
    const base = this.base();
    need.hidden = !vide && !D.aCompleter.length;
    byId("dvTarifs").hidden = false;
    byId("dvNeedTxt").textContent = vide
      ? "Vos tarifs ne sont pas encore remplis : les lignes restent à compléter."
      : `À compléter dans vos tarifs : ${D.aCompleter.join(", ").toLowerCase()}.`;
    this.renderTable(D, base);

    const retirees = base.filter((b) => this.d.saisie.corrections[b.id]?.retiree);
    const ret = byId("dvRetirees");
    ret.hidden = !retirees.length;
    ret.innerHTML = retirees.length
      ? `Lignes retirées : ${retirees.map((b) => `<button class="lnk" type="button" data-act="restore" data-id="${b.id}">${esc(b.designation)}</button>`).join(", ")}.`
      : "";
  }

  private renderTable(D: Devis, base: Ligne[]): void {
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
      (D.acompte !== null ? row("Acompte à la commande", eur(D.acompte)) : "") +
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

  /** État du devis en cours, ce qui manque pour le remettre, et les boutons qui vont avec. */
  private renderEtat(): void {
    const p = this.host.project();
    const f = this.fige,
      now = Date.now();
    const etat: EtatDevis = f ? etatRemis(f, now) : "brouillon";
    const chip = byId("dvChip");
    chip.textContent = ETAT_DEVIS_LABEL[etat];
    chip.className = `chip ${CHIP[etat]}`;
    const last = this.d.remis.at(-1);
    const v = versionSuivante(this.d);
    byId("dvEtatTxt").textContent = f
      ? `N° ${f.numero}${f.version > 1 ? `, version ${f.version}` : ""}, remis le ${day(f.remisLe)}` +
        (etat === "accepte" || etat === "refuse"
          ? `, ${etat === "accepte" ? "accepté" : "refusé"} le ${day(f.etatLe)}.`
          : `, ${etat === "expire" ? "validité passée le" : "valable jusqu'au"} ${day(finValidite(f))}.`)
      : !last
        ? "Pas encore remis au client : le numéro est donné à la remise."
        : p && !memesParams(last.params, p.params)
          ? `Version ${v} : l'escalier a changé depuis la remise du ${day(last.remisLe)}.`
          : `Version ${v}, reprise après la remise du ${day(last.remisLe)}.`;

    const show = (id: string, on: boolean) => (byId(id).hidden = !on);
    byId("dvPdf").textContent = f ? "Télécharger le devis" : "Télécharger le brouillon";
    show("dvPdf", !!f || !!this.D);
    show("dvRemettre", !f && !!this.D);
    show("dvAccepte", !!f && f.etat !== "accepte");
    show("dvRefuse", !!f && f.etat !== "refuse");
    show("dvSansReponse", !!f && f.etat !== "remis");
    show("dvRouvrir", !!f);
    show("dvAnnuler", !f && !!last && this.d.rouvert && !!p && memesParams(last.params, p.params));

    const bloq = byId("dvBloq");
    bloq.innerHTML = "";
    if (f || !this.D) return;
    const manque = bloquants(this.D, this.d, this.host.tarifs(), this.host.entreprise());
    byId<HTMLButtonElement>("dvRemettre").disabled = manque.length > 0 || this.busy;
    const mentions = mentionsManquantes(this.host.entreprise());
    bloq.innerHTML =
      (manque.length ? `<div class="note warn">Pour remettre le devis, il manque ${esc(liste(manque))}.</div>` : "") +
      (mentions.length
        ? `<div class="note">Le devis ne porte pas encore ${esc(liste(mentions))} : à remplir dans Mon atelier.</div>`
        : "");
  }

  /** Versions déjà remises, la plus récente en tête, chacune avec son document. */
  private renderVersions(): void {
    const box = byId("dvVersions");
    const list = [...this.d.remis].reverse();
    box.hidden = !list.length;
    const now = Date.now();
    box.innerHTML = list.length
      ? `<h3>Versions remises</h3><ul>${list
          .map((r) => {
            const e = etatRemis(r, now);
            return (
              `<li><span>N° ${esc(r.numero)}${r.version > 1 ? ` v${r.version}` : ""}, remis le ${day(r.remisLe)}</span>` +
              `<span class="chip ${CHIP[e]}">${ETAT_DEVIS_LABEL[e]}</span><span class="dvv-tot">${eur(r.chiffrage.totalTTC)} TTC</span>` +
              `<button class="lnk" type="button" data-act="pdf" data-v="${r.version}">PDF</button></li>`
            );
          })
          .join("")}</ul>`
      : "";
  }

  /** Document d'une version remise, refait depuis sa copie figée. */
  private pdfVersion(version: number): void {
    const r = this.d.remis.find((x) => x.version === version);
    if (!r) return;
    const c = compute(r.params, false);
    const R = c.ok ? c.stair : null;
    const vue3d = R ? this.host.vue3d(R) : null;
    const pdf = devisPDF({
      entreprise: r.entreprise,
      client: r.client,
      saisie: r.saisie,
      chiffrage: r.chiffrage,
      nom: r.nom,
      params: r.params,
      stair: R,
      numero: r.numero,
      version: r.version,
      date: day(r.remisLe),
      validite: r.validite,
      jusquAu: day(finValidite(r)),
      ...(vue3d ? { vue3d } : {}),
    });
    const qui = fileBase(r.client.nom || r.nom);
    this.host.download(pdf, `Devis ${r.numero}${r.version > 1 ? ` v${r.version}` : ""} - ${qui}.pdf`);
  }

  private pdfBrouillon(): void {
    const p = this.host.project(),
      R = this.host.stair();
    if (!p || !R || !this.D) return;
    const vue3d = this.host.vue3d(R);
    const pdf = devisPDF({
      entreprise: this.host.entreprise(),
      client: this.d.client,
      saisie: this.d.saisie,
      chiffrage: this.D,
      nom: p.nom,
      params: R.params,
      stair: R,
      numero: null,
      version: versionSuivante(this.d),
      date: day(Date.now()),
      validite: this.host.tarifs().validite,
      jusquAu: null,
      ...(vue3d ? { vue3d } : {}),
    });
    this.host.download(pdf, `${fileBase(p.nom)} - devis (brouillon).pdf`);
  }

  private message(text: string, compte = false): void {
    byId("dvMsgTxt").textContent = text;
    byId("dvCompte").hidden = !compte;
    byId("dvMsg").hidden = false;
  }

  /** Remise au client : numéro du serveur, copie figée, puis le document. */
  private async remettre(): Promise<void> {
    const p = this.host.project(),
      R = this.host.stair(),
      D = this.D;
    if (!p || !R || !D || this.busy) return;
    const T = this.host.tarifs(),
      E = this.host.entreprise();
    if (bloquants(D, this.d, T, E).length) return;
    const mentions = mentionsManquantes(E);
    if (
      mentions.length &&
      !window.confirm(`Le devis ne porte pas encore ${liste(mentions)}. Le remettre au client quand même ?`)
    )
      return;
    const btn = byId<HTMLButtonElement>("dvRemettre");
    this.busy = true;
    btn.disabled = true;
    btn.textContent = "Remise…";
    let numero: string;
    try {
      numero = await this.host.numero(p.id);
    } catch (e) {
      if (e instanceof NotSignedIn)
        this.message("Pour remettre le devis, connectez-vous à votre compte : c'est lui qui donne les numéros.", true);
      else if (e instanceof TypeError)
        this.message("Pas de réseau : la remise demande une connexion. Le brouillon reste enregistré.");
      else this.message(e instanceof Error ? e.message : String(e));
      return;
    } finally {
      this.busy = false;
      btn.textContent = "Remettre au client";
      btn.disabled = false;
    }
    // L'escalier a pu changer pendant l'attente : on ne fige que celui qui a été chiffré.
    if (this.host.project()?.id !== p.id) return;
    this.d = remettre(
      this.d,
      { numero, nom: p.nom, params: R.params, tarifs: T, entreprise: E, chiffrage: D },
      Date.now(),
    );
    const version = this.d.remis.at(-1)!.version;
    this.save();
    this.pdfVersion(version);
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
      case "dvAcompte": {
        const n = lu(v);
        s.acompte = n !== null && n > 0 ? Math.min(n, 100) : null;
        break;
      }
      case "dvDelai":
        s.delai = v.trim();
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

/** « a, b et c ». */
function liste(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} et ${items.at(-1)}` : (items[0] ?? "");
}
