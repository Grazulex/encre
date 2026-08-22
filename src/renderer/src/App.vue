<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Toasts from './components/Toasts.vue'
import CommandPalette from './components/CommandPalette.vue'
import { useUiStore } from './stores/ui'
import { useShortcuts } from './composables/useShortcuts'

const ui = useUiStore()
onMounted(() => {
  window.encre.app.onFlushRequest(async () => {
    await ui.runQuitFlush()
    window.encre.app.flushDone()
  })
})

const paletteOpen = ref(false)
// Échap n'est volontairement pas lié ici : c'est le keydown local de
// l'input de CommandPalette qui ferme la palette (voir ce composant), pour
// ne jamais entrer en conflit avec le raccourci 'escape' du mode focus de
// BookView (branché sur le même mécanisme global, sur window).
useShortcuts([{ combo: 'meta+k', handler: () => (paletteOpen.value = !paletteOpen.value) }])
</script>

<template>
  <router-view />
  <Toasts />
  <CommandPalette v-if="paletteOpen" @close="paletteOpen = false" />
</template>
