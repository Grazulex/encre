<script setup lang="ts">
import { onMounted } from 'vue'
import Toasts from './components/Toasts.vue'
import { useUiStore } from './stores/ui'

const ui = useUiStore()
onMounted(() => {
  window.encre.app.onFlushRequest(async () => {
    await ui.runQuitFlush()
    window.encre.app.flushDone()
  })
})
</script>

<template>
  <router-view />
  <Toasts />
</template>
