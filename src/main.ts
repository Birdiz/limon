import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/main.css";

import { buildCNC, tightBoards, type CNC } from "./cnc/build";
import { cutListCSV } from "./cnc/cutlist";
import { toDXF } from "./cnc/dxf";
import { exportFilename, exportZip } from "./cnc/package";
import { DEFAULTS, type Params } from "./core/params";
import { NOM_PAR_DEFAUT, fileBase, newProject, type Project } from "./core/project";
import { paramsFromHash, paramsToHash } from "./core/share";
import { treadsCSV } from "./core/sheet";
import { fichePDF } from "./pdf/fiche";
import { compute, turnLengths, type ComputeResult } from "./core/stair";
import { SECTIONS, sectionSummaries } from "./core/summary";
import { cutListHTML, previewSVG, stockFitHTML, stringerFitHTML } from "./ui/cnc-panel";
import { byId, copyText, downloadBytes, flash } from "./ui/dom";
import { planSVG } from "./ui/plan";
import { notesHTML, tilesHTML, treadsTableHTML } from "./ui/results";
import type { Scene3D } from "./ui/scene3d";
import { AccountDialog } from "./ui/account";
import { AtelierPanel, AtelierStore } from "./ui/atelier";
import { fmt } from "./core/format";
import { Home } from "./ui/home";
import { showSketch } from "./ui/sketch";
import { Api } from "./ui/api";
import { ProjectsDialog } from "./ui/projects";
import { startPWA } from "./ui/pwa";
import { missingErrors, readInputs, showFieldErrors, syncInputs, writeInputs } from "./ui/settings";
import { Steps } from "./ui/steps";
import { leaveOldHost, storeMoved, takeMoved } from "./ui/move";
import { LocalStore, browserStorage, newId } from "./ui/store";
import { SyncStore } from "./ui/sync";
import { Tabs } from "./ui/tabs";
import { Undo } from "./ui/undo";

const api = new Api();
const atelier = new AtelierStore();
const store = new SyncStore(new LocalStore(), api, browserStorage(), atelier);
const leaving = leaveOldHost(store);
// Lus avant le premier calcul, qui réécrit l'adresse.
const moved = takeMoved();
const sharedAtStart = paramsFromHash(moved ? moved.lien : location.hash);
/** Boutons de la page publique : « Calculer mon escalier » (?nouveau), « Voir un exemple » (?exemple). */
const asked = new URLSearchParams(location.search);
if (asked.size) history.replaceState(null, "", location.pathname + location.hash);
let project: Project | null = null;
let params: Params = { ...DEFAULTS };
let current: ComputeResult | null = null;
let cnc: CNC | null = null;
let scene: Scene3D | null = null;

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
  byId("plan").innerHTML = planSVG(R);
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
  byId("pvPbox").hidden = byId("cpP").hidden = !R.newel;
  byId("pvP").innerHTML = previewSVG(cnc.postEnts, "Aperçu des faces du poteau");
  byId("pvGbox").hidden = byId("cpG").hidden = !cnc.rail;
  byId("pvG").innerHTML = cnc.rail ? previewSVG(cnc.rail.ents, "Aperçu des pièces du garde-corps") : "";
  byId("cncnotes").innerHTML = stringerFitHTML(cnc.boardParts, R) + stockFitHTML(cnc, R);
  byId("parts").innerHTML = cutListHTML(cnc, R);
}

function update(): void {
  queued = false;
  const read = readInputs(params);
  params = read.params;
  if (project && JSON.stringify(params) !== JSON.stringify(project.params)) {
    project = { ...project, params, modifie: Date.now() };
    void store.save(project);
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
}

let queued = false;
function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
}

/** Réglages changés d'un coup (correction d'une note, retour à l'exemple, annuler) : la saisie en attente passe avant. */
function setParams(p: Params): void {
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

/** Ouvre un escalier ; null quand il n'en reste aucun : l'accueil prend alors la page. */
function openProject(p: Project | null): void {
  if (p) home.hide();
  else void home.show();
  project = p;
  params = p ? { ...p.params } : { ...DEFAULTS };
  byId<HTMLInputElement>("pjName").value = p?.nom ?? "";
  writeInputs(params);
  steps.apply(p?.mode ?? "complet", p?.etape ?? 0);
  setCNC(false);
  atelierPanel.refresh();
  update();
  // L'historique appartient à l'escalier ouvert.
  undo.reset(params);
}

const steps = new Steps((mode, etape) => {
  if (!project) return;
  project = { ...project, mode, etape, modifie: Date.now() };
  void store.save(project);
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

new Tabs(byId("tabbar"), document.querySelector<HTMLElement>(".work")!);

/** Nouvel escalier : réglages de l'atelier, et toujours en pas à pas sauf choix contraire. */
async function startNew(nom = "", mode: Project["mode"] = "guide", p: Params = atelier.params()): Promise<void> {
  const q = newProject(newId(), nom, mode, Date.now(), p);
  await store.save(q);
  await store.setCurrent(q.id);
  openProject(q);
}

const projects = new ProjectsDialog(store, {
  current: () => project,
  params: () => atelier.params(),
  open: openProject,
  signedIn: () => store.account() !== null,
});
const account = new AccountDialog(store, api);
const home = new Home(store, {
  current: () => project,
  create: () => void startNew(),
  example: () => void example(),
  open: (p) => {
    openProject(p);
    void store.setCurrent(p.id);
  },
  account: () => void account.show(),
  signedIn: () => store.account() !== null,
});
const atelierPanel = new AtelierPanel(atelier, {
  params: () => (project ? params : null),
  saved: () => store.atelierChanged(),
});
byId("atKeep").addEventListener("click", () => atelierPanel.keep(byId("sharemsg")));
byId("homeBtn").addEventListener("click", () => void home.show());
byId("pjNew").addEventListener("click", () => void startNew());

/** Réglages avancés : une préférence de l'appareil, réglée dans le dialogue Compte. */
const ADV_KEY = "limon-avance";
function setAdvanced(on: boolean): void {
  document.body.classList.toggle("avance", on);
  byId<HTMLInputElement>("advToggle").checked = on;
  sketches();
}
try {
  setAdvanced(localStorage.getItem(ADV_KEY) === "1");
} catch {
  setAdvanced(false);
}
byId<HTMLInputElement>("advToggle").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  setAdvanced(on);
  try {
    localStorage.setItem(ADV_KEY, on ? "1" : "0");
  } catch {
    // Stockage indisponible : l'option vaut pour cette visite.
  }
});
/** Projets changés sur un autre appareil : le projet ouvert se recharge, ou laisse la place s'il a été supprimé. */
store.onChange(async (ids) => {
  if (project && ids.includes(project.id)) {
    const p = await store.get(project.id);
    if (p) {
      if (p.modifie !== project.modifie) openProject(p);
    } else {
      const next = (await store.list())[0] ?? null;
      openProject(next);
      if (next) void store.setCurrent(next.id);
    }
  }
  await projects.refreshIfOpen();
});
byId("pjOpen").addEventListener("click", () => void projects.show());
byId<HTMLInputElement>("pjName").addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (!project) return;
  project = { ...project, nom: el.value.trim() || NOM_PAR_DEFAUT, modifie: Date.now() };
  el.value = project.nom;
  void store.save(project);
});
// Avant un rechargement silencieux : la saisie en cours (nom du projet, réglage) est enregistrée.
startPWA(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  if (queued) update();
});

/* ---------- Événements ---------- */
const edited = (e: Event) => {
  undo.touched(e.target);
  schedule();
};
for (const el of [document.querySelector<HTMLElement>(".side")!, byId("cncBody")]) {
  el.addEventListener("input", edited);
  el.addEventListener("change", edited);
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
/** Un lien de projet devient un nouveau projet, sauf s'il redonne les réglages du projet ouvert. */
async function openShared(p: Params): Promise<void> {
  if (project && JSON.stringify(p) === JSON.stringify(project.params)) return;
  await startNew("Escalier reçu par lien", "complet", p);
}
const example = () => startNew("Exemple", "complet", { ...DEFAULTS });
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

byId("ficheDl").addEventListener("click", () => {
  if (!current?.ok) return;
  const base = fileBase(project?.nom ?? NOM_PAR_DEFAUT);
  const kind = byId<HTMLSelectElement>("ficheFmt").value;
  const csv = (text: string, nom: string) =>
    downloadBytes(new TextEncoder().encode("\ufeff" + text), `${base} - ${nom}.csv`, "text/csv");
  if (kind === "csv") csv(treadsCSV(current.stair), "marches");
  else if (kind === "debit") csv(cutListCSV(cnc ?? buildCNC(current.stair), current.stair), "liste de débit");
  else {
    const vue3d = scene?.snapshot() ?? undefined;
    const date = new Date().toLocaleDateString("fr-FR");
    const nom = project?.nom ?? NOM_PAR_DEFAUT;
    downloadBytes(
      fichePDF(current.stair, { nom, date, ...(vue3d ? { vue3d } : {}) }),
      `${base}.pdf`,
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
  if (moved) await storeMoved(store, moved);
  const id = await store.currentId();
  const start = (id && (await store.get(id))) || (await store.list())[0] || null;
  openProject(start);
  if (start) void store.setCurrent(start.id);
  if (sharedAtStart) await openShared(sharedAtStart);
  else if (asked.has("exemple")) await example();
  else if (asked.has("nouveau")) await startNew();
  store.start();
})();
// Three.js est chargé à part : le calcul et le plan s'affichent sans attendre la 3D.
// Le cadrage initial attend les polices, qui changent la largeur de la colonne de réglages.
Promise.all([import("./ui/scene3d"), document.fonts.ready])
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
    limon: { compute, buildCNC, toDXF, exportZip, update, current: () => current, scene: () => scene },
  });
}
