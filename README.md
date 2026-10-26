# Limon

Calcul et dessin d'escaliers en bois pour menuisiers, sur le web : escalier droit et quart tournant (gauche ou droite), 3D, contrôle de l'échappée et export CNC en DXF.

## Ce que fait l'outil

- **Calcul** : nombre de hauteurs automatique (Blondel 2h + g ≈ 630 mm), ligne de foulée, balancement des marches dans le quart tournant.
- **Trémie et échappée** : contrôle de la hauteur libre sous le plancher (alerte sous 2 000 mm, erreur sous 1 900 mm) et trémie minimale.
- **Plan et 3D** : plan coté en SVG, vue 3D Three.js avec limons, poteau, marches et contremarches.
- **Export CNC** : zip contenant `marches.dxf`, `limons.dxf`, `contremarches.dxf` (si l'escalier en a), la fiche des marches en CSV et une notice.
  - Nez arrondi et jeu d'assemblage réglables ; le limon de jour du quart tournant a sa propre hauteur, proposée d'après ses logements.
  - DXF R12 en millimètres.
  - Calques `DECOUPE` (contours), `DEFONCE` (logements), `CM_DESSUS` et `CM_DESSOUS` (traits des contremarches), `TEXTE`.

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

## Export sans navigateur

```bash
npm run export -- quart-g --out out
```

Avec des réglages enregistrés (mêmes clés que la page, par exemple copiées depuis `localStorage["limon-v2"]`) :

```bash
npm run export -- --params reglages.json
```

## Vérifier les DXF

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
```

```bash
npm run check:dxf
```

Les tests comparent déjà les DXF, la fiche et la notice aux fichiers de `tests/__snapshots__`, octet par octet. Si un changement de géométrie est voulu, régénérer ces fichiers avec `npx vitest run -u`, les vérifier avec ezdxf, et relire le diff.
