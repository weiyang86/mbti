<template>
  <view class="page m-home v3-home">
    <proto-nav />
    <view class="app-brandbar">
      <view class="a">
        <view class="me-logo sm"><text>16</text><text class="span">✦</text></view>
        <text class="b">MBTI搭子</text>
        <text class="small">测试 · 记录 · 交换</text>
      </view>
      <button class="channel-chip" @click="switchChannel">微信预览⌄</button>
    </view>
    <text class="m-kicker">MBTI TEST × PERSONALITY CARD</text>
    <view class="h1">{{ heroLead }}<text class="line"><text class="em">{{ heroAccent }}</text></text></view>
    <view class="p home-sub">{{ heroSub }}</view>

    <view class="home-showcase">
      <view class="cover-card">
        <image :src="coverArt" mode="aspectFill" />
        <view class="cover-top">
          <text>MY MBTI / MY MAIN CHARACTER</text>
          <text>001</text>
        </view>
        <view class="cover-stamp">今日人设<text class="line">我来晒</text></view>
        <view class="cover-info">
          <text class="strong cover-type">{{ coverType }}</text>
          <view class="cover-name">{{ coverName }}</view>
          <text class="p cover-quote">{{ coverQuote }}</text>
        </view>
      </view>
    </view>

    <view class="home-entry">
      <view class="btn full" @click="startQuiz">
        <AppIcon name="spark" :size="20" color="#ffffff" />
        <text>{{ ctaText }}</text>
      </view>
      <view class="quick-link" @click="goSelfSelect">已经知道类型？直接做专属名片 →</view>
      <text class="p fine centered">12 题趣味版 · 非官方量表 · 基础结果免费</text>
    </view>

    <view class="home-scenario-row">
      <view class="a" @click="goPricing">
        <text class="span">↗</text>
        <text class="b">发漂亮朋友圈</text>
        <text class="small">看 ¥9.9 晒图套装</text>
      </view>
      <view class="a" @click="goDiscover">
        <text class="span">⇄</text>
        <text class="b">交换 MBTI 名片</text>
        <text class="small">遇见相同与不同的你</text>
      </view>
    </view>

    <view class="journey-entry" @click="goHistory">
      <view>
        <text class="section-kicker">MY MBTI JOURNEY</text>
        <text class="h3">{{ resultCount ? '看看不同阶段的我' : '给现在的自己，留一个起点。' }}</text>
        <text class="p">
          {{ resultCount
            ? `已留存 ${resultCount} 次结果${latestDate ? ' · 最近 ' + latestDate : ''}`
            : '免费复测 · 私密记录 · 前后对比' }}
        </text>
      </view>
      <text class="span">↗</text>
    </view>

    <view class="mini-tools-title">
      <text class="h2">MBTI 的另一种打开方式</text>
      <text class="tag">小应用</text>
    </view>
    <view class="tool-grid">
      <view class="tool-tile radar-tile" @click="goRadar">
        <text class="i">◎</text>
        <text class="b">同型雷达</text>
        <text class="span">周边 500 米<text class="line">有多少同型搭子？</text></text>
        <text class="small">人数为模拟数据 ↗</text>
      </view>
      <view class="tool-tile" @click="goCompat">
        <text class="i">✧</text>
        <text class="b">相处小抄</text>
        <text class="span">{{ compatLine }}<text class="line">找个舒服的相处方式</text></text>
        <text class="small">趣味建议，无配对分数 ↗</text>
      </view>
    </view>

    <text class="p fine centered mt">V0.4 交互原型 · 人物、订单、推荐与附近人数均为示例</text>
  <proto-tabbar />
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '@/components/AppIcon.vue'
import type { ResultSnapshotSummary } from '@/api/types'
import { listResults } from '@/api/results'
import { TYPE_NAMES, DECLARATIONS } from '@/constants/types'
import { DEFAULT_COMPARE_TYPE } from '@/constants/compat'
import { readPublishedPreview, type PublishedPreview } from '@/api/published-config'
import { account } from '@/store/account'

const latest = ref<ResultSnapshotSummary | null>(null)
const resultCount = ref(0)
const published = ref<PublishedPreview | null>(null)

const heroLead = computed(() => published.value?.content?.headline || '你的 MBTI，')
const heroAccent = computed(() => published.value?.content?.accent || '值得一张主角卡。')
const heroSub = computed(() => published.value?.content?.sub || '测出你的类型，晒出专属形象，遇见同频搭子。')
const ctaText = computed(() => published.value?.content?.cta || '免费测测我的 MBTI')

const coverArt = '/static/share-style-illustration.webp'

const coverType = computed(() => latest.value?.type_code || 'INFP')

const nickname = computed(() => account.profile.nickname.trim() || '小禾')

const coverName = computed(() => {
  const code = latest.value?.type_code || 'INFP'
  return `${TYPE_NAMES[code] || '理想收藏家'} / ${nickname.value}`
})

const coverQuote = computed(() => {
  const code = latest.value?.type_code || 'INFP'
  return DECLARATIONS[code] || '温柔有自己的方向。'
})

const latestDate = computed(() => latest.value?.submitted_at?.slice(0, 10) || '')

const compatLine = computed(() =>
  latest.value ? `${latest.value.type_code} × ${DEFAULT_COMPARE_TYPE}` : '和不同 MBTI',
)

onShow(async () => {
  void loadPublished()
  try {
    const res = await listResults({ limit: 50 })
    resultCount.value = res.items.length
    latest.value = res.items[0] || null
  } catch {
    latest.value = null
    resultCount.value = 0
  }
})

async function loadPublished() {
  published.value = await readPublishedPreview('微信小程序')
}

function startQuiz() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function goPricing() {
  uni.navigateTo({ url: '/pages/pricing/pricing' })
}

function goHistory() {
  uni.switchTab({ url: '/pages/history/list' })
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

function goRadar() {
  uni.navigateTo({ url: '/pages/radar/radar' })
}

function goCompat() {
  uni.navigateTo({ url: '/pages/compat/compat' })
}

function switchChannel() {
  uni.showActionSheet({
    itemList: ['微信预览', '小红书预览', '抖音预览', '公众号预览'],
    success: (res) => {
      const names = ['微信', '小红书', '抖音', '公众号']
      uni.showToast({ title: `已切换为${names[res.tapIndex] || '微信'}预览（模拟）`, icon: 'none' })
    },
  })
}
</script>

<style scoped>
.h2,
.h3 {
  font-weight: 700;
}
.line {
  display: block;
}
.line .em {
  display: inline-block;
  color: var(--accent);
  position: relative;
  white-space: nowrap;
}
.line .em::after {
  content: '';
  height: 6px;
  position: absolute;
  bottom: 1px;
  left: 0;
  right: 0;
  background: #dfff8b;
  border-radius: 4px;
  z-index: -1;
}
.home-scenario-row .a .span {
  font-size: 24px;
  color: #6c4cf3;
  margin-bottom: 8px;
}
.app-brandbar {
  margin: -12px -20px 14px;
}
.quick-link {
  display: inline;
  width: auto;
  min-height: 0;
}
.app-footer {
  margin: 0 -20px;
}
.me-logo.sm {
  width: 32px;
  height: 32px;
  border-radius: 11px;
  font-size: 17px;
  letter-spacing: -3px;
  padding-right: 3px;
}
.me-logo.sm .span {
  font-size: 22px;
  margin-left: 3px;
}
</style>

