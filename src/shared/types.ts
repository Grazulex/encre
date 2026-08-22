export type BookStatus = 'en_cours' | 'termine' | 'archive'
export type ChapterStatus = 'brouillon' | 'premier_jet' | 'relu' | 'final'

export interface Book {
  id: number
  title: string
  author: string
  genre: string
  language: string
  synopsis: string
  status: BookStatus
  coverPath: string | null
  wordGoal: number | null
  wordCount: number      // somme des chapitres (calculée)
  chapterCount: number   // calculé
  createdAt: string
  updatedAt: string
}

export interface BookCreate {
  title: string
  author?: string
  genre?: string
  language?: string
  synopsis?: string
  wordGoal?: number | null
}

export type BookPatch = Partial<{
  title: string
  author: string
  genre: string
  language: string
  synopsis: string
  status: BookStatus
  coverPath: string | null
  wordGoal: number | null
}>

export interface ChapterMeta {
  id: number
  bookId: number
  position: number
  title: string
  status: ChapterStatus
  wordCount: number
  updatedAt: string
}

export interface Chapter extends ChapterMeta {
  contentJson: string
  contentText: string
}
