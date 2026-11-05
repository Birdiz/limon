---
name: geometrie
description: Géométrie de l'escalier (compute, src/core/stair.ts), formes, repère du plan, polylignes, lignes de nez, limons, ligne de foulée, balancement, logements, palier, trémie, échappée, marche palière, poteaux, garde-corps.
---

# Géométrie

Voir `compute(p)` dans `src/core/stair.ts`. Les types du modèle (`Stair`, `Tread`, `StringerPiece`, `Newel`, `Railing`, `Note`…) sont dans `src/core/stair-types.ts`, sans calcul : les modules de `core` les importent de là, `stair.ts` les ré-exporte pour le reste. Seul cycle gardé, d'appel : `stair-notes.ts` rappelle `compute` pour chercher les marches balancées.

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
- Logements et hauteur nécessaire de chaque limon calculés dans `compute` (`stringerPockets`, `cncFrame` dans `src/core/pockets.ts`). Le limon de jour du quart tournant a sa propre hauteur `hlj` (automatique par défaut : `need` arrondi à 10 mm, 470 mm avec l'exemple) ; chaque pièce porte sa hauteur dans `sp.hl`.

## Finitions des marches

Profil du nez (`ProfilNez`, `src/core/nez.ts`) : arrondi dessus et dessous, quart-de-rond ou chanfrein sur l'arête du dessus (dessous vif), arêtes cassées (rayon fixe `ARETE_CASSEE`). `nezCote` donne la cote appliquée (`R.rn`, au plus et/2), `aretes` la forme de chaque arête, reprise par la 3D (`noseProfile`), les logements et la coupe de la fiche. `Tread.nose` est la bande du profil derrière la ligne de nez.

Rainures antidérapantes (`rai`, `Tread.grooves`, marche palière comprise) : parallèles au nez, arrêtées à `RAINURE_ARRET` des faces des limons et de la ligne de nez suivante ; plus courtes que `RAINURE_MIN`, elles ne sont pas taillées (note). Validées derrière le profil du nez.

Contremarche (`cmPose`, `cmEmb`) : posée sur la marche du bas (la marche va jusqu'à son dos) ou derrière elle (elle descend jusqu'au dessous de la marche du bas, qui s'arrête contre son parement) ; `arriereMarche` donne la coupe arrière des marches, partout (calcul, logements, DXF, vue de côté). L'embrèvement la monte dans une rainure sous la marche du haut, sauf la dernière sans marche palière (plancher d'arrivée).

## Garde-corps

`stair.rail`, `src/core/railing.ts`, constantes `GC`. Réglages `gc` (aucun par défaut, ce qui garde les fichiers de référence d'origine), `gcPose`, `mcL`, `mcH`, `bs`. Contours des pièces dans leur plan (`handrailOutline`, `postOutline`, `railOutline`, tenon `postTenon`) au même endroit, pour la 3D comme pour `garde-corps.dxf`.

Chaque tronçon de main courante suit en plan un tronçon de limon de jour, même abscisse u ; sa pente minimise la surhauteur au-dessus de 900 mm (recherche ternaire, fonction convexe). En quart tournant, le poteau monte à la main courante et reçoit sa mortaise.
