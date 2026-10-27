# Limon : notes pour Claude

Outil d'escaliers pour un ébéniste et d'autres menuisiers. L'interface, les textes et les commentaires sont en français.

## Projet

- TypeScript strict (`noUncheckedIndexedAccess` : `!` sur les accès d'index garantis par la géométrie), Vite, Vitest, ESLint, Prettier. Pas de framework d'interface.
- `src/core` et `src/cnc` restent purs (pas de DOM) : ils tournent dans Node pour les tests et `scripts/export.ts`. Le DOM et Three.js vivent dans `src/ui`.
- `npm run check` avant tout commit. Le site est statique (`npm run build` → `dist/`, chemins relatifs).
- Polices auto-hébergées via `@fontsource` (sous-ensembles latin). Couleurs en jetons sur `:root` dans `src/styles/main.css`, thème sombre inclus. localStorage `limon-v2` pour les réglages du visiteur, relus par `sanitizeParams` ; un lien de projet (`#H=3200&…`, `src/core/share.ts`) l'emporte au chargement.

## Géométrie (voir `compute(p)` dans `src/core/stair.ts`)

- `compute` renvoie `{ ok: true, stair }` ou `{ ok: false, errors }` (chaque erreur désigne si possible le champ fautif). `stair.params` garde les réglages utilisés. Une note peut porter une correction (`Fix`, appliquée d'un clic) ; `compute(p, false)` saute leur recherche.
- Repère du plan : départ en y = 0, côté mur en x = 0, côté jour en x = W. Le quart tournant est calculé à droite ; le gauche est un miroir (`scale.x = -1` en 3D, x → −x dans le plan).
- Polylignes paramétrées par abscisse curviligne, segments d'extrémité prolongés : `makePoly`, `polyAt`, `polyPath`, `polyCut` (`src/core/poly.ts`).
- Lignes de nez : du point Q côté jour, par le point P sur la ligne de foulée, jusqu'au côté mur. `nr` est la normale vers le haut de l'escalier.
- Limons : bord haut à `LIFT` = 50 mm au-dessus de la ligne de nez, contour dans `stringerOutline`.
- Logements et hauteur nécessaire de chaque limon calculés dans `compute` (`stringerPockets`, `cncFrame` dans `src/core/pockets.ts`). Le limon de jour du quart tournant a sa propre hauteur `hlj` (automatique par défaut : `need` arrondi à 10 mm, 470 mm avec l'exemple) ; chaque pièce porte sa hauteur dans `sp.hl`.
- Poteau du quart tournant (`stair.newel`, section `ps`) : affleurant les faces des limons de jour côté marches, au coin du jour. Les limons de jour s'arrêtent sur ses faces et y entrent par un tenon (`sp.tenon`, constantes `TENON`) placé derrière la profondeur des logements ; ses deux faces côté marches reçoivent les logements des marches qui les touchent (calculés comme des bouts de limon). Le limon de mur 1/2 reçoit le 2/2 en about, avec deux perçages (`sp.holes`).

- Garde-corps (`stair.rail`, `src/core/railing.ts`, constantes `GC`) : réglages `gc` (aucun par défaut, ce qui garde les fichiers de référence d'origine), `gcPose`, `mcL`, `mcH`, `bs`. Chaque tronçon de main courante suit en plan un tronçon de limon de jour, même abscisse u ; sa pente minimise la surhauteur au-dessus de 900 mm (recherche ternaire, fonction convexe). En quart tournant, le poteau monte à la main courante et reçoit sa mortaise.

## Export CNC (voir `buildCNC`, `toDXF`, `makeZip` dans `src/cnc`)

- DXF R12 (AC1009), texte sans accents, zip sans compression avec CRC32.
- Marches vues de dessus, nez le long de x, encastrement `enc` inclus. Contremarches vues de face, longueur hors tout, bouts biais cotés sur `TEXTE`. Limons vus côté marches, tournés au rectangle d'aire minimale. Poteau : quatre faces vues de l'extérieur, couchées pied à gauche, dans l'ordre du tour (ordre inversé par le miroir du quart gauche).
- Garde-corps : `garde-corps.dxf` (`src/cnc/railing.ts`) ; balustres dans le chant : chant haut des limons de jour déroulé dans `limons.dxf`.
- Calques `TENON`, `MORTAISE`, `PERCAGE` déclarés seulement dans les fichiers qui s'en servent (`EXTRA_LAYERS`), pour garder les DXF de l'escalier droit inchangés.
- Nez arrondi `rn` (dessus et dessous, au plus et/2) et jeu `jeu` par côté sur les logements. Le bout avant des logements de marche est un arc : bulge DXF en troisième coordonnée du sommet (type `Vertex`, `bulgePts` pour l'aperçu, signe inversé quand la pièce est retournée).

## Tests

- `tests/__snapshots__` contient les DXF, CSV et notices de référence, identiques à l'octet près à ceux de la dernière version en un seul fichier HTML (`limon.html`, commit 8ce7f38). Un écart est une régression, sauf changement de géométrie voulu : alors `npx vitest run -u`, puis `npm run check:dxf` (0 erreur attendue pour droit, quart-g, quart-d) et relecture du diff.
- Dans la page en développement, `window.limon` donne `compute`, `buildCNC`, `toDXF`, `exportZip`, `update`, `current()` et `scene()`. requestAnimationFrame ne tourne pas dans le panneau navigateur masqué : appeler `limon.update()` plutôt que de compter sur les événements.
- Pour la 3D en capture d'écran, le renderer utilise `preserveDrawingBuffer: true`. Le rendu reproduit celui de Three.js r147 (gestion des couleurs désactivée, lumières × π) : vérifier l'aspect à l'œil après une mise à jour de Three.js.
