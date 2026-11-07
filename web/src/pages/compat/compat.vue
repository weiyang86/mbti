<template>
  <view class="page compat-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <text class="kicker">TYPE × TYPE / 相处小抄</text>
    <text class="title">合不合拍，</text>
    <text class="title"><text class="hl">先看偏好。</text></text>
    <text class="sub">按两人具体类型和场景生成，不同组合建议不同；不提供“天生绝配”或匹配概率。</text>

    <view v-if="!hasType" class="notice mt">
      <text>当前以 INFP 示例类型体验。</text>
      <text class="notice-link" @click="goSelfSelect">选择我的 MBTI →</text>
    </view>

    <view class="type-pair">
      <view class="pair-box">
        <text class="pair-type">{{ myType }}</text>
        <text class="pair-label">我的类型</text>
      </view>
      <text class="pair-times">×</text>
      <view class="pair-box" @click="pickerOpen = true">
        <text class="pair-type">{{ compareType }}</text>
        <text class="pair-label">点此换一种 ⌄</text>
      </view>
    </view>

    <view class="compat-profiles">
      <view class="profile-card">
        <text class="profile-title">{{ myType }} · 我的偏好</text>
        <text class="profile-text">{{ myProfile }}</text>
      </view>
      <view class="profile-card">
        <text class="profile-title">{{ compareType }} · 对方的偏好</text>
        <text class="profile-text">{{ compareProfile }}</text>
      </view>
    </view>

    <view class="choice-row">
      <view
        v-for="s in COMPAT_SCENES"
        :key="s"
        class="choice"
        :class="{ sel: scene === s }"
        @click="scene = s"
      >
        <text>{{ s }}</text>
      </view>
    </view>

    <view class="compat-intro">
      <text>{{ introText }}</text>
    </view>
    <text class="compat-tagline">{{ tagline }}</text>

    <view class="manual-cards">
      <view v-for="(n, i) in notes" :key="n.title" class="manual-card">
        <text class="manual-no">{{ String(i + 1).padStart(2, '0') }}</text>
        <view class="manual-body">
          <text class="manual-title">{{ n.title }}</text>
          <text class="manual-text">{{ n.text }}</text>
        </view>
      </view>
    </view>

    <view class="btn-secondary copy-btn" @click="copyNotes">复制这份相处小抄</view>
    <view class="btn-primary mt" @click="goDiscover">去交换一张名片 →</view>

    <view v-if="pickerOpen" class="modal-backdrop" @click="pickerOpen = false">
      <view class="modal-sheet" @click.stop>
        <view class="modal-head">
          <text class="modal-title">想了解哪种搭子？</text>
          <text class="modal-close" @click="pickerOpen = false">✕</text>
        </view>
        <view
          v-for="g in TYPE_GROUPS"
          :key="g.label"
          class="type-group"
        >
          <text class="group-label">{{ g.label }}</text>
          <view class="type-grid">
            <view
              v-for="t in g.types"
              :key="t"
              class="type-btn"
              :class="{ sel: t === compareType }"
              @click="selectType(t)"
            >
              <text class="type-code">{{ t }}</text>
              <text class="type-name">{{ TYPE_NAMES[t] }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import { TYPE_GROUPS, TYPE_NAMES } from '@/constants/types'
import {
  COMPAT_SCENES,
  COMPAT_SCENE_TIPS,
  DEFAULT_COMPARE_TYPE,
  compatNotes,
  compatProfile,
  type CompatScene,
} from '@/constants/compat'

const myType = ref('INFP')
const hasType = ref(false)
const compareType = ref(DEFAULT_COMPARE_TYPE)
const scene = ref<CompatScene>('初次见面')
const pickerOpen = ref(false)

const myProfile = computed(() => compatProfile(myType.value))
const compareProfile = computed(() => compatProfile(compareType.value))
const isSame = computed(() => myType.value === compareType.value)
const notes = computed(() => compatNotes(myType.value, compareType.value, scene.value))

const introText = computed(() =>
  isSame.value
    ? '同型之间也有差异：下面是按你们各自的四个字母给出的具体建议。'
    : `${myType.value} × ${compareType.value}：${COMPAT_SCENE_TIPS[scene.value]}`,
)

const tagline = computed(
  () => `${isSame.value ? '同型组合' : '跨型组合'} · ${scene.value} · 按具体维度生成`,
)

onLoad((q) => {
  const type = String(q?.type || '').toUpperCase()
  if (TYPE_NAMES[type]) compareType.value = type
})

onShow(async () => {
  try {
    const card = await getMyCard()
    hasType.value = Boolean(card.type_code)
    myType.value = card.type_code || 'INFP'
  } catch {
    hasType.value = false
    myType.value = 'INFP'
  }
})

function selectType(t: string) {
  compareType.value = t
  pickerOpen.value = false
}

function copyNotes() {
  const text = [introText.value, ...notes.value.map((n, i) => `${String(i + 1).padStart(2, '0')} ${n.title}\n${n.text}`)].join('\n')
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: '已复制', icon: 'none' }),
  })
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content:
      '当前为 V0.4 Mock 演示：相处小抄由前端按两人类型的四个字母生成，不提供匹配概率或“天生绝配”结论。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.compat-page {
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

.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
  font-weight: 600;
}
.title {
  display: block;
  margin-top: 12rpx;
  font-size: 56rpx;
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

.notice {
  display: block;
  background: #f5f3fa;
  border: 2rpx solid #e9e3f3;
  padding: 26rpx 30rpx;
  border-radius: 24rpx;
  color: #7c728b;
  font-size: 24rpx;
  line-height: 1.7;
}
.notice-link {
  color: #7560df;
  margin-left: 8rpx;
}
.mt {
  margin-top: 28rpx;
}

.type-pair {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin: 50rpx 0;
}
.pair-box {
  flex: 1;
  min-height: 180rpx;
  background: #eee7f7;
  border: 2rpx solid #dfd1ee;
  border-radius: 28rpx;
  text-align: center;
  padding: 34rpx 10rpx;
  box-sizing: border-box;
}
.pair-type {
  display: block;
  font-size: 56rpx;
  letter-spacing: 4rpx;
  font-weight: 700;
  color: #765492;
  line-height: 1.2;
}
.pair-label {
  display: block;
  margin-top: 12rpx;
  font-size: 20rpx;
  color: #a18bb0;
}
.pair-times {
  font-size: 44rpx;
  color: #b49cc5;
}

.compat-profiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
}
.profile-card {
  background: #fff;
  border: 2rpx solid #ece5f5;
  border-radius: 22rpx;
  padding: 24rpx;
  min-width: 0;
  box-sizing: border-box;
}
.profile-title {
  display: block;
  font-size: 24rpx;
  font-weight: 600;
  color: #6c4cf3;
}
.profile-text {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #8f8298;
  line-height: 1.7;
}

.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 28rpx;
}
.choice {
  padding: 18rpx 26rpx;
  min-height: 84rpx;
  box-sizing: border-box;
  border: 2rpx solid #ece7f1;
  border-radius: 22rpx;
  background: #fff;
  color: #746b80;
  font-size: 24rpx;
  display: flex;
  align-items: center;
}
.choice.sel {
  border-color: #8c79f5;
  background: #f1edff;
  color: #6c4cf3;
}

.compat-intro {
  margin-top: 36rpx;
  padding: 32rpx;
  background: #e9eddc;
  border-radius: 26rpx;
  font-size: 26rpx;
  color: #77865b;
  line-height: 1.7;
}
.compat-tagline {
  display: block;
  margin-top: 16rpx;
  font-size: 20rpx;
  color: #8f8199;
}

.manual-cards {
  display: grid;
  gap: 22rpx;
  margin: 42rpx 0;
}
.manual-card {
  display: flex;
  align-items: flex-start;
  gap: 28rpx;
  padding: 36rpx 30rpx;
  background: #fff;
  border: 2rpx solid #e8e0ef;
  border-radius: 28rpx;
}
.manual-no {
  font-size: 24rpx;
  color: #b49aca;
  line-height: 1.5;
}
.manual-body {
  flex: 1;
  min-width: 0;
}
.manual-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.manual-text {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.8;
  color: #4a4353;
}

.copy-btn {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx;
  font-size: 28rpx;
  font-weight: 600;
}
.btn-primary {
  font-weight: 600;
}

.modal-backdrop {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 100;
  background: rgba(43, 33, 51, 0.37);
  display: flex;
  align-items: flex-end;
}
.modal-sheet {
  width: 100%;
  max-height: 78vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 32rpx 32rpx 0 0;
  padding: 36rpx 32rpx 48rpx;
  box-sizing: border-box;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24rpx;
}
.modal-title {
  font-size: 32rpx;
  font-weight: 700;
}
.modal-close {
  font-size: 30rpx;
  color: #a398af;
  padding: 8rpx 12rpx;
}

.type-group {
  margin-bottom: 26rpx;
}
.group-label {
  display: block;
  font-size: 22rpx;
  letter-spacing: 2rpx;
  color: #888193;
  margin-bottom: 14rpx;
}
.type-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14rpx;
}
.type-btn {
  padding: 18rpx 6rpx;
  min-height: 94rpx;
  box-sizing: border-box;
  border: 2rpx solid #ece7f1;
  border-radius: 20rpx;
  background: #faf9fc;
  text-align: center;
}
.type-btn.sel {
  border-color: #7560df;
  background: #eee9ff;
}
.type-code {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  color: #66606f;
}
.type-btn.sel .type-code {
  color: #6c4cf3;
}
.type-name {
  display: block;
  margin-top: 6rpx;
  font-size: 18rpx;
  color: #888193;
}
</style>
