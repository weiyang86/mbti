<template>
  <view class="page social-page compat-page">
    <text class="kicker">TYPE × TYPE / 相处小抄</text>
    <text class="page-title">合不合拍，<text class="hl">从了解偏好开始。</text></text>
    <text class="page-sub">按类型标签生成的趣味建议，不提供“天生绝配”或匹配概率。</text>

    <text v-if="loading" class="notice" role="status">正在读取你的类型…</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>

    <view v-if="!loading && !myType" class="panel">
      <text class="panel-title">还没有你的 MBTI 类型</text>
      <text class="panel-desc">相处小抄需要先知道你的类型。去「我的名片」选择并保存类型后，再回来就能生成建议。</text>
      <view class="btn-primary mt" @click="goCard">去我的名片设置类型</view>
    </view>

    <template v-else-if="myType">
      <view class="type-pair">
        <view class="type-card pick" @click="openMyPicker">
          <text class="type-code">{{ myType || '未选择' }}</text>
          <text class="type-label">我的类型 · 点此更换 ⌄</text>
        </view>
        <text class="type-x">×</text>
        <view class="type-card pick" @click="openOtherPicker">
          <text class="type-code">{{ otherType }}</text>
          <text class="type-label">点此换一种 ⌄</text>
        </view>
      </view>

      <text class="kicker sub">SCENE / 这次是什么场景</text>
      <view class="scene-row">
        <view v-for="s in scenes" :key="s" class="scene-chip" :class="{ on: s === scene }" @click="scene = s">{{ s }}</view>
      </view>
      <text class="scene-tip">{{ sceneTip }}</text>

      <text class="kicker sub">NOTES / 相处建议</text>
      <view v-for="n in notes" :key="n.title" class="note-card">
        <text class="note-title">{{ n.title }}</text>
        <text class="note-text">{{ n.text }}</text>
      </view>

      <text class="fine">
        趣味建议，无配对分数，相处方式可以随情境调整。你的类型来自本人名片，对方类型由你手动选择。
      </text>
    </template>

    <view class="sk-foot-links">
      <text class="sk-foot-link" @click="load">重新读取我的类型</text>
    </view>
    <text class="sk-foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>

    <!-- 类型选择：点卡片才以底部弹层出现 -->
    <view v-if="showPicker" class="picker-mask" @click="closePicker">
      <view class="picker-sheet" @click.stop>
        <view class="sheet-handle" />
        <view class="sheet-head">
          <text class="sheet-kicker">{{ pickerMode === 'mine' ? 'MY TYPE / 我的类型' : 'MBTI 搭子 / 选择类型' }}</text>
          <view class="sheet-close" @click="closePicker"><text>×</text></view>
        </view>
        <text class="sheet-title">{{ pickerMode === 'mine' ? '选择我的类型' : '想了解哪种搭子？' }}</text>

        <template v-if="pickerMode === 'mine'">
          <text class="panel-desc">从你测试过或选择过的记录里挑一个。</text>
          <view v-if="myResultTypes.length" class="mine-list">
            <view
              v-for="item in myResultTypes"
              :key="item.type_code"
              class="mine-item"
              :class="{ on: item.type_code === myType }"
              @click="pickMine(item.type_code)"
            >
              <text class="mine-code">{{ item.type_code }}</text>
              <text class="mine-name">{{ item.name }}</text>
              <text class="mine-date">{{ item.date }}</text>
            </view>
          </view>
          <text v-else class="panel-desc">还没有可用的测试记录，先测一次再来。</text>
          <view class="btn-secondary mt" @click="goQuiz">去测一次</view>
        </template>

        <template v-else>
          <view v-for="group in typeGroups" :key="group.label" class="sheet-group">
            <text class="group-label">{{ group.label }}</text>
            <view class="group-grid">
              <view
                v-for="item in group.items"
                :key="item.code"
                class="type-tile"
                :class="{ on: item.code === otherType }"
                @click="pickOther(item.code)"
              >
                <text class="tile-code">{{ item.code }}</text>
                <text class="tile-name">{{ item.name }}</text>
              </view>
            </view>
          </view>
          <text v-if="!typeGroups.length" class="panel-desc">类型列表暂不可用，当前按 {{ otherType }} 生成建议。</text>
        </template>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import { listResults } from '@/api/results'
import { listTypes } from '@/api/types-api'
import type { TypeMeta } from '@/api/types'
import { TYPE_GROUPS, TYPE_NAMES } from '@/constants/types'
import { dateLabel } from '@/constants/journey'
import {
  COMPAT_SCENES,
  COMPAT_SCENE_TIPS,
  DEFAULT_COMPARE_TYPE,
  compatNotes,
  type CompatScene,
} from '@/constants/compat'

const loading = ref(false)
const error = ref('')
const myType = ref('')
const otherType = ref(DEFAULT_COMPARE_TYPE)
const scene = ref<CompatScene>('初次见面')
const typeOptions = ref<TypeMeta[]>([])
const showPicker = ref(false)
const pickerMode = ref<'mine' | 'other'>('other')
const myResultTypes = ref<{ type_code: string; name: string; date: string }[]>([])
let myTypeTouched = false

const scenes = COMPAT_SCENES
const notes = computed(() => compatNotes(myType.value, otherType.value, scene.value))
const sceneTip = computed(() => COMPAT_SCENE_TIPS[scene.value])

/** 弹层按分析家 / 外交家 / 守护者 / 探险家分组展示类型 */
const typeGroups = computed(() =>
  TYPE_GROUPS.map((group) => ({
    label: group.label,
    items: group.types
      .map((code) => typeOptions.value.find((t) => t.type_code === code))
      .filter((t): t is TypeMeta => Boolean(t))
      .map((t) => ({ code: t.type_code, name: t.name_zh || TYPE_NAMES[t.type_code] || '' })),
  })).filter((group) => group.items.length),
)

onLoad((query) => {
  const other = typeof query?.other === 'string' ? query.other.toUpperCase() : ''
  if (other) otherType.value = other
})

onShow(() => {
  void load()
})

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  let cardType = ''
  try {
    const card = await getMyCard()
    cardType = card.type_code || ''
  } catch {
    error.value = '读取你的类型失败，请稍后重试'
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
  await loadMyResultTypes()
  // 默认优先用最近一次测试结果，没有测试记录时才用名片上保存的类型
  if (!myTypeTouched) {
    myType.value = myResultTypes.value[0]?.type_code || cardType
  }
  loading.value = false
}

/** 读取本人测试过/选择过的类型，按时间从新到旧取唯一类型 */
async function loadMyResultTypes() {
  try {
    const res = await listResults({ limit: 50 })
    const seen = new Map<string, string>()
    for (const item of res.items) {
      if (!item.type_code || seen.has(item.type_code)) continue
      seen.set(item.type_code, item.submitted_at)
    }
    myResultTypes.value = Array.from(seen, ([code, date]) => ({
      type_code: code,
      name: TYPE_NAMES[code] || '',
      date: dateLabel(date),
    }))
  } catch {
    myResultTypes.value = []
  }
}

function openMyPicker() {
  pickerMode.value = 'mine'
  showPicker.value = true
}

/** 点右边的类型卡弹出类型选择 */
function openOtherPicker() {
  if (!typeOptions.value.length) {
    uni.showToast({ title: '类型列表暂不可用', icon: 'none' })
    return
  }
  pickerMode.value = 'other'
  showPicker.value = true
}

function closePicker() {
  showPicker.value = false
}

function pickMine(code: string) {
  myType.value = code
  myTypeTouched = true
  showPicker.value = false
}

function goQuiz() {
  uni.switchTab({ url: '/pages/index/index', fail: () => uni.reLaunch({ url: '/pages/index/index' }) })
}

function pickOther(code: string) {
  otherType.value = code
  showPicker.value = false
}

function goCard() {
  uni.switchTab({ url: '/pages/card/card', fail: () => uni.reLaunch({ url: '/pages/card/card' }) })
}

</script>

<style scoped lang="scss">
@import '@/styles/social.scss';
@import '@/styles/page-frame.scss';

.compat-page {
  padding-bottom: 48rpx;
}

.type-pair {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 30rpx;
}
.type-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 46rpx 20rpx 30rpx;
  border-radius: 28rpx;
  background: linear-gradient(160deg, #f4efff, #efe8ff);
  border: 2rpx solid #e6ddf8;
}
.type-card.pick {
  background: linear-gradient(160deg, #f7f2ff, #f1e9ff);
}
.type-code {
  font-size: 64rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: #6c4cf3;
}
.type-label {
  margin-top: 14rpx;
  font-size: 21rpx;
  color: #8b78b3;
}
.type-x {
  font-size: 30rpx;
  color: #c9c1d6;
}

.scene-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 22rpx;
}
.scene-chip {
  padding: 16rpx 28rpx;
  border-radius: 999rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  font-size: 23rpx;
  color: #5c5368;
}
.scene-chip.on {
  background: #6c4cf3;
  border-color: #6c4cf3;
  color: #fff;
  font-weight: 700;
}
.scene-tip {
  display: block;
  margin-top: 16rpx;
  font-size: 23rpx;
  line-height: 1.7;
  color: #77727e;
}

.note-card {
  margin-top: 18rpx;
  padding: 26rpx 24rpx;
  border-radius: 24rpx;
  background: #f7f4fc;
  border: 2rpx solid #ece7f1;
}
.note-title {
  display: block;
  font-size: 27rpx;
  font-weight: 700;
  color: #241f2e;
}
.note-text {
  display: block;
  margin-top: 10rpx;
  font-size: 23rpx;
  line-height: 1.8;
  color: #5c5368;
}
.fine {
  display: block;
  margin-top: 26rpx;
  font-size: 20rpx;
  line-height: 1.7;
  color: #a398af;
}

.picker-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  background: rgba(24, 18, 36, 0.42);
}
.picker-sheet {
  width: 100%;
  max-height: 86vh;
  box-sizing: border-box;
  padding: 18rpx 26rpx 56rpx;
  border-radius: 32rpx 32rpx 0 0;
  background: #fff;
  overflow-y: auto;
}
.sheet-handle {
  width: 72rpx;
  height: 8rpx;
  border-radius: 999rpx;
  background: #e3dcef;
  margin: 0 auto 22rpx;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sheet-kicker {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: #6c4cf3;
  font-weight: 700;
}
.sheet-close {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: #f4f1fa;
  color: #6f6880;
  font-size: 30rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet-title {
  display: block;
  margin-top: 16rpx;
  font-size: 46rpx;
  font-weight: 800;
  color: #241f2e;
}
.sheet-group {
  margin-top: 34rpx;
}
.group-label {
  font-size: 22rpx;
  color: #a398af;
}
.group-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 16rpx;
}
.type-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20rpx 6rpx;
  border-radius: 18rpx;
  background: #fff;
  border: 2rpx solid #ece7f1;
}
.type-tile.on {
  border-color: #6c4cf3;
  background: #f6f2ff;
}
.tile-code {
  font-size: 26rpx;
  font-weight: 800;
  color: #241f2e;
}
.type-tile.on .tile-code {
  color: #6c4cf3;
}
.tile-name {
  margin-top: 8rpx;
  font-size: 18rpx;
  color: #a398af;
}
.type-tile.on .tile-name {
  color: #7560df;
}

.mine-list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  margin-top: 20rpx;
}
.mine-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 22rpx;
  border-radius: 18rpx;
  background: #fff;
  border: 2rpx solid #ece7f1;
}
.mine-item.on {
  border-color: #6c4cf3;
  background: #f6f2ff;
}
.mine-code {
  font-size: 30rpx;
  font-weight: 800;
  color: #241f2e;
}
.mine-item.on .mine-code {
  color: #6c4cf3;
}
.mine-name {
  flex: 1;
  font-size: 22rpx;
  color: #77727e;
}
.mine-date {
  font-size: 20rpx;
  color: #a398af;
}
</style>
