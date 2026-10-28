# Quart de tour

Calcul et dessin d'escaliers en bois pour menuisiers, sur le web (https://quart-de-tour.fr/, anciennement Limon) : escalier droit et quart tournant (gauche ou droite), 3D, contrôle de l'échappée et export CNC en DXF.

## Ce que fait l'outil

- **Calcul** : nombre de hauteurs automatique (Blondel 2h + g ≈ 630 mm), ligne de foulée, balancement des marches dans le quart tournant.
- **Trémie et échappée** : contrôle de la hauteur libre sous le plancher (alerte sous 2 000 mm, erreur sous 1 900 mm) et trémie minimale.
- **Corrections chiffrées** : quand une règle n'est pas tenue, l'outil propose la valeur qui la rétablit (reculement ou longueur côté départ, marches balancées, hauteur de limon, trémie), applicable d'un clic.
- **Débit** : alerte quand une pièce dépasse les plateaux disponibles, volume brut et poids selon l'essence.
- **Compte facultatif** : connexion par Face ID ou l'empreinte (passkey), code à 6 chiffres par e-mail pour créer le compte et en secours. Les projets suivent l'artisan d'un appareil à l'autre et restent utilisables sans réseau.
- **Lien de projet et fiche PDF** : les réglages qui diffèrent de l'exemple vont dans l'adresse de la page (après le `#`) ; la fiche PDF téléchargée réunit les cotes, les contrôles, le plan, la vue 3D, la fiche des marches et la liste de débit.
- **Plan et 3D** : plan coté en SVG, vue 3D Three.js avec limons, poteau, marches et contremarches.
- **Export CNC** : zip contenant `marches.dxf`, `limons.dxf`, `contremarches.dxf` (si l'escalier en a), `poteau.dxf` (quart tournant), `garde-corps.dxf` (s'il y en a un), la fiche des marches en CSV et une notice.
  - Nez arrondi et jeu d'assemblage réglables ; le limon de jour du quart tournant a sa propre hauteur, proposée d'après ses logements.
  - Quart tournant : poteau carré affleurant les limons de jour côté marches, limons de jour assemblés à tenon et mortaise dans le poteau, limons de mur en about vissé ou boulonné dans l'angle.
  - Garde-corps côté jour (limon droit pour l'escalier droit), au choix : balustres ou montants et lisses rampantes, posés dans le chant du limon ou à l'anglaise. Main courante droite à 900 mm au moins au-dessus des nez, écart libre de 110 mm au plus (NF P01-012), assemblée dans le poteau en quart tournant. Export `garde-corps.dxf`, mortaises dans le chant des limons ou perçages pour la pose à l'anglaise.
  - DXF R12 en millimètres.
  - Calques `DECOUPE` (contours), `DEFONCE` (logements), `CM_DESSUS` et `CM_DESSOUS` (traits des contremarches), `TEXTE` ; en quart tournant, `TENON`, `MORTAISE` et `PERCAGE`.

## Organisation

TypeScript strict, Vite, sans framework d'interface.

```
index.html            gabarit de la page
src/
  core/               calcul pur, sans DOM : géométrie, escalier, réglages, fiche CSV
  cnc/                export : pièces à usiner, DXF R12, zip, notice
  ui/                 rendu dans la page : réglages, plan SVG, résultats, panneau CNC, 3D
  styles/main.css     jetons de couleur, thème sombre
  main.ts             branchement des événements et boucle de mise à jour
server/               serveur Node : le site construit et /api (compte, projets), Postgres
tests/                Vitest ; les fichiers de référence sont dans tests/__snapshots__
scripts/export.ts     export CNC en ligne de commande
tools/check_dxf.py    vérification des DXF avec ezdxf
```

`src/core` et `src/cnc` ne dépendent pas du navigateur : ils tournent aussi dans Node (tests, script d'export).

## Développement

Node 20.19 ou plus récent.

```bash
npm install
```

```bash
npm run dev
```

Puis ouvrir http://localhost:5173. Le serveur de développement répond aussi à `/api` : base PGlite (Postgres en WebAssembly) dans `.pglite/`, rien à installer ; les codes de connexion s'affichent dans la console au lieu de partir par e-mail.

| Commande              | Rôle                                                     |
| --------------------- | -------------------------------------------------------- |
| `npm run check`       | types, lint, mise en forme et tests (ce que lance la CI) |
| `npm test`            | tests seuls ; `npm run test:watch` pour les relancer     |
| `npm run format`      | met en forme avec Prettier                               |
| `npm run build`       | site dans `dist/`, serveur dans `dist-server/`           |
| `npm start`           | serveur en ligne (`DATABASE_URL`, `BREVO_API_KEY`)       |
| `npm run start:local` | le build avec une base en mémoire, codes dans la console |
| `npm run export`      | archives CNC des trois formes dans `out/`                |
| `npm run check:dxf`   | export puis vérification des DXF avec ezdxf              |

## Mise en ligne

Railway construit et lance le service d'après `railway.json` : `npm run build` (le site dans `dist/`, le serveur dans `dist-server/`), puis `npm start`, avec `/api/sante` pour contrôle. Le serveur sert le site (compressé, `assets/` gardés un an, le reste revalidé) et `/api` sur la même adresse. Three.js est chargé à part, après le calcul et le plan.

À régler dans Railway : un service Postgres dans le même projet, le service web et Postgres dans la région EU West (Amsterdam), et sur le service web les variables `DATABASE_URL` (référence au Postgres) et `BREVO_API_KEY`. Le schéma se crée et se met à jour au démarrage (`server/db.ts`).

E-mails : Brevo, depuis `connexion@quart-de-tour.fr`. Le domaine est authentifié dans Brevo ; chez Gandi, les quatre enregistrements que Brevo indique (code de vérification, DKIM `brevo1._domainkey` et `brevo2._domainkey`, DMARC). Le SPF de Gandi Mail reste tel quel : Brevo ne le demande pas.

Quart de tour s'installe comme une application (manifeste `public/manifest.json`, icônes dans `public/icons/`) et fonctionne sans réseau : au build, `dist/sw.js` reçoit la liste des fichiers à garder en cache. Les mises à jour sont silencieuses : la nouvelle version s'installe en arrière-plan et la page se recharge quand elle n'est pas affichée. Le service worker n'est enregistré qu'en production ; pour l'essayer en local, `npm run build` puis `npm run start:local`.

## Export sans navigateur

```bash
npm run export -- quart-g --out out
```

Avec un projet enregistré depuis la page (« Mes projets », puis « Enregistrer ce projet en fichier .escalier ») ; les anciens fichiers `.limon` se lisent aussi :

```bash
npm run export -- --params projet.escalier
```

`--params` accepte aussi un JSON de réglages seuls, avec les mêmes clés que la page.

## Vérifier les DXF

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
```

```bash
npm run check:dxf
```

Les tests comparent déjà les DXF, la fiche et la notice aux fichiers de `tests/__snapshots__`, octet par octet. Si un changement de géométrie est voulu, régénérer ces fichiers avec `npx vitest run -u`, les vérifier avec ezdxf, et relire le diff.
