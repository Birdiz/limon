# Quart de tour

Outil d'escaliers pour menuisiers, en ligne sur https://quart-de-tour.fr/. Appelé Limon jusqu'en octobre 2026 : le dépôt, les clés internes et `window.limon` gardent ce nom.

- Interface, textes et commentaires en français.
- `src/core`, `src/cnc` et `src/pdf` restent purs, sans DOM : ils tournent dans Node pour les tests et `scripts/export.ts`. Le DOM et Three.js vivent dans `src/ui`.
- `noUncheckedIndexedAccess` : `!` sur les accès d'index garantis par la géométrie.
- `npm run check` avant tout commit.
- Rien ne va sur `main` en direct : tout changement passe par une branche et une pull request. La CI ne tourne que sur les PR, c'est donc la PR qui atteste du travail — avant de fusionner, remettre la branche à jour sur `main` pour que les contrôles portent sur ce qui sera fusionné.
- Le savoir de chaque domaine est dans `.claude/skills/` : un changement qui le contredit met le skill à jour dans le même commit.
