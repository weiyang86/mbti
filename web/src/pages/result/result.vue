<template>
  <view class="page result-page">
    <view v-if="loading" class="state"><text class="state-text">正在读取结果…</text></view>

    <view v-else-if="!result" class="state">
      <text class="state-text">找不到这份结果</text>
      <view class="btn-primary mt" @click="goHome">回首页测一次</view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>

      <view class="banner">
        <text class="banner-label">{{ sourceLabel }} · 免费查看</text>
        <text class="banner-type">{{ result.type_code }}</text>
        <text class="banner-name">{{ typeName }}</text>
        <text class="banner-line">{{ declaration }}</text>
        <text class="banner-meta">{{ dateText }} · 版本 {{ result.question_bank_version }}</text>
      </view>

      <view class="dims" v-if="result.dimension_counts">
        <view class="section-head">
          <text class="section">四维分布</text>
          <text class="section-tag">选项计数</text>
        </view>
        <view class="dim-row" v-for="d in dimRows" :key="d.key">
          <view class="dim-head">
            <text class="dim-label">{{ d.left }}</text>
            <text class="dim-count">{{ d.l }} : {{ d.r }}</text>
            <text class="dim-label right">{{ d.right }}</text>
          </view>
          <view class="track"><view class="fill" :style="{ width: d.pct }" /></view>
        </view>
        <text class="fine">图示为选项分布，不代表人格强弱或可信度</text>
      </view>

      <view v-else class="notice">
        自选类型没有答题分布。想看到四维得分，可以完成一次 12 题趣味测试。
      </view>

      <view v-if="result.source === 'quiz'" class="result-saved">
        <text class="saved-badge">✓ 这次结果已新增到我的轨迹</text>
        <text class="saved-title">{{ savedTitle }}</text>
        <text class="saved-meta">
          {{ dateLabel(result.submitted_at) }} · {{ result.life_stage || '日常生活' }} · 历史不会被本次测试覆盖
        </text>
        <view v-if="previous" class="btn-secondary mt" @click="goCompare">查看这两次的变化</view>
        <text v-else class="saved-link" @click="goHistory">查看我的轨迹 →</text>
      </view>

      <view v-else class="journey-entry" @click="goHistory">
        <view class="journey-main">
          <text class="journey-kicker">MY MBTI JOURNEY</text>
          <text class="journey-title">看看不同阶段的我</text>
          <text class="journey-desc">免费复测 · 私密记录 · 前后对比</text>
        </view>
        <text class="journey-arrow">↗</text>
      </view>

      <view class="manual">
        <text class="section">我的相处小抄</text>
        <view class="manual-card" v-for="m in manual" :key="m.no">
          <text class="no">{{ m.no }}</text>
          <view class="manual-body">
            <text class="m-title">{{ m.title }}</text>
            <text class="m-text">{{ m.body }}</text>
          </view>
        </view>
        <text class="fine">依据当前类型的模板建议，可随真实相处调整</text>
      </view>

      <view class="studio-panel">
        <text class="studio-tag">{{ studio.hasCard ? '套装已准备好' : studio.tier ? '套装已解锁' : '晒图套装 · 示例预览' }}</text>
        <text class="studio-title">把我的 MBTI，发成一条漂亮朋友圈。</text>
        <text class="studio-desc">成图 + 头像 + 相处卡 + 配文，一次购买，无自动续费。</text>
        <view class="studio-packs">
          <text class="studio-pack">01 主角图</text>
          <text class="studio-pack">02 头像</text>
          <text class="studio-pack">03 相处卡</text>
          <text class="studio-pack">04 配文</text>
        </view>
        <view class="btn-primary mt" @click="goStudio">{{ studioCta }}</view>
      </view>

      <view class="discovery-card" @click="goDiscover">
        <view class="discovery-main">
          <text class="discovery-title">先去看看我的同型搭子</text>
          <text class="discovery-desc">基础名片交换免费，联系方式由双方决定。</text>
        </view>
        <text class="discovery-arrow">⇄</text>
      </view>

      <text class="foot">趣味倾向体验 · 非临床测评 · 不宣称官方量表效度</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { ResultSnapshot } from '@/api/types'
import { getResult, listResults } from '@/api/results'
import { TYPE_NAMES, DECLARATIONS } from '@/constants/types'
import { buildManual } from '@/constants/manual'
import { dateLabel, summaryText } from '@/constants/journey'
import { studio } from '@/store/studio'

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const previous = ref<ResultSnapshot | null>(null)
const loading = ref(true)

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(async () => {
  if (!resultId.value) {
    loading.value = false
    return
  }
  try {
    result.value = await getResult(resultId.value)
  } catch {
    result.value = null
  } finally {
    loading.value = false
  }
  if (result.value?.source === 'quiz') {
    await loadPrevious()
  }
})

/** 查找同版本、时间更早的上一份测验记录，用于结果页的「查看变化」入口 */
async function loadPrevious() {
  const current = result.value
  if (!current) return
  try {
    const res = await listResults({ limit: 50 })
    const older = res.items
      .filter(
        (i) =>
          i.source === 'quiz' &&
          i.question_bank_version === current.question_bank_version &&
          i.id !== current.id &&
          i.submitted_at < current.submitted_at,
      )
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0]
    if (older) previous.value = await getResult(older.id)
  } catch {
    previous.value = null
  }
}

const savedTitle = computed(() =>
  previous.value && result.value
    ? summaryText(previous.value, result.value)
    : '第一份基线，已经留好。',
)

function goCompare() {
  if (!previous.value || !result.value) return
  uni.navigateTo({
    url: `/pages/compare/compare?baseline=${previous.value.id}&target=${result.value.id}`,
  })
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

const typeName = computed(() => TYPE_NAMES[result.value?.type_code || ''] || 'MBTI')

const declaration = computed(
  () =>
    DECLARATIONS[result.value?.type_code || ''] ||
    '四个字母之外，还有不一样的你。',
)

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：结果来自本地 mock，不产生真实费用，也未连接真实后端。',
    showCancel: false,
    confirmText: '知道了',
  })
}

const sourceLabel = computed(() =>
  result.value?.source === 'self_select' ? '你的自选人格类型' : '你的趣味测试结果',
)

const dateText = computed(() =>
  result.value ? result.value.submitted_at.slice(0, 10) : '',
)

const DIM_LABELS: [string, string, string][] = [
  ['EI', '外向 E', '内向 I'],
  ['SN', '实感 S', '直觉 N'],
  ['TF', '思考 T', '情感 F'],
  ['JP', '判断 J', '知觉 P'],
]

const dimRows = computed(() => {
  const counts = result.value?.dimension_counts
  if (!counts) return []
  return DIM_LABELS.map(([key, left, right]) => {
    const l = counts[key[0] as keyof typeof counts] ?? 0
    const r = counts[key[1] as keyof typeof counts] ?? 0
    const total = l + r || 1
    return {
      key,
      left,
      right,
      l,
      r,
      pct: `${Math.round((l / total) * 100)}%`,
    }
  })
})

const manual = computed(() => buildManual(result.value?.type_code || 'INFP'))

function goShare() {
  if (!resultId.value) return
  uni.navigateTo({ url: `/pages/share-preview/share-preview?id=${resultId.value}` })
}

const studioCta = computed(() => {
  if (!studio.tier) return '¥9.9 · 制作我的 MBTI 晒图套装'
  if (studio.hasCard) return '去晒出我的名片 →'
  return '去制作我的名片 →'
})

function goStudio() {
  if (!studio.tier) {
    uni.navigateTo({ url: '/pages/pricing/pricing' })
    return
  }
  if (studio.hasCard) {
    goShare()
    return
  }
  uni.navigateTo({ url: '/pages/create/create' })
}

function goHistory() {
  uni.reLaunch({ url: '/pages/history/list' })
}

function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.result-page {
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

.state {
  padding-top: 220rpx;
  text-align: center;
}
.state-text {
  display: block;
  font-size: 26rpx;
  color: #77727e;
}

.banner {
  border-radius: 32rpx;
  padding: 40rpx 36rpx;
  background: linear-gradient(160deg, #f3eefe 0%, #efeaff 55%, #e7f6ee 100%);
  border: 2rpx solid #e6dffa;
}
.banner-label {
  display: block;
  font-size: 22rpx;
  color: #7560df;
  letter-spacing: 1rpx;
}
.banner-type {
  display: block;
  margin-top: 20rpx;
  font-size: 104rpx;
  font-weight: 800;
  letter-spacing: 4rpx;
  color: #7560df;
  line-height: 1;
}
.banner-name {
  display: block;
  margin-top: 12rpx;
  font-size: 34rpx;
  font-weight: 700;
  color: #292630;
}
.banner-line {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #77727e;
  line-height: 1.6;
}
.banner-meta {
  display: block;
  margin-top: 20rpx;
  font-size: 22rpx;
  color: #a398af;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section {
  display: block;
  margin-top: 48rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: #292630;
}
.section-tag {
  margin-top: 48rpx;
  font-size: 20rpx;
  color: #a398af;
  background: #f1ecfb;
  border-radius: 999rpx;
  padding: 6rpx 16rpx;
}

.dim-row {
  margin-top: 24rpx;
}
.dim-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dim-label {
  font-size: 24rpx;
  color: #292630;
}
.dim-label.right {
  text-align: right;
}
.dim-count {
  font-size: 22rpx;
  color: #7560df;
}
.track {
  margin-top: 12rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background: #ece8f3;
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #8b6cf6, #dfff8b);
}

.notice {
  margin-top: 32rpx;
  padding: 24rpx;
  border-radius: 16rpx;
  background: #f3f0f8;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.manual {
  margin-top: 8rpx;
}
.manual-card {
  display: flex;
  margin-top: 20rpx;
  padding: 28rpx 24rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 24rpx;
}
.no {
  flex-shrink: 0;
  width: 56rpx;
  font-size: 22rpx;
  color: #7560df;
  font-weight: 700;
  margin-right: 16rpx;
}
.manual-body {
  flex: 1;
}
.m-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.m-text {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #77727e;
}

.fine {
  display: block;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #a398af;
  line-height: 1.6;
}

.studio-panel {
  margin-top: 48rpx;
  padding: 32rpx 28rpx;
  border-radius: 26rpx;
  background: linear-gradient(140deg, #f7f2ff, #efe8ff 55%, #e7f6ea);
  border: 2rpx solid #e3d9f6;
}
.studio-tag {
  display: inline-block;
  font-size: 19rpx;
  color: #6d58b2;
  background: rgba(255, 255, 255, 0.75);
  border-radius: 999rpx;
  padding: 6rpx 18rpx;
}
.studio-title {
  display: block;
  margin-top: 16rpx;
  font-size: 34rpx;
  font-weight: 800;
  line-height: 1.45;
}
.studio-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #6f6880;
  line-height: 1.7;
}
.studio-packs {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 18rpx;
}
.studio-pack {
  font-size: 20rpx;
  color: #5b47a8;
  background: #fff;
  border-radius: 999rpx;
  padding: 8rpx 18rpx;
}

.result-saved {
  margin-top: 40rpx;
  padding: 30rpx 28rpx;
  border-radius: 26rpx;
  background: linear-gradient(140deg, #f2f7ec, #eef4e4 60%, #f8f6f0);
  border: 2rpx solid #e2ecd3;
}
.saved-badge {
  display: inline-block;
  font-size: 20rpx;
  color: #4f6b2c;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 999rpx;
  padding: 6rpx 16rpx;
}
.saved-title {
  display: block;
  margin-top: 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.5;
  color: #2f3524;
}
.saved-meta {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: #7c8670;
  line-height: 1.6;
}
.saved-link {
  display: inline-block;
  margin-top: 18rpx;
  font-size: 24rpx;
  color: #5a7a3a;
}

.journey-entry {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 40rpx;
  padding: 28rpx 26rpx;
  border-radius: 24rpx;
  background: linear-gradient(120deg, #211a36, #3a2c58 60%, #4b3570);
  box-shadow: 0 18rpx 40rpx rgba(33, 26, 54, 0.22);
}
.journey-main {
  flex: 1;
}
.journey-kicker {
  display: block;
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: rgba(255, 255, 255, 0.55);
}
.journey-title {
  display: block;
  margin-top: 8rpx;
  font-size: 28rpx;
  font-weight: 700;
  color: #fff;
}
.journey-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.66);
}
.journey-arrow {
  font-size: 32rpx;
  color: #dfff8b;
}

.discovery-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 40rpx;
  min-height: 160rpx;
  padding: 28rpx 26rpx;
  border-radius: 26rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
}
.discovery-main {
  flex: 1;
}
.discovery-title {
  display: block;
  font-size: 29rpx;
  font-weight: 700;
  color: #292630;
}
.discovery-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  color: #77727e;
  line-height: 1.6;
}
.discovery-arrow {
  font-size: 34rpx;
  color: #7560df;
}
.btn-primary {
  font-weight: 700;
}
.mt {
  margin-top: 20rpx;
}

.foot {
  display: block;
  margin-top: 48rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}
</style>
