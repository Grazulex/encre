// Logique de champ partagée entre EntityCard (tiroir, Task 11) et EntityPage
// (section personnages/lieux en pleine page, Task D3) : lecture/écriture
// optimiste de la fiche, sauvegarde debouncée par champ, alias, attributs
// clé/valeur, occurrences, image, suppression confirmée. Les deux composants
// gardent leur propre gabarit (compact pour le tiroir, généreux pour la
// page) — seule la logique, pas le balisage, est mutualisée ici.
//
// Hypothèse structurante : le composant appelant est TOUJOURS monté avec un
// :key="entityId" par son parent (EntityDrawer pour EntityCard, EntitiesSection
// pour EntityPage). Chaque instance ne voit donc qu'UNE SEULE fiche pendant
// toute sa vie — changer de sélection démonte l'ancienne instance (flush via
// onBeforeUnmount) et en monte une nouvelle (seed via onMounted), plutôt que
// de réutiliser la même instance pour plusieurs fiches successives (ancien
// motif maître-détail sans :key, Task 15, aujourd'hui abandonné). D'où
// l'absence de tout watch(entityId) pour re-semer l'état en cours de vie : la
// course qu'un tel watch neutralisait (frappe en attente + changement de
// sélection dans la MÊME instance) ne peut plus se produire.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import type { Entity, EntityOccurrence } from '../../../shared/types'

export interface AttrPair {
  id: number
  key: string
  value: string
}

export function useEntityFieldEditor(
  entityId: number,
  // Fourni par EntityCard quand EntityDrawer lui passe des occurrences déjà
  // chargées (store.occurrences) : évite un second aller-retour IPC pour la
  // même fiche. Une fonction (pas une valeur) pour rester réactif au
  // remplacement de store.occurrences sans que l'appelant ait à fournir un
  // ComputedRef explicite.
  occurrencesOverride?: () => EntityOccurrence[] | undefined
) {
  const store = useEntitiesStore()
  const bookStore = useBookStore()
  const ui = useUiStore()

  const entity = computed<Entity | null>(
    () => store.entities.find((e) => e.id === entityId) ?? null
  )

  // --- Occurrences ---------------------------------------------------------
  const localOccurrences = ref<EntityOccurrence[]>([])
  async function loadOccurrences(): Promise<void> {
    if (occurrencesOverride?.()) return
    try {
      localOccurrences.value = await window.encre.entities.occurrences(entityId)
    } catch (err) {
      console.error('Échec du chargement des occurrences', err)
    }
  }
  onMounted(loadOccurrences)
  const occurrences = computed(() => occurrencesOverride?.() ?? localOccurrences.value)

  // closeDrawer() est un no-op inoffensif si le tiroir n'est pas ouvert (cas
  // d'un appel depuis EntityPage) : il se contente de remettre drawerEntityId
  // à null, déjà sa valeur dans ce cas.
  function goToOccurrence(chapterId: number): void {
    bookStore.openChapter(chapterId)
    bookStore.setSection('chapitres')
    store.closeDrawer()
  }

  // --- Sauvegarde debouncée par champ --------------------------------------
  // Voir l'ancien commentaire d'EntityCard (avant extraction) pour le détail
  // du raisonnement : chaque champ a son propre minuteur, chaque commit
  // capture sa valeur au moment de l'ARMEMENT (dans onXInput, jamais relue à
  // l'échéance), et flushAll() retourne une promesse réellement attendue par
  // le quit-flusher.
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
    const value = entity.value?.name
    debounced('name', () => {
      if (value === undefined) return undefined
      return store.update(entityId, { name: value })
    })
  }
  function onDescriptionInput(): void {
    const value = entity.value?.description
    debounced('description', () => {
      if (value === undefined) return undefined
      return store.update(entityId, { description: value })
    })
  }
  function onNotesInput(): void {
    const value = entity.value?.notes
    debounced('notes', () => {
      if (value === undefined) return undefined
      return store.update(entityId, { notes: value })
    })
  }

  // --- Alias : actions discrètes (ajout/suppression), pas de debounce ------
  const newAlias = ref('')
  function addAlias(): void {
    const value = newAlias.value.trim()
    if (!value || !entity.value || entity.value.aliases.includes(value)) {
      newAlias.value = ''
      return
    }
    entity.value.aliases.push(value)
    newAlias.value = ''
    store.update(entityId, { aliases: [...entity.value.aliases] })
  }
  function removeAlias(index: number): void {
    if (!entity.value) return
    entity.value.aliases.splice(index, 1)
    store.update(entityId, { aliases: [...entity.value.aliases] })
  }

  // --- Attributs clé/valeur --------------------------------------------------
  const attrPairs = ref<AttrPair[]>([])
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
  onBeforeUnmount(flushAll)

  // Quit-flusher (fermeture de l'app, pas juste démontage) : chaque instance
  // s'abonne à son montage et se désabonne à son démontage.
  let unsubscribeQuitFlusher: (() => void) | null = null
  onMounted(() => {
    unsubscribeQuitFlusher = ui.addQuitFlusher(() => flushAll())
  })
  onBeforeUnmount(() => {
    unsubscribeQuitFlusher?.()
  })

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
  function commitAttributesNow(): void {
    clearTimeout(timers.attributes)
    delete pendingCommits.attributes
    store.update(entityId, { attributes: buildAttributesRecord() })
  }
  function commitAttributesDebounced(): void {
    debounced('attributes', () => store.update(entityId, { attributes: buildAttributesRecord() }))
  }
  function addAttrPair(): void {
    attrPairs.value.push({ id: nextPairId++, key: '', value: '' })
  }
  function removeAttrPair(index: number): void {
    attrPairs.value.splice(index, 1)
    commitAttributesNow()
  }

  // --- Image -----------------------------------------------------------------
  const imgFailed = ref(false)
  watch(
    () => entity.value?.imagePath,
    () => (imgFailed.value = false)
  )
  const initials = computed(() => (entity.value?.name.trim().slice(0, 1) || '?').toUpperCase())
  async function choosePicture(): Promise<void> {
    await store.pickImage(entityId)
  }

  // --- Suppression -----------------------------------------------------------
  // Confirmation déplacée hors du store (audit UI/UX, sweep D3) : cette
  // fonction ne fait plus que présenter/confirmer une boîte ConfirmDialog,
  // rendue par l'appelant (le store expose désormais une suppression pure).
  const confirmingRemoval = ref(false)
  function requestRemoval(): void {
    confirmingRemoval.value = true
  }
  function cancelRemoval(): void {
    confirmingRemoval.value = false
  }
  // Idempotent : un second appel (double clic sur « Supprimer », ou Entrée
  // suivie d'un clic) après le premier ne redéclenche pas store.remove — le
  // drapeau est retombé à false dès le premier passage, avant l'appel IPC —
  // même garde que TimelineEventCard.confirmRemoval.
  async function confirmRemoval(): Promise<void> {
    if (!confirmingRemoval.value) return
    confirmingRemoval.value = false
    await store.remove(entityId)
  }
  const removalMessage = computed(() => {
    const name = entity.value?.name?.trim()
    return `Supprimer ${name ? `« ${name} »` : 'cette fiche'} ?`
  })

  return {
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
  }
}
