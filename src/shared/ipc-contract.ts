import type {
  Book, BookCreate, BookPatch, Chapter, ChapterMeta, ChapterStatus,
  Entity, EntityCreate, EntityKind, EntityOccurrence, EntityPatch,
  OutlineNote, TimelineEvent, TimelineEventPatch
} from './types'

export interface EncreApi {
  books: {
    list(): Promise<Book[]>
    get(id: number): Promise<Book>
    create(input: BookCreate): Promise<Book>
    update(id: number, patch: BookPatch): Promise<Book>
    remove(id: number): Promise<void>
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
  app: {
    onFlushRequest(cb: () => void): void   // ipcRenderer.on('app:request-flush', cb) — hors invoke
    flushDone(): void                       // ipcRenderer.send('app:flush-done')
  }
}

// Canaux IPC : `${domaine}:${méthode}` — ex. 'books:list', 'chapters:saveContent'
// `app` n'est pas un domaine invoke (événementiel pur) — non enregistré par registerIpc.
export const API_DOMAINS = ['books', 'chapters', 'entities', 'outline', 'timeline'] as const
