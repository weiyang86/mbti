<template>
  <view class="page">
    <proto-nav />
    <view v-if="loading && !latestType" class="notice">正在读取你的类型…</view>

    <template v-else-if="loadError">
      <view class="page-intro">
        <view class="eyebrow">MY MBTI LOOK / 形象工作台</view>
        <view class="h1">类型读取失败</view>
        <view class="p">请检查网络后重试。</view>
      </view>
      <view class="btn full" @click="load">重试</view>
    </template>

    <template v-else>
      <DemoStrip />

      <view class="page-intro">
        <view class="eyebrow">MY MBTI LOOK / 形象工作台</view>
        <view class="h1">这一次，晒我的这一面。</view>
        <view class="p">先选风格和宣言，再生成你的整套素材。</view>
      </view>

      <view class="edit-preview">
        <image class="edit-preview-img" :src="previewAsset" mode="aspectFill" />
        <view class="preview-copy">
          <text class="strong">{{ latestType }}</text>
          <view class="p">{{ quoteText }}</view>
        </view>
        <text class="small">AI 示例人物 · 文字按填写内容排版</text>
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
          <button
            v-for="s in STUDIO_STYLES"
            :key="s.key"
            class="style-choice"
            :class="{ sel: studio.style === s.key }"
            @click="pickStyle(s.key)"
          >
            <image class="thumb" :src="s.asset" mode="aspectFill" />
            <text class="span">{{ s.label }}</text>
          </button>
        </view>
      </view>

      <view class="field">
        <text class="label">选择我的人格宣言</text>
        <view class="declaration-options">
          <button
            v-for="(q, i) in quoteList"
            :key="i"
            class="declaration-option"
            :class="{ active: activeQuoteIndex === i }"
            @click="pickQuote(q)"
          >{{ q }}</button>
        </view>
      </view>

      <view v-if="studio.tier === 2" class="field">
        <text class="label">
          本人照片参考
          <text class="muted">选填 · 本机预览</text>
        </text>
        <view class="photo-compact" @click="pickPhoto">
          <image v-if="photoPath" class="photo-thumb" :src="photoPath" mode="aspectFill" />
          <view v-else class="photo-icon">
            <AppIcon name="upload" :size="20" color="#b69bd0" />
          </view>
          <view>
            <text class="b">{{ photoPath ? '已选择，点击更换' : '选择自己的照片' }}</text>
            <text class="p">JPG / PNG / WEBP · 最大 8MB</text>
          </view>
        </view>
        <template v-if="photoPath">
          <text class="textbtn mt" @click.stop="removePhoto">移除照片</text>
          <view class="tickline mt" @click="photoConsent = !photoConsent">
            <view class="tick" :class="{ on: photoConsent }">
              <text v-if="photoConsent">✓</text>
            </view>
            <text class="small">我有照片使用权，同意仅在本机预览。</text>
          </view>
        </template>
        <view class="fine mt">当前生成使用预置人物，不会处理或还原上传的人像。照片刷新即清除。</view>
      </view>

      <view class="notice">公开图只放昵称、类型、兴趣与所选宣言，不放 QQ、微信或电话。</view>

      <view class="btn full mt" @click="generate">{{ generateLabel }}</view>
      <text class="p fine centered mt">当前组合预置 AI 人物素材</text>
    </template>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '@/components/AppIcon.vue'
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
    const type = res.items[0]?.type_code || ''
    if (!type) {
      uni.redirectTo({ url: '/pages/self-select/self-select' })
      return
    }
    if (studio.tier === 0) {
      uni.redirectTo({ url: '/pages/pricing/pricing' })
      return
    }
    latestType.value = type
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

const quoteList = computed(() => quoteOptions(latestType.value))
const quoteText = computed(() => currentQuote(latestType.value))
const previewAsset = computed(() => styleAsset(studio.style))
const generateLabel = computed(() => (studio.hasCard ? '更新我的整套素材' : '生成我的 MBTI 晒图套装'))

const activeQuoteIndex = computed(() => {
  if (studio.customQuote.trim()) return -1
  if (!studio.quote.trim()) return 0
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

function demoInfo() {
  uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' })
}

</script>

<style scoped lang="scss">
.field .input {
  height: 54px;
}
.field .input :deep(.uni-input-input) {
  height: 26px;
}
.style-choice {
  width: 100%;
}
.style-choice::after {
  border: 0;
}
.declaration-option {
  width: 100%;
  display: block;
  text-align: left;
}
.declaration-option::after {
  border: 0;
}
.edit-preview-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.preview-copy {
  position: absolute;
  left: 19px;
  top: 28px;
  z-index: 1;
  color: #fff;
}
.style-choice .thumb {
  width: 100%;
  height: 114px;
  object-fit: cover;
  object-position: 50% 27%;
  display: block;
  border-radius: 9px;
}
.photo-thumb {
  height: 64px;
  width: 49px;
  object-fit: cover;
  border-radius: 9px;
  flex-shrink: 0;
}
.tick {
  width: 15px;
  height: 15px;
  margin-top: 4px;
  border: 1px solid #cfc4dd;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #fff;
  flex-shrink: 0;
}
.tick.on {
  background: var(--accent);
  border-color: var(--accent);
}
</style>
