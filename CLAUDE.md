# Limon : notes pour Claude

Outil d'escaliers pour un ébéniste et d'autres menuisiers. L'interface, les textes et les commentaires sont en français.

## Projet

- TypeScript strict (`noUncheckedIndexedAccess` : `!` sur les accès d'index garantis par la géométrie), Vite, Vitest, ESLint, Prettier. Pas de framework d'interface.
- `src/core`, `src/cnc` et `src/pdf` restent purs (pas de DOM) : ils tournent dans Node pour les tests et `scripts/export.ts`. Le DOM et Three.js vivent dans `src/ui`.
- `npm run check` avant tout commit. Le site est statique (`npm run build` → `dist/`, chemins relatifs).
- Polices auto-hébergées via `@fontsource` (sous-ensembles latin). Couleurs en jetons sur `:root` dans `src/styles/main.css`, thème sombre inclus.

## Projets et interface

- Projets (`Project` dans `src/core/project.ts`) derrière l'interface asynchrone `ProjectStore` (`src/ui/store.ts`), pour qu'un espace en ligne remplace un jour `LocalStore`. localStorage : `limon-projets` (liste), `limon-courant` (dernier ouvert), `limon-sections` (sections ouvertes en mode complet). L'ancienne clé `limon-v2` est reprise une fois comme « Mon escalier », sans être effacée. Fichier `.limon` : JSON `{ format: "limon-projet", version, projet }`.
- Réglages en cinq `<details>` (Forme, Dimensions, Trémie, Marches, Bois ; ordre et titres dans `SECTIONS`, `src/core/summary.ts`), avec un résumé quand ils sont repliés. Mode guidé (`Steps`, `src/ui/steps.ts`) : une section à la fois, `mode` et `etape` enregistrés dans le projet, fiche et CNC masquées jusqu'à « Terminer ».
- L'export CNC n'est calculé (`buildCNC`) que lorsque sa section est ouverte ; il contient les réglages d'assemblage (hauteurs de limon, encastrement, jeu).

## Géométrie (voir `compute(p)` dans `src/core/stair.ts`)

- `compute` renvoie `{ ok: true, stair }` ou `{ ok: false, errors }`. `stair.params` garde les réglages utilisés.
- Repère du plan : départ en y = 0, côté mur en x = 0, côté jour en x = W. Le quart tournant est calculé à droite ; le gauche est un miroir (`scale.x = -1` en 3D, x → −x dans le plan).
- Polylignes paramétrées par abscisse curviligne, segments d'extrémité prolongés : `makePoly`, `polyAt`, `polyPath`, `polyCut` (`src/core/poly.ts`).
- Lignes de nez : du point Q côté jour, par le point P sur la ligne de foulée, jusqu'au côté mur. `nr` est la normale vers le haut de l'escalier.
- Limons : bord haut à `LIFT` = 50 mm au-dessus de la ligne de nez, contour dans `stringerOutline`.
- Trémie à calculer (`tAuto`) : la plus courte qui donne 2 000 mm d'échappée ; en quart tournant, tout le côté arrivée (`tX = B + el`) et le côté départ minimal. Les cotes retenues sont dans `stair.treDims`.
- Logements et hauteur nécessaire de chaque limon calculés dans `compute` (`stringerPockets`, `cncFrame` dans `src/core/pockets.ts`). Le limon de jour du quart tournant a sa propre hauteur `hlj` (automatique par défaut : `need` arrondi à 10 mm, 470 mm avec l'exemple) ; chaque pièce porte sa hauteur dans `sp.hl`.

## Export CNC (voir `buildCNC`, `toDXF`, `makeZip` dans `src/cnc`)

- DXF R12 (AC1009), texte sans accents, zip sans compression avec CRC32.
- Marches vues de dessus, nez le long de x, encastrement `enc` inclus. Contremarches vues de face, longueur hors tout, bouts biais cotés sur `TEXTE`. Limons vus côté marches, tournés au rectangle d'aire minimale.
- Nez arrondi `rn` (dessus et dessous, au plus et/2) et jeu `jeu` par côté sur les logements. Le bout avant des logements de marche est un arc : bulge DXF en troisième coordonnée du sommet (type `Vertex`, `bulgePts` pour l'aperçu, signe inversé quand la pièce est retournée).

## Fiche PDF (voir `fichePDF` dans `src/pdf/fiche.ts`)

- PDF 1.4 écrit à la main (`PdfDoc`, `src/pdf/pdf.ts`) : Helvetica standard en WinAnsiEncoding, chasses AFM codées en dur, pas de compression. Deux pages A4 : cotes, contrôles (`checks`, partagés avec les tuiles), remarques, plan et vue 3D ; puis bois, assemblage et fiche des marches.
- Le plan vient de `planShapes` (`src/core/plan-shapes.ts`), commun au SVG de l'écran et au PDF. La vue 3D est capturée par `Scene3D.snapshot()` en thème clair.

## Tests

- `tests/__snapshots__` contient les DXF, CSV et notices de référence, identiques à l'octet près à ceux de la dernière version en un seul fichier HTML (`limon.html`, commit 8ce7f38). Un écart est une régression, sauf changement de géométrie voulu : alors `npx vitest run -u`, puis `npm run check:dxf` (0 erreur attendue pour droit, quart-g, quart-d) et relecture du diff.
- `tests/__snapshots__/*-fiche.pdf` : fiches de référence (sans 3D, date fixe). `vitest -u` ne les refait pas : supprimer le fichier pour le régénérer.
- Dans la page en développement, `window.limon` donne `compute`, `buildCNC`, `toDXF`, `exportZip`, `update`, `current()` et `scene()`. requestAnimationFrame ne tourne pas dans le panneau navigateur masqué : appeler `limon.update()` plutôt que de compter sur les événements.
- Pour la 3D en capture d'écran, le renderer utilise `preserveDrawingBuffer: true`. Le rendu reproduit celui de Three.js r147 (gestion des couleurs désactivée, lumières × π) : vérifier l'aspect à l'œil après une mise à jour de Three.js.
