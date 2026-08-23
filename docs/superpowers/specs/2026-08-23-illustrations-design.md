# Illustrations de livre — design

Date : 2026-08-23
Statut : validé (design approuvé en session, options « stockage copie media »,
« nœud au curseur », « exports EPUB+PDF inclus », « sans légende » retenues).

## Objectif

Permettre, au niveau d'un livre, de constituer une liste d'illustrations
(les « planches » — cf. la série L'ENVERS, dossiers `Illustrations/` des
tomes) et de les insérer dans le texte des chapitres, avec sortie dans les
exports Markdown, EPUB et PDF.

## Périmètre

Inclus :
- Bibliothèque d'illustrations par livre (ajout par dialogue, renommage,
  suppression, liste ordonnée).
- Nœud d'éditeur « illustration » inséré à la position du curseur.
- Rendu dans les trois exports existants.

Exclus (itérations futures possibles) :
- Import automatique des `[[illustrations]]` d'un `livre.toml`.
- Légendes sous les images.
- Redimensionnement / alignement dans l'éditeur.
- Placement « avant/après chapitre » hors du flux du texte (le nœud en tête
  ou fin de chapitre couvre le besoin).

## 1. Stockage & base de données

Les fichiers image (png/jpg/jpeg/webp — les extensions déjà connues
d'`epub.ts`) sont **copiés** dans `userData/media`, même mécanique et même
dossier que `books.pickCover` / `entities.pickImage`, sous un nom unique
`ill-{bookId}-{horodatage}-{n}{ext}`. Le livre reste autonome : pas de lien
vers le dossier source.

Nouvelle migration (entrée ajoutée à `MIGRATIONS` dans
`src/main/db/migrations.ts`) :

```sql
CREATE TABLE illustrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,        -- nom dans userData/media (unique)
  display_name TEXT NOT NULL,     -- nom lisible, initialisé au nom source
  position INTEGER NOT NULL,      -- ordre dans la liste du livre
  created_at TEXT NOT NULL
);
```

Nouveau module `src/main/db/illustrations.ts` (+ tests), sur le modèle
d'`entities.ts` : `listByBook`, `create`, `rename`, `remove`,
avec `position` attribuée en fin de liste à la création.

À la suppression d'un livre, la cascade supprime les lignes ; les fichiers
media orphelins ne sont pas nettoyés (comportement identique aux couvertures
aujourd'hui — pas de nettoyage rétroactif dans cette itération).

## 2. Contrat IPC

Dans `src/shared/types.ts` :

```ts
export interface Illustration {
  id: number
  bookId: number
  fileName: string
  displayName: string
  position: number
  createdAt: string
}
```

Dans `src/shared/ipc-contract.ts` + `src/main/api.ts` + preload :

```ts
illustrations: {
  listByBook(bookId: number): Promise<Illustration[]>
  add(bookId: number): Promise<Illustration[]>       // showOpenDialog multiSelections ; copie chaque fichier dans media ; [] si annulé
  rename(id: number, displayName: string): Promise<Illustration>
  remove(id: number): Promise<void>                  // supprime ligne + fichier media
  usage(id: number): Promise<number>                 // nb de chapitres du livre dont contentJson référence file_name
}
```

`usage` sert la confirmation de suppression côté UI (« Utilisée dans N
chapitre(s) ») : recherche du `file_name` dans les `contentJson` des
chapitres du livre (LIKE SQL suffit, les noms générés sont uniques et sans
métacaractères). La suppression reste possible : les nœuds restants
affichent alors l'état « image manquante » (voir §3).

## 3. Nœud d'éditeur

Nouveau nœud TipTap `illustration` dans `src/renderer/src/editor/`
(fichier dédié, sur le modèle de `formatNodes.ts`) :

- bloc **atomique**, sélectionnable/supprimable comme `pageBreak` ;
- attrs `{ fileName: string, displayName: string }` (le `displayName` est
  figé à l'insertion — sert d'`alt` et de libellé d'export ; un renommage
  ultérieur dans la bibliothèque ne réécrit pas les nœuds déjà insérés) ;
- rendu éditeur : `<img src="encre-media://{fileName}" alt="{displayName}">`
  pleine largeur du bloc de texte ; si le fichier a été supprimé de la
  bibliothèque, l'`onerror` natif de l'image laisse un cadre « illustration
  manquante » stylé en CSS (pas de NodeView) ;
- commande `insertIllustration({ fileName, displayName })` insérant le nœud
  à la position du curseur ;
- enregistré dans les extensions d'`EditorPane.vue`.

Le nœud ne contribue pas au `contentText` (comptage de mots inchangé).
Les snapshots stockent le JSON tel quel — restauration sans traitement.

L'importeur Markdown (`importer.ts`) n'est pas étendu : une image Markdown
importée reste du texte, comme aujourd'hui.

## 4. UI — panneau Illustrations

Dans la section « chapitres » de `BookView` : un bouton « Illustrations »
dans la barre de l'éditeur ouvre un panneau (même famille visuelle que les
panneaux existants) qui est LA liste au niveau livre :

- vignettes (`encre-media://`) avec `display_name`, dans l'ordre `position` ;
- « Ajouter… » → `illustrations.add` (multi-sélection) ;
- clic / bouton « Insérer » → `insertIllustration` au curseur du chapitre
  courant (désactivé si aucun chapitre ouvert) ;
- renommage inline (`rename`) ;
- suppression avec `ConfirmDialog`, message enrichi par `usage(id)`.

Pas de réordonnancement par glisser-déposer dans cette itération (l'ordre
d'ajout suffit ; `position` est en base pour l'ajouter plus tard sans
migration).

## 5. Exports

`src/shared/export.ts` — le sérialiseur accepte un résolveur d'URL image
optionnel ; le nœud `illustration` devient :

- Markdown : `![{displayName}](Illustrations/{fileName})` ;
- XHTML : `<img src="{resolveur(fileName)}" alt="{displayName}"/>` dans un
  bloc pleine page (classe `.illustration`).

Consommateurs :

- **Markdown** (`exporter.ts`) : copie chaque fichier référencé dans un
  sous-dossier `Illustrations/` à côté des `NN-titre.md` ;
- **EPUB** (`epub.ts`) : chaque fichier référencé entre dans l'archive
  (`Images/{fileName}`) avec entrée de manifest et media-type (table
  d'extensions déjà en place) ; résolveur → chemin relatif depuis le XHTML
  du chapitre ;
- **PDF** (`pdf.ts`) : la fenêtre cachée charge une `data:` URL — les
  images sont inlinées en **data-URI base64** par le résolveur ; CSS
  pleine page (l'image occupe sa propre page, `page-break` avant/après,
  cohérent avec l'usage « planche » de L'ENVERS).

Un nœud dont le fichier media a disparu est **omis** des trois exports
(pas de lien mort dans un EPUB/PDF publié) ; l'export continue.

## 6. Gestion d'erreurs

- Dialogue d'ajout annulé → `[]`, aucun effet.
- Fichier source illisible pendant `add` → l'ajout de CE fichier échoue,
  les autres continuent ; l'IPC renvoie les réussites (l'UI peut signaler
  l'écart entre sélection et résultat).
- Extension non supportée filtrée par le dialogue (`filters`).
- `remove` d'un fichier déjà absent sur disque : la ligne est supprimée
  quand même (pas d'erreur pour un orphelin).

## 7. Tests (TDD)

- `db/illustrations.test.ts` : CRUD, ordre `position`, cascade livre.
- Test migration (modèle `migration3.test.ts`) : la table existe après
  migration sur une base ancienne.
- `api.test.ts` : `add` avec dialogue mocké (copie + lignes créées, annulation,
  fichier illisible), `remove` (fichier supprimé, orphelin toléré), `usage`.
- `shared/export.test.ts` : nœud → Markdown / XHTML avec résolveur,
  nœud au fichier manquant omis.
- `epub.test.ts` : archive contenant l'image + manifest.
- Smoke existant : la migration ne casse rien.
