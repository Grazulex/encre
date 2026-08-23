import type {
  BackupStatus, Book, BookCreate, BookPatch, Chapter, ChapterMeta, ChapterStatus,
  Entity, EntityCreate, EntityKind, EntityOccurrence, EntityPatch,
  FormatConventions, Illustration, OutlineNote, Series, Snapshot, TimelineEvent, TimelineEventPatch
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
  illustrations: {
    listByBook(bookId: number): Promise<Illustration[]>
    add(bookId: number): Promise<Illustration[]>       // showOpenDialog multiSelections ; [] si annulé
    rename(id: number, displayName: string): Promise<Illustration>
    remove(id: number): Promise<void>                  // supprime ligne + fichier media ; orphelin toléré
    usage(id: number): Promise<number>                 // nb de chapitres référençant le fichier
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
    // CONTRAT D'ORDONNANCEMENT : rien ne garantit que la résolution de cet invoke (qui
    // porte le requestId) arrive au renderer AVANT le premier événement ai:chunk/ai:done/
    // ai:error portant ce même requestId — invoke (requête/réponse) et webContents.send
    // (événement) sont deux transports IPC indépendants. Le consommateur DOIT tamponner
    // les événements dont le requestId est encore inconnu et les réconcilier une fois que
    // startWrite() résout (voir src/main/api.ts, commentaire au site d'appel).
    startWrite(chapterId: number, options: { instructions?: string; entityIds?: number[]; model: string; continueFromText: boolean }): Promise<string>  // requestId ; enregistre ai_session + messages
    // Harmonisation de mise en forme (Task 6) : même contrat d'ordonnancement que
    // startWrite ci-dessus (ai:chunk/ai:done/ai:error partagent les mêmes canaux,
    // tamponnage/réconciliation identiques côté renderer) ; session enregistrée avec
    // task='format'. Refuse (rejette) un chapitre dont le contenu texte est vide —
    // rien à harmoniser. Pas de choix de modèle exposé ici (contrairement à
    // startWrite) : le modèle utilisé pour cette tâche ciblée est fixé côté main.
    startFormat(chapterId: number, conventions: FormatConventions): Promise<string>  // requestId ; enregistre ai_session (task='format') + messages
    // Relecture (Task 2, plan 3c) : même contrat d'ordonnancement et mêmes canaux
    // ai:chunk/ai:done/ai:error que startWrite/startFormat ci-dessus ; session
    // enregistrée avec task='review'. La sortie attendue côté renderer (Task 3) est
    // un tableau JSON de ReviewSuggestion (voir src/shared/types.ts) — le parsing se
    // fait après ai:done, pas ici. Refuse (rejette) un chapitre dont le contenu
    // texte est vide — rien à relire. Modèle choisi par l'appelant (contrairement à
    // startFormat) : la relecture bénéficie du même choix de modèle que l'écriture.
    startReview(chapterId: number, options: { model: string }): Promise<string>  // requestId ; enregistre ai_session (task='review') + messages
    // Extraction de fiches (Task 4, plan 3c) : même contrat d'ordonnancement et
    // mêmes canaux ai:chunk/ai:done/ai:error que startWrite/startFormat/startReview
    // ci-dessus ; session enregistrée avec task='extract'. La sortie attendue côté
    // renderer (Task 5) est UN SEUL objet JSON ExtractProposal (voir
    // src/shared/types.ts) — le parsing se fait après ai:done, pas ici. Refuse
    // (rejette) un chapitre dont le contenu texte est vide — rien à extraire. Pas
    // de choix de modèle exposé ici (comme startFormat) : modèle fixé côté main.
    startExtract(chapterId: number): Promise<string>  // requestId ; enregistre ai_session (task='extract') + messages
    // Vérification de chronologie (Task 6, plan 3c) : même contrat d'ordonnancement
    // et mêmes canaux ai:chunk/ai:done/ai:error que les autres startX ci-dessus ;
    // session enregistrée avec task='chrono' et chapterId NULL (session NIVEAU
    // LIVRE, pas rattachée à un chapitre précis — voir createAiSession, chapter_id
    // est déjà nullable). La sortie attendue côté renderer est un tableau JSON de
    // ChronoIssue (voir src/shared/types.ts) — le parsing se fait après ai:done,
    // pas ici. Refuse (rejette) un livre sans aucun chapitre — rien à vérifier.
    // Modèle choisi par l'appelant (comme startReview) : cette tâche suit le
    // sélecteur de modèle du panneau, comme la relecture.
    startChrono(bookId: number, options: { model: string }): Promise<string>  // requestId ; enregistre ai_session (task='chrono', chapterId null) + messages
    // Conversion pure Markdown → JSON TipTap (Task 6), réutilisant mdToTiptapJson
    // (déjà utilisé par l'import de fichier) : ne touche à aucun chapitre en base,
    // sert uniquement à préparer le contenu proposé par startFormat avant de
    // l'appliquer via le chemin de restauration existant côté renderer (voir
    // EditorPane.applyFormat / stores/ai.ts).
    formatToJson(markdown: string): Promise<{ contentJson: string; contentText: string }>
    cancel(requestId: string): Promise<void>
    onChunk(cb: (p: { requestId: string; text: string }) => void): void   // ipcRenderer.on('ai:chunk') — hors invoke
    onDone(cb: (p: { requestId: string; text: string }) => void): void    // 'ai:done' (texte complet) — hors invoke
    onError(cb: (p: { requestId: string; message: string }) => void): void // 'ai:error' — hors invoke
  }
  snapshots: {
    listByChapter(chapterId: number): Promise<Snapshot[]>
    create(chapterId: number, contentJson: string, reason: string): Promise<Snapshot>
    content(id: number): Promise<string>
    remove(id: number): Promise<void>
  }
  series: {
    list(): Promise<Series[]>
    getOrCreate(name: string): Promise<Series>
    remove(id: number): Promise<void>
  }
  backup: {
    /** Lit l'état sur disque et calcule le diff en attente. Ne touche jamais au réseau. */
    status(): Promise<BackupStatus>
    /** Force une sauvegarde. Rejette si une sauvegarde est déjà en cours. */
    runNow(): Promise<BackupStatus>
  }
}

// Canaux IPC : `${domaine}:${méthode}` — ex. 'books:list', 'chapters:saveContent'
// `app` n'est pas un domaine invoke (événementiel pur) — non enregistré par registerIpc.
// `ai` mêle les deux : prepareWrite/startWrite/cancel sont des invoke normaux,
// mais onChunk/onDone/onError sont préload-only (ipcRenderer.on), comme `app`.
export const API_DOMAINS = [
  'books', 'chapters', 'entities', 'illustrations', 'outline', 'timeline', 'importer', 'exporter', 'ai', 'snapshots', 'series'
] as const
