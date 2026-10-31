import { fmt } from "./format";
import { DEFAULTS, type Params } from "./params";
import { BOIS_SOUS_LOGEMENT } from "./pockets";
import { GC } from "./railing";
import { CONFORT, ECHAPPEE, ECHAPPEE_MIN, FOULEE_MAX } from "./stair";

/*
 * Aide de chaque réglage : une définition en une ou deux phrases, avec les mots du métier, et la valeur
 * conseillée quand le calcul en a une. Les chiffres viennent des constantes des contrôles, jamais recopiés.
 */

/** Réglage qui a une aide : une clé de Params, ou un champ calculé (« tour », marches droites avant le tour). */
export type AideKey = keyof Params | "tour";

export interface AideTexte {
  /** Définition, une ou deux phrases. */
  texte: string;
  /** Valeur conseillée ou repère, quand il y en a un. */
  conseil?: string;
}

const C = CONFORT;
const mm = (v: number) => `${fmt(v, Number.isInteger(v) ? 0 : 1)}\u00a0mm`;
const plage = (r: { min: number; max: number }) => `${fmt(r.min)} à ${mm(r.max)}`;
/** Valeur de l'exemple, qui convient à la plupart des escaliers. */
const courant = (k: keyof Params) => `Courant : ${mm(DEFAULTS[k] as number)}.`;

const hauteur = `Hauteur de marche conseillée : ${plage(C.h)}.`;
const giron = `Giron conseillé sur la ligne de foulée : ${plage(C.g)}.`;
const blondel = `Loi de Blondel : 2 hauteurs + 1 giron de ${plage(C.blondel)}, idéalement ${mm(C.blondel.cible)}.`;
const echappee = `Échappée visée : ${mm(ECHAPPEE)} au-dessus des nez, jamais moins de ${mm(ECHAPPEE_MIN)}.`;
const logements = `Au moins ${mm(BOIS_SOUS_LOGEMENT)} de bois sous chaque logement : le calcul vous prévient sinon.`;
const jour = `Au moins ${mm(C.gIn.min)} de giron côté jour.`;

const hlj: AideTexte = {
  texte:
    "Largeur de la planche du limon côté jour, en quart tournant : les marches balancées y descendent plus bas. En automatique, la plus étroite qui garde du bois sous les logements.",
  conseil: logements,
};

export const AIDE: Partial<Record<AideKey, AideTexte>> = {
  forme: {
    texte:
      "Droit : une seule volée. Quart tournant : la volée tourne d'un angle droit, à gauche ou à droite en montant ; les marches du tour sont balancées.",
  },
  H: {
    texte:
      "Du sol fini du bas au sol fini du haut, revêtements compris. Elle est partagée en hauteurs de marche égales.",
    conseil: hauteur,
  },
  L: {
    texte:
      "Place prise au sol par l'escalier droit, du nez de la première marche au nez du palier. Plus il est long, plus les marches sont profondes.",
    conseil: giron,
  },
  A: {
    texte:
      "Longueur du côté de la montée, prise côté extérieur du tournant, limon non compris. Avec le côté arrivée, elle donne la longueur de la ligne de foulée.",
    conseil: giron,
  },
  B: {
    texte:
      "Longueur du côté de l'arrivée, prise côté extérieur du tournant, limon non compris. Avec le côté départ, elle donne la longueur de la ligne de foulée.",
    conseil: giron,
  },
  W: {
    texte: "Largeur de passage des marches, d'un limon à l'autre, entre leurs faces côté marches.",
  },
  tAuto: {
    texte:
      "La trémie est l'ouverture du plancher du haut. Si elle n'est pas encore faite, Quart de tour calcule la plus petite qui laisse passer la tête.",
    conseil: echappee,
  },
  tL: {
    texte: "Longueur de l'ouverture dans le plancher, mesurée depuis le bord du palier vers le départ de l'escalier.",
    conseil: echappee,
  },
  tX: {
    texte: "Longueur de l'ouverture le long du côté arrivée, mesurée depuis le bord du palier.",
    conseil: echappee,
  },
  tY: {
    texte: "Longueur de l'ouverture le long du côté départ, mesurée depuis le mur face à la montée.",
    conseil: echappee,
  },
  ep: {
    texte:
      "Du sol fini du haut à la sous-face du plafond, sous le plancher : la tête doit passer sous ce bord de trémie.",
    conseil: echappee,
  },
  n: {
    texte:
      "Nombre de hauteurs de marche, arrivée sur le palier comprise : il y a une marche de moins. En automatique, Quart de tour prend le nombre le plus confortable.",
    conseil: `${hauteur} ${blondel}`,
  },
  f: {
    texte: `Ligne où l'on pose le pied en montant, mesurée depuis le jour ; les girons y sont égaux. En automatique, au milieu de l'emmarchement, à ${mm(FOULEE_MAX)} au plus du jour en quart tournant.`,
    conseil: giron,
  },
  tour: {
    texte:
      "Nombre de marches droites avant d'entrer dans le tournant. Le changer déplace le tour sans toucher au confort : les longueurs côté départ et côté arrivée s'ajustent.",
  },
  mb: {
    texte:
      "Nombre de marches dont le nez pivote pour passer le tournant. Plus il y en a, plus les marches restent larges côté jour.",
    conseil: jour,
  },
  prog: {
    texte:
      "Répartition du balancement. À 0 %, les girons côté jour sont égaux ; en l'augmentant, ils se resserrent au coin et s'élargissent aux bouts du tour, pour un balancement plus doux.",
    conseil: jour,
  },
  ess: {
    texte: "Bois des marches et des limons : il donne la teinte de la vue 3D et le poids de l'escalier sur la fiche.",
  },
  et: { texte: "Épaisseur des marches finies, rabotées.", conseil: courant("et") },
  deb: {
    texte: "Avancée du nez de marche devant la contremarche : le recouvrement d'une marche sur l'autre.",
    conseil: courant("deb"),
  },
  rn: {
    texte:
      "Arrondi du nez de marche, dessus et dessous. 0 laisse l'arête vive ; au plus la moitié de l'épaisseur de marche, en demi-rond.",
    conseil: courant("rn"),
  },
  cm: {
    texte: "Planches debout qui ferment l'escalier entre deux marches. Sans contremarches, l'escalier est ajouré.",
  },
  ecm: {
    texte:
      "Planches debout qui ferment l'escalier entre deux marches, et leur épaisseur. Sans contremarches, l'escalier est ajouré.",
    conseil: courant("ecm"),
  },
  el: { texte: "Épaisseur des limons, les planches qui portent les marches de chaque côté.", conseil: courant("el") },
  ps: {
    texte:
      "Côté du poteau carré qui tient le coin du tournant, côté jour. Les limons de jour s'y assemblent à tenon et mortaise.",
    conseil: courant("ps"),
  },
  gc: {
    texte:
      "Protection côté vide. Balustres : barreaux debout sous la main courante. Lisses rampantes : planches parallèles à la main courante, portées par des montants.",
    conseil: `Main courante à ${mm(GC.h)} au-dessus des nez, ${mm(GC.ecart)} d'écart libre au plus.`,
  },
  gcPose: {
    texte:
      "Dans le chant : balustres plantés dans le dessus du limon. À l'anglaise : fixés sur le flanc du limon, côté vide, et descendant plus bas que lui.",
  },
  mcL: { texte: "Largeur de la main courante, vue de dessus.", conseil: courant("mcL") },
  mcH: { texte: "Hauteur de la section de la main courante.", conseil: courant("mcH") },
  bs: {
    texte: "Côté de la section carrée des balustres ; les montants et les lisses prennent la même.",
    conseil: `Écart libre de ${mm(GC.ecart)} au plus entre deux balustres : leur nombre en découle.`,
  },
  hl: {
    texte:
      "Largeur de la planche du limon, mesurée d'équerre à son rampant (limon de mur en quart tournant). Elle doit couvrir les logements des marches.",
    conseil: logements,
  },
  hlj,
  hljAuto: hlj,
  pL: {
    texte: "Longueur des plus grands plateaux que vous avez, dans le fil. Une pièce plus longue est signalée.",
  },
  pW: {
    texte: "Largeur des plus grands plateaux que vous avez. Une pièce plus large est signalée.",
  },
  enc: {
    texte: "Profondeur des logements : de combien les marches et les contremarches entrent dans les limons.",
    conseil: courant("enc"),
  },
  jeu: {
    texte: "Jeu laissé de chaque côté des logements, pour que la marche entre sans forcer à l'assemblage.",
    conseil: courant("jeu"),
  },
};

/** Aide d'un réglage d'après l'identifiant de son champ (« at-et » dans Mon atelier). */
export function aideOf(id: string): AideTexte | null {
  return AIDE[id.replace(/^at-/, "") as AideKey] ?? null;
}
