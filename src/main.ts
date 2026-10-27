import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles/main.css";

import { buildCNC, type CNC } from "./cnc/build";
import { toDXF } from "./cnc/dxf";
import { exportFilename, exportZip } from "./cnc/package";
import { DEFAULTS, type Params } from "./core/params";
import { NOM_PAR_DEFAUT, type Project } from "./core/project";
import { treadsCSV } from "./core/sheet";
import { compute, type ComputeResult } from "./core/stair";
import { cutListHTML, previewSVG, stringerFitHTML } from "./ui/cnc-panel";
import { byId, copyText, downloadBytes, flash } from "./ui/dom";
import { planSVG } from "./ui/plan";
import { headlineHTML, notesHTML, tilesHTML, treadsTableHTML } from "./ui/results";
import type { Scene3D } from "./ui/scene3d";
import { ProjectsDialog } from "./ui/projects";
import { readInputs, syncInputs, writeInputs } from "./ui/settings";
import { LocalStore } from "./ui/store";

const store = new LocalStore();
let project: Project | null = null;
let params: Params = { ...DEFAULTS };
let current: ComputeResult | null = null;
let cnc: CNC | null = null;
let scene: Scene3D | null = null;

function render(result: ComputeResult): void {
  const errHTML = (e: string) => `<div class="errbox">${e}</div>`;
  if (!result.ok) {
    cnc = null;
    byId("plan").innerHTML = errHTML(result.errors[0]!);
    byId("tiles").innerHTML = "";
    byId("table").innerHTML = "";
    byId("notes").innerHTML = notesHTML(result.errors.map((e) => ["bad", e]));
    byId("headline").textContent = "";
    byId("cnc").hidden = true;
    scene?.showError(result.errors[0]!);
    return;
  }
  const R = result.stair;
  byId("plan").innerHTML = planSVG(R);
  byId("tiles").innerHTML = tilesHTML(R);
  byId("notes").innerHTML = notesHTML(R.notes);
  byId("headline").innerHTML = headlineHTML(R);
  byId("table").innerHTML = treadsTableHTML(R);

  cnc = buildCNC(R);
  byId("cnc").hidden = false;
  byId("pvT").innerHTML = previewSVG(cnc.treadEnts, "Aperçu des marches à découper");
  byId("pvB").innerHTML = previewSVG(cnc.boardEnts, "Aperçu des limons développés");
  byId("pvRbox").hidden = byId("cpR").hidden = !R.params.cm;
  byId("pvR").innerHTML = previewSVG(cnc.riserEnts, "Aperçu des contremarches à découper");
  byId("cncnotes").innerHTML = stringerFitHTML(cnc.boardParts, R);
  byId("parts").innerHTML = cutListHTML(cnc, R);
  scene?.draw(R);
}

function update(): void {
  queued = false;
  params = readInputs(params);
  if (project && JSON.stringify(params) !== JSON.stringify(project.params)) {
    project = { ...project, params, modifie: Date.now() };
    void store.save(project);
  }
  current = compute(params);
  syncInputs(params, current.ok ? current.stair : null);
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
  update();
}

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
const side = document.querySelector<HTMLElement>(".side")!;
side.addEventListener("input", schedule);
side.addEventListener("change", schedule);
byId("reset").addEventListener("click", () => {
  params = { ...DEFAULTS };
  writeInputs(params);
  schedule();
});
byId("v3d").addEventListener("click", () => scene?.viewPerspective());
byId("vtop").addEventListener("click", () => scene?.viewTop());

byId("copy").addEventListener("click", async () => {
  if (!current?.ok) return;
  if (await copyText(treadsCSV(current.stair), byId<HTMLTextAreaElement>("csvfb")))
    flash(byId("copied"), "Fiche copiée", false, 1800);
});
byId("dl").addEventListener("click", () => {
  if (!current?.ok || !cnc) return;
  downloadBytes(exportZip(current.stair, cnc), exportFilename(current.stair), "application/zip");
  flash(byId("dlmsg"), "Archive enregistrée");
});
const copyDXF = async (which: "treadEnts" | "riserEnts" | "boardEnts", label: string) => {
  if (!cnc) return;
  const text = toDXF(cnc[which]);
  if (await copyText(text, byId<HTMLTextAreaElement>("dxffb"))) flash(byId("cpmsg"), `${label} copié`);
};
byId("cpT").addEventListener("click", () => copyDXF("treadEnts", "marches.dxf"));
byId("cpR").addEventListener("click", () => copyDXF("riserEnts", "contremarches.dxf"));
byId("cpB").addEventListener("click", () => copyDXF("boardEnts", "limons.dxf"));

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
  else void projects.show();
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
