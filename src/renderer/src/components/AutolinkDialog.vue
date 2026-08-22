<script setup lang="ts">
// Boîte de dialogue « Lier les entités » (Task 12) : liste, groupée par
// entité, les occurrences de noms/alias détectées dans le chapitre courant
// (calculées par EditorPane via le module partagé `autolink`), cases cochées
// par défaut. « Lier la sélection » renvoie au parent la liste des
// occurrences retenues ; c'est EditorPane qui construit et applique la
// transaction ProseMirror (positions absolues déjà connues à l'ouverture).
import { computed, nextTick, onMounted, ref } from 'vue'
import { useEntitiesStore } from '../stores/entities'

// Une occurrence détectée, positions ProseMirror absolues déjà résolues par
// EditorPane (pos du nœud texte + offset local du TextMatch partagé).
export interface AutolinkMatch {
  from: number
  to: number
  entityId: number
  kind: string
  matched: string
}

const props = defineProps<{ matches: AutolinkMatch[] }>()
const emit = defineEmits<{ close: []; apply: [selected: AutolinkMatch[]] }>()

const entitiesStore = useEntitiesStore()
const dialogEl = ref<HTMLElement | null>(null)

function keyOf(m: AutolinkMatch): string {
  return `${m.from}-${m.to}`
}

// Tout est coché par défaut (brief) ; on retire du set au décochage plutôt
// que l'inverse, pour que l'état initial reflète directement `props.matches`.
const selected = ref<Set<string>>(new Set(props.matches.map(keyOf)))

function isSelected(m: AutolinkMatch): boolean {
  return selected.value.has(keyOf(m))
}

function toggle(m: AutolinkMatch): void {
  const k = keyOf(m)
  if (selected.value.has(k)) selected.value.delete(k)
  else selected.value.add(k)
}

interface Group {
  entityId: number
  name: string
  kind: string
  matches: AutolinkMatch[]
}

const groups = computed<Group[]>(() => {
  const byId = new Map<number, Group>()
  for (const m of props.matches) {
    let g = byId.get(m.entityId)
    if (!g) {
      const entity = entitiesStore.entities.find((e) => e.id === m.entityId)
      g = { entityId: m.entityId, name: entity?.name ?? m.matched, kind: m.kind, matches: [] }
      byId.set(m.entityId, g)
    }
    g.matches.push(m)
  }
  return [...byId.values()]
})

const selectedCount = computed(() => selected.value.size)

function apply(): void {
  emit(
    'apply',
    props.matches.filter((m) => selected.value.has(keyOf(m)))
  )
}

function close(): void {
  emit('close')
}

// Autofocus à l'ouverture : même geste que CommandPalette (input) et
// EntityDrawer (conteneur, tabindex="-1") — pas de champ texte ici, on
// focus donc directement la carte pour que le prochain Échap l'atteigne.
onMounted(async () => {
  await nextTick()
  dialogEl.value?.focus()
})

// Échap intercepté ICI, en stoppant la propagation dès ce nœud : même
// principe que CommandPalette.onKeydown et EntityDrawer.onKeydown, pour ne
// jamais laisser Échap atteindre le listener global de mode focus tant que
// la boîte de dialogue est ouverte.
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}
</script>

<template>
  <div class="autolink-overlay" @click.self="close">
    <div
      ref="dialogEl"
      class="autolink-card"
      role="dialog"
      aria-modal="true"
      aria-label="Lier les entités"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header>
        <h2>Lier les entités</h2>
        <span class="kbd">Échap</span>
      </header>
      <div class="body">
        <template v-if="groups.length">
          <section v-for="g in groups" :key="g.entityId" class="group">
            <div class="group-label">
              <span class="badge" :class="{ 'badge-place': g.kind === 'place' }">{{
                g.kind === 'place' ? '●' : '◆'
              }}</span>
              <span class="name">{{ g.name }}</span>
              <span class="count">{{ g.matches.length }}</span>
            </div>
            <label v-for="m in g.matches" :key="keyOf(m)" class="row">
              <input type="checkbox" :checked="isSelected(m)" @change="toggle(m)" />
              <span class="matched">{{ m.matched }}</span>
            </label>
          </section>
        </template>
        <p v-else class="empty">Aucune correspondance trouvée.</p>
      </div>
      <footer>
        <button type="button" @click="close">Annuler</button>
        <button type="button" class="primary" :disabled="selectedCount === 0" @click="apply">
          Lier la sélection ({{ selectedCount }})
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.autolink-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.autolink-card {
  width: 420px;
  max-width: 100%;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 60px -20px color-mix(in srgb, var(--fg) 45%, transparent);
  overflow: hidden;
}
.autolink-card:focus,
.autolink-card:focus-visible {
  outline: none;
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

.body {
  overflow-y: auto;
  padding: 10px 6px;
  flex: 1;
  min-height: 0;
}

.group {
  padding: 4px 10px 10px;
}
.group-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
}
.group-label .name {
  color: var(--fg);
  text-transform: none;
  letter-spacing: normal;
  font-size: 13px;
}
.badge {
  font-size: 9px;
  color: var(--accent);
}
.badge-place {
  color: color-mix(in srgb, var(--accent) 60%, transparent);
}
.count {
  margin-left: auto;
  color: var(--fg-muted);
  font-weight: 500;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  cursor: pointer;
}
.row:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.row input[type='checkbox'] {
  accent-color: var(--accent);
}
.matched {
  font-family: var(--font-manuscript);
  font-size: 13.5px;
  color: var(--fg);
}

.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--fg-muted);
  font-size: 13px;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.kbd {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 10.5px;
  color: var(--fg-muted);
  background: var(--bg);
}
</style>
