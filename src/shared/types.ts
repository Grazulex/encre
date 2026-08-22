export type BookStatus = 'en_cours' | 'termine' | 'archive'
export type ChapterStatus = 'brouillon' | 'premier_jet' | 'relu' | 'final'
// Sections de navigation de l'espace livre (Task 8). Personnages/Lieux
// (Task 10), Chronologie (Task 14) et Plan (Task 13) sont des placeholders
// tant que ces tâches ne sont pas implémentées.
export type BookSection = 'chapitres' | 'personnages' | 'lieux' | 'chronologie' | 'plan'

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
  summary: string
}

export type EntityKind = 'character' | 'place'

export interface Entity {
  id: number
  bookId: number
  kind: EntityKind
  name: string
  aliases: string[]
  description: string
  attributes: Record<string, string>
  notes: string
  imagePath: string | null
  createdAt: string
  updatedAt: string
}

export interface EntityCreate {
  bookId: number
  kind: EntityKind
  name: string
}

export type EntityPatch = Partial<{
  name: string
  aliases: string[]
  description: string
  attributes: Record<string, string>
  notes: string
  imagePath: string | null
}>

export interface EntityOccurrence {
  chapterId: number
  chapterTitle: string
  chapterPosition: number
}

export interface OutlineNote {
  id: number
  bookId: number
  chapterId: number | null
  position: number
  content: string
  updatedAt: string
}

export interface TimelineEvent {
  id: number
  bookId: number
  position: number
  dateLabel: string
  title: string
  description: string
  chapterIds: number[]
  entityIds: number[]
  updatedAt: string
}

export type TimelineEventPatch = Partial<{
  dateLabel: string
  title: string
  description: string
}>
