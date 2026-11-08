/* Profil du nez de marche : forme de ses deux arêtes, coupe dessinée en 3D et sur la fiche,
   bout avant des logements dans les limons, mots de la fiche et des DXF. */
import { fmt } from "./format";
import type { ProfilNez } from "./params";
import { clamp, type Pt } from "./vec";

/** Rayon des arêtes cassées d'un nez droit. */
export const ARETE_CASSEE = 2;

/** Nom court du profil, dans les listes de choix. */
export const NEZ_LABEL: Record<ProfilNez, string> = {
  arrondi: "Arrondi",
  quart: "Quart-de-rond",
  chanfrein: "Chanfrein",
  casse: "Arêtes cassées",
};

/** Cote appliquée à une marche d'épaisseur e : rayon, ou côte du chanfrein, au plus la moitié de l'épaisseur ;
    0 = nez vif. Les arêtes cassées gardent leur rayon fixe. */
export const nezCote = (nez: ProfilNez, rn: number, e: number): number =>
  nez === "casse" ? Math.min(ARETE_CASSEE, e / 2) : clamp(rn, 0, e / 2);

/** Forme d'une arête du nez. */
export type Arete = { k: "vive" } | { k: "arc"; r: number } | { k: "chanfrein"; c: number };

const VIVE: Arete = { k: "vive" };

/** Arêtes du dessus et du dessous d'un nez de cote r. */
export function aretes(nez: ProfilNez, r: number): { dessus: Arete; dessous: Arete } {
  if (!(r > 0)) return { dessus: VIVE, dessous: VIVE };
  if (nez === "chanfrein") return { dessus: { k: "chanfrein", c: r }, dessous: VIVE };
  if (nez === "quart") return { dessus: { k: "arc", r }, dessous: VIVE };
  return { dessus: { k: "arc", r }, dessous: { k: "arc", r } };
}

/** Le dessous du nez est profilé : il peut mordre sur la contremarche quand le débord est plus court. */
export const dessousProfile = (nez: ProfilNez, r: number): boolean => aretes(nez, r).dessous.k !== "vive";

/** Coupe du nez dans sa bande de largeur r derrière la ligne de nez, en (v vers l'arrière de la marche,
    z depuis le dessous) : du dessous au dessus en passant par le nez ; le contour se ferme sur v = r. */
export function noseProfile(nez: ProfilNez, r: number, e: number, k = 8): Pt[] {
  const { dessus, dessous } = aretes(nez, r);
  const arc = (cx: number, cz: number, a0: number, rr: number) =>
    Array.from({ length: k + 1 }, (_, i): Pt => {
      const a = a0 - ((Math.PI / 2) * i) / k;
      return [cx + rr * Math.cos(a), cz + rr * Math.sin(a)];
    });
  const bas: Pt[] =
    dessous.k === "arc"
      ? arc(dessous.r, dessous.r, -Math.PI / 2, dessous.r)
      : dessous.k === "chanfrein"
        ? [
            [r, 0],
            [dessous.c, 0],
            [0, dessous.c],
          ]
        : [
            [r, 0],
            [0, 0],
          ];
  const haut: Pt[] =
    dessus.k === "arc"
      ? arc(dessus.r, e - dessus.r, Math.PI, dessus.r)
      : dessus.k === "chanfrein"
        ? [
            [0, e - dessus.c],
            [dessus.c, e],
            [r, e],
          ]
        : [
            [0, e],
            [r, e],
          ];
  const pts = [...bas, ...haut];
  return pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1]![0], q[1] - pts[i - 1]![1]) > 0.01);
}

/** Nez décrit pour la fiche. */
export function nezTexte(nez: ProfilNez, r: number): string {
  if (!(r > 0)) return "vif";
  const R = `R${fmt(r, 1)}`;
  switch (nez) {
    case "arrondi":
      return `arrondi ${R} dessus et dessous`;
    case "quart":
      return `quart-de-rond ${R}, dessous vif`;
    case "chanfrein":
      return `chanfrein ${fmt(r, 1)} mm à 45°, dessous vif`;
    case "casse":
      return `droit, arêtes cassées ${R}`;
  }
}

/** Nez écrit sur chaque marche des DXF. */
export function nezDXF(nez: ProfilNez, r: number): string {
  if (!(r > 0)) return "nez";
  const R = `R${fmt(r, 1)}`;
  switch (nez) {
    case "arrondi":
      return `nez ${R}`;
    case "quart":
      return `nez quart-de-rond ${R}`;
    case "chanfrein":
      return `nez chanfrein ${fmt(r, 1)} x 45 deg`;
    case "casse":
      return `nez aretes cassees ${R}`;
  }
}
