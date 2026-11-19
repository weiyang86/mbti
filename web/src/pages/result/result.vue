<template>
  <view>
    <proto-nav />
    <view class="page">
      <view v-if="loading" class="state"><text class="state-text">正在读取结果…</text></view>

      <template v-else-if="!result">
        <view class="page-intro">
          <view class="eyebrow">MBTI BUDDY</view>
          <view class="h1">先发现你的类型</view>
          <view class="p">完成选择题，或直接使用已知 MBTI。</view>
        </view>
        <button class="btn full" @click="goTestIntro">免费开始测试</button>
      </template>

      <template v-else>
        <view class="demo-strip">
          <text>V0.4 · Mock 演示 · 不产生费用</text>
          <button class="textbtn" @click="demoState">演示状态 ↗</button>
        </view>

        <view class="result-banner">
          <text class="span">{{ sourceLabel }} · 免费查看</text>
          <text class="strong">{{ result.type_code }}</text>
          <view class="h2">{{ typeName }}</view>
          <view class="p">{{ declaration }}</view>
        </view>

        <view v-if="!hasDimensions" class="notice">
          当前类型由你自选。想看看选择题会得到哪一型？
          <text class="textbtn" @click="goTestIntro">免费测一次 →</text>
        </view>
        <template v-else>
          <view class="dimension-list">
            <view v-for="d in dimRows" :key="d.key">
              <view class="dimension-head">
                <text>{{ d.left }}</text>
                <text class="small">选择分布 {{ d.l }} : {{ d.r }}</text>
                <text>{{ d.right }}</text>
              </view>
              <view class="dimension-track"><view class="i" :style="{ width: d.pct }" /></view>
            </view>
          </view>
          <view class="fine">每个维度仅 3 题，图示为选项分布，不是可信度或人格强弱。</view>
        </template>

        <view v-if="result.source !== 'quiz'" class="journey-entry" @click="goHistory">
          <view>
            <text class="section-kicker">MY MBTI JOURNEY</text>
            <view class="h3">{{ historyTitle }}</view>
            <view class="p">{{ historyDesc }}</view>
          </view>
          <text class="span">↗</text>
        </view>
        <view v-else class="result-saved">
          <text class="span">✓ 这次结果已新增到我的轨迹</text>
          <view class="h3">{{ savedTitle }}</view>
          <view class="p">{{ savedMeta }}</view>
          <button v-if="previous" class="btn secondary full" @click="goCompare">
            查看这两次的变化
          </button>
          <text v-else class="textbtn" @click="goHistory">查看我的轨迹 →</text>
        </view>

        <template v-if="studio.tier">
          <view class="panel mt">
            <text class="tag mint">套装已解锁</text>
            <view class="h3 mt">你的 MBTI 形象，随时可以换。</view>
            <view class="p">选择风格、制作海报、保存头像和相处卡。</view>
            <button class="btn full" @click="goCreate">去制作我的名片</button>
          </view>

          <view class="manual-cards">
            <view v-for="m in manual" :key="m.no">
              <text>{{ m.no }}</text>
              <view>
                <view class="h3">{{ m.title }}</view>
                <view class="p">{{ m.body }}</view>
              </view>
            </view>
          </view>
          <view class="fine">依据当前类型的模板建议，可按真实相处调整。</view>
        </template>

        <view v-else class="scene-offer inline-offer">
          <view class="offer-heading">
            <text class="tag">为 {{ result.type_code }} 的你准备</text>
            <view class="h2">
              <text>{{ sceneLines[0] }}</text>
              <text class="line">{{ sceneLines[1] }}</text>
            </view>
            <view class="p">你拿到的是一套能保存、能展示的专属素材。</view>
          </view>

          <view class="scene-tabs">
            <button
              v-for="s in SCENE_TABS"
              :key="s.key"
              :class="{ active: sceneTab === s.key }"
              @click="sceneTab = s.key"
            >
              {{ s.label }}
            </button>
          </view>

          <view v-if="sceneTab === 'moments'" class="scenario-preview moments-scenario">
            <view class="feed-head">
              <image :src="assetUrl" mode="aspectFill" />
              <view>
                <text class="b">{{ displayName }}</text>
                <text class="small">朋友圈效果预览 · 未发布</text>
              </view>
            </view>
            <view class="p feed-caption">同样是 {{ result.type_code }}，我也有自己的主角感。✦</view>
            <view class="feed-photo">
              <image :src="assetUrl" mode="aspectFill" />
              <view>
                <text class="strong">{{ result.type_code }}</text>
                <text class="span">{{ displayName }} / {{ typeName }}</text>
              </view>
            </view>
            <text class="preview-badge">AI 示例人物</text>
          </view>

          <view v-else-if="sceneTab === 'avatar'" class="scenario-preview avatar-scenario">
            <view class="avatar-stack">
              <image :src="assetUrl" mode="aspectFill" />
              <text class="b">{{ result.type_code }}</text>
            </view>
            <view class="h3">头像也要有我的 MBTI 气质。</view>
            <view class="p">同款 1:1 头像，可单独下载。</view>
            <text class="preview-badge">AI 虚构人物样例</text>
          </view>

          <view v-else class="scenario-preview meet-scenario">
            <view class="mini-pass">
              <text class="span">HELLO, I'M</text>
              <text class="strong">{{ result.type_code }}</text>
              <text class="b">{{ displayName }}</text>
              <view>
                <text v-for="t in meetTags" :key="t" class="tag">{{ t }}</text>
              </view>
              <text class="small">{{ declaration }}</text>
            </view>
            <view class="p">初次见面，亮一下我的 MBTI 名片。</view>
            <text class="preview-badge">不含联系方式</text>
          </view>

          <view class="style-pills">
            <button
              v-for="s in STUDIO_STYLES"
              :key="s.key"
              :class="{ active: studio.style === s.key }"
              @click="setStyle(s.key)"
            >
              {{ s.label }}
            </button>
          </view>

          <view class="pack-grid">
            <view v-for="p in PACKS" :key="p.no">
              <text class="span">{{ p.no }} / {{ p.cat }}</text>
              <text class="b">{{ p.title }}</text>
              <text class="small">{{ p.desc }}</text>
            </view>
          </view>

          <button class="btn full offer-link" @click="goCheckout('studio_tier_1')">
            <text>¥9.9 · 制作我的 MBTI 晒图套装</text>
            <AppIcon name="arrow" :size="18" color="#ffffff" />
          </button>
          <view class="fine centered">一次购买 · 无订阅 · 当前仅模拟支付</view>
        </view>

        <view class="discovery-card" style="display: block; min-height: 95px" @click="goDiscover">
          <text class="strong">先去看看我的同型搭子</text>
          <view class="p">基础名片交换免费，联系方式由双方决定。</view>
          <text class="span">⇄</text>
        </view>
      </template>
    </view>

    <view v-if="!loading && result" class="action-dock">
      <button class="btn full" @click="dockAction">{{ dockLabel }}</button>
      <text class="dock-hint">海报 + 头像 + 相处卡 + 配文</text>
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AppIcon from '@/components/AppIcon.vue'
import type { ResultSnapshot, ResultSnapshotSummary } from '@/api/types'
import { getResult, listResults } from '@/api/results'
import { TYPE_NAMES, DECLARATIONS } from '@/constants/types'
import { buildManual } from '@/constants/manual'
import { dateLabel, summaryText } from '@/constants/journey'
import {
  STUDIO_STYLES,
  studio,
  saveStudio,
  styleAsset,
  type StyleKey,
} from '@/store/studio'
import { account } from '@/store/account'

type SceneKey = 'moments' | 'avatar' | 'meet'

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const previous = ref<ResultSnapshot | null>(null)
const historyRows = ref<ResultSnapshotSummary[]>([])
const profileName = ref('')
const profileInterests = ref<string[]>([])
const loading = ref(true)

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(async () => {
  readProfile()
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
  if (result.value) await loadHistory()
})

/** 读取测试入口保存的昵称与兴趣，用于晒图预览 */
function readProfile() {
  try {
    const raw = uni.getStorageSync('mbti_test_profile_v1')
    if (raw && typeof raw === 'object') {
      profileName.value = typeof raw.name === 'string' ? raw.name : ''
      profileInterests.value = Array.isArray(raw.interests)
        ? raw.interests.filter((i: unknown): i is string => typeof i === 'string')
        : []
    }
  } catch {
    /* ignore */
  }
}

/** 轨迹摘要 + 查找同版本、时间更早的上一份测验记录 */
async function loadHistory() {
  const current = result.value
  if (!current) return
  try {
    const res = await listResults({ limit: 50 })
    historyRows.value = res.items
    if (current.source !== 'quiz') return
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

function demoState() {
  uni.showToast({ title: 'Mock 演示状态，不产生费用', icon: 'none' })
}

const savedTitle = computed(() =>
  previous.value && result.value
    ? summaryText(previous.value, result.value)
    : '第一份基线，已经留好。',
)

const savedMeta = computed(() =>
  result.value
    ? `${dateLabel(result.value.submitted_at)} · ${result.value.life_stage || '日常生活'} · 历史不会被本次测试覆盖`
    : '',
)

const historyTitle = computed(() =>
  historyRows.value.length ? '看看不同阶段的我' : '给现在的自己，留一个起点。',
)

const historyDesc = computed(() => {
  const rows = historyRows.value
  if (!rows.length) return '免费复测 · 私密记录 · 前后对比'
  const last = rows.find((r) => r.submitted_at)
  return `已留存 ${rows.length} 次结果${last ? ' · 最近 ' + dateLabel(last.submitted_at) : ''}`
})

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

const sourceLabel = computed(() =>
  result.value?.source === 'self_select' ? '你的自选人格类型' : '你的趣味测试结果',
)

const hasDimensions = computed(
  () => result.value?.source === 'quiz' && !!result.value?.dimension_counts,
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
    return {
      key,
      left,
      right,
      l,
      r,
      pct: `${Math.round((l / 3) * 100)}%`,
    }
  })
})

const manual = computed(() => buildManual(result.value?.type_code || 'INFP'))

const sceneTab = ref<SceneKey>('moments')

const SCENE_TABS: { key: SceneKey; label: string; lines: [string, string] }[] = [
  { key: 'moments', label: '发朋友圈', lines: ['把我的 MBTI，', '发成一条漂亮朋友圈。'] },
  { key: 'avatar', label: '换同款头像', lines: ['换个头像，', '让我的 MBTI 有点辨识度。'] },
  { key: 'meet', label: '见面亮名片', lines: ['认识新朋友，', '先亮出我的 MBTI 名片。'] },
]

const PACKS = [
  { no: '01', cat: '主角图', title: '朋友圈 MBTI 海报', desc: '3 种风格 · 3 种比例' },
  { no: '02', cat: '头像', title: '同款人格头像', desc: '1:1 PNG 独立保存' },
  { no: '03', cat: '相处卡', title: '我的相处小抄', desc: '充电 · 沟通 · 在意' },
  { no: '04', cat: '配文', title: '发圈文案准备好', desc: '改一句就能复制' },
]

const sceneLines = computed(
  () => SCENE_TABS.find((s) => s.key === sceneTab.value)?.lines || SCENE_TABS[0].lines,
)

const displayName = computed(
  () =>
    account.profile.nickname.trim() ||
    profileName.value.trim() ||
    studio.nickname ||
    '小禾',
)

const meetTags = computed(() =>
  profileInterests.value.length ? profileInterests.value.slice(0, 3) : ['摄影', '音乐'],
)

const assetUrl = computed(() => styleAsset(studio.style))

const dockLabel = computed(() =>
  studio.tier ? '制作我的 MBTI 形象' : '¥9.9 · 带走我的 MBTI 晒图套装',
)

function setStyle(key: StyleKey) {
  studio.style = key
  saveStudio()
}

function dockAction() {
  if (studio.tier) goCreate()
  else goCheckout('studio_tier_1')
}

function goCreate() {
  uni.navigateTo({ url: '/pages/create/create' })
}

function goCheckout(productCode: string) {
  const id = resultId.value
  const suffix = id ? `&result_id=${encodeURIComponent(id)}` : ''
  uni.navigateTo({ url: `/pages/pricing/pricing?channel=result${suffix}` })
}

function goHistory() {
  uni.switchTab({ url: '/pages/history/list' })
}

function goTestIntro() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}
</script>

<style scoped lang="scss">
.h2,
.h3 {
  font-weight: 700;
}

.state {
  padding-top: 220px;
  text-align: center;
}
.state-text {
  display: block;
  font-size: 13px;
  color: #77727e;
}

.line {
  display: block;
  border-top: 0;
}

.fine {
  display: block;
}

.page {
  padding-bottom: 18px;
}

.action-dock {
  display: block;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
}

.manual-cards > view {
  display: flex;
  align-items: flex-start;
  gap: 15px;
  padding: 20px 16px;
  background: #fff;
  border: 1px solid #e8e0ef;
  border-radius: 16px;
}
.manual-cards > view > text {
  font-size: 14px;
  color: #b49aca;
}

.pack-grid > view {
  border: 1px solid #e9e2f1;
  border-radius: 14px;
  padding: 14px 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.feed-photo > view {
  position: absolute;
  left: 15px;
  bottom: 18px;
  color: #fff;
  z-index: 1;
}

.mini-pass > view {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

</style>
