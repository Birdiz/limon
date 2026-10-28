/* Écrit l'archive d'export CNC sans navigateur, pour l'atelier ou pour vérifier les DXF.

   npm run export                          trois formes avec l'exemple par défaut, dans out/
   npm run export -- quart-g --out tmp     une forme, autre dossier
   npm run export -- --params projet.escalier  projet enregistré depuis la page
   npm run export -- --params reglages.json    ou réglages seuls (mêmes clés que la page) */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { exportFilename, exportZip } from "../src/cnc/package";
import { FORMES, sanitizeParams, type Forme } from "../src/core/params";
import { parseProjectFile } from "../src/core/project";
import { compute } from "../src/core/stair";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", default: "out" }, params: { type: "string" } },
});

/** Réglages lus dans un fichier .escalier (ou .limon) ou dans un JSON de réglages seuls. */
function readParams(file: string): unknown {
  const text = fs.readFileSync(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error(`${file} : ce n'est pas un fichier JSON.`);
    process.exit(1);
  }
  if ((raw as { format?: unknown } | null)?.format === undefined) return raw;
  const p = parseProjectFile(text, "export");
  if ("erreur" in p) {
    console.error(`${file} : ${p.erreur}`);
    process.exit(1);
  }
  return p.params;
}

const base = values.params ? readParams(values.params) : {};
const formes = positionals.length ? positionals : values.params ? [sanitizeParams(base).forme] : FORMES;
fs.mkdirSync(values.out, { recursive: true });

let failed = false;
for (const forme of formes) {
  if (!FORMES.includes(forme as Forme)) {
    console.error(`Forme inconnue : ${forme} (attendu : ${FORMES.join(", ")})`);
    failed = true;
    continue;
  }
  const r = compute(sanitizeParams({ ...(base as object), forme }));
  if (!r.ok) {
    console.error(`${forme} : ${r.errors.map((e) => e.message).join(" ")}`);
    failed = true;
    continue;
  }
  const file = path.join(values.out, exportFilename(r.stair));
  fs.writeFileSync(file, exportZip(r.stair));
  console.log(file);
}
process.exit(failed ? 1 : 0);
