<script setup lang="ts">
// Popup de suggestion @ (Task 11), montée par mention.ts via VueRenderer +
// tippy manuel. Look sobre, aligné sur CommandPalette : mêmes tokens, mêmes
// tailles. defineExpose(onKeyDown) permet à mention.ts de router ↑/↓/Entrée
// depuis le plugin de suggestion TipTap sans que cette liste ait le focus
// DOM (qui reste dans l'éditeur pendant la frappe).
import { ref, watch } from 'vue'
import type { SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { MentionSuggestionItem } from '../editor/mention'

const props = defineProps<{
  items: MentionSuggestionItem[]
  command: (item: MentionSuggestionItem) => void
}>()

const selectedIndex = ref(0)

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
  }
)

function selectItem(index: number): void {
  const item = props.items[index]
  if (item) props.command(item)
}

function onKeyDown({ event }: SuggestionKeyDownProps): boolean {
  if (props.items.length === 0) return false
  if (event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length
    return true
  }
  if (event.key === 'ArrowUp') {
    selectedIndex.value = (selectedIndex.value + props.items.length - 1) % props.items.length
    return true
  }
  if (event.key === 'Enter') {
    selectItem(selectedIndex.value)
    return true
  }
  return false
}

defineExpose({ onKeyDown })
</script>

<template>
  <div class="mention-list" role="listbox">
    <button
      v-for="(item, index) in items"
      :key="item.id"
      type="button"
      class="item"
      :class="{ selected: index === selectedIndex }"
      role="option"
      :aria-selected="index === selectedIndex"
      @click="selectItem(index)"
      @mouseenter="selectedIndex = index"
    >
      <span class="badge" :class="{ place: item.kind === 'place' }">{{
        item.kind === 'character' ? '◆' : '●'
      }}</span>
      <span class="label">{{ item.label }}</span>
    </button>
    <p v-if="items.length === 0" class="empty">Aucune fiche.</p>
  </div>
</template>

<style scoped>
.mention-list {
  width: 220px;
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 40px -16px color-mix(in srgb, var(--fg) 45%, transparent);
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  border-left: 2px solid transparent;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 13px;
  color: var(--fg);
  background: none;
  cursor: pointer;
}
.item:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.item.selected {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-left-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.badge {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--accent);
}
.badge.place {
  color: color-mix(in srgb, var(--accent) 60%, transparent);
}

.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: 10px 8px;
  text-align: center;
  color: var(--fg-muted);
  font-size: 12.5px;
}
</style>
