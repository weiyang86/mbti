<template>
  <view class="page create-page">
    <view v-if="loading" class="state"><text class="state-text">正在读取你的类型…</text></view>

    <view v-else-if="loadError" class="state-empty">
      <text class="empty-mark">!</text>
      <text class="empty-title">类型读取失败</text>
      <text class="empty-desc">请检查网络后重试。</text>
      <view class="btn-secondary mt" @click="load">重试</view>
    </view>

    <view v-else-if="!latestType" class="state-empty">
      <text class="empty-mark">◇</text>
      <text class="empty-title">先有一个 MBTI 类型</text>
      <text class="empty-desc">完成一次 12 题趣味测试，或直接使用已知类型。</text>
      <view class="btn-primary mt" @click="goTest">免费测一测</view>
      <view class="btn-secondary mt" @click="goSelfSelect">已有类型，直接选</view>
    </view>

    <view v-else-if="studio.tier === 0" class="state-empty">
      <text class="empty-mark">✦</text>
      <text class="empty-title">先选一份想晒的自己</text>
      <text class="empty-desc">形象工作台需要先解锁晒图套装；当前为模拟支付，不产生扣款。</text>
      <view class="btn-primary mt" @click="goPricing">去看晒图套装</view>
    </view>

    <view v-else>
      <text class="kicker">MY MBTI LOOK / 形象工作台</text>
      <text class="title">这一次，<text class="hl">晒我的这一面。</text></text>
      <text class="sub">先选风格和宣言，再生成你的整套素材。</text>

      <view class="edit-preview">
        <image class="preview-img" :src="previewAsset" mode="aspectFill" />
        <view class="preview-info">
          <text class="preview-type">{{ latestType }}</text>
          <text class="preview-quote">{{ quoteText }}</text>
        </view>
        <text class="preview-small">AI 示例人物 · 文字按填写内容排版</text>
      </view>

      <view class="field">
        <text class="label">名片昵称</text>
        <input
          v-model="studio.nickname"
          class="input"
          maxlength="12"
          placeholder="例如：小禾"
          @blur="persist"
        />
      </view>

      <view class="field">
        <text class="label">我的风格</text>
        <view class="style-grid">
          <view
            v-for="s in STUDIO_STYLES"
            :key="s.key"
            class="style-choice"
            :class="{ sel: studio.style === s.key }"
            @click="pickStyle(s.key)"
          >
            <image class="style-thumb" :src="s.asset" mode="aspectFill" />
            <text class="style-label">{{ s.label }}</text>
          </view>
        </view>
      </view>

      <view class="field">
        <text class="label">选择我的人格宣言</text>
        <view class="declaration-options">
          <view
            v-for="(q, i) in quoteList"
            :key="i"
            class="declaration"
            :class="{ active: activeQuoteIndex === i }"
            @click="pickQuote(q)"
          >
            <text>{{ q }}</text>
          </view>
        </view>

        <view class="custom-quote">
          <text class="custom-label">
            自定义格言
            <text class="custom-tip">最多 24 字 · 会出现在名片和海报</text>
          </text>
          <textarea
            v-model="studio.customQuote"
            class="input textarea"
            maxlength="24"
            placeholder="写一句更像你的话"
            @blur="persist"
          />
          <view class="quote-hint">
            <text class="quote-count">{{ studio.customQuote.length }}/24</text>
            <text v-if="studio.customQuote" class="clear-quote" @click="clearCustom">清空自定义</text>
          </view>
        </view>
      </view>

      <view v-if="studio.tier === 2" class="field">
        <text class="label">
          本人照片参考
          <text class="custom-tip">选填 · 本机预览</text>
        </text>
        <view class="photo-compact" @click="pickPhoto">
          <image v-if="photoPath" class="photo-thumb" :src="photoPath" mode="aspectFill" />
          <view v-else class="photo-icon"><text>↥</text></view>
          <view class="photo-body">
            <text class="photo-title">{{ photoPath ? '已选择，点击更换' : '选择自己的照片' }}</text>
            <text class="photo-desc">JPG / PNG / WEBP · 最大 8MB</text>
          </view>
        </view>
        <template v-if="photoPath">
          <text class="remove-photo" @click.stop="removePhoto">移除照片</text>
          <view class="tickline" @click="photoConsent = !photoConsent">
            <view class="tick" :class="{ on: photoConsent }"><text v-if="photoConsent">✓</text></view>
            <text class="tick-text">我有照片使用权，同意仅在本机预览。</text>
          </view>
        </template>
        <text class="fine">当前生成使用预置人物，不会处理或还原上传的人像。照片刷新即清除。</text>
      </view>

      <view class="notice">公开图只放昵称、类型、兴趣与所选宣言，不放 QQ、微信或电话。</view>

      <view class="btn-primary mt" @click="generate">生成我的 MBTI 晒图套装</view>
      <text class="fine centered">生成后可继续更换风格与宣言，当前组合使用预置 AI 人物素材。</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listResults } from '@/api/results'
import type { StyleKey } from '@/store/studio'
import {
  STUDIO_STYLES,
  currentQuote,
  quoteOptions,
  saveStudio,
  studio,
  styleAsset,
} from '@/store/studio'

const loading = ref(true)
const loadError = ref(false)
const latestType = ref('')
const photoPath = ref('')
const photoConsent = ref(false)

onShow(load)

async function load() {
  loading.value = !latestType.value
  loadError.value = false
  try {
    const res = await listResults({ limit: 1 })
    latestType.value = res.items[0]?.type_code || ''
  } catch {
    latestType.value = ''
    loadError.value = true
  } finally {
    loading.value = false
  }
}

const quoteList = computed(() => quoteOptions(latestType.value))
const quoteText = computed(() => currentQuote(latestType.value))
const previewAsset = computed(() => styleAsset(studio.style))

const activeQuoteIndex = computed(() => {
  if (studio.customQuote.trim()) return -1
  return quoteList.value.indexOf(studio.quote)
})

function persist() {
  if (studio.nickname.trim().length > 12) {
    studio.nickname = studio.nickname.trim().slice(0, 12)
  }
  saveStudio()
}

function pickStyle(key: StyleKey) {
  studio.style = key
  saveStudio()
}

function pickQuote(q: string) {
  studio.quote = q
  studio.customQuote = ''
  saveStudio()
}

function clearCustom() {
  studio.customQuote = ''
  saveStudio()
}

function pickPhoto() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: (res) => {
      const path = res.tempFilePaths[0]
      if (path) photoPath.value = path
    },
  })
}

function removePhoto() {
  photoPath.value = ''
  photoConsent.value = false
}

function generate() {
  if (photoPath.value && !photoConsent.value) {
    uni.showToast({ title: '请先确认照片本机预览授权', icon: 'none' })
    return
  }
  saveStudio()
  uni.navigateTo({ url: '/pages/generating/generating' })
}

function goTest() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function goPricing() {
  uni.navigateTo({ url: '/pages/pricing/pricing' })
}

</script>

<style scoped lang="scss">
.create-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.state {
  padding-top: 200rpx;
  text-align: center;
}
.state-text {
  font-size: 26rpx;
  color: #77727e;
}
.state-empty {
  padding: 120rpx 12rpx 40rpx;
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
  line-height: 1.7;
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
  margin-top: 14rpx;
  font-size: 54rpx;
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

.edit-preview {
  position: relative;
  margin-top: 32rpx;
  height: 460rpx;
  border-radius: 30rpx;
  overflow: hidden;
  background: #ddd0ed;
}
.preview-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;

  :deep(div) {
    background-position: 50% 5% !important;
  }
}
.preview-info {
  position: absolute;
  left: 30rpx;
  right: 30rpx;
  bottom: 58rpx;
  padding: 22rpx 26rpx;
  border-radius: 20rpx;
  background: rgba(26, 20, 40, 0.42);
}
.preview-type {
  display: block;
  font-size: 46rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 2rpx;
}
.preview-quote {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.86);
}
.preview-small {
  position: absolute;
  left: 30rpx;
  bottom: 20rpx;
  font-size: 16rpx;
  color: rgba(255, 255, 255, 0.62);
}

.field {
  margin-top: 38rpx;
}
.label {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
  margin-bottom: 14rpx;
}
.input {
  height: 88rpx;
  padding: 0 24rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 18rpx;
  font-size: 26rpx;
  box-sizing: border-box;
}
.textarea {
  height: 140rpx;
  padding: 18rpx 24rpx;
  margin-top: 12rpx;
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14rpx;
}
.style-choice {
  border: 2rpx solid #e9e5ed;
  border-radius: 18rpx;
  overflow: hidden;
  background: #fff;
}
.style-choice.sel {
  border-color: #7560df;
  box-shadow: 0 0 0 2rpx rgba(117, 96, 223, 0.15);
}
.style-thumb {
  width: 100%;
  height: 150rpx;
  display: block;
}
.style-label {
  display: block;
  text-align: center;
  font-size: 20rpx;
  color: #77727e;
  padding: 12rpx 0;
}
.style-choice.sel .style-label {
  color: #7560df;
  font-weight: 700;
}

.declaration-options {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.declaration {
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 18rpx;
  padding: 22rpx 24rpx;
  font-size: 24rpx;
  color: #4b4268;
  line-height: 1.6;
}
.declaration.active {
  border-color: #7560df;
  background: #f7f3ff;
  color: #5b47a8;
}

.custom-quote {
  margin-top: 16rpx;
  border: 2rpx dashed #ddd0ee;
  background: #fbf8ff;
  border-radius: 20rpx;
  padding: 22rpx;
}
.custom-label {
  display: block;
  font-size: 23rpx;
  font-weight: 700;
}
.custom-tip {
  font-size: 19rpx;
  font-weight: 400;
  color: #a398af;
}
.custom-quote .input {
  background: #fff;
}
.quote-hint {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10rpx;
}
.quote-count {
  font-size: 19rpx;
  color: #a398af;
}
.clear-quote {
  font-size: 21rpx;
  color: #7560df;
}

.photo-compact {
  display: flex;
  align-items: center;
  gap: 20rpx;
  background: #fff;
  border: 2rpx dashed #d9cfe8;
  border-radius: 20rpx;
  padding: 20rpx;
}
.photo-thumb {
  width: 108rpx;
  height: 108rpx;
  border-radius: 16rpx;
  flex-shrink: 0;
}
.photo-icon {
  width: 108rpx;
  height: 108rpx;
  border-radius: 16rpx;
  background: #f1ecfa;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  color: #8b78b3;
  flex-shrink: 0;
}
.photo-body {
  flex: 1;
}
.photo-title {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
}
.photo-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #a398af;
}
.remove-photo {
  display: inline-block;
  margin-top: 14rpx;
  font-size: 21rpx;
  color: #b42318;
}
.tickline {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 16rpx;
}
.tick {
  width: 34rpx;
  height: 34rpx;
  border-radius: 8rpx;
  border: 2rpx solid #cfc4dd;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  color: #fff;
  flex-shrink: 0;
}
.tick.on {
  background: #7560df;
  border-color: #7560df;
}
.tick-text {
  font-size: 21rpx;
  color: #77727e;
}

.notice {
  margin-top: 32rpx;
  padding: 22rpx 24rpx;
  border-radius: 18rpx;
  background: #f3f0f8;
  font-size: 21rpx;
  color: #77727e;
  line-height: 1.7;
}

.fine {
  display: block;
  margin-top: 14rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}
.fine.centered {
  text-align: center;
}
.mt {
  margin-top: 24rpx;
}
.btn-primary {
  font-weight: 700;
}
</style>
