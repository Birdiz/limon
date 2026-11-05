---
name: geometrie
description: Géométrie de l'escalier (compute, src/core/stair.ts), formes, repère du plan, polylignes, lignes de nez, limons, ligne de foulée, balancement, logements, palier, trémie, échappée, marche palière, poteaux, garde-corps.
---

# Géométrie

Voir `compute(p)` dans `src/core/stair.ts`. Les types du modèle (`Stair`, `Tread`, `StringerPiece`, `Newel`, `Railing`, `Note`…) sont dans `src/core/stair-types.ts`, sans calcul : les modules de `core` les importent de là, `stair.ts` les ré-exporte pour le reste. Seul cycle gardé, d'appel : `stair-notes.ts` rappelle `compute` pour chercher les marches balancées.

## Étapes du calcul

`compute` valide les réglages (`validate`), puis enchaîne des étapes, chacune dans son fichier de `src/core/`, entrées et sorties typées. Une étape qui bute renvoie un `ComputeFailure` (`{ ok: false, errors }`), que `compute` rend tel quel (`"errors" in r`).

1. `flights` (`stair-flights.ts`) : volées et ligne de foulée. `Flights` : côtés `inner` et `outer`, `len`, `dirs`, angles `sIn`, arcs `tA`/`tB`, `Lw`, `walkAt`, `walkTan`, `sPerp`, `C` et `single` du demi-tournant.
2. `heights` (`stair-noses.ts`) : nombre et hauteur des marches, giron, paliers (`pickN`, `palierLayout`), abscisse `ts` de chaque nez sur la ligne de foulée.
3. `balance` (`stair-noses.ts`) : position `s` de chaque nez sur le jour, zones balancées `bals`.
4. `noseLines` (`stair-noses.ts`) : lignes de nez.
5. `treadsAndRisers` (`stair-treads.ts`) : marches, marche palière, contremarches, découpe du plan entre les lignes de nez (`planCuts`).
6. `stringerLines` (`stair-stringers.ts`) : hauteur des nez le long de chaque côté (`zIn`, `zOut`), tronçons de limon sans logements.
7. `newelPosts` (`stair-newels.ts`) : faces des poteaux côté marches, traitées comme des bouts de limon.
8. `stringerPieces` (`stair-stringers.ts`) : logements des limons et des faces de poteaux, hauteurs `hlj` et `need`, tenons, perçages.
9. `railing` (`railing.ts`) : garde-corps.
10. `newels` (`stair-newels.ts`) : poteaux, faces, logements et mortaises (limons de jour et mains courantes).
11. `tremie` (`tremie.ts`) : plancher haut, trémie, échappée.
12. Contrôles (`comfortStatus`, `CONFORT` dans `confort.ts`) et notes (`stairNotes`).

Les étapes n'importent pas `stair.ts` ; il ré-exporte leurs constantes (`CONFORT`, `FOULEE_MAX`, `LIFT`, `TENON`, `PERCAGE`) et `pickN`, `palierLayout` pour le reste du code. Une étape nouvelle prend sa place dans cette suite, avec ses propres entrées et sorties, plutôt que de rallonger `compute`.

Selon le sujet, lire aussi :

- [palier.md](palier.md) : `tournant` = "palier", demi-tour, pièce PALIER.
- [tremie.md](tremie.md) : trémie, contour, échappée, marche palière.
- [poteaux.md](poteaux.md) : poteaux, tenons, limons de mur en about, jour étroit.

## Résultat

`compute` renvoie `{ ok: true, stair }` ou `{ ok: false, errors }` (chaque erreur désigne si possible le champ fautif). `stair.params` garde les réglages utilisés. Les notes s'écrivent dans `stairNotes` (`src/core/stair-notes.ts`). Une note peut porter une correction (`Fix`, appliquée d'un clic) ; `compute(p, false)` saute leur recherche.

`validate` refuse d'abord, sur son champ, toute cote lue au-delà de `H_MAX` (hauteur) ou de `COTE_MAX` (les autres), en valeur absolue : le calcul reste assez court pour ne pas figer la page. `sanitizeParams` garde la valeur, pour la montrer à corriger. `pickN` et `palierLayout` ne dépassent pas `H_MAX / 120` hauteurs. Une boucle nouvelle qui dépend d'un réglage se teste aux bornes (`tests/stair.test.ts`).

## Formes

`Forme`, `TOURS`, `isLeft` dans `src/core/params.ts` : droit, quart tournant, double quart tournant (deux quarts de même sens, en U, cotes A, C, B ; `stair.tours` = 2), demi-tournant (`isDemi` : le même U saisi par A, B et le jour `J`, `stair.C` = 2 W + J). Choix de métier du point 7 : mémoire du projet et https://claude.ai/artifact/MAYQLrWm62HwfFxy7AdZC2.

En entrant dans une forme en U, `changeForme` reprend ses cotes d'exemple (`EXEMPLE_U`, `EXEMPLE_DEMI`) ; entre double quart et demi-tournant, il garde l'escalier (J = C − 2 W).

## Repère et polylignes

- Repère du plan : départ en y = 0, côté mur en x = 0, côté jour en x = W. Les tournants sont calculés à droite (2e volée vers +x, 3e vers −y) ; le gauche est un miroir (`scale.x = -1` en 3D, x → −x dans le plan).
- Polylignes paramétrées par abscisse curviligne, segments d'extrémité prolongés : `makePoly`, `polyAt`, `polyPath`, `polyCut` (`src/core/poly.ts`).

## Nez, limons, foulée

- Lignes de nez : du point Q côté jour, par le point P sur la ligne de foulée, jusqu'au côté mur. `nr` est la normale vers le haut de l'escalier.
- Limons : bord haut à `LIFT` = 50 mm au-dessus de la ligne de nez, contour dans `stringerOutline`, couché dans le sens du plateau par `layBoard` (`src/core/stringer.ts`, pour le DXF et la fiche).
- Ligne de foulée : côtés du jour décalés de f, raccordés par un quart de cercle autour de chaque angle (`tA`, `tB`).
- Balancement par tournant (`stair.bals`, `stair.bal` = le premier) ; deux zones qui se chevauchent se partagent à la ligne la plus proche du milieu de la volée du milieu (un creux du giron au jour à chaque angle).
- Hauteur du tour : pas de réglage enregistré, elle découle de A et B (balancement centré sur l'angle). Le champ « Marches droites avant le tour » affiche `bal.a` ; le modifier recalcule A et B à A + B constant (`turnLengths`, bornes `turnRange`), donc même ligne de foulée et même confort.
- Logements et hauteur nécessaire de chaque limon calculés dans `stringerPieces` (`stringerPockets`, `cncFrame` dans `src/core/pockets.ts`). Le limon de jour du quart tournant a sa propre hauteur `hlj` (automatique par défaut : `need` arrondi à 10 mm, 470 mm avec l'exemple) ; chaque pièce porte sa hauteur dans `sp.hl`.

## Garde-corps

`stair.rail`, `src/core/railing.ts`, constantes `GC`. Réglages `gc` (aucun par défaut, ce qui garde les fichiers de référence d'origine), `gcPose`, `mcL`, `mcH`, `bs`. Contours des pièces dans leur plan (`handrailOutline`, `postOutline`, `railOutline`, tenon `postTenon`) au même endroit, pour la 3D comme pour `garde-corps.dxf`.

Chaque tronçon de main courante suit en plan un tronçon de limon de jour, même abscisse u ; sa pente minimise la surhauteur au-dessus de 900 mm (recherche ternaire, fonction convexe). En quart tournant, le poteau monte à la main courante et reçoit sa mortaise.
