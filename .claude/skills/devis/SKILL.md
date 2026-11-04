---
name: devis
description: Devis, tarifs et fiche de l'entreprise, quantités, calcul en centimes, onglet Devis, remise au client, numéro, PDF du devis.
---

# Devis

En préparation (cahier des charges : https://claude.ai/artifact/9a4Pgq2CeteosuJHoo737R). Visible seulement sur l'appareil ouvert une fois avec `?devis` (préférence `limon-devis`, `?devis=0` pour masquer), éléments `[data-devis]`.

## Tarifs et entreprise

`Tarifs`, `Entreprise` dans `src/core/tarifs.ts`, `TarifsPanel` dans `src/ui/tarifs.ts`. Font partie du profil de l'atelier : montants HT, un tarif vide reste `null` (jamais de prix inventé). Colonnes `tarifs` et `entreprise` de la table `ateliers`, gardées quand une version d'avant les devis envoie son profil sans elles.

## Calcul

Pur : `quantites(R, cnc)` puis `devis(Q, tarifs, saisie)`.

- `quantites` (`src/cnc/quantites.ts`) part des pièces de la liste de débit ; finition sur deux faces de chaque pièce, chants non comptés.
- `devis` (`src/core/devis.ts`) travaille en centimes entiers : chaque ligne arrondie, totaux faits des lignes, remise répartie sur les taux de TVA.
- Une ligne sans tarif a un total `null` et nomme ce qui manque (`aCompleter`).
- Fourniture sans pose à 20 %.
- Façon en une ligne d'heures totales par défaut (`faconDetail` pour le détail par poste).

## Onglet Devis

`DevisView`, `src/ui/devis.ts`, section `#devisView`. Bouton de l'en-tête sur grand écran, cinquième onglet sur téléphone, tous deux `body[data-tab="devis"]` (classe `Tabs`) ; absent en pas à pas.

Un seul devis par escalier, `Project.devis` (`DevisProjet` : client et `Saisie`), enregistré dans le projet et le fichier `.escalier`. Seules la saisie et les corrections sont gardées, les lignes se recalculent (`buildCNC` seulement quand l'onglet est à l'écran). Une correction égale au calcul s'efface.

## Remise au client (lot 4)

- `DevisProjet.remis` garde chaque version remise, figée (`DevisRemis` : réglages, tarifs, entreprise, client, saisie et `Devis` chiffré), pour refaire le même PDF.
- `versionRemise(d, params)` dit si la dernière tient lieu de devis en cours, sinon (jamais remis, `rouvert`, escalier changé) c'est un brouillon de la version suivante.
- Accepté ou refusé enregistré (`noterReponse`), expiré lu à la date (`etatRemis`, validité des tarifs).
- Numéro donné par le serveur à la remise (`POST /api/devis/numero`, table `devis_numeros`), le même pour toutes les versions d'un escalier, suite par compte et par année (2026-0012). Un premier numéro demande que l'escalier soit dans le compte, sinon 409 dit à l'écran : `numero` (`src/main.ts`) lance d'abord un échange, pour celui fait hors ligne. Remettre demande un compte et le réseau, le brouillon marche hors ligne.
- Poids : 50 versions (`MAX_VERSIONS`) et 1 Mo (`MAX_OCTETS`) par escalier. Une version pèse 4 ko pour un devis courant, 23 ko avec 30 lignes libres, 110 ko remplie jusqu'aux bornes. `bloquants` arrête la remise avant, en gardant `MARGE_OCTETS` pour reprendre le devis ensuite : aucune version n'est jamais effacée. La suite se fait sur un nouvel escalier, « Dupliquer » gardant les versions.
- Session perdue : l'onglet ne montre qu'un message et « Me connecter », le devis et le client restant cachés jusqu'à la reconnexion (`clientsCaches`, voir `serveur-compte`).
- Bloquants (`bloquants`) et mentions manquantes (`mentionsManquantes`, simple avertissement).
- Acompte vide par défaut.

## PDF du devis

`devisPDF` (`src/pdf/devis.ts`) : en-tête de l'entreprise, client et chantier, lignes, totaux, mentions (TVA réduite seulement avec une ligne sous 20 %, à faire relire avant la mise en ligne), « bon pour accord », annexe plan et vue 3D (vue de côté sans 3D) ; filigrane sur le brouillon ; référence `tests/__snapshots__/devis.pdf`.
