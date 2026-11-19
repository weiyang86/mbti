<template>
  <!-- #ifdef H5 -->
  <svg
    class="app-icon"
    :style="{ color, width: size + 'px', height: size + 'px' }"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    v-html="paths"
  />
  <!-- #endif -->
  <!-- #ifndef H5 -->
  <image class="app-icon" :src="src" :style="style" />
  <!-- #endif -->
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ name: string; size?: number; color?: string }>(),
  { size: 20, color: '#6854f5' },
)

const ICONS: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>',
  card: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="10" r="2"/><path d="M5 16c1-3 5-3 6 0m3-7h4m-4 4h4"/>',
  friends: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 4v3"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6M3 3v6h6m3-2v5l3 2"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z"/><path d="M8 10h8m-8 4h5"/>',
}

const paths = computed(() => ICONS[props.name] || '<circle cx="12" cy="12" r="8"/>')

const src = computed(() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${props.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths.value}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})

const style = computed(() => `width:${props.size}px;height:${props.size}px;flex-shrink:0;`)
</script>
