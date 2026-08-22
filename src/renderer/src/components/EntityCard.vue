<script setup lang="ts">
// Carte compacte de fiche personnage/lieu — seul consommateur restant :
// EntityDrawer (tiroir de quick-peek ouvert depuis une mention de l'éditeur,
// Task 11). La vue maître-détail pleine page (section personnages/lieux) est
// désormais EntityPage.vue (Task D3) ; ce composant n'a donc plus besoin de
// gérer un mode "non compact" (ancien bouton ⤢ « ouvrir dans le tiroir » et
// bouton × de suppression en coin de carte, tous deux retirés — la
// suppression depuis le tiroir passe par le bouton dédié de son en-tête, voir
// EntityDrawer). Toute la logique de champ (debounce, alias, attributs,
// occurrences, image) vit dans useEntityFieldEditor, partagée avec EntityPage.
import { useEntityFieldEditor } from '../composables/useEntityFieldEditor'
import { mediaUrl } from '../utils/media'
import type { EntityOccurrence } from '../../../shared/types'

const props = defineProps<{
  entityId: number
  // Fourni par EntityDrawer (store.occurrences, déjà chargées par
  // openDrawer) : évite un second aller-retour IPC pour la même fiche.
  occurrencesOverride?: EntityOccurrence[]
}>()

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
  choosePicture
} = useEntityFieldEditor(props.entityId, () => props.occurrencesOverride)
</script>

<template>
  <article v-if="entity" class="card">
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
        <button
          type="button"
          title="Retirer cet attribut"
          :aria-label="pair.key ? `Retirer l'attribut « ${pair.key} »` : 'Retirer cet attribut'"
          @click="removeAttrPair(index)"
        >
          ×
        </button>
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
  padding: 18px 16px;
}

.avatar {
  align-self: center;
  width: 48px;
  height: 48px;
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
   poignée de redimensionnement pouvait l'étirer sans limite. */
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
</style>
