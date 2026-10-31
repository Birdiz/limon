/* Quantités du devis, tirées de l'escalier et de ses pièces débitées (les mêmes que la liste de débit). */
import type { Quantites } from "../core/devis";
import type { Stair } from "../core/stair";
import { stockVolume, type CNC } from "./build";

type Rect = { L: number; l: number };
/** Aire de deux faces de chaque pièce, en m² ; les chants ne comptent pas. */
const faces = (list: readonly Rect[]) => list.reduce((s, q) => s + 2 * q.L * q.l, 0) / 1e6;
const metres = (list: readonly { L: number }[]) => list.reduce((s, q) => s + q.L, 0) / 1000;

export function quantites(R: Stair, cnc: CNC): Quantites {
  const p = R.params;
  const marches = R.treads.filter((t) => !t.balanced && !t.palier).length;
  const balancees = R.treads.filter((t) => t.balanced && !t.palier).length;
  const paliers = R.treads.filter((t) => t.palier).length + (cnc.mpPart ? 1 : 0);
  const rail = cnc.rail;
  return {
    ess: p.ess,
    volume: stockVolume(cnc, R),
    marches,
    balancees,
    paliers,
    contremarches: cnc.riserParts.length,
    limons: metres(cnc.boardParts),
    poteaux: cnc.postParts.length,
    mainCourante: rail ? metres(rail.handrailParts) : 0,
    balustres: rail ? rail.postParts.length : 0,
    lisses: rail ? metres(rail.railParts) : 0,
    surface:
      faces(cnc.treadParts) +
      faces(cnc.riserParts) +
      faces(cnc.boardParts) +
      (cnc.mpPart ? faces([cnc.mpPart]) : 0) +
      faces(cnc.postParts) +
      (rail ? faces(rail.handrailParts) + faces(rail.postParts) + faces(rail.railParts) : 0),
  };
}
