import { defineStore } from 'pinia'
import { useEntitiesStore } from './entities'
import type { Entity } from '../../../shared/types'

export type AiPhase = 'idle' | 'preparing' | 'streaming' | 'done' | 'error'
export type AiModel = 'sonnet' | 'opus'

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
  ts: number
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

// Petit tampon circulaire (taille ET âge bornés) : couvre à la fois
// (a) un événement arrivé avant que startWrite() n'ait résolu — rejoué dès que
// le requestId est connu (voir reconcile) — et (b) un événement tardif d'une
// requête déjà abandonnée (annulée, remplacée par une nouvelle génération) —
// jamais rejoué faute de correspondance, il vieillit simplement hors du
// tampon. Module-scope (pas d'état du store) : un seul tampon partagé, cohérent
// avec le fait que les écouteurs eux-mêmes sont posés une seule fois.
const RING_LIMIT = 100
const RING_MAX_AGE_MS = 5000
let ring: BufferedAiEvent[] = []

function pruneRing(): void {
  const cutoff = Date.now() - RING_MAX_AGE_MS
  while (ring.length > 0 && ring[0].ts < cutoff) ring.shift()
  while (ring.length > RING_LIMIT) ring.shift()
}

export const useAiStore = defineStore('ai', {
  state: () => ({
    open: false,
    phase: 'idle' as AiPhase,
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
    chapterId: null as number | null
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
      pruneRing()
      ring.push({ requestId: payload.requestId, kind, payload, ts: Date.now() })
    },
    apply(kind: AiEventKind, payload: AiEventPayload): void {
      if (kind === 'chunk') {
        this.phase = 'streaming'
        this.draft += payload.text ?? ''
      } else if (kind === 'done') {
        this.draft = payload.text ?? this.draft
        this.phase = 'done'
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
      if (isNewChapter) {
        this.draft = ''
        this.requestId = null
        this.errorMessage = null
        this.phase = 'preparing'
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
        if (isNewChapter) this.phase = 'idle'
      } catch (err) {
        console.error('Échec de la préparation de l’écriture IA', err)
        if (this.chapterId !== chapterId) return
        this.hasSummary = false
        if (isNewChapter) {
          this.errorMessage = "Impossible de préparer l'écriture."
          this.phase = 'error'
        }
      }
    },
    async start(chapterId: number, continueFromText: boolean): Promise<void> {
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
    reset(): void {
      this.phase = 'idle'
      this.draft = ''
      this.requestId = null
      this.errorMessage = null
      this.instructions = ''
      this.entityChoices = []
      this.hasSummary = false
      this.chapterId = null
    }
  }
})
