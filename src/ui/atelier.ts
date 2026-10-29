import {
  atelierDefauts,
  atelierParams,
  isDefaultAtelier,
  sanitizeAtelier,
  type Atelier,
  type AtelierDefauts,
  type AtelierKey,
} from "../core/atelier";
import { fmt } from "../core/format";
import { DEFAULTS, sanitizeParams, type Params } from "../core/params";
import { ESSENCE_LABEL, GC_LABEL } from "../core/summary";
import { byId, flash } from "./dom";
import { browserStorage, read, write, type KeyValue } from "./store";

const ATELIER_KEY = "limon-atelier";

/**
 * Profil de l'atelier sur cet appareil. Écrit tout de suite dans le stockage du navigateur ; avec un
 * compte, `SyncStore` le recopie sur les autres appareils, la version la plus récente gagnant.
 */
export class AtelierStore {
  private a: Atelier | null;
  private listeners: (() => void)[] = [];

  constructor(private storage: KeyValue | null = browserStorage()) {
    let raw: unknown;
    try {
      raw = JSON.parse(read(storage, ATELIER_KEY) ?? "null");
    } catch {
      raw = null;
    }
    this.a = sanitizeAtelier(raw);
  }

  /** Null tant que l'artisan n'a rien gardé : les nouveaux escaliers partent alors de l'exemple. */
  get(): Atelier | null {
    return this.a;
  }

  /** Réglages de départ d'un nouvel escalier. */
  params(): Params {
    return atelierParams(this.a);
  }

  set(defauts: AtelierDefauts, now = Date.now()): void {
    this.put({ defauts, modifie: now });
  }

  /** Version reçue du compte, plus récente que celle d'ici. */
  adopt(a: Atelier): void {
    this.put(a);
  }

  /** Le profil quitte l'appareil : déconnexion, ou connexion à un autre compte. */
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

/** Un réglage du profil, dessiné comme les champs de la colonne de réglages. */
interface Champ {
  k: AtelierKey;
  l: string;
  /** Précision sous l'intitulé. */
  s?: string;
  /** Réglage avancé, masqué sans la préférence de l'appareil. */
  adv?: boolean;
  pas?: number;
  min?: number;
  /** Case à cocher, avec le mot qui la suit. */
  coche?: string;
  opts?: readonly (readonly [string, string])[];
}

const GROUPES: readonly { t: string; champs: readonly Champ[] }[] = [
  {
    t: "Bois",
    champs: [
      { k: "ess", l: "Essence", opts: Object.entries(ESSENCE_LABEL) },
      { k: "et", l: "Épaisseur de marche", min: 18 },
      { k: "deb", l: "Débord de nez", s: "recouvrement", min: 0, adv: true },
      { k: "rn", l: "Rayon du nez", s: "arrondi dessus et dessous, 0 = vif", min: 0, adv: true },
      { k: "cm", l: "Contremarches", coche: "avec" },
      { k: "ecm", l: "Épaisseur de contremarche", min: 10 },
    ],
  },
  {
    t: "Limons et poteau",
    champs: [
      { k: "el", l: "Épaisseur de limon", min: 20 },
      { k: "hl", l: "Hauteur de limon", s: "limon de mur en quart tournant", pas: 5, min: 150, adv: true },
      { k: "hljAuto", l: "Hauteur du limon de jour", coche: "automatique", adv: true },
      { k: "ps", l: "Section du poteau", s: "carrée", pas: 5, min: 75 },
    ],
  },
  {
    t: "Assemblage et plateaux",
    champs: [
      { k: "enc", l: "Encastrement", s: "marches et contremarches dans les limons", min: 0, adv: true },
      { k: "jeu", l: "Jeu d'assemblage", s: "par côté, sur les logements", pas: 0.1, min: 0, adv: true },
      { k: "pL", l: "Longueur des plateaux", s: "bois disponible, dans le fil", pas: 100, min: 500, adv: true },
      { k: "pW", l: "Largeur des plateaux", s: "bois disponible", pas: 10, min: 100, adv: true },
    ],
  },
  {
    t: "Garde-corps",
    champs: [
      { k: "gc", l: "Côté jour", opts: Object.entries(GC_LABEL) },
      {
        k: "gcPose",
        l: "Pose sur le limon",
        opts: [
          ["chant", "Dans le chant"],
          ["anglaise", "À l'anglaise"],
        ],
      },
      { k: "mcL", l: "Largeur de main courante", pas: 5, min: 30 },
      { k: "mcH", l: "Hauteur de main courante", pas: 5, min: 30 },
      { k: "bs", l: "Section des balustres", s: "carrée ; montants et lisses aussi", min: 20 },
    ],
  },
];

const CHAMPS: readonly Champ[] = GROUPES.flatMap((g) => g.champs);

function rowHTML(c: Champ): string {
  const id = `at-${c.k}`;
  const adv = c.adv ? " data-adv" : "";
  const lab = `<label for="${id}">${c.l}${c.s ? `<small>${c.s}</small>` : ""}</label>`;
  if (c.opts) {
    const opts = c.opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
    return `<div class="row"${adv}>${lab}<select id="${id}">${opts}</select></div>`;
  }
  if (c.coche)
    return `<div class="row"${adv}>${lab}<label class="check"><input type="checkbox" id="${id}" /> ${c.coche}</label></div>`;
  const pas = c.pas ?? 1;
  const mode = pas < 1 ? "" : ' inputmode="numeric"';
  return (
    `<div class="row"${adv}>${lab}<div class="num">` +
    `<input id="${id}" type="number"${mode} step="${pas}" min="${c.min ?? 0}" /><span>mm</span>` +
    `</div></div>`
  );
}

/** Ce que la page fournit au profil de l'atelier. */
export interface AtelierHost {
  /** Réglages de l'escalier ouvert, null si aucun ne l'est. */
  params(): Params | null;
  /** Le profil a changé : à envoyer au compte. */
  saved(): void;
}

/** « Mon atelier » dans le dialogue du compte : les réglages gardés d'un escalier à l'autre. */
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
          `<div class="group"${g.champs.every((c) => c.adv) ? " data-adv" : ""}>` +
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
      ? "comme l'exemple"
      : `${ESSENCE_LABEL[d.ess].toLowerCase()}, marches de ${fmt(d.et)} mm, limons de ${fmt(d.el)} mm`;
  }

  /** Champs lus ; un champ vide garde la valeur enregistrée. */
  private read(): AtelierDefauts {
    const raw: Record<string, unknown> = {};
    for (const c of CHAMPS) {
      const el = byId<HTMLInputElement>(`at-${c.k}`);
      if (c.opts) raw[c.k] = el.value;
      else if (c.coche) raw[c.k] = el.checked;
      else {
        const v = parseFloat(el.value);
        if (!Number.isNaN(v)) raw[c.k] = v;
      }
    }
    return atelierDefauts(sanitizeParams({ ...DEFAULTS, ...this.defauts(), ...raw }));
  }

  private save(d: AtelierDefauts): void {
    this.store.set(d);
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
