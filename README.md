# Limon

Calcul et dessin d'escaliers en bois pour menuisiers, sur le web : escalier droit et quart tournant (gauche ou droite), 3D, contrôle de l'échappée et export CNC en DXF.

Version en ligne (privée, partagée depuis claude.ai) : https://claude.ai/artifact/SqSCRq3So3XMmP7biAWy3Y

## Ce que fait l'outil

- **Calcul** : nombre de hauteurs automatique (Blondel 2h + g ≈ 630 mm), ligne de foulée, balancement des marches dans le quart tournant.
- **Trémie et échappée** : contrôle de la hauteur libre sous le plancher (alerte sous 2 000 mm, erreur sous 1 900 mm) et trémie minimale.
- **Plan et 3D** : plan coté en SVG, vue 3D Three.js avec limons, poteau, marches et contremarches.
- **Export CNC** : zip contenant `marches.dxf`, `contremarches.dxf` (si l'escalier en a), `limons.dxf`, la fiche des marches en CSV et une notice.
  - DXF R12 en millimètres.
  - Calques `DECOUPE` (contours), `DEFONCE` (logements), `CM_DESSUS` et `CM_DESSOUS` (traits des contremarches), `TEXTE`.

## Fichiers

- `limon.html` : toute l'application en un seul fichier. C'est la source de l'Artifact claude.ai : il n'a ni doctype ni `<head>`, la plateforme les ajoute à la publication.
- `tools/serve.py` : petit serveur local pour l'aperçu. `POST /save?name=…` écrit le corps de la requête dans le dossier de sortie, ce qui permet de récupérer les DXF générés par la page.
- `tools/check_dxf.py` : vérifie les DXF ou le zip avec ezdxf (erreurs, entités par calque, aperçu PNG en option).

## Aperçu local

```bash
mkdir -p preview out && { echo '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'; cat limon.html; echo '</body></html>'; } > preview/index.html
```

```bash
python3 tools/serve.py preview out
```

Puis ouvrir http://127.0.0.1:8765.

## Vérifier les DXF

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
```

```bash
.venv/bin/python tools/check_dxf.py out/escalier-quart-d-15h.zip
```
