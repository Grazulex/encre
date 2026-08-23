# Import de quatre livres dans Encre — design

Date : 2026-08-23
Statut : validé (design approuvé en session ; images de fiches avec échantillon
de validation avant la série complète).

## Objectif

Faire entrer dans Encre quatre livres qui vivent aujourd'hui uniquement comme
dossiers de fichiers : `RÉPUTÉ CONFORME`, `RÉPUTÉ COUPABLE`, `RÉPUTÉ PROTÉGÉ`
(terminés) et `LE TESTAMENT DES ÉTOILES / Tome-01-LA-FORCE` (en cours) — avec
leurs chapitres, leur couverture, leurs métadonnées, et, là où la matière
existe, leurs personnages, lieux et chronologie. Puis mettre en page et exporter
les trois livres terminés, comme les six déjà traités.

## Nature du travail

Aucun code produit n'est écrit. Encre possède déjà tout ce qui est nécessaire
(livres, chapitres, entités, mentions, chronologie, séries, maquette PDF) et
`atelier` possède déjà son moteur Draw Things
(`atelier.images.drawthings.MoteurDrawThings`). Ce document décrit une
**correspondance de données** et les scripts jetables qui l'appliquent.

## 1. Ce que chaque livre apporte

| | CONFORME | COUPABLE | PROTÉGÉ | TESTAMENT T1 |
|---|---|---|---|---|
| Nature | roman | essai | essai | roman (saga) |
| Chapitres | 26 | 14 | 14 | 11 sur 45 prévus |
| `livre.toml` | oui | oui | oui | **absent** |
| Parties | 4 Actes (`[parties]`) | — | — | `partie` en front matter |
| Enseigne des chapitres | `CHAPITRE n` | `PROCÈS n` | `CLAUSE n` | `CHAPITRE n` |
| Série | — | Réputé(e) #3 | Réputé(e) #2 | Testament, tome 1 |
| Couverture | `Couverture/couverture-ebook.jpg` (1650×2550) | idem | idem | idem |
| Personnages / lieux | `Familles/` en prose | — | — | listes en front matter |
| Statut des chapitres | figé | figé | figé | v1 (brouillon) |

## 2. Correspondance vers le modèle d'Encre

**Livre** — `books` : `title` = `titre` du toml (nom du dossier pour le
Testament), `author`, `language`, `genre` = `sous_titre`, `page_format` =
`format_page` (défaut `broche` quand le champ est absent, comme `atelier`),
`status` = `termine` pour les trois Réputé, `en_cours` pour le Testament.
`series_id` via la table `series` : « Réputé(e) » pour COUPABLE et PROTÉGÉ,
« LE TESTAMENT DES ÉTOILES » pour le Testament ; CONFORME reste hors série.

**Couverture** — le fichier `Couverture/couverture-ebook.jpg` est copié dans
`userData/media` sous `book-{id}-{horodatage}.jpg` et `cover_path` pointe
dessus : exactement ce que fait `books.pickCover`, dont seul le dialogue de
sélection n'est pas scriptable.

**Chapitres** — `chapters`, dans l'ordre de la liste `chapitres` du toml (ordre
alphabétique des fichiers pour le Testament, qui n'a pas de toml). Le corps
markdown est converti par la même fonction que l'import existant
(`mdToTiptapJson` de `src/main/importer.ts`), front matter YAML retiré et titre
H1 retiré. `title` = le titre lisible du chapitre, `status` = `final` pour les
chapitres `figé`, `brouillon` pour les `v1`.

**Personnages et lieux** — `entities` (`kind` = `character` | `place`) :
- Testament : union des listes `personnages` et `lieux` du front matter de ses
  onze chapitres ; la description vient des sections correspondantes de
  `00-BIBLE-DE-LA-SAGA.md`.
- CONFORME : extraits des six fiches `Familles/*.md`. **La liste extraite est
  soumise à l'auteur avant écriture** — nom, famille, rôle, âge — parce qu'elle
  est déduite de prose, pas lue dans un champ.
- Les deux essais n'ont pas de matière d'univers : aucune fiche.

**Mentions** — `mentions` (chapitre × entité) pour le Testament, d'après les
listes de front matter de chaque chapitre. Les trois Réputé ont des listes
vides : aucune mention.

**Chronologie** — `timeline_events` pour le seul Testament : un événement par
chapitre, `title` = titre du chapitre, `date_label` = `date_recit`,
`description` = `moment`, lié au chapitre et à ses entités.

## 3. Maquette et export

Les trois livres terminés reçoivent le même traitement que les six déjà faits :
chapitre « Liminaires » en tête (page de titre, colophon du toml, sommaire —
aucun n'a de dédicace), pages de partie pour les quatre Actes de CONFORME,
ouverture par chapitre avec l'enseigne du tableau ci-dessus, puis export PDF
`<TITRE> — encre.pdf` dans le dossier du livre, à côté du PDF de référence qui
n'est jamais écrasé.

Le Testament ne reçoit ni liminaires, ni sommaire, ni ouvertures, ni export :
onze chapitres brouillon sur quarante-cinq ne sont pas un livre à composer. Il
entre comme espace de travail.

## 4. Images de fiches

Aucune n'existe pour CONFORME ni pour le Testament. Le motif maison, tiré de
`L'ENVERS/Univers/`, est reproduit : une fiche `.md` par entité dans
`Univers/Personnages/` ou `Univers/Lieux/`, portant une section
`## Prompt d'illustration` (prompt en anglais, en bloc de code), et l'image
générée à côté au format **1024 × 1024**. Ces images sont des **références de
travail** — la barre est « utile pour cadrer un personnage », pas « œuvre
finie », comme le rappelle la note des fiches de L'ENVERS.

Génération par `MoteurDrawThings.generer(planche, dossier, taille=(1024, 1024))`
— le moteur d'`atelier`, donc les mêmes réglages que la chaîne de l'auteur.
L'image est ensuite copiée dans `userData/media` et rattachée à l'entité par
`image_path`, comme le fait `entities.pickImage`.

**La charte visuelle diffère par livre** et n'est pas celle de L'ENVERS :
CONFORME est un roman réaliste contemporain sur des familles de plusieurs pays,
le Testament un space opera. Chaque livre reçoit donc sa propre charte, écrite
en tête de son dossier `Univers/`.

**Procédure en deux temps** : trois ou quatre images d'échantillon par livre,
validées par l'auteur, avant de lancer la série complète (une cinquantaine
d'images au total, environ une heure de génération).

## 5. Gestion d'erreurs et réversibilité

- La base est sauvegardée avant chaque écriture (`library.db` copiée, horodatée).
- Chaque script est **idempotent** : un livre déjà importé (titre déjà présent)
  est ignoré, un chapitre déjà porteur d'une ouverture n'est pas retraité.
- Les scripts tournent en **simulation par défaut** ; l'écriture demande
  `--apply`.
- Rien n'est écrit dans les dossiers de livres hormis les nouveaux fichiers
  nommés dans ce document (fiches d'univers, images, PDF `— encre.pdf`).
- La traduction néerlandaise de CONFORME (`NL/`) est hors périmètre.

## 6. Vérification

- Comptes de chapitres, d'entités, de mentions et d'événements comparés aux
  sources après import.
- Pour les trois PDF produits : sommaire recoupé entrée par entrée avec les
  pages réelles, ouvertures toutes en recto, comparaison au PDF de référence du
  dossier — la même vérification que pour les six livres précédents.
