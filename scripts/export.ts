/* Écrit l'archive d'export CNC sans navigateur, pour l'atelier ou pour vérifier les DXF.

   npm run export                          trois formes avec l'exemple par défaut, dans out/
   npm run export -- quart-g --out tmp     une forme, autre dossier
   npm run export -- --params reglages.json   réglages enregistrés (mêmes clés que la page) */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { exportFilename, exportZip } from "../src/cnc/package";
import { FORMES, sanitizeParams, type Forme } from "../src/core/params";
import { compute } from "../src/core/stair";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", default: "out" }, params: { type: "string" } },
});
const base = values.params ? JSON.parse(fs.readFileSync(values.params, "utf8")) : {};
const formes = positionals.length ? positionals : values.params ? [sanitizeParams(base).forme] : FORMES;
fs.mkdirSync(values.out, { recursive: true });

let failed = false;
for (const forme of formes) {
  if (!FORMES.includes(forme as Forme)) {
    console.error(`Forme inconnue : ${forme} (attendu : ${FORMES.join(", ")})`);
    failed = true;
    continue;
  }
  const r = compute(sanitizeParams({ ...base, forme }));
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
