# Poteaux et assemblages des limons

`stair.newels`, un par tournant, section `ps`. Affleurant les faces des limons de jour côté marches, au coin du jour.

- **Limons de jour** : ils s'arrêtent sur les faces du poteau et y entrent par un tenon (`sp.tenons`, deux pour le tronçon du milieu, constantes `TENON`) placé derrière la profondeur des logements. Les deux faces du poteau côté marches reçoivent les logements des marches qui les touchent (calculés comme des bouts de limon).
- **Limons de mur** : chacun reçoit le suivant en about, avec deux perçages (`sp.holes`).
- **Demi-tournant au jour étroit** (J < `jourUnPoteau` = 2 ps + 100) : un seul poteau J × ps (`N.sx`, `N.sy`) prend les deux angles, sans limon de jour du milieu (limons de jour d'indices 0 et 2, numérotés 1/2 et 2/2 dans les DXF). Les deux limons et les deux mains courantes entrent dans sa face du fond, chacun près de son arête ; `face.volee` dit quelle volée loge dans chaque face.
