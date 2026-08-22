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
  seriesId: number | null
  seriesName: string | null
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
  seriesId: number | null
}>

export interface Series {
  id: number
  name: string
}

export type AiRole = 'user' | 'assistant'

// Conventions typographiques cibles pour l'harmonisation de mise en forme
// (Task 6) — définies ici (plutôt que dans main/ai/formatContext.ts, qui les
// consommait seul jusqu'ici) car le renderer doit désormais construire la
// même forme pour l'appel IPC ai.startFormat ; formatContext.ts réexporte ce
// type pour ne pas casser ses imports existants.
export interface FormatConventions {
  dialogue: 'guillemets' | 'tirets' // « … » vs — cadratins
  listes: 'tirets' | 'puces'
  // Task 6b : si vrai, le prompt d'harmonisation peut en plus PROPOSER des
  // séparateurs de scène/page manquants (jamais en retirer ni déplacer).
  proposerSeparations: boolean
}

// Suggestion de relecture (Task 2, plan 3c) — un tableau de ces objets est la
// SEULE forme de sortie attendue de l'IA pour ai.startReview (voir le system
// prompt dans main/ai/reviewContext.ts). `quote` est la clé de repérage côté
// renderer (Task 3) : un extrait qui ne correspond pas mot pour mot au texte
// du chapitre est inexploitable et doit être écarté à l'affichage.
export interface ReviewSuggestion {
  type: 'repetition' | 'incoherence' | 'style' | 'orthographe'
  quote: string // extrait EXACT du chapitre (repérage)
  replacement: string // texte de remplacement proposé ('' = suppression)
  reason: string // explication courte en français
}

// Proposition d'extraction de fiches (Task 4, plan 3c) — LA forme de sortie
// attendue de l'IA pour ai.startExtract (voir le system prompt dans
// main/ai/extractContext.ts) : un objet unique, jamais un tableau.
// `creations` : nouveaux personnages/lieux détectés dans le chapitre, absents
// du catalogue existant (ni le nom ni un alias ne correspond, insensible à la
// casse, à une entité déjà connue). `enrichissements` : compléments à des
// fiches EXISTANTES — `entityId` doit être un id réellement fourni au modèle,
// un id inventé ou inconnu est à écarter côté consommateur (Task 5, renderer).
// `aliases`/`description`/`notes` y sont des AJOUTS, jamais une réécriture du
// contenu déjà présent sur la fiche.
export interface ExtractProposal {
  creations: { kind: EntityKind; name: string; aliases: string[]; description: string }[]
  enrichissements: { entityId: number; aliases?: string[]; description?: string; notes?: string }[]
}

export interface AiSessionRecord {
  id: number
  bookId: number
  chapterId: number | null
  task: string
  model: string
  createdAt: string
}

export interface Snapshot {
  id: number
  chapterId: number
  reason: string
  createdAt: string
}

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
