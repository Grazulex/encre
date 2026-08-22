<script setup lang="ts">
// Une carte de la chronologie (Task 14) : date libre, titre, description,
// badges de liens (chapitres/entités) cliquables, et un popover de la carte
// pour choisir ces liens. Le glisser-déposer et les boutons ↑/↓ sont gérés
// ici (via l'index de l'événement dans le store, seule source de vérité de
// l'ordre) ; le rail (ligne + pastille + zone de dépôt) est dessiné par le
// parent TimelineSection.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useTimelineStore } from '../stores/timeline'
import { useBookStore } from '../stores/book'
import { useEntitiesStore } from '../stores/entities'

const props = defineProps<{ eventId: number }>()

const store = useTimelineStore()
const bookStore = useBookStore()
const entitiesStore = useEntitiesStore()

const event = computed(() => store.events.find((e) => e.id === props.eventId) ?? null)

const index = computed(() => store.events.findIndex((e) => e.id === props.eventId))
const canMoveUp = computed(() => index.value > 0)
const canMoveDown = computed(() => index.value >= 0 && index.value < store.events.length - 1)

function moveUp(): void {
  const i = index.value
  if (i <= 0) return
  ;[store.events[i - 1], store.events[i]] = [store.events[i], store.events[i - 1]]
  store.reorder(store.events.map((e) => e.id))
}
function moveDown(): void {
  const i = index.value
  if (i < 0 || i >= store.events.length - 1) return
  ;[store.events[i], store.events[i + 1]] = [store.events[i + 1], store.events[i]]
  store.reorder(store.events.map((e) => e.id))
}

// --- Résolution des badges (chapitres/entités liés) ---------------------
// Passe par les stores (déjà chargés par BookView) plutôt que de garder une
// copie ; repli explicite si la fiche/le chapitre référencé a été supprimé
// depuis — l'id reste dans event_chapters/event_entities jusqu'à un
// setLinks() ultérieur mais ne doit jamais faire planter le rendu.
const linkedChapters = computed(() => {
  if (!event.value) return []
  return event.value.chapterIds.map((id) => {
    const meta = bookStore.chapters.find((c) => c.id === id)
    return { id, label: meta?.title ?? 'Chapitre supprimé', missing: !meta }
  })
})
const linkedEntities = computed(() => {
  if (!event.value) return []
  return event.value.entityIds.map((id) => {
    const entity = entitiesStore.entities.find((e) => e.id === id)
    return { id, label: entity?.name ?? 'Fiche supprimée', missing: !entity }
  })
})

function openChapterBadge(id: number): void {
  bookStore.openChapter(id)
  bookStore.setSection('chapitres')
}
function openEntityBadge(id: number): void {
  entitiesStore.openDrawer(id)
}

// --- Sauvegarde debouncée par champ (600 ms, comme EntityCard) ----------
const timers: Partial<Record<string, ReturnType<typeof setTimeout>>> = {}
function debounced(field: string, run: () => void): void {
  clearTimeout(timers[field])
  timers[field] = setTimeout(run, 600)
}
function onDateInput(): void {
  debounced('dateLabel', () => {
    if (event.value) store.update(props.eventId, { dateLabel: event.value.dateLabel })
  })
}
function onTitleInput(): void {
  debounced('title', () => {
    if (event.value) store.update(props.eventId, { title: event.value.title })
  })
}
function onDescriptionInput(e: Event): void {
  autoGrow(e.target as HTMLTextAreaElement)
  debounced('description', () => {
    if (event.value) store.update(props.eventId, { description: event.value.description })
  })
}
// Sans ce nettoyage, un debounce encore en attente (champ édité juste avant
// suppression de l'événement) se déclencherait après le démontage de cette
// carte avec l'id d'un événement qui n'existe plus côté renderer (leçon de
// OutlineSection.removeNote / Task 13).
onBeforeUnmount(() => {
  for (const t of Object.values(timers)) clearTimeout(t)
})

// --- Auto-grow de la description ----------------------------------------
const descRef = ref<HTMLTextAreaElement | null>(null)
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
onMounted(() => {
  if (descRef.value) autoGrow(descRef.value)
})

// --- Titre autofocus à la création (TimelineSection.addEvent) ----------
const titleRef = ref<HTMLInputElement | null>(null)
function focusTitle(): void {
  titleRef.value?.focus()
}
defineExpose({ focusTitle })

// --- Popover de liens (chapitres/entités du livre) ----------------------
// Téléporté dans <body> (Teleport) et positionné en `position: fixed` à
// partir du rectangle du bouton « + Lier » : la carte vit dans `.rail`,
// scrollable (`.section { overflow-y: auto }`) dans TimelineSection — un
// popover simplement `position: absolute` à l'intérieur y serait rogné par
// ce conteneur dès que la carte n'est pas tout en haut de la liste (vérifié
// par une reproduction isolée : `overflow-y: auto` d'un ancêtre clippe bien
// un descendant en position absolue qui le dépasse, y compris pour le test
// de collision — `elementFromPoint` ne retrouve plus l'élément passé la
// limite du conteneur). Le Teleport sort le popover de ce conteneur, réglant
// le problème à la racine plutôt que par un correctif de z-index (inefficace
// ici, le clipping n'est pas un problème d'empilement).
const popoverOpen = ref(false)
const popoverEl = ref<HTMLElement | null>(null)
const toggleRef = ref<HTMLElement | null>(null)
const popoverPos = ref({ top: 0, left: 0 })

function updatePopoverPosition(): void {
  const rect = toggleRef.value?.getBoundingClientRect()
  if (!rect) return
  // Un simple clamp horizontal (pas de logique de retournement au-dessus du
  // bouton) : suffisant pour rester dans la fenêtre sans complexifier un
  // popover qui reste par ailleurs simple, conformément au brief.
  popoverPos.value = {
    top: rect.bottom + 6,
    left: Math.min(rect.left, window.innerWidth - 296)
  }
}

async function openPopover(): Promise<void> {
  updatePopoverPosition()
  popoverOpen.value = true
  // Repositionne tant que le popover est ouvert : un défilement de la liste
  // (capture:true, car un scroll sur `.section` ne remonte pas forcément
  // jusqu'à window en phase bulle) ou un redimensionnement de la fenêtre ne
  // doit pas laisser le popover décroché de son bouton.
  window.addEventListener('scroll', updatePopoverPosition, true)
  window.addEventListener('resize', updatePopoverPosition)
  await nextTick()
  popoverEl.value?.focus()
}
function closePopover(): void {
  popoverOpen.value = false
  window.removeEventListener('scroll', updatePopoverPosition, true)
  window.removeEventListener('resize', updatePopoverPosition)
}
// Échap intercepté ICI, en stoppant la propagation dès ce nœud — même
// principe que AutolinkDialog/EntityDrawer : le focus est déplacé sur le
// popover à l'ouverture (ci-dessus) pour que ce handler reçoive bien le
// prochain Échap plutôt que le listener global de mode focus (BookView).
function onPopoverKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closePopover()
  }
}
// Clic hors du popover : fermeture, comme un menu déroulant standard.
// mousedown (pas click) pour fermer avant qu'un éventuel click sur un autre
// élément de la carte ne s'exécute. Fonctionne sans changement malgré le
// Teleport : Node.contains() suit l'arbre DOM réel, pas la position visuelle
// d'origine du nœud dans le template.
function onDocumentMousedown(e: MouseEvent): void {
  if (!popoverOpen.value) return
  if (popoverEl.value && !popoverEl.value.contains(e.target as Node)) closePopover()
}
onMounted(() => window.addEventListener('mousedown', onDocumentMousedown))
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDocumentMousedown)
  // Défensif : si la carte est démontée (événement supprimé) pendant que son
  // popover est ouvert, ces listeners ne doivent pas survivre au composant.
  window.removeEventListener('scroll', updatePopoverPosition, true)
  window.removeEventListener('resize', updatePopoverPosition)
})

function isChapterLinked(id: number): boolean {
  return event.value?.chapterIds.includes(id) ?? false
}
function isEntityLinked(id: number): boolean {
  return event.value?.entityIds.includes(id) ?? false
}
function toggleChapterLink(id: number): void {
  if (!event.value) return
  const ids = isChapterLinked(id)
    ? event.value.chapterIds.filter((c) => c !== id)
    : [...event.value.chapterIds, id]
  store.setLinks(props.eventId, ids, event.value.entityIds)
}
function toggleEntityLink(id: number): void {
  if (!event.value) return
  const ids = isEntityLinked(id)
    ? event.value.entityIds.filter((e) => e !== id)
    : [...event.value.entityIds, id]
  store.setLinks(props.eventId, event.value.chapterIds, ids)
}

function removeEvent(): void {
  store.remove(props.eventId)
}
</script>

<template>
  <article v-if="event" class="card">
    <div class="row-top">
      <input
        v-model="event.dateLabel"
        class="date"
        type="text"
        placeholder="An 3, printemps · 12 mars 1892…"
        @input="onDateInput"
      />
      <span class="controls">
        <button :disabled="!canMoveUp" type="button" title="Monter" @click="moveUp">↑</button>
        <button :disabled="!canMoveDown" type="button" title="Descendre" @click="moveDown">
          ↓
        </button>
        <button type="button" title="Supprimer" @click="removeEvent">×</button>
      </span>
    </div>

    <input
      ref="titleRef"
      v-model="event.title"
      class="title"
      type="text"
      placeholder="Titre de l'événement"
      @input="onTitleInput"
    />

    <textarea
      ref="descRef"
      v-model="event.description"
      class="description"
      rows="1"
      placeholder="Description…"
      @input="onDescriptionInput"
    ></textarea>

    <div class="links">
      <button
        v-for="c in linkedChapters"
        :key="`c${c.id}`"
        type="button"
        class="badge badge-chapter"
        :class="{ missing: c.missing }"
        :disabled="c.missing"
        @click="openChapterBadge(c.id)"
      >
        ◆ {{ c.label }}
      </button>
      <button
        v-for="e in linkedEntities"
        :key="`e${e.id}`"
        type="button"
        class="badge badge-entity"
        :class="{ missing: e.missing }"
        :disabled="e.missing"
        @click="openEntityBadge(e.id)"
      >
        ● {{ e.label }}
      </button>

      <span class="link-picker">
        <button ref="toggleRef" type="button" class="link-toggle" @click="openPopover">
          + Lier
        </button>
        <Teleport to="body">
          <div
            v-if="popoverOpen"
            ref="popoverEl"
            class="popover"
            role="dialog"
            aria-label="Lier des chapitres et des fiches"
            tabindex="-1"
            :style="{ top: `${popoverPos.top}px`, left: `${popoverPos.left}px` }"
            @keydown="onPopoverKeydown"
          >
            <section class="popover-group">
              <h4>Chapitres</h4>
              <p v-if="bookStore.chapters.length === 0" class="popover-empty">Aucun chapitre.</p>
              <label v-for="c in bookStore.chapters" :key="c.id" class="popover-row">
                <input
                  type="checkbox"
                  :checked="isChapterLinked(c.id)"
                  @change="toggleChapterLink(c.id)"
                />
                <span>{{ c.title }}</span>
              </label>
            </section>
            <section class="popover-group">
              <h4>Personnages &amp; lieux</h4>
              <p v-if="entitiesStore.entities.length === 0" class="popover-empty">Aucune fiche.</p>
              <label v-for="e in entitiesStore.entities" :key="e.id" class="popover-row">
                <input
                  type="checkbox"
                  :checked="isEntityLinked(e.id)"
                  @change="toggleEntityLink(e.id)"
                />
                <span>{{ e.name }}</span>
              </label>
            </section>
          </div>
        </Teleport>
      </span>
    </div>
  </article>
</template>

<style scoped>
.card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
}

.row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.date {
  border: none;
  background: none;
  padding: 2px 0;
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
  min-width: 0;
  flex: 1;
}
.date:focus {
  color: var(--fg);
}

.controls {
  flex-shrink: 0;
  display: flex;
  gap: 1px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.card:hover .controls,
.card:focus-within .controls {
  opacity: 1;
}
.controls button {
  border: none;
  padding: 2px 6px;
  font-size: 12px;
  border-radius: 4px;
  color: var(--fg-muted);
}
.controls button:hover:not(:disabled) {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}
.controls button:disabled {
  opacity: 0.25;
  cursor: default;
}

.title {
  border: none;
  background: none;
  padding: 0;
  font-family: var(--font-manuscript);
  font-size: 16px;
  font-weight: 600;
}

.description {
  border: none;
  background: none;
  padding: 0;
  resize: none;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.55;
  color: var(--fg-muted);
}
.description:focus {
  color: var(--fg);
}

.links {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 100px;
  border: none;
}
.badge-chapter {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}
.badge-entity {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: color-mix(in srgb, var(--accent) 75%, var(--fg-muted));
}
.badge:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.badge.missing {
  background: transparent;
  color: var(--fg-muted);
  border: 1px dashed var(--border);
  cursor: default;
}

.link-toggle {
  font-size: 11.5px;
  padding: 3px 9px;
  color: var(--fg-muted);
  border-style: dashed;
  border-radius: 100px;
}
.link-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* `position: fixed` (pas `absolute`) : le popover est téléporté dans <body>
   (voir <Teleport> dans le template) pour échapper au clipping de
   `.section { overflow-y: auto }` dans TimelineSection — un popover
   simplement absolu à l'intérieur de ce conteneur défilant serait rogné dès
   que la carte n'est pas tout en haut de la liste. `top`/`left` sont donc
   calculés en JS (popoverPos, coordonnées viewport) plutôt que fixés en CSS
   relativement à `.link-picker`. */
.popover {
  position: fixed;
  z-index: 90;
  width: 280px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 40px -16px color-mix(in srgb, var(--fg) 40%, transparent);
  padding: 10px;
}
.popover:focus,
.popover:focus-visible {
  outline: none;
}

.popover-group + .popover-group {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.popover-group h4 {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
  margin-bottom: 4px;
}
.popover-empty {
  font-size: 12px;
  color: var(--fg-muted);
  padding: 4px 2px;
}
.popover-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12.5px;
}
.popover-row:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.popover-row input[type='checkbox'] {
  accent-color: var(--accent);
}
</style>
