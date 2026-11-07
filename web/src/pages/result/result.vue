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

      <!-- 已购套餐：解锁面板 + 相处小抄 -->
      <template v-if="studio.tier">
        <view class="unlock-panel">
          <text class="unlock-tag">套装已解锁</text>
          <text class="unlock-title">你的 MBTI 形象，随时可以换。</text>
          <text class="unlock-desc">选择风格、制作海报、保存头像和相处卡。</text>
          <view class="btn-primary mt" @click="goCreate">去制作我的名片</view>
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
      </template>

      <!-- 未购套餐：晒图套装引导 -->
      <view v-else class="offer">
        <text class="offer-tag">为 {{ result.type_code }} 的你准备</text>
        <text class="offer-title" v-for="(line, i) in sceneLines" :key="i">{{ line }}</text>
        <text class="offer-desc">你专享的是一整套能晒、能留、能展示的专属素材。</text>

        <view class="scene-tabs">
          <view
            v-for="s in SCENE_TABS"
            :key="s.key"
            class="scene-tab"
            :class="{ active: sceneTab === s.key }"
            @click="sceneTab = s.key"
          >
            <text>{{ s.label }}</text>
          </view>
        </view>

        <view class="preview-card">
          <view class="pv-head">
            <image class="pv-avatar" :src="previewAsset" mode="aspectFill" />
            <view class="pv-head-main">
              <text class="pv-name">{{ nickname }}</text>
              <text class="pv-mock">虚拟形象 · 示例</text>
            </view>
          </view>
          <text class="pv-quote">同样是 {{ result.type_code }}，我也有自己的主角感。</text>
          <view class="pv-img-wrap">
            <image class="pv-img" :src="previewAsset" mode="aspectFill" />
            <view class="pv-overlay">
              <text class="pv-type">{{ result.type_code }}</text>
              <text class="pv-type-name">{{ nickname }} / {{ typeName }}</text>
            </view>
          </view>
          <text class="pv-note">AI 示例人物</text>
        </view>

        <view class="format-tabs">
          <view
            v-for="f in FORMAT_TABS"
            :key="f"
            class="format-tab"
            :class="{ active: formatTab === f }"
            @click="formatTab = f"
          >
            <text>{{ f }}</text>
          </view>
        </view>

        <view class="pack-grid">
          <view v-for="p in PACKS" :key="p.no" class="pack-item">
            <text class="pack-cat">{{ p.no }} / {{ p.cat }}</text>
            <text class="pack-title">{{ p.title }}</text>
            <text class="pack-desc">{{ p.desc }}</text>
          </view>
        </view>

        <view class="btn-primary offer-cta" @click="goCheckout('studio_tier_1')">¥9.9 · 制作我的 MBTI 晒图套装 →</view>
        <text class="fine centered">一次购买 · 无订阅 · 当前为模拟支付</text>
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
import { studio, styleAsset } from '@/store/studio'

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

const sceneTab = ref<'moments' | 'avatar' | 'meet'>('moments')
const formatTab = ref('朋友圈图')
const SCENE_TABS = [
  { key: 'moments', label: '发朋友圈', lines: ['把我的 MBTI，', '发成一条漂亮朋友圈。'] },
  { key: 'avatar', label: '换同款头像', lines: ['换个头像，', '让我的 MBTI 有点辨识度。'] },
  { key: 'meet', label: '见面亮名片', lines: ['认识新朋友，', '先亮出我的 MBTI 名片。'] },
] as const
const FORMAT_TABS = ['日常海报', '朋友圈图', '未来滤镜']
const PACKS = [
  { no: '01', cat: '主角图', title: '朋友圈 MBTI 海报', desc: '3 种风格 · 3 种比例' },
  { no: '02', cat: '头像', title: '同款人格头像', desc: '1:1 PNG 独立保存' },
  { no: '03', cat: '相处卡', title: '我的相处小抄', desc: '充电 · 沟通 · 在意' },
  { no: '04', cat: '配文', title: '发圈文案准备好', desc: '改一句就能复制' },
]

const sceneLines = computed(
  () => SCENE_TABS.find((s) => s.key === sceneTab.value)?.lines || SCENE_TABS[0].lines,
)
const previewAsset = computed(() => styleAsset(studio.style))
const nickname = computed(() => studio.nickname || '小禾')

function goCreate() {
  uni.navigateTo({ url: '/pages/create/create' })
}

function goCheckout(productCode: string) {
  const id = resultId.value
  const suffix = id ? `&result_id=${encodeURIComponent(id)}` : ''
  uni.navigateTo({ url: `/pages/unlock/unlock?product_code=${productCode}${suffix}` })
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

/* 已购：解锁面板 */
.unlock-panel {
  margin-top: 40rpx;
  padding: 32rpx 28rpx;
  border-radius: 26rpx;
  background: linear-gradient(140deg, #f2f7ec, #eef4e4 60%, #f8f6f0);
  border: 2rpx solid #e2ecd3;
}
.unlock-tag {
  display: inline-block;
  font-size: 19rpx;
  color: #4f6b2c;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 999rpx;
  padding: 6rpx 18rpx;
}
.unlock-title {
  display: block;
  margin-top: 16rpx;
  font-size: 34rpx;
  font-weight: 800;
  line-height: 1.45;
  color: #2f3524;
}
.unlock-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 23rpx;
  color: #7c8670;
  line-height: 1.7;
}

/* 未购：晒图引导 */
.offer {
  display: block;
  margin-top: 44rpx;
  padding: 34rpx 28rpx 30rpx;
  border-radius: 30rpx;
  background: linear-gradient(150deg, #f6f1ff, #efe8ff 55%, #f2f7ec);
  border: 2rpx solid #e3d9f6;
}
.offer-tag {
  display: inline-block;
  font-size: 19rpx;
  color: #6d58b2;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 999rpx;
  padding: 6rpx 18rpx;
}
.offer-title {
  display: block;
  margin-top: 16rpx;
  font-size: 40rpx;
  font-weight: 800;
  line-height: 1.45;
  color: #2c2550;
}
.offer-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 23rpx;
  color: #6f6880;
  line-height: 1.7;
}

.scene-tabs,
.format-tabs {
  display: flex;
  gap: 14rpx;
  margin-top: 24rpx;
}
.scene-tab,
.format-tab {
  flex: 1;
  text-align: center;
  padding: 18rpx 8rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.7);
  color: #7c6f96;
  font-size: 22rpx;
  border: 2rpx solid transparent;
}
.scene-tab.active,
.format-tab.active {
  background: #6c4cf3;
  color: #fff;
}

.preview-card {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 26rpx;
  background: #fff;
  border: 2rpx solid #e9e3f1;
}
.pv-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.pv-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  flex: none;
}
.pv-head-main {
  display: flex;
  flex-direction: column;
}
.pv-name {
  font-size: 26rpx;
  font-weight: 700;
  color: #292630;
}
.pv-mock {
  font-size: 19rpx;
  color: #a398af;
  margin-top: 2rpx;
}
.pv-quote {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #3f3552;
  line-height: 1.6;
}
.pv-img-wrap {
  position: relative;
  margin-top: 16rpx;
  border-radius: 20rpx;
  overflow: hidden;
}
.pv-img {
  width: 100%;
  height: 420rpx;
  display: block;
}
.pv-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24rpx;
  background: linear-gradient(180deg, rgba(36, 22, 62, 0), rgba(36, 22, 62, 0.85));
  display: flex;
  flex-direction: column;
}
.pv-type {
  font-size: 64rpx;
  font-weight: 800;
  color: #fff;
  line-height: 1;
}
.pv-type-name {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.9);
}
.pv-note {
  display: block;
  margin-top: 12rpx;
  font-size: 18rpx;
  color: #a398af;
}

.pack-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 20rpx;
}
.pack-item {
  width: calc(50% - 8rpx);
  box-sizing: border-box;
  padding: 22rpx 20rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.78);
  border: 2rpx solid #ece5f6;
}
.pack-cat {
  display: block;
  font-size: 18rpx;
  color: #8f7bb0;
  letter-spacing: 1rpx;
}
.pack-title {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: #2c2550;
}
.pack-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: #8b8099;
}

.offer-cta {
  margin-top: 26rpx;
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
