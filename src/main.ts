import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/main.css";

import { buildCNC, type CNC } from "./cnc/build";
import { cutListCSV } from "./cnc/cutlist";
import { toDXF } from "./cnc/dxf";
import { exportFilename, exportZip } from "./cnc/package";
import { pieces, tightBoards } from "./core/pieces";
import { ENTREPRISE_VIDE, TARIFS_VIDES } from "./core/tarifs";
import { DEFAULTS, changeForme, type Params } from "./core/params";
import {
  DROITS,
  ABONNEMENT_OUVERT,
  enLecture,
  formeOuverte,
  niveauActif,
  statutReel,
  type Droits,
} from "./core/niveaux";
import {
  NOM_PAR_DEFAUT,
  canFinish,
  edited,
  fileBase,
  newProject,
  touched,
  withDevis,
  withEtat,
  type Project,
} from "./core/project";
import { linkOpensNew, paramsFromHash, paramsToHash, sameLink } from "./core/share";
import { treadsCSV } from "./core/sheet";
import { fichePDF } from "./pdf/fiche";
import { compute, turnLengths, type ComputeResult, type Stair } from "./core/stair";
import { SECTIONS, sectionSummaries } from "./core/summary";
import { cutListHTML, previewSVG, stockFitHTML, stringerFitHTML } from "./ui/cnc-panel";
import { byId, copyText, downloadBytes, flash } from "./ui/dom";
import { planSVG, sideSVG } from "./ui/plan";
import { notesHTML, tilesHTML, treadsTableHTML } from "./ui/results";
import type { Scene3D } from "./ui/scene3d";
import { AccountPanel } from "./ui/account";
import { Aide } from "./ui/aide";
import { AtelierPanel, AtelierStore } from "./ui/atelier";
import { TarifsPanel } from "./ui/tarifs";
import { DevisView } from "./ui/devis";
import { day, fmt } from "./core/format";
import { Home } from "./ui/home";
import { showSketch } from "./ui/sketch";
import { Api } from "./ui/api";
import { startPWA } from "./ui/pwa";
import { missingErrors, readInputs, showFieldErrors, syncInputs, writeInputs } from "./ui/settings";
import { Steps } from "./ui/steps";
import { leaveOldHost } from "./ui/move";
import { LocalStore, browserStorage, newId, read, write } from "./ui/store";
import { SyncStore } from "./ui/sync";
import { Tabs } from "./ui/tabs";
import { Undo } from "./ui/undo";

const api = new Api();
const atelier = new AtelierStore();
const store = new SyncStore(new LocalStore(), api, browserStorage(), atelier);
const leaving = leaveOldHost();
// Lu avant le premier calcul, qui réécrit l'adresse.
const sharedAtStart = paramsFromHash(location.hash);
/** Boutons de la page publique : « Calculer mon escalier » (?nouveau), « Voir un exemple » (?exemple),
    « Mes escaliers » (?accueil). Mon compte (?compte), au retour de la page de paiement (?compte=paye). */
const asked = new URLSearchParams(location.search);
if (asked.size) history.replaceState(null, "", location.pathname + location.hash);
let project: Project | null = null;
/** Identifiant de l'escalier reçu par lien, à l'écran mais ni enregistré ni envoyé au compte tant que l'artisan n'y a pas touché. */
let received: string | null = null;
/** Droits du niveau appliqué sur cet appareil. */
let droits: Droits = DROITS.premium;
/** Escaliers en lecture seule, et nombre d'escaliers gardés, relus avec la liste. */
let lecture = new Set<string>();
let gardes = 0;
const enLectureSeule = () => project !== null && project.id !== received && lecture.has(project.id);
let params: Params = { ...DEFAULTS };
let current: ComputeResult | null = null;
let cnc: CNC | null = null;
let scene: Scene3D | null = null;
/** Vue du plan : de dessus, ou de côté (développé sur la ligne de foulée). */
let planCote = false;
/** Onglet Devis de l'escalier ouvert ; recalculé seulement quand il est à l'écran. */
const devisView = new DevisView({
  project: () => project,
  stair: () => (current?.ok ? current.stair : null),
  tarifs: () => atelier.get()?.tarifs ?? TARIFS_VIDES,
  entreprise: () => atelier.get()?.entreprise ?? ENTREPRISE_VIDE,
  clientsCaches: () => store.hidesClients(),
  saved: (d) => {
    if (!project) return;
    project = withDevis(project, d, Date.now());
    saveProject();
    devisView.refresh();
  },
  openTarifs: () => void home.show("atelier"),
  openCompte: () => void home.show("compte"),
  // Le compte ne numérote que ses escaliers : celui qui attend encore d'y partir, fait hors ligne, y part d'abord.
  numero: async (id) => {
    await store.sync();
    return api.devisNumero(id);
  },
  // Une version remise peut avoir un autre escalier que celui à l'écran : on le dessine le temps de la capture.
  vue3d: (R) => {
    if (!scene) return null;
    const other = !current?.ok || current.stair !== R;
    if (other) scene.draw(R);
    const v = scene.snapshot();
    if (other && current?.ok) scene.draw(current.stair);
    return v;
  },
  download: (data, filename) => downloadBytes(data, filename, "application/pdf"),
});

/** Enregistre l'escalier ouvert après un geste de l'artisan ; le premier garde l'escalier reçu par lien. */
function saveProject(): void {
  if (!project || enLectureSeule()) return;
  if (project.id === received) {
    // Au gratuit, un escalier reçu ne prend la place du sien que par « Garder cet escalier ».
    if (gardes >= droits.escaliers) return;
    gardes++;
    received = null;
    byId("recu").hidden = true;
    void store.setCurrent(project.id);
  }
  void store.save(project);
}
const keepReceived = () => {
  if (project?.id === received) saveProject();
};
/** Tire de la liste ce qui dépend du nombre d'escaliers ; l'escalier à l'écran suit. */
function listed(all: Project[]): void {
  lecture = enLecture(droits, all);
  gardes = all.length;
  showLecture();
}
function showLecture(): void {
  const on = enLectureSeule();
  byId("lecture").hidden = !on;
  // Les champs seulement : le pas à pas d'un escalier en lecture seule doit pouvoir mener à sa vue et à sa fiche.
  document.querySelectorAll<HTMLElement>(".side .sbody").forEach((el) => (el.inert = on));
  byId("notes").inert = on;
  byId("pjName").inert = on;
  byId("undoBox").hidden = on;
  byId("etatBox").hidden = on;
}
const relire = async () => listed(await store.list());

function render(result: ComputeResult): void {
  const errHTML = (e: string) => `<div class="errbox">${e}</div>`;
  if (!result.ok) {
    // Les erreurs rattachées à un champ s'affichent sous ce champ ; les vues renvoient vers le formulaire.
    const msg = result.errors.some((e) => e.key)
      ? "Calcul impossible : corrigez les champs signalés en rouge."
      : result.errors[0]!.message;
    cnc = null;
    byId("plan").innerHTML = errHTML(msg);
    byId("tiles").innerHTML = "";
    byId("table").innerHTML = "";
    byId("notes").innerHTML = "";
    byId("tabFiche").classList.remove("alert");
    byId("cnc").hidden = true;
    scene?.showError(msg);
    return;
  }
  const R = result.stair;
  drawPlan(R);
  byId("tiles").innerHTML = tilesHTML(R);
  byId("notes").innerHTML = notesHTML(R.notes);
  // Pastille sur l'onglet Fiche du téléphone : une règle n'est pas respectée.
  byId("tabFiche").classList.toggle(
    "alert",
    R.notes.some(([s]) => s === "warn" || s === "bad"),
  );
  byId("table").innerHTML = treadsTableHTML(R);
  scene?.draw(R);

  byId("cnc").hidden = false;
  // L'export CNC n'est calculé que lorsque sa section est ouverte.
  cnc = byId("cncBody").hidden ? null : buildCNC(R);
  if (!cnc) return;
  byId("pvT").innerHTML = previewSVG(cnc.treadEnts, "Aperçu des marches à découper");
  byId("pvB").innerHTML = previewSVG(cnc.boardEnts, "Aperçu des limons développés");
  byId("pvRbox").hidden = byId("cpR").hidden = !R.params.cm;
  byId("pvR").innerHTML = previewSVG(cnc.riserEnts, "Aperçu des contremarches à découper");
  byId("pvPbox").hidden = byId("cpP").hidden = !R.newels.length;
  byId("pvP").innerHTML = previewSVG(cnc.postEnts, "Aperçu des faces du poteau");
  byId("pvGbox").hidden = byId("cpG").hidden = !cnc.rail;
  byId("pvG").innerHTML = cnc.rail ? previewSVG(cnc.rail.ents, "Aperçu des pièces du garde-corps") : "";
  byId("cncnotes").innerHTML = stringerFitHTML(cnc.boardParts, R) + stockFitHTML(cnc, R);
  byId("parts").innerHTML = cutListHTML(cnc, R);
}

function update(): void {
  queued = false;
  const read = readInputs(params);
  const next = changeForme(params, read.params);
  if (next !== read.params) writeInputs(next);
  params = next;
  if (project) {
    const changed = edited(project, params, Date.now());
    if (changed !== project) {
      if (changed.etat !== project.etat)
        flash(byId("etatMsg"), "Modifié : l'escalier repasse en brouillon", false, 6000);
      project = changed;
      // Sans geste de l'artisan, un écart de relecture des champs n'enregistre pas un escalier reçu par lien.
      if (project.id !== received && !enLectureSeule()) void store.save(project);
      showEtat();
    }
  }
  undo.record(params);
  const hash = paramsToHash(params);
  if (location.hash.slice(1) !== hash) history.replaceState(null, "", hash ? `#${hash}` : location.pathname);
  current = compute(params);
  syncInputs(params, current.ok ? current.stair : null);
  showFieldErrors([...missingErrors(params, read.missing), ...(current.ok ? [] : current.errors)]);
  const sums = sectionSummaries(params, current.ok ? current.stair : null);
  SECTIONS.forEach((k) => (byId(`sum-${k}`).textContent = sums[k]));
  // Sans les réglages avancés, la section Marches montre le choix fait par le calcul.
  const R = current.ok ? current.stair : null;
  byId("marchesAuto").innerHTML = R
    ? `${R.n} hauteurs de ${fmt(R.h, 1)} mm, giron de ${fmt(R.g, 1)} mm.`
    : "Le nombre de marches sera choisi une fois les cotes justes.";
  sketches();
  render(current);
  devisView.refresh();
}

let queued = false;
function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
}

/** Réglages changés d'un coup (correction d'une note, retour à l'exemple, annuler) : la saisie en attente passe avant. */
function setParams(p: Params): void {
  if (enLectureSeule()) return;
  keepReceived();
  if (queued) update();
  undo.touched(null);
  params = p;
  writeInputs(params);
  update();
}
const undo = new Undo(
  {
    flush: () => {
      if (queued) update();
    },
    apply: setParams,
  },
  params,
);

/** Croquis des cotes : celle du champ en cours de saisie, sinon la première de la section. */
function sketches(focused = document.activeElement?.id): void {
  document
    .querySelectorAll<HTMLElement>("[data-sketch]")
    .forEach((fig) => showSketch(fig, params.forme, focused, params.tForme));
}

/** État de l'escalier ouvert : pastille de l'en-tête et bandeau au-dessus de la fiche. */
function showEtat(): void {
  const fini = project?.etat === "fini";
  const badge = byId("pjEtat");
  badge.textContent = fini ? "Terminé" : "Brouillon";
  badge.classList.toggle("fini", fini);
  byId("etatBox").classList.toggle("fini", fini);
  byId("etatTxt").innerHTML = fini
    ? `<b>Terminé le ${day(project!.finiLe)}.</b> La fiche est prête à remettre. Une modification le repasse en brouillon.`
    : "<b>Brouillon.</b> La fiche porte la mention « brouillon » tant que l'escalier n'est pas dit terminé.";
  if (!droits.ficheComplete)
    byId("etatTxt").innerHTML = fini
      ? `<b>Terminé le ${day(project!.finiLe)}.</b> La fiche de l'offre gratuite garde la mention « brouillon ».`
      : "<b>Brouillon.</b> La fiche de l'offre gratuite garde cette mention.";
  byId("etatBtn").textContent = fini ? "Repasser en brouillon" : "Escalier terminé";
}
byId("etatBtn").addEventListener("click", () => {
  if (!project) return;
  if (queued) update();
  const fini = project.etat === "fini";
  const can = fini ? "oui" : canFinish(current);
  if (can === "non") {
    flash(byId("etatMsg"), "Corrigez d'abord les cotes signalées en rouge", true, 6000);
    return;
  }
  if (
    can === "confirmer" &&
    !confirm("Des contrôles ne sont pas respectés (en rouge). Dire l'escalier terminé quand même ?")
  )
    return;
  project = withEtat(project, fini ? "brouillon" : "fini", Date.now());
  saveProject();
  showEtat();
  const finiMsg = droits.ficheComplete ? "Terminé : la fiche ne porte plus la mention brouillon" : "Terminé";
  flash(byId("etatMsg"), fini ? "Repassé en brouillon" : finiMsg);
});

/** Met un escalier à l'écran (état, champs, calcul), sans toucher à l'accueil ni à l'export. */
function showProject(p: Project | null): void {
  // Le bouton « Reprendre » de Mon atelier suit la présence d'un escalier ; recharger ce panneau effacerait sa saisie.
  const reprendre = !p !== !project;
  project = p;
  byId("recu").hidden = !p || p.id !== received;
  showLecture();
  params = p ? { ...p.params } : { ...DEFAULTS };
  byId<HTMLInputElement>("pjName").value = p?.nom ?? "";
  writeInputs(params);
  steps.apply(p?.mode ?? "complet", p?.etape ?? 0);
  // Le devis n'existe pas en pas à pas : l'escalier n'est pas encore dessiné.
  if (tabs.current === "devis" && p?.mode !== "complet") tabs.show("reglages");
  if (reprendre) atelierPanel.refresh();
  showEtat();
  update();
}

/** Ouvre un escalier ; null quand il n'en reste aucun : l'accueil prend alors la page. */
function openProject(p: Project | null): void {
  void relire();
  if (p) home.hide();
  else void home.show();
  setCNC(false);
  showProject(p);
  // L'historique appartient à l'escalier ouvert.
  undo.reset(params);
}

const steps = new Steps((mode, etape) => {
  if (!project) return;
  project = { ...project, mode, etape, ...touched(project, Date.now()) };
  saveProject();
});

/** Ouvre ou replie l'export CNC. */
function setCNC(on: boolean): void {
  byId("cncBody").hidden = byId("dl").hidden = byId("cncClose").hidden = !on;
  byId("cncIntro").hidden = byId("cncOpen").hidden = on;
}
byId("cncOpen").addEventListener("click", () => {
  setCNC(true);
  update();
});
byId("cncClose").addEventListener("click", () => {
  setCNC(false);
  update();
});

/** Bouton Devis de l'en-tête : passe de l'escalier à son devis et retour. */
function showDevisBtn(tab: string): void {
  const on = tab === "devis";
  byId("devisBtn").setAttribute("aria-pressed", String(on));
  byId("devisBtnTxt").textContent = on ? "Escalier" : "Devis";
}
const tabs = new Tabs(byId("tabbar"), document.querySelector<HTMLElement>(".work")!, (tab) => {
  showDevisBtn(tab);
  if (tab === "devis") devisView.refresh();
});
byId("devisBtn").addEventListener("click", () => tabs.show(tabs.current === "devis" ? "reglages" : "devis"));
// Tarifs changés dans Mon atelier ou reçus du compte : le devis à l'écran suit.
atelier.onChange(() => devisView.refresh());

/** Réglages de départ : ceux de l'atelier quand le niveau les comprend. */
const depart = (): Params => (droits.atelier ? atelier.params() : { ...DEFAULTS });

/** Nouvel escalier : réglages de l'atelier, et toujours en pas à pas sauf choix contraire. */
async function startNew(nom = "", mode: Project["mode"] = "guide", p: Params = depart()): Promise<void> {
  if (!(await home.makeRoom())) return;
  const q = newProject(newId(), nom, mode, Date.now(), p);
  await store.save(q);
  await store.setCurrent(q.id);
  openProject(q);
}

const account = new AccountPanel(store, api, browserStorage());
const home = new Home(store, {
  current: () => project,
  params: depart,
  open: openProject,
  example: () => void example(),
  signedIn: () => store.account() !== null,
  known: () => store.known(),
  account: () => void account.show(),
  droits: () => droits,
  listed,
});
const atelierPanel = new AtelierPanel(atelier, {
  params: () => (project ? params : null),
  saved: () => store.atelierChanged(),
});
// Après Mon atelier, dont les lignes sont créées par le panneau.
new Aide(
  () => params.forme,
  () => params.tForme,
).attach();
new TarifsPanel(atelier, {
  params: () => (project ? params : null),
  saved: () => store.atelierChanged(),
});
byId("atKeep").addEventListener("click", () => atelierPanel.keep(byId("sharemsg")));
byId("homeBtn").addEventListener("click", () => void home.show());
byId("pjOpen").addEventListener("click", () => void home.show());
byId("acOpen").addEventListener("click", () => void home.show("compte"));
byId("pjNew").addEventListener("click", () => void startNew());

/** Préférences de l'appareil : une écriture refusée ne dit rien à l'artisan, le choix vaut pour cette visite. */
const prefs = browserStorage();

/** Devis, en préparation : visible sur l'appareil ouvert une fois avec ?devis, masqué de nouveau avec ?devis=0. */
const DEVIS_KEY = "limon-devis";
if (asked.has("devis")) write(prefs, DEVIS_KEY, asked.get("devis") !== "0" ? "1" : "0");

/** Niveau, pour l'essayer avant le paiement en ligne : ?niveau=gratuit, payant, premium ou compte ; ?niveau=0 l'enlève. */
const NIVEAU_KEY = "limon-niveau";
if (asked.has("niveau")) write(prefs, NIVEAU_KEY, asked.get("niveau") === "0" ? null : asked.get("niveau"));

/** Réglages avancés : une préférence de l'appareil, réglée dans l'onglet Mon compte. */
const ADV_KEY = "limon-avance";
function setAdvanced(on: boolean): void {
  document.body.classList.toggle("avance", on);
  byId<HTMLInputElement>("advToggle").checked = on;
  sketches();
}

/** Applique le niveau de cet appareil ; suit le compte quand celui-ci change. */
function applyNiveau(): void {
  droits = DROITS[niveauActif(read(prefs, NIVEAU_KEY), statutReel(store.account(), Date.now()))];
  document.body.classList.toggle("payant", droits.fabrication);
  // Avant l'activation, le devis attend encore sa préférence ; ensuite, il va avec le niveau.
  document.body.classList.toggle("devis", droits.devis && (ABONNEMENT_OUVERT || read(prefs, DEVIS_KEY) === "1"));
  byId("acEssai").hidden = !ABONNEMENT_OUVERT;
  if (!droits.devis && tabs.current === "devis") tabs.show("reglages");
  document.querySelectorAll<HTMLInputElement>('input[name="forme"]').forEach((r) => {
    r.disabled = !formeOuverte(droits, r.value === "droit" ? "droit" : (`${r.value}-d` as Params["forme"]));
  });
  byId<HTMLSelectElement>("tournant").querySelector<HTMLOptionElement>('option[value="palier"]')!.disabled =
    !droits.formes;
  const fmt = byId<HTMLSelectElement>("ficheFmt");
  for (const o of fmt.options) o.disabled = !droits.fabrication && o.value !== "pdf";
  if (fmt.selectedOptions[0]?.disabled) fmt.value = "pdf";
  const adv = byId<HTMLInputElement>("advToggle");
  adv.disabled = !droits.avance;
  setAdvanced(droits.avance && read(prefs, ADV_KEY) === "1");
  if (!droits.fabrication) setCNC(false);
  showEtat();
}
applyNiveau();
store.onStatus(() => {
  const avant = droits;
  applyNiveau();
  if (droits !== avant) void relire();
});
byId<HTMLInputElement>("advToggle").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  setAdvanced(on);
  write(prefs, ADV_KEY, on ? "1" : "0");
});

/** Une seule vue à l'écran, le plan ou la 3D, chacune avec ses deux points de vue. */
function showVue(plan: boolean): void {
  byId("vuePlan").setAttribute("aria-pressed", String(plan));
  byId("vue3d").setAttribute("aria-pressed", String(!plan));
  byId("vue").dataset.vue = plan ? "plan" : "3d";
}
byId("vuePlan").addEventListener("click", () => showVue(true));
byId("vue3d").addEventListener("click", () => showVue(false));

/** Vue à l'ouverture : une préférence de l'appareil, réglée dans l'onglet Mon compte. */
const VUE_KEY = "limon-vue";
function setFavori(plan: boolean): void {
  byId("favoriPlan").setAttribute("aria-pressed", String(plan));
  byId("favori3d").setAttribute("aria-pressed", String(!plan));
  showVue(plan);
}
setFavori(read(prefs, VUE_KEY) === "plan");
for (const [id, plan] of [
  ["favoriPlan", true],
  ["favori3d", false],
] as const) {
  byId(id).addEventListener("click", () => {
    setFavori(plan);
    write(prefs, VUE_KEY, plan ? "plan" : "3d");
  });
}

/** Projets changés sur un autre appareil ou dans un autre onglet : le projet ouvert se met à jour, ou laisse la place s'il a été supprimé. */
store.onChange(async (ids) => {
  await relire();
  if (project && ids.includes(project.id)) {
    const p = await store.get(project.id);
    if (p) {
      // Même escalier : l'écran en cours reste, seul l'historique repart de la version reçue.
      if (p.modifie !== project.modifie) {
        showProject(p);
        undo.reset(params);
      } else {
        // Même version : seul son devis change, caché quand la session se perd, revenu à la reconnexion.
        project = { ...project, devis: p.devis };
        devisView.refresh();
      }
    } else {
      const next = (await store.list())[0] ?? null;
      if (home.visible) {
        // Supprimé ailleurs pendant que l'artisan est sur l'accueil : il y reste, l'escalier suivant prend place derrière.
        setCNC(false);
        showProject(next);
        undo.reset(params);
      } else openProject(next);
      if (next) void store.setCurrent(next.id);
    }
  }
  await home.refreshIfOpen();
});
byId<HTMLInputElement>("pjName").addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (!project) return;
  project = { ...project, nom: el.value.trim() || NOM_PAR_DEFAUT, ...touched(project, Date.now()) };
  el.value = project.nom;
  saveProject();
});
// Avant un rechargement silencieux : la saisie en cours (nom du projet, réglage) est enregistrée.
startPWA(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  if (queued) update();
});

/* ---------- Événements ---------- */
const onEdit = (e: Event) => {
  keepReceived();
  undo.touched(e.target);
  schedule();
};
for (const el of [document.querySelector<HTMLElement>(".side")!, byId("cncBody")]) {
  el.addEventListener("input", onEdit);
  el.addEventListener("change", onEdit);
}
document.querySelector<HTMLElement>(".side")!.addEventListener("focusin", (e) => {
  if ((e.target as HTMLElement).matches("input[type=number]")) sketches((e.target as HTMLElement).id);
});
// Marches droites avant le tour : l'angle se déplace, A et B sont recalculés à total constant.
byId<HTMLInputElement>("tour").addEventListener("input", (e) => {
  const k = parseInt((e.target as HTMLInputElement).value, 10);
  const ab = Number.isNaN(k) ? null : turnLengths(readInputs(params).params, k);
  if (!ab) return;
  byId<HTMLInputElement>("A").value = String(ab.A);
  byId<HTMLInputElement>("B").value = String(ab.B);
});
byId("reset").addEventListener("click", () => {
  setParams({ ...DEFAULTS });
});
byId("notes").addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-fix]");
  const fix = btn && current?.ok ? current.stair.notes[Number(btn.dataset.fix)]?.[2] : undefined;
  if (!fix) return;
  setParams({ ...params, ...fix.set });
});
/** Un lien montre son escalier sans rien écrire. Déjà gardé, il le rouvre plutôt que d'en préparer une copie. */
async function openShared(p: Params): Promise<void> {
  if (!linkOpensNew(p, project?.params ?? null)) return;
  const kept = (await store.list()).find((q) => sameLink(q.params, p));
  if (kept) {
    openProject(kept);
    void store.setCurrent(kept.id);
    return;
  }
  const q = newProject(newId(), "Escalier reçu par lien", "complet", Date.now(), p);
  received = q.id;
  byId("recuTxt").textContent = "Escalier reçu par lien : pas encore dans Mes escaliers.";
  openProject(q);
}
byId("recuGarde").addEventListener("click", () => {
  if (gardes < droits.escaliers) return keepReceived();
  void home.makeRoom().then(async (place) => {
    if (!place) return;
    await relire();
    keepReceived();
  });
});
const example = async () => {
  await relire();
  if (gardes < droits.escaliers) return startNew("Exemple", "complet", { ...DEFAULTS });
  // Au gratuit, l'exemple se regarde sans prendre la place de l'escalier gardé.
  const q = newProject(newId(), "Exemple", "complet", Date.now(), { ...DEFAULTS });
  received = q.id;
  byId("recuTxt").textContent = "Exemple : pas encore dans Mes escaliers.";
  openProject(q);
};
window.addEventListener("hashchange", () => {
  const p = paramsFromHash(location.hash);
  if (p) void openShared(p);
});
byId("share").addEventListener("click", async () => {
  if (await copyText(location.href, byId<HTMLTextAreaElement>("linkfb")))
    flash(byId("sharemsg"), "Lien copié : collez-le dans un message ou un e-mail", false, 6000);
});
/** Point de vue de la 3D : un seul des deux boutons enfoncé. */
function view3d(top: boolean): void {
  byId("v3d").setAttribute("aria-pressed", String(!top));
  byId("vtop").setAttribute("aria-pressed", String(top));
  if (top) scene?.viewTop();
  else scene?.viewPerspective();
}
byId("v3d").addEventListener("click", () => view3d(false));
byId("vtop").addEventListener("click", () => view3d(true));

/** Téléphone : la vue de côté, plus large que haute, y est réduite ; son texte est agrandi. */
const phone = window.matchMedia("(max-width: 920px)");
function drawPlan(R: Stair): void {
  byId("plan").innerHTML = planCote ? sideSVG(R, phone.matches) : planSVG(R);
}
/** Vue du plan : un seul des deux boutons enfoncé ; la légende suit. */
function viewPlan(cote: boolean): void {
  planCote = cote;
  byId("pdessus").setAttribute("aria-pressed", String(!cote));
  byId("pcote").setAttribute("aria-pressed", String(cote));
  byId("vue").dataset.plan = cote ? "cote" : "dessus";
  if (current?.ok) drawPlan(current.stair);
}
byId("pdessus").addEventListener("click", () => viewPlan(false));
byId("pcote").addEventListener("click", () => viewPlan(true));
phone.addEventListener("change", () => {
  if (planCote && current?.ok) drawPlan(current.stair);
});

byId("ficheDl").addEventListener("click", async () => {
  if (!current?.ok) return;
  const base = fileBase(project?.nom ?? NOM_PAR_DEFAUT);
  const kind = byId<HTMLSelectElement>("ficheFmt").value;
  const csv = (text: string, nom: string) =>
    downloadBytes(new TextEncoder().encode("\ufeff" + text), `${base} - ${nom}.csv`, "text/csv");
  if (kind === "csv") csv(treadsCSV(current.stair), "marches");
  else if (kind === "debit") csv(cutListCSV(cnc ?? pieces(current.stair), current.stair), "liste de débit");
  else {
    // La fiche porte toujours la 3D : si elle se charge encore, on l'attend.
    await sceneReady;
    if (!current?.ok) return;
    const vue3d = scene?.snapshot() ?? undefined;
    const date = new Date().toLocaleDateString("fr-FR");
    const nom = project?.nom ?? NOM_PAR_DEFAUT;
    const brouillon = project?.etat !== "fini" || !droits.ficheComplete;
    const extrait = !droits.ficheComplete;
    downloadBytes(
      fichePDF(current.stair, { nom, date, brouillon, extrait, ...(vue3d ? { vue3d } : {}) }),
      `${base}${brouillon ? " (brouillon)" : ""}.pdf`,
      "application/pdf",
    );
  }
  flash(byId("ficheMsg"), kind === "debit" ? "Liste de débit enregistrée" : "Fiche enregistrée");
});
/** Confirmation avant d'exporter des limons dont les logements débordent sous le bord. */
const confirmTight = (c: CNC): boolean =>
  !tightBoards(c.boardParts).length ||
  window.confirm(
    "Des logements débordent sous le bord du limon : ces limons ne sont pas fabricables tels quels. Exporter quand même ?",
  );
byId("dl").addEventListener("click", () => {
  if (!current?.ok || !cnc || !confirmTight(cnc)) return;
  downloadBytes(exportZip(current.stair, cnc), exportFilename(current.stair), "application/zip");
  flash(byId("dlmsg"), "Fichiers enregistrés");
});
const copyDXF = async (which: "treadEnts" | "riserEnts" | "boardEnts" | "postEnts", label: string) => {
  if (!cnc || (which === "boardEnts" && !confirmTight(cnc))) return;
  const text = toDXF(cnc[which]);
  if (await copyText(text, byId<HTMLTextAreaElement>("dxffb"))) flash(byId("cpmsg"), `${label} copié`);
};
byId("cpT").addEventListener("click", () => copyDXF("treadEnts", "marches.dxf"));
byId("cpR").addEventListener("click", () => copyDXF("riserEnts", "contremarches.dxf"));
byId("cpB").addEventListener("click", () => copyDXF("boardEnts", "limons.dxf"));
byId("cpP").addEventListener("click", () => copyDXF("postEnts", "poteau.dxf"));
byId("cpG").addEventListener("click", async () => {
  if (!cnc?.rail) return;
  if (await copyText(toDXF(cnc.rail.ents), byId<HTMLTextAreaElement>("dxffb")))
    flash(byId("cpmsg"), "garde-corps.dxf copié");
});

const reTheme = () => scene?.applyTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reTheme);
new MutationObserver(reTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

/* ---------- Démarrage ---------- */
writeInputs(params);
update();
void (async () => {
  if (leaving) return;
  await relire();
  const id = await store.currentId();
  const start = (id && (await store.get(id))) || (await store.list())[0] || null;
  // Sur un appareil vide, l'accueil ne passe pas avant l'escalier du lien.
  if (start || !sharedAtStart) openProject(start);
  if (start) void store.setCurrent(start.id);
  if (sharedAtStart) await openShared(sharedAtStart);
  else if (asked.has("exemple")) await example();
  else if (asked.has("nouveau")) await startNew();
  else if (asked.has("accueil")) await home.show();
  else if (asked.has("compte")) {
    await home.show("compte");
    if (asked.get("compte") === "paye") void account.paymentDone();
  } else if (account.awaitsCode()) await home.show("compte");
  store.start();
})();
// Three.js est chargé à part : le calcul et le plan s'affichent sans attendre la 3D.
// Le cadrage initial attend les polices, qui changent la largeur de la colonne de réglages.
const sceneReady = Promise.all([import("./ui/scene3d"), document.fonts.ready])
  .then(([{ Scene3D }]) => {
    scene = new Scene3D(byId("scene"), byId("err3d"));
    if (current) render(current);
  })
  .catch(() => {
    const er = byId("err3d");
    er.hidden = false;
    er.textContent = "La vue 3D n'a pas pu démarrer dans ce navigateur.";
  });

// Accès console en développement : le panneau navigateur masqué ne fait pas tourner requestAnimationFrame.
if (import.meta.env.DEV) {
  Object.assign(window, {
    limon: { compute, pieces, buildCNC, toDXF, exportZip, update, current: () => current, scene: () => scene },
  });
}
