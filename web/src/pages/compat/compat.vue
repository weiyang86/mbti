<template>
  <view class="page social-page compat-page">
    <text class="heading">MBTI 相处小抄</text>
    <text class="notice">按两个人的类型给一点相处参考，不是配对分数，也不判断关系好坏。</text>

    <text v-if="loading" class="notice" role="status">正在读取你的类型…</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>

    <view v-if="!loading && !myType" class="card">
      <text class="section">还没有你的 MBTI 类型</text>
      <text class="line">相处小抄需要先知道你的类型。去「我的名片」选择并保存类型后，再回来就能生成建议。</text>
      <button class="btn-primary mt" @click="goCard">去我的名片设置类型</button>
    </view>

    <template v-else-if="myType">
      <view class="pair">
        <view class="pair-side">
          <text class="pair-label">你</text>
          <text class="pair-code">{{ myType }}</text>
          <text class="pair-desc">{{ myProfile }}</text>
        </view>
        <text class="pair-x">×</text>
        <view class="pair-side">
          <text class="pair-label">对方</text>
          <text class="pair-code">{{ otherType }}</text>
          <text class="pair-desc">{{ otherProfile }}</text>
        </view>
      </view>

      <text class="section">对方是什么类型？</text>
      <text v-if="!typeOptions.length" class="notice">类型列表暂不可用，当前按 {{ otherType }} 生成建议。</text>
      <view v-else class="type-grid">
        <button
          v-for="t in typeOptions"
          :key="t.type_code"
          :class="t.type_code === otherType ? 'btn-primary' : 'btn-secondary'"
          @click="otherType = t.type_code"
        >
          {{ t.type_code }}
        </button>
      </view>

      <text class="section">这次是什么场景？</text>
      <view class="row">
        <button
          v-for="s in scenes"
          :key="s"
          :class="s === scene ? 'btn-primary' : 'btn-secondary'"
          @click="scene = s"
        >
          {{ s }}
        </button>
      </view>
      <text class="scene-tip">{{ sceneTip }}</text>

      <text class="section">相处建议</text>
      <view v-for="n in notes" :key="n.title" class="note-card">
        <text class="note-title">{{ n.title }}</text>
        <text class="note-text">{{ n.text }}</text>
      </view>

      <text class="fine">
        趣味建议，无配对分数，相处方式可以随情境调整。你的类型来自本人名片，对方类型由你手动选择。
      </text>
    </template>

    <button class="btn-secondary mt" :disabled="loading" @click="load">重新读取我的类型</button>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import { listTypes } from '@/api/types-api'
import type { TypeMeta } from '@/api/types'
import {
  COMPAT_SCENES,
  COMPAT_SCENE_TIPS,
  DEFAULT_COMPARE_TYPE,
  compatNotes,
  compatProfile,
  type CompatScene,
} from '@/constants/compat'

const loading = ref(false)
const error = ref('')
const myType = ref('')
const otherType = ref(DEFAULT_COMPARE_TYPE)
const scene = ref<CompatScene>('初次见面')
const typeOptions = ref<TypeMeta[]>([])

const scenes = COMPAT_SCENES
const myProfile = computed(() => compatProfile(myType.value))
const otherProfile = computed(() => compatProfile(otherType.value))
const notes = computed(() => compatNotes(myType.value, otherType.value, scene.value))
const sceneTip = computed(() => COMPAT_SCENE_TIPS[scene.value])

onShow(() => {
  void load()
})

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const card = await getMyCard()
    myType.value = card.type_code || ''
  } catch {
    error.value = '读取你的类型失败，请稍后重试'
    myType.value = ''
  }
  try {
    const types = await listTypes()
    typeOptions.value = types.items
    if (!typeOptions.value.some((t) => t.type_code === otherType.value)) {
      otherType.value = typeOptions.value[0]?.type_code || DEFAULT_COMPARE_TYPE
    }
  } catch {
    typeOptions.value = []
  }
  loading.value = false
}

function goCard() {
  uni.navigateTo({ url: '/pages/card/card' })
}
</script>

<style scoped lang="scss">
@import '@/styles/social.scss';

.compat-page {
  padding-bottom: 48rpx;
}
.pair {
  display: flex;
  align-items: stretch;
  gap: 20rpx;
  margin-top: 28rpx;
}
.pair-side {
  flex: 1;
  min-width: 0;
  padding: 28rpx 24rpx;
  border-radius: 28rpx;
  background: #fff;
  border: 2rpx solid #ece7f1;
}
.pair-label {
  display: block;
  font-size: 22rpx;
  color: #a398af;
}
.pair-code {
  display: block;
  margin-top: 8rpx;
  font-size: 48rpx;
  font-weight: 800;
  color: #7560df;
  letter-spacing: 2rpx;
}
.pair-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: #77727e;
}
.pair-x {
  align-self: center;
  font-size: 32rpx;
  color: #c9c1d6;
}
.scene-tip {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: #77727e;
}
.note-card {
  margin-top: 20rpx;
  padding: 26rpx;
  border-radius: 24rpx;
  background: #f7f4fc;
  border: 2rpx solid #ece7f1;
}
.note-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.note-text {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.8;
  color: #5c5368;
}
.fine {
  display: block;
  margin-top: 28rpx;
  font-size: 20rpx;
  line-height: 1.7;
  color: #a398af;
}
</style>
