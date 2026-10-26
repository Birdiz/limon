# Limon : notes pour Claude

Outil d'escaliers pour un ébéniste et d'autres menuisiers. L'interface, les textes et les commentaires sont en français.

## Projet

- TypeScript strict (`noUncheckedIndexedAccess` : `!` sur les accès d'index garantis par la géométrie), Vite, Vitest, ESLint, Prettier. Pas de framework d'interface.
- `src/core` et `src/cnc` restent purs (pas de DOM) : ils tournent dans Node pour les tests et `scripts/export.ts`. Le DOM et Three.js vivent dans `src/ui`.
- `npm run check` avant tout commit. Le site est statique (`npm run build` → `dist/`, chemins relatifs).
- Polices auto-hébergées via `@fontsource` (sous-ensembles latin). Couleurs en jetons sur `:root` dans `src/styles/main.css`, thème sombre inclus. localStorage `limon-v2` pour les réglages du visiteur, relus par `sanitizeParams`.

## Géométrie (voir `compute(p)` dans `src/core/stair.ts`)

- `compute` renvoie `{ ok: true, stair }` ou `{ ok: false, errors }`. `stair.params` garde les réglages utilisés.
- Repère du plan : départ en y = 0, côté mur en x = 0, côté jour en x = W. Le quart tournant est calculé à droite ; le gauche est un miroir (`scale.x = -1` en 3D, x → −x dans le plan).
- Polylignes paramétrées par abscisse curviligne, segments d'extrémité prolongés : `makePoly`, `polyAt`, `polyPath`, `polyCut` (`src/core/poly.ts`).
- Lignes de nez : du point Q côté jour, par le point P sur la ligne de foulée, jusqu'au côté mur. `nr` est la normale vers le haut de l'escalier.
- Limons : bord haut à `LIFT` = 50 mm au-dessus de la ligne de nez, contour dans `stringerOutline`.

## Export CNC (voir `buildCNC`, `toDXF`, `makeZip` dans `src/cnc`)

- DXF R12 (AC1009), texte sans accents, zip sans compression avec CRC32.
- Marches vues de dessus, nez le long de x, encastrement `enc` inclus. Limons vus côté marches, tournés au rectangle d'aire minimale.
- Le limon de jour du quart tournant demande environ 470 mm de hauteur dans le tournant avec l'exemple par défaut : la page le signale.

## Tests

- `tests/__snapshots__` contient les DXF, CSV et notices de référence, identiques à l'octet près à ceux de la première version (un seul fichier HTML). Un écart est une régression, sauf changement de géométrie voulu : alors `npx vitest run -u`, puis `npm run check:dxf` (0 erreur attendue pour droit, quart-g, quart-d) et relecture du diff.
- Dans la page en développement, `window.limon` donne `compute`, `buildCNC`, `toDXF`, `exportZip`, `update`, `current()` et `scene()`. requestAnimationFrame ne tourne pas dans le panneau navigateur masqué : appeler `limon.update()` plutôt que de compter sur les événements.
- Pour la 3D en capture d'écran, le renderer utilise `preserveDrawingBuffer: true`. Le rendu reproduit celui de Three.js r147 (gestion des couleurs désactivée, lumières × π) : vérifier l'aspect à l'œil après une mise à jour de Three.js.
