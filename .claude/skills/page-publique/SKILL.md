---
name: page-publique
description: Page publique et pages du site, vitrine (/), renvoi vers l'outil, prix affiché, captures de public/vitrine, mentions légales.
---

# Page publique

Trois pages (entrées de `vite.config.ts`) : la page publique `index.html` (/), l'outil `app/index.html` (/app/), `mentions-legales/index.html`. Les deux premières partagent `src/styles/base.css` (jetons, logo).

- **Styles** : la page publique n'a que des styles (`src/vitrine.ts`, `src/styles/vitrine.css`) et un script dans son `<head>`.
- **Renvoi** : ce script envoie vers l'outil, avant l'affichage, celui qui a des escaliers sur l'appareil (`limon-projets`, `limon-v2`), l'application installée ou un lien de projet (`#…=…`, pas les ancres de la page). `/?visite` la montre quand même. Le serveur l'autorise par son empreinte, calculée au démarrage (`pagePolicy`, `server/static.ts`).
- **Boutons** : ils ouvrent `app/?nouveau` (nouvel escalier en pas à pas) ou `app/?exemple`. « Ouvrir l'outil » devient « Mes escaliers » (`app/?accueil`) pour qui est connecté sur l'appareil (`limon-synchro`).
- **Prix affiché** : 30 jours d'essai, puis 9 € TTC par mois sans engagement ou 100 € TTC par an.
- **Mentions légales** : les `.trou` restent à remplir.
- **Captures** : dans `public/vitrine/` (hors du cache du service worker), refaites par `npm run vitrine` (`scripts/vitrine.ts` : serveur de développement et Google Chrome sans fenêtre ; fiche rendue par qlmanage et sips, donc sur Mac) après un changement visible de l'outil.
