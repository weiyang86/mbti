<template>
  <view class="page">
    <view v-if="items.length === 0" class="muted">暂无记录，先去测一测吧。</view>
    <view
      v-for="item in items"
      :key="item.id"
      class="card row"
      @click="openDetail(item.id)"
    >
      <view>
        <text class="code">{{ item.type_code }}</text>
        <text class="muted block">{{ formatSource(item.source) }} · {{ formatTime(item.submitted_at) }}</text>
      </view>
      <text class="chev">›</text>
    </view>
    <view class="btn-primary mt" @click="goHome">再测一次</view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { ResultSnapshotSummary } from '@/api/types'
import { listResults } from '@/api/results'
import { requestErrorMessage } from '@/api/client'

const items = ref<ResultSnapshotSummary[]>([])

async function load() {
  try {
    const res = await listResults({ limit: 50 })
    items.value = res.items
  } catch (error) {
    uni.showToast({ title: requestErrorMessage(error, '读取阶段记录失败，请重试'), icon: 'none' })
  }
}

onShow(() => {
  load()
})

function formatSource(s: string) {
  return s === 'self_select' ? '自行选择' : '趣味测试'
}

function formatTime(iso: string) {
  return iso.replace('T', ' ').slice(0, 16)
}

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/history/detail?id=${id}` })
}

function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16rpx;
}
.code {
  font-size: 40rpx;
  font-weight: 700;
}
.block {
  display: block;
  margin-top: 8rpx;
}
.chev {
  font-size: 40rpx;
  color: #7560df;
}
.mt {
  margin-top: 32rpx;
}
</style>
