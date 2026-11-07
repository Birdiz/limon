---
name: export-cnc
description: Export CNC (src/cnc, buildCNC, pieces, toDXF, makeZip), DXF, calques, pièces des marches, contremarches, limons, poteaux et garde-corps, panneau CNC.
---

# Export CNC

Deux étapes. `pieces(R)` (`src/core/pieces.ts`, pur) donne les pièces débitées et leurs cotes (`Pieces` : marches, contremarches, limons, marche palière, poteaux, garde-corps), avec `stockVolume`, `oversize`, `tightBoards`. `buildCNC(R, P?)` (`src/cnc/build.ts`) les reprend et les pose en entités DXF (`CNC` étend `Pieces`), puis `toDXF` et `makeZip`. La liste de débit (`src/cnc/cutlist.ts`), la fiche PDF et le devis n'appellent que `pieces`. Les formes communes aux deux étapes (`treadShape`, `riserShape`, `boardNames`, `lay`, `handrailNames`) sont dans `src/core/pieces.ts` : une cote de pièce et son contour dans le DXF viennent du même calcul.

- **Format** : DXF R12 (AC1009), texte sans accents, zip sans compression avec CRC32.
- **Panneau** : l'export n'est calculé (`buildCNC`) que lorsque sa section est ouverte ; il contient les réglages d'assemblage (hauteurs de limon, plateaux disponibles, encastrement, jeu).
- **Marches** : vues de dessus, nez le long de x, encastrement `enc` inclus. Le contour de chacune, coin du débit à l'origine, est gardé par `pieces` dans `TreadPart.outline` pour le traçage à la main de la fiche (skill `fiche-pdf`).
- **Contremarches** : vues de face, longueur hors tout, bouts biais cotés sur `TEXTE`.
- **Limons** : vus côté marches, tournés au rectangle d'aire minimale (`layBoard`, `src/core/stringer.ts`, partagé avec la fiche PDF).
- **Poteaux** : POTEAU 1/2 puis 2/2 dans `poteau.dxf`, quatre faces vues de l'extérieur, couchées pied à gauche, dans l'ordre du tour (ordre inversé par le miroir des formes gauches).
- **Garde-corps** : `garde-corps.dxf` (`src/cnc/railing.ts`, contours des pièces pris à `src/core/railing.ts`, comme la 3D) ; balustres dans le chant : chant haut des limons de jour déroulé dans `limons.dxf`.
- **Calques** `TENON`, `MORTAISE`, `PERCAGE`, `RAINURE`, `EMBREVEMENT` : déclarés seulement dans les fichiers qui s'en servent (`EXTRA_LAYERS`), pour garder les DXF de l'escalier droit inchangés.
- **Nez et jeu** : profil du nez `nez` et sa cote `R.rn` (`src/core/nez.ts`) écrits sous chaque marche (`nezDXF`), jeu `jeu` par côté sur les logements. Le bout avant des logements de marche suit les arêtes du nez agrandies du jeu (`noseEnd`, `src/core/pockets.ts`) : arc en bulge DXF en troisième coordonnée du sommet (type `Vertex`, `bulgePts` pour l'aperçu, signe inversé quand la pièce est retournée), chanfrein en deux sommets.
- **Finitions des marches** dans `marches.dxf` : `RAINURE` (rainures antidérapantes, `Tread.grooves`) ; `EMBREVEMENT` à la place de `CM_DESSOUS` quand la contremarche est embrevée (largeur ecm + 2 jeu, d'un bout à l'autre de la marche) ; `CM_DESSUS` seulement pour la contremarche posée sur la marche. Le nom du nez passe derrière les rainures.
