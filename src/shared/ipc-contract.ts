import type {
  Book, BookCreate, BookPatch, Chapter, ChapterMeta, ChapterStatus,
  Entity, EntityCreate, EntityKind, EntityOccurrence, EntityPatch,
  OutlineNote, Snapshot, TimelineEvent, TimelineEventPatch
} from './types'

export interface EncreApi {
  books: {
    list(): Promise<Book[]>
    get(id: number): Promise<Book>
    create(input: BookCreate): Promise<Book>
    update(id: number, patch: BookPatch): Promise<Book>
    remove(id: number): Promise<void>
    pickCover(id: number): Promise<Book>
  }
  chapters: {
    listByBook(bookId: number): Promise<ChapterMeta[]>
    get(id: number): Promise<Chapter>
    create(bookId: number, title: string): Promise<ChapterMeta>
    saveContent(id: number, contentJson: string, contentText: string): Promise<{ wordCount: number }>
    rename(id: number, title: string): Promise<void>
    setStatus(id: number, status: ChapterStatus): Promise<void>
    reorder(bookId: number, orderedIds: number[]): Promise<void>
    remove(id: number): Promise<void>
    saveSummary(id: number, summary: string): Promise<void>
  }
  entities: {
    listByBook(bookId: number, kind?: EntityKind): Promise<Entity[]>
    get(id: number): Promise<Entity>
    create(input: EntityCreate): Promise<Entity>
    update(id: number, patch: EntityPatch): Promise<Entity>
    remove(id: number): Promise<void>
    occurrences(id: number): Promise<EntityOccurrence[]>
    inChapter(chapterId: number): Promise<Entity[]>
    pickImage(id: number): Promise<Entity>
  }
  outline: {
    listByBook(bookId: number): Promise<OutlineNote[]>
    create(bookId: number, chapterId: number | null): Promise<OutlineNote>
    update(id: number, content: string): Promise<void>
    reorder(bookId: number, chapterId: number | null, orderedIds: number[]): Promise<void>
    remove(id: number): Promise<void>
  }
  timeline: {
    listByBook(bookId: number): Promise<TimelineEvent[]>
    create(bookId: number, title: string): Promise<TimelineEvent>
    update(id: number, patch: TimelineEventPatch): Promise<TimelineEvent>
    setLinks(id: number, chapterIds: number[], entityIds: number[]): Promise<TimelineEvent>
    reorder(bookId: number, orderedIds: number[]): Promise<void>
    remove(id: number): Promise<void>
  }
  importer: {
    scanFolder(): Promise<{ folder: string; files: { file: string; title: string }[] } | null>  // showOpenDialog (dossier) + scanChapterFiles ; null si annulé
    importBook(folder: string, orderedFiles: string[], bookTitle: string): Promise<Book>       // création livre + chapitres dans l'ordre donné
    importChapter(bookId: number): Promise<ChapterMeta | null>                                 // showOpenDialog (fichier .md) ; ajoute un chapitre au livre existant ; null si annulé
  }
  exporter: {
    markdown(bookId: number): Promise<string | null>                     // showOpenDialog (dossier cible) ; écrit NN-titre.md par chapitre ; retourne le dossier ; null si annulé
    epub(bookId: number, chapterIds: number[]): Promise<string | null>   // showSaveDialog ; construit un .epub (OPF/NCX/XHTML) à partir des chapitres sélectionnés
    pdf(bookId: number, chapterIds: number[]): Promise<string | null>    // showSaveDialog ; fenêtre cachée + printToPDF (A5)
  }
  app: {
    onFlushRequest(cb: () => void): void   // ipcRenderer.on('app:request-flush', cb) — hors invoke
    flushDone(): void                       // ipcRenderer.send('app:flush-done')
  }
  ai: {
    prepareWrite(chapterId: number, entityIds?: number[]): Promise<{ hasSummary: boolean; defaultEntityIds: number[] }>
    startWrite(chapterId: number, options: { instructions?: string; entityIds?: number[]; model: string; continueFromText: boolean }): Promise<string>  // requestId ; enregistre ai_session + messages
    cancel(requestId: string): Promise<void>
    onChunk(cb: (p: { requestId: string; text: string }) => void): void   // ipcRenderer.on('ai:chunk') — hors invoke
    onDone(cb: (p: { requestId: string; text: string }) => void): void    // 'ai:done' (texte complet) — hors invoke
    onError(cb: (p: { requestId: string; message: string }) => void): void // 'ai:error' — hors invoke
  }
  snapshots: {
    listByChapter(chapterId: number): Promise<Snapshot[]>
    create(chapterId: number, contentJson: string, reason: string): Promise<Snapshot>
    content(id: number): Promise<string>
  }
}

// Canaux IPC : `${domaine}:${méthode}` — ex. 'books:list', 'chapters:saveContent'
// `app` n'est pas un domaine invoke (événementiel pur) — non enregistré par registerIpc.
// `ai` mêle les deux : prepareWrite/startWrite/cancel sont des invoke normaux,
// mais onChunk/onDone/onError sont préload-only (ipcRenderer.on), comme `app`.
export const API_DOMAINS = [
  'books', 'chapters', 'entities', 'outline', 'timeline', 'importer', 'exporter', 'ai', 'snapshots'
] as const
