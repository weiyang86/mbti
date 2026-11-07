<template>
  <view class="page history-page">
    <text class="kicker">MY TRAJECTORY / 阶段记录</text>
    <text class="title">每一次，<text class="hl">都算一章。</text></text>
    <text class="sub">复测会新增一份快照，不覆盖旧记录；对比只在同题库版本内进行。</text>

    <view v-if="loading" class="state"><text class="state-text">正在读取记录…</text></view>

    <view v-else-if="items.length === 0" class="empty">
      <text class="empty-mark">◇</text>
      <text class="empty-title">还没有阶段记录</text>
      <text class="empty-desc">完成一次测验，这里就会留下第一份快照。</text>
      <view class="btn-primary mt" @click="goQuiz">去测一测</view>
    </view>

    <view v-else class="timeline">
      <view
        v-for="(item, i) in items"
        :key="item.id"
        class="tile"
        @click="openDetail(item.id)"
      >
        <view class="node"><text>{{ pad(items.length - i) }}</text></view>
        <view class="tile-body">
          <view class="tile-top">
            <text class="tile-type">{{ item.type_code }}</text>
            <text class="tile-name">{{ nameOf(item.type_code) }}</text>
          </view>
          <view class="tile-meta">
            <text class="tag" :class="{ self: item.source === 'self_select' }">
              {{ item.source === 'self_select' ? '自行选择' : '趣味测试' }}
            </text>
            <text class="time">{{ formatTime(item.submitted_at) }}</text>
          </view>
          <text class="version">题库版本 {{ item.question_bank_version }}</text>
        </view>
        <text class="chev">›</text>
      </view>

      <view class="btn-secondary mt" @click="goQuiz">再测一次</view>
    </view>

    <text class="foot">阶段信息默认私有 · 仅你自己可见</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { ResultSnapshotSummary, TypeMeta } from '@/api/types'
import { listResults } from '@/api/results'
import { listTypes } from '@/api/types-api'

const items = ref<ResultSnapshotSummary[]>([])
const metas = ref<TypeMeta[]>([])
const loading = ref(true)

onShow(async () => {
  loading.value = !items.value.length
  try {
    const [res, types] = await Promise.all([listResults({ limit: 50 }), listTypes()])
    items.value = res.items
    metas.value = types.items
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
})

function nameOf(code: string) {
  return metas.value.find((t) => t.type_code === code)?.name_zh || 'MBTI'
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function formatTime(iso: string) {
  return iso.replace('T', ' ').slice(0, 16)
}

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/history/detail?id=${id}` })
}

function goQuiz() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.history-page {
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
  font-size: 56rpx;
  font-weight: 800;
  line-height: 1.25;
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
  padding-top: 120rpx;
  text-align: center;
}
.state-text {
  font-size: 26rpx;
  color: #77727e;
}

.empty {
  margin-top: 64rpx;
  padding: 56rpx 32rpx;
  border-radius: 24rpx;
  border: 2rpx dashed #d7cbe7;
  background: rgba(255, 255, 255, 0.6);
  text-align: center;
}
.empty-mark {
  display: block;
  font-size: 40rpx;
  color: #b9a4da;
  letter-spacing: 6rpx;
}
.empty-title {
  display: block;
  margin-top: 20rpx;
  font-size: 30rpx;
  font-weight: 700;
}
.empty-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #77727e;
}

.timeline {
  position: relative;
  margin-top: 48rpx;
  padding-left: 8rpx;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 34rpx;
  top: 20rpx;
  bottom: 120rpx;
  width: 2rpx;
  background: #ded5eb;
}

.tile {
  position: relative;
  display: flex;
  align-items: center;
  padding: 20rpx 0;
}
.node {
  flex-shrink: 0;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: #eee7f8;
  border: 4rpx solid #faf8ff;
  color: #8a74ad;
  font-size: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 24rpx;
}
.tile-body {
  flex: 1;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 24rpx;
  padding: 24rpx;
}
.tile-top {
  display: flex;
  align-items: baseline;
}
.tile-type {
  font-size: 40rpx;
  font-weight: 800;
  color: #292630;
  letter-spacing: 2rpx;
}
.tile-name {
  margin-left: 12rpx;
  font-size: 24rpx;
  color: #77727e;
}
.tile-meta {
  display: flex;
  align-items: center;
  margin-top: 12rpx;
}
.tag {
  font-size: 20rpx;
  color: #7560df;
  background: #f1ecfb;
  border-radius: 999rpx;
  padding: 4rpx 14rpx;
}
.tag.self {
  color: #2f8f6b;
  background: #e3f4ec;
}
.time {
  margin-left: 12rpx;
  font-size: 20rpx;
  color: #a398af;
}
.version {
  display: block;
  margin-top: 10rpx;
  font-size: 20rpx;
  color: #a398af;
}
.chev {
  margin-left: 8rpx;
  font-size: 36rpx;
  color: #7560df;
}

.mt {
  margin-top: 40rpx;
}
.foot {
  display: block;
  margin-top: 48rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
