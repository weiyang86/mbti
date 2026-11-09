<template>
  <view class="page">
    <text class="muted">来源将标记为「自行选择」，非测验结果。</text>
    <text v-if="loading || saving" class="muted block">{{ saving ? '正在保存选择…' : '正在读取类型…' }}</text>
    <view v-if="loadError" class="card mt">
      <text>{{ loadError }}</text>
      <view class="btn-secondary mt" @click="load">重试</view>
    </view>
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
import { requestErrorMessage } from '@/api/client'

const types = ref<TypeMeta[]>([])
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')

onMounted(load)

async function load() {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const res = await listTypes()
    types.value = res.items
  } catch (error) {
    loadError.value = requestErrorMessage(error, '读取类型失败，请重试')
    uni.showToast({ title: loadError.value, icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function pick(typeCode: string) {
  if (saving.value) return
  saving.value = true
  try {
    const result = await createSelfSelectResult({
      type_code: typeCode,
      source: 'self_select',
    })
    uni.redirectTo({ url: `/pages/result/result?id=${encodeURIComponent(result.id)}` })
  } catch (error) {
    uni.showToast({ title: requestErrorMessage(error, '保存选择失败，请重试'), icon: 'none' })
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.block {
  display: block;
  margin-top: 16rpx;
}
.mt {
  margin-top: 24rpx;
}
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
