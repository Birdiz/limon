---
name: verification
description: Vérification, fichiers de référence (tests/__snapshots__, DXF, CSV, notices, fiches PDF), écart de snapshot, check:dxf, essai dans le navigateur avec window.limon, capture et aspect de la 3D.
---

# Vérification

## Fichiers de référence

- `tests/__snapshots__` contient les DXF, CSV et notices de référence, identiques à l'octet près à ceux de la dernière version en un seul fichier HTML (`limon.html`, commit 8ce7f38). Un écart est une régression, sauf changement de géométrie voulu : alors `npx vitest run -u`, puis `npm run check:dxf` (0 erreur attendue pour droit, quart-g, quart-d) et relecture du diff.
- `tests/__snapshots__/*-fiche.pdf` : fiches de référence (sans 3D, date fixe). `vitest -u` ne les refait pas : supprimer le fichier pour le régénérer.

## Dans le navigateur

- Dans l'outil en développement (`/app/`), `window.limon` donne `compute`, `buildCNC`, `toDXF`, `exportZip`, `update`, `current()` et `scene()`.
- requestAnimationFrame ne tourne pas dans le panneau navigateur masqué : appeler `limon.update()` plutôt que de compter sur les événements.
- Pour la 3D en capture d'écran, le renderer utilise `preserveDrawingBuffer: true`. Le rendu reproduit celui de Three.js r147 (gestion des couleurs désactivée, lumières × π) : vérifier l'aspect à l'œil après une mise à jour de Three.js.
