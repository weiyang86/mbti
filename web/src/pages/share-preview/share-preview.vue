<template>
  <view class="page share-page">
    <view v-if="loading" class="state"><text class="state-text">正在准备预览…</text></view>

    <view v-else-if="!result" class="state">
      <text class="state-text">找不到这份结果</text>
      <view class="btn-primary mt" @click="goHome">回首页测一次</view>
    </view>

    <view v-else-if="!studio.hasCard" class="state-empty">
      <text class="empty-mark">✦</text>
      <text class="empty-title">先制作你的晒图套装</text>
      <text class="empty-desc">成图准备好后，就能保存图片、头像和配文。</text>
      <view class="btn-primary mt" @click="goCreate">
        {{ studio.tier ? '制作我的 MBTI 形象' : '去看晒图套装' }}
      </view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · 趣味体验 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">体验说明 ↗</text>
      </view>

      <text class="kicker">READY TO SHARE / 晒出我的 MBTI</text>
      <text class="title">这条朋友圈，</text>
      <text class="title"><text class="hl">我想发自己的主角卡。</text></text>
      <text class="sub">先保存图片，再选择你想发布的平台。</text>

      <view class="platform-tabs">
        <view
          v-for="p in PLATFORMS"
          :key="p.key"
          class="platform-tab"
          :class="{ active: platform === p.key }"
          @click="switchPlatform(p.key)"
        >
          <text>{{ p.label }}</text>
        </view>
      </view>

      <view class="preview-card">
        <view class="preview-media" :class="format">
          <image class="preview-img" :src="assetUrl" mode="aspectFill" />
          <view class="preview-shade" />
          <view class="preview-overlay">
            <text class="preview-type">{{ result.type_code }}</text>
            <text class="preview-name">{{ typeName }} · {{ displayName }}</text>
          </view>
        </view>
        <view class="preview-meta">
          <text class="preview-title">{{ platformHint }}</text>
          <text class="preview-desc">图片与文字可分别保存，发布由你决定。</text>
        </view>
      </view>

      <view class="field">
        <text class="label">分享图比例</text>
        <view class="ratio-tabs">
          <view
            v-for="f in FORMATS"
            :key="f.key"
            class="ratio-tab"
            :class="{ active: format === f.key }"
            @click="switchFormat(f.key)"
          >
            <text>{{ f.label }}</text>
          </view>
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

      <view class="field">
        <text class="label">
          {{ platform === 'douyin' ? '口播脚本' : '分享配文' }}
          <text class="muted">仅本机编辑，未发布</text>
        </text>
        <textarea
          v-model="caption"
          class="input textarea"
          maxlength="500"
          placeholder="写一句想发的话"
        />
      </view>

      <view class="share-actions">
        <view class="btn-secondary" @click="copyCaption">复制配文</view>
        <template v-if="platform === 'xhs'">
          <view class="btn-ghost mt" @click="saveNote">保存本机笔记草稿</view>
          <text class="textbtn centered" @click="openDrafts">查看草稿</text>
        </template>
        <text v-if="platform === 'douyin'" class="textbtn centered" @click="goVideo">
          预览 15 秒分镜（模拟）
        </text>
      </view>

      <text class="textbtn centered" @click="nativeShare">预览平台分享卡片（模拟）</text>

      <view class="notice mt">
        本页不发布动态或私信。图片可下载、文案可复制；平台分享能力尚未接入。联系方式不会放入图片。
      </view>

      <view class="btn-primary mt" @click="previewImage">预览成图，保存图片</view>
      <text class="foot">趣味倾向体验 · 分享图不含原始答题与联系方式</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import type { ResultSnapshot } from '@/api/types'
import { getResult } from '@/api/results'
import { createSharePreview } from '@/api/share'
import { TYPE_NAMES } from '@/constants/types'
import { currentQuote, saveStudio, studio, styleAsset } from '@/store/studio'

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
  } catch {
    result.value = null
  } finally {
    loading.value = false
  }
}

const typeName = computed(() => TYPE_NAMES[result.value?.type_code || ''] || 'MBTI')

const displayName = computed(() => (profile.value.name || studio.nickname || '').trim() || '小禾')

const interests = computed(() => (profile.value.interests || []).slice(0, 3))

const platformHint = computed(() => PLATFORM_HINTS[platform.value])

const assetUrl = computed(() => styleAsset(studio.style))

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
  if (k === 'douyin') {
    return `四个字母说不完我。\n${t} · ${names}\n${quote}\n晒出我的 MBTI 主角卡。#MBTI搭子 #MBTI\n画面为 AI 示例人物。`
  }
  const likes = interests.value.length ? interests.value.join('、') : '探索生活里的新鲜事'
  return `同样是 ${t}，我也有自己的主角感。\n${quote}\n最近喜欢：${likes}。\n换了张 MBTI 名片，也换个方式认识我。\n#MBTI搭子 #MBTI #人格名片\n图片为 AI 示例，类型仅作趣味参考。`
}

function switchPlatform(key: PlatformKey) {
  platform.value = key
  format.value = key === 'douyin' ? 'story' : 'portrait'
  requestPreview()
}

function switchFormat(key: FormatKey) {
  format.value = key
}

async function requestPreview() {
  if (!resultId.value) return
  try {
    await createSharePreview({ result_id: resultId.value, scene: 'moments' })
  } catch {
    /* 预览任务失败时仍可本机查看成图 */
  }
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
  uni.previewImage({
    urls: [assetUrl.value],
    current: assetUrl.value,
    fail: () => uni.showToast({ title: '图片暂时无法生成，请重试', icon: 'none' }),
  })
}

function nativeShare() {
  uni.showModal({
    title: '平台分享卡片预览（模拟）',
    content: `${displayName.value} 的 ${result.value?.type_code || 'MBTI'} 人格名片\nMBTI搭子 · 先换名片，再认识彼此\n\n未调用平台 SDK，不会真实发送。联系方式不进入分享内容。`,
    showCancel: false,
    confirmText: '返回继续编辑',
  })
}

function goVideo() {
  uni.navigateTo({ url: '/pages/video/video' })
}

function goCreate() {
  uni.navigateTo({
    url: studio.tier ? '/pages/create/create' : '/pages/pricing/pricing',
  })
}

function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
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

function showDemo() {
  uni.showModal({
    title: '体验说明',
    content: '当前为 V0.4 趣味体验版：预览图由本地素材渲染，平台分享能力尚未接入。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.share-page {
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

.state-empty {
  padding: 180rpx 12rpx 40rpx;
  text-align: center;
}
.empty-mark {
  display: block;
  font-size: 52rpx;
  color: #b9a4da;
}
.empty-title {
  display: block;
  margin-top: 22rpx;
  font-size: 32rpx;
  font-weight: 700;
}
.empty-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 23rpx;
  color: #77727e;
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

.platform-tabs {
  display: flex;
  gap: 8rpx;
  margin-top: 36rpx;
  padding: 8rpx;
  border-radius: 999rpx;
  background: #f1ecfb;
}
.platform-tab {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
  border-radius: 999rpx;
  font-size: 24rpx;
  color: #77727e;
}
.platform-tab.active {
  background: #fff;
  color: #292630;
  font-weight: 700;
}

.preview-card {
  margin-top: 28rpx;
  border-radius: 32rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  padding: 24rpx;
}
.preview-media {
  position: relative;
  border-radius: 24rpx;
  overflow: hidden;
  transition: height 0.2s ease;
}
.preview-media.portrait {
  height: 760rpx;
}
.preview-media.square {
  height: 640rpx;
}
.preview-media.story {
  height: 900rpx;
}
.preview-img {
  width: 100%;
  height: 100%;
}
.preview-shade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 50%;
  background: linear-gradient(180deg, rgba(20, 12, 40, 0) 0%, rgba(20, 12, 40, 0.82) 100%);
}
.preview-overlay {
  position: absolute;
  left: 28rpx;
  right: 28rpx;
  bottom: 28rpx;
}
.preview-type {
  display: block;
  font-size: 72rpx;
  font-weight: 800;
  letter-spacing: 4rpx;
  line-height: 1;
  color: #fff;
}
.preview-name {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.86);
}
.preview-meta {
  padding: 22rpx 8rpx 6rpx;
}
.preview-title {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  color: #292630;
}
.preview-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #a398af;
}

.field {
  margin-top: 32rpx;
}
.label {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #292630;
}
.muted {
  font-size: 20rpx;
  color: #a398af;
  font-weight: 400;
}

.ratio-tabs {
  display: flex;
  gap: 14rpx;
  margin-top: 16rpx;
}
.ratio-tab {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
  border-radius: 999rpx;
  border: 2rpx solid #e9e5ed;
  background: #fff;
  font-size: 22rpx;
  color: #77727e;
}
.ratio-tab.active {
  border-color: #7560df;
  background: #f6f2ff;
  color: #7560df;
  font-weight: 600;
}

.input {
  margin-top: 14rpx;
  padding: 20rpx 24rpx;
  background: #fff;
  border: 2rpx solid #ece8f3;
  border-radius: 20rpx;
  font-size: 26rpx;
  color: #292630;
  box-sizing: border-box;
  width: 100%;
}
.textarea {
  min-height: 300rpx;
  line-height: 1.7;
}

.share-actions {
  margin-top: 28rpx;
}
.btn-ghost {
  background: #f5f2fa;
  color: #5c4f73;
  border: 2rpx solid #e8e1f2;
  border-radius: 999rpx;
  padding: 22rpx 40rpx;
  text-align: center;
  font-size: 28rpx;
}
.textbtn {
  display: block;
  font-size: 24rpx;
  color: #7560df;
  padding: 16rpx 0;
}
.textbtn.centered {
  text-align: center;
}

.notice {
  padding: 22rpx 26rpx;
  border-radius: 20rpx;
  background: #f5f3fa;
  border: 2rpx solid #e9e3f3;
  font-size: 22rpx;
  color: #7c728b;
  line-height: 1.7;
}

.mt {
  margin-top: 24rpx;
}

.foot {
  display: block;
  margin-top: 32rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}
</style>
