import { fmt } from "../core/format";
import type { Stair } from "../core/stair";
import { treadsCSV } from "../core/sheet";
import { buildCNC, type CNC } from "./build";
import { toDXF } from "./dxf";
import { makeZip, type ZipFile } from "./zip";

const FORME_LABEL = { droit: "droit", "quart-g": "quart tournant gauche", "quart-d": "quart tournant droit" } as const;
const FORME_SLUG = { droit: "droit", "quart-g": "quart-gauche", "quart-d": "quart-droit" } as const;

export function readme(R: Stair): string {
  const p = R.params;
  return (
    [
      "Limon - export CNC",
      `Escalier ${FORME_LABEL[p.forme]} : ${R.n} hauteurs de ${fmt(R.h, 1)} mm, giron ${fmt(R.g, 1)} mm, emmarchement ${fmt(R.W)} mm.`,
      "Unités : millimètres. Format DXF R12 (AC1009).",
      "",
      "marches.dxf : chaque marche vue de dessus, nez en bas.",
      `  DECOUPE     contour de découpe, encastrement de ${p.enc} mm compris de chaque côté`,
      "  CM_DESSUS   contremarche posée sur la marche (face supérieure)",
      "  CM_DESSOUS  contremarche sous le nez (face inférieure, vue par transparence)",
      "  TEXTE       numéro de marche",
      "",
      "limons.dxf : chaque limon développé, vu depuis la face côté marches, haut en haut,",
      "  couché dans le sens de la planche (cotes = plus petit rectangle de débit).",
      "  DECOUPE     contour du limon",
      `  DEFONCE     logements des marches et contremarches, profondeur ${p.enc} mm`,
      "  TEXTE       nom de la pièce et cotes brutes",
      "",
      "fiche-marches.csv : girons et longueurs de nez de chaque marche.",
      "",
      "À vérifier avant usinage : sens des pièces, jeu d'assemblage, arrondi des nez,",
      "assemblage des limons sur le poteau et au palier.",
    ].join("\r\n") + "\r\n"
  );
}

/** Contenu de l'archive d'export. Le CSV commence par un BOM pour qu'Excel lise l'UTF-8. */
export function exportFiles(R: Stair, cnc: CNC = buildCNC(R)): ZipFile[] {
  return [
    { name: "marches.dxf", data: toDXF(cnc.treadEnts) },
    { name: "limons.dxf", data: toDXF(cnc.boardEnts) },
    { name: "fiche-marches.csv", data: "\ufeff" + treadsCSV(R) },
    { name: "LISEZMOI.txt", data: readme(R) },
  ];
}

export const exportFilename = (R: Stair): string => `escalier-${FORME_SLUG[R.params.forme]}-${R.n}h.zip`;

export const exportZip = (R: Stair, cnc?: CNC): Uint8Array<ArrayBuffer> => makeZip(exportFiles(R, cnc));
