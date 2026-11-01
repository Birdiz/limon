---
name: geometrie
description: Géométrie de l'escalier (compute, src/core/stair.ts), formes, repère du plan, polylignes, lignes de nez, limons, ligne de foulée, balancement, logements, palier, trémie, échappée, marche palière, poteaux, garde-corps.
---

# Géométrie

Voir `compute(p)` dans `src/core/stair.ts`.

Selon le sujet, lire aussi :

- [palier.md](palier.md) : `tournant` = "palier", demi-tour, pièce PALIER.
- [tremie.md](tremie.md) : trémie, contour, échappée, marche palière.
- [poteaux.md](poteaux.md) : poteaux, tenons, limons de mur en about, jour étroit.

## Résultat

`compute` renvoie `{ ok: true, stair }` ou `{ ok: false, errors }` (chaque erreur désigne si possible le champ fautif). `stair.params` garde les réglages utilisés. Une note peut porter une correction (`Fix`, appliquée d'un clic) ; `compute(p, false)` saute leur recherche.

## Formes

`Forme`, `TOURS`, `isLeft` dans `src/core/params.ts` : droit, quart tournant, double quart tournant (deux quarts de même sens, en U, cotes A, C, B ; `stair.tours` = 2), demi-tournant (`isDemi` : le même U saisi par A, B et le jour `J`, `stair.C` = 2 W + J). Choix de métier du point 7 : mémoire du projet et https://claude.ai/artifact/MAYQLrWm62HwfFxy7AdZC2.

En entrant dans une forme en U, `changeForme` reprend ses cotes d'exemple (`EXEMPLE_U`, `EXEMPLE_DEMI`) ; entre double quart et demi-tournant, il garde l'escalier (J = C − 2 W).

## Repère et polylignes

- Repère du plan : départ en y = 0, côté mur en x = 0, côté jour en x = W. Les tournants sont calculés à droite (2e volée vers +x, 3e vers −y) ; le gauche est un miroir (`scale.x = -1` en 3D, x → −x dans le plan).
- Polylignes paramétrées par abscisse curviligne, segments d'extrémité prolongés : `makePoly`, `polyAt`, `polyPath`, `polyCut` (`src/core/poly.ts`).

## Nez, limons, foulée

- Lignes de nez : du point Q côté jour, par le point P sur la ligne de foulée, jusqu'au côté mur. `nr` est la normale vers le haut de l'escalier.
- Limons : bord haut à `LIFT` = 50 mm au-dessus de la ligne de nez, contour dans `stringerOutline`.
- Ligne de foulée : côtés du jour décalés de f, raccordés par un quart de cercle autour de chaque angle (`tA`, `tB`).
- Balancement par tournant (`stair.bals`, `stair.bal` = le premier) ; deux zones qui se chevauchent se partagent à la ligne la plus proche du milieu de la volée du milieu (un creux du giron au jour à chaque angle).
- Hauteur du tour : pas de réglage enregistré, elle découle de A et B (balancement centré sur l'angle). Le champ « Marches droites avant le tour » affiche `bal.a` ; le modifier recalcule A et B à A + B constant (`turnLengths`, bornes `turnRange`), donc même ligne de foulée et même confort.
- Logements et hauteur nécessaire de chaque limon calculés dans `compute` (`stringerPockets`, `cncFrame` dans `src/core/pockets.ts`). Le limon de jour du quart tournant a sa propre hauteur `hlj` (automatique par défaut : `need` arrondi à 10 mm, 470 mm avec l'exemple) ; chaque pièce porte sa hauteur dans `sp.hl`.

## Garde-corps

`stair.rail`, `src/core/railing.ts`, constantes `GC`. Réglages `gc` (aucun par défaut, ce qui garde les fichiers de référence d'origine), `gcPose`, `mcL`, `mcH`, `bs`.

Chaque tronçon de main courante suit en plan un tronçon de limon de jour, même abscisse u ; sa pente minimise la surhauteur au-dessus de 900 mm (recherche ternaire, fonction convexe). En quart tournant, le poteau monte à la main courante et reçoit sa mortaise.
