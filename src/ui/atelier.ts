import {
  ATELIER_PARTS,
  atelierDefauts,
  atelierParams,
  isDefaultAtelier,
  newAtelier,
  sanitizeAtelier,
  type Atelier,
  type AtelierDefauts,
  type AtelierKey,
} from "../core/atelier";
import { fmt } from "../core/format";
import { DEFAULTS, reglage, sanitizeParams, type Params, type Saisie } from "../core/params";
import { stamped } from "../core/project";
import { ESSENCE_LABEL } from "../core/summary";
import { byId, flash } from "./dom";
import { browserStorage, readJSON, write, type KeyValue } from "./store";

const ATELIER_KEY = "limon-atelier";

/**
 * Profil de l'atelier sur cet appareil. Écrit tout de suite dans le stockage du navigateur ; avec un
 * compte, `SyncStore` le recopie sur les autres appareils, la version la plus récente gagnant, partie par partie.
 */
export class AtelierStore {
  private a: Atelier | null;
  private listeners: (() => void)[] = [];

  constructor(private storage: KeyValue | null = browserStorage()) {
    this.a = sanitizeAtelier(readJSON(storage, ATELIER_KEY));
  }

  /** Null tant que l'artisan n'a rien gardé : les nouveaux escaliers partent alors de l'exemple. */
  get(): Atelier | null {
    return this.a;
  }

  /** Réglages de départ d'un nouvel escalier. */
  params(): Params {
    return atelierParams(this.a);
  }

  /** Change une partie du profil (réglages, tarifs ou fiche de l'entreprise) en gardant le reste, sans le dater. */
  set(part: Partial<Omit<Atelier, "dates" | "modifie">>, now = Date.now()): void {
    const base = this.a ?? newAtelier(atelierDefauts(DEFAULTS), 0);
    const modifie = this.a ? stamped(this.a, now) : now;
    const dates = { ...base.dates };
    for (const k of ATELIER_PARTS) if (k in part) dates[k] = modifie;
    this.put({ ...base, ...part, dates, modifie });
  }

  /** Version réunie avec celle du compte. */
  adopt(a: Atelier): void {
    this.put(a);
  }

  /** Le profil quitte l'appareil : déconnexion, connexion à un autre compte, ou compte supprimé. */
  clear(): void {
    this.a = null;
    write(this.storage, ATELIER_KEY, null);
    this.emit();
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private put(a: Atelier): void {
    this.a = a;
    write(this.storage, ATELIER_KEY, JSON.stringify(a));
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

/** Un réglage du profil, dessiné comme les champs de la colonne de réglages : saisie, options, mot de la case et
    réglage avancé viennent du catalogue des réglages (REGLAGES). */
interface Champ {
  k: AtelierKey;
  /** Intitulé, s'il diffère du nom du réglage. */
  l?: string;
  /** Précision sous l'intitulé. */
  s?: string;
}

const GROUPES: readonly { t: string; champs: readonly Champ[] }[] = [
  {
    t: "Bois",
    champs: [
      { k: "ess" },
      { k: "et" },
      { k: "deb", s: "recouvrement" },
      { k: "nez" },
      { k: "rn", s: "ou côte du chanfrein, 0 = vif" },
      { k: "rai", s: "près du nez" },
      { k: "raiN" },
      { k: "raiL" },
      { k: "raiP" },
      { k: "raiD", s: "son axe, depuis le nez" },
      { k: "raiE" },
      { k: "cm" },
      { k: "ecm" },
      { k: "cmPose", s: "par rapport à la marche du bas" },
      { k: "cmEmb", l: "Embrèvement", s: "rainure sous la marche du haut, 0 = sans" },
      { k: "mdeb", s: "escalier droit, limon en crémaillère" },
      { k: "debJ", s: "au-delà du flanc du limon" },
      { k: "mp", s: "logée dans les limons, à l'arrivée" },
      { k: "mpP", s: "depuis le nez" },
      { k: "mpE" },
    ],
  },
  {
    t: "Limons et poteau",
    champs: [
      { k: "el" },
      { k: "hl", s: "limon de mur en quart tournant" },
      { k: "hljAuto", l: "Hauteur du limon de jour" },
      { k: "ps", s: "carrée" },
    ],
  },
  {
    t: "Assemblage et plateaux",
    champs: [
      { k: "enc", s: "marches et contremarches dans les limons" },
      { k: "jeu", s: "par côté, sur les logements" },
      { k: "pL", s: "bois disponible, dans le fil" },
      { k: "pW", s: "bois disponible" },
    ],
  },
  {
    t: "Garde-corps",
    champs: [
      { k: "gc" },
      { k: "gcPose" },
      { k: "mcL" },
      { k: "mcH" },
      { k: "bs", s: "carrée ; montants et lisses aussi" },
    ],
  },
];

const CHAMPS: readonly Champ[] = GROUPES.flatMap((g) => g.champs);

const avance = (c: Champ) => !!reglage(c.k).avance;

function rowHTML(c: Champ): string {
  const r = reglage(c.k);
  const id = `at-${c.k}`;
  const adv = r.avance ? " data-adv" : "";
  const lab = `<label for="${id}">${c.l ?? r.libelle}${c.s ? `<small>${c.s}</small>` : ""}</label>`;
  if (r.valeurs) {
    const opts = r.valeurs.map((v) => `<option value="${v}">${r.noms?.[v] ?? v}</option>`).join("");
    return `<div class="row"${adv}>${lab}<select id="${id}">${opts}</select></div>`;
  }
  if (!r.saisie)
    return `<div class="row"${adv}>${lab}<label class="check"><input type="checkbox" id="${id}" /> ${r.mot ?? ""}</label></div>`;
  return `<div class="row"${adv}>${lab}${saisieHTML(id, r.saisie)}</div>`;
}

/** Champ d'un nombre, comme ceux du gabarit de la page (app/index.html). */
export function saisieHTML(id: string, s: Saisie): string {
  const mode = s.pas < 1 ? ' inputmode="decimal"' : ' inputmode="numeric"';
  const max = s.max === undefined ? "" : ` max="${s.max}"`;
  return (
    `<div class="num${s.sansUnite ? " nounit" : ""}">` +
    `<input id="${id}" type="number"${mode} step="${s.pas}" min="${s.min}"${max} />` +
    (s.sansUnite ? "" : "<span>mm</span>") +
    `</div>`
  );
}

/** Ce que la page fournit au profil de l'atelier. */
export interface AtelierHost {
  /** Réglages de l'escalier ouvert, null si aucun ne l'est. */
  params(): Params | null;
  /** Le profil a changé : à envoyer au compte. */
  saved(): void;
}

/** Onglet « Mon atelier » de l'accueil : les réglages gardés d'un escalier à l'autre. */
export class AtelierPanel {
  private body = byId("atBody");
  private msg = byId("atMsg");

  constructor(
    private store: AtelierStore,
    private host: AtelierHost,
  ) {
    this.body.insertAdjacentHTML(
      "beforeend",
      // Un groupe entièrement avancé disparaît avec ses champs, titre compris.
      GROUPES.map(
        (g) =>
          `<div class="group"${g.champs.every(avance) ? " data-adv" : ""}>` +
          `<h3>${g.t}</h3>${g.champs.map(rowHTML).join("")}</div>`,
      ).join(""),
    );
    byId("atTake").addEventListener("click", () => this.keep());
    byId("atReset").addEventListener("click", () => this.reset());
    this.body.addEventListener("change", (e) => {
      if ((e.target as HTMLElement).id.startsWith("at-")) this.edited();
    });
    store.onChange(() => this.render());
    this.render();
  }

  /** Réglages de l'atelier, ou ceux de l'exemple tant qu'il n'y en a pas. */
  private defauts(): AtelierDefauts {
    return this.store.get()?.defauts ?? atelierDefauts(DEFAULTS);
  }

  /** Le bouton « Reprendre » dépend de l'escalier ouvert. */
  refresh(): void {
    this.render();
  }

  private render(): void {
    const d = this.defauts();
    for (const c of CHAMPS) {
      const el = byId<HTMLInputElement>(`at-${c.k}`);
      const v = d[c.k];
      if (typeof v === "boolean") el.checked = v;
      else el.value = String(v);
    }
    const cur = this.host.params();
    byId<HTMLButtonElement>("atTake").disabled = !cur;
    byId("atSum").textContent = isDefaultAtelier(d)
      ? "Pour l'instant, les réglages de l'escalier d'exemple."
      : `En ce moment : ${ESSENCE_LABEL[d.ess].toLowerCase()}, marches de ${fmt(d.et)} mm, limons de ${fmt(d.el)} mm.`;
  }

  /** Champs lus ; un champ vide garde la valeur enregistrée. */
  private read(): AtelierDefauts {
    const raw: Record<string, unknown> = {};
    for (const c of CHAMPS) {
      const el = byId<HTMLInputElement>(`at-${c.k}`);
      const r = reglage(c.k);
      if (r.valeurs) raw[c.k] = el.value;
      else if (!r.saisie) raw[c.k] = el.checked;
      else {
        const v = parseFloat(el.value);
        if (!Number.isNaN(v)) raw[c.k] = v;
      }
    }
    return atelierDefauts(sanitizeParams({ ...DEFAULTS, ...this.defauts(), ...raw }));
  }

  private save(defauts: AtelierDefauts): void {
    this.store.set({ defauts });
    this.host.saved();
  }

  private edited(): void {
    this.save(this.read());
  }

  /** Garde l'escalier ouvert comme habitude de l'atelier ; `fb` reçoit le message. */
  keep(fb: HTMLElement = this.msg): void {
    const cur = this.host.params();
    if (!cur) return;
    this.save(atelierDefauts(cur));
    flash(fb, "Gardé : vos prochains escaliers partiront avec ces réglages", false, 6000);
  }

  private reset(): void {
    this.save(atelierDefauts(DEFAULTS));
    flash(this.msg, "Réglages de l'exemple retrouvés");
  }
}
