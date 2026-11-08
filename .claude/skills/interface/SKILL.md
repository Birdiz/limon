---
name: interface
description: Interface de l'outil (src/ui, src/main.ts), projets et leur enregistrement, lien de projet, en-tête, accueil, état brouillon ou terminé, réglages avancés, vue plan ou 3D, sections, pas à pas, annuler, téléphone.
---

# Interface de l'outil

Pas de framework d'interface.

## Projets

`Project` dans `src/core/project.ts`, derrière l'interface `ProjectStore` (`src/ui/store.ts`), commune au stockage de l'appareil (`LocalStore`) et à sa recopie dans le compte (`SyncStore`).

- **localStorage** : `limon-projets` (liste), `limon-courant` (dernier ouvert), `limon-sections` (sections ouvertes en mode complet), `limon-atelier` (profil de l'atelier). L'ancienne clé `limon-v2` est reprise une fois comme « Mon escalier », sans être effacée.
- **Escalier ouvert** (`EscalierOuvert`, `src/ui/ouvert.ts`, testé par `tests/ouvert.test.ts` sans la page) : l'escalier à l'écran et les règles de ce qui en est gardé (escalier reçu, quota du gratuit, lecture seule, retour en brouillon, version reçue d'ailleurs). Sans DOM, le stockage injecté : il reçoit les événements (`ouvrir`, `lien`, `exemple`, `nouveau`, `geste`, `change`, `regle`, `garder`, `liste`, `niveau`, `ailleurs`) et la page montre ce qu'il dit (`montrer` avec sa raison, `affiche`). `src/main.ts` ne fait que brancher le DOM dessus : une règle sur l'escalier ouvert va dans ce module.
- **Plusieurs onglets** : `limon-projets` est partagé. Chaque écriture de `LocalStore` relit le stockage et n'y porte que ses propres changements, le plus récent `modifie` gagnant, une suppression demandée ici l'emportant ; un écouteur `storage` recharge la liste et prévient la page par `onChange`. Une version reçue d'ailleurs (autre onglet ou compte) met l'escalier ouvert à jour sans quitter l'écran en cours (raison `version` de `montrer`, `src/main.ts`) : sans fermer l'accueil ni replier l'export, contrairement à `ouvert`. `setCurrent` n'écrit que `limon-courant`.
- **Écriture refusée** (stockage plein ou interdit) : les changements restent en mémoire et repartent à l'écriture suivante ; `stored()` est faux tant que `limon-projets` n'est pas écrit, et l'en-tête le dit à la place de « Enregistré », à toutes les largeurs et sur l'accueil.
- **Fichier** `.escalier` (les `.limon` d'avant le renommage se lisent aussi) : JSON `{ format: "limon-projet", version, projet }`. `parseProjectFile` refuse un fichier sans `projet` ou `params` objets, à la version qui n'est pas un entier positif, ou dont aucune cote ne se lit. Les autres cotes illisibles sont remplacées par l'exemple et renvoyées dans `ignores` : l'escalier est gardé en brouillon, l'accueil reste affiché et les nomme (`COTE_LABEL`). Une clé absente n'est pas signalée : les fichiers d'avant un réglage ne l'ont pas. Une lecture qui échoue (fichier parti entre le choix et la lecture) le dit sur l'accueil.
- **Copie et client** : « Garder une copie » sur un escalier dont le devis nomme un client (`hasClient`, versions remises comprises) demande « Avec le devis et le client » ou « L'escalier seul » (`projectFile(p, false)` : `devis` à null, nom et cotes gardés) ; sans client, pas de question. La question tombe si l'escalier ouvert change ou perd son client. La copie de secours de l'onglet Mon compte (`keepCopy`, `src/ui/account.ts`) garde toujours le devis.
- **Lien de projet** (`#H=3200&…`, `src/core/share.ts`) : ouvert dans la page, il montre l'escalier et le calcule sans rien écrire, ni sur l'appareil ni au compte (`recu`, `src/ui/ouvert.ts`) ; une ligne de l'en-tête le dit, à la place de « Enregistré ». Le premier geste de l'artisan sur l'escalier (réglage, nom, état, étape, devis, « Garder cet escalier ») l'enregistre et l'envoie au compte ; regarder, actualiser ou enregistrer la fiche et les fichiers n'en sont pas. Fermé sans geste, il ne laisse rien. Rien de nouveau non plus si le lien redonne les réglages du projet ouvert ou d'un projet gardé, rouvert alors (`sameLink`, comparaison comme le lien est écrit : `n`, `f` et `hlj` automatiques n'y comptent pas). L'adresse suit les réglages du projet ouvert : actualiser ou une mise à jour silencieuse relit donc l'ancre comme un lien, sans rien copier.

## En-tête et accueil

- **Paramètres d'ouverture** : `?compte` ouvre Mon compte, `?compte=paye` aussi, au retour de la page de paiement.
- **En-tête** : logo (retour à l'accueil), « Mes escaliers » avec l'état de l'escalier et son nom, état de l'enregistrement, « Nouvel escalier », bouton du compte (« Ouvrir l'outil » tant qu'on n'est pas connecté, puis initiale).
- **Accueil** (`Home`, `src/ui/home.ts`) : page entière à la place de tout dialogue. Onglets Escaliers (création, cartes avec vignette du plan, rangées En cours et Terminés, copies en fichier, installation), Mon atelier, Mon compte. Montré quand aucun escalier n'est ouvert, par le logo, « Mes escaliers » (onglet Escaliers) ou le bouton du compte (onglet Mon compte).
- Un nouvel escalier part en pas à pas, sauf l'exemple, un lien reçu et le bouton avancé « Tous les réglages d'un coup », qui partent en mode complet.

## État de l'escalier

`etat` et `finiLe` du `Project`, `withEtat`. Brouillon à la création, à la copie et pour les escaliers d'avant l'état ; « Escalier terminé » dans le bandeau au-dessus de la fiche (masqué en pas à pas). Un réglage changé sur un escalier terminé le repasse en brouillon (`edited`) ; `canFinish` décide du passage à terminé.

## Réglages avancés

Préférence de l'appareil (`limon-avance`), interrupteur dans l'onglet Mon compte. Sans elle, les éléments `[data-adv]` sont masqués (hauteurs et foulée à la main, marches balancées, progressivité, cote du nez, cotes des rainures, embrèvement, assemblage CNC, copie des DXF, nouvel escalier complet) et la section Marches montre le choix du calcul.

## Niveaux

Gratuit, payant, premium : `DROITS`, `niveauActif` (`src/core/niveaux.ts`), suivis par `EscalierOuvert.niveau` (`src/ui/ouvert.ts`) et montrés par `applyNiveau` (`src/main.ts`). Tant que `ABONNEMENT_OUVERT` est faux, tout reste ouvert : un artisan limité n'aurait aucun moyen de s'abonner (Activation, skill `serveur-compte`). La préférence de l'appareil `limon-niveau` sert à essayer : `?niveau=gratuit`, `payant`, `compte` (suit le compte), `?niveau=0` l'enlève. Un niveau forcé ne peut que baisser, jamais donner plus que le compte. Le statut passe par `statutReel` : une date passée ramène au gratuit, hors ligne compris. Le contrôle reste dans le navigateur : le dépôt est public, seul ce que fait le serveur s'impose vraiment (décision de Thomas du 2026-11-05).

- **Masqués** : `[data-payant]` sans la classe `payant` du `body`, `[data-offre]` (ce qui les remplace) avec elle.
- **Un escalier à la fois** au gratuit : `makeRoom` (`src/ui/home.ts`) fait remplacer le seul escalier après confirmation, à la création et à l'ouverture d'une copie. Pas de « Dupliquer ».
- **Escalier reçu par lien et exemple** : à la limite, ils s'affichent sans être gardés, même après un geste, jusqu'à « Garder cet escalier » ; l'exemple ne prend pas de place.
- **Lecture seule** : au-delà de la limite, les moins récemment modifiés (`enLecture`). Rien n'est effacé ; ils s'ouvrent, se suppriment et se copient, le pas à pas s'y parcourt.
- **Fiche** : première page et filigrane (`extrait` de `fichePDF`). Sans fichiers pour la machine, liste de débit, tableurs, réglages avancés, Mon atelier, formes en U et palier ; un escalier déjà dans ces formes reste calculé.
- **Premium** : le devis, en plus de sa préférence `limon-devis`.

## Vue

`#vue`, `showVue` dans `src/main.ts`. Un seul panneau, le plan ou la 3D (`data-vue`), avec un bouton Plan / 3D et les deux points de vue de chacune (Dessus / Côté pour le plan, Perspective / Dessus pour la 3D). Celle montrée à l'ouverture : préférence de l'appareil (`limon-vue`, `3d` par défaut ou `plan`), dans l'onglet Mon compte. La fiche et le devis PDF n'en dépendent pas : ils portent toujours le plan et la vue 3D.

## Réglages et pas à pas

- **Champs calculés** : `n`, `f`, `hlj` et les cotes de trémie affichent le calcul tant que leur automatique est actif. `readInputs` ne les relit pas (les réglages gardent la valeur précédente), sauf au passage en manuel, qui part du chiffre affiché.
- **Sections** : six `<details>` (Forme, Dimensions, Trémie, Marches, Bois, Garde-corps ; ordre et titres dans `SECTIONS`, `src/core/summary.ts`), avec un résumé quand ils sont repliés.
- **Mode guidé** (`Steps`, `src/ui/steps.ts`) : une section à la fois, `mode` et `etape` enregistrés dans le projet, fiche et CNC masquées jusqu'à « Voir mon escalier », croquis de la cote en cours (`src/ui/sketch.ts`).

## Annuler, rétablir

`History`, `src/core/history.ts` ; `Undo`, `src/ui/undo.ts`. Copies complètes des réglages. Une frappe continue dans un même champ (nombre ou curseur) = une étape, une correction d'un clic ou « Revenir à l'exemple » = une étape. En mémoire seulement, vidé à l'ouverture d'un escalier et quand une version reçue d'ailleurs le remplace.

Flèches à côté de l'état de l'enregistrement (sur téléphone, pastille au-dessus des onglets dès le premier changement), Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z, Ctrl+Y ; le texte libre (nom de l'escalier) et l'accueil gardent leur Ctrl+Z. `src/main.ts` passe par `setParams` pour tout réglage changé d'un coup.

## Téléphone

Écran ≤ 920 px : barre d'onglets en bas (`Tabs`, `src/ui/tabs.ts`), un panneau à la fois choisi par `body[data-tab]` (réglages, vue, fiche avec contrôles, notes et CNC sans les boutons « Copier »). La vue prend la hauteur sous l'en-tête (`--hdr`). Pastille sur « Fiche » quand une note est `warn` ou `bad`.
