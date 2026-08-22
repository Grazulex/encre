import { defineStore } from 'pinia'
import { useEntitiesStore } from './entities'
import { useBookStore } from './book'
import { useTimelineStore } from './timeline'
import type {
  ChronoIssue,
  Entity,
  ExtractProposal,
  FormatConventions,
  ReviewSuggestion
} from '../../../shared/types'
import { sanitizeFormatOutput } from '../../../shared/sanitizeFormatOutput'
import { parseAiJson } from '../../../shared/aiJson'
import { isValidReviewSuggestion } from '../../../shared/reviewSuggestion'
import { filterExtractProposal } from '../../../shared/extractProposal'
import { isValidChronoIssue, filterChronoIssueIds } from '../../../shared/chronoIssue'

export type AiPhase = 'idle' | 'preparing' | 'streaming' | 'done' | 'error'
export type AiModel = 'sonnet' | 'opus' | 'fable'
// Tâche de la session IA en cours/dernière — écriture (Task 5/7) ou
// harmonisation de mise en forme (Task 6). phase/draft/requestId/le tampon
// d'événements (ring, voir plus bas) sont entièrement PARTAGÉS entre les deux
// tâches (un seul flux à la fois, jamais deux générations simultanées) : ce
// champ sert uniquement à ClaudePanel/FormatDialog pour savoir COMMENT
// afficher ce flux (brouillon à insérer, ou Markdown à comparer avant/après)
// et comment router "Appliquer" une fois 'done'. 'review' (Task 3, plan 3c) :
// relecture — le brouillon final n'est jamais un texte à insérer/comparer
// mais un JSON de ReviewSuggestion[] (voir reviewSuggestions ci-dessous),
// parsé une seule fois à phase==='done' via parseAiJson (aiJson.ts, Task 1).
// 'extract' (Task 5, plan 3c) : extraction de fiches — le brouillon final est
// UN SEUL objet JSON ExtractProposal (voir extractProposal ci-dessous), pas
// un tableau, parsé une seule fois à phase==='done' comme 'review'.
// 'chrono' (Task 6, plan 3c) : vérification de chronologie NIVEAU LIVRE (pas
// un chapitre précis) — le brouillon final est un tableau JSON de ChronoIssue
// (voir chronoIssues ci-dessous), parsé une seule fois à phase==='done' comme
// 'review'. Étant book-level, cette tâche a son propre suivi de péremption
// (chronoBookId/setBook ci-dessous) indépendant de chapterId/prepare().
export type AiTask = 'write' | 'format' | 'review' | 'extract' | 'chrono'

// Task 6b : la sanitisation défensive de la sortie d'harmonisation (fences +
// préambule/écho de titre) vit désormais dans shared/sanitizeFormatOutput.ts
// pour être testable sous vitest (config limitée à src/main + src/shared) et
// pour garantir que FormatDialog (aperçu « Après ») et applyFormat
// (application réelle) sanitisent IDENTIQUEMENT le même texte — voir
// FormatDialog.vue. Réexporté ici pour ne pas casser d'éventuels
// consommateurs déjà branchés sur ce module.
export { stripMarkdownFences, sanitizeFormatOutput } from '../../../shared/sanitizeFormatOutput'

export interface EntityChoice {
  entity: Entity
  checked: boolean
}

type AiEventKind = 'chunk' | 'done' | 'error'
interface AiEventPayload {
  requestId: string
  text?: string
  message?: string
}
interface BufferedAiEvent {
  requestId: string
  kind: AiEventKind
  payload: AiEventPayload
}

// CONTRAT D'ORDONNANCEMENT (voir src/main/api.ts et src/shared/ipc-contract.ts) :
// ai:chunk/ai:done/ai:error peuvent atteindre le renderer AVANT que la promesse
// de startWrite() ne se résolve avec le requestId — invoke (requête/réponse) et
// webContents.send (événement) sont deux transports IPC indépendants, rien ne
// garantit leur ordre relatif. Les trois écouteurs préload-only doivent donc
// être posés UNE SEULE FOIS pour toute la durée de vie de l'app (garde de
// module ci-dessous, jamais par instance de composant/store) et chaque
// événement doit être routé par requestId, avec tampon pour ceux dont le
// requestId est encore inconnu au moment de l'arrivée.
let listenersRegistered = false

// Petit tampon circulaire : couvre à la fois (a) un événement arrivé avant
// que startWrite() n'ait résolu — rejoué dès que le requestId est connu (voir
// reconcile) — et (b) un événement tardif d'une requête déjà abandonnée
// (annulée, remplacée par une nouvelle génération) — jamais rejoué faute de
// correspondance, il reste juste dans le tampon jusqu'à éviction par la
// limite de taille. Module-scope (pas d'état du store) : un seul tampon
// partagé, cohérent avec le fait que les écouteurs eux-mêmes sont posés une
// seule fois.
//
// Bornage par COMPTE uniquement (FIFO, pas d'âge) : une purge par âge
// pourrait faire expirer des chunks encore légitimement en attente si
// l'invoke startWrite met exceptionnellement plus de quelques secondes à
// résoudre (main bloqué) — ce serait alors exactement le chunk perdu que ce
// tampon existe pour éviter. 100 événements représente une marge très large
// par rapport à n'importe quelle fenêtre réaliste de résolution d'un invoke
// (le flux ne produit typiquement qu'une poignée de chunks par seconde) :
// aucune perte par le temps, seule la mémoire est bornée.
const RING_LIMIT = 100
let ring: BufferedAiEvent[] = []

function pruneRing(): void {
  while (ring.length > RING_LIMIT) ring.shift()
}

// Pont vers EditorPane (Task 7) : EditorPane et ClaudePanel sont deux enfants
// FRÈRES de BookView (jamais l'un dans l'arbre de l'autre), donc ni defineExpose
// ni un ref template ne peuvent les relier sans faire transiter BookView, hors
// périmètre de cette tâche. EditorPane s'enregistre ici à son montage (mêmes
// raisons et même forme que window.encre.ai.onChunk/onDone/onError ci-dessus :
// variable de module, pas d'état Pinia, une fonction n'a rien à faire dans un
// state réactif) et se désenregistre à son démontage ; ClaudePanel/SnapshotList
// ne l'appellent jamais directement, seulement via les actions insertDraft/
// restoreSnapshot ci-dessous.
export interface EditorBridge {
  insertDraft(chapterId: number, draft: string): Promise<boolean>
  restoreSnapshot(chapterId: number, contentJson: string): Promise<boolean>
  // Applique le résultat d'une harmonisation (Task 6) : snapshot du contenu
  // ACTUEL avec la raison 'avant harmonisation' (distincte de 'avant
  // restauration' ci-dessus), puis setContent + saveContentFor — mêmes gardes
  // post-await que restoreSnapshot (voir EditorPane.applyFormatIntoEditor).
  applyFormat(chapterId: number, contentJson: string): Promise<boolean>
  // Applique UNE suggestion de relecture (Task 3) : localise la première
  // occurrence exacte de `quote` dans le document et la remplace par
  // `replacement` ('' = suppression) via une transaction ProseMirror ciblée
  // (PAS un setContent complet, contrairement à applyFormat/restoreSnapshot
  // ci-dessus). Le premier appel réussi d'une session de relecture donnée
  // prend un snapshot 'avant relecture' au préalable — EditorPane porte seul
  // cette règle (compteur interne, voir son commentaire), ce store ne s'en
  // préoccupe pas ici. 'not-found' (citation caduque, texte modifié
  // entre-temps) n'est jamais une erreur bloquante ; 'stale' = chapitre changé
  // ou éditeur indisponible pendant l'opération.
  applySuggestion(
    chapterId: number,
    quote: string,
    replacement: string
  ): Promise<'applied' | 'not-found' | 'stale'>
}
let editorBridge: EditorBridge | null = null

export const useAiStore = defineStore('ai', {
  state: () => ({
    open: false,
    phase: 'idle' as AiPhase,
    task: 'write' as AiTask, // voir AiTask ci-dessus — routage d'affichage seulement
    draft: '', // texte accumulé (chunks) ou final (ai:done)
    requestId: null as string | null,
    model: 'sonnet' as AiModel,
    entityChoices: [] as EntityChoice[],
    instructions: '',
    hasSummary: false,
    errorMessage: null as string | null,
    // Chapitre pour lequel prepare() a été appelé en dernier — sert à savoir,
    // au prochain prepare(), si on change réellement de chapitre (session à
    // repartir de zéro) ou si on ne fait que rafraîchir les métadonnées d'un
    // panneau rouvert sur le même chapitre (session en cours préservée).
    chapterId: null as number | null,
    // Relecture (Task 3) : peuplé UNIQUEMENT à phase==='done' avec
    // task==='review' (voir apply() ci-dessous), à partir du parsing défensif
    // de this.draft. reviewParseError porte le message d'échec de parseAiJson
    // (ou une réponse structurellement invalide — pas un tableau) pour
    // affichage côté ReviewPanel ; reviewSuggestions ne contient jamais que
    // des éléments passés au crible d'isValidReviewSuggestion (correctif
    // review — un élément malformé, ex. `quote` manquant, ne doit jamais
    // atteindre EditorPane.applySuggestionIntoEditor) ; reviewMalformedCount
    // compte ceux écartés par ce filtre (0 si aucun, ou si reviewParseError
    // est déjà posé — pas d'information redondante). Les trois sont
    // réinitialisés à chaque startReview() ET à chaque VRAI changement de
    // chapitre (prepare() ci-dessous, isNewChapter) : une relecture d'un
    // chapitre déjà quitté n'a plus sa place à l'écran une fois qu'on est
    // passé à un autre chapitre. Le statut PAR SUGGESTION
    // (pending/applied/dismissed/notFound) est un détail d'affichage porté
    // par ReviewPanel.vue, jamais par ce store (reviewSuggestions reste la
    // donnée brute — filtrée — reçue de l'IA).
    reviewSuggestions: [] as ReviewSuggestion[],
    reviewParseError: null as string | null,
    reviewMalformedCount: 0,
    // Extraction de fiches (Task 5, plan 3c) : peuplé UNIQUEMENT à
    // phase==='done' avec task==='extract' (voir apply() ci-dessous), à
    // partir du parsing défensif de this.draft — MÊME principe que
    // reviewSuggestions/reviewParseError/reviewMalformedCount ci-dessus, avec
    // deux différences : (1) la sortie attendue est UN SEUL objet
    // ExtractProposal, jamais un tableau ; (2) le filtre défensif se fait en
    // DEUX temps — d'abord la FORME de chaque création/enrichissement
    // (filterExtractProposal, src/shared/extractProposal.ts, comptée dans
    // extractMalformedCount), puis, pour les enrichissements dont la forme
    // est valide, l'EXISTENCE de leur entityId dans le catalogue courant du
    // livre (useEntitiesStore — un id inventé ou déjà supprimé entre-temps
    // n'a plus sa place ici, compté séparément dans
    // extractUnknownEntityCount pour l'affichage « N propositions ignorées
    // (entité inconnue) » d'ExtractDialog). Réinitialisés à chaque
    // startExtract() ET à chaque VRAI changement de chapitre (prepare()
    // ci-dessous, isNewChapter), pour les mêmes raisons que les champs
    // review.
    extractProposal: null as ExtractProposal | null,
    extractParseError: null as string | null,
    extractMalformedCount: 0,
    extractUnknownEntityCount: 0,
    // Vérification de chronologie (Task 6, plan 3c) : peuplé UNIQUEMENT à
    // phase==='done' avec task==='chrono' (voir apply() ci-dessous), à partir
    // du parsing défensif de this.draft — MÊME principe que reviewSuggestions
    // ci-dessus (tableau JSON), en DEUX temps comme extractProposal : d'abord
    // la FORME de chaque incohérence (isValidChronoIssue,
    // src/shared/chronoIssue.ts, comptée dans chronoMalformedCount), puis, sur
    // les incohérences bien formées, filterChronoIssueIds retire les
    // chapterIds/eventIds qui ne correspondent plus à aucun chapitre/
    // événement du catalogue courant du livre (id inventé, ou chapitre/
    // événement supprimé entre-temps) — comptés dans chronoUnknownIdCount,
    // sans jamais faire disparaître l'incohérence elle-même (sa description
    // reste exploitable même si un seul id qu'elle cite est caduc).
    chronoIssues: [] as ChronoIssue[],
    chronoParseError: null as string | null,
    chronoMalformedCount: 0,
    chronoUnknownIdCount: 0,
    // Livre pour lequel la session de chronologie en cours/dernière a été
    // lancée (setBook ci-dessous) — DISTINCT de `chapterId` (voir prepare()) :
    // la chronologie est une tâche NIVEAU LIVRE, donc elle doit survivre à un
    // changement de CHAPITRE (l'auteur navigue entre les chapitres du même
    // livre sans perdre le rapport affiché), mais doit être purgée à un
    // changement de LIVRE (un rapport pour un autre livre n'a plus sa place).
    chronoBookId: null as number | null,
    // État d'ouverture du gestionnaire de snapshots (Task 2) : porté ici plutôt
    // que localement dans EditorPane (qui monte le composant) parce que le
    // déclencheur « Gérer les snapshots » vit dans ClaudePanel — même situation
    // que le pont éditeur ci-dessous, EditorPane et ClaudePanel étant deux
    // enfants FRÈRES de BookView. Ce store porte déjà la logique de
    // restauration de snapshot (restoreSnapshot ci-dessous) ; ce flag d'UI
    // partagé s'y ajoute naturellement plutôt que de créer un store dédié pour
    // un simple booléen.
    snapshotManagerOpen: false
  }),
  actions: {
    // À appeler une fois pour toute la durée de vie de l'app (App.vue,
    // onMounted) — jamais depuis ClaudePanel, qui peut être monté/démonté à
    // chaque bascule du panneau. La garde de module ci-dessus rend un second
    // appel sans effet, filet de sécurité si jamais un autre call site était
    // ajouté par erreur.
    initListeners(): void {
      if (listenersRegistered) return
      listenersRegistered = true
      window.encre.ai.onChunk((p) => this.receive('chunk', p))
      window.encre.ai.onDone((p) => this.receive('done', p))
      window.encre.ai.onError((p) => this.receive('error', p))
    },
    // Point d'entrée unique des trois événements IPC : applique directement si
    // le requestId est déjà celui suivi par le store, sinon tamponne (voir le
    // contrat d'ordonnancement ci-dessus).
    receive(kind: AiEventKind, payload: AiEventPayload): void {
      if (this.requestId && payload.requestId === this.requestId) {
        this.apply(kind, payload)
        return
      }
      ring.push({ requestId: payload.requestId, kind, payload })
      pruneRing()
    },
    apply(kind: AiEventKind, payload: AiEventPayload): void {
      if (kind === 'chunk') {
        // Un chunk en retard (dupliqué, ou arrivé après coup pour une requête
        // déjà finalisée) ne doit jamais rouvrir un brouillon déjà clos —
        // sans cette garde, un tel chunk repasserait phase à 'streaming' et
        // ferait réapparaître les boutons de stream sur un brouillon que
        // l'auteur croit déjà terminé (ou en erreur).
        if (this.phase === 'done' || this.phase === 'error') return
        this.phase = 'streaming'
        this.draft += payload.text ?? ''
      } else if (kind === 'done') {
        this.draft = payload.text ?? this.draft
        this.phase = 'done'
        // Parsing défensif de la sortie de relecture (Task 3) : SEULEMENT ici,
        // une fois le flux réellement terminé — jamais sur des chunks
        // intermédiaires, qui ne forment pas un JSON complet. Un tableau vide
        // (Claude "reste silencieux") est un succès normal, pas une erreur.
        if (this.task === 'review') {
          const result = parseAiJson<unknown[]>(this.draft)
          if (result.ok && Array.isArray(result.value)) {
            // Filtre défensif (correctif review) : parseAiJson garantit un
            // JSON syntaxiquement valide, PAS la forme de chaque élément — un
            // élément malformé (champ manquant, `type` hors énumération...)
            // ne doit jamais atteindre EditorPane.applySuggestionIntoEditor
            // ni ReviewPanel, où il planterait ou s'afficherait n'importe
            // comment. Écarté silencieusement mais compté (reviewMalformedCount)
            // plutôt qu'ignoré sans trace.
            const valid = result.value.filter(isValidReviewSuggestion)
            this.reviewSuggestions = valid
            this.reviewMalformedCount = result.value.length - valid.length
            this.reviewParseError = null
          } else {
            this.reviewSuggestions = []
            this.reviewMalformedCount = 0
            this.reviewParseError = result.ok
              ? 'Réponse inattendue (pas un tableau de suggestions).'
              : result.error
          }
        } else if (this.task === 'extract') {
          // Parsing défensif de la sortie d'extraction (Task 5) — même
          // moment (uniquement à 'done') et même raisonnement que 'review'
          // ci-dessus, mais la cible est UN SEUL objet, jamais un tableau.
          const result = parseAiJson<unknown>(this.draft)
          const filtered =
            result.ok ? filterExtractProposal(result.value) : null
          if (result.ok && filtered) {
            // Second filtre, RENDERER-ONLY (voir commentaire du state
            // ci-dessus) : un enrichissement bien formé mais dont l'entityId
            // ne correspond à aucune fiche du catalogue courant du livre
            // (id inventé par le modèle, ou fiche supprimée entre-temps)
            // n'a rien à faire dans ExtractDialog.
            const knownIds = new Set(useEntitiesStore().entities.map((e) => e.id))
            const before = filtered.proposal.enrichissements.length
            const enrichissements = filtered.proposal.enrichissements.filter((e) =>
              knownIds.has(e.entityId)
            )
            this.extractProposal = { creations: filtered.proposal.creations, enrichissements }
            this.extractMalformedCount = filtered.malformedCount
            this.extractUnknownEntityCount = before - enrichissements.length
            this.extractParseError = null
          } else {
            this.extractProposal = null
            this.extractMalformedCount = 0
            this.extractUnknownEntityCount = 0
            this.extractParseError = result.ok
              ? 'Réponse inattendue (pas un objet d’extraction).'
              : result.error
          }
        } else if (this.task === 'chrono') {
          // Parsing défensif de la sortie de chronologie (Task 6, plan 3c) —
          // même moment (uniquement à 'done') et même raisonnement que
          // 'review' ci-dessus : un tableau JSON, filtré élément par élément.
          const result = parseAiJson<unknown[]>(this.draft)
          if (result.ok && Array.isArray(result.value)) {
            const valid = result.value.filter(isValidChronoIssue)
            // Second filtre, RENDERER-ONLY (voir commentaire du state
            // ci-dessus) : les chapterIds/eventIds de chaque incohérence sont
            // recoupés avec le catalogue COURANT du livre — jamais l'incohérence
            // entière écartée pour autant, seulement ses ids caducs retirés.
            const knownChapterIds = new Set(useBookStore().chapters.map((c) => c.id))
            const knownEventIds = new Set(useTimelineStore().events.map((e) => e.id))
            let unknownIdCount = 0
            const filtered = valid.map((issue) => {
              const { issue: trimmed, removedIdCount } = filterChronoIssueIds(
                issue,
                knownChapterIds,
                knownEventIds
              )
              unknownIdCount += removedIdCount
              return trimmed
            })
            this.chronoIssues = filtered
            this.chronoMalformedCount = result.value.length - valid.length
            this.chronoUnknownIdCount = unknownIdCount
            this.chronoParseError = null
          } else {
            this.chronoIssues = []
            this.chronoMalformedCount = 0
            this.chronoUnknownIdCount = 0
            this.chronoParseError = result.ok
              ? 'Réponse inattendue (pas un tableau d’incohérences).'
              : result.error
          }
        }
      } else {
        this.errorMessage = payload.message ?? 'Erreur inconnue.'
        this.phase = 'error'
      }
    },
    // Rejoue, dans l'ordre d'arrivée, tout événement déjà tamponné pour ce
    // requestId précis — referme la course décrite en tête de fichier :
    // startWrite() peut résoudre APRÈS qu'un ou plusieurs chunks (voire
    // ai:done) soient déjà arrivés et aient été tamponnés par receive().
    reconcile(requestId: string): void {
      pruneRing()
      const matched = ring.filter((e) => e.requestId === requestId)
      ring = ring.filter((e) => e.requestId !== requestId)
      for (const event of matched) this.apply(event.kind, event.payload)
    },
    // Charge hasSummary/defaultEntityIds (prepareWrite) et reconstruit les
    // cases à cocher à partir de la liste complète des fiches du livre
    // (useEntitiesStore, déjà chargée par BookView à l'ouverture du livre).
    // Ne réinitialise la session (draft/requestId/phase) QUE si le chapitre
    // change réellement : rouvrir le panneau sur le MÊME chapitre (après
    // fermeture pendant un stream, ou une fois le brouillon terminé) rafraîchit
    // les métadonnées sans perdre une génération en cours ou déjà terminée.
    async prepare(chapterId: number): Promise<void> {
      const isNewChapter = this.chapterId !== chapterId
      this.chapterId = chapterId
      // Fix round 1 (review Task 6, plan 3c) : chronologie est NIVEAU LIVRE,
      // contrairement aux trois autres tâches (chapter-scoped) que ce reset
      // vise. Un changement de CHAPITRE ne doit donc JAMAIS interrompre un
      // rapport de chronologie déjà affiché (phase 'done') ni un stream de
      // chronologie en cours (phase 'streaming' — le requestId continue de
      // réconcilier normalement via receive()/reconcile(), rien ici ne le
      // perturbe). Sans cette garde, cliquer sur une puce « Chap. N » DU
      // RAPPORT LUI-MÊME (ChronoReport → bookStore.openChapter, qui déclenche
      // ce prepare() via le watcher de ClaudePanel) ferait immédiatement
      // disparaître le rapport qu'on vient de consulter et reverserait le
      // bouton sur « Vérifier le livre ». Seul un changement de LIVRE purge
      // la chronologie (voir setBook ci-dessus). `preserveChrono` est capturé
      // UNE SEULE FOIS ici (pas relu après l'await) : si l'auteur bascule
      // vers write/review/format/extract PENDANT l'await ci-dessous, ce
      // nouveau lancement a déjà réinitialisé phase/draft/requestId/
      // errorMessage lui-même (voir start()/startFormat()/startReview()/
      // startExtract(), qui posent leur task AVANT tout await) — relire
      // this.task après coup risquerait au contraire d'écraser CE nouveau
      // flux en cours avec `phase = 'idle'/'error'` ci-dessous.
      const preserveChrono = this.task === 'chrono'
      if (isNewChapter && !preserveChrono) {
        this.draft = ''
        this.requestId = null
        this.errorMessage = null
        this.phase = 'preparing'
      }
      if (isNewChapter) {
        // Correctif review : une relecture affichée pour le chapitre QUITTÉ
        // n'a plus sa place une fois qu'on est passé à un autre chapitre —
        // même raisonnement que draft/requestId/errorMessage ci-dessus, pour
        // les mêmes raisons (ReviewPanel se démonte de toute façon avec le
        // panneau, mais l'état ne doit pas survivre à un retour ultérieur
        // sur ce même onglet pour un chapitre différent). Inconditionnel
        // (pas de garde preserveChrono) : ces champs ne sont affichés que
        // pour task==='review'/'extract', jamais pendant task==='chrono'.
        this.reviewSuggestions = []
        this.reviewParseError = null
        this.reviewMalformedCount = 0
        // Correctif extract (même raisonnement que review ci-dessus) : une
        // extraction affichée pour le chapitre QUITTÉ n'a plus sa place une
        // fois qu'on est passé à un autre chapitre.
        this.extractProposal = null
        this.extractParseError = null
        this.extractMalformedCount = 0
        this.extractUnknownEntityCount = 0
      }
      try {
        const result = await window.encre.ai.prepareWrite(chapterId)
        // Garde de péremption : un nouveau changement de chapitre pendant cet
        // await ne doit pas voir sa préparation écrasée par une réponse pour
        // le chapitre déjà quitté (même principe que EditorPane.loadChapterNotes).
        if (this.chapterId !== chapterId) return
        this.hasSummary = result.hasSummary
        const defaults = new Set(result.defaultEntityIds)
        this.entityChoices = useEntitiesStore().entities.map((entity) => ({
          entity,
          checked: defaults.has(entity.id)
        }))
        if (isNewChapter && !preserveChrono) this.phase = 'idle'
      } catch (err) {
        console.error('Échec de la préparation de l’écriture IA', err)
        if (this.chapterId !== chapterId) return
        this.hasSummary = false
        if (isNewChapter && !preserveChrono) {
          this.errorMessage = "Impossible de préparer l'écriture."
          this.phase = 'error'
        }
      }
    },
    async start(chapterId: number, continueFromText: boolean): Promise<void> {
      this.task = 'write'
      this.draft = ''
      this.errorMessage = null
      this.phase = 'streaming'
      // Inconnu pendant l'attente de l'invoke : tout événement reçu d'ici à sa
      // résolution passe donc forcément par le tampon (receive() ne fait
      // jamais correspondre un requestId à this.requestId tant qu'il est
      // falsy), jamais appliqué à tort à une requête précédente déjà terminée.
      this.requestId = null
      const entityIds = this.entityChoices.filter((c) => c.checked).map((c) => c.entity.id)
      try {
        const requestId = await window.encre.ai.startWrite(chapterId, {
          instructions: this.instructions.trim() || undefined,
          entityIds: [...entityIds], // spread : jamais un tableau réactif brut sur l'IPC
          model: this.model,
          continueFromText
        })
        this.requestId = requestId
        this.reconcile(requestId)
      } catch (err) {
        console.error('Échec du démarrage de l’écriture IA', err)
        this.phase = 'error'
        this.errorMessage =
          err instanceof Error ? err.message : "Échec du démarrage de l'écriture."
      }
    },
    // Lance une harmonisation de mise en forme (Task 6) — même squelette que
    // start() ci-dessus (draft/erreur/phase remis à zéro, requestId inconnu
    // jusqu'à résolution de l'invoke, reconcile() rejoue les événements déjà
    // tamponnés), mais route vers ai.startFormat et pose task='format' pour
    // que ClaudePanel/FormatDialog sachent comment traiter le flux et le
    // résultat final (comparaison avant/après, pas insertion directe).
    async startFormat(chapterId: number, conventions: FormatConventions): Promise<void> {
      this.task = 'format'
      this.draft = ''
      this.errorMessage = null
      this.phase = 'streaming'
      this.requestId = null
      try {
        const requestId = await window.encre.ai.startFormat(chapterId, conventions)
        this.requestId = requestId
        this.reconcile(requestId)
      } catch (err) {
        console.error('Échec du démarrage de l’harmonisation', err)
        this.phase = 'error'
        this.errorMessage =
          err instanceof Error ? err.message : "Échec du démarrage de l'harmonisation."
      }
    },
    // Applique le Markdown harmonisé (this.draft, phase 'done', task
    // 'format') : sanitisation défensive (voir sanitizeFormatOutput — mêmes
    // fences + préambule/écho de titre que l'aperçu « Après » de
    // FormatDialog, sur le MÊME texte this.draft, pour ne jamais diverger
    // entre preview et résultat appliqué), conversion en JSON TipTap via IPC
    // (mdToTiptapJson vit en main, seul process où @tiptap/html/server est
    // utilisable), puis délégation à EditorPane (snapshot 'avant
    // harmonisation' + setContent + saveContentFor, gardes post-await) via le
    // pont — même découpage store/EditorPane que restoreSnapshot ci-dessus.
    // `false` en retour laisse la session 'done' intacte pour réessayer ;
    // reset() n'a lieu qu'après succès confirmé.
    async applyFormat(): Promise<boolean> {
      if (!editorBridge || this.chapterId == null) return false
      const chapterId = this.chapterId
      const markdown = sanitizeFormatOutput(this.draft)
      const { contentJson } = await window.encre.ai.formatToJson(markdown)
      const ok = await editorBridge.applyFormat(chapterId, contentJson)
      if (ok) this.reset()
      return ok
    },
    // Lance une relecture (Task 3, plan 3c) — même squelette que startFormat
    // ci-dessus (draft/erreur/phase remis à zéro, requestId inconnu jusqu'à
    // résolution de l'invoke, reconcile() rejoue les événements déjà
    // tamponnés) ; task='review' pour que ClaudePanel/ReviewPanel sachent
    // comment traiter le flux, et pour que apply() ci-dessus sache parser
    // this.draft en ReviewSuggestion[] une fois 'done'. reviewSuggestions/
    // reviewParseError d'une éventuelle relecture précédente sont vidés ici,
    // pas seulement à la réception du nouveau résultat — sans quoi ReviewPanel
    // afficherait un instant l'ANCIEN lot de suggestions pendant le stream.
    // Contrairement à startFormat, le modèle est un paramètre explicite de
    // l'IPC (voir ipc-contract.ts) : this.model, sélecteur partagé par tous
    // les onglets du panneau.
    async startReview(chapterId: number): Promise<void> {
      this.task = 'review'
      this.draft = ''
      this.errorMessage = null
      this.phase = 'streaming'
      this.requestId = null
      this.reviewSuggestions = []
      this.reviewParseError = null
      this.reviewMalformedCount = 0
      try {
        const requestId = await window.encre.ai.startReview(chapterId, { model: this.model })
        this.requestId = requestId
        this.reconcile(requestId)
      } catch (err) {
        console.error('Échec du démarrage de la relecture', err)
        this.phase = 'error'
        this.errorMessage =
          err instanceof Error ? err.message : 'Échec du démarrage de la relecture.'
      }
    },
    // Lance une extraction de fiches (Task 5, plan 3c) — même squelette que
    // startReview ci-dessus (draft/erreur/phase remis à zéro, requestId
    // inconnu jusqu'à résolution de l'invoke, reconcile() rejoue les
    // événements déjà tamponnés) ; task='extract' pour que ClaudePanel/
    // ExtractDialog sachent comment traiter le flux, et pour que apply()
    // ci-dessus sache parser this.draft en ExtractProposal une fois 'done'.
    // extractProposal/extractParseError/les deux compteurs d'une éventuelle
    // extraction précédente sont vidés ici, pas seulement à la réception du
    // nouveau résultat — sans quoi ExtractDialog afficherait un instant
    // l'ANCIENNE proposition pendant le stream. Contrairement à startReview,
    // pas de choix de modèle exposé (comme startFormat) : modèle fixé côté
    // main (voir ipc-contract.ts, startExtract).
    async startExtract(chapterId: number): Promise<void> {
      this.task = 'extract'
      this.draft = ''
      this.errorMessage = null
      this.phase = 'streaming'
      this.requestId = null
      this.extractProposal = null
      this.extractParseError = null
      this.extractMalformedCount = 0
      this.extractUnknownEntityCount = 0
      try {
        const requestId = await window.encre.ai.startExtract(chapterId)
        this.requestId = requestId
        this.reconcile(requestId)
      } catch (err) {
        console.error('Échec du démarrage de l’extraction', err)
        this.phase = 'error'
        this.errorMessage =
          err instanceof Error ? err.message : "Échec du démarrage de l'extraction."
      }
    },
    // Suivi de péremption NIVEAU LIVRE (Task 6, plan 3c) — à appeler à chaque
    // ouverture de livre / changement de livre (ClaudePanel, watcher sur
    // store.book?.id), PAS à chaque changement de chapitre : contrairement à
    // prepare() ci-dessus (dont le isNewChapter réinitialise déjà phase/draft/
    // review*/extract* à CHAQUE chapitre, y compris au sein d'un même livre),
    // la chronologie est book-level et doit rester affichée quand l'auteur
    // navigue simplement d'un chapitre à l'autre du MÊME livre. Elle n'est
    // purgée qu'ici, quand chronoBookId change réellement — y compris pour un
    // livre SANS AUCUN chapitre (prepare() n'est alors jamais appelé, faute de
    // currentChapter, donc c'est le seul filet de sécurité contre un rapport
    // d'un livre précédent resté affiché).
    setBook(bookId: number): void {
      const isNewBook = this.chronoBookId !== bookId
      this.chronoBookId = bookId
      if (!isNewBook) return
      this.chronoIssues = []
      this.chronoParseError = null
      this.chronoMalformedCount = 0
      this.chronoUnknownIdCount = 0
      if (this.task === 'chrono') {
        this.draft = ''
        this.requestId = null
        this.errorMessage = null
        this.phase = 'idle'
      }
    },
    // Lance une vérification de chronologie NIVEAU LIVRE (Task 6, plan 3c) —
    // même squelette que startReview ci-dessus (draft/erreur/phase remis à
    // zéro, requestId inconnu jusqu'à résolution de l'invoke, reconcile()
    // rejoue les événements déjà tamponnés) ; task='chrono' pour que
    // ClaudePanel/ChronoReport sachent comment traiter le flux, et pour que
    // apply() ci-dessus sache parser this.draft en ChronoIssue[] une fois
    // 'done'. Recharge la chronologie du livre AVANT de lancer la génération
    // (plutôt que de supposer TimelineSection déjà visitée) : ChronoReport a
    // besoin des événements courants (titres affichés dans ses puces, et
    // filtrage des eventIds caducs dans apply() ci-dessus) même si l'auteur
    // n'a jamais ouvert la section Chronologie de ce livre. Comme startReview,
    // le modèle est un paramètre explicite (this.model, sélecteur partagé).
    async startChrono(bookId: number): Promise<void> {
      this.task = 'chrono'
      this.draft = ''
      this.errorMessage = null
      this.phase = 'streaming'
      this.requestId = null
      this.chronoIssues = []
      this.chronoParseError = null
      this.chronoMalformedCount = 0
      this.chronoUnknownIdCount = 0
      try {
        await useTimelineStore().load(bookId)
        const requestId = await window.encre.ai.startChrono(bookId, { model: this.model })
        this.requestId = requestId
        this.reconcile(requestId)
      } catch (err) {
        console.error('Échec du démarrage de la vérification de chronologie', err)
        this.phase = 'error'
        this.errorMessage =
          err instanceof Error ? err.message : 'Échec du démarrage de la vérification.'
      }
    },
    // Applique une suggestion de relecture par son index dans
    // this.reviewSuggestions (Task 3) : délègue tout le travail d'édition
    // (repérage de la citation, transaction ciblée, snapshot avant la
    // première application de la session) à EditorPane via le pont
    // ci-dessus — ce store ne connaît ni l'éditeur ni ProseMirror, même
    // découpage que insertDraft/applyFormat. Contrairement à ces deux-là,
    // n'appelle JAMAIS reset() : une relecture reste affichée (et
    // actionnable suggestion par suggestion) après une application réussie,
    // jusqu'à ce que l'auteur ferme le panneau ou relance une relecture.
    async applySuggestion(index: number): Promise<'applied' | 'not-found' | 'stale'> {
      if (!editorBridge || this.chapterId == null) return 'stale'
      const suggestion = this.reviewSuggestions[index]
      if (!suggestion) return 'stale'
      return editorBridge.applySuggestion(this.chapterId, suggestion.quote, suggestion.replacement)
    },
    async cancel(): Promise<void> {
      const requestId = this.requestId
      if (!requestId) return
      try {
        await window.encre.ai.cancel(requestId)
      } catch (err) {
        console.error("Échec de l'annulation de l'écriture IA", err)
      }
      // N'anticipe pas l'état ici : l'événement ai:error ('Génération
      // annulée.', voir AiService.cancel côté main) portant ce requestId va
      // arriver et sera appliqué normalement par apply() ci-dessus.
    },
    toggle(): void {
      this.open = !this.open
    },
    openSnapshotManager(): void {
      this.snapshotManagerOpen = true
    },
    closeSnapshotManager(): void {
      this.snapshotManagerOpen = false
    },
    // Ne réinitialise QUE la session de génération (phase/brouillon/requête/
    // erreur/consigne) — jamais chapterId/hasSummary/entityChoices, qui
    // décrivent le chapitre affiché, pas la génération en cours : après une
    // insertion (voir insertDraft ci-dessous), le panneau reste ouvert sur le
    // MÊME chapitre, dont le résumé et les fiches cochées restent valides
    // sans nouvel aller-retour prepare(). Les vider ici forcerait un faux
    // « Écrivez d'abord un résumé » le temps d'un rafraîchissement inutile.
    reset(): void {
      this.phase = 'idle'
      this.draft = ''
      this.requestId = null
      this.errorMessage = null
      this.instructions = ''
    },
    // Pont EditorPane ↔ store (voir EditorBridge ci-dessus) : posé au montage
    // d'EditorPane, retiré à son démontage. ClaudePanel/SnapshotList ne
    // connaissent jamais EditorPane directement, seulement insertDraft/
    // restoreSnapshot ci-dessous.
    registerEditor(bridge: EditorBridge): void {
      editorBridge = bridge
    },
    unregisterEditor(): void {
      editorBridge = null
    },
    // Insertion contrôlée du brouillon (Task 7) : délègue tout le travail
    // d'édition (snapshot + insertion TipTap) à EditorPane via le pont
    // ci-dessus — ce store ne connaît ni l'éditeur ni ProseMirror. `false` en
    // retour (snapshot ou éditeur indisponible) laisse la session intacte
    // pour que l'auteur puisse réessayer ; reset() n'a lieu qu'après succès
    // confirmé par EditorPane.
    async insertDraft(): Promise<boolean> {
      if (!editorBridge || this.chapterId == null) return false
      const ok = await editorBridge.insertDraft(this.chapterId, this.draft)
      if (ok) this.reset()
      return ok
    },
    // Restauration d'un snapshot (Task 7) : ne touche jamais phase/draft — la
    // restauration est indépendante d'une génération IA en cours ou terminée.
    // Récupère le JSON du snapshot ici, puis délègue l'application (snapshot
    // du contenu actuel + remplacement + sauvegarde) à EditorPane, seul à
    // savoir parler à l'éditeur/au store livre.
    //
    // Fix 3 (correctif review) : `chapterId` est désormais un paramètre —
    // celui DU SNAPSHOT (snapshot.chapterId côté appelant), pas this.chapterId.
    // this.chapterId n'est tenu à jour que pendant qu'EditorPane est monté
    // (voir prepare() ci-dessus) ; SnapshotManager peut s'ouvrir depuis
    // ClaudePanel sur un autre chapitre que celui affiché à l'instant dans
    // l'éditeur, ou après un changement de chapitre panneau fermé — restaurer
    // via this.chapterId visait alors le mauvais chapitre (ou aucun, si null),
    // faisant systématiquement échouer la garde d'EditorPane. Les gardes
    // post-await d'EditorPane (restoreSnapshotIntoEditor) restent le filet de
    // sécurité final, inchangées.
    async restoreSnapshot(id: number, chapterId: number): Promise<boolean> {
      if (!editorBridge) return false
      const contentJson = await window.encre.snapshots.content(id)
      return editorBridge.restoreSnapshot(chapterId, contentJson)
    }
  }
})
