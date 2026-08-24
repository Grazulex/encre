import type { BookMediaRole, BookSection, BookStatus, ChapterStatus } from './types'

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  brouillon: 'Brouillon',
  premier_jet: 'Premier jet',
  relu: 'Relu',
  final: 'Final'
}
export const BOOK_STATUS_LABELS: Record<BookStatus, string> = {
  reserve: 'Réservé',
  en_cours: 'En cours',
  termine: 'Terminé',
  archive: 'Archivé'
}
export const SECTION_LABELS: Record<BookSection, string> = {
  chapitres: 'Chapitres',
  personnages: 'Personnages',
  lieux: 'Lieux',
  chronologie: 'Chronologie',
  plan: 'Plan'
}

// Le rôle « couverture broché » est rangé mais n'entre JAMAIS dans le PDF
// exporté : la couverture d'un livre papier part séparément à l'imprimeur.
// Seul « couverture EPUB » est branché sur un export (cf. src/main/epub/index.ts).
export const BOOK_MEDIA_ROLE_LABELS: Record<BookMediaRole, string> = {
  'couverture-epub': 'Couverture EPUB',
  'couverture-broche': 'Couverture brochée',
  'couverture-relie': 'Couverture reliée',
  quatrieme: 'Quatrième de couverture',
  banniere: 'Bannière',
  vignette: 'Vignette',
  'portrait-auteur': "Portrait d'auteur",
  autre: 'Autre'
}
