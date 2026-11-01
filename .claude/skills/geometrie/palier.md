# Palier

`tournant` = "palier", le même pour tous les tournants ; un seul sur tout le fond en demi-tournant. Le palier est la marche qui couvre l'angle (`tread.palier`, `stair.paliers` avec le reste).

- **Giron** : le même partout, donné par la volée d'arrivée (`palierLayout` : m girons sur B − W).
- **Reste** : le reste de chaque volée qui monte à un palier s'ajoute à sa profondeur, au moins débord + contremarche + encastrement pour que la contremarche se loge dans le poteau.
- **Volée suivante** : elle part du coin du jour (`polyCut(…, extend)` pour le fond de logement).
- **Nez** (`noses` dans `compute`) : ils restent à plat sur le palier jusqu'à un giron avant la volée suivante, sans repasser l'angle ; limons à plat le long du palier.
- **Demi-tour** : limon de palier = limon de jour du milieu, à plat ; main courante horizontale à `GC.hPalier` (1 000 mm).
- **Corrections** : proposée sur B (`palierFix`), note du reste sur A (ou C).
- **Fabrication** : pièce PALIER dans `marches.dxf`, ligne « Palier » de la liste de débit, collé à chant.
