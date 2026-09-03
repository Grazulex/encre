# encre

Atelier d'écriture de romans : chapitres, univers (personnages, lieux, chronologie), maquette et export EPUB/PDF. Application de bureau Electron (macOS, Windows, Linux).

## Installation

```bash
npm install        # rebuild better-sqlite3 pour Electron
```

## Utilisation

```bash
npm run dev        # développement (rechargement à chaud)
npm run start      # prévisualisation du build courant
npm run build      # typecheck + bundle de production
```

## Fonctionnalités

- **Bibliothèque** : livres, séries, couvertures et médias par livre
- **Éditeur TipTap** : chapitres, mentions `@personnage`/`@lieu`, illustrations (pleine page ou vignette), sauts de scène et de page, objectif en mots
- **Univers** : fiches personnages et lieux, occurrences dans les chapitres, chronologie liée
- **Plan** : notes d'outline par chapitre et réorganisation
- **IA Claude** : continuer un chapitre, reformater, relire, extraire les entités, vérifier la chronologie, suggestions
- **Export** : Markdown, EPUB, PDF (Création/maquette aux formats broché/édition) — en interface ou en ligne de commande
- **Snapshots** : points de retour par chapitre
- **Sauvegarde** : locale quotidienne + dépôt git distant
- **Import** : dossier de fichiers Markdown → nouveau livre

## Export en ligne de commande

Sans ouvrir la fenêtre :

```bash
Encre --export --livre 37 --sortie /dossier        # un livre
Encre --export --tous --sortie /dossier            # tous les livres
```

Chaque livre écrit un PDF et un EPUB dans le dossier de sortie. Un argument mal formé ou un livre en échec donne un code de sortie non nul.

## Tests

```bash
npm test           # 533 tests ; rebuilde better-sqlite3 pour Node puis Electron à la suite
```

## Livraison

```bash
npm run build:mac      # ou build:win / build:linux (electron-builder)
```