---
name: fiche-pdf
description: Fiche PDF (fichePDF, src/pdf), écriture du PDF, pages et contenu, filigrane de brouillon, plan et vue de côté partagés avec l'écran, vue 3D de la fiche.
---

# Fiche PDF

Voir `fichePDF` dans `src/pdf/fiche.ts`. C'est la seule fiche imprimable.

- **Écriture** : PDF 1.4 écrit à la main (`PdfDoc`, `src/pdf/pdf.ts`), Helvetica standard en WinAnsiEncoding, chasses AFM codées en dur, pas de compression.
- **Pages** : trois pages A4. Cotes, contrôles (`checks`, partagés avec les tuiles), remarques, plan et vue 3D ; bois, assemblage et fiche des marches ; liste de débit, volume et alertes de fabrication (`src/cnc/cutlist.ts`, partagé avec le panneau CNC), tirés des pièces seules (`pieces`, `src/core/pieces.ts`), sans poser les entités DXF.
- **Limons** : pages à l'italienne après les trois premières (`src/pdf/limons.ts`), limons couchés par `layBoard` (`src/core/stringer.ts`) comme dans `limons.dxf`. Sommets du contour nommés a, b, c… (`ring`, `contourNames`), comme dans le traçage.
- **Traçage à la main** (décision de Thomas du 2026-11-05 : pour l'atelier sans commande numérique, dans la fiche, pas de gabarits à l'échelle 1) : pages à l'italienne après les limons (`src/pdf/tracage.ts`). « Traçage des limons » : méthode, puis pour chaque limon la fausse équerre des dessus de marche (`Board.pente`), le nez et le fond de chaque logement de marche et la contremarche depuis le nez (`Board.rows`), le contour point par point (`Board.contour`), en x depuis le bout gauche du plateau et y depuis sa rive basse. Dans le plan du limon chaque logement est un rectangle (dessus de niveau, contremarche d'aplomb) : deux points et deux distances suffisent. « Traçage des marches » : marches, paliers et marche palière qui ne sont pas des rectangles (`treadCards`, contour `TreadPart.outline` de `pieces`), x depuis le bout gauche du débit, y depuis la rive du nez, côtés et diagonales pour contrôler ; absente pour l'escalier droit.
- **Brouillon** : la fiche porte « brouillon » en tête, un filigrane en lettres creuses sur chaque page, et « (brouillon) » dans le nom du fichier.
- **Extrait** : au niveau gratuit, `extrait` arrête la fiche à sa première page.
- **Plan** : vient de `planShapes` (`src/core/plan-shapes.ts`), commun au SVG de l'écran et au PDF.
- **Vue de côté** : vient de `sideShapes` (`src/core/side-shapes.ts`, géométrie dans `sideView`). Développé sur la ligne de foulée, plancher coupé aux bords de trémie, échappée de la ligne de foulée cotée à sa place (rappel de la plus faible si elle tombe ailleurs). Choix « Dessus / Côté » de la vue Plan, page 2 de la fiche.
- **Vue 3D** : vient de `Scene3D.snapshot()`, thème clair, taille fixe et cadre en perspective, quels que soient la vue à l'écran et son point de vue.
