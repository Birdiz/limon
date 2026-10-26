import { fmt } from "../core/format";
import type { Stair, Status } from "../core/stair";

const STATUS: Record<Status, string> = { ok: "Bon", warn: "Limite", bad: "Hors norme" };

const tile = (k: string, v: string, unit: string, sub: string, s: Status | null) =>
  `<div class="tile"><span class="k">${k}</span><span class="v">${v}<small>${unit}</small></span><span class="s"><span>${sub}</span>${s ? `<span class="chip ${s}">${STATUS[s]}</span>` : ""}</span></div>`;

/** Tuiles de synthèse sous les vues. */
export function tilesHTML(R: Stair): string {
  return [
    tile("Hauteur de marche", fmt(R.h, 1), "mm", `${R.n} hauteurs`, R.st.h),
    tile("Giron", fmt(R.g, 1), "mm", `${R.n - 1} marches · foulée`, R.st.g),
    tile("Blondel 2h + g", fmt(R.blondel), "mm", "cible 600 à 640", R.st.bl),
    tile("Pente", fmt(R.pente, 1), "°", `foulée ${fmt(R.Lw)} mm`, R.st.pente),
    R.ech
      ? tile("Échappée", fmt(R.ech.c), "mm", `sur la marche ${R.ech.j}`, R.st.ech)
      : tile("Échappée", "Libre", "", "tout sous la trémie", R.st.ech),
    R.bal
      ? tile("Giron mini au jour", fmt(R.gInMin), "mm", `${R.bal.m} balancées`, R.st.gIn)
      : tile("Reculement", fmt(R.L), "mm", `emmarchement ${fmt(R.W)}`, null),
  ].join("");
}

export const notesHTML = (notes: readonly [string, string][]): string =>
  notes.map(([s, t]) => `<div class="note ${s}">${t}</div>`).join("");

export const headlineHTML = (R: Stair): string =>
  `<b>${R.n}</b> hauteurs de <b>${fmt(R.h, 1)}</b> mm · giron <b>${fmt(R.g, 1)}</b> mm`;

/** Fiche des marches : girons sur le jour, la foulée et l'extérieur en quart tournant. */
export function treadsTableHTML(R: Stair): string {
  const head = R.quart
    ? "<tr><th>Marche</th><th>Dessus</th><th>Giron jour</th><th>Giron foulée</th><th>Giron extérieur</th><th>Longueur de nez</th></tr>"
    : "<tr><th>Marche</th><th>Dessus</th><th>Giron</th><th>Longueur de nez</th></tr>";
  const rows = R.treads.map((t) =>
    R.quart
      ? `<tr class="${t.balanced ? "bal" : ""}"><td>${t.j}</td><td>${fmt(t.top, 1)}</td><td class="${t.gIn < 100 ? "low" : ""}">${fmt(t.gIn, 1)}</td><td>${fmt(t.gWalk, 1)}</td><td>${fmt(t.gOut, 1)}</td><td>${fmt(t.nez, 1)}</td></tr>`
      : `<tr><td>${t.j}</td><td>${fmt(t.top, 1)}</td><td>${fmt(t.gWalk, 1)}</td><td>${fmt(t.nez, 1)}</td></tr>`,
  );
  const landing = `<tr><td>Palier</td><td>${fmt(R.H, 1)}</td>${R.quart ? "<td></td><td></td><td></td>" : "<td></td>"}<td></td></tr>`;
  return `<thead>${head}</thead><tbody>${rows.join("")}${landing}</tbody>`;
}
