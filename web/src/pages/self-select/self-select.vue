<template>
  <view class="page select-page">
    <text class="kicker">MY TYPE / 直接做名片</text>
    <text class="title">把四个字母，<text class="hl">做成你的专属形象。</text></text>
    <text class="sub">选好类型，就能看你的朋友圈成图效果。这里使用你自选的类型，不会伪造测评成绩。</text>

    <view v-if="loading" class="state"><text class="state-text">正在加载 16 型…</text></view>

    <view v-else>
      <view v-for="g in groups" :key="g.label" class="group">
        <text class="group-label">{{ g.label }}</text>
        <view class="grid">
          <view
            v-for="t in g.items"
            :key="t.type_code"
            class="type-tile"
            :class="{ active: selected === t.type_code }"
            @click="selected = t.type_code"
          >
            <text class="code">{{ t.type_code }}</text>
            <text class="name">{{ t.name_zh }}</text>
          </view>
        </view>
      </view>

      <view class="actions">
        <view class="btn-primary" @click="confirm">用 {{ selected }} 看结果</view>
        <view class="btn-secondary mt" @click="goHome">回首页测一测</view>
      </view>

      <view class="notice">自选类型生成的快照没有答题分布，也不能用于同版本对比。</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { TypeMeta } from '@/api/types'
import { listTypes } from '@/api/types-api'
import { createSelfSelectResult } from '@/api/results'

const GROUP_DEFS: { label: string; codes: string[] }[] = [
  { label: '分析家', codes: ['INTJ', 'INTP', 'ENTJ', 'ENTP'] },
  { label: '外交家', codes: ['INFJ', 'INFP', 'ENFJ', 'ENFP'] },
  { label: '守护者', codes: ['ISTJ', 'ISFJ', 'ESTJ', 'ESFJ'] },
  { label: '探索者', codes: ['ISTP', 'ISFP', 'ESTP', 'ESFP'] },
]

const metas = ref<TypeMeta[]>([])
const groups = ref<{ label: string; items: TypeMeta[] }[]>([])
const selected = ref('INFP')
const loading = ref(true)
const submitting = ref(false)

onMounted(async () => {
  try {
    const res = await listTypes()
    metas.value = res.items
    groups.value = GROUP_DEFS.map((g) => ({
      label: g.label,
      items: g.codes
        .map((code) => res.items.find((t) => t.type_code === code))
        .filter((t): t is TypeMeta => Boolean(t)),
    }))
  } catch {
    groups.value = []
  } finally {
    loading.value = false
  }
})

async function confirm() {
  if (submitting.value) return
  submitting.value = true
  try {
    const snapshot = await createSelfSelectResult({
      type_code: selected.value,
      source: 'self_select',
    })
    uni.redirectTo({ url: `/pages/result/result?id=${snapshot.id}` })
  } catch {
    uni.showToast({ title: '生成失败，请重试', icon: 'none' })
    submitting.value = false
  }
}

function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.select-page {
  padding-top: 40rpx;
  padding-bottom: 56rpx;
}

.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
  font-weight: 600;
}
.title {
  display: block;
  margin-top: 16rpx;
  font-size: 52rpx;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: -1rpx;
}
.hl {
  color: #7560df;
  border-bottom: 10rpx solid #dfff8b;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.state {
  padding-top: 140rpx;
  text-align: center;
}
.state-text {
  font-size: 26rpx;
  color: #77727e;
}

.group {
  margin-top: 44rpx;
}
.group-label {
  display: block;
  font-size: 22rpx;
  color: #a398af;
  letter-spacing: 1rpx;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
  margin-top: 16rpx;
}
.type-tile {
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 24rpx;
  padding: 24rpx 20rpx;
}
.type-tile.active {
  border-color: #7560df;
  background: #f6f2ff;
}
.code {
  display: block;
  font-size: 36rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: #292630;
}
.type-tile.active .code {
  color: #7560df;
}
.name {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #77727e;
}

.actions {
  margin-top: 56rpx;
}
.btn-primary {
  font-weight: 700;
}
.mt {
  margin-top: 20rpx;
}

.notice {
  margin-top: 36rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background: #f3f0f8;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.6;
}
</style>
