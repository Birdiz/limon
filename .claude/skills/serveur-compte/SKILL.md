---
name: serveur-compte
description: Serveur et /api (server/), base et migrations, compte, passkeys, session, synchronisation des projets, profil de l'atelier, onglet Mon compte, mise en ligne.
---

# Serveur, compte et synchronisation

## Serveur

- `server/` : un seul service Node (Hono) qui sert `dist/` (`server/static.ts`, lu et compressé au démarrage) et `/api` (`server/api.ts`).
- **Base** : Postgres en ligne (`pg`), PGlite en développement (`.pglite/`, greffon `api` de `vite.config.ts`), avec `--local` (même si `DATABASE_URL` est réglée) et dans les tests. Migrations numérotées dans `server/db.ts` : en ajouter une, ne jamais modifier une migration en ligne.
- **Types** partagés avec la page dans `src/core/account.ts`.
- **Build** : `npm run build` → `dist/` (site, chemins relatifs) et `dist-server/` (serveur, `vite build --ssr`). Railway lance `npm start` d'après `railway.json`.
- **En-têtes** : `Strict-Transport-Security` avec `includeSubDomains` (`server/main.ts`) : tout sous-domaine de quart-de-tour.fr doit servir en https, `webmail` (403 de Gandi, sans certificat à ce nom) ne servant déjà rien. `Content-Security-Policy` sur les pages seulement (`pagePolicy`, `server/static.ts`) : le site seul, styles en ligne permis, pas de cadrage. Les scripts en ligne d'une page sont reconnus à leur empreinte, calculée au démarrage : rien à recalculer à la main. Une nouvelle origine ou un script en ligne ajouté par autre chose que le HTML se règlent là ; à essayer dans le build (`pwa`), le serveur de développement n'envoie pas la politique.
- **Pannes** : `/` ne dépend pas de la base. Base perdue : le processus reste en vie, `/api/sante` rend 500, puis 200 à son retour. Délais de `PG_DELAIS` (`server/db.ts`) : connexion 5 s, `statement_timeout` 5 s (l'annulation par la base), `query_timeout` 7 s (le client lâche une base figée, qui n'annule plus rien). Brevo : 10 s, puis 502. Au démarrage, base absente : le processus s'arrête et Railway garde l'ancienne version (`healthcheckPath`), il n'écoute pas avant d'avoir migré.
- **Limites des délais** : une écriture lâchée par `query_timeout` a pu être appliquée par la base ; une migration passe par le même pool, plus longue que `statement_timeout` elle fait échouer le démarrage.

## Connexion

Sans mot de passe : passkey (SimpleWebAuthn, `@simplewebauthn/browser` chargé à part) ; code à 6 chiffres par e-mail (Brevo, `server/mail.ts`) pour créer le compte et en secours, haché avec un sel propre au processus.

Session : cookie `limon-session` (`HttpOnly`, `Path=/api`), un an, prolongée à l'usage. Requêtes qui modifient : origine du site exigée. Limites de débit en mémoire (un seul serveur).

## Données

Minimales (e-mail, projets, clés publiques, empreinte des sessions ; pas d'IP conservée). `statut` du compte : `testeur` pour l'instant, l'abonnement viendra. Suppression du compte en cascade ; export des données dans Mon compte.

**Conservation** : 24 mois sans connexion (décision du propriétaire), durée dans `CONSERVATION` (`server/db.ts`). `comptes.vu` avance à chaque connexion et, une fois par jour au plus, à toute requête authentifiée (`auth`) ; la migration a daté les comptes existants de leur dernière activité connue. `purgeComptes`, au démarrage (sans l'attendre) et toutes les heures : avertit par e-mail (`brevoAvertissement`) à 24 mois moins 30 jours, 10 par passage, puis efface en cascade quand les 24 mois sont passés **et** que l'avertissement a 30 jours (`PREAVIS`). L'avertissement n'est noté qu'une fois envoyé : Brevo en panne retarde l'effacement, jamais le contraire. Revenir l'annule. Un compte dont `droits_jusqu_a` court n'est ni averti ni effacé. `purge` retire aussi les traces de suppression de plus de 24 mois, à la date de l'appareil : un appareil resté plus longtemps sans échange renverrait son escalier.

## Synchronisation

`SyncStore` (`src/ui/sync.ts`) implémente `ProjectStore` au-dessus de `LocalStore` : écriture locale immédiate, échange en arrière-plan (démarrage, retour du réseau, retour sur la page, 3 s après une modification, toutes les 5 min).

Le serveur renvoie l'index (`id`, `modifie`, `supprime`) ; la version la plus récente gagne sur `modifie`, projet par projet ; une suppression est une trace datée. État dans `limon-synchro`. `currentId` reste propre à l'appareil. Toute modification du projet (réglages, nom, étape du mode guidé, devis, état) passe par `touched` (`src/core/project.ts`), toute suppression par `stamped` : datées toujours après la version remplacée, même si l'horloge de l'appareil retarde sur celle qui l'a écrite.

**Numéro de schéma** : `SCHEMA` (`src/core/project.ts`), **à monter à chaque champ ou valeur d'énumération ajoutés à un projet**, réglages compris. Les mises à jour étant silencieuses, un appareil peut repartir une fois sur une ancienne version, qui oublie à la relecture ce qu'elle ne connaît pas. `Project.schema` dit quelle version a écrit le contenu : 0 pour une copie d'avant le numéro. La relecture le garde (plafonné à `SCHEMA`), seule une modification (`touched`) le monte, un fichier ouvert et un nouvel escalier partent à `SCHEMA`.

- **Page** : un projet descendu d'un schéma plus haut n'est pas rangé (`fromNewerVersion`) ; la copie plus ancienne reste, rien n'est compté à envoyer, et l'état le dit (`plusRecents`) sans alarme ni rien à faire.
- **Serveur, `PUT /projets`** : envoi de schéma plus haut que le serveur, refusé ; plus bas que la ligne et plus récent qu'elle, refusé et nommé, rien d'écrasé ; égal ou plus haut que la ligne, il la remplace.
- **Sans numéro** (versions d'avant lui, encore en circulation) : fusionné dans la ligne, réglages à part, seules les clés vraiment envoyées comptent (`sent`, `server/api.ts`). La ligne garde son numéro. Pour un nouvel escalier, ou sur une trace de suppression, il arrive complet.
- **Une suppression** n'a pas de numéro : plus récente, elle passe, quel que soit le schéma de la ligne.

Limites : une copie déjà amputée repart telle quelle dès qu'on la modifie après la mise à jour, et son refus reste affiché d'ici là. Une valeur d'énumération inconnue d'une version sans numéro est retombée sur la valeur par défaut avant l'envoi : le serveur ne peut pas le voir. Une copie sans numéro relue par une version qui le connaît a déjà ses clés remplies, `devis: null` compris : encore à envoyer, elle l'efface. Deux onglets de versions différentes sur un même navigateur peuvent encore s'amputer dans `limon-projets`.

L'envoi part par lots (500 éléments et 3 Mo au plus). `PUT /projets` range élément par élément : un refus (`{ id, raison }`, en mots pour l'artisan) n'arrête pas les suivants et ne rend jamais de 500. Une date `modifie` doit être entière, entre 0 et l'heure du serveur plus 732 jours, pour un projet, une trace de suppression et le profil de l'atelier ; `sanitizeProject` ne la borne pas, un fichier ouvert garde la sienne. Un compte garde 2 000 lignes, traces comprises (ce qui y est déjà se modifie encore). Limite de débit par compte sur `PUT /projets`, `PUT /atelier` et `POST /projets/lire`. La réponse n'a la forme `{ index, refus }` que si l'envoi porte `detail: true` : un onglet ouvert depuis avant lit un tableau.

Côté page, `SyncState.refuses` garde la version refusée : elle sort de l'attente, ne bloque ni l'échange ni la déconnexion, reste sur l'appareil, et repart si elle change, ou une fois à chaque chargement de la page. `offline` ne dit que le réseau (`TypeError`) ; une réponse d'erreur du serveur, envoi entier ou profil de l'atelier, est dans `erreur`, dite telle quelle à l'écran.

- **Première connexion** : les projets de l'appareil montent dans le compte.
- **Déconnexion** : tout est envoyé, puis les projets du compte quittent l'appareil (refusée s'il reste des envois, profil de l'atelier compris ; un projet ou un profil refusé n'en est pas un, et reste sur l'appareil).
- **Session perdue** : les projets restent ; connexion à une autre adresse ensuite : ceux de l'ancien compte quittent l'appareil.
- **Compte supprimé** : les projets restent sur l'appareil.

## Profil de l'atelier

`Atelier` et `ATELIER_KEYS` dans `src/core/atelier.ts`, `AtelierStore` et `AtelierPanel` dans `src/ui/atelier.ts`. Les réglages qui tiennent à l'habitude de l'artisan (bois, limons, poteau, assemblage, plateaux, garde-corps), repris par chaque nouvel escalier ; les cotes du chantier n'en font pas partie, et l'escalier d'exemple comme « Revenir à l'exemple » gardent les valeurs d'origine.

Rempli depuis l'onglet « Mon atelier » de l'accueil, ou d'un coup par « Garder ces réglages pour mes prochains escaliers » (masqué en pas à pas, comme « Revenir à l'exemple »). Enregistré dans `limon-atelier` ; avec un compte, table `ateliers` et `/api/atelier` (GET, PUT), échangé avec les projets, et il quitte l'appareil à la déconnexion, sauf refusé. Toute modification est datée par `stamped`, comme un projet : un appareil à l'horloge en retard ne perd pas contre la version qu'il remplace.

**Fusion par partie** : réglages, tarifs et fiche de l'entreprise ont chacun leur date (`Atelier.dates`, colonne `dates`), `set` ne date que la partie changée, et `modifie` reste la plus récente. `mergeAtelier` garde la plus récente partie par partie, côté serveur et côté page ; à date égale, celle du compte. Un appareil neuf qui garde un réglage ne vide donc ni les tarifs ni la fiche du compte. `PUT /atelier` renvoie le profil réuni, et relit la ligne s'il ne la retrouve pas telle qu'il l'a lue.

**Appareil neuf** : sa partie réglages n'a qu'une date, posée sur tout dès la première cote gardée. Au premier échange (`serveurAtelier` encore nul), la page lit donc le profil du compte avant d'envoyer le sien : `joinAtelier` n'y reporte que les réglages qui s'écartent de l'exemple, si sa date est la plus récente, et l'échange est noté aussitôt. Limite : un réglage remis exprès à la valeur de l'exemple sur un appareil neuf garde celle du compte. Un appareil qui a déjà échangé porte les valeurs du compte : une cote changée y date toute la partie sans rien perdre, sauf si un autre appareil a changé un autre réglage entre-temps, où la plus récente gagne.

**Profil d'avant ces dates** (appareil, ligne du compte, ancienne version encore ouverte) : `sanitizeAtelier` donne `modifie` à ce qu'il a de rempli, et 0 à ce qu'il a de vide, qui ne remplace donc rien. Limites : une partie vidée exprès par une ancienne version revient depuis le compte ; une ancienne version qui change une partie date les autres, si elles sont remplies, avec elle, et peut donc les remplacer d'un bloc.

**Attente** : `SyncState.serveurAtelier` retient la date reçue au dernier échange. Un profil plus récent compte dans `pending` (`atelierAttend` le dit, l'en-tête le nomme « votre atelier »), et dans la garde de `signOut`. Un refus (400 de `PUT /atelier`, date impossible) reste dit dans `erreur` et compte toujours dans `pending`, l'en-tête ne promet donc rien, même hors ligne. Seule la garde de `signOut` l'écarte (`atelierRefuse`, jusqu'à la version suivante) : refusé encore à chaque essai, il ne bloque pas la déconnexion et reste sur l'appareil, comme un escalier refusé. Limite : une connexion à une autre adresse après une session perdue l'efface, comme tout profil.

## Compte à l'écran

Dans l'en-tête (bouton et état de l'enregistrement, qui nomme un escalier refusé) et l'onglet Mon compte de l'accueil (`AccountPanel`, `src/ui/account.ts`), avec la liste des refus et leur « Garder une copie », la notice de confidentialité (responsable : Thomas Bouzy) et le bloc « Bientôt », qui annonce ce que l'abonnement apportera (nom et logo sur la fiche, devis, état du chantier, lien de visite, versions).
