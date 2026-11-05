---
name: verification
description: Vérification, CI GitHub Actions (jobs, contrôles exigés), fichiers de référence (tests/__snapshots__, DXF, CSV, notices, fiches PDF), écart de snapshot, check:dxf, essai dans le navigateur avec window.limon, capture et aspect de la 3D.
---

# Vérification

## Fichiers de référence

- `tests/__snapshots__` contient les DXF, CSV et notices de référence, relus à chaque changement de géométrie voulu ; à l'origine (commit 8ce7f38), identiques à l'octet près à ceux de la version en un seul fichier HTML (`limon.html`). Ils ne garantissent donc que l'égalité avec le dernier `-u` relu. Un écart est une régression, sauf changement de géométrie voulu : alors `npx vitest run -u`, puis `npm run check:dxf` (0 erreur attendue pour toutes les formes de `FORMES`) et relecture du diff.
- `tests/__snapshots__/*-fiche.pdf` : fiches de référence (sans 3D, date fixe). `vitest -u` ne les refait pas : supprimer le fichier pour le régénérer.

## Dans le navigateur

- Dans l'outil en développement (`/app/`), `window.limon` donne `compute`, `pieces`, `buildCNC`, `toDXF`, `exportZip`, `update`, `current()` et `scene()`.
- requestAnimationFrame ne tourne pas dans le panneau navigateur masqué : appeler `limon.update()` plutôt que de compter sur les événements.
- Pour la 3D en capture d'écran, le renderer utilise `preserveDrawingBuffer: true`. Le rendu reproduit celui de Three.js r147 (gestion des couleurs désactivée, lumières × π) : vérifier l'aspect à l'œil après une mise à jour de Three.js.

## CI

GitHub Actions, deux pipelines : `Tests` (`tests.yml` : jobs `vitest`, `dxf`, `build` avec démarrage du serveur) et `Code Quality` (`code-quality.yml` : `qualite` pour types, ESLint et Prettier ; `audit`, sans bloquer). Préparation commune dans `.github/actions/setup`.

- La règle « Protection de main » exige `vitest`, `dxf`, `build`, `qualite` par leur nom : renommer un job demande de la mettre à jour.
- Pas de filtre de chemins sur ces pipelines : un contrôle exigé qui ne se lance pas bloquerait la PR.
