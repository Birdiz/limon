---
name: export-cnc
description: Export CNC (src/cnc, buildCNC, toDXF, makeZip), DXF, calques, pièces des marches, contremarches, limons, poteaux et garde-corps, panneau CNC.
---

# Export CNC

Voir `buildCNC`, `toDXF`, `makeZip` dans `src/cnc`.

- **Format** : DXF R12 (AC1009), texte sans accents, zip sans compression avec CRC32.
- **Panneau** : l'export n'est calculé (`buildCNC`) que lorsque sa section est ouverte ; il contient les réglages d'assemblage (hauteurs de limon, plateaux disponibles, encastrement, jeu).
- **Marches** : vues de dessus, nez le long de x, encastrement `enc` inclus.
- **Contremarches** : vues de face, longueur hors tout, bouts biais cotés sur `TEXTE`.
- **Limons** : vus côté marches, tournés au rectangle d'aire minimale.
- **Poteaux** : POTEAU 1/2 puis 2/2 dans `poteau.dxf`, quatre faces vues de l'extérieur, couchées pied à gauche, dans l'ordre du tour (ordre inversé par le miroir des formes gauches).
- **Garde-corps** : `garde-corps.dxf` (`src/cnc/railing.ts`) ; balustres dans le chant : chant haut des limons de jour déroulé dans `limons.dxf`.
- **Calques** `TENON`, `MORTAISE`, `PERCAGE` : déclarés seulement dans les fichiers qui s'en servent (`EXTRA_LAYERS`), pour garder les DXF de l'escalier droit inchangés.
- **Nez et jeu** : nez arrondi `rn` (dessus et dessous, au plus et/2) et jeu `jeu` par côté sur les logements. Le bout avant des logements de marche est un arc : bulge DXF en troisième coordonnée du sommet (type `Vertex`, `bulgePts` pour l'aperçu, signe inversé quand la pièce est retournée).
