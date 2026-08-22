import type { BookStatus, ChapterStatus } from './types'

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  brouillon: 'Brouillon',
  premier_jet: 'Premier jet',
  relu: 'Relu',
  final: 'Final'
}
export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  en_cours: 'En cours',
  termine: 'Terminé',
  archive: 'Archivé'
}
