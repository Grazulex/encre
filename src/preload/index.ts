import { contextBridge, ipcRenderer } from 'electron'
import type { EncreApi } from '../shared/ipc-contract'

const api: EncreApi = {
  books: {
    list: () => ipcRenderer.invoke('books:list'),
    get: (id) => ipcRenderer.invoke('books:get', id),
    create: (input) => ipcRenderer.invoke('books:create', input),
    update: (id, patch) => ipcRenderer.invoke('books:update', id, patch),
    remove: (id) => ipcRenderer.invoke('books:remove', id),
    pickCover: (id) => ipcRenderer.invoke('books:pickCover', id)
  },
  chapters: {
    listByBook: (bookId) => ipcRenderer.invoke('chapters:listByBook', bookId),
    get: (id) => ipcRenderer.invoke('chapters:get', id),
    create: (bookId, title) => ipcRenderer.invoke('chapters:create', bookId, title),
    saveContent: (id, contentJson, contentText) =>
      ipcRenderer.invoke('chapters:saveContent', id, contentJson, contentText),
    rename: (id, title) => ipcRenderer.invoke('chapters:rename', id, title),
    setStatus: (id, status) => ipcRenderer.invoke('chapters:setStatus', id, status),
    reorder: (bookId, orderedIds) => ipcRenderer.invoke('chapters:reorder', bookId, orderedIds),
    remove: (id) => ipcRenderer.invoke('chapters:remove', id),
    saveSummary: (id, summary) => ipcRenderer.invoke('chapters:saveSummary', id, summary)
  },
  entities: {
    listByBook: (bookId, kind) => ipcRenderer.invoke('entities:listByBook', bookId, kind),
    get: (id) => ipcRenderer.invoke('entities:get', id),
    create: (input) => ipcRenderer.invoke('entities:create', input),
    update: (id, patch) => ipcRenderer.invoke('entities:update', id, patch),
    remove: (id) => ipcRenderer.invoke('entities:remove', id),
    occurrences: (id) => ipcRenderer.invoke('entities:occurrences', id),
    inChapter: (chapterId) => ipcRenderer.invoke('entities:inChapter', chapterId),
    pickImage: (id) => ipcRenderer.invoke('entities:pickImage', id)
  },
  outline: {
    listByBook: (bookId) => ipcRenderer.invoke('outline:listByBook', bookId),
    create: (bookId, chapterId) => ipcRenderer.invoke('outline:create', bookId, chapterId),
    update: (id, content) => ipcRenderer.invoke('outline:update', id, content),
    reorder: (bookId, chapterId, orderedIds) =>
      ipcRenderer.invoke('outline:reorder', bookId, chapterId, orderedIds),
    remove: (id) => ipcRenderer.invoke('outline:remove', id)
  },
  timeline: {
    listByBook: (bookId) => ipcRenderer.invoke('timeline:listByBook', bookId),
    create: (bookId, title) => ipcRenderer.invoke('timeline:create', bookId, title),
    update: (id, patch) => ipcRenderer.invoke('timeline:update', id, patch),
    setLinks: (id, chapterIds, entityIds) =>
      ipcRenderer.invoke('timeline:setLinks', id, chapterIds, entityIds),
    reorder: (bookId, orderedIds) => ipcRenderer.invoke('timeline:reorder', bookId, orderedIds),
    remove: (id) => ipcRenderer.invoke('timeline:remove', id)
  },
  importer: {
    scanFolder: () => ipcRenderer.invoke('importer:scanFolder'),
    importBook: (folder, orderedFiles, bookTitle) =>
      ipcRenderer.invoke('importer:importBook', folder, orderedFiles, bookTitle),
    importChapter: (bookId) => ipcRenderer.invoke('importer:importChapter', bookId)
  },
  exporter: {
    markdown: (bookId) => ipcRenderer.invoke('exporter:markdown', bookId),
    epub: (bookId, chapterIds) => ipcRenderer.invoke('exporter:epub', bookId, chapterIds),
    pdf: (bookId, chapterIds) => ipcRenderer.invoke('exporter:pdf', bookId, chapterIds)
  },
  app: {
    onFlushRequest: (cb) => {
      ipcRenderer.on('app:request-flush', () => cb())
    },
    flushDone: () => {
      ipcRenderer.send('app:flush-done')
    }
  },
  ai: {
    prepareWrite: (chapterId, entityIds) => ipcRenderer.invoke('ai:prepareWrite', chapterId, entityIds),
    startWrite: (chapterId, options) => ipcRenderer.invoke('ai:startWrite', chapterId, options),
    cancel: (requestId) => ipcRenderer.invoke('ai:cancel', requestId),
    onChunk: (cb) => {
      ipcRenderer.on('ai:chunk', (_event, payload) => cb(payload))
    },
    onDone: (cb) => {
      ipcRenderer.on('ai:done', (_event, payload) => cb(payload))
    },
    onError: (cb) => {
      ipcRenderer.on('ai:error', (_event, payload) => cb(payload))
    }
  },
  snapshots: {
    listByChapter: (chapterId) => ipcRenderer.invoke('snapshots:listByChapter', chapterId),
    create: (chapterId, contentJson, reason) =>
      ipcRenderer.invoke('snapshots:create', chapterId, contentJson, reason),
    content: (id) => ipcRenderer.invoke('snapshots:content', id)
  }
}

contextBridge.exposeInMainWorld('encre', api)
