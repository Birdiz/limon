import { byId } from "./dom";

/** Événement « beforeinstallprompt » de Chrome, Edge et Android (absent des types du DOM). */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

const HEURE = 3_600_000;

const standalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
// L'iPad se présente comme un Mac ; seul l'écran tactile le trahit.
const ios = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Bouton « Installer » du dialogue Mes escaliers ; sur iPhone, une ligne d'aide à la place. */
function setupInstall(): void {
  if (standalone()) return;
  const box = byId("pjInstall");
  if (ios()) {
    byId("pjInstallBtns").hidden = byId("pjInstallNote").hidden = true;
    byId("pjInstallIos").hidden = box.hidden = false;
    return;
  }
  let prompt: InstallPrompt | null = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    prompt = e as InstallPrompt;
    box.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    prompt = null;
    box.hidden = true;
  });
  byId("pjInstallBtn").addEventListener("click", () => {
    if (!prompt) return;
    void prompt.prompt();
    prompt = null;
    box.hidden = true;
  });
}

/**
 * Application installable et hors ligne. Les mises à jour sont silencieuses : les artisans ne
 * rechargeraient pas d'eux-mêmes. Une nouvelle version s'installe en arrière-plan, prend la main
 * quand la page passe en arrière-plan (ou au lancement si elle attendait déjà), puis la page se
 * recharge sans qu'on la voie. `flush` enregistre d'abord le projet en cours de saisie.
 */
export function startPWA(flush: () => void): void {
  setupInstall();
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  // Projets gardés même quand le navigateur manque de place ; accordé d'office à une application installée.
  if (standalone()) void navigator.storage?.persist?.();

  let reloadNow = false;
  let swapped = false;
  sw.addEventListener("controllerchange", () => {
    if (!document.hidden && !reloadNow) {
      swapped = true;
      return;
    }
    flush();
    location.reload();
  });

  void sw.register("./sw.js").then((reg) => {
    // Sans contrôleur, c'est la première installation : la page est déjà la bonne version.
    const waiting = () => (sw.controller ? reg.waiting : null);
    const start = waiting();
    if (start) {
      reloadNow = true;
      start.postMessage("activer");
    }
    let checked = Date.now();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (swapped) {
          flush();
          location.reload();
        } else waiting()?.postMessage("activer");
      } else if (Date.now() - checked > HEURE) {
        // Une application installée peut rester ouverte des jours sans recharger sa page.
        checked = Date.now();
        void reg.update();
      }
    });
  });
}
