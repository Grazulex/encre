<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import { useBookStore } from '../stores/book'
import type { EntityOccurrence } from '../../../shared/types'

const props = defineProps<{
  entityId: number
  compact?: boolean
  // Fourni par EntityDrawer (store.occurrences, déjà chargées par
  // openDrawer) : évite un second aller-retour IPC pour la même fiche.
  // Absent en grille : chaque carte charge ses propres occurrences.
  occurrencesOverride?: EntityOccurrence[]
}>()

const store = useEntitiesStore()
const bookStore = useBookStore()

const entity = computed(() => store.entities.find((e) => e.id === props.entityId) ?? null)

// --- Occurrences -----------------------------------------------------
const localOccurrences = ref<EntityOccurrence[]>([])

async function loadOccurrences(): Promise<void> {
  if (props.occurrencesOverride) return
  try {
    localOccurrences.value = await window.encre.entities.occurrences(props.entityId)
  } catch (err) {
    console.error('Échec du chargement des occurrences', err)
  }
}
onMounted(loadOccurrences)
watch(() => props.entityId, loadOccurrences)

const occurrences = computed(() => props.occurrencesOverride ?? localOccurrences.value)

function goToOccurrence(chapterId: number): void {
  bookStore.openChapter(chapterId)
  bookStore.setSection('chapitres')
  store.closeDrawer()
}

// --- Sauvegarde debouncée par champ -----------------------------------
// Chaque champ texte a son propre minuteur : la frappe dans "notes" ne doit
// pas être retardée (ni écrasée) par le debounce de "description". Le
// store.update() sous-jacent ne réconcilie que les clés du patch envoyé,
// donc deux champs sauvegardés à des instants différents ne s'écrasent
// jamais l'un l'autre (voir stores/entities.ts).
const timers: Partial<Record<string, ReturnType<typeof setTimeout>>> = {}
function debounced(field: string, run: () => void): void {
  clearTimeout(timers[field])
  timers[field] = setTimeout(run, 600)
}

function onNameInput(): void {
  debounced('name', () => {
    if (entity.value) store.update(props.entityId, { name: entity.value.name })
  })
}
function onDescriptionInput(): void {
  debounced('description', () => {
    if (entity.value) store.update(props.entityId, { description: entity.value.description })
  })
}
function onNotesInput(): void {
  debounced('notes', () => {
    if (entity.value) store.update(props.entityId, { notes: entity.value.notes })
  })
}

// --- Alias : actions discrètes (ajout/suppression), pas de debounce ----
const newAlias = ref('')
function addAlias(): void {
  const value = newAlias.value.trim()
  if (!value || !entity.value || entity.value.aliases.includes(value)) {
    newAlias.value = ''
    return
  }
  entity.value.aliases.push(value)
  newAlias.value = ''
  store.update(props.entityId, { aliases: [...entity.value.aliases] })
}
function removeAlias(index: number): void {
  if (!entity.value) return
  entity.value.aliases.splice(index, 1)
  store.update(props.entityId, { aliases: [...entity.value.aliases] })
}

// --- Attributs clé/valeur ----------------------------------------------
// Copie de travail locale, initialisée une seule fois par fiche affichée :
// si elle était re-dérivée à chaque changement de entity.attributes, la
// réconciliation d'un autre champ (ou la propre sauvegarde de ce champ)
// pourrait effacer une paire en cours d'édition (ex. une ligne fraîchement
// ajoutée, clé encore vide).
interface AttrPair {
  key: string
  value: string
}
const attrPairs = ref<AttrPair[]>([])

function seedAttrPairs(): void {
  attrPairs.value = entity.value
    ? Object.entries(entity.value.attributes).map(([key, value]) => ({ key, value }))
    : []
}
onMounted(seedAttrPairs)
watch(() => props.entityId, seedAttrPairs)

function commitAttributesNow(): void {
  clearTimeout(timers.attributes)
  const record: Record<string, string> = {}
  for (const pair of attrPairs.value) {
    const key = pair.key.trim()
    if (key) record[key] = pair.value
  }
  store.update(props.entityId, { attributes: record })
}
function commitAttributesDebounced(): void {
  debounced('attributes', commitAttributesNow)
}
function addAttrPair(): void {
  attrPairs.value.push({ key: '', value: '' })
}
function removeAttrPair(index: number): void {
  attrPairs.value.splice(index, 1)
  commitAttributesNow()
}

// --- Image ---------------------------------------------------------------
// imagePath est un chemin absolu ; la CSP du renderer (img-src 'self' data:)
// bloque le chargement d'un <img src="file://…"> — voir index.html. On
// tente quand même l'affichage (au cas où la politique change) et on bascule
// sur un monogramme dès que le navigateur signale l'échec.
const imgFailed = ref(false)
watch(
  () => entity.value?.imagePath,
  () => (imgFailed.value = false)
)
const initials = computed(() => (entity.value?.name.trim().slice(0, 1) || '?').toUpperCase())

async function choosePicture(): Promise<void> {
  await store.pickImage(props.entityId)
}

function removeEntity(): void {
  store.remove(props.entityId)
}
</script>

<template>
  <article v-if="entity" class="card" :class="{ compact }">
    <button
      v-if="!compact"
      class="open-drawer"
      type="button"
      title="Ouvrir dans le tiroir"
      aria-label="Ouvrir dans le tiroir"
      @click="store.openDrawer(entityId)"
    >
      ⤢
    </button>
    <button
      v-if="!compact"
      class="delete"
      type="button"
      title="Supprimer"
      aria-label="Supprimer cette fiche"
      @click="removeEntity"
    >
      ×
    </button>

    <div class="avatar">
      <img
        v-if="entity.imagePath && !imgFailed"
        :src="`file://${entity.imagePath}`"
        alt=""
        @error="imgFailed = true"
      />
      <span v-else>{{ initials }}</span>
    </div>
    <button class="pick-image" type="button" @click="choosePicture">Choisir une image</button>

    <input v-model="entity.name" class="name" type="text" placeholder="Nom" @input="onNameInput" />

    <div class="aliases">
      <span v-for="(alias, index) in entity.aliases" :key="alias" class="chip">
        {{ alias }}
        <button type="button" title="Retirer cet alias" @click="removeAlias(index)">×</button>
      </span>
      <input
        v-model="newAlias"
        class="alias-input"
        type="text"
        placeholder="+ alias"
        @keydown.enter.prevent="addAlias"
        @blur="addAlias"
      />
    </div>

    <textarea
      v-model="entity.description"
      class="description"
      rows="2"
      placeholder="Description"
      @input="onDescriptionInput"
    ></textarea>

    <div class="attributes">
      <h4>Attributs</h4>
      <div v-for="(pair, index) in attrPairs" :key="index" class="attr-row">
        <input
          v-model="pair.key"
          type="text"
          placeholder="Clé"
          @input="commitAttributesDebounced"
        />
        <input
          v-model="pair.value"
          type="text"
          placeholder="Valeur"
          @input="commitAttributesDebounced"
        />
        <button type="button" title="Retirer cet attribut" @click="removeAttrPair(index)">×</button>
      </div>
      <button class="add-attr" type="button" @click="addAttrPair">+ Ajouter un attribut</button>
    </div>

    <textarea
      v-model="entity.notes"
      class="notes"
      rows="3"
      placeholder="Notes"
      @input="onNotesInput"
    ></textarea>

    <div class="occurrences">
      <h4>Apparaît dans</h4>
      <ul v-if="occurrences.length">
        <li v-for="occ in occurrences" :key="occ.chapterId">
          <button type="button" @click="goToOccurrence(occ.chapterId)">
            {{ occ.chapterTitle }}
          </button>
        </li>
      </ul>
      <p v-else class="empty">Aucune mention pour l'instant.</p>
    </div>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
}

.open-drawer,
.delete {
  position: absolute;
  top: 8px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-panel);
  color: var(--fg-muted);
  padding: 0;
  font-size: 12px;
  line-height: 1;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}
.card:hover .open-drawer,
.card:hover .delete,
.card:focus-within .open-drawer,
.card:focus-within .delete {
  opacity: 1;
}
.open-drawer {
  right: 36px;
}
.delete {
  right: 8px;
  font-size: 14px;
}
.open-drawer:hover,
.delete:hover {
  color: var(--fg);
  border-color: var(--fg-muted);
}

.avatar {
  align-self: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(
    155deg,
    var(--accent) 0%,
    color-mix(in srgb, var(--accent) 42%, var(--bg)) 100%
  );
  box-shadow: 0 1px 3px color-mix(in srgb, var(--fg) 20%, transparent);
}
.card.compact .avatar {
  width: 48px;
  height: 48px;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar span {
  font-family: var(--font-manuscript);
  font-size: 1.6rem;
  font-weight: 600;
  color: var(--bg);
}

.pick-image {
  align-self: center;
  font-size: 11.5px;
  padding: 3px 10px;
  color: var(--fg-muted);
  border-color: transparent;
}
.pick-image:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.name {
  text-align: center;
  font-family: var(--font-manuscript);
  font-size: 16px;
  font-weight: 600;
  border-color: transparent;
  background: transparent;
  padding: 2px 4px;
}
.name:focus {
  background: var(--bg);
}

.aliases {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  border-radius: 100px;
  padding: 2px 4px 2px 9px;
  font-size: 11.5px;
  font-weight: 500;
}
.chip button {
  border: none;
  padding: 0 4px;
  color: inherit;
  font-size: 12px;
  line-height: 1;
  opacity: 0.7;
}
.chip button:hover {
  opacity: 1;
}
.alias-input {
  border: 1px dashed var(--border);
  background: transparent;
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 100px;
  width: 80px;
  flex-shrink: 0;
}

.description,
.notes {
  width: 100%;
  resize: vertical;
  font-size: 12.5px;
  line-height: 1.5;
}

.attributes h4,
.occurrences h4 {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
  margin-bottom: 6px;
}

.attr-row {
  display: flex;
  gap: 5px;
  margin-bottom: 5px;
}
.attr-row input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 4px 8px;
}
.attr-row button {
  flex-shrink: 0;
  border: none;
  padding: 0 6px;
  color: var(--fg-muted);
  font-size: 13px;
}
.attr-row button:hover {
  color: var(--fg);
}
.add-attr {
  font-size: 11.5px;
  padding: 3px 8px;
  color: var(--fg-muted);
  border-style: dashed;
}
.add-attr:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.occurrences ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.occurrences li button {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  padding: 4px 6px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--fg);
}
.occurrences li button:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}
.occurrences .empty {
  font-size: 11.5px;
  color: var(--fg-muted);
}

.card.compact {
  border: none;
  border-radius: 0;
  padding: 18px 16px;
}
</style>
