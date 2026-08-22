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
import { scanChapterFiles, mdToTiptapJson, titleForFile } from './importer'
import { exportMarkdownToFolder, slugify } from './exporter'
import { buildEpub } from './epub'
import { buildPdf } from './pdf'

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
export function createApi(db: Db): Omit<EncreApi, 'app'> {
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
    }
  }
}
