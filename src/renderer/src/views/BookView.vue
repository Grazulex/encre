<script setup lang="ts">
defineProps<{ bookId: number }>()
</script>
<template>
  <main style="padding: 2rem">Livre {{ bookId }}</main>
</template>
