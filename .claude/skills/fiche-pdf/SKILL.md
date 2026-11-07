---
name: fiche-pdf
description: Fiche PDF (fichePDF, src/pdf), écriture du PDF, pages et contenu, filigrane de brouillon, plan et vue de côté partagés avec l'écran, vue 3D de la fiche.
---

# Fiche PDF

Voir `fichePDF` dans `src/pdf/fiche.ts`. C'est la seule fiche imprimable.

- **Écriture** : PDF 1.4 écrit à la main (`PdfDoc`, `src/pdf/pdf.ts`), Helvetica standard en WinAnsiEncoding, chasses AFM codées en dur, pas de compression.
- **Pages** : trois pages A4. Cotes, contrôles (`checks`, partagés avec les tuiles), remarques, plan et vue 3D ; bois, assemblage et fiche des marches ; liste de débit, volume et alertes de fabrication (`src/cnc/cutlist.ts`, partagé avec le panneau CNC), tirés des pièces seules (`pieces`, `src/core/pieces.ts`), sans poser les entités DXF.
- **Limons** : pages à l'italienne après les trois premières (`src/pdf/limons.ts`), limons couchés par `layBoard` (`src/core/stringer.ts`) comme dans `limons.dxf`.
- **Brouillon** : la fiche porte « brouillon » en tête, un filigrane en lettres creuses sur chaque page, et « (brouillon) » dans le nom du fichier.
- **Extrait** : au niveau gratuit, `extrait` arrête la fiche à sa première page.
- **Plan** : vient de `planShapes` (`src/core/plan-shapes.ts`), commun au SVG de l'écran et au PDF.
- **Vue de côté** : vient de `sideShapes` (`src/core/side-shapes.ts`, géométrie dans `sideView`). Développé sur la ligne de foulée, plancher coupé aux bords de trémie, échappée de la ligne de foulée cotée à sa place (rappel de la plus faible si elle tombe ailleurs). Choix « Dessus / Côté » de la vue Plan, page 2 de la fiche.
- **Coupe au nez** : à droite de la vue de côté, page 2 (`coupeNez`, `src/core/coupe-nez.ts`) : profil du nez, rainures, pose de la contremarche et embrèvement. Les finitions sont aussi dans la liste Bois ; la hauteur de la crémaillère dans Limons et assemblage.
- **Vue 3D** : vient de `Scene3D.snapshot()`, thème clair, taille fixe et cadre en perspective, quels que soient la vue à l'écran et son point de vue.
