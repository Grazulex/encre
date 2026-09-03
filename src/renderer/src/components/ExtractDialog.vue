<script setup lang="ts">
// Dialogue de validation champ par champ de l'extraction de fiches (Task 5,
// plan 3c) : monté par ClaudePanel dès que
// `ai.phase === 'done' && ai.task === 'extract'` (voir son template) — se
// referme de lui-même dès que phase quitte 'done' (nouvelle extraction
// lancée, chapitre changé — prepare() reset la phase, ou fermeture/
// application ci-dessous). Même langage modal qu'AutolinkDialog (overlay +
// carte, groupes par entité, cases cochées par défaut) et FormatDialog
// (piège de Tab — plus de contrôles ici que les deux boutons de pied de page
// de FormatDialog, le piège a donc réellement lieu d'être).
//
// Entièrement pilotée par le store ai pour la PROPOSITION (ai.extractProposal,
// déjà filtrée deux fois — forme, voir shared/extractProposal.ts, puis
// existence de l'entityId, voir stores/ai.ts) ; la SÉLECTION (quelles
// créations/quels champs d'enrichissement appliquer) est un état purement
// local à ce composant, construit une seule fois au montage (même idiome
// qu'AutolinkDialog.selected) — ce dialogue est remonté à chaque nouvelle
// extraction (v-if côté ClaudePanel), jamais réutilisé d'une session à
// l'autre.
import { computed, nextTick, onMounted, ref } from 'vue'
import { useAiStore } from '../stores/ai'
import { useBookStore } from '../stores/book'
import { useEntitiesStore } from '../stores/entities'
import { useUiStore } from '../stores/ui'
import type { Entity, EntityPatch, ExtractProposal } from '../../../shared/types'
import { pairEnrichissementsWithEntities } from '../../../shared/extractProposal'

type Creation = ExtractProposal['creations'][number]
type Enrichissement = ExtractProposal['enrichissements'][number]
type EnrichField = 'aliases' | 'description' | 'notes'

interface CreationChoice {
  creation: Creation
  checked: boolean
  // Doublon possible détecté côté client (Task 5, revue) : entité existante
  // dont le nom ou un alias correspond (insensible à la casse) au nom ou à
  // un alias de la création proposée — voir findPossibleDuplicate ci-dessous.
  // N'empêche rien : décoche seulement la ligne par défaut et affiche un
  // repère visuel, l'auteur reste libre de cocher quand même (doublon
  // homonyme légitime, p. ex. deux personnages différents nommés « Marie »).
  duplicateOf: Entity | null
}

interface FieldChoice {
  field: EnrichField
  label: string
  preview: string
  checked: boolean
}

interface EnrichissementChoice {
  entity: Entity
  // Enrichissement SOURCE de ces champs (valeurs proposées par l'IA,
  // utilisées à l'application — voir applySelection). Porté directement sur
  // le même objet que `entity`/`fields` (voir pairEnrichissementsWithEntities,
  // shared/extractProposal.ts) : plus jamais de second tableau parallèle à
  // tenir synchronisé par index (c'était le bug — voir revue Task 5).
  source: Enrichissement
  fields: FieldChoice[]
}

const ai = useAiStore()
const store = useBookStore()
const entitiesStore = useEntitiesStore()
const ui = useUiStore()

const cardEl = ref<HTMLElement | null>(null)
const applying = ref(false)

const FIELD_LABELS: Record<EnrichField, string> = {
  aliases: 'Alias',
  description: 'Description',
  notes: 'Notes'
}

// Doublon possible (Task 5, revue) : compare nom ET alias de la création
// proposée, insensible à la casse, à nom+alias de chaque entité déjà connue
// du livre. Une correspondance sur un seul des deux jeux suffit — un
// personnage déjà fiché sous un alias que l'IA propose comme nom principal
// (ou l'inverse) est tout autant un doublon probable qu'une correspondance
// de nom à nom.
function findPossibleDuplicate(creation: Creation): Entity | null {
  const proposedNames = [creation.name, ...creation.aliases]
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  for (const entity of entitiesStore.entities) {
    const knownNames = [entity.name, ...entity.aliases].map((s) => s.trim().toLowerCase())
    if (proposedNames.some((name) => knownNames.includes(name))) return entity
  }
  return null
}

// Une seule fois au montage (voir en-tête de fichier) : chaque création
// proposée est cochée par défaut (brief) SAUF si un doublon possible est
// détecté (voir findPossibleDuplicate ci-dessus) — décochée par défaut mais
// toujours sélectionnable, l'auteur tranche.
const creationChoices = ref<CreationChoice[]>(
  (ai.extractProposal?.creations ?? []).map((creation) => {
    const duplicateOf = findPossibleDuplicate(creation)
    return { creation, checked: duplicateOf === null, duplicateOf }
  })
)

function buildFieldChoices(enrichissement: Enrichissement): FieldChoice[] {
  const fields: FieldChoice[] = []
  if (enrichissement.aliases && enrichissement.aliases.length > 0) {
    fields.push({
      field: 'aliases',
      label: FIELD_LABELS.aliases,
      preview: enrichissement.aliases.join(', '),
      checked: true
    })
  }
  if (enrichissement.description && enrichissement.description.trim()) {
    fields.push({
      field: 'description',
      label: FIELD_LABELS.description,
      preview: enrichissement.description,
      checked: true
    })
  }
  if (enrichissement.notes && enrichissement.notes.trim()) {
    fields.push({
      field: 'notes',
      label: FIELD_LABELS.notes,
      preview: enrichissement.notes,
      checked: true
    })
  }
  return fields
}

// Par entité (brief : « par entité : chaque champ proposé = checkbox ») —
// UN SEUL passage via pairEnrichissementsWithEntities (shared/
// extractProposal.ts) : chaque élément produit porte directement son entité,
// SON enrichissement source et ses champs exploitables ensemble — jamais un
// second tableau filtré séparément à retrouver par index (voir le
// commentaire de EnrichissementChoice ci-dessus et celui de la fonction
// partagée pour la régression que cela évitait).
// Résultat calculé une seule fois au montage (comme creationChoices
// ci-dessus) : `duplicateCount` (correctif M1, vague finale 3c) compte les
// enrichissements écartés parce qu'un enrichissement PRÉCÉDENT portait déjà
// le même entityId — affiché ci-dessous à côté des autres compteurs
// (malformées, entité inconnue), voir pairEnrichissementsWithEntities pour
// le raisonnement complet (shared/extractProposal.ts).
const { pairs: enrichissementPairs, duplicateCount: enrichissementDuplicateCount } =
  pairEnrichissementsWithEntities(
    ai.extractProposal?.enrichissements ?? [],
    entitiesStore.entities,
    buildFieldChoices
  )
const enrichissementChoices = ref<EnrichissementChoice[]>(
  enrichissementPairs.map(({ entity, enrichissement, fields }) => ({
    entity,
    source: enrichissement,
    fields
  }))
)

const hasSelection = computed(
  () =>
    creationChoices.value.some((c) => c.checked) ||
    enrichissementChoices.value.some((c) => c.fields.some((f) => f.checked))
)

// Ajoute `addition` (si non vide) à la suite de `existing`, séparé par une
// ligne vide (brief : « AJOUTÉES à la suite de l'existant ») — jamais une
// réécriture. `existing` vide (fiche neuve ou champ encore inexploité) ne
// laisse aucune ligne vide en tête.
function appendText(existing: string, addition: string): string {
  const trimmedAddition = addition.trim()
  if (!trimmedAddition) return existing
  return existing.trim() ? `${existing}\n\n${trimmedAddition}` : trimmedAddition
}

// Fusion d'alias sans doublon (brief : « comparaison sensible à la casse
// acceptée », ordre existant conservé, nouveaux ajoutés à la suite).
function mergeAliases(existing: string[], proposed: string[]): string[] {
  const merged = [...existing]
  for (const alias of proposed) {
    if (!merged.includes(alias)) merged.push(alias)
  }
  return merged
}

async function applySelection(): Promise<void> {
  if (applying.value || !hasSelection.value) return
  const book = store.book
  if (!book) return
  applying.value = true
  let createdCount = 0
  let enrichedCount = 0
  let hadError = false

  try {
    for (const choice of creationChoices.value) {
      if (!choice.checked) continue
      const { creation } = choice
      let entity: Entity
      try {
        entity = await window.encre.entities.create({
          bookId: book.id,
          kind: creation.kind,
          name: creation.name
        })
      } catch (err) {
        console.error('Échec de la création de fiche depuis l’extraction', err)
        hadError = true
        continue
      }
      // Décoche IMMÉDIATEMENT la ligne, avant le patch alias/description
      // ci-dessous (Task 5, revue) : la fiche existe déjà en base dès cet
      // instant — si le patch qui suit échoue, un nouveau clic sur
      // « Appliquer la sélection » ne doit JAMAIS la recréer en double.
      // EntityCreate (shared/types.ts) n'accepte que bookId/kind/name, d'où
      // ce patch séparé plutôt qu'une création en un seul appel.
      choice.checked = false
      createdCount++
      const patch: EntityPatch = {}
      if (creation.aliases.length > 0) patch.aliases = [...creation.aliases]
      if (creation.description.trim()) patch.description = creation.description
      if (Object.keys(patch).length > 0) {
        try {
          await window.encre.entities.update(entity.id, patch)
        } catch (err) {
          console.error(
            'Échec du complément (alias/description) de la fiche créée depuis l’extraction',
            err
          )
          hadError = true
        }
      }
    }

    for (const choice of enrichissementChoices.value) {
      const checkedFields = choice.fields.filter((f) => f.checked)
      if (checkedFields.length === 0) continue
      const patch: EntityPatch = {}
      for (const field of checkedFields) {
        if (field.field === 'aliases') {
          patch.aliases = mergeAliases(choice.entity.aliases, choice.source.aliases ?? [])
        } else if (field.field === 'description') {
          patch.description = appendText(choice.entity.description, choice.source.description ?? '')
        } else {
          patch.notes = appendText(choice.entity.notes, choice.source.notes ?? '')
        }
      }
      try {
        await window.encre.entities.update(choice.entity.id, patch)
        // Décoche IMMÉDIATEMENT tous les champs de CETTE fiche dès le succès
        // (même raisonnement que la boucle de création ci-dessus, Task 5
        // revue round 2) : mergeAliases dédoublonne, donc un alias déjà
        // fusionné rejoué au réessai ne casse rien — mais appendText, lui,
        // AJOUTE sans dédoublonner. Sans ce marquage, un réessai après
        // l'échec d'UNE AUTRE fiche rejouerait cette fiche-ci (déjà
        // enrichie avec succès) et dupliquerait sa description/ses notes.
        for (const field of choice.fields) field.checked = false
        enrichedCount++
      } catch (err) {
        console.error('Échec de l’enrichissement de fiche depuis l’extraction', err)
        hadError = true
      }
    }

    await entitiesStore.load(book.id)

    const parts: string[] = []
    if (createdCount > 0) {
      parts.push(
        `${createdCount} fiche${createdCount > 1 ? 's' : ''} créée${createdCount > 1 ? 's' : ''}`
      )
    }
    if (enrichedCount > 0) {
      parts.push(`${enrichedCount} enrichie${enrichedCount > 1 ? 's' : ''}`)
    }
    if (parts.length > 0) {
      ui.toast(parts.join(', ') + (hadError ? ' (certaines applications ont échoué).' : '.'))
    } else if (hadError) {
      ui.toast('Impossible d’appliquer la sélection.')
    }

    // Ferme le dialogue uniquement si tout s'est bien passé — un échec
    // partiel laisse la session 'done' intacte pour que l'auteur puisse
    // relire ce qui a échoué et réessayer (même philosophie que
    // ai.applyFormat/ai.insertDraft : reset() seulement après succès
    // confirmé).
    if (!hadError) ai.reset()
  } finally {
    applying.value = false
  }
}

function close(): void {
  if (applying.value) return
  ai.reset()
}

// Piège de focus identique à FormatDialog : plusieurs contrôles (cases à
// cocher + deux boutons de pied de page), Tab doit continuer à circuler
// entre eux sans jamais s'échapper vers la vue en arrière-plan.
function trapTab(event: KeyboardEvent): void {
  const card = cardEl.value
  if (!card) return
  const focusables = Array.from(
    card.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'Tab') {
    trapTab(event)
  }
}

onMounted(async () => {
  await nextTick()
  cardEl.value?.focus()
})
</script>

<template>
  <Transition name="dialog" appear>
    <div class="overlay" @click.self="close">
      <div
        ref="cardEl"
        class="extract-card dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label="Validation de l'extraction de fiches"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header>
          <h2>Extraction de fiches</h2>
          <span class="kbd">Échap</span>
        </header>

        <div class="extract-body">
          <p v-if="ai.extractMalformedCount > 0" class="extract-hint">
            {{ ai.extractMalformedCount }}
            proposition{{ ai.extractMalformedCount > 1 ? 's' : '' }} malformée{{
              ai.extractMalformedCount > 1 ? 's' : ''
            }}
            ignorée{{ ai.extractMalformedCount > 1 ? 's' : '' }}.
          </p>
          <p v-if="ai.extractUnknownEntityCount > 0" class="extract-hint">
            {{ ai.extractUnknownEntityCount }}
            proposition{{ ai.extractUnknownEntityCount > 1 ? 's' : '' }} ignorée{{
              ai.extractUnknownEntityCount > 1 ? 's' : ''
            }}
            (entité inconnue).
          </p>
          <p v-if="enrichissementDuplicateCount > 0" class="extract-hint">
            {{ enrichissementDuplicateCount }}
            proposition{{ enrichissementDuplicateCount > 1 ? 's' : '' }} en double ignorée{{
              enrichissementDuplicateCount > 1 ? 's' : ''
            }}.
          </p>

          <template v-if="creationChoices.length === 0 && enrichissementChoices.length === 0">
            <p class="extract-empty">Aucune proposition pour ce chapitre.</p>
          </template>

          <section v-if="creationChoices.length > 0" class="extract-section">
            <span class="field-label">Nouvelles fiches</span>
            <label
              v-for="(choice, index) in creationChoices"
              :key="`creation-${index}`"
              class="creation-row"
            >
              <input v-model="choice.checked" type="checkbox" />
              <div class="creation-body">
                <div class="creation-head">
                  <span class="badge" :class="{ 'badge-place': choice.creation.kind === 'place' }">
                    {{ choice.creation.kind === 'place' ? '●' : '◆' }}
                  </span>
                  <span class="creation-name">{{ choice.creation.name }}</span>
                  <span v-if="choice.creation.aliases.length > 0" class="creation-aliases">
                    alias : {{ choice.creation.aliases.join(', ') }}
                  </span>
                </div>
                <p v-if="choice.creation.description" class="creation-description">
                  {{ choice.creation.description }}
                </p>
                <span v-if="choice.duplicateOf" class="creation-duplicate-tag">
                  Doublon possible : {{ choice.duplicateOf.name }}
                </span>
              </div>
            </label>
          </section>

          <section v-if="enrichissementChoices.length > 0" class="extract-section">
            <span class="field-label">Enrichissements</span>
            <div
              v-for="(choice, index) in enrichissementChoices"
              :key="`enrichissement-${index}`"
              class="enrich-group"
            >
              <div class="enrich-head">
                <span class="badge" :class="{ 'badge-place': choice.entity.kind === 'place' }">
                  {{ choice.entity.kind === 'place' ? '●' : '◆' }}
                </span>
                <span class="enrich-name">{{ choice.entity.name }}</span>
              </div>
              <label v-for="field in choice.fields" :key="field.field" class="enrich-row">
                <input v-model="field.checked" type="checkbox" />
                <div class="enrich-field">
                  <span class="enrich-field-label">{{ field.label }}</span>
                  <p class="enrich-field-preview">{{ field.preview }}</p>
                </div>
              </label>
            </div>
          </section>
        </div>

        <footer>
          <button type="button" class="ghost" :disabled="applying" @click="close">Fermer</button>
          <button
            type="button"
            class="primary"
            :disabled="applying || !hasSelection"
            @click="applySelection"
          >
            <span v-if="applying" class="spinner" aria-hidden="true"></span>
            {{ applying ? 'Application…' : 'Appliquer la sélection' }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.extract-card {
  width: 560px;
  max-width: 100%;
  max-height: 85vh;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
header h2 {
  font-size: 14px;
  font-weight: 600;
}

.extract-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.extract-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: 8px;
  padding: 7px 10px;
}

.extract-empty {
  text-align: center;
  padding: 24px 12px;
  color: var(--fg-muted);
  font-size: 13px;
}

.extract-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.badge {
  font-size: 9px;
  color: var(--accent);
  flex-shrink: 0;
}
.badge-place {
  color: color-mix(in srgb, var(--accent) 60%, transparent);
}

.creation-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.creation-row:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.creation-row input {
  margin-top: 3px;
  accent-color: var(--accent);
  flex-shrink: 0;
}
.creation-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.creation-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
}
.creation-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}
.creation-aliases {
  font-size: 11.5px;
  color: var(--fg-muted);
}
.creation-description {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--fg-muted);
}
.creation-duplicate-tag {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 100px;
  padding: 2px 8px;
}

.enrich-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.enrich-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 2px;
}
.enrich-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}

.enrich-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 4px;
  border-radius: 6px;
  cursor: pointer;
}
.enrich-row:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.enrich-row input {
  margin-top: 3px;
  accent-color: var(--accent);
  flex-shrink: 0;
}
.enrich-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.enrich-field-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
}
.enrich-field-preview {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}

footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.ghost {
  color: var(--fg-muted);
}
</style>
