---
name: page-publique
description: Page publique et pages du site, vitrine (/), renvoi vers l'outil, prix affiché, captures de public/vitrine, mentions légales.
---

# Page publique

Trois pages (entrées de `vite.config.ts`) : la page publique `index.html` (/), l'outil `app/index.html` (/app/), `mentions-legales/index.html`. Les deux premières partagent `src/styles/base.css` (jetons, logo).

- **Styles** : la page publique n'a que des styles (`src/vitrine.ts`, `src/styles/vitrine.css`) et un script dans son `<head>`.
- **Renvoi** : ce script envoie vers l'outil, avant l'affichage, celui qui a des escaliers sur l'appareil (`limon-projets`, `limon-v2`), l'application installée ou un lien de projet (`#…=…`, pas les ancres de la page). `/?visite` la montre quand même. Le serveur l'autorise par son empreinte, calculée au démarrage (`pagePolicy`, `server/static.ts`).
- **Boutons** : ils ouvrent `app/?nouveau` (nouvel escalier en pas à pas) ou `app/?exemple`. « Ouvrir l'outil » devient « Mes escaliers » (`app/?accueil`) pour qui est connecté sur l'appareil (`limon-synchro`).
- **Prix affiché** : trois offres, dans `index.html` (description, phrase du haut, `#prix`) et `mentions-legales/index.html`, HT d'abord (choix du propriétaire : l'artisan pense HT), le TTC à côté. Pour vérifier : gratuit. Pour fabriquer : 7,50 € HT (9 € TTC) par mois sans engagement ou 83,33 € HT (100 € TTC) par an. Pour vendre : 10,42 € HT (12,50 € TTC) par mois ou 116,67 € HT (140 € TTC) par an. `PRIX` garde le TTC prélevé, `prixHT` en tire le HT (TVA 20 %), aussi dans Mon compte. Le but est le volume, pas la marge : prix bas voulu. Un nouveau compte a 30 jours d'essai, sans carte bancaire. Les montants font foi dans `PRIX` (`src/core/niveaux.ts`), et un nouveau montant demande un nouveau prix chez Stripe. La section Prix et la FàQ disent aussi l'offre gratuite, à tenir d'accord avec `DROITS` (`src/core/niveaux.ts`). 
- **Textes selon l'abonnement** : les blocs `<!-- abonnement: ouvert -->` et `<!-- abonnement: ferme -->` (`index.html`, `app/index.html`, `mentions-legales/index.html`) sont triés au build par `textesAbonnement` (`src/core/niveaux.ts`), selon `ABONNEMENT_OUVERT`. Tant qu'il est faux, le site montre une seule offre payante et l'offre gratuite à venir, sans dire que tout est gratuit. Un changement de prix touche le bloc ouvert ; une fois l'abonnement ouvert, retirer les marques et les blocs fermés.
- **Mentions légales** : l'éditeur est nommé à titre personnel pendant la phase d'essai, sans statut ni SIRET (pas encore immatriculé). À l'immatriculation : statut, adresse, SIRET et mention de TVA.
- **Confidentialité** : dite deux fois, dans les mentions légales et dans la notice de Mon compte (`details.privacy`, `app/index.html`). Les deux changent ensemble, avec ce que garde le compte, `CONSERVATION`, `PREAVIS` ou l'arrivée d'une sauvegarde. Les clients des devis ne sont dits que par la notice, tant que le devis reste caché (`data-devis`).
- **Captures** : dans `public/vitrine/` (hors du cache du service worker), refaites par `npm run vitrine` (`scripts/vitrine.ts` : serveur de développement et Google Chrome sans fenêtre ; fiche rendue par qlmanage et sips, donc sur Mac) après un changement visible de l'outil.
