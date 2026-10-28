# Quart de tour : notes pour Claude

Outil d'escaliers pour un ébéniste et d'autres menuisiers, appelé Limon jusqu'en octobre 2026 (dépôt, clés internes et `window.limon` gardent ce nom). En ligne sur https://quart-de-tour.fr/. L'interface, les textes et les commentaires sont en français.

## Projet

- TypeScript strict (`noUncheckedIndexedAccess` : `!` sur les accès d'index garantis par la géométrie), Vite, Vitest, ESLint, Prettier. Pas de framework d'interface.
- `src/core`, `src/cnc` et `src/pdf` restent purs (pas de DOM) : ils tournent dans Node pour les tests et `scripts/export.ts`. Le DOM et Three.js vivent dans `src/ui`.
- `npm run check` avant tout commit. Le site est statique (`npm run build` → `dist/`, chemins relatifs).
- Logo (piste « l'éventail » : plan d'un quart tournant et flèche de rotation), tracé sur 100 unités, recopié dans `public/favicon.svg`, l'en-tête de `index.html` et `logo()` de `src/pdf/fiche.ts` ; sur téléphone l'en-tête ne montre que le logo. Icônes PNG de `public/icons/` rendues depuis le même tracé (fond `#13171c`, logo `#7ba4ee`).
- Polices auto-hébergées via `@fontsource` (sous-ensembles latin). Couleurs en jetons sur `:root` dans `src/styles/main.css`, thème sombre inclus.

## Projets et interface

- Projets (`Project` dans `src/core/project.ts`) derrière l'interface asynchrone `ProjectStore` (`src/ui/store.ts`), pour qu'un espace en ligne remplace un jour `LocalStore`. localStorage : `limon-projets` (liste), `limon-courant` (dernier ouvert), `limon-sections` (sections ouvertes en mode complet). L'ancienne clé `limon-v2` est reprise une fois comme « Mon escalier », sans être effacée. Fichier `.escalier` (les `.limon` d'avant le renommage se lisent aussi) : JSON `{ format: "limon-projet", version, projet }`. L'ancienne adresse `limon-escaliers.up.railway.app` sert le même site, qui part aussitôt vers quart-de-tour.fr en emportant ses projets dans l'ancre (`src/ui/move.ts`) ; à garder en ligne tant que des testeurs ont des projets là-bas. Un lien de projet (`#H=3200&…`, `src/core/share.ts`) ouvert dans la page devient un nouveau projet, sauf s'il redonne les réglages du projet ouvert ; l'adresse suit les réglages du projet ouvert.
- Réglages en six `<details>` (Forme, Dimensions, Trémie, Marches, Bois, Garde-corps ; ordre et titres dans `SECTIONS`, `src/core/summary.ts`), avec un résumé quand ils sont repliés. Mode guidé (`Steps`, `src/ui/steps.ts`) : une section à la fois, `mode` et `etape` enregistrés dans le projet, fiche et CNC masquées jusqu'à « Terminer ».
- L'export CNC n'est calculé (`buildCNC`) que lorsque sa section est ouverte ; il contient les réglages d'assemblage (hauteurs de limon, plateaux disponibles, encastrement, jeu).
- Téléphone (écran ≤ 920 px) : barre d'onglets en bas (`Tabs`, `src/ui/tabs.ts`), un panneau à la fois choisi par `body[data-tab]` (réglages, 3D, plan, fiche avec contrôles, notes et CNC sans les boutons « Copier »). 3D et plan prennent la hauteur sous l'en-tête (`--hdr`). Pastille sur « Fiche » quand une note est `warn` ou `bad`. La capture 3D du PDF se rend à taille fixe quand la vue est masquée.
- Application installable et hors ligne (`startPWA`, `src/ui/pwa.ts`) : `src/sw.js` en JavaScript, complété au build par le greffon `pwa` de `vite.config.ts` (fichiers du build et de `public/`, sans `.map` ni `.woff`, empreinte en nom de cache). Mises à jour silencieuses, sans bandeau : les artisans ne rechargeraient pas. La nouvelle version attend, prend la main quand la page passe en arrière-plan (ou dès le lancement si elle attendait déjà), puis la page se recharge après avoir enregistré la saisie en cours. Bouton « Installer » dans Mes projets (`beforeinstallprompt`), aide Partager → écran d'accueil sur iPhone. Service worker enregistré en production seulement : essai avec `npm run build` puis `npm run preview`.

## Géométrie (voir `compute(p)` dans `src/core/stair.ts`)

- `compute` renvoie `{ ok: true, stair }` ou `{ ok: false, errors }` (chaque erreur désigne si possible le champ fautif). `stair.params` garde les réglages utilisés. Une note peut porter une correction (`Fix`, appliquée d'un clic) ; `compute(p, false)` saute leur recherche.
- Repère du plan : départ en y = 0, côté mur en x = 0, côté jour en x = W. Le quart tournant est calculé à droite ; le gauche est un miroir (`scale.x = -1` en 3D, x → −x dans le plan).
- Polylignes paramétrées par abscisse curviligne, segments d'extrémité prolongés : `makePoly`, `polyAt`, `polyPath`, `polyCut` (`src/core/poly.ts`).
- Lignes de nez : du point Q côté jour, par le point P sur la ligne de foulée, jusqu'au côté mur. `nr` est la normale vers le haut de l'escalier.
- Limons : bord haut à `LIFT` = 50 mm au-dessus de la ligne de nez, contour dans `stringerOutline`.
- Hauteur du tour : pas de réglage enregistré, elle découle de A et B (balancement centré sur l'angle). Le champ « Marches droites avant le tour » affiche `bal.a` ; le modifier recalcule A et B à A + B constant (`turnLengths`, bornes `turnRange`), donc même ligne de foulée et même confort.
- Trémie à calculer (`tAuto`) : la plus courte qui donne 2 000 mm d'échappée ; en quart tournant, tout le côté arrivée (`tX = B + el`) et le côté départ minimal. Les cotes retenues sont dans `stair.treDims`.
- Logements et hauteur nécessaire de chaque limon calculés dans `compute` (`stringerPockets`, `cncFrame` dans `src/core/pockets.ts`). Le limon de jour du quart tournant a sa propre hauteur `hlj` (automatique par défaut : `need` arrondi à 10 mm, 470 mm avec l'exemple) ; chaque pièce porte sa hauteur dans `sp.hl`.
- Poteau du quart tournant (`stair.newel`, section `ps`) : affleurant les faces des limons de jour côté marches, au coin du jour. Les limons de jour s'arrêtent sur ses faces et y entrent par un tenon (`sp.tenon`, constantes `TENON`) placé derrière la profondeur des logements ; ses deux faces côté marches reçoivent les logements des marches qui les touchent (calculés comme des bouts de limon). Le limon de mur 1/2 reçoit le 2/2 en about, avec deux perçages (`sp.holes`).

- Garde-corps (`stair.rail`, `src/core/railing.ts`, constantes `GC`) : réglages `gc` (aucun par défaut, ce qui garde les fichiers de référence d'origine), `gcPose`, `mcL`, `mcH`, `bs`. Chaque tronçon de main courante suit en plan un tronçon de limon de jour, même abscisse u ; sa pente minimise la surhauteur au-dessus de 900 mm (recherche ternaire, fonction convexe). En quart tournant, le poteau monte à la main courante et reçoit sa mortaise.

## Export CNC (voir `buildCNC`, `toDXF`, `makeZip` dans `src/cnc`)

- DXF R12 (AC1009), texte sans accents, zip sans compression avec CRC32.
- Marches vues de dessus, nez le long de x, encastrement `enc` inclus. Contremarches vues de face, longueur hors tout, bouts biais cotés sur `TEXTE`. Limons vus côté marches, tournés au rectangle d'aire minimale. Poteau : quatre faces vues de l'extérieur, couchées pied à gauche, dans l'ordre du tour (ordre inversé par le miroir du quart gauche).
- Garde-corps : `garde-corps.dxf` (`src/cnc/railing.ts`) ; balustres dans le chant : chant haut des limons de jour déroulé dans `limons.dxf`.
- Calques `TENON`, `MORTAISE`, `PERCAGE` déclarés seulement dans les fichiers qui s'en servent (`EXTRA_LAYERS`), pour garder les DXF de l'escalier droit inchangés.
- Nez arrondi `rn` (dessus et dessous, au plus et/2) et jeu `jeu` par côté sur les logements. Le bout avant des logements de marche est un arc : bulge DXF en troisième coordonnée du sommet (type `Vertex`, `bulgePts` pour l'aperçu, signe inversé quand la pièce est retournée).

## Fiche PDF (voir `fichePDF` dans `src/pdf/fiche.ts`)

- PDF 1.4 écrit à la main (`PdfDoc`, `src/pdf/pdf.ts`) : Helvetica standard en WinAnsiEncoding, chasses AFM codées en dur, pas de compression. Trois pages A4 : cotes, contrôles (`checks`, partagés avec les tuiles), remarques, plan et vue 3D ; bois, assemblage et fiche des marches ; liste de débit, volume et alertes de fabrication (`src/cnc/cutlist.ts`, partagé avec le panneau CNC). C'est la seule fiche imprimable.
- Le plan vient de `planShapes` (`src/core/plan-shapes.ts`), commun au SVG de l'écran et au PDF. La vue 3D est capturée par `Scene3D.snapshot()` en thème clair.

## Tests

- `tests/__snapshots__` contient les DXF, CSV et notices de référence, identiques à l'octet près à ceux de la dernière version en un seul fichier HTML (`limon.html`, commit 8ce7f38). Un écart est une régression, sauf changement de géométrie voulu : alors `npx vitest run -u`, puis `npm run check:dxf` (0 erreur attendue pour droit, quart-g, quart-d) et relecture du diff.
- `tests/__snapshots__/*-fiche.pdf` : fiches de référence (sans 3D, date fixe). `vitest -u` ne les refait pas : supprimer le fichier pour le régénérer.
- Dans la page en développement, `window.limon` donne `compute`, `buildCNC`, `toDXF`, `exportZip`, `update`, `current()` et `scene()`. requestAnimationFrame ne tourne pas dans le panneau navigateur masqué : appeler `limon.update()` plutôt que de compter sur les événements.
- Pour la 3D en capture d'écran, le renderer utilise `preserveDrawingBuffer: true`. Le rendu reproduit celui de Three.js r147 (gestion des couleurs désactivée, lumières × π) : vérifier l'aspect à l'œil après une mise à jour de Three.js.
