import { defineStore } from 'pinia'
import { useEntitiesStore } from './entities'
import type { Entity, FormatConventions } from '../../../shared/types'
import { sanitizeFormatOutput } from '../../../shared/sanitizeFormatOutput'

export type AiPhase = 'idle' | 'preparing' | 'streaming' | 'done' | 'error'
export type AiModel = 'sonnet' | 'opus' | 'fable'
// Tâche de la session IA en cours/dernière — écriture (Task 5/7) ou
// harmonisation de mise en forme (Task 6). phase/draft/requestId/le tampon
// d'événements (ring, voir plus bas) sont entièrement PARTAGÉS entre les deux
// tâches (un seul flux à la fois, jamais deux générations simultanées) : ce
// champ sert uniquement à ClaudePanel/FormatDialog pour savoir COMMENT
// afficher ce flux (brouillon à insérer, ou Markdown à comparer avant/après)
// et comment router "Appliquer" une fois 'done'.
export type AiTask = 'write' | 'format'

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
    // Récupère le JSON du snapshot ici (seul ce store connaît chapterId), puis
    // délègue l'application (snapshot du contenu actuel + remplacement +
    // sauvegarde) à EditorPane, seul à savoir parler à l'éditeur/au store livre.
    async restoreSnapshot(id: number): Promise<boolean> {
      if (!editorBridge || this.chapterId == null) return false
      const chapterId = this.chapterId
      const contentJson = await window.encre.snapshots.content(id)
      return editorBridge.restoreSnapshot(chapterId, contentJson)
    }
  }
})
