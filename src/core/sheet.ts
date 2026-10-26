import { fmt } from "./format";
import type { Stair } from "./stair";

/** Fiche des marches au format CSV (séparateur point-virgule, décimales à la française). */
export function treadsCSV(R: Stair): string {
  const f1 = (v: number) => fmt(v, 1).replace(/[\u202f\u00a0]/g, "");
  const rows: (string | number)[][] = [
    [
      "Marche",
      "Dessus (mm)",
      "Giron jour (mm)",
      "Giron foulée (mm)",
      "Giron extérieur (mm)",
      "Longueur de nez (mm)",
      "Balancée",
    ],
  ];
  R.treads.forEach((t) =>
    rows.push([t.j, f1(t.top), f1(t.gIn), f1(t.gWalk), f1(t.gOut), f1(t.nez), t.balanced ? "oui" : "non"]),
  );
  return rows.map((r) => r.join(";")).join("\n");
}
