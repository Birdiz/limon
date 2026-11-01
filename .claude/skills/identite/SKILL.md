---
name: identite
description: Identité de Quart de tour, mots adressés aux artisans, couleurs, logo, icônes, polices. À lire avant d'écrire un texte visible ou de changer l'apparence.
---

# Identité

« Démarrer au quart de tour » (refonte du 2026-10-28).

- **Mots** : les artisans aiment peu le numérique. Mots du métier gardés, mots de l'informatique évités (« Mes escaliers », « fichiers pour la machine », « garder une copie »).
- **Couleurs** : bleu du cordeau (`--chalk`) pour le logo et le dessin, orange d'allumage (`--go`, classe `.btn.go`) pour le seul bouton qui fait avancer. En jetons sur `:root` dans `src/styles/base.css`, thème sombre inclus.
- **Mouvement** : flèche des sections qui tourne de 90° ; éventail du pas à pas (une marche par étape).
- **Logo** : piste « l'éventail », plan d'un quart tournant et flèche de rotation, tracé sur 100 unités. Recopié dans `public/favicon.svg`, l'en-tête de `index.html` et `logo()` de `src/pdf/fiche.ts` ; sur téléphone l'en-tête ne montre que le logo. Icônes PNG de `public/icons/` rendues depuis le même tracé (fond `#13171c`, logo `#7ba4ee`).
- **Polices** : auto-hébergées via `@fontsource` (sous-ensembles latin).
