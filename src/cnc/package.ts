import { fmt } from "../core/format";
import { GC } from "../core/railing";
import { PERCAGE, TENON, type Stair } from "../core/stair";
import { postTenon } from "./railing";
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
      `  TEXTE       numéro de marche${R.rn > 0 ? `, nez arrondi R${fmt(R.rn, 1)} dessus et dessous (à profiler, hors contour)` : ""}`,
      "",
      ...(p.cm
        ? [
            "contremarches.dxf : chaque contremarche vue de face depuis l'escalier, bas en bas,",
            `  longueur hors tout, encastrement de ${p.enc} mm compris de chaque côté.`,
            "  DECOUPE     contour de découpe",
            "  TEXTE       numéro de contremarche ; dans le tournant, angle des bouts biais",
            "              et face la plus courte (parement = face vue depuis l'escalier, dos = face cachée)",
            "",
          ]
        : []),
      "limons.dxf : chaque limon développé, vu depuis la face côté marches, haut en haut,",
      "  couché dans le sens de la planche (cotes = plus petit rectangle de débit).",
      "  DECOUPE     contour du limon",
      `  DEFONCE     logements des marches et contremarches, profondeur ${p.enc} mm,`,
      `              jeu de ${fmt(p.jeu, 1)} mm par côté compris${R.rn > 0 ? ", bout avant arrondi comme le nez (arcs)" : ""}`,
      ...(R.quart
        ? [
            "  TENON       tenon des limons de jour dans le poteau : enlever les joues de part et d'autre",
            `              (épaisseurs sous le nom de la pièce), épaulements de ${TENON.epaul} mm en haut et en bas`,
            `  PERCAGE     limon de mur 1/2 : perçages D${PERCAGE} traversants dans la partie qui reçoit`,
            "              le bout du limon de mur 2/2 (about vissé ou boulonné)",
          ]
        : []),
      ...(R.rail?.pose === "chant"
        ? [
            "  sous chaque limon côté garde-corps, son CHANT HAUT déroulé (longueur prise sur la pente) :",
            `  MORTAISE    mortaises d'aplomb des balustres, ${postTenon(p)} x ${postTenon(p)} mm, profondeur ${GC.tenon + GC.fond} mm`,
          ]
        : R.rail
          ? [`  PERCAGE     perçages D${GC.vis} traversants pour visser les balustres posés à l'anglaise`]
          : []),
      "  TEXTE       nom de la pièce et cotes brutes",
      "",
      ...(R.newel
        ? [
            `poteau.dxf : poteau de ${R.newel.size} x ${R.newel.size} mm, du sol à ${fmt(R.newel.h)} mm, affleurant les limons de jour`,
            "  côté marches. Ses quatre faces vues de l'extérieur, couchées pied à gauche, dans l'ordre du tour :",
            "  l'arête basse d'une face est l'arête haute de la suivante.",
            "  DECOUPE     contour de la face (débit à la longueur)",
            `  DEFONCE     logements des marches et contremarches, profondeur ${p.enc} mm, jeu compris`,
            R.rail
              ? "  MORTAISE    mortaises de chaque limon de jour et de la main courante, profondeur indiquée sur la face, jeu compris"
              : "  MORTAISE    mortaise de chaque limon de jour, profondeur indiquée sur la face, jeu compris",
            "  TEXTE       numéro et rôle de chaque face",
            "",
          ]
        : []),
      ...(R.rail
        ? [
            `garde-corps.dxf : garde-corps ${R.quart ? "côté jour" : "côté limon droit"}, main courante à au moins ${GC.h} mm au-dessus des nez,`,
            `  écart libre de ${GC.ecart} mm au plus.`,
            "  Mains courantes vues de côté (bouts d'aplomb), puis leur dessous déroulé avec les mortaises",
            `  des ${R.rail.type === "balustres" ? "balustres" : "montants"} ; ${R.rail.type === "balustres" ? "balustres" : "montants et lisses"} vus de côté, couchés, numérotés dans l'ordre de la montée.`,
            "  DECOUPE     contours",
            ...(R.quart ? ["  TENON       tenon de chaque main courante dans le poteau"] : []),
            "  MORTAISE    mortaises d'aplomb sous la main courante, jeu compris",
            "  TEXTE       noms, sections, pentes",
            "",
          ]
        : []),
      "fiche-marches.csv : girons et longueurs de nez de chaque marche.",
      "",
      R.quart
        ? "À vérifier avant usinage : sens des pièces, fixation des limons au sol et au plancher haut."
        : "À vérifier avant usinage : sens des pièces, assemblage des limons sur le poteau et au palier.",
    ].join("\r\n") + "\r\n"
  );
}

/** Contenu de l'archive d'export. Le CSV commence par un BOM pour qu'Excel lise l'UTF-8. */
export function exportFiles(R: Stair, cnc: CNC = buildCNC(R)): ZipFile[] {
  return [
    { name: "marches.dxf", data: toDXF(cnc.treadEnts) },
    { name: "limons.dxf", data: toDXF(cnc.boardEnts) },
    ...(R.params.cm ? [{ name: "contremarches.dxf", data: toDXF(cnc.riserEnts) }] : []),
    ...(R.newel ? [{ name: "poteau.dxf", data: toDXF(cnc.postEnts) }] : []),
    ...(cnc.rail ? [{ name: "garde-corps.dxf", data: toDXF(cnc.rail.ents) }] : []),
    { name: "fiche-marches.csv", data: "\ufeff" + treadsCSV(R) },
    { name: "LISEZMOI.txt", data: readme(R) },
  ];
}

export const exportFilename = (R: Stair): string => `escalier-${FORME_SLUG[R.params.forme]}-${R.n}h.zip`;

export const exportZip = (R: Stair, cnc?: CNC): Uint8Array<ArrayBuffer> => makeZip(exportFiles(R, cnc));
