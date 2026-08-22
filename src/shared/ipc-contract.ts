import type {
  Book, BookCreate, BookPatch, Chapter, ChapterMeta, ChapterStatus
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
  }
}

// Canaux IPC : `${domaine}:${méthode}` — ex. 'books:list', 'chapters:saveContent'
export const API_DOMAINS = ['books', 'chapters'] as const
