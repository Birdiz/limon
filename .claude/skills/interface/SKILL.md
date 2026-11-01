---
name: interface
description: Interface de l'outil (src/ui, src/main.ts), projets et leur enregistrement, lien de projet, en-tête, accueil, état brouillon ou terminé, réglages avancés, vue plan ou 3D, sections, pas à pas, annuler, téléphone.
---

# Interface de l'outil

Pas de framework d'interface.

## Projets

`Project` dans `src/core/project.ts`, derrière l'interface asynchrone `ProjectStore` (`src/ui/store.ts`), pour qu'un espace en ligne remplace un jour `LocalStore`.

- **localStorage** : `limon-projets` (liste), `limon-courant` (dernier ouvert), `limon-sections` (sections ouvertes en mode complet), `limon-atelier` (profil de l'atelier). L'ancienne clé `limon-v2` est reprise une fois comme « Mon escalier », sans être effacée.
- **Fichier** `.escalier` (les `.limon` d'avant le renommage se lisent aussi) : JSON `{ format: "limon-projet", version, projet }`.
- **Lien de projet** (`#H=3200&…`, `src/core/share.ts`) : ouvert dans la page, il devient un nouveau projet, sauf s'il redonne les réglages du projet ouvert. L'adresse suit les réglages du projet ouvert.

## En-tête et accueil

- **En-tête** : logo (retour à l'accueil), « Mes escaliers » avec l'état de l'escalier et son nom, état de l'enregistrement, « Nouvel escalier », bouton du compte (« Ouvrir l'outil » tant qu'on n'est pas connecté, puis initiale).
- **Accueil** (`Home`, `src/ui/home.ts`) : page entière à la place de tout dialogue. Onglets Escaliers (création, cartes avec vignette du plan, rangées En cours et Terminés, copies en fichier, installation), Mon atelier, Mon compte. Montré quand aucun escalier n'est ouvert, par le logo, « Mes escaliers » (onglet Escaliers) ou le bouton du compte (onglet Mon compte).
- Un nouvel escalier part toujours en pas à pas.

## État de l'escalier

`etat` et `finiLe` du `Project`, `withEtat`. Brouillon à la création, à la copie et pour les escaliers d'avant l'état ; « Escalier terminé » dans le bandeau au-dessus de la fiche (masqué en pas à pas). Un réglage changé sur un escalier terminé le repasse en brouillon.

## Réglages avancés

Préférence de l'appareil (`limon-avance`), interrupteur dans l'onglet Mon compte. Sans elle, les éléments `[data-adv]` sont masqués (hauteurs et foulée à la main, marches balancées, progressivité, nez, assemblage CNC, copie des DXF, nouvel escalier complet) et la section Marches montre le choix du calcul.

## Vue

`#vue`, `showVue` dans `src/main.ts`. Un seul panneau, le plan ou la 3D (`data-vue`), avec un bouton Plan / 3D et les deux points de vue de chacune (Dessus / Côté pour le plan, Perspective / Dessus pour la 3D). Celle montrée à l'ouverture : préférence de l'appareil (`limon-vue`, `3d` par défaut ou `plan`), dans l'onglet Mon compte. La fiche et le devis PDF n'en dépendent pas : ils portent toujours le plan et la vue 3D.

## Réglages et pas à pas

- **Sections** : six `<details>` (Forme, Dimensions, Trémie, Marches, Bois, Garde-corps ; ordre et titres dans `SECTIONS`, `src/core/summary.ts`), avec un résumé quand ils sont repliés.
- **Mode guidé** (`Steps`, `src/ui/steps.ts`) : une section à la fois, `mode` et `etape` enregistrés dans le projet, fiche et CNC masquées jusqu'à « Voir mon escalier », croquis de la cote en cours (`src/ui/sketch.ts`).

## Annuler, rétablir

`History`, `src/core/history.ts` ; `Undo`, `src/ui/undo.ts`. Copies complètes des réglages. Une frappe continue dans un même champ (nombre ou curseur) = une étape, une correction d'un clic ou « Revenir à l'exemple » = une étape. En mémoire seulement, vidé à l'ouverture d'un escalier.

Flèches à côté de l'état de l'enregistrement (sur téléphone, pastille au-dessus des onglets dès le premier changement), Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z, Ctrl+Y ; le texte libre (nom de l'escalier) et l'accueil gardent leur Ctrl+Z. `src/main.ts` passe par `setParams` pour tout réglage changé d'un coup.

## Téléphone

Écran ≤ 920 px : barre d'onglets en bas (`Tabs`, `src/ui/tabs.ts`), un panneau à la fois choisi par `body[data-tab]` (réglages, vue, fiche avec contrôles, notes et CNC sans les boutons « Copier »). La vue prend la hauteur sous l'en-tête (`--hdr`). Pastille sur « Fiche » quand une note est `warn` ou `bad`.
