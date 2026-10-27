import { BOOLEAN_KEYS, NUMERIC_KEYS, sanitizeParams, type Essence, type Forme, type Params } from "../core/params";
import type { Stair } from "../core/stair";
import { byId } from "./dom";

const STORAGE_KEY = "limon-v2";

export function loadParams(): Params {
  try {
    return sanitizeParams(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return sanitizeParams(null);
  }
}

export function saveParams(p: Params): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Stockage indisponible (navigation privée) : les réglages ne survivent pas au rechargement.
  }
}

const input = (id: string) => byId<HTMLInputElement>(id);

export function writeInputs(p: Params): void {
  document.querySelectorAll<HTMLInputElement>('input[name="forme"]').forEach((r) => (r.checked = r.value === p.forme));
  NUMERIC_KEYS.forEach((k) => (input(k).value = String(p[k])));
  BOOLEAN_KEYS.forEach((k) => (input(k).checked = p[k]));
  byId<HTMLSelectElement>("ess").value = p.ess;
}

/** Réglages lus dans le formulaire ; un champ vide ou invalide garde sa valeur précédente. */
export function readInputs(prev: Params): Params {
  const p = { ...prev };
  const r = document.querySelector<HTMLInputElement>('input[name="forme"]:checked');
  p.forme = (r ? r.value : "droit") as Forme;
  NUMERIC_KEYS.forEach((k) => {
    const v = parseFloat(input(k).value);
    if (!Number.isNaN(v)) p[k] = v;
  });
  BOOLEAN_KEYS.forEach((k) => (p[k] = input(k).checked));
  p.ess = byId<HTMLSelectElement>("ess").value as Essence;
  return p;
}

/** Champs propres à la forme, champs automatiques grisés et valeurs calculées affichées. */
export function syncInputs(p: Params, stair: Stair | null): void {
  const quart = p.forme !== "droit";
  document
    .querySelectorAll<HTMLElement>("[data-show]")
    .forEach((el) => (el.hidden = (el.dataset.show === "quart") !== quart));
  input("n").disabled = p.nAuto;
  input("f").disabled = p.fAuto;
  input("hlj").disabled = p.hljAuto;
  input("ecm").disabled = !p.cm;
  for (const k of ["tL", "tX", "tY"] as const) input(k).disabled = p.tAuto;
  if (stair) {
    if (p.nAuto) input("n").value = String(stair.n);
    if (p.fAuto) input("f").value = String(Math.round(stair.f));
    if (p.hljAuto && stair.quart) input("hlj").value = String(stair.hljAuto);
    if (p.tAuto) for (const k of ["tL", "tX", "tY"] as const) input(k).value = String(Math.round(stair.treDims[k]));
  }
  byId("progTxt").textContent = `${p.prog} % · 0 % = girons égaux au jour`;
}
