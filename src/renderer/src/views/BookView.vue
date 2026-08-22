<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBookStore } from '../stores/book'
import { useEntitiesStore } from '../stores/entities'
import { useAiStore } from '../stores/ai'
import { useShortcuts } from '../composables/useShortcuts'
import SectionNav from '../components/SectionNav.vue'
import ChapterList from '../components/ChapterList.vue'
import EditorPane from '../components/EditorPane.vue'
import StatusBar from '../components/StatusBar.vue'
import EntitiesSection from '../components/EntitiesSection.vue'
import EntityList from '../components/EntityList.vue'
import OutlineSection from '../components/OutlineSection.vue'
import TimelineSection from '../components/TimelineSection.vue'
import EntityDrawer from '../components/EntityDrawer.vue'
import BookSettingsPanel from '../components/BookSettingsPanel.vue'
import ExportDialog from '../components/ExportDialog.vue'
import ClaudePanel from '../components/ClaudePanel.vue'

const props = defineProps<{ bookId: number }>()
const store = useBookStore()
const entitiesStore = useEntitiesStore()
const ai = useAiStore()
const router = useRouter()

// Chargé ici (pas paresseusement à l'entrée de la section Personnages/Lieux) :
// les mentions de l'éditeur (Task 11) et l'autolink (Task 12) ont besoin des
// entités dès que l'éditeur est visible, quelle que soit la section active.
onMounted(() => {
  store.open(props.bookId)
  entitiesStore.load(props.bookId)
})

const progress = computed(() => {
  const book = store.book
  if (!book) return ''
  const words = book.wordCount.toLocaleString('fr-FR')
  return book.wordGoal
    ? `${words} / ${book.wordGoal.toLocaleString('fr-FR')} mots`
    : `${words} mots`
})

const focusMode = ref(false)
// Panneau d'édition du livre (Task 15) : ouvert par le bouton discret ⚙ de
// l'aside, fermé par son propre bouton « Fermer » ou Échap (BookSettingsPanel).
const settingsOpen = ref(false)
// Dialogue d'export (Task 9) : ouvert par le bouton « Exporter… » de l'aside,
// près du bouton d'édition ⚙ — fermé par Annuler/Échap/clic hors carte ou
// automatiquement après un export réussi (ExportDialog).
const exportOpen = ref(false)

// Panneau Claude (Task 6) : colonne droite ~360px, section chapitres
// uniquement, avec un chapitre ouvert (sinon rien à préparer/écrire).
const showAiPanel = computed(
  () => store.section === 'chapitres' && ai.open && !!store.currentChapter
)

// Piloté en JS plutôt que par une classe .focus figeant deux valeurs : la
// grille doit absorber une troisième piste (le panneau Claude) sans casser le
// centrage de l'éditeur (max-width: 44rem dans EditorPane, indépendant de
// cette grille). Le mode focus reste prioritaire (0 1fr) quel que soit l'état
// du panneau — s'il était ouvert avant d'entrer en focus, il réapparaît à la
// sortie du focus sans avoir eu besoin d'être refermé.
const gridColumns = computed(() => {
  if (focusMode.value) return '0 1fr'
  return showAiPanel.value ? '260px 1fr 360px' : '260px 1fr'
})

function navigateChapter(direction: -1 | 1): void {
  if (store.section !== 'chapitres') return
  if (!store.currentChapter) return
  const ids = store.chapters.map((c) => c.id)
  const next = ids[ids.indexOf(store.currentChapter.id) + direction]
  if (next != null) store.openChapter(next)
}

// Le focus mode et la navigation de chapitre n'ont de sens qu'en section
// chapitres (seule section avec un éditeur) : gardés en tête de handler
// plutôt que dé/re-liés à chaque changement de section, pour ne pas
// complexifier le cycle de vie de useShortcuts.
useShortcuts([
  {
    combo: 'meta+shift+f',
    handler: () => {
      if (store.section !== 'chapitres') return
      focusMode.value = !focusMode.value
    }
  },
  { combo: 'meta+alt+arrowdown', handler: () => navigateChapter(1) },
  { combo: 'meta+alt+arrowup', handler: () => navigateChapter(-1) },
  // Panneau Claude : même garde de section que le mode focus ci-dessus (n'a
  // de sens qu'en section chapitres — seule section avec un éditeur/un
  // chapitre à écrire). ⌘⇧K ne collisionne avec aucun autre raccourci de
  // l'app (⌘K = palette de commandes, App.vue ; ⌘⇧F = focus, ci-dessus).
  {
    combo: 'meta+shift+k',
    handler: () => {
      if (store.section !== 'chapitres') return
      ai.toggle()
    }
  },
  // No-op quand le mode focus est déjà inactif : Échap n'a alors aucun effet
  // sur l'état de l'app (rien n'est modifié). L'interface de useShortcuts
  // appelle toujours preventDefault() sur une combinaison reconnue, y compris
  // ici quand le mode focus est éteint ; c'est sans conséquence aujourd'hui
  // (aucun autre consommateur d'Échap dans cette vue) mais à surveiller si un
  // futur plan (palette ⌘K, modales) ajoute un usage concurrent d'Échap.
  { combo: 'escape', handler: () => focusMode.value && (focusMode.value = false) }
])

// Bascule du mode focus depuis la palette de commandes (⌘K). Même garde que
// le raccourci ⌘⇧F ci-dessus : le mode focus n'a de sens qu'en section
// chapitres, donc l'événement est un no-op ailleurs.
function onPaletteFocusToggle(): void {
  if (store.section !== 'chapitres') return
  focusMode.value = !focusMode.value
}
onMounted(() => window.addEventListener('palette:focus-toggle', onPaletteFocusToggle))
onBeforeUnmount(() => window.removeEventListener('palette:focus-toggle', onPaletteFocusToggle))
</script>

<template>
  <div class="book-space" :class="{ focus: focusMode }" :style="{ gridTemplateColumns: gridColumns }">
    <aside :aria-hidden="focusMode" :inert="focusMode">
      <!-- Bande de fenêtre (audit UI/UX, proposition #5) : titleBarStyle
           'hiddenInset' (src/main/index.ts) fond les feux tricolores dans
           l'aside --bg-panel — cette bande réserve l'espace au-dessus du
           bouton retour et le rend draggable (no-drag sur le bouton
           lui-même pour qu'il reste cliquable). -->
      <div class="drag-band">
        <button class="back" type="button" @click="router.push('/')">
          <span class="chevron">←</span> Bibliothèque
        </button>
      </div>
      <div v-if="store.book" class="header">
        <div class="title-row">
          <h1>{{ store.book.title }}</h1>
          <button
            class="edit-book"
            type="button"
            title="Modifier le livre"
            aria-label="Modifier le livre"
            @click="settingsOpen = true"
          >
            ⚙
          </button>
        </div>
        <button class="export-book" type="button" @click="exportOpen = true">Exporter…</button>
        <p class="meta">
          <span v-if="store.book.author">{{ store.book.author }}</span>
          <span v-if="store.book.author && store.book.genre" class="dot">·</span>
          <span v-if="store.book.genre">{{ store.book.genre }}</span>
          <span v-if="(store.book.author || store.book.genre) && store.book.seriesName" class="dot">·</span>
          <span v-if="store.book.seriesName">{{ store.book.seriesName }}</span>
        </p>
        <p class="progress">{{ progress }}</p>
      </div>
      <SectionNav />
      <ChapterList v-if="store.section === 'chapitres'" />
      <EntityList v-if="store.section === 'personnages'" kind="character" />
      <EntityList v-if="store.section === 'lieux'" kind="place" />
    </aside>
    <main>
      <!-- v-show plutôt que v-if : l'éditeur ne doit pas être démonté quand on
           quitte la section chapitres. store.currentChapter.contentJson est
           tenu à jour par saveContentFor (book.ts) donc un v-if ne
           réafficherait pas un contenu périmé — mais démonter l'éditeur
           perdrait quand même l'état de frappe/scroll/focus en cours au
           retour sur la section, d'où le choix de v-show. -->
      <div v-show="store.section === 'chapitres'" class="chapitres-view">
        <p v-if="!store.currentChapter" class="empty">Créez un chapitre pour commencer à écrire.</p>
        <template v-else>
          <EditorPane />
          <StatusBar />
        </template>
      </div>
      <EntitiesSection v-if="store.section === 'personnages'" kind="character" />
      <EntitiesSection v-if="store.section === 'lieux'" kind="place" />
      <OutlineSection v-if="store.section === 'plan'" />
      <TimelineSection v-if="store.section === 'chronologie'" />
    </main>
    <ClaudePanel v-if="showAiPanel" />
    <EntityDrawer />
    <BookSettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
    <ExportDialog v-if="exportOpen" @close="exportOpen = false" />
  </div>
</template>

<style scoped>
.book-space {
  /* grid-template-columns est piloté par le style inline `gridColumns`
     (script) : 260px 1fr en temps normal, +360px quand le panneau Claude est
     ouvert (section chapitres uniquement), 0 1fr en mode focus — trois cas
     qu'une simple classe .focus ne suffisait plus à exprimer. La transition
     reste déclarée ici : elle s'applique aussi bien à un changement de valeur
     posé via l'attribut style qu'à un changement de classe. */
  display: grid;
  height: 100vh;
  transition: grid-template-columns 0.2s ease;
}
.book-space.focus aside {
  opacity: 0;
  border-right-color: transparent;
  pointer-events: none;
}

aside {
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  opacity: 1;
  transition:
    opacity 0.15s ease,
    border-color 0.2s ease;
}

.drag-band {
  -webkit-app-region: drag;
  flex-shrink: 0;
  padding-top: 36px;
}

.back {
  -webkit-app-region: no-drag;
  align-self: flex-start;
  border: none;
  padding: 0 16px 14px;
  color: var(--fg-muted);
  font-size: 12px;
}
.back:hover {
  color: var(--accent);
}
.chevron {
  display: inline-block;
  transition: transform 0.15s ease;
}
.back:hover .chevron {
  transform: translateX(-2px);
}

.header {
  padding: 10px 18px 14px;
  border-bottom: 1px solid var(--border);
}
.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header h1 {
  flex: 1;
  min-width: 0;
  font-family: var(--font-manuscript);
  font-size: 19px;
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.edit-book {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
  border-color: transparent;
  color: var(--fg-muted);
  opacity: 0;
  transition:
    opacity 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}
.header:hover .edit-book,
.edit-book:focus-visible {
  opacity: 1;
}
.edit-book:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.export-book {
  align-self: flex-start;
  margin-top: 6px;
  padding: 0;
  border: none;
  color: var(--fg-muted);
  font-size: 12px;
}
.export-book:hover {
  color: var(--accent);
}
.header .meta {
  color: var(--fg-muted);
  font-size: 12px;
  margin-top: 4px;
}
.header .meta .dot {
  margin: 0 4px;
}
.header .progress {
  color: var(--fg-muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  margin-top: 6px;
}

main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.chapitres-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.empty {
  margin: auto;
  color: var(--fg-muted);
  text-align: center;
  font-size: 13px;
}
</style>
