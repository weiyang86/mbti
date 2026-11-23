<template>
  <view class="state-view" :class="`state-${state}`" :role="state === 'error' ? 'alert' : 'status'">
    <view v-if="state === 'loading'" class="state-spinner" aria-hidden="true" />
    <text class="state-title">{{ resolvedTitle }}</text>
    <text v-if="description" class="state-desc">{{ description }}</text>
    <view v-if="$slots.default" class="state-actions"><slot /></view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  state: 'loading' | 'empty' | 'error'
  title?: string
  description?: string
}>(), { title: '', description: '' })

const fallbackTitle = { loading: '正在加载…', empty: '暂无内容', error: '加载失败' }
const resolvedTitle = computed(() => props.title || fallbackTitle[props.state])
</script>

<style scoped lang="scss">
.state-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 22px 16px;
  border: 1px dashed rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  text-align: center;
}

.state-title {
  font-size: 13px;
  font-weight: 600;
}

.state-desc {
  font-size: 11px;
  line-height: 1.7;
  opacity: 0.68;
}

.state-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
}

.state-error {
  border-color: rgba(178, 74, 63, 0.35);
}

.state-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(0, 0, 0, 0.12);
  border-top-color: rgba(0, 0, 0, 0.45);
  border-radius: 50%;
  animation: state-spin 0.8s linear infinite;
}

@keyframes state-spin {
  to { transform: rotate(360deg); }
}
</style>
