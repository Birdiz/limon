import { fmt } from "../core/format";
import type { Note, Stair } from "../core/stair";
import { STATUS_LABEL, checks, type Check } from "../core/summary";

const tile = ({ k, v, unit, sub, s }: Check) =>
  `<div class="tile"><span class="k">${k}</span><span class="v">${v}<small>${unit}</small></span><span class="s"><span>${sub}</span>${s ? `<span class="chip ${s}">${STATUS_LABEL[s]}</span>` : ""}</span></div>`;

/** Tuiles de synthèse sous les vues. */
export const tilesHTML = (R: Stair): string => checks(R).map(tile).join("");

/** Notes ; une correction proposée devient un bouton qui renvoie l'indice de sa note (data-fix). */
export const notesHTML = (notes: readonly Note[]): string =>
  notes
    .map(
      ([s, t, fix], i) =>
        `<div class="note ${s}"><span>${t}${fix ? ` <button class="btn fix" type="button" data-fix="${i}">${fix.label}</button>` : ""}</span></div>`,
    )
    .join("");

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
