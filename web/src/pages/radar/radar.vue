<template>
  <view class="page radar-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <view v-if="loading" class="state"><text class="state-text">正在雷达扫描…</text></view>

    <view v-else-if="loadError" class="state">
      <text class="state-text">同型雷达读取失败</text>
      <view class="btn-secondary mt" @click="load">重试</view>
    </view>

    <template v-else>
      <text class="kicker">SAME TYPE RADAR / 同型雷达</text>
      <text class="title">周边 {{ radiusLabel }}，</text>
      <text class="title">有多少个<text class="hl">同型的你？</text></text>
      <text class="sub">查看自愿参与者的类型人数，不展示任何人的具体位置。</text>

      <view v-if="!hasType" class="notice mt">
        <text>当前以 INFP 示例类型体验。</text>
        <text class="notice-link" @click="goSelfSelect">选择我的 MBTI →</text>
      </view>

      <view class="radar-demo-label">DEMO · 虚构示例区域 · 未读取 GPS</view>

      <view class="radar-visual">
        <view class="radar-ring r1" />
        <view class="radar-ring r2" />
        <view class="radar-ring r3" />
        <view class="radar-center">
          <text class="radar-center-type">{{ typeCode }} / {{ radiusLabel }}</text>
          <text class="radar-center-count">{{ countText }}</text>
          <text class="radar-center-note">{{ countNote }}</text>
        </view>
      </view>

      <view class="radius-tabs">
        <view
          v-for="r in RADII"
          :key="r"
          class="tab"
          :class="{ active: radius === r }"
          @click="setRadius(r)"
        >
          <text>{{ radiusText(r) }}</text>
        </view>
      </view>

      <template v-if="enrolled">
        <view class="notice green mt">
          当前仅演示匿名人数统计，不生成附近人员列表，也不展示位置标记。
        </view>
        <view class="btn-ghost mt" @click="closeRadar">关闭本次雷达体验</view>
      </template>
      <template v-else>
        <view class="btn-primary mt" @click="enroll">体验同型雷达（模拟授权）</view>
        <view class="btn-text mt" @click="deny">模拟拒绝授权</view>
      </template>

      <view class="radar-rules">
        <text class="rules-title">看见同类，不暴露行踪。</text>
        <text class="rules-text">
          正式方案：主动加入、可随时关闭；少于 10 人时仅显示“人数较少”，不展示精确人数或个人轨迹。
        </text>
      </view>

      <view class="btn-secondary mt" @click="goDiscover">去看非位置推荐的 MBTI 搭子</view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import {
  getRadarParticipation,
  getSameTypeCount,
  updateRadarParticipation,
} from '@/api/radar'

const RADII = [500, 1000, 3000] as const

const typeCode = ref('INFP')
const hasType = ref(false)
const radius = ref<number>(500)
const enrolled = ref(false)
const count = ref<number | null>(null)
const loading = ref(true)
const loadError = ref(false)

const radiusLabel = computed(() => radiusText(radius.value))

const countText = computed(() => {
  if (!enrolled.value) return '—'
  if (count.value === null) return '人数较少'
  return String(count.value)
})

const countNote = computed(() => {
  if (!enrolled.value) return '先选择体验状态'
  if (count.value === null) return '附近同型参与者较少'
  return '位同型参与者 · 模拟人数'
})

onShow(() => load())

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [card, participation] = await Promise.all([getMyCard(), getRadarParticipation()])
    typeCode.value = card.type_code || 'INFP'
    hasType.value = Boolean(card.type_code)
    enrolled.value = participation.enrolled
    await refreshCount()
  } catch {
    enrolled.value = false
    count.value = null
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function refreshCount() {
  if (!enrolled.value) {
    count.value = null
    return
  }
  try {
    const res = await getSameTypeCount({ type_code: typeCode.value, radius_m: radius.value })
    count.value = res.count
  } catch {
    count.value = null
  }
}

function radiusText(r: number) {
  return r === 500 ? '500 米' : `${r / 1000} 公里`
}

function setRadius(r: number) {
  if (radius.value === r) return
  radius.value = r
  refreshCount()
}

async function enroll() {
  try {
    await updateRadarParticipation({ enrolled: true })
    enrolled.value = true
    await refreshCount()
    uni.showToast({ title: '已进入模拟雷达，未读取真实定位', icon: 'none' })
  } catch {
    uni.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
  }
}

async function closeRadar() {
  try {
    await updateRadarParticipation({ enrolled: false })
    enrolled.value = false
    count.value = null
    uni.showToast({ title: '已关闭雷达体验', icon: 'none' })
  } catch {
    uni.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
  }
}

async function deny() {
  try {
    await updateRadarParticipation({ enrolled: false })
    enrolled.value = false
    count.value = null
    uni.showToast({ title: '已模拟拒绝授权，不展示人数', icon: 'none' })
  } catch {
    uni.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
  }
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：雷达仅展示虚构的匿名人数统计，未读取真实定位，不会生成人员列表或位置标记。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.radar-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 24rpx;
}
.demo-link {
  color: #7560df;
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
  margin-top: 12rpx;
  font-size: 56rpx;
  font-weight: 800;
  line-height: 1.28;
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
  padding-top: 220rpx;
  text-align: center;
}
.state-text {
  font-size: 28rpx;
  color: #77727e;
}

.notice {
  display: block;
  background: #f5f3fa;
  border: 2rpx solid #e9e3f3;
  padding: 26rpx 30rpx;
  border-radius: 24rpx;
  color: #7c728b;
  font-size: 24rpx;
  line-height: 1.7;
}
.notice.green {
  background: #eef7e3;
  border-color: #d8ebc2;
  color: #4c6b2f;
}
.notice-link {
  color: #7560df;
  margin-left: 8rpx;
}
.mt {
  margin-top: 28rpx;
}

.radar-demo-label {
  display: inline-block;
  margin-top: 32rpx;
  padding: 10rpx 20rpx;
  border-radius: 14rpx;
  background: #e7eddb;
  color: #596d35;
  font-size: 20rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
}

.radar-visual {
  position: relative;
  width: 540rpx;
  height: 540rpx;
  margin: 48rpx auto 8rpx;
}
.radar-ring {
  position: absolute;
  border-radius: 50%;
  border: 2rpx solid #d9c9f5;
  background: #f7f2fc;
}
.r1 {
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.r2 {
  top: 90rpx;
  left: 90rpx;
  right: 90rpx;
  bottom: 90rpx;
}
.r3 {
  top: 180rpx;
  left: 180rpx;
  right: 180rpx;
  bottom: 180rpx;
}
.radar-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 260rpx;
  height: 260rpx;
  border-radius: 50%;
  background: #6c4cf3;
  color: #fff;
  box-shadow: 0 12rpx 40rpx rgba(108, 76, 243, 0.35);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.radar-center-type {
  font-size: 20rpx;
  letter-spacing: 1rpx;
  opacity: 0.85;
}
.radar-center-count {
  font-size: 72rpx;
  font-weight: 800;
  line-height: 1.1;
  margin-top: 6rpx;
}
.radar-center-note {
  font-size: 20rpx;
  margin-top: 6rpx;
  opacity: 0.9;
}

.radius-tabs {
  display: flex;
  gap: 16rpx;
}
.tab {
  flex: 1;
  text-align: center;
  padding: 20rpx;
  min-height: 84rpx;
  border-radius: 22rpx;
  background: #eee7f5;
  color: #90779f;
  font-size: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tab.active {
  background: #6c4cf3;
  color: #fff;
}

.btn-primary,
.btn-ghost,
.btn-secondary {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx;
  font-size: 28rpx;
  font-weight: 600;
}
.btn-primary {
  background: #6c4cf3;
  color: #fff;
}
.btn-ghost {
  background: transparent;
  color: #77727e;
  border: 2rpx solid #ece7f1;
}
.btn-secondary {
  background: #fff;
  color: #6c4cf3;
  border: 2rpx solid #d9c9f5;
}
.btn-text {
  display: block;
  text-align: center;
  color: #8b8099;
  font-size: 26rpx;
  padding: 16rpx;
}

.radar-rules {
  margin-top: 40rpx;
  padding: 32rpx;
  background: #fff;
  border: 2rpx solid #e9e3f1;
  border-radius: 28rpx;
}
.rules-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.rules-text {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.7;
}
</style>