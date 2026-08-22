<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import { mediaUrl } from '../utils/media'
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
const ui = useUiStore()

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
//
// Ce composant est RÉUTILISÉ d'une fiche à l'autre dans le motif
// maître-détail (T15, pas de :key sur <EntityCard> dans EntitiesSection) :
// taper dans un champ puis changer de sélection avant les 600 ms ne doit pas
// faire persister le commit contre la NOUVELLE fiche. Chaque commit capture
// donc l'id de la fiche (et la valeur à écrire) au moment de l'ARMEMENT du
// minuteur, jamais relus à l'échéance — et pendingCommits garde une
// référence à ce commit pour pouvoir le flusher immédiatement (changement de
// fiche, démontage) plutôt que de le perdre en l'annulant.
// `run` retourne désormais la promesse de store.update (au lieu d'un simple
// fire-and-forget) : c'est ce qui permet à flushAll(), appelé comme
// quit-flusher (voir onMounted plus bas), d'être réellement attendu par
// runQuitFlush() avant que la fenêtre ne se ferme. store.update ne rejette
// jamais (catch interne, voir stores/entities.ts), donc les Promise.all ici
// ne peuvent pas provoquer d'échec en cascade.
const timers: Partial<Record<string, ReturnType<typeof setTimeout>>> = {}
const pendingCommits: Partial<Record<string, () => Promise<void> | void>> = {}
function debounced(field: string, run: () => Promise<void> | void): void {
  clearTimeout(timers[field])
  pendingCommits[field] = run
  timers[field] = setTimeout(() => {
    delete pendingCommits[field]
    run()
  }, 600)
}
function flushAll(): Promise<void> {
  const pending: (Promise<void> | void)[] = []
  for (const field of Object.keys(pendingCommits)) {
    clearTimeout(timers[field])
    pending.push(pendingCommits[field]?.())
    delete pendingCommits[field]
  }
  return Promise.all(pending).then(() => undefined)
}

function onNameInput(): void {
  const id = props.entityId
  const value = entity.value?.name
  debounced('name', () => {
    if (value === undefined) return undefined
    return store.update(id, { name: value })
  })
}
function onDescriptionInput(): void {
  const id = props.entityId
  const value = entity.value?.description
  debounced('description', () => {
    if (value === undefined) return undefined
    return store.update(id, { description: value })
  })
}
function onNotesInput(): void {
  const id = props.entityId
  const value = entity.value?.notes
  debounced('notes', () => {
    if (value === undefined) return undefined
    return store.update(id, { notes: value })
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
  id: number
  key: string
  value: string
}
const attrPairs = ref<AttrPair[]>([])
// Identifiant stable par ligne (indépendant de la position) : la clé de
// v-for doit rester attachée à la même ligne après une suppression au
// milieu de la liste, sous peine de réassigner le focus/l'état DOM d'un
// <input> à la mauvaise paire.
let nextPairId = 0

function seedAttrPairs(): void {
  attrPairs.value = entity.value
    ? Object.entries(entity.value.attributes).map(([key, value]) => ({
        id: nextPairId++,
        key,
        value
      }))
    : []
}
onMounted(seedAttrPairs)
// flushAll() AVANT le reseed : un commit de champ texte encore en attente
// (capturé contre l'ancien id, voir plus haut) doit partir, et un debounce
// "attributes" encore en attente doit lire attrPairs.value tel qu'il est
// ENCORE pour l'ancienne fiche — sans quoi il se déclencherait plus tard
// contre les paires déjà reseedées de la nouvelle fiche.
watch(
  () => props.entityId,
  () => {
    flushAll()
    seedAttrPairs()
  }
)
// Démontage (grille personnages/lieux, ou fermeture du tiroir) : même
// raisonnement que le watch ci-dessus, pour la dernière fiche affichée par
// cette instance de carte.
onBeforeUnmount(flushAll)

// Quit-flusher (fermeture de l'app, pas juste démontage du composant) :
// chaque instance de carte (grille personnages/lieux, plusieurs cartes
// montées à la fois) s'abonne à son montage et se désabonne à son démontage,
// pour que le store ui n'appelle jamais flushAll() sur une instance déjà
// démontée. Ferme la même fenêtre de 600 ms que EditorPane pour les champs de
// fiche édités juste avant un quit.
let unsubscribeQuitFlusher: (() => void) | null = null
onMounted(() => {
  unsubscribeQuitFlusher = ui.addQuitFlusher(() => flushAll())
})
onBeforeUnmount(() => {
  unsubscribeQuitFlusher?.()
})

// Deux lignes avec la même clé (une fois espaces de bord retirés) : côté
// serveur, la dernière valeur écrase silencieusement l'autre — et sans
// signal visuel, la ligne perdante semble juste disparaître au prochain
// reseed. On ne bloque rien (pas de modale), on se contente de marquer les
// lignes en conflit pour que l'utilisateur comprenne pourquoi.
const duplicateKeys = computed<Set<string>>(() => {
  const counts = new Map<string, number>()
  for (const pair of attrPairs.value) {
    const key = pair.key.trim()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const dupes = new Set<string>()
  for (const [key, count] of counts) if (count > 1) dupes.add(key)
  return dupes
})
function isDuplicateKey(pair: AttrPair): boolean {
  const key = pair.key.trim()
  return key.length > 0 && duplicateKeys.value.has(key)
}

function buildAttributesRecord(): Record<string, string> {
  const record: Record<string, string> = {}
  for (const pair of attrPairs.value) {
    const key = pair.key.trim()
    if (key) record[key] = pair.value
  }
  return record
}
// Appelé directement (pas via le debounce) pour une action discrète
// (suppression d'une ligne) : agit sur la fiche courante, donc props.entityId
// lu ici est fiable.
function commitAttributesNow(): void {
  clearTimeout(timers.attributes)
  delete pendingCommits.attributes
  store.update(props.entityId, { attributes: buildAttributesRecord() })
}
function commitAttributesDebounced(): void {
  const id = props.entityId
  debounced('attributes', () => store.update(id, { attributes: buildAttributesRecord() }))
}
function addAttrPair(): void {
  attrPairs.value.push({ id: nextPairId++, key: '', value: '' })
}
function removeAttrPair(index: number): void {
  attrPairs.value.splice(index, 1)
  commitAttributesNow()
}

// --- Image ---------------------------------------------------------------
// imagePath est un chemin absolu côté disque ; affiché via le protocole
// encre-media (mediaUrl), seule voie autorisée par la CSP du renderer
// (img-src 'self' data: encre-media: — voir index.html). On bascule sur un
// monogramme dès que le navigateur signale l'échec (fichier déplacé/supprimé
// hors de l'app, par ex.).
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
        :src="mediaUrl(entity.imagePath) ?? undefined"
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
      <div
        v-for="(pair, index) in attrPairs"
        :key="pair.id"
        class="attr-row"
        :class="{ duplicate: isDuplicateKey(pair) }"
        :title="isDuplicateKey(pair) ? 'Clé en double — la dernière valeur l\'emporte' : undefined"
      >
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
/* Plafond (Task 4b) : .notes n'est pas auto-grow en JS (redimensionnement
   manuel via `resize: vertical` ci-dessus, comme .description) mais peut
   contenir des notes très longues — sans plafond, un glisser-déposer de la
   poignée de redimensionnement pouvait l'étirer sans limite. .description
   reste inchangé (pas concerné par le bug rapporté — texte plus court en
   pratique, et hors du périmètre de l'audit puisque non auto-grow). */
.notes {
  max-height: 40vh;
  overflow-y: auto;
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
/* Clé en double (voir isDuplicateKey) : liseré rouge dérivé des tokens de
   thème plutôt qu'une couleur d'erreur figée, pour rester cohérent en clair
   comme en sombre. Signal discret, pas de modale. */
.attr-row.duplicate input {
  border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
}
.attr-row.duplicate input:focus {
  border-color: color-mix(in srgb, var(--danger) 70%, var(--accent));
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
