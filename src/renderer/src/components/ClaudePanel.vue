<script setup lang="ts">
// Panneau Claude (Task 6) : colonne droite de BookView, section chapitres
// uniquement. Le brouillon streamé ne touche JAMAIS l'éditeur tant que
// l'auteur n'a pas cliqué sur Insérer. Insérer (Task 7) délègue tout le
// travail d'édition à EditorPane via le pont du store ai (registerEditor —
// EditorPane et ce panneau sont frères dans BookView, jamais l'un dans
// l'arbre de l'autre) : ce composant ne connaît ni l'éditeur ni ProseMirror.
import { computed, nextTick, ref, watch } from 'vue'
import { useAiStore } from '../stores/ai'
import type { AiTask } from '../stores/ai'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import type { FormatConventions } from '../../../shared/types'
import FormatDialog from './FormatDialog.vue'
import ReviewPanel from './ReviewPanel.vue'
import ExtractDialog from './ExtractDialog.vue'
import ChronoReport from './ChronoReport.vue'

const ai = useAiStore()
const store = useBookStore()
const ui = useUiStore()

// Cinq onglets partageant le même panneau (Task 6, puis Task 3, Task 5 et
// Task 6 plan 3c) : « Écriture » (préexistant), « Mise en forme »
// (harmonisation typographique), « Relecture » (suggestions ciblées
// appliquées une à une), « Extraction » (fiches personnages/lieux proposées
// depuis le texte du chapitre, validées dans ExtractDialog) et
// « Chronologie » (vérification NIVEAU LIVRE — pas un chapitre précis — des
// incohérences temporelles, affichées inline dans ChronoReport). Les cinq
// tâches partagent phase/draft/requestId côté store (un seul flux à la
// fois — voir stores/ai.ts, AiTask) ; cet onglet local ne pilote QUE
// l'affichage, jamais la génération elle-même : basculer d'onglet pendant un
// stream ne l'annule pas, il continue en arrière-plan (ai.task indique
// lequel).
const activeTab = ref<'ecriture' | 'mise-en-forme' | 'relecture' | 'extraction' | 'chronologie'>(
  'ecriture'
)

// Conventions de mise en forme (Task 6) : « mémorisées en session » (brief) —
// sessionStorage plutôt que le store Pinia (qui ne persiste rien lui-même) ou
// une table de préférences en base (aucune n'existe, et ce choix est
// explicitement scopé à la session de l'appli, pas au livre). Lues une seule
// fois à la création du composant ; sessionStorage peut lever (contexte
// restreint) — les valeurs par défaut ci-dessous couvrent ce cas comme
// l'absence de valeur déjà enregistrée.
const FORMAT_DIALOGUE_KEY = 'encre.format.dialogue'
const FORMAT_LISTES_KEY = 'encre.format.listes'
const FORMAT_SEPARATIONS_KEY = 'encre.format.separations'

function readFormatPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = sessionStorage.getItem(key)
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

// Task 6b : « proposer des séparations manquantes » est un booléen, pas une
// énumération — même idiome try/catch que readFormatPref ci-dessus, mais pas
// de liste de valeurs autorisées à vérifier. Défaut décoché (brief).
function readFormatBoolPref(key: string, fallback: boolean): boolean {
  try {
    const value = sessionStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

const dialogueConvention = ref<FormatConventions['dialogue']>(
  readFormatPref(FORMAT_DIALOGUE_KEY, 'guillemets', ['guillemets', 'tirets'] as const)
)
const listesConvention = ref<FormatConventions['listes']>(
  readFormatPref(FORMAT_LISTES_KEY, 'tirets', ['tirets', 'puces'] as const)
)
const proposerSeparations = ref<boolean>(readFormatBoolPref(FORMAT_SEPARATIONS_KEY, false))
watch(dialogueConvention, (value) => {
  try {
    sessionStorage.setItem(FORMAT_DIALOGUE_KEY, value)
  } catch {
    // sessionStorage indisponible : la convention reste active pour cette
    // session en mémoire, seule la mémorisation entre panneaux est perdue.
  }
})
watch(listesConvention, (value) => {
  try {
    sessionStorage.setItem(FORMAT_LISTES_KEY, value)
  } catch {
    // idem
  }
})
watch(proposerSeparations, (value) => {
  try {
    sessionStorage.setItem(FORMAT_SEPARATIONS_KEY, String(value))
  } catch {
    // idem
  }
})

function launchFormat(): void {
  const chapter = store.currentChapter
  if (!chapter || !hasContent.value || busy.value) return
  ai.startFormat(chapter.id, {
    dialogue: dialogueConvention.value,
    listes: listesConvention.value,
    proposerSeparations: proposerSeparations.value
  })
}

// Lance une relecture (Task 3, plan 3c) — même garde que launchFormat
// ci-dessus (chapitre présent, contenu non vide, aucune génération déjà en
// cours). Le modèle utilisé est ai.model, le même sélecteur partagé que
// l'onglet Écriture (rendu à nouveau ci-dessous dans l'onglet Relecture).
function launchReview(): void {
  const chapter = store.currentChapter
  if (!chapter || !hasContent.value || busy.value) return
  ai.startReview(chapter.id)
}

// Lance une extraction de fiches (Task 5, plan 3c) — même garde que
// launchReview ci-dessus. Contrairement à la relecture, aucun choix de
// modèle n'est exposé (fixé côté main, comme la mise en forme).
function launchExtract(): void {
  const chapter = store.currentChapter
  if (!chapter || !hasContent.value || busy.value) return
  ai.startExtract(chapter.id)
}

// Lance une vérification de chronologie (Task 6, plan 3c) — NIVEAU LIVRE :
// contrairement à launchReview/launchExtract ci-dessus, ne dépend ni du
// chapitre courant ni de son contenu (store.book, pas store.currentChapter) —
// fonctionne quel que soit le chapitre ouvert dans ce livre, comme demandé
// par le brief. Même garde `busy` que les autres lancements (un seul flux
// partagé à la fois, voir stores/ai.ts).
function launchChrono(): void {
  const book = store.book
  if (!book || busy.value) return
  ai.startChrono(book.id)
}

// Suivi de péremption NIVEAU LIVRE du rapport de chronologie (voir
// stores/ai.ts, setBook) : DISTINCT du watcher chapterId ci-dessous — la
// chronologie doit survivre à un changement de chapitre au sein d'un même
// livre, mais être purgée à un changement de LIVRE. { immediate: true }
// couvre aussi bien l'ouverture initiale du panneau que le retour sur un
// livre différent.
watch(
  () => store.book?.id,
  (id) => {
    if (id != null) ai.setBook(id)
  },
  { immediate: true }
)

// prepare() re-déclenché à chaque ouverture du panneau (montage — v-if côté
// BookView) ET à chaque changement de chapitre tant qu'il reste ouvert
// (même watcher, { immediate: true } couvrant les deux cas). prepare()
// lui-même décide, en comparant chapterId, s'il s'agit d'un rafraîchissement
// de métadonnées (panneau rouvert sur le même chapitre) ou d'une vraie
// nouvelle session (voir stores/ai.ts).
watch(
  () => store.currentChapter?.id,
  (id) => {
    if (id != null) ai.prepare(id)
  },
  { immediate: true }
)

const busy = computed(() => ai.phase === 'preparing' || ai.phase === 'streaming')
const hasContent = computed(() => !!store.currentChapter?.contentText.trim())

// Libellé en français d'une tâche IA (Task 5, plan 3c) — les bandeaux
// « <tâche> en cours, patientez… » de Relecture et Extraction couvrent les
// TROIS autres tâches possibles (contrairement à ceux d'Écriture/Mise en
// forme, chacun gaté sur une seule autre tâche précise), d'où cette table
// plutôt qu'un ternaire imbriqué à chaque site d'appel.
const TASK_LABELS: Record<AiTask, string> = {
  write: 'Écriture',
  format: 'Mise en forme',
  review: 'Relecture',
  extract: 'Extraction',
  chrono: 'Chronologie'
}

// ai.hasSummary ne se rafraîchit qu'à prepare() (montage du panneau /
// changement de chapitre) : si le panneau reste ouvert pendant que l'auteur
// tape son résumé dans l'éditeur juste à côté, ai.hasSummary reste figé sur
// sa valeur de départ (souvent `false`) et l'avertissement/le bouton restent
// bloqués jusqu'à un remontage. On dérive donc en plus une lecture live du
// résumé du chapitre courant (store.currentChapter?.summary, trim non-vide)
// et on la combine en OU avec ai.hasSummary : n'importe laquelle des deux
// sources suffit à lever le blocage, ce qui couvre aussi bien le cas
// « rouvert avec résumé déjà là » (ai.hasSummary) que « tapé pendant que
// c'est ouvert » (lecture live). La garde serveur de startWrite reste le
// filet de sécurité final si les deux se désynchronisaient.
const summaryReady = computed(() => {
  const liveSummary = store.currentChapter?.summary.trim() ?? ''
  return ai.hasSummary || liveSummary.length > 0
})

const SUMMARY_PREVIEW_MAX = 220
const summaryPreview = computed(() => {
  const summary = store.currentChapter?.summary.trim() ?? ''
  if (summary.length <= SUMMARY_PREVIEW_MAX) return summary
  return `${summary.slice(0, SUMMARY_PREVIEW_MAX)} …`
})

// Mode de la dernière génération lancée (corps neuf ou suite du texte
// existant) : Régénérer reprend exactement ce mode, sans que l'auteur ait à
// re-choisir entre les deux boutons de lancement.
const lastContinue = ref(false)

function launch(continueFromText: boolean): void {
  const chapter = store.currentChapter
  if (!chapter || !summaryReady.value) return
  lastContinue.value = continueFromText
  ai.start(chapter.id, continueFromText)
}

function regenerate(): void {
  const chapter = store.currentChapter
  if (!chapter) return
  ai.start(chapter.id, lastContinue.value)
}

// Garde locale contre le double-clic : le bouton disparaît dès que
// ai.insertDraft() rappelle reset() (phase quitte 'done'), mais entre le clic
// et cette bascule il y a deux aller-retours IPC (snapshot, éventuellement
// sauvegarde) pendant lesquels un second clic resterait possible sans ce ref.
const inserting = ref(false)

async function insertDraft(): Promise<void> {
  if (inserting.value) return
  inserting.value = true
  try {
    await ai.insertDraft()
  } finally {
    inserting.value = false
  }
}

async function copyDraft(): Promise<void> {
  try {
    await navigator.clipboard.writeText(ai.draft)
    ui.toast('Brouillon copié.')
  } catch (err) {
    console.error('Échec de la copie du brouillon', err)
    ui.toast('Impossible de copier le brouillon.')
  }
}

// Auto-scroll de la zone de stream : suit la fin du texte à chaque chunk,
// tant que le générateur n'a pas fini (une fois 'done', l'auteur peut relire
// tranquillement sans être ramené en bas à chaque re-rendu).
const streamEl = ref<HTMLElement | null>(null)
watch(
  () => ai.draft,
  async () => {
    if (ai.phase !== 'streaming') return
    await nextTick()
    const el = streamEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<template>
  <!-- div plutôt que aside : BookView.vue a un sélecteur `aside { ... }`
       générique (pour son propre nav de gauche) — les styles scoped d'un
       parent s'appliquent aussi à la racine d'un composant enfant en Vue,
       un vrai <aside> ici recevrait donc ces règles par ricochet
       (border-right, transitions) en plus des siennes. -->
  <div class="claude-panel" role="complementary" aria-label="Assistant Claude">
    <header class="cp-head">
      <h2>Assistant Claude</h2>
      <button
        class="cp-close"
        type="button"
        title="Fermer"
        aria-label="Fermer le panneau"
        @click="ai.open = false"
      >
        ×
      </button>
    </header>

    <!-- Fix round 1 (revue) : libellés VISIBLES volontairement courts (un mot,
         sur une seule ligne chacun) pour que les 5 onglets tiennent dans les
         360px du panneau sans être coupés ni passer sur plusieurs lignes —
         Forme/Fiches/Chrono abrègent Mise en forme/Extraction/Chronologie.
         Le nom complet reste disponible via aria-label/title (accessibilité,
         infobulle) et TASK_LABELS ci-dessus garde les noms longs pour les
         bandeaux « <tâche> en cours… », qui ont la place de rester clairs. -->
    <div class="cp-tabs" role="tablist" aria-label="Section de l'assistant">
      <button
        type="button"
        role="tab"
        class="cp-tab"
        :class="{ active: activeTab === 'ecriture' }"
        :aria-selected="activeTab === 'ecriture'"
        aria-label="Écriture"
        title="Écriture"
        @click="activeTab = 'ecriture'"
      >
        Écriture
      </button>
      <button
        type="button"
        role="tab"
        class="cp-tab"
        :class="{ active: activeTab === 'mise-en-forme' }"
        :aria-selected="activeTab === 'mise-en-forme'"
        aria-label="Mise en forme"
        title="Mise en forme"
        @click="activeTab = 'mise-en-forme'"
      >
        Forme
      </button>
      <button
        type="button"
        role="tab"
        class="cp-tab"
        :class="{ active: activeTab === 'relecture' }"
        :aria-selected="activeTab === 'relecture'"
        aria-label="Relecture"
        title="Relecture"
        @click="activeTab = 'relecture'"
      >
        Relecture
      </button>
      <button
        type="button"
        role="tab"
        class="cp-tab"
        :class="{ active: activeTab === 'extraction' }"
        :aria-selected="activeTab === 'extraction'"
        aria-label="Extraction"
        title="Extraction (fiches)"
        @click="activeTab = 'extraction'"
      >
        Fiches
      </button>
      <button
        type="button"
        role="tab"
        class="cp-tab"
        :class="{ active: activeTab === 'chronologie' }"
        :aria-selected="activeTab === 'chronologie'"
        aria-label="Chronologie"
        title="Chronologie"
        @click="activeTab = 'chronologie'"
      >
        Chrono
      </button>
    </div>

    <div class="cp-body">
      <template v-if="activeTab === 'ecriture'">
        <section class="cp-section">
          <p v-if="ai.phase === 'preparing'" class="cp-loading">Préparation…</p>
          <template v-else>
            <div v-if="summaryReady" class="cp-summary">
              <span class="field-label">Résumé du chapitre</span>
              <p class="cp-summary-text">{{ summaryPreview }}</p>
            </div>
            <p v-else class="cp-warning">Écrivez d'abord un résumé dans « Résumé &amp; notes ».</p>
          </template>
        </section>

        <section v-if="ai.entityChoices.length > 0" class="cp-section">
          <span class="field-label">Fiches à inclure</span>
          <ul class="cp-entities">
            <li v-for="choice in ai.entityChoices" :key="choice.entity.id">
              <label class="cp-entity" :class="{ disabled: busy }">
                <input v-model="choice.checked" type="checkbox" :disabled="busy" />
                <span class="cp-entity-badge" :class="{ place: choice.entity.kind === 'place' }">
                  {{ choice.entity.kind === 'character' ? '◆' : '●' }}
                </span>
                {{ choice.entity.name }}
              </label>
            </li>
          </ul>
        </section>

        <section class="cp-section">
          <span class="field-label">Consigne (facultatif)</span>
          <textarea
            v-model="ai.instructions"
            class="cp-instructions"
            rows="3"
            placeholder="Une intention pour ce brouillon…"
            :disabled="busy"
          ></textarea>
        </section>

        <div class="cp-model-row">
          <span class="field-label">Modèle</span>
          <select v-model="ai.model" class="cp-model-select" :disabled="busy">
            <option value="sonnet">Sonnet — rapide</option>
            <option value="opus">Opus — soigné</option>
            <option value="fable">Fable — le plus littéraire</option>
          </select>
        </div>

        <p v-if="busy && ai.task === 'format'" class="cp-warning">
          Harmonisation en cours — patientez avant une nouvelle génération.
        </p>

        <div v-if="ai.phase === 'idle' || ai.phase === 'error'" class="cp-launch">
          <p v-if="ai.errorMessage && ai.task === 'write'" class="error-text">{{ ai.errorMessage }}</p>
          <button type="button" class="primary" :disabled="!summaryReady" @click="launch(false)">
            Rédiger le brouillon
          </button>
          <button v-if="hasContent" type="button" :disabled="!summaryReady" @click="launch(true)">
            Continuer le texte
          </button>
        </div>

        <div v-if="ai.task === 'write' && (ai.phase === 'streaming' || ai.phase === 'done')" class="cp-stream">
          <span class="field-label">Brouillon</span>
          <div ref="streamEl" class="cp-stream-text">
            {{ ai.draft }}<span v-if="ai.phase === 'streaming'" class="cp-cursor">▍</span>
          </div>
          <div class="cp-stream-actions">
            <button v-if="ai.phase === 'streaming'" type="button" @click="ai.cancel()">
              Annuler
            </button>
            <template v-else>
              <button type="button" class="primary" :disabled="inserting" @click="insertDraft">
                {{ inserting ? 'Insertion…' : 'Insérer' }}
              </button>
              <button type="button" :disabled="inserting" @click="regenerate">Régénérer</button>
              <button type="button" :disabled="inserting" @click="copyDraft">Copier</button>
            </template>
          </div>
        </div>
      </template>

      <template v-else-if="activeTab === 'mise-en-forme'">
        <section class="cp-section">
          <span class="field-label">Conventions</span>
          <div class="cp-conventions">
            <fieldset class="cp-radio-group" :disabled="busy">
              <legend>Dialogue</legend>
              <label class="cp-radio">
                <input
                  v-model="dialogueConvention"
                  type="radio"
                  name="cp-format-dialogue"
                  value="guillemets"
                />
                Guillemets « … »
              </label>
              <label class="cp-radio">
                <input
                  v-model="dialogueConvention"
                  type="radio"
                  name="cp-format-dialogue"
                  value="tirets"
                />
                Tirets — …
              </label>
            </fieldset>
            <fieldset class="cp-radio-group" :disabled="busy">
              <legend>Listes</legend>
              <label class="cp-radio">
                <input
                  v-model="listesConvention"
                  type="radio"
                  name="cp-format-listes"
                  value="tirets"
                />
                Tirets -
              </label>
              <label class="cp-radio">
                <input
                  v-model="listesConvention"
                  type="radio"
                  name="cp-format-listes"
                  value="puces"
                />
                Puces •
              </label>
            </fieldset>
            <label class="cp-checkbox">
              <input v-model="proposerSeparations" type="checkbox" :disabled="busy" />
              Proposer des séparations manquantes
            </label>
            <p class="hint">
              Suggère des *** aux transitions de scène — à valider dans l'aperçu.
            </p>
          </div>
        </section>

        <p v-if="busy && ai.task === 'write'" class="cp-warning">
          Écriture en cours — patientez avant d'harmoniser ce chapitre.
        </p>
        <p v-if="!hasContent" class="cp-warning">Ce chapitre est vide : rien à harmoniser.</p>

        <div v-if="ai.phase === 'idle' || ai.phase === 'error'" class="cp-launch">
          <p v-if="ai.errorMessage && ai.task === 'format'" class="error-text">{{ ai.errorMessage }}</p>
          <button type="button" class="primary" :disabled="!hasContent" @click="launchFormat">
            Harmoniser ce chapitre
          </button>
        </div>

        <div
          v-if="ai.task === 'format' && (ai.phase === 'streaming' || ai.phase === 'done')"
          class="cp-stream"
        >
          <span class="field-label">Texte harmonisé</span>
          <div ref="streamEl" class="cp-stream-text">
            {{ ai.draft }}<span v-if="ai.phase === 'streaming'" class="cp-cursor">▍</span>
          </div>
          <div v-if="ai.phase === 'streaming'" class="cp-stream-actions">
            <button type="button" @click="ai.cancel()">Annuler</button>
          </div>
          <p v-else class="hint">Vérification avant/après affichée à l'écran.</p>
        </div>
      </template>

      <template v-else-if="activeTab === 'relecture'">
        <div class="cp-model-row">
          <span class="field-label">Modèle</span>
          <select v-model="ai.model" class="cp-model-select" :disabled="busy">
            <option value="sonnet">Sonnet — rapide</option>
            <option value="opus">Opus — soigné</option>
            <option value="fable">Fable — le plus littéraire</option>
          </select>
        </div>

        <p v-if="busy && ai.task !== 'review'" class="cp-warning">
          {{ TASK_LABELS[ai.task] }} en cours — patientez avant de relire ce chapitre.
        </p>
        <p v-if="!hasContent" class="cp-warning">Ce chapitre est vide : rien à relire.</p>

        <div
          v-if="ai.phase === 'idle' || ai.phase === 'error' || (ai.phase === 'done' && ai.task === 'review')"
          class="cp-launch"
        >
          <p v-if="ai.errorMessage && ai.task === 'review'" class="error-text">{{ ai.errorMessage }}</p>
          <button type="button" class="primary" :disabled="!hasContent || busy" @click="launchReview">
            {{ ai.task === 'review' && ai.phase === 'done' ? 'Relire à nouveau' : 'Relire ce chapitre' }}
          </button>
        </div>

        <div v-if="ai.task === 'review' && ai.phase === 'streaming'" class="cp-stream">
          <span class="field-label">Analyse en cours…</span>
          <div ref="streamEl" class="cp-stream-text">
            {{ ai.draft }}<span class="cp-cursor">▍</span>
          </div>
          <div class="cp-stream-actions">
            <button type="button" @click="ai.cancel()">Annuler</button>
          </div>
        </div>

        <ReviewPanel v-if="ai.task === 'review' && ai.phase === 'done'" />
      </template>

      <template v-else-if="activeTab === 'extraction'">
        <p v-if="busy && ai.task !== 'extract'" class="cp-warning">
          {{ TASK_LABELS[ai.task] }} en cours — patientez avant d'extraire des fiches de ce
          chapitre.
        </p>
        <p v-if="!hasContent" class="cp-warning">Ce chapitre est vide : rien à extraire.</p>

        <div v-if="ai.phase === 'idle' || ai.phase === 'error'" class="cp-launch">
          <p v-if="ai.errorMessage && ai.task === 'extract'" class="error-text">
            {{ ai.errorMessage }}
          </p>
          <button type="button" class="primary" :disabled="!hasContent || busy" @click="launchExtract">
            Analyser ce chapitre
          </button>
        </div>

        <div
          v-if="ai.task === 'extract' && (ai.phase === 'streaming' || ai.phase === 'done')"
          class="cp-stream"
        >
          <span class="field-label">Analyse en cours…</span>
          <div ref="streamEl" class="cp-stream-text">
            {{ ai.draft }}<span v-if="ai.phase === 'streaming'" class="cp-cursor">▍</span>
          </div>
          <div v-if="ai.phase === 'streaming'" class="cp-stream-actions">
            <button type="button" @click="ai.cancel()">Annuler</button>
          </div>
          <p v-else class="hint">Proposition affichée dans la boîte de dialogue.</p>
        </div>
      </template>

      <template v-else>
        <div class="cp-model-row">
          <span class="field-label">Modèle</span>
          <select v-model="ai.model" class="cp-model-select" :disabled="busy">
            <option value="sonnet">Sonnet — rapide</option>
            <option value="opus">Opus — soigné</option>
            <option value="fable">Fable — le plus littéraire</option>
          </select>
        </div>

        <p v-if="busy && ai.task !== 'chrono'" class="cp-warning">
          {{ TASK_LABELS[ai.task] }} en cours — patientez avant de vérifier ce livre.
        </p>

        <div
          v-if="ai.phase === 'idle' || ai.phase === 'error' || (ai.phase === 'done' && ai.task === 'chrono')"
          class="cp-launch"
        >
          <p v-if="ai.errorMessage && ai.task === 'chrono'" class="error-text">{{ ai.errorMessage }}</p>
          <button type="button" class="primary" :disabled="busy" @click="launchChrono">
            {{ ai.task === 'chrono' && ai.phase === 'done' ? 'Vérifier à nouveau' : 'Vérifier le livre' }}
          </button>
        </div>

        <div v-if="ai.task === 'chrono' && ai.phase === 'streaming'" class="cp-stream">
          <span class="field-label">Analyse en cours…</span>
          <div ref="streamEl" class="cp-stream-text">
            {{ ai.draft }}<span class="cp-cursor">▍</span>
          </div>
          <div class="cp-stream-actions">
            <button type="button" @click="ai.cancel()">Annuler</button>
          </div>
        </div>

        <ChronoReport v-if="ai.task === 'chrono' && ai.phase === 'done'" />
      </template>

      <button type="button" class="cp-snapshots-link" @click="ai.openSnapshotManager()">
        Gérer les snapshots
      </button>
    </div>

    <FormatDialog v-if="ai.phase === 'done' && ai.task === 'format'" />
    <ExtractDialog v-if="ai.phase === 'done' && ai.task === 'extract'" />
  </div>
</template>

<style scoped>
.claude-panel {
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.cp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cp-head h2 {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.cp-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  /* Fix round 1 (revue) : 5 onglets (Écriture/Forme/Relecture/Fiches/Chrono)
     tiennent normalement sur une ligne dans les 360px du panneau grâce aux
     libellés courts + à la typographie resserrée ci-dessous. overflow-x:auto
     reste un filet de sécurité (jamais de clip ni de retour à la ligne) si
     une police système plus large que prévu élargissait quand même la
     rangée — barre de défilement masquée pour ne pas alourdir visuellement
     une rangée d'onglets. */
  overflow-x: auto;
  scrollbar-width: none;
}
.cp-tabs::-webkit-scrollbar {
  display: none;
}
.cp-tab {
  flex-shrink: 0;
  white-space: nowrap;
  border: none;
  border-radius: 6px 6px 0 0;
  padding: 6px 9px 8px;
  margin-bottom: -1px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--fg-muted);
  background: none;
  border-bottom: 2px solid transparent;
}
.cp-tab:hover {
  color: var(--fg);
}
.cp-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.cp-close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border-color: transparent;
  font-size: 14px;
  line-height: 1;
  color: var(--fg-muted);
}
.cp-close:hover {
  border-color: var(--fg-muted);
  color: var(--fg);
}

.cp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px;
}

.cp-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cp-loading {
  font-size: 12.5px;
  color: var(--fg-muted);
}

.cp-summary-text {
  font-size: 13px;
  line-height: 1.55;
  color: var(--fg);
}

.cp-warning {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
}

.cp-conventions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cp-radio-group {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cp-radio-group:disabled {
  opacity: 0.6;
}
.cp-radio-group legend {
  padding: 0 4px;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
}
.cp-radio {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px;
  font-size: 12.5px;
  color: var(--fg);
  cursor: pointer;
}
.cp-radio input {
  padding: 0;
  accent-color: var(--accent);
}
.cp-checkbox {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px;
  font-size: 12.5px;
  color: var(--fg);
  cursor: pointer;
}
.cp-checkbox input {
  padding: 0;
  accent-color: var(--accent);
}
.cp-checkbox input:disabled {
  cursor: default;
}

.cp-entities {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
}
.cp-entity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 2px;
  font-size: 12.5px;
  cursor: pointer;
}
.cp-entity.disabled {
  cursor: default;
  opacity: 0.6;
}
.cp-entity input {
  padding: 0;
  accent-color: var(--accent);
}
.cp-entity-badge {
  font-size: 8px;
  color: var(--accent);
}
.cp-entity-badge.place {
  color: color-mix(in srgb, var(--accent) 60%, transparent);
}

.cp-instructions {
  width: 100%;
  resize: vertical;
  font-size: 12.5px;
  line-height: 1.5;
}

.cp-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cp-model-select {
  -webkit-appearance: none;
  appearance: none;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--fg-muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 22px 4px 10px;
  cursor: pointer;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--fg-muted) 50%),
    linear-gradient(135deg, var(--fg-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 12px) center,
    calc(100% - 7px) center;
  background-size:
    5px 5px,
    5px 5px;
  background-repeat: no-repeat;
}
.cp-model-select:hover,
.cp-model-select:focus {
  outline: none;
  border-color: var(--accent);
  color: var(--accent);
}

.cp-launch {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-launch button {
  width: 100%;
}

.cp-stream {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 160px;
}
.cp-stream-text {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-family: var(--font-manuscript);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.cp-cursor {
  display: inline-block;
  color: var(--accent);
  animation: cp-blink 1s step-start infinite;
}
@keyframes cp-blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cp-cursor {
    animation: none;
  }
}

.cp-stream-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.cp-stream-actions button {
  flex: 1;
}

/* Lien discret (Task 2) : remplace l'ancienne section repliable SnapshotList,
   absorbée dans SnapshotManager (popover monté par EditorPane). Bordure
   supérieure pour marquer la même séparation visuelle que l'ancienne section. */
.cp-snapshots-link {
  width: 100%;
  text-align: left;
  border: none;
  border-top: 1px solid var(--border);
  border-radius: 0;
  margin-top: 4px;
  padding: 12px 0 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--fg-muted);
}
.cp-snapshots-link:hover {
  color: var(--accent);
}
</style>
