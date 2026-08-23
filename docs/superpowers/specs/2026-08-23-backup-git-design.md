# Sauvegarde git hors machine — design

Date : 2026-08-23
Statut : validé (design approuvé en session, options « tout dans encre_backup »,
« diff = ce qui a changé depuis la dernière sauvegarde », « clé de déploiement
dédiée », « rythme quotidien », « restauration documentée » et « bloc accueil +
voyant barre d'état » retenues).

## Objectif

Sauvegarder la bibliothèque (base + médias) hors de la machine, vers le dépôt
privé `git@github.com:Grazulex/encre_backup.git`, sans geste de l'utilisateur —
et rendre l'état de cette sauvegarde visible dans l'app : quand a eu lieu la
dernière, et ce qui a changé depuis.

## Périmètre

Inclus :
- Miroir git de `library.db` (en dump SQL) et de `userData/media` dans
  `userData/backup-repo`, commité et poussé automatiquement.
- Rythme quotidien, greffé sur la mécanique existante de `backup.ts`, plus un
  déclenchement manuel.
- Bloc d'état sur la Bibliothèque, voyant compact dans la barre d'état.
- Procédure de restauration écrite et vérifiée.

Exclus (itérations futures possibles) :
- Restauration depuis l'app (fonction la plus dangereuse de l'app : elle écrase
  les données vivantes ; la procédure manuelle couvre le besoin réel).
- Configuration de la sauvegarde depuis l'app (génération de clé, choix du
  dépôt) : bootstrap manuel, une fois pour toutes.
- Purge des médias supprimés dans l'app — voir §1, c'est un choix délibéré.
- Chiffrement du dépôt (il est privé ; le sujet se poserait si on visait un
  hébergeur tiers).

## Mesures qui fondent le design

Prises sur la bibliothèque réelle (12 livres, 234 chapitres, 279 médias) :

| Mesure | Résultat |
| --- | --- |
| `sqlite3 library.db .dump` | 10 Mo de texte, 0,04 s |
| Aller-retour dump → base reconstruite | identique (mêmes comptes, `sum(length(content_json))` au même octet) |
| 10 sauvegardes quotidiennes simulées (2 000 mots × 3 chapitres/jour) | `.git` de 1 984 Ko à 2 000 Ko, soit **~1,6 Ko par sauvegarde** |
| Médias | 710 Mo, 279 fichiers, le plus gros 7,9 Mo (limite GitHub : 100 Mo/fichier) |

Conclusion : versionner la base en dump SQL est quasi gratuit — dix ans de
sauvegardes quotidiennes tiendraient dans ~7 Mo. Tout le poids du dépôt vient
des médias, et une seule fois.

Le format binaire `.db` a été écarté sur ces chiffres : SQLite déplace ses pages
à chaque écriture, git ne peut pas le deltaifier, chaque sauvegarde coûterait
~11 Mo — environ 4 Go par an.

## 1. Contenu du dépôt

```
library.sql       le dump, régénéré à chaque sauvegarde
manifest.json     l'état au moment de la sauvegarde (sert au diff)
media/            les images, ajoutées, jamais retirées
RESTAURATION.md   la procédure
```

**Le dump n'est pas pris sur la base vivante.** `backupDatabase()`
(`db.backup()`, l'API de sauvegarde à chaud de SQLite, déjà utilisée pour le
backup local quotidien) produit `backups/library-<horodatage>.db` ; c'est ce
fichier figé qui est dumpé. Consistance garantie, aucune contention avec
l'écriture en cours, et la partie délicate réutilise du code déjà éprouvé.

Chaque sauvegarde distante déclenche **son propre** `backupDatabase()` plutôt
que de réutiliser le fichier de la veille — voir §2, étape 1.

**Les médias ne sont jamais supprimés du dépôt**, même quand une image est
effacée dans l'app. Délibéré : une sauvegarde qui réplique les suppressions ne
protège pas d'une suppression accidentelle. Conséquence assumée :
`manifest.counts.media` (état vivant) peut être inférieur au nombre de fichiers
dans `media/` (cumul historique).

La copie se fait par clone APFS (`cp -c`) : la copie de travail ne coûte aucun
octet supplémentaire. Le coût disque réel est celui des objets git, ~710 Mo une
fois.

## 2. Séquence d'une sauvegarde

Asynchrone, jamais bloquante pour l'UI ni pour la fermeture de l'app, protégée
par un verrou anti-concurrence (un `runNow()` pendant une sauvegarde en cours
est rejeté, pas mis en file).

1. `backupDatabase()` — un instantané **frais**, pris à cet instant, jamais le
   fichier de la veille (sinon un « Sauvegarder maintenant » enverrait l'état
   d'hier en prétendant le contraire) → dump de ce fichier vers `library.sql`
2. Clone APFS des médias absents du dépôt
3. Écriture du `manifest.json`
4. `git add -A` puis commit
5. `git push`

Message de commit généré depuis le diff :
`sauvegarde 2026-08-23 22:15 — 3 chapitres, +1 240 mots`

**Les commandes sont désarmées de la configuration globale.** Chaque invocation
porte ses `-c` : `commit.gpgsign=false` (la config globale a `commit.gpgsign =
true`, ce qui ferait surgir un pinentry en pleine session d'écriture, ou
échouer silencieusement), plus `user.name=Encre` et
`user.email=jms@grazulex.be`, pour ne dépendre d'aucun réglage global
susceptible de changer. L'auteur des commits est donc identifiable comme
l'app, pas comme une session humaine.

## 3. Authentification

Clé ed25519 **sans passphrase** dans `userData/backup-key`, enregistrée comme
deploy key en écriture sur `encre_backup` uniquement.

```
GIT_SSH_COMMAND="ssh -i <clé> -o IdentitiesOnly=yes -o BatchMode=yes \
                 -o StrictHostKeyChecking=accept-new"
```

Pourquoi pas la clé de l'utilisateur : elle est servie par gpg-agent
(`~/.gnupg/S.gpg-agent.ssh`) et `SSH_AUTH_SOCK` n'est exporté que par le shell.
Une app lancée depuis le Finder ne l'a pas — le push échouerait sans que rien ne
l'explique.

`BatchMode=yes` est essentiel : une app graphique ne doit jamais se bloquer sur
une invite invisible. Elle échoue franchement, et l'erreur remonte dans l'UI.

Compromis accepté : une clé privée sans passphrase sur le disque. Sa portée est
limitée à ce seul dépôt et elle est révocable en un clic depuis GitHub.

## 4. Gestion d'erreurs

- **Push qui traîne** : les commandes git tournent en `spawn` asynchrone, jamais
  en `spawnSync` — un `spawnSync` gèlerait le process main, donc toute l'UI,
  le temps d'un aller-retour réseau. Le push porte en plus un délai de garde de
  120 s, pour qu'un réseau qui pend ne laisse pas l'état bloqué sur
  « sauvegarde en cours » indéfiniment.
- **Push échoué** (réseau absent, GitHub injoignable) : le commit local a déjà
  réussi. L'état distingue donc `lastCommitAt` et `lastPushAt` — le travail est
  figé localement et partira à la prochaine occasion. C'est une demi-victoire
  qu'il serait trompeur d'afficher comme un échec.
- **Binaires externes** : `/usr/bin/git` et `/usr/bin/sqlite3`, tous deux
  présents dans le `PATH` minimal d'une app lancée depuis le Finder (vérifié).
  Contrôle d'existence au démarrage, message explicite dans l'UI si l'un manque.
- **Sauvegarde non configurée** (clé ou dépôt absents) : l'UI le dit et renvoie
  à la procédure, aucune tentative silencieuse.
- **Dump en échec** : rien n'est commité, l'erreur est enregistrée. Le dépôt
  reste sur son dernier état cohérent.

## 5. Le manifeste et le diff

```json
{
  "version": 1,
  "generatedAt": "2026-08-23T20:15:00.000Z",
  "counts": { "books": 12, "chapters": 234, "entities": 248,
              "illustrations": 14, "media": 279 },
  "books": [1, 2, 3],
  "media": ["entity-12-1787410607875.png", "ill-3-1787…-0.png"],
  "chapters": [
    { "id": 12, "bookId": 3, "title": "La maison basse",
      "words": 2481, "hash": "b1946ac9…" }
  ]
}
```

`books` et `media` listent des **identités**, pas des compteurs. Une
différence de compteurs donnerait un résultat faux dès qu'un ajout et une
suppression surviennent entre deux sauvegardes : 3 images ajoutées et 3
supprimées afficheraient « 0 image ajoutée », alors qu'il y a bien trois
fichiers neufs à sauvegarder. Coût : ~8 Ko de noms de fichiers.

Le `hash` (SHA-1 du `content_json`) n'est pas redondant avec `words` : une
réécriture à nombre de mots constant serait invisible sans lui — et c'est
précisément le travail qu'on ne veut pas perdre. Le `title` y figure pour
pouvoir nommer un chapitre **supprimé** depuis, qui n'existe plus dans la base
vivante. Poids ~24 Ko, qui se delta-compresse comme le reste.

`diffManifests(prev, next)` est une fonction **pure**, sans dépendance à git, à
la base ni à Electron :

```ts
interface BackupDiff {
  chaptersChanged: number
  chaptersAdded: number
  chaptersRemoved: number
  wordsDelta: number
  mediaAdded: number
  booksAdded: number
  changedTitles: string[]   // tronqué à 5, pour l'affichage
}
```

`prev === null` (première sauvegarde) : tout est compté comme ajouté.

**Deux diffs distincts, et c'est volontaire :**

- **En attente** — manifeste du dépôt vs état actuel de la base, calculé à la
  demande. Répond à « qu'est-ce que je risque de perdre maintenant ».
- **Dernière sauvegarde** — ce que le dernier commit a emporté, mémorisé dans
  l'état. Répond à « qu'est-ce qui est parti ».

Le premier coûte une requête sur 234 chapitres et un SHA-1 sur 5 Mo, soit
quelques millisecondes : rafraîchissable toutes les minutes sans effet
perceptible.

## 6. État persisté

`userData/backup-state.json` : `lastCommitAt`, `lastPushAt`, `lastError`,
`lastDiff`. Hors du dépôt délibérément — un échec de push doit rester lisible
même si le dépôt est en mauvais état.

## 7. Contrat IPC

Domaine `backup` ajouté à `EncreApi`. `registerIpc` enregistre automatiquement
tout domaine de `createApi` : aucune plomberie au-delà du contrat.

```ts
backup: {
  status(): Promise<BackupStatus>   // état + les deux diffs ; ne touche jamais au réseau
  runNow(): Promise<BackupStatus>   // force une sauvegarde ; rejette si déjà en cours
}
```

```ts
interface BackupStatus {
  configured: boolean
  running: boolean
  lastCommitAt: string | null
  lastPushAt: string | null
  lastError: string | null
  pending: BackupDiff
  lastDiff: BackupDiff | null
}
```

`status()` lit l'état sur disque et calcule le diff en attente, sans réseau :
l'UI reste vive hors ligne. Seuls `runNow()` et le déclencheur quotidien
parlent à GitHub.

## 8. Déclenchement

Greffé sur la mécanique existante de `backup.ts` : vérification au démarrage
puis toutes les 6 h, une sauvegarde par tranche de 24 h. Le backup local
quotidien reste inchangé et devient l'étape 1 de la sauvegarde distante.

Plus un déclenchement manuel par le bouton « Sauvegarder maintenant ».

## 9. UI

**Bloc sur la Bibliothèque** (`BackupPanel.vue`) :

> **Sauvegardé aujourd'hui à 18h12** · dernière sauvegarde : 4 chapitres, +2 100 mots
> **En attente** : 3 chapitres modifiés, +1 240 mots, 2 images
> [ Sauvegarder maintenant ]

États dégradés traités explicitement : jamais sauvegardé, sauvegarde en cours,
commité localement mais pas encore poussé (avec la raison), non configuré,
binaire manquant.

**Voyant dans la barre d'état** — à côté de l'état d'enregistrement existant,
même vocabulaire visuel (pastille + texte court) : « Sauvegardé » ou
« 3 chapitres en attente ». Cliquable, ramène à la Bibliothèque.

**Store `stores/backup.ts`** : porte l'état pour les deux vues, rafraîchi toutes
les 60 s. Un seul store, pas de duplication.

## 10. Organisation du code

`src/main/backup.ts` devient `src/main/backup/local.ts`, rejoint par :

- `git.ts` — les commandes git (spawn, environnement, erreurs)
- `manifest.ts` — construction et comparaison, fonctions pures
- `sync.ts` — l'orchestration de la séquence §2

Suit les dossiers `db/`, `ai/`, `pdf/` existants, et donne un seul endroit pour
tout ce qui touche à la sauvegarde.

## 11. Tests (TDD)

Aucun test ne touche au réseau.

- `backup/manifest.test.ts` — `diffManifests` en isolation : rien n'a changé ;
  chapitre réécrit à nombre de mots constant (le cas pour lequel le hash
  existe) ; chapitre ajouté ; supprimé ; première sauvegarde (`prev === null`) ;
  images ajoutées ; troncature de `changedTitles`. Plus `buildManifest` sur une
  base en mémoire, comme les tests existants.
- `backup/git.test.ts` — les commandes réelles contre un **dépôt nu dans un
  dossier temporaire** : vrai git, vrai clone, vrai commit, vrai push, zéro
  réseau. Vérifie aussi que la signature GPG est bien désarmée.
- `backup/sync.test.ts` — l'orchestration complète contre un faux `userData` et
  ce même remote local : séquence nominale, médias clonés une seule fois,
  manifeste écrit, état mis à jour. Chemin d'échec : remote pointé dans le vide
  → le push échoue, le commit tient, `lastCommitAt` avance et `lastPushAt` non.
- `backup/local.test.ts` — l'existant, déplacé.

## 12. Restauration

`RESTAURATION.md` à la racine du dépôt — l'endroit où on la trouve le jour où la
machine ne démarre plus. Trois temps : cloner le dépôt, reconstruire la base
(`sqlite3 library.db < library.sql`), recopier `media/` dans le `userData` de
l'app.

Vérifiée de bout en bout sur une copie avant livraison : l'aller-retour dump →
base a déjà été testé (mêmes comptes, même volume de contenu), la procédure
complète le sera dans les mêmes termes.

## 13. Bootstrap (manuel, une fois)

Fait depuis le terminal, hors de l'app, pour que celle-ci n'ait jamais à
affronter un premier push de 710 Mo — elle ne poussera que des deltas de
quelques kilo-octets.

1. Générer la clé ed25519 dans `userData/backup-key`.
2. L'enregistrer comme deploy key en écriture sur `encre_backup`, via `gh`
   (accord donné en session).
3. Premier commit et push des 710 Mo.
