import { fmt } from "../core/format";
import {
  BOOLEAN_KEYS,
  NUMERIC_KEYS,
  type Essence,
  type Forme,
  type FormeTremie,
  type GardeCorps,
  type NumericKey,
  type Pose,
  type Params,
} from "../core/params";
import { turnRange, type InputError, type Stair } from "../core/stair";
import { turnSpan } from "../core/summary";
import { byId } from "./dom";

const input = (id: string) => byId<HTMLInputElement>(id);

/** Cotes de la trémie, calculées quand elle est « à calculer ». */
const TRE_KEYS = ["tL", "tX", "tY", "tbD", "tbA"] as const;

export function writeInputs(p: Params): void {
  document.querySelectorAll<HTMLInputElement>('input[name="forme"]').forEach((r) => (r.checked = r.value === p.forme));
  NUMERIC_KEYS.forEach((k) => (input(k).value = String(p[k])));
  BOOLEAN_KEYS.forEach((k) => (input(k).checked = p[k]));
  // La trémie se choisit entre deux cases : « Pas encore » (tAuto) et « Oui, je la mesure ».
  input("tKnown").checked = !p.tAuto;
  byId<HTMLSelectElement>("ess").value = p.ess;
  byId<HTMLSelectElement>("gc").value = p.gc;
  byId<HTMLSelectElement>("gcPose").value = p.gcPose;
  byId<HTMLSelectElement>("tForme").value = p.tForme;
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
  p.tForme = byId<HTMLSelectElement>("tForme").value as FormeTremie;
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

/** Champs propres à la forme, champs automatiques grisés et valeurs calculées affichées. */
export function syncInputs(p: Params, stair: Stair | null): void {
  const quart = p.forme !== "droit";
  document
    .querySelectorAll<HTMLElement>("[data-show]")
    .forEach((el) => (el.hidden = (el.dataset.show === "quart") !== quart));
  document.querySelectorAll<HTMLElement>("[data-gc]").forEach((el) => (el.hidden = p.gc === "aucun"));
  document.querySelectorAll<HTMLElement>("[data-tre]").forEach((el) => (el.hidden = !quart || p.tForme !== "L"));
  document.querySelectorAll<HTMLElement>("[data-mp]").forEach((el) => (el.hidden = !p.mp));
  input("n").disabled = p.nAuto;
  input("f").disabled = p.fAuto;
  input("hlj").disabled = p.hljAuto;
  input("ecm").disabled = !p.cm;
  for (const k of TRE_KEYS) input(k).disabled = p.tAuto;
  input("mpP").disabled = !p.mp;
  if (stair) {
    if (p.nAuto) input("n").value = String(stair.n);
    if (p.fAuto) input("f").value = String(Math.round(stair.f));
    if (p.hljAuto && stair.quart) input("hlj").value = String(stair.hljAuto);
    if (p.tAuto) for (const k of TRE_KEYS) input(k).value = String(Math.round(stair.treDims[k]));
  }
  const bal = stair?.bal;
  const span = stair && turnSpan(stair);
  if (bal && span) {
    // Pendant la saisie, un nombre impossible reste affiché avec les bornes ; sinon le champ suit le calcul.
    const el = input("tour"),
      k = parseInt(el.value, 10);
    const typing = document.activeElement === el && !Number.isNaN(k) && k !== bal.a;
    const range = typing ? turnRange(p) : null;
    if (!typing) el.value = String(bal.a);
    byId("tourTxt").textContent = range
      ? `impossible ici : de ${range.min} à ${range.max} avec ces longueurs`
      : `marches ${span.from} à ${span.to}, de ${fmt(span.z0)} à ${fmt(span.z1)} mm`;
    byId("tourTxt").classList.toggle("capped", !!range);
  }
  const capped = bal && bal.pr + 0.01 < bal.want;
  byId("progTxt").textContent = capped
    ? `${p.prog} % demandés, ${fmt(bal.pr * 100)} % appliqués pour garder 100 mm au jour`
    : `${p.prog} % · 0 % = girons égaux au jour`;
  byId("progTxt").classList.toggle("capped", !!capped);
}
