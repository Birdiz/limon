# Trémie, échappée et marche palière

## Trémie

- **À calculer** (`tAuto`) : la plus courte qui donne 2 000 mm d'échappée ; en quart tournant, tout le côté arrivée (`tX = B + el`) et le côté départ minimal. Les cotes retenues sont dans `stair.treDims`.
- **Contour** en polygone (`tremieContour`, `stair.trePoly` ; `stair.tre` en est la boîte englobante), échappée calculée sur ce contour.
- **En L** (`tForme`, quart tournant seulement) : le coin au-dessus du jour reste plancher, branches `tbD` et `tbA` ; à calculer, branches à la largeur de l'escalier (limons, poteau, garde-corps). Le U est laissé au demi-tournant.
- **Double quart** (`tremieContour`) : rectangle adossé au bord du plancher d'arrivée (y = A − B − mpD) et au mur côté arrivée ; `tY` le long du côté arrivée, `tX` en travers. En U (`tForme` "L" à deux tournants) : branches des volées de `tbD` depuis chaque mur de côté, bande du fond de `tbA`, le milieu au-dessus du jour reste plancher.

## Échappée

`headroomUnder`, `src/core/headroom.ts`. Verticale entre la ligne des nez (linéaire de nez à nez) et la sous-face du plancher, hors du contour de trémie (polygone quelconque, bord compris dans la trémie), calculée exactement aux croisements avec le bord.

- `stair.ech` : la plus faible sur toute la largeur (faces des limons, ligne de foulée, 9 droites du jour au mur) ; `stair.echCotes` : jour, foulée, mur.
- Mêmes seuils partout (`echStatus` : limite sous 2 000 mm, hors norme sous 1 900 mm) ; la trémie à calculer donne 2 000 mm sur toute la largeur.
- Contrôles détaillés par côté en quart tournant ou quand les côtés diffèrent (`echSidesShown`) ; sur le plan, repères des côtés masqués sur téléphone.

## Marche palière

`mp`, profondeur `mpP` depuis le nez, épaisseur `mpE`, dans le profil de l'atelier ; `stair.mp`. Dessus au sol fini du haut, logée dans les limons d'arrivée prolongés à l'horizontale de `mpP` ; le bord de la trémie et du plancher recule d'autant.

Pièce MP dans `marches.dxf` (`cnc.mpPart`), dernière contremarche raccourcie de `mpE`. Avec un garde-corps, retour horizontal de main courante (`retour`), coupé d'onglet (`cut0`, `cut1`), balustres ou lisses continués dessous.
