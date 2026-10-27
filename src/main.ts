import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/main.css";

import { buildCNC, tightBoards, type CNC } from "./cnc/build";
import { toDXF } from "./cnc/dxf";
import { exportFilename, exportZip } from "./cnc/package";
import { DEFAULTS, type Params } from "./core/params";
import { NOM_PAR_DEFAUT, fileBase, newProject, type Project } from "./core/project";
import { paramsFromHash, paramsToHash } from "./core/share";
import { treadsCSV } from "./core/sheet";
import { fichePDF } from "./pdf/fiche";
import { compute, type ComputeResult } from "./core/stair";
import { SECTIONS, sectionSummaries } from "./core/summary";
import { cutListHTML, previewSVG, stockFitHTML, stringerFitHTML } from "./ui/cnc-panel";
import { byId, copyText, downloadBytes, flash } from "./ui/dom";
import { planSVG } from "./ui/plan";
import { headlineHTML, notesHTML, tilesHTML, treadsTableHTML } from "./ui/results";
import type { Scene3D } from "./ui/scene3d";
import { ProjectsDialog } from "./ui/projects";
import { missingErrors, readInputs, showFieldErrors, syncInputs, writeInputs } from "./ui/settings";
import { Steps } from "./ui/steps";
import { LocalStore, newId } from "./ui/store";

const store = new LocalStore();
// Lu avant le premier calcul, qui réécrit l'adresse.
const sharedAtStart = paramsFromHash(location.hash);
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
    byId("headline").textContent = "";
    byId("cnc").hidden = true;
    scene?.showError(msg);
    return;
  }
  const R = result.stair;
  byId("plan").innerHTML = planSVG(R);
  byId("tiles").innerHTML = tilesHTML(R);
  byId("notes").innerHTML = notesHTML(R.notes);
  byId("headline").innerHTML = headlineHTML(R);
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
  const hash = paramsToHash(params);
  if (location.hash.slice(1) !== hash) history.replaceState(null, "", hash ? `#${hash}` : location.pathname);
  current = compute(params);
  syncInputs(params, current.ok ? current.stair : null);
  showFieldErrors([...missingErrors(params, read.missing), ...(current.ok ? [] : current.errors)]);
  const sums = sectionSummaries(params, current.ok ? current.stair : null);
  SECTIONS.forEach((k) => (byId(`sum-${k}`).textContent = sums[k]));
  render(current);
}

let queued = false;
function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
}

/** Ouvre un projet ; null quand il n'en reste aucun (le dialogue des projets reste alors affiché). */
function openProject(p: Project | null): void {
  project = p;
  params = p ? { ...p.params } : { ...DEFAULTS };
  byId<HTMLInputElement>("pjName").value = p?.nom ?? "";
  writeInputs(params);
  steps.apply(p?.mode ?? "complet", p?.etape ?? 0);
  setCNC(false);
  update();
}

const steps = new Steps((mode, etape) => {
  if (!project) return;
  project = { ...project, mode, etape };
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

const projects = new ProjectsDialog(store, { current: () => project, open: openProject });
byId("pjOpen").addEventListener("click", () => void projects.show());
byId<HTMLInputElement>("pjName").addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (!project) return;
  project = { ...project, nom: el.value.trim() || NOM_PAR_DEFAUT, modifie: Date.now() };
  el.value = project.nom;
  void store.save(project);
});

/* ---------- Événements ---------- */
for (const el of [document.querySelector<HTMLElement>(".side")!, byId("cncBody")]) {
  el.addEventListener("input", schedule);
  el.addEventListener("change", schedule);
}
byId("reset").addEventListener("click", () => {
  params = { ...DEFAULTS };
  writeInputs(params);
  schedule();
});
byId("notes").addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-fix]");
  const fix = btn && current?.ok ? current.stair.notes[Number(btn.dataset.fix)]?.[2] : undefined;
  if (!fix) return;
  params = { ...params, ...fix.set };
  writeInputs(params);
  schedule();
});
/** Un lien de projet devient un nouveau projet, sauf s'il redonne les réglages du projet ouvert. */
async function openShared(p: Params): Promise<void> {
  if (project && JSON.stringify(p) === JSON.stringify(project.params)) return;
  const q = newProject(newId(), "Projet reçu par lien", "complet", Date.now(), p);
  await store.save(q);
  await store.setCurrent(q.id);
  openProject(q);
}
window.addEventListener("hashchange", () => {
  const p = paramsFromHash(location.hash);
  if (p) void openShared(p);
});
byId("share").addEventListener("click", async () => {
  if (await copyText(location.href, byId<HTMLTextAreaElement>("linkfb"))) flash(byId("sharemsg"), "Lien copié");
});
byId("v3d").addEventListener("click", () => scene?.viewPerspective());
byId("vtop").addEventListener("click", () => scene?.viewTop());

byId("ficheDl").addEventListener("click", () => {
  if (!current?.ok) return;
  const base = fileBase(project?.nom ?? NOM_PAR_DEFAUT);
  if (byId<HTMLSelectElement>("ficheFmt").value === "csv")
    downloadBytes(new TextEncoder().encode("\ufeff" + treadsCSV(current.stair)), `${base} - marches.csv`, "text/csv");
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
  flash(byId("ficheMsg"), "Fiche enregistrée");
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
  flash(byId("dlmsg"), "Archive enregistrée");
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
  const id = await store.currentId();
  const start = (id && (await store.get(id))) || (await store.list())[0] || null;
  openProject(start);
  if (start) void store.setCurrent(start.id);
  if (sharedAtStart) await openShared(sharedAtStart);
  else if (!start) void projects.show();
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
