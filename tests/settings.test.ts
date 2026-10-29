// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULTS } from "../src/core/params";
import { compute } from "../src/core/stair";
import { missingErrors, readInputs, showFieldErrors, syncInputs, writeInputs } from "../src/ui/settings";
import { stairOf } from "./cases";

const html = fs.readFileSync(path.resolve("app/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

beforeEach(() => {
  document.body.innerHTML = body;
  writeInputs(DEFAULTS);
});

describe("champs vides", () => {
  it("gardent la valeur précédente et sont signalés", () => {
    field("H").value = "";
    const { params, missing } = readInputs({ ...DEFAULTS, H: 3200 });
    expect(params.H).toBe(3200);
    expect(missing).toEqual(["H"]);
    expect(missingErrors(params, missing)).toEqual([
      { key: "H", message: "Champ vide : le calcul garde 3\u202f200 mm." },
    ]);
  });
});

describe("erreurs sous les champs", () => {
  it("affichent un message par champ et le passent en rouge", () => {
    const r = compute({ ...DEFAULTS, H: 120 });
    if (r.ok) throw new Error("calcul attendu en échec");
    showFieldErrors(r.errors);
    expect(field("H").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field("H").getAttribute("aria-describedby")!)!.textContent).toBe(
      "La hauteur à monter doit faire au moins 300 mm.",
    );
    expect(document.querySelectorAll(".fielderr")).toHaveLength(2);

    showFieldErrors([]);
    expect(document.querySelectorAll(".fielderr, [aria-invalid]")).toHaveLength(0);
  });
});

describe("synchronisation du formulaire", () => {
  it("affiche la progressivité réellement appliquée quand elle est bridée", () => {
    const R = stairOf({ forme: "quart-d", H: 3200 });
    syncInputs(R.params, R);
    const txt = document.getElementById("progTxt")!;
    expect(txt.textContent).toBe("60 % demandés, 35 % appliqués pour garder 100 mm au jour");
    expect(txt.classList.contains("capped")).toBe(true);

    const D = stairOf({ forme: "quart-d" });
    syncInputs(D.params, D);
    expect(txt.textContent).toBe("60 % · 0 % = girons égaux au jour");
    expect(txt.classList.contains("capped")).toBe(false);
  });

  it("masque la légende des marches balancées sur l'escalier droit", () => {
    const legend = () => document.querySelector<HTMLElement>(".legend i.bal")!.parentElement!;
    const R = stairOf({ forme: "droit" });
    syncInputs(R.params, R);
    expect(legend().hidden).toBe(true);
    const Q = stairOf({ forme: "quart-g" });
    syncInputs(Q.params, Q);
    expect(legend().hidden).toBe(false);
  });
});

describe("garde-corps", () => {
  it("lit le remplissage et la pose, et masque leurs réglages sans garde-corps", () => {
    const rows = () => [...document.querySelectorAll<HTMLElement>("[data-gc]")].map((el) => el.hidden);
    syncInputs(DEFAULTS, null);
    expect(rows().every(Boolean)).toBe(true);
    (document.getElementById("gc") as HTMLSelectElement).value = "balustres";
    (document.getElementById("gcPose") as HTMLSelectElement).value = "anglaise";
    const { params } = readInputs(DEFAULTS);
    expect([params.gc, params.gcPose]).toEqual(["balustres", "anglaise"]);
    syncInputs(params, null);
    expect(rows().some(Boolean)).toBe(false);
  });
});
