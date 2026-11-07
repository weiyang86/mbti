<template>
  <view class="page share-page">
    <view v-if="loading" class="state"><text class="state-text">正在准备预览…</text></view>

    <view v-else-if="!result" class="state">
      <text class="state-text">找不到这份结果</text>
      <view class="btn-primary mt" @click="goHome">回首页测一次</view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>

      <text class="kicker">MY MBTI SHARE / 晒图预览</text>
      <text class="title">这一面，<text class="hl">发出去。</text></text>
      <text class="sub">先看效果，再决定晒哪一张；预览不包含任何原始答题。</text>

      <view class="styles">
        <view
          v-for="s in STYLES"
          :key="s.key"
          class="style-pill"
          :class="{ active: style === s.key }"
          @click="style = s.key"
        >
          <text>{{ s.label }}</text>
        </view>
      </view>

      <view class="scene-tabs">
        <view
          v-for="s in SCENES"
          :key="s.key"
          class="scene-tab"
          :class="{ active: scene === s.key }"
          @click="switchScene(s.key)"
        >
          <text>{{ s.label }}</text>
        </view>
      </view>

      <!-- 发朋友圈 -->
      <view v-if="scene === 'moments'" class="preview moments">
        <view class="feed-head">
          <image class="feed-avatar" :src="assetUrl" mode="aspectFill" />
          <view>
            <text class="feed-name">{{ nickname }}</text>
            <text class="feed-sub">朋友圈效果预览 · 未发布</text>
          </view>
        </view>
        <text class="feed-caption">同样是 {{ result.type_code }}，我也有自己的主角感。✦</text>
        <view class="feed-photo">
          <image class="feed-img" :src="assetUrl" mode="aspectFill" />
          <view class="feed-overlay">
            <text class="photo-type">{{ result.type_code }}</text>
            <text class="photo-name">{{ meta?.name_zh || typeName }} / 匿名搭子</text>
          </view>
        </view>
        <text class="badge">AI 示例人物 · 本地渲染预览</text>
      </view>

      <!-- 换同款头像 -->
      <view v-else-if="scene === 'avatar'" class="preview avatar">
        <view class="avatar-frame">
          <image class="avatar-img" :src="assetUrl" mode="aspectFill" />
          <view class="avatar-type"><text>{{ result.type_code }}</text></view>
        </view>
        <text class="avatar-title">头像也要有我的 MBTI 气质。</text>
        <text class="avatar-desc">同款 1:1 头像，可单独下载。</text>
        <text class="badge">AI 虚构人物样例 · 非真实人像</text>
      </view>

      <!-- 见面亮名片 -->
      <view v-else class="preview meet">
        <view class="pass">
          <text class="pass-kicker">HELLO, I'M</text>
          <text class="pass-type">{{ result.type_code }}</text>
          <text class="pass-name">{{ typeName }} · {{ nickname }}</text>
          <view class="pass-tags" v-if="interests.length">
            <text class="pass-tag" v-for="i in interests" :key="i">{{ i }}</text>
          </view>
          <text class="pass-line">{{ declaration }}</text>
        </view>
        <text class="meet-desc">初次见面，亮一下我的 MBTI 名片。</text>
        <text class="badge">不含联系方式 · 仅类型与名称</text>
      </view>

      <text class="server-line">服务端预览任务：{{ previewStatus }}</text>

      <view class="actions">
        <view class="btn-secondary" @click="backResult">返回结果</view>
        <view v-if="studio.hasCard" class="btn-secondary mt" @click="goVideo">预览 15 秒分镜（模拟）</view>
      </view>

      <text class="foot">趣味倾向体验 · 分享图不含原始答题与联系方式</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { ResultSnapshot, TypeMeta } from '@/api/types'
import { getResult } from '@/api/results'
import { createSharePreview } from '@/api/share'
import { listTypes } from '@/api/types-api'
import { TYPE_NAMES, DECLARATIONS } from '@/constants/types'
import { studio } from '@/store/studio'

interface LocalProfile {
  name?: string
  interests?: string[]
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

const STYLES = [
  { key: 'illustration', label: '梦境插画' },
  { key: 'editorial', label: '日常杂志' },
  { key: 'game', label: '未来角色' },
]

const SCENES: { key: 'moments' | 'avatar' | 'meet_card'; label: string }[] = [
  { key: 'moments', label: '发朋友圈' },
  { key: 'avatar', label: '换同款头像' },
  { key: 'meet_card', label: '见面亮名片' },
]

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const meta = ref<TypeMeta | null>(null)
const loading = ref(true)
const scene = ref<'moments' | 'avatar' | 'meet_card'>('moments')
const style = ref('illustration')
const previewStatus = ref('本地预览')
const profile = ref<LocalProfile>(readProfile())

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
  const initialStyle = (q?.style as string) || ''
  if (['illustration', 'editorial', 'game'].includes(initialStyle)) {
    style.value = initialStyle
  }
  profile.value = readProfile()
})

onMounted(async () => {
  if (!resultId.value) {
    loading.value = false
    return
  }
  try {
    const [snapshot, types] = await Promise.all([
      getResult(resultId.value),
      listTypes().catch(() => null),
    ])
    result.value = snapshot
    meta.value =
      types?.items.find((t) => t.type_code === snapshot.type_code) || null
  } catch {
    result.value = null
    meta.value = null
  } finally {
    loading.value = false
  }
  requestPreview()
})

const typeName = computed(() => TYPE_NAMES[result.value?.type_code || ''] || 'MBTI')

const declaration = computed(
  () => DECLARATIONS[result.value?.type_code || ''] || '四个字母之外，还有不一样的你。',
)

const nickname = computed(() => (profile.value.name || '').trim() || '小禾')

const interests = computed(() => (profile.value.interests || []).slice(0, 3))

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：预览图由本地素材渲染，不产生真实费用，也未连接真实后端。',
    showCancel: false,
    confirmText: '知道了',
  })
}

const assetUrl = computed(() => `/static/share-style-${style.value}.webp`)

watch(scene, () => {
  requestPreview()
})

async function requestPreview() {
  if (!resultId.value) return
  try {
    const res = await createSharePreview({
      result_id: resultId.value,
      scene: scene.value,
    })
    previewStatus.value = res.status || (res.preview_url ? 'ready' : 'pending')
  } catch {
    previewStatus.value = '本地渲染'
  }
}

function switchScene(key: 'moments' | 'avatar' | 'meet_card') {
  scene.value = key
}

function backResult() {
  uni.navigateBack()
}

function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}

function goVideo() {
  uni.navigateTo({ url: '/pages/video/video' })
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

.styles {
  display: flex;
  gap: 16rpx;
  margin-top: 36rpx;
}
.style-pill {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 999rpx;
  border: 2rpx solid #e9e5ed;
  background: #fff;
  font-size: 24rpx;
  color: #77727e;
}
.style-pill.active {
  border-color: #7560df;
  background: #f6f2ff;
  color: #7560df;
  font-weight: 600;
}

.scene-tabs {
  display: flex;
  gap: 8rpx;
  margin-top: 20rpx;
  padding: 8rpx;
  border-radius: 999rpx;
  background: #f1ecfb;
}
.scene-tab {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
  border-radius: 999rpx;
  font-size: 24rpx;
  color: #77727e;
}
.scene-tab.active {
  background: #fff;
  color: #292630;
  font-weight: 700;
}

.preview {
  margin-top: 32rpx;
  border-radius: 32rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  padding: 28rpx;
}

/* 朋友圈 */
.feed-head {
  display: flex;
  align-items: center;
}
.feed-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 12rpx;
  margin-right: 16rpx;
}
.feed-name {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
}
.feed-sub {
  display: block;
  margin-top: 4rpx;
  font-size: 20rpx;
  color: #a398af;
}
.feed-caption {
  display: block;
  margin-top: 20rpx;
  font-size: 24rpx;
  color: #292630;
}
.feed-photo {
  position: relative;
  margin-top: 20rpx;
  height: 560rpx;
  border-radius: 20rpx;
  overflow: hidden;
}
.feed-img {
  width: 100%;
  height: 100%;
}
.feed-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 40rpx 28rpx 28rpx;
  background: linear-gradient(180deg, rgba(20, 12, 40, 0) 0%, rgba(20, 12, 40, 0.8) 100%);
}
.photo-type {
  display: block;
  font-size: 64rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 3rpx;
  line-height: 1;
}
.photo-name {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.86);
}

/* 头像 */
.avatar {
  text-align: center;
}
.avatar-frame {
  position: relative;
  width: 420rpx;
  height: 420rpx;
  margin: 0 auto;
  border-radius: 28rpx;
  overflow: hidden;
}
.avatar-img {
  width: 100%;
  height: 100%;
}
.avatar-type {
  position: absolute;
  right: 16rpx;
  bottom: 16rpx;
  background: rgba(223, 255, 139, 0.92);
  color: #4a3a86;
  font-size: 22rpx;
  font-weight: 700;
  border-radius: 999rpx;
  padding: 8rpx 18rpx;
}
.avatar-title {
  display: block;
  margin-top: 28rpx;
  font-size: 32rpx;
  font-weight: 700;
}
.avatar-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #77727e;
}

/* 名片 */
.pass {
  border-radius: 24rpx;
  padding: 40rpx 32rpx;
  background: linear-gradient(150deg, #2f2748, #4a3a86 60%, #6c53f5);
  color: #fff;
}
.pass-kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: rgba(255, 255, 255, 0.7);
}
.pass-type {
  display: block;
  margin-top: 16rpx;
  font-size: 88rpx;
  font-weight: 800;
  letter-spacing: 4rpx;
  line-height: 1;
  color: #dfff8b;
}
.pass-name {
  display: block;
  margin-top: 16rpx;
  font-size: 28rpx;
}
.pass-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 16rpx;
}
.pass-tag {
  font-size: 20rpx;
  color: #dfff8b;
  border: 2rpx solid rgba(223, 255, 139, 0.4);
  border-radius: 999rpx;
  padding: 4rpx 14rpx;
}
.pass-line {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.6;
}
.meet-desc {
  display: block;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: #77727e;
  text-align: center;
}

.badge {
  display: block;
  margin-top: 20rpx;
  font-size: 20rpx;
  color: #a398af;
  text-align: center;
}

.server-line {
  display: block;
  margin-top: 28rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}

.actions {
  margin-top: 40rpx;
}
.mt {
  margin-top: 32rpx;
}

.foot {
  display: block;
  margin-top: 36rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}
</style>
