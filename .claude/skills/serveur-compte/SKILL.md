---
name: serveur-compte
description: Serveur et /api (server/), base et migrations, compte, passkeys, session, synchronisation des projets, profil de l'atelier, onglet Mon compte, mise en ligne.
---

# Serveur, compte et synchronisation

## Serveur

- `server/` : un seul service Node (Hono) qui sert `dist/` (`server/static.ts`, lu et compressé au démarrage) et `/api` (`server/api.ts`).
- **Base** : Postgres en ligne (`pg`), PGlite en développement (`.pglite/`, greffon `api` de `vite.config.ts`), avec `--local` et dans les tests. Migrations numérotées dans `server/db.ts` : en ajouter une, ne jamais modifier une migration en ligne.
- **Types** partagés avec la page dans `src/core/account.ts`.
- **Build** : `npm run build` → `dist/` (site, chemins relatifs) et `dist-server/` (serveur, `vite build --ssr`). Railway lance `npm start` d'après `railway.json`.

## Connexion

Sans mot de passe : passkey (SimpleWebAuthn, `@simplewebauthn/browser` chargé à part) ; code à 6 chiffres par e-mail (Brevo, `server/mail.ts`) pour créer le compte et en secours, haché avec un sel propre au processus.

Session : cookie `limon-session` (`HttpOnly`, `Path=/api`), un an, prolongée à l'usage. Requêtes qui modifient : origine du site exigée. Limites de débit en mémoire (un seul serveur).

## Données

Minimales (e-mail, projets, clés publiques, empreinte des sessions ; pas d'IP conservée). `statut` du compte : `testeur` pour l'instant, l'abonnement viendra. Suppression du compte en cascade ; export des données dans Mon compte.

## Synchronisation

`SyncStore` (`src/ui/sync.ts`) implémente `ProjectStore` au-dessus de `LocalStore` : écriture locale immédiate, échange en arrière-plan (démarrage, retour du réseau, retour sur la page, 3 s après une modification, toutes les 5 min).

Le serveur renvoie l'index (`id`, `modifie`, `supprime`) ; la version la plus récente gagne sur `modifie`, projet par projet ; une suppression est une trace datée. État dans `limon-synchro`. `currentId` reste propre à l'appareil. Toute modification du projet (réglages, nom, étape du mode guidé, devis, état) et toute suppression sont datées par `stamped` (`src/core/project.ts`) : toujours après la version remplacée, même si l'horloge de l'appareil retarde sur celle qui l'a écrite.

- **Première connexion** : les projets de l'appareil montent dans le compte.
- **Déconnexion** : tout est envoyé, puis les projets du compte quittent l'appareil (refusée s'il reste des envois).
- **Session perdue** : les projets restent ; connexion à une autre adresse ensuite : ceux de l'ancien compte quittent l'appareil.
- **Compte supprimé** : les projets restent sur l'appareil.

## Profil de l'atelier

`Atelier` et `ATELIER_KEYS` dans `src/core/atelier.ts`, `AtelierStore` et `AtelierPanel` dans `src/ui/atelier.ts`. Les réglages qui tiennent à l'habitude de l'artisan (bois, limons, poteau, assemblage, plateaux, garde-corps), repris par chaque nouvel escalier ; les cotes du chantier n'en font pas partie, et l'escalier d'exemple comme « Revenir à l'exemple » gardent les valeurs d'origine.

Rempli depuis l'onglet « Mon atelier » de l'accueil, ou d'un coup par « Garder ces réglages pour mes prochains escaliers » (masqué en pas à pas, comme « Revenir à l'exemple »). Enregistré dans `limon-atelier` ; avec un compte, table `ateliers` et `/api/atelier` (GET, PUT), échangé avec les projets, la version la plus récente gagnant, et il quitte l'appareil à la déconnexion.

## Compte à l'écran

Dans l'en-tête (bouton et état de l'enregistrement) et l'onglet Mon compte de l'accueil (`AccountPanel`, `src/ui/account.ts`), avec la notice de confidentialité (responsable : Thomas Bouzy) et le bloc « Bientôt », qui annonce ce que l'abonnement apportera (nom et logo sur la fiche, devis, état du chantier, lien de visite, versions).
