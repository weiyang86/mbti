<template>
  <view class="page">
    <text class="muted">来源将标记为「自行选择」，非测验结果。</text>
    <view class="grid">
      <view
        v-for="t in types"
        :key="t.type_code"
        class="type card"
        @click="pick(t.type_code)"
      >
        <text class="code">{{ t.type_code }}</text>
        <text class="name">{{ t.name_zh }}</text>
        <text class="tag muted">{{ t.tagline }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { TypeMeta } from '@/api/types'
import { listTypes } from '@/api'
import { createSelfSelectResult } from '@/api/results'

const types = ref<TypeMeta[]>([])

onMounted(async () => {
  const res = await listTypes()
  types.value = res.items
})

async function pick(typeCode: string) {
  const result = await createSelfSelectResult({
    type_code: typeCode,
    source: 'self_select',
  })
  uni.redirectTo({ url: `/pages/result/result?id=${result.id}` })
}
</script>

<style scoped lang="scss">
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
  margin-top: 24rpx;
}
.type {
  padding: 24rpx;
}
.code {
  font-size: 36rpx;
  font-weight: 700;
  display: block;
}
.name {
  display: block;
  margin-top: 8rpx;
}
.tag {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
}
</style>
