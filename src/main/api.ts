import { copyFileSync, mkdirSync, unlinkSync, readFileSync, writeFileSync } from 'fs'
import { join, extname, dirname } from 'path'
import type { Db } from './db/connection'
import type { EncreApi } from '../shared/ipc-contract'
import type { ChapterMeta } from '../shared/types'
import * as books from './db/books'
import * as chapters from './db/chapters'
import * as entities from './db/entities'
import * as outline from './db/outline'
import * as timeline from './db/timeline'
import * as snapshots from './db/snapshots'
import * as series from './db/series'
import { createAiSession, addAiMessage } from './db/aiSessions'
import { buildWritePrompt } from './ai/context'
import { buildFormatPrompt } from './ai/formatContext'
import { buildReviewPrompt } from './ai/reviewContext'
import type { FormatConventions } from '../shared/types'
import { AiService, type AiRunner } from './ai/service'
import { createSdkRunner } from './ai/runner'
import { scanChapterFiles, mdToTiptapJson, titleForFile } from './importer'
import { exportMarkdownToFolder, slugify } from './exporter'
import { buildEpub } from './epub'
import { buildPdf } from './pdf'

/**
 * Émetteur d'événements par défaut : diffuse vers toutes les fenêtres ouvertes.
 * Import d'electron paresseux (à l'intérieur de la fonction) pour que ce module
 * reste importable par vitest sans jamais charger electron au niveau module —
 * les tests injectent toujours leur propre `emit`.
 *
 * Isolation par fenêtre : une fenêtre déjà détruite/en cours de fermeture (le
 * process de rendu peut disparaître entre `getAllWindows()` et l'itération, ou
 * pendant qu'une génération streame) ferait lever `send` sur son
 * `webContents` — sans garde, une seule fenêtre fermée interromprait la
 * diffusion vers toutes les autres. On filtre `isDestroyed()` et on isole
 * chaque `send` dans son propre try/catch. Le `.catch` final couvre l'import
 * paresseux lui-même (sinon un rejet de la chaîne — electron indisponible,
 * erreur inattendue — resterait une rejection non gérée, `emit` n'étant pas
 * awaité par ses appelants).
 */
function defaultEmit(channel: string, payload: unknown): void {
  import('electron')
    .then(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue
        try {
          win.webContents.send(channel, payload)
        } catch (error) {
          console.error(`defaultEmit: échec d'envoi sur une fenêtre (${channel})`, error)
        }
      }
    })
    .catch((error: unknown) => {
      console.error(`defaultEmit: échec de diffusion (${channel})`, error)
    })
}

// Modèle fixe pour ai.startFormat (Task 6) : la harmonisation de mise en forme
// est une tâche de pure typographie (pas de créativité requise), le renderer
// n'a donc pas de sélecteur de modèle pour cette action — contrairement à
// startWrite. 'sonnet' suffit et reste le plus rapide des trois alias déjà
// utilisés côté écriture (voir stores/ai.ts, AiModel).
const FORMAT_MODEL = 'sonnet'

export interface CreateApiOptions {
  runner?: AiRunner
  emitAiEvent?: (channel: string, payload: unknown) => void
}

// `ai` mélange invoke (prepareWrite/startWrite/cancel) et événementiel préload-only
// (onChunk/onDone/onError, ajoutés par le preload via ipcRenderer.on — voir `app`
// ci-dessous pour le même principe). createApi ne peut fournir que la partie invoke.
type MainAi = Omit<EncreApi['ai'], 'onChunk' | 'onDone' | 'onError'>

// Import d'un fichier .md isolé comme nouveau chapitre d'un livre existant
// (Task 8b) : lecture disque + conversion markdown→tiptap + createChapter +
// saveChapterContent dans un seul db.transaction synchrone, même logique
// transactionnelle qu'importer.importBook ci-dessous. Exportée séparément de
// l'API (plutôt qu'inlinée dans importer.importChapter) pour être testable
// sans passer par le dialog Electron.
export function importChapterFromFile(db: Db, bookId: number, filePath: string): ChapterMeta {
  const md = readFileSync(filePath, 'utf8')
  const title = titleForFile(filePath, md)
  const { contentJson, contentText } = mdToTiptapJson(md)
  const run = db.transaction(() => {
    const chapter = chapters.createChapter(db, bookId, title)
    chapters.saveChapterContent(db, chapter.id, contentJson, contentText)
    return chapter.id
  })
  const chapterId = run()
  return chapters.getChapter(db, chapterId)
}

// `app` (onFlushRequest/flushDone) est un domaine événementiel côté renderer
// (ipcRenderer.on/send) : il n'a pas de contrepartie invoke côté main, donc
// createApi n'implémente pas EncreApi['app'] — registerIpc ignore ce domaine.
// `ai` : createApi ne fournit que la part invoke (MainAi, voir plus haut) ; les
// on* restent préload-only, comme pour `app`.
export function createApi(db: Db, options: CreateApiOptions = {}): Omit<EncreApi, 'app' | 'ai'> & { ai: MainAi } {
  const baseRunner = options.runner ?? createSdkRunner()
  const emit = options.emitAiEvent ?? defaultEmit
  // AiService.start() appelle runner.run(...) de façon synchrone (avant de retourner
  // le requestId) : si le runner invoque `onChunk` de façon synchrone lui aussi (cas
  // d'un runner factice sans `await`, mais aussi tout runner exotique en pratique),
  // `onChunk` peut s'exécuter AVANT que `requestId = service.start(...)` (plus bas)
  // n'ait affecté la variable que les callbacks capturent par fermeture. On reporte
  // donc l'appel réel au runner d'un micro-tick pour garantir que `service.start()`
  // a toujours rendu la main (et donc que requestId est déjà connu) avant la première
  // invocation d'un callback — `createSdkRunner` a de toute façon un `await` avant
  // tout `onChunk`, donc ce report est sans effet perceptible en production.
  const runner: AiRunner = {
    run: (params, onChunk, signal) => Promise.resolve().then(() => baseRunner.run(params, onChunk, signal))
  }
  const service = new AiService(runner)

  return {
    books: {
      list: async () => books.listBooks(db),
      get: async (id) => books.getBook(db, id),
      create: async (input) => books.createBook(db, input),
      update: async (id, patch) => books.updateBook(db, id, patch),
      remove: async (id) => books.deleteBook(db, id),
      // Même mécanique que entities.pickImage ci-dessous : dialog, copie dans
      // media/, mise à jour de la colonne (ici cover_path), retour de l'objet
      // complet. Fichier nommé par id + horodatage
      // (book-<id>-<timestamp>.<ext>) : remplacer une couverture par une autre
      // image de même extension doit produire un chemin différent, sinon le
      // <img src> du renderer ne change pas et l'ancienne image reste affichée
      // (le navigateur ne revalide pas une URL identique). L'ancien fichier
      // (s'il vit bien dans media/, pas un chemin arbitraire) est supprimé
      // après la copie pour ne pas accumuler les couvertures remplacées.
      pickCover: async (id) => {
        const { app, dialog } = await import('electron')
        const res = await dialog.showOpenDialog({
          title: 'Choisir une couverture',
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          properties: ['openFile']
        })
        if (res.canceled || res.filePaths.length === 0) return books.getBook(db, id)
        const mediaDir = join(app.getPath('userData'), 'media')
        mkdirSync(mediaDir, { recursive: true })
        const previous = books.getBook(db, id)
        const dest = join(mediaDir, `book-${id}-${Date.now()}${extname(res.filePaths[0])}`)
        copyFileSync(res.filePaths[0], dest)
        const updated = books.updateBook(db, id, { coverPath: dest })
        if (previous.coverPath && dirname(previous.coverPath) === mediaDir) {
          try {
            unlinkSync(previous.coverPath)
          } catch {
            // Fichier déjà absent (déplacé/supprimé hors de l'app) : sans
            // conséquence, la nouvelle couverture est déjà en place.
          }
        }
        return updated
      }
    },
    chapters: {
      listByBook: async (bookId) => chapters.listChapters(db, bookId),
      get: async (id) => chapters.getChapter(db, id),
      create: async (bookId, title) => chapters.createChapter(db, bookId, title),
      saveContent: async (id, json, text) => chapters.saveChapterContent(db, id, json, text),
      rename: async (id, title) => chapters.renameChapter(db, id, title),
      setStatus: async (id, status) => chapters.setChapterStatus(db, id, status),
      reorder: async (bookId, ids) => chapters.reorderChapters(db, bookId, ids),
      remove: async (id) => chapters.deleteChapter(db, id),
      saveSummary: async (id, summary) => chapters.saveChapterSummary(db, id, summary)
    },
    entities: {
      listByBook: async (bookId, kind) => entities.listEntities(db, bookId, kind),
      get: async (id) => entities.getEntity(db, id),
      create: async (input) => entities.createEntity(db, input),
      update: async (id, patch) => entities.updateEntity(db, id, patch),
      remove: async (id) => entities.deleteEntity(db, id),
      occurrences: async (id) => chapters.entityOccurrences(db, id),
      inChapter: async (chapterId) => chapters.entitiesInChapter(db, chapterId),
      // Fichier nommé par id + horodatage (voir books.pickCover ci-dessus pour
      // le pourquoi : remplacer par une image de même extension doit changer
      // le chemin, sinon le <img src> du renderer ne se rafraîchit pas).
      pickImage: async (id) => {
        const { app, dialog } = await import('electron')
        const res = await dialog.showOpenDialog({
          title: 'Choisir une image',
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          properties: ['openFile']
        })
        if (res.canceled || res.filePaths.length === 0) return entities.getEntity(db, id)
        const mediaDir = join(app.getPath('userData'), 'media')
        mkdirSync(mediaDir, { recursive: true })
        const previous = entities.getEntity(db, id)
        const dest = join(mediaDir, `entity-${id}-${Date.now()}${extname(res.filePaths[0])}`)
        copyFileSync(res.filePaths[0], dest)
        const updated = entities.updateEntity(db, id, { imagePath: dest })
        if (previous.imagePath && dirname(previous.imagePath) === mediaDir) {
          try {
            unlinkSync(previous.imagePath)
          } catch {
            // Fichier déjà absent (déplacé/supprimé hors de l'app) : sans
            // conséquence, la nouvelle image est déjà en place.
          }
        }
        return updated
      }
    },
    outline: {
      listByBook: async (bookId) => outline.listOutline(db, bookId),
      create: async (bookId, chapterId) => outline.createOutlineNote(db, bookId, chapterId),
      update: async (id, content) => outline.updateOutlineNote(db, id, content),
      reorder: async (bookId, chapterId, orderedIds) =>
        outline.reorderOutline(db, bookId, chapterId, orderedIds),
      remove: async (id) => outline.deleteOutlineNote(db, id)
    },
    timeline: {
      listByBook: async (bookId) => timeline.listTimeline(db, bookId),
      create: async (bookId, title) => timeline.createTimelineEvent(db, bookId, title),
      update: async (id, patch) => timeline.updateTimelineEvent(db, id, patch),
      setLinks: async (id, chapterIds, entityIds) =>
        timeline.setTimelineLinks(db, id, chapterIds, entityIds),
      reorder: async (bookId, orderedIds) => timeline.reorderTimeline(db, bookId, orderedIds),
      remove: async (id) => timeline.deleteTimelineEvent(db, id)
    },
    importer: {
      scanFolder: async () => {
        const { dialog } = await import('electron')
        const res = await dialog.showOpenDialog({
          title: 'Choisir un dossier à importer',
          properties: ['openDirectory']
        })
        if (res.canceled || res.filePaths.length === 0) return null
        const folder = res.filePaths[0]
        return { folder, files: scanChapterFiles(folder) }
      },
      // Transactionnel : createBook + (createChapter + saveChapterContent) par
      // fichier ordonné, y compris la lecture disque et la conversion
      // markdown→tiptap, tournent dans un seul db.transaction synchrone — une
      // erreur sur un fichier (lecture, parsing) annule tout, aucun livre ni
      // chapitre à moitié importé ne reste en base.
      importBook: async (folder, orderedFiles, bookTitle) => {
        const titles = new Map(scanChapterFiles(folder).map((f) => [f.file, f.title]))
        const run = db.transaction(() => {
          const book = books.createBook(db, { title: bookTitle })
          for (const file of orderedFiles) {
            const title = titles.get(file) ?? file
            const md = readFileSync(join(folder, file), 'utf8')
            const { contentJson, contentText } = mdToTiptapJson(md)
            const chapter = chapters.createChapter(db, book.id, title)
            chapters.saveChapterContent(db, chapter.id, contentJson, contentText)
          }
          return book.id
        })
        const bookId = run()
        return books.getBook(db, bookId)
      },
      // Import d'un seul fichier .md comme nouveau chapitre d'un livre déjà
      // existant (Task 8b) — distinct d'importBook qui crée un livre entier.
      // Toute la logique testable vit dans importChapterFromFile ; cette
      // méthode ne fait que le dialog.
      importChapter: async (bookId) => {
        const { dialog } = await import('electron')
        const res = await dialog.showOpenDialog({
          title: 'Choisir un fichier Markdown à importer',
          filters: [{ name: 'Markdown', extensions: ['md'] }],
          properties: ['openFile']
        })
        if (res.canceled || res.filePaths.length === 0) return null
        return importChapterFromFile(db, bookId, res.filePaths[0])
      }
    },
    exporter: {
      markdown: async (bookId) => {
        const { dialog } = await import('electron')
        const res = await dialog.showOpenDialog({
          title: 'Choisir un dossier de destination',
          properties: ['openDirectory', 'createDirectory']
        })
        if (res.canceled || res.filePaths.length === 0) return null
        return exportMarkdownToFolder(db, bookId, res.filePaths[0])
      },
      epub: async (bookId, chapterIds) => {
        const { dialog } = await import('electron')
        const book = books.getBook(db, bookId)
        const res = await dialog.showSaveDialog({
          title: 'Exporter en EPUB',
          defaultPath: `${slugify(book.title)}.epub`,
          filters: [{ name: 'EPUB', extensions: ['epub'] }]
        })
        if (res.canceled || !res.filePath) return null
        const buffer = await buildEpub(db, bookId, chapterIds)
        writeFileSync(res.filePath, buffer)
        return res.filePath
      },
      pdf: async (bookId, chapterIds) => {
        const { dialog } = await import('electron')
        const book = books.getBook(db, bookId)
        const res = await dialog.showSaveDialog({
          title: 'Exporter en PDF',
          defaultPath: `${slugify(book.title)}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (res.canceled || !res.filePath) return null
        const buffer = await buildPdf(db, bookId, chapterIds)
        writeFileSync(res.filePath, buffer)
        return res.filePath
      }
    },
    ai: {
      // Chemin volontairement léger : réutilise buildWritePrompt (déjà bon
      // marché — pas d'appel réseau, uniquement des lectures SQLite) plutôt
      // qu'une fonction dédiée, pour ne pas dupliquer le calcul de
      // hasSummary/defaultEntityIds entre prepareWrite et startWrite.
      prepareWrite: async (chapterId, entityIds) => {
        const bundle = buildWritePrompt(db, chapterId, { entityIds })
        return { hasSummary: bundle.hasSummary, defaultEntityIds: bundle.defaultEntityIds }
      },
      // CONTRAT D'ORDONNANCEMENT (à l'attention du consommateur renderer, Task 6) :
      // le micro-tick de report ci-dessus (voir `runner`) garantit seulement que
      // `requestId` est connu de CE module avant tout callback — il ne garantit PAS
      // que la réponse de l'invoke `ai:startWrite` (qui porte ce requestId) arrive
      // au renderer avant le premier événement `ai:chunk`/`ai:done`/`ai:error`.
      // invoke (requête/réponse) et `webContents.send` (événement) sont deux
      // transports IPC indépendants ; seule la latence réseau/SDK rend l'ordre
      // « réponse avant premier chunk » vrai en pratique aujourd'hui, rien ne le
      // garantit structurellement. LE CONSOMMATEUR DOIT TAMPONNER LES ÉVÉNEMENTS
      // DONT LE requestId EST ENCORE INCONNU et les réconcilier une fois que
      // `startWrite()` résout (ne jamais supposer que l'invoke résout en premier).
      startWrite: async (chapterId, opts) => {
        const bundle = buildWritePrompt(db, chapterId, {
          instructions: opts.instructions,
          entityIds: opts.entityIds,
          continueFromText: opts.continueFromText
        })
        if (!bundle.hasSummary) {
          throw new Error(
            "Ce chapitre n'a pas de résumé : ajoutez-en un avant de générer du texte."
          )
        }
        const chapter = chapters.getChapter(db, chapterId)
        const sessionId = createAiSession(db, chapter.bookId, chapterId, 'write', opts.model)
        addAiMessage(db, sessionId, 'user', bundle.prompt)

        // Les callbacks ci-dessous ferment sur `requestId`, affecté seulement après le
        // retour (synchrone) de service.start() : c'est sans danger car `runner` (voir
        // plus haut) reporte l'appel réel au runner factice/SDK d'un micro-tick, donc
        // aucun callback ne peut s'exécuter avant que cette affectation n'ait eu lieu.
        let requestId = ''
        requestId = service.start(
          { system: bundle.system, prompt: bundle.prompt, model: opts.model },
          {
            onChunk: (text) => emit('ai:chunk', { requestId, text }),
            onDone: (full) => {
              // Livraison au renderer inconditionnelle : on émet AVANT d'archiver.
              // Si addAiMessage échoue (DB), le renderer a déjà reçu ai:done et
              // quitte 'streaming' — seul l'archivage en base est perdu (loggé),
              // jamais le texte affiché à l'écran.
              emit('ai:done', { requestId, text: full })
              try {
                addAiMessage(db, sessionId, 'assistant', full)
              } catch (err) {
                console.error('[ai.startWrite] échec addAiMessage (assistant) :', err)
              }
            },
            onError: (message) => emit('ai:error', { requestId, message })
          }
        )
        return requestId
      },
      // Harmonisation de mise en forme (Task 6) : même mécanique que startWrite
      // (AiService.start, mêmes canaux ai:chunk/ai:done/ai:error, même contrat
      // d'ordonnancement documenté ci-dessus), mais aucun choix de modèle exposé
      // au renderer pour cette tâche ciblée — modèle fixe, rapide, suffisant pour
      // une tâche de pure typographie (pas de créativité requise).
      startFormat: async (chapterId, conventions: FormatConventions) => {
        const chapter = chapters.getChapter(db, chapterId)
        if (!chapter.contentText.trim()) {
          throw new Error('Ce chapitre est vide : rien à harmoniser.')
        }
        const bundle = buildFormatPrompt(db, chapterId, conventions)
        const sessionId = createAiSession(db, chapter.bookId, chapterId, 'format', FORMAT_MODEL)
        addAiMessage(db, sessionId, 'user', bundle.prompt)

        let requestId = ''
        requestId = service.start(
          { system: bundle.system, prompt: bundle.prompt, model: FORMAT_MODEL },
          {
            onChunk: (text) => emit('ai:chunk', { requestId, text }),
            onDone: (full) => {
              emit('ai:done', { requestId, text: full })
              try {
                addAiMessage(db, sessionId, 'assistant', full)
              } catch (err) {
                console.error('[ai.startFormat] échec addAiMessage (assistant) :', err)
              }
            },
            onError: (message) => emit('ai:error', { requestId, message })
          }
        )
        return requestId
      },
      // Relecture (Task 2, plan 3c) : même mécanique que startWrite/startFormat
      // ci-dessus (AiService.start, mêmes canaux ai:chunk/ai:done/ai:error, même
      // contrat d'ordonnancement documenté plus haut), session enregistrée avec
      // task='review'. Modèle choisi par l'appelant (contrairement à startFormat) :
      // contrairement à la typographie, une relecture bénéficie du choix de modèle
      // comme l'écriture.
      startReview: async (chapterId, options) => {
        const chapter = chapters.getChapter(db, chapterId)
        if (!chapter.contentText.trim()) {
          throw new Error('Ce chapitre est vide : rien à relire.')
        }
        const bundle = buildReviewPrompt(db, chapterId)
        const sessionId = createAiSession(db, chapter.bookId, chapterId, 'review', options.model)
        addAiMessage(db, sessionId, 'user', bundle.prompt)

        let requestId = ''
        requestId = service.start(
          { system: bundle.system, prompt: bundle.prompt, model: options.model },
          {
            onChunk: (text) => emit('ai:chunk', { requestId, text }),
            onDone: (full) => {
              emit('ai:done', { requestId, text: full })
              try {
                addAiMessage(db, sessionId, 'assistant', full)
              } catch (err) {
                console.error('[ai.startReview] échec addAiMessage (assistant) :', err)
              }
            },
            onError: (message) => emit('ai:error', { requestId, message })
          }
        )
        return requestId
      },
      // Conversion pure (aucune écriture en base) : réutilise mdToTiptapJson,
      // déjà éprouvé par l'import de fichier — jamais de logique de conversion
      // dupliquée entre import et application d'une harmonisation.
      // `stripLeadingH1: false` (correctif review) : ce Markdown est le CORPS
      // d'un chapitre déjà existant (round-trip tiptapToMarkdown → Claude),
      // pas un fichier importé — un `# …` en tête est un vrai titre H1 écrit
      // par l'auteur dans le texte, jamais un titre de fichier à retirer. Voir
      // MdToTiptapJsonOptions dans importer.ts pour le détail de la régression
      // évitée (l'H1 aurait disparu à l'application sans jamais apparaître
      // manquant dans l'aperçu avant/après de FormatDialog).
      formatToJson: async (markdown) => mdToTiptapJson(markdown, { stripLeadingH1: false }),
      cancel: async (requestId) => {
        service.cancel(requestId)
      }
    },
    snapshots: {
      listByChapter: async (chapterId) => snapshots.listSnapshots(db, chapterId),
      create: async (chapterId, contentJson, reason) =>
        snapshots.createSnapshot(db, chapterId, contentJson, reason),
      content: async (id) => snapshots.getSnapshotContent(db, id),
      remove: async (id) => snapshots.deleteSnapshot(db, id)
    },
    series: {
      list: async () => series.listSeries(db),
      getOrCreate: async (name) => series.getOrCreateSeries(db, name),
      remove: async (id) => series.deleteSeries(db, id)
    }
  }
}
