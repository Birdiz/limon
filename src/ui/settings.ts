import { fmt } from "../core/format";
import {
  BOOLEAN_KEYS,
  NUMERIC_KEYS,
  type Essence,
  type Forme,
  type GardeCorps,
  type NumericKey,
  type Pose,
  type Params,
} from "../core/params";
import type { InputError, Stair } from "../core/stair";
import { byId } from "./dom";

const input = (id: string) => byId<HTMLInputElement>(id);

export function writeInputs(p: Params): void {
  document.querySelectorAll<HTMLInputElement>('input[name="forme"]').forEach((r) => (r.checked = r.value === p.forme));
  NUMERIC_KEYS.forEach((k) => (input(k).value = String(p[k])));
  BOOLEAN_KEYS.forEach((k) => (input(k).checked = p[k]));
  byId<HTMLSelectElement>("ess").value = p.ess;
  byId<HTMLSelectElement>("gc").value = p.gc;
  byId<HTMLSelectElement>("gcPose").value = p.gcPose;
}

/** Réglages lus dans le formulaire ; un champ vide ou invalide garde sa valeur précédente et figure dans missing. */
export function readInputs(prev: Params): { params: Params; missing: NumericKey[] } {
  const p = { ...prev };
  const missing: NumericKey[] = [];
  const r = document.querySelector<HTMLInputElement>('input[name="forme"]:checked');
  p.forme = (r ? r.value : "droit") as Forme;
  NUMERIC_KEYS.forEach((k) => {
    const v = parseFloat(input(k).value);
    if (!Number.isNaN(v)) p[k] = v;
    else missing.push(k);
  });
  BOOLEAN_KEYS.forEach((k) => (p[k] = input(k).checked));
  p.ess = byId<HTMLSelectElement>("ess").value as Essence;
  p.gc = byId<HTMLSelectElement>("gc").value as GardeCorps;
  p.gcPose = byId<HTMLSelectElement>("gcPose").value as Pose;
  return { params: p, missing };
}

/** Champs vides signalés avec la valeur que le calcul garde. */
export function missingErrors(p: Params, missing: readonly NumericKey[]): InputError[] {
  return missing.map((key) => {
    const unit = input(key).nextElementSibling?.textContent;
    const v = fmt(p[key], Number.isInteger(p[key]) ? 0 : 1);
    return { key, message: `Champ vide : le calcul garde ${v}${unit ? ` ${unit}` : ""}.` };
  });
}

/** Messages sous les champs fautifs, qui passent en rouge ; les messages précédents sont retirés. */
export function showFieldErrors(errors: readonly InputError[]): void {
  document.querySelectorAll(".fielderr").forEach((el) => el.remove());
  document.querySelectorAll<HTMLInputElement>("[aria-invalid]").forEach((el) => {
    el.removeAttribute("aria-invalid");
    el.removeAttribute("aria-describedby");
  });
  const byKey = new Map<NumericKey, string[]>();
  errors.forEach((e) => e.key && byKey.set(e.key, [...(byKey.get(e.key) ?? []), e.message]));
  byKey.forEach((messages, key) => {
    const el = input(key);
    const msg = document.createElement("p");
    msg.className = "fielderr";
    msg.id = `${key}-err`;
    msg.textContent = messages.join(" ");
    el.closest(".row")!.after(msg);
    el.setAttribute("aria-invalid", "true");
    el.setAttribute("aria-describedby", msg.id);
  });
}

/** Réglages visibles du formulaire, pour la fiche imprimée (la colonne de réglages n'est pas imprimée). */
export function settingsSummaryHTML(): string {
  const forme = document.querySelector<HTMLInputElement>('input[name="forme"]:checked');
  // Réglages d'assemblage compris, même quand l'export CNC est replié.
  const rows = [...document.querySelectorAll<HTMLElement>(".side .row, .asm .row")]
    .filter((row) => !row.closest("[data-show][hidden], [data-gc][hidden]"))
    .map((row) => {
      const name = row.querySelector("label")!.childNodes[0]!.textContent!.trim();
      const ctl = row.querySelector<HTMLInputElement | HTMLSelectElement>("select, input:not([type=checkbox])")!;
      const check = row.querySelector<HTMLInputElement>("input[type=checkbox]");
      let v =
        ctl instanceof HTMLSelectElement
          ? ctl.selectedOptions[0]!.text
          : `${ctl.value}${ctl.type === "range" ? " %" : ctl.nextElementSibling ? ` ${ctl.nextElementSibling.textContent}` : ""}`;
      if (check?.id === "cm" && !check.checked) v = "sans";
      else if (check?.checked && check.id !== "cm") v += " (auto)";
      return `<div><dt>${name}</dt><dd>${v}</dd></div>`;
    });
  return `<h2>Escalier ${forme ? forme.labels![0]!.textContent!.replace(/\s+/g, " ").trim().toLowerCase() : ""}</h2><dl>${rows.join("")}</dl>`;
}

/** Champs propres à la forme, champs automatiques grisés et valeurs calculées affichées. */
export function syncInputs(p: Params, stair: Stair | null): void {
  const quart = p.forme !== "droit";
  document
    .querySelectorAll<HTMLElement>("[data-show]")
    .forEach((el) => (el.hidden = (el.dataset.show === "quart") !== quart));
  document.querySelectorAll<HTMLElement>("[data-gc]").forEach((el) => (el.hidden = p.gc === "aucun"));
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
  const bal = stair?.bal;
  const capped = bal && bal.pr + 0.01 < bal.want;
  byId("progTxt").textContent = capped
    ? `${p.prog} % demandés, ${fmt(bal.pr * 100)} % appliqués pour garder 100 mm au jour`
    : `${p.prog} % · 0 % = girons égaux au jour`;
  byId("progTxt").classList.toggle("capped", !!capped);
}
