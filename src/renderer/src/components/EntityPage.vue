<script setup lang="ts">
// Fiche personnage/lieu en pleine page (Task D3, retour utilisateur) : la
// section personnages/lieux utilisait jusqu'ici EntityCard (une carte de
// grille, héritée d'avant le passage de la liste à gauche — Task 15) qui
// n'occupait qu'une petite portion de l'espace disponible à droite. Ce
// composant remplace ce corps par une expérience en parité avec l'éditeur de
// chapitre : en-tête généreux (portrait + nom + alias) puis sections pleine
// largeur (description, notes, attributs, occurrences, chronologie liée).
//
// Toute la logique de champ (debounce, alias, attributs, occurrences, image,
// suppression) vient de useEntityFieldEditor, PARTAGÉE avec EntityCard (tiroir
// de quick-peek, Task 11) — voir son commentaire d'en-tête pour le
// raisonnement sur le montage par :key. Seul le balisage/gabarit diffère
// entre les deux : ici pensé pour occuper toute la largeur de la section,
// là-bas pour tenir dans les 340px du tiroir.
import { computed, onMounted, ref } from 'vue'
import { useEntityFieldEditor } from '../composables/useEntityFieldEditor'
import { useBookStore } from '../stores/book'
import { useEntitiesStore } from '../stores/entities'
import { useTimelineStore } from '../stores/timeline'
import { mediaUrl } from '../utils/media'
import { autoGrowClamped } from '../utils/autoGrow'
import ConfirmDialog from './ConfirmDialog.vue'
import type { EntityKind } from '../../../shared/types'

const props = defineProps<{ entityId: number }>()

const bookStore = useBookStore()
const entitiesStore = useEntitiesStore()
const timelineStore = useTimelineStore()

// EntityDrawer reste monté (dans BookView) quel que soit le changement de
// section : un tiroir ouvert depuis une mention pendant l'écriture, laissé
// ouvert, peut donc coexister avec cette page si l'auteur bascule sur
// personnages/lieux et sélectionne la MÊME fiche. Les deux monteraient alors
// chacun leur propre instance de useEntityFieldEditor — donc leur propre
// copie locale d'attrPairs — et leurs sauvegardes debouncées pourraient
// s'écraser silencieusement l'une l'autre. Cette page étant remontée par
// :key="entityId" (voir EntitiesSection) à chaque changement de sélection,
// ce contrôle au montage suffit : aucun moyen d'ouvrir un tiroir tant que la
// section personnages/lieux reste affichée (le tiroir ne s'ouvre que depuis
// l'éditeur ou une carte de chronologie, deux vues d'une autre section), donc
// aucun watch supplémentaire n'est nécessaire pour la durée de vie de cette
// instance.
onMounted(() => {
  if (entitiesStore.drawerEntityId === props.entityId) entitiesStore.closeDrawer()
})

const {
  entity,
  occurrences,
  goToOccurrence,
  onNameInput,
  onDescriptionInput,
  onNotesInput,
  newAlias,
  addAlias,
  removeAlias,
  attrPairs,
  isDuplicateKey,
  commitAttributesDebounced,
  addAttrPair,
  removeAttrPair,
  imgFailed,
  initials,
  choosePicture,
  confirmingRemoval,
  requestRemoval,
  cancelRemoval,
  confirmRemoval,
  removalMessage
} = useEntityFieldEditor(props.entityId)

const KIND_LABELS: Record<EntityKind, string> = { character: 'Personnage', place: 'Lieu' }
const kindLabel = computed(() => (entity.value ? KIND_LABELS[entity.value.kind] : ''))

// --- Description/Notes : auto-grow plafonné (utilitaire commun de la
// maison, utils/autoGrow.ts — mêmes 40vh que les notes de chapitre
// d'EditorPane et les descriptions d'événement de TimelineEventCard). Ces
// deux champs n'étaient PAS auto-grow dans l'ancienne EntityCard (simple
// `resize: vertical` + plafond CSS sur .notes seulement) : la pleine page a
// la place d'appliquer le motif complet dès la première frappe, sans attendre
// que l'auteur redimensionne à la main. -----------------------------------
const descRef = ref<HTMLTextAreaElement | null>(null)
const notesRef = ref<HTMLTextAreaElement | null>(null)
function onDescriptionAreaInput(event: Event): void {
  autoGrowClamped(event.target as HTMLTextAreaElement)
  onDescriptionInput()
}
function onNotesAreaInput(event: Event): void {
  autoGrowClamped(event.target as HTMLTextAreaElement)
  onNotesInput()
}
// Composant remonté (:key="entityId", voir EntitiesSection) à chaque
// changement de sélection : un seul passage au montage suffit à donner leur
// hauteur initiale aux deux textareas, pas de watch(entityId) nécessaire.
onMounted(() => {
  if (descRef.value) autoGrowClamped(descRef.value)
  if (notesRef.value) autoGrowClamped(notesRef.value)
})

// --- Chronologie liée --------------------------------------------------
// timelineStore.events est chargé eagerly par BookView (comme entitiesStore,
// voir son onMounted) précisément pour ce besoin : un simple filtre sur un
// tableau déjà en mémoire, aucun aller-retour IPC propre à cette page — donc
// bien « cheap » au sens du brief, contrairement à un endpoint dédié qu'il
// aurait fallu créer.
const linkedEvents = computed(() =>
  timelineStore.events.filter((event) => event.entityIds.includes(props.entityId))
)
// Pas de scroll-jusqu'à-l'événement (TimelineEventCard n'expose aucune
// ancre) : on se contente de basculer sur la section, comme le badge
// chapitre le fait pour les occurrences ci-dessus.
function goToTimelineEvent(): void {
  bookStore.setSection('chronologie')
}
</script>

<template>
  <article v-if="entity" class="page">
    <header class="head">
      <button class="delete-fiche" type="button" @click="requestRemoval">
        Supprimer la fiche
      </button>
      <div class="identity">
        <div class="portrait-wrap">
          <div class="portrait">
            <img
              v-if="entity.imagePath && !imgFailed"
              :src="mediaUrl(entity.imagePath) ?? undefined"
              alt=""
              @error="imgFailed = true"
            />
            <span v-else>{{ initials }}</span>
          </div>
          <button class="pick-image" type="button" @click="choosePicture">
            Choisir une image
          </button>
        </div>
        <div class="identity-main">
          <span class="kind-badge">{{ kindLabel }}</span>
          <input
            v-model="entity.name"
            class="name"
            type="text"
            placeholder="Nom"
            @input="onNameInput"
          />
          <div class="aliases">
            <span v-for="(alias, index) in entity.aliases" :key="alias" class="chip">
              {{ alias }}
              <button
                type="button"
                title="Retirer cet alias"
                :aria-label="`Retirer l'alias « ${alias} »`"
                @click="removeAlias(index)"
              >
                ×
              </button>
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
        </div>
      </div>
    </header>

    <section class="block">
      <span class="field-label">Description</span>
      <textarea
        ref="descRef"
        v-model="entity.description"
        class="desc-text"
        rows="2"
        placeholder="Qui ou quoi est-ce, en quelques phrases ?"
        @input="onDescriptionAreaInput"
      ></textarea>
    </section>

    <section class="block">
      <span class="field-label">Notes</span>
      <textarea
        ref="notesRef"
        v-model="entity.notes"
        class="notes-text"
        rows="3"
        placeholder="Notes libres, pistes, révélations à venir…"
        @input="onNotesAreaInput"
      ></textarea>
    </section>

    <section class="block">
      <span class="field-label">Attributs</span>
      <div class="attr-grid">
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
          <button
            type="button"
            title="Retirer cet attribut"
            :aria-label="pair.key ? `Retirer l'attribut « ${pair.key} »` : 'Retirer cet attribut'"
            @click="removeAttrPair(index)"
          >
            ×
          </button>
        </div>
        <p v-if="attrPairs.length === 0" class="empty-hint">Aucun attribut pour l'instant.</p>
      </div>
      <button class="add-attr" type="button" @click="addAttrPair">+ Ajouter un attribut</button>
    </section>

    <section class="block">
      <span class="field-label">Apparaît dans</span>
      <ul v-if="occurrences.length" class="ref-list">
        <li v-for="occ in occurrences" :key="occ.chapterId">
          <button type="button" @click="goToOccurrence(occ.chapterId)">
            <span class="ref-badge">◆</span> {{ occ.chapterTitle }}
          </button>
        </li>
      </ul>
      <p v-else class="empty-hint">Aucune mention pour l'instant.</p>
    </section>

    <section v-if="linkedEvents.length" class="block">
      <span class="field-label">Chronologie</span>
      <ul class="ref-list">
        <li v-for="event in linkedEvents" :key="event.id">
          <button type="button" @click="goToTimelineEvent">
            <span class="ref-badge">●</span>
            <span v-if="event.dateLabel" class="event-date">{{ event.dateLabel }} · </span>
            {{ event.title || 'Événement sans titre' }}
          </button>
        </li>
      </ul>
    </section>

    <ConfirmDialog
      v-if="confirmingRemoval"
      :message="removalMessage"
      @confirm="confirmRemoval"
      @cancel="cancelRemoval"
    />
  </article>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 46rem;
  margin: 0 auto;
  padding: 28px 36px 64px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.head {
  position: relative;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--border);
}

.delete-fiche {
  position: absolute;
  top: 0;
  right: 0;
  border-color: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  padding: 4px 8px;
}
.delete-fiche:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.identity {
  display: flex;
  align-items: center;
  gap: 24px;
  padding-right: 96px;
}

.portrait-wrap {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.portrait {
  width: 104px;
  height: 104px;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(
    155deg,
    var(--accent) 0%,
    color-mix(in srgb, var(--accent) 42%, var(--bg)) 100%
  );
  box-shadow: 0 2px 6px color-mix(in srgb, var(--fg) 22%, transparent);
}
.portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.portrait span {
  font-family: var(--font-manuscript);
  font-size: 2.6rem;
  font-weight: 600;
  color: var(--bg);
}
.pick-image {
  font-size: 11.5px;
  padding: 3px 10px;
  color: var(--fg-muted);
  border-color: transparent;
}
.pick-image:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.identity-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kind-badge {
  align-self: flex-start;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: var(--radius-pill);
  padding: 3px 10px;
}
.name {
  width: 100%;
  border-color: transparent;
  background: transparent;
  padding: 2px 4px;
  margin: 0 -4px;
  font-family: var(--font-manuscript);
  font-size: 28px;
  font-weight: 600;
}
.name:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.name:focus {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.aliases {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  border-radius: var(--radius-pill);
  padding: 3px 5px 3px 11px;
  font-size: 12px;
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
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  width: 90px;
  flex-shrink: 0;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.desc-text,
.notes-text {
  width: 100%;
  resize: none;
  font-size: 13.5px;
  line-height: 1.6;
  /* Auto-grow plafonné en JS (voir onDescriptionAreaInput/onNotesAreaInput +
     utils/autoGrow.ts) : overflow-y: auto laisse le champ défiler en interne
     une fois le plafond de 40vh atteint plutôt que de pousser le reste de la
     page hors champ. */
  max-height: 40vh;
  overflow-y: auto;
}

.attr-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.attr-row {
  display: flex;
  gap: 8px;
}
.attr-row input {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  padding: 7px 10px;
}
/* Clé en double (voir isDuplicateKey, composable partagé) : même liseré
   rouge dérivé des tokens que dans EntityCard/EditorPane. */
.attr-row.duplicate input {
  border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
}
.attr-row.duplicate input:focus {
  border-color: color-mix(in srgb, var(--danger) 70%, var(--accent));
}
.attr-row button {
  flex-shrink: 0;
  border: none;
  padding: 0 8px;
  color: var(--fg-muted);
  font-size: 14px;
}
.attr-row button:hover {
  color: var(--fg);
}
.add-attr {
  align-self: flex-start;
  font-size: 12px;
  padding: 4px 10px;
  color: var(--fg-muted);
  border-style: dashed;
}
.add-attr:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.empty-hint {
  font-size: 12.5px;
  color: var(--fg-muted);
}

.ref-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ref-list button {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  text-align: left;
  border: none;
  padding: 7px 10px;
  border-radius: var(--radius-s);
  font-size: 13.5px;
  color: var(--fg);
}
.ref-list button:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}
.ref-badge {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--accent);
}
.event-date {
  color: var(--fg-muted);
  font-size: 11.5px;
}
</style>
