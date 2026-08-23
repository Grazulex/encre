<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useBackupStore } from '../stores/backup'

const store = useBackupStore()
onMounted(() => store.startPolling())
onUnmounted(() => store.stopPolling())

const nf = new Intl.NumberFormat('fr-FR')

function relative(iso: string | null): string {
  if (!iso) return 'jamais'
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return today ? `aujourd'hui à ${heure}` : `${d.toLocaleDateString('fr-FR')} à ${heure}`
}

function summarize(d: {
  chaptersChanged: number
  chaptersAdded: number
  chaptersRemoved: number
  wordsDelta: number
  mediaAdded: number
}): string {
  const parts: string[] = []
  const ch = d.chaptersChanged + d.chaptersAdded + d.chaptersRemoved
  if (ch > 0) parts.push(`${ch} chapitre${ch > 1 ? 's' : ''}`)
  if (d.wordsDelta !== 0)
    parts.push(`${d.wordsDelta > 0 ? '+' : '−'}${nf.format(Math.abs(d.wordsDelta))} mots`)
  if (d.mediaAdded > 0) parts.push(`${d.mediaAdded} image${d.mediaAdded > 1 ? 's' : ''}`)
  return parts.join(', ')
}

const pendingLabel = computed(() => {
  const p = store.status?.pending
  if (!p) return ''
  const s = summarize(p)
  return s === '' ? 'Tout est sauvegardé' : `En attente : ${s}`
})

const lastLabel = computed(() => {
  const s = store.status
  if (!s) return 'Chargement…'
  if (!s.lastCommitAt) return 'Jamais sauvegardé'
  const base = `Sauvegardé ${relative(s.lastPushAt ?? s.lastCommitAt)}`
  return s.lastDiff ? `${base} · ${summarize(s.lastDiff)}` : base
})

// Un commit local sans push n'est pas un échec : le travail est figé, il n'est
// simplement pas encore parti. On le distingue visuellement d'une vraie panne.
const pendingPush = computed(
  () => store.status != null && store.status.lastError != null && store.status.lastCommitAt != null
)
</script>

<template>
  <section v-if="store.status" class="backup">
    <div class="line">
      <span class="pastille" :class="{ warn: pendingPush, off: !store.status.configured }" />
      <strong>{{ lastLabel }}</strong>
    </div>
    <p v-if="store.status.missingBinary" class="warn-text">
      Binaire introuvable : {{ store.status.missingBinary }} — la sauvegarde ne peut pas
      fonctionner.
    </p>
    <p v-else-if="!store.status.configured" class="muted">
      Sauvegarde non configurée sur cette machine — voir RESTAURATION.md dans le dépôt encre_backup.
    </p>
    <template v-else>
      <p class="muted">{{ pendingLabel }}</p>
      <p v-if="store.status.lastError" class="warn-text">{{ store.status.lastError }}</p>
      <p v-if="store.error" class="warn-text">{{ store.error }}</p>
      <button type="button" :disabled="store.busy" @click="store.runNow()">
        {{ store.busy ? 'Sauvegarde en cours…' : 'Sauvegarder maintenant' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
/* Variables du thème (src/renderer/src/styles) : --accent, --danger, --fg-muted.
   Il n'existe ni --ok ni --warn — ne pas en inventer. */
.backup {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 24px;
  padding: 14px 16px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
}
.line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.pastille {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
.pastille.warn {
  background: var(--danger);
}
.pastille.off {
  background: var(--fg-muted);
}
.muted {
  color: var(--fg-muted);
  margin: 0;
}
.warn-text {
  color: var(--danger);
  margin: 0;
}
button {
  align-self: flex-start;
}
</style>
