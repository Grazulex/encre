import { contextBridge, ipcRenderer } from 'electron'
import type { EncreApi } from '../shared/ipc-contract'

const api: EncreApi = {
  books: {
    list: () => ipcRenderer.invoke('books:list'),
    get: (id) => ipcRenderer.invoke('books:get', id),
    create: (input) => ipcRenderer.invoke('books:create', input),
    update: (id, patch) => ipcRenderer.invoke('books:update', id, patch),
    remove: (id) => ipcRenderer.invoke('books:remove', id)
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
    remove: (id) => ipcRenderer.invoke('chapters:remove', id)
  }
}

contextBridge.exposeInMainWorld('encre', api)
