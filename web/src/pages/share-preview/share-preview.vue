<template>
  <view>
    <proto-nav />
    <view class="page">
      <StateView v-if="loading" state="loading" title="正在准备预览…" />

      <template v-else-if="!result">
        <view class="page-intro">
          <view class="eyebrow">MBTI BUDDY</view>
          <view class="h1">找不到这份结果</view>
          <view class="p">先完成一次测试，再回来保存图片和配文。</view>
        </view>
        <button class="btn full" @click="goTestIntro">去测一次</button>
      </template>

      <template v-else>
        <DemoStrip />

        <view class="page-intro">
          <view class="eyebrow">READY TO SHARE / 晒出我的 MBTI</view>
          <view class="h1">这条朋友圈，<text class="line">我想发自己的主角卡。</text></view>
          <view class="p">先保存图片，再选择你想发布的平台。</view>
        </view>

        <view class="share-tabs">
          <button
            v-for="p in PLATFORMS"
            :key="p.key"
            :class="{ active: platform === p.key }"
            @click="switchPlatform(p.key)"
          >
            {{ p.label }}
          </button>
        </view>

        <view class="share-preview">
          <view v-if="previewUrl" class="preview-image-wrap">
            <image
              :src="previewUrl"
              mode="widthFix"
              @click="previewImage"
              @load="onImageLoad"
              @error="onImageError"
            />
            <text v-if="!imageLoaded" class="preview-loading">图片加载中…</text>
          </view>
          <view v-else class="preview-state">
            <text class="p">{{ previewStatus === 'loading' ? '正在生成分享图…' : previewError || '分享图暂不可用' }}</text>
            <button v-if="previewStatus === 'error'" class="btn secondary mt" @click="requestPreview">重新生成</button>
          </view>
          <view>
            <text class="b">{{ platformHint }}</text>
            <view class="p">图片与文字可分别保存，发布由你决定。</view>
          </view>
        </view>

        <view v-if="previewUrl" class="preview-url">
          <text class="small">成图地址</text>
          <text class="small break" @click="copyPreviewUrl">{{ previewUrl }}</text>
        </view>

        <view class="field mt">
          <text class="label">分享图比例</text>
          <view class="ratio-tabs">
            <button
              v-for="f in FORMATS"
              :key="f.key"
              :class="{ active: format === f.key }"
              @click="switchFormat(f.key)"
            >
              {{ f.label }}
            </button>
          </view>
        </view>

        <view v-if="platform === 'xhs'" class="field">
          <text class="label">笔记标题</text>
          <input
            v-model="noteTitle"
            class="input"
            maxlength="30"
            placeholder="同样是 INFP，我也有自己的主角感"
          />
        </view>

        <view class="field field-caption">
          <text class="label">
            {{ platform === 'douyin' ? '口播脚本' : '分享配文' }}
            <text class="muted">仅本机编辑，未发布</text>
          </text>
          <textarea
            v-model="caption"
            class="input caption"
            rows="6"
            maxlength="500"
            placeholder="写一句想发的话"
          />
        </view>

        <view class="share-actions">
          <button class="btn secondary" @click="copyCaption">复制配文</button>
          <template v-if="platform === 'xhs'">
            <button class="btn ghost" @click="saveNote">保存本机笔记草稿</button>
            <text class="textbtn" @click="openDrafts">查看草稿</text>
          </template>
          <button v-if="platform === 'douyin'" class="btn ghost" @click="goVideo">
            预览 15 秒分镜（模拟）
          </button>
          <text class="textbtn" @click="nativeShare">预览平台分享卡片（模拟）</text>
        </view>

        <view class="notice mt">
          本页不发布动态或私信。图片可下载、文案可复制；平台分享能力尚未接入。联系方式不会放入图片。
        </view>

        <view class="action-dock">
          <button class="btn full" :disabled="previewStatus !== 'ready'" @click="onDockAction">
            <AppIcon name="download" :size="20" color="#ffffff" />
            <text>{{ dockLabel }}</text>
          </button>
        </view>
      </template>
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AppIcon from '@/components/AppIcon.vue'
import type { ResultSnapshot } from '@/api/types'
import { getResult } from '@/api/results'
import { createSharePreview } from '@/api/share'
import { requestErrorMessage } from '@/api/client'
import { TYPE_NAMES } from '@/constants/types'
import { published } from '@/store/published'
import { currentQuote, saveStudio, studio } from '@/store/studio'

type PlatformKey = 'wechat' | 'xhs' | 'douyin' | 'mp'
type FormatKey = 'portrait' | 'square' | 'story'

interface NoteDraft {
  title: string
  text: string
  at: string
}

interface LocalProfile {
  name?: string
  interests?: string[]
}

const PLATFORMS: { key: PlatformKey; label: string }[] = [
  { key: 'wechat', label: '微信' },
  { key: 'xhs', label: '小红书' },
  { key: 'douyin', label: '抖音' },
  { key: 'mp', label: '公众号' },
]

const FORMATS: { key: FormatKey; label: string }[] = [
  { key: 'portrait', label: '3:4 · 主角图' },
  { key: 'square', label: '1:1 · 方图' },
  { key: 'story', label: '9:16 · 竖屏' },
]

const PLATFORM_HINTS: Record<PlatformKey, string> = {
  wechat: '朋友圈图片 / 好友卡片',
  xhs: '3:4 封面 / 笔记草稿',
  douyin: '9:16 竖屏 / 分镜脚本',
  mp: '网页摘要 / 名片图片',
}

const DRAFT_KEY = 'mbti_share_drafts_v1'
const STYLE_KEYS = ['illustration', 'editorial', 'game']

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const loading = ref(true)
const previewUrl = ref('')
const previewStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const previewError = ref('')
const imageLoaded = ref(false)
const platform = ref<PlatformKey>('wechat')
const format = ref<FormatKey>('portrait')
const captions = ref<Partial<Record<PlatformKey, string>>>({})
const noteTitle = ref('')
const drafts = ref<NoteDraft[]>(loadDrafts())
const profile = ref<LocalProfile>(readProfile())

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
  const initialStyle = (q?.style as string) || ''
  if (STYLE_KEYS.includes(initialStyle)) {
    studio.style = initialStyle as typeof studio.style
    saveStudio()
  }
})

onShow(() => {
  profile.value = readProfile()
})

onMounted(() => {
  loadResult()
})

async function loadResult() {
  if (!resultId.value) {
    loading.value = false
    return
  }
  try {
    result.value = await getResult(resultId.value)
    if (!noteTitle.value) {
      noteTitle.value = `同样是 ${result.value.type_code}，我也有自己的主角感`
    }
    await requestPreview()
  } catch {
    result.value = null
  } finally {
    loading.value = false
  }
}

function demoState() {
  uni.showToast({ title: 'Mock 演示状态，不产生费用', icon: 'none' })
}

const typeName = computed(() => TYPE_NAMES[result.value?.type_code || ''] || 'MBTI')

const displayName = computed(() => (profile.value.name || studio.nickname || '').trim() || '小禾')

const interests = computed(() => (profile.value.interests || []).slice(0, 3))

const platformHint = computed(() => PLATFORM_HINTS[platform.value])

const caption = computed({
  get: () => captions.value[platform.value] ?? defaultCaption(platform.value),
  set: (value: string) => {
    captions.value[platform.value] = value
  },
})

function defaultCaption(k: PlatformKey) {
  const t = result.value?.type_code || 'INFP'
  const names = TYPE_NAMES[t] || 'MBTI'
  const quote = currentQuote(t)
  const lead = published.content?.caption || `同样是 ${t}，我也有自己的主角感。`
  if (k === 'douyin') {
    return `四个字母说不完我。\n${t} · ${names}\n${quote}\n晒出我的 MBTI 主角卡。#MBTI搭子 #MBTI\n画面为 AI 示例人物。`
  }
  const likes = interests.value.length ? interests.value.join('、') : '探索生活里的新鲜事'
  return `${lead}\n${quote}\n最近喜欢：${likes}。\n换了张 MBTI 名片，也换个方式认识我。\n#MBTI搭子 #MBTI #人格名片\n图片为 AI 示例，类型仅作趣味参考。`
}

function switchPlatform(key: PlatformKey) {
  platform.value = key
  format.value = key === 'douyin' ? 'story' : 'portrait'
}

function switchFormat(key: FormatKey) {
  format.value = key
}

const dockLabel = computed(() => {
  if (previewStatus.value === 'ready') return '预览成图，保存图片'
  if (previewStatus.value === 'error') return '重新生成分享图'
  return '正在生成分享图…'
})

function onDockAction() {
  if (previewStatus.value === 'error') {
    requestPreview()
    return
  }
  previewImage()
}

/** F2：同步读取 POST /share/preview 的 ready 结果，用返回的绝对地址加载图片 */
async function requestPreview() {
  if (!resultId.value) return
  previewStatus.value = 'loading'
  previewError.value = ''
  imageLoaded.value = false
  try {
    const preview = await createSharePreview({ result_id: resultId.value, scene: 'moments' })
    previewUrl.value = preview.preview_url
  } catch (e) {
    previewUrl.value = ''
    previewStatus.value = 'error'
    previewError.value = requestErrorMessage(e, '分享图生成失败，请重试')
  }
}

function onImageLoad() {
  imageLoaded.value = true
  previewStatus.value = 'ready'
}

function onImageError() {
  previewUrl.value = ''
  previewStatus.value = 'error'
  previewError.value = '分享图加载失败，请重试'
}

function copyPreviewUrl() {
  uni.setClipboardData({
    data: previewUrl.value,
    success: () => uni.showToast({ title: '已复制成图地址', icon: 'none' }),
  })
}

function copyCaption() {
  uni.setClipboardData({
    data: caption.value,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
    fail: () => uni.showToast({ title: '复制失败，请手动选择文本', icon: 'none' }),
  })
}

function saveNote() {
  const title = noteTitle.value.trim() || `同样是 ${result.value?.type_code || 'INFP'}，我也有自己的主角感`
  drafts.value = [...drafts.value, { title, text: caption.value, at: new Date().toISOString() }].slice(-10)
  persistDrafts()
  uni.showToast({ title: '草稿已保存到本机，未发布', icon: 'none' })
}

function openDrafts() {
  const list = drafts.value.slice(-6).reverse()
  if (!list.length) {
    uni.showToast({ title: '还没有本机草稿', icon: 'none' })
    return
  }
  uni.showActionSheet({
    itemList: list.map((d) => d.title.slice(0, 20)),
    success: ({ tapIndex }) => {
      const draft = list[tapIndex]
      if (!draft) return
      platform.value = 'xhs'
      format.value = 'portrait'
      noteTitle.value = draft.title
      captions.value = { ...captions.value, xhs: draft.text }
      uni.showToast({ title: '已载入草稿', icon: 'none' })
    },
  })
}

function previewImage() {
  if (!previewUrl.value) return
  uni.previewImage({
    urls: [previewUrl.value],
    current: previewUrl.value,
    fail: () => uni.showToast({ title: '图片暂时无法预览，请重试', icon: 'none' }),
  })
}

function nativeShare() {
  uni.showModal({
    title: '平台分享卡片预览',
    content: `${displayName.value} 的 ${result.value?.type_code || 'MBTI'} 人格名片\nMBTI搭子 · 先换名片，再认识彼此\n\n未调用平台 SDK，不会真实发送。联系方式不进入分享内容。`,
    showCancel: false,
    confirmText: '返回继续编辑',
  })
}

function goVideo() {
  uni.navigateTo({ url: '/pages/video/video' })
}

function goTestIntro() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}

function readProfile(): LocalProfile {
  try {
    const raw = uni.getStorageSync('mbti_test_profile_v1')
    if (raw && typeof raw === 'object') {
      return {
        name: typeof raw.name === 'string' ? raw.name : undefined,
        interests: Array.isArray(raw.interests) ? raw.interests : undefined,
      }
    }
  } catch {
    /* ignore */
  }
  return {}
}

function loadDrafts(): NoteDraft[] {
  try {
    const raw = uni.getStorageSync(DRAFT_KEY)
    if (Array.isArray(raw)) {
      return raw.filter(
        (item): item is NoteDraft =>
          Boolean(item) && typeof item.title === 'string' && typeof item.text === 'string',
      )
    }
  } catch {
    /* ignore */
  }
  return []
}

function persistDrafts() {
  try {
    uni.setStorageSync(DRAFT_KEY, drafts.value)
  } catch {
    /* ignore */
  }
}
</script>

<style scoped lang="scss">
.line {
  display: block;
  border-top: 0;
}

.caption {
  height: 167px;
  font-size: 14px;
  line-height: 1.65;
}

.field-caption {
  padding-bottom: 6px;
}

.page {
  padding-bottom: 18px;
}

.share-actions > .btn,
.share-actions > .textbtn {
  width: 100%;
}

.share-actions > .textbtn {
  text-align: center;
}

.ratio-tabs uni-button {
  padding-top: 12px;
  padding-bottom: 8px;
}

.action-dock {
  display: block;
  position: fixed;
}

.preview-image-wrap {
  position: relative;
}

.preview-loading {
  display: block;
  margin-top: 6px;
  font-size: 10px;
  color: #9b8bad;
}

.preview-state {
  padding: 24px 0;
  text-align: center;
}

.preview-url {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
}

.preview-url .break {
  word-break: break-all;
}
</style>
