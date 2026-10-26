# Limon : notes pour Claude

Outil d'escaliers pour un ébéniste et d'autres menuisiers. L'interface, les textes et les commentaires sont en français.

## Publication

- `limon.html` est la source de l'Artifact https://claude.ai/artifact/SqSCRq3So3XMmP7biAWy3Y (icône "stairs", capacités `{downloads: true}`).
- Republier avec l'outil Artifact en passant ce `url` pour garder le lien, sans changer les capacités sauf besoin. Lire l'artifact avant la première publication d'une session.
- Un seul fichier : CSS et JS en ligne, Three.js r147 depuis jsdelivr (`three.min.js` et `examples/js/controls/OrbitControls.js`). Couleurs en jetons sur `:root`, thème sombre inclus. localStorage `limon-v2` pour les réglages du visiteur.

## Géométrie (voir `compute(p)`)

- Repère du plan : départ en y = 0, côté mur en x = 0, côté jour en x = W. Le quart tournant est calculé à droite ; le gauche est un miroir (`scale.x = -1` en 3D, x → −x dans le plan).
- Polylignes paramétrées par abscisse curviligne, segments d'extrémité prolongés : `makePoly`, `polyAt`, `polyPath`, `polyCut`.
- Lignes de nez : du point Q côté jour, par le point P sur la ligne de foulée, jusqu'au côté mur. `nr` est la normale vers le haut de l'escalier.
- Limons : bord haut à 50 mm au-dessus de la ligne de nez (`lift`), contour dans `stringerOutline`.

## Export CNC (voir `buildCNC`, `toDXF`, `makeZip`)

- DXF R12 (AC1009), texte sans accents, zip sans compression avec CRC32. Le zip est nécessaire : `downloads.save` refuse l'extension `.dxf`.
- Marches vues de dessus, nez le long de x, encastrement `enc` inclus. Limons vus côté marches, tournés au rectangle d'aire minimale.
- Le limon de jour du quart tournant demande environ 470 mm de hauteur dans le tournant avec l'exemple par défaut : la page le signale.

## Tests

- requestAnimationFrame ne tourne pas dans le panneau navigateur masqué : appeler `compute` et `buildCNC` directement depuis la console plutôt que de cliquer.
- Pour la 3D en capture d'écran, le renderer utilise `preserveDrawingBuffer: true`.
- Valider chaque export avec `tools/check_dxf.py` : 0 erreur attendue pour les trois formes (droit, quart-g, quart-d).
