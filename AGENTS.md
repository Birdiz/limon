# Quart de tour

Outil d'escaliers pour menuisiers, en ligne sur https://quart-de-tour.fr/. Appelé Limon jusqu'en octobre 2026 : le dépôt, les clés internes et `window.limon` gardent ce nom.

- Interface, textes et commentaires en français.
- `src/core`, `src/cnc` et `src/pdf` restent purs, sans DOM : ils tournent dans Node pour les tests et `scripts/export.ts`. Le DOM et Three.js vivent dans `src/ui`.
- `noUncheckedIndexedAccess` : `!` sur les accès d'index garantis par la géométrie.
- `npm run check` avant tout commit.
- Le savoir de chaque domaine est dans `.claude/skills/` : un changement qui le contredit met le skill à jour dans le même commit.
