# Limon

Calcul et dessin d'escaliers en bois pour menuisiers, sur le web : escalier droit et quart tournant (gauche ou droite), 3D, contrôle de l'échappée et export CNC en DXF.

## Ce que fait l'outil

- **Calcul** : nombre de hauteurs automatique (Blondel 2h + g ≈ 630 mm), ligne de foulée, balancement des marches dans le quart tournant.
- **Trémie et échappée** : contrôle de la hauteur libre sous le plancher (alerte sous 2 000 mm, erreur sous 1 900 mm) et trémie minimale.
- **Corrections chiffrées** : quand une règle n'est pas tenue, l'outil propose la valeur qui la rétablit (reculement ou longueur côté départ, marches balancées, hauteur de limon, trémie), applicable d'un clic.
- **Débit** : alerte quand une pièce dépasse les plateaux disponibles, volume brut et poids selon l'essence.
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

Puis ouvrir http://localhost:5173.

| Commande            | Rôle                                                     |
| ------------------- | -------------------------------------------------------- |
| `npm run check`     | types, lint, mise en forme et tests (ce que lance la CI) |
| `npm test`          | tests seuls ; `npm run test:watch` pour les relancer     |
| `npm run format`    | met en forme avec Prettier                               |
| `npm run build`     | site statique dans `dist/`                               |
| `npm run export`    | archives CNC des trois formes dans `out/`                |
| `npm run check:dxf` | export puis vérification des DXF avec ezdxf              |

## Mise en ligne

`npm run build` produit un site statique dans `dist/`, avec des chemins relatifs : il se sert depuis n'importe quel hébergement statique et n'importe quel sous-chemin. Three.js est chargé à part, après le calcul et le plan.

Limon s'installe comme une application (manifeste `public/manifest.json`, icônes dans `public/icons/`) et fonctionne sans réseau : au build, `dist/sw.js` reçoit la liste des fichiers à garder en cache. Les mises à jour sont silencieuses : la nouvelle version s'installe en arrière-plan et la page se recharge quand elle n'est pas affichée. Le service worker n'est enregistré qu'en production ; pour l'essayer en local, `npm run build` puis `npm run preview`.

## Export sans navigateur

```bash
npm run export -- quart-g --out out
```

Avec un projet enregistré depuis la page (« Mes projets », puis « Enregistrer ce projet en fichier .limon ») :

```bash
npm run export -- --params escalier.limon
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
