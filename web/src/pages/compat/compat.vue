<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">TYPE × TYPE / 相处小抄</view>
      <view class="h1">合不合拍，从了解偏好开始。</view>
      <view class="p">按类型标签生成的趣味建议，不提供“天生绝配”或匹配概率。</view>
    </view>

    <StateView v-if="loading" state="loading" title="正在读取你的类型…" />
    <text v-if="error" class="error" role="alert">{{ error }}</text>

    <view v-if="!loading && !myType" class="panel">
      <view class="h3">还没有你的 MBTI 类型</view>
      <view class="p">相处小抄需要先知道你的类型。去「我的名片」选择并保存类型后，再回来就能生成建议。</view>
      <button class="btn full mt" @click="goCard">去我的名片设置类型</button>
    </view>

    <template v-else-if="myType">
      <view class="type-pair">
        <view class="type-side" @click="openMyPicker">
          <text class="b">{{ myType }}</text>
          <text class="small">我的类型</text>
        </view>
        <text class="span">×</text>
        <button @click="openOtherPicker">
          <text class="b">{{ otherType }}</text>
          <text class="small">点此换一种 ⌄</text>
        </button>
      </view>

      <view class="choice-row">
        <button
          v-for="s in scenes"
          :key="s"
          class="choice"
          :class="{ sel: scene === s }"
          @click="scene = s"
        >{{ s }}</button>
      </view>

      <view class="compat-intro">{{ sceneTip }}</view>

      <view class="manual-cards">
        <view v-for="(n, i) in notes" :key="n.title" class="manual-card">
          <text class="span">0{{ i + 1 }}</text>
          <view>
            <view class="h3">{{ n.title }}</view>
            <view class="p">{{ n.text }}</view>
          </view>
        </view>
      </view>

      <button class="btn secondary full" @click="copyNotes">复制这份相处小抄</button>
      <button class="btn full mt" @click="goDiscover">去交换一张名片 →</button>
    </template>

    <view v-if="showPicker" class="modal-backdrop" @click="closePicker">
      <view class="modal" @click.stop>
        <button class="close" @click="closePicker">×</button>
        <view class="eyebrow">MBTI搭子 / V0.4</view>
        <view class="h2">{{ pickerMode === 'mine' ? '选择已有的 MBTI 类型' : '想了解哪种搭子？' }}</view>

        <template v-if="pickerMode === 'mine'">
          <view v-if="myResultTypes.length" class="mine-list">
            <button
              v-for="item in myResultTypes"
              :key="item.type_code"
              class="type-btn"
              :class="{ sel: item.type_code === myType }"
              @click="pickMine(item.type_code)"
            >
              {{ item.type_code }}
              <text class="small">{{ item.name }} · {{ item.date }}</text>
            </button>
          </view>
          <view v-else class="p">还没有可用的测试记录，先测一次再来。</view>
          <button class="btn secondary full mt" @click="goQuiz">去测一次</button>
        </template>

        <template v-else>
          <view v-for="group in typeGroups" :key="group.label" class="type-group">
            <view class="group-label">{{ group.label }}</view>
            <view class="type-grid">
              <button
                v-for="item in group.items"
                :key="item.code"
                class="type-btn"
                :class="{ sel: item.code === otherType }"
                @click="pickOther(item.code)"
              >
                {{ item.code }}
                <text class="small">{{ item.name }}</text>
              </button>
            </view>
          </view>
          <view v-if="!typeGroups.length" class="p">类型列表暂不可用，当前按 {{ otherType }} 生成建议。</view>
        </template>
      </view>
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
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
const copyText = computed(() => [
  `${myType.value} × ${otherType.value} · ${scene.value}`,
  ...notes.value.map((note) => `${note.title}：${note.text}`),
  '趣味建议，无配对分数，相处方式可以随情境调整。',
].join('\n'))

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
    myType.value = myResultTypes.value[0]?.type_code || cardType || 'INFP'
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

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover', fail: () => uni.reLaunch({ url: '/pages/discover/discover' }) })
}

function copyNotes() {
  uni.setClipboardData({
    data: copyText.value,
    success: () => uni.showToast({ title: '已复制相处小抄', icon: 'none' }),
  })
}

function demoState() { uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' }) }
</script>

<style scoped lang="scss">
.line {
  display: block;
  border-top: 0;
}
.error {
  display: block;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #a43b3b;
}
.type-side {
  flex: 1;
  min-height: 110px;
  padding: 20px 5px;
  background: #eee7f7;
  border: 1px solid #dfd1ee;
  border-radius: 17px;
  text-align: center;
  cursor: pointer;
}
.type-pair > button,
.type-pair > uni-button {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
}
.manual-cards > .manual-card {
  display: flex;
  align-items: flex-start;
  gap: 15px;
  padding: 20px 16px;
  background: #fff;
  border: 1px solid #e8e0ef;
  border-radius: 16px;
}
.manual-cards .h3 {
  font-weight: 700;
}
.manual-cards > .manual-card > .span {
  font-size: 14px;
  color: #b49aca;
}
.mine-list {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}
.mine-list .type-btn {
  text-align: left;
  padding: 12px 14px;
}
.btn::after,
.textbtn::after,
.type-pair button::after,
.mine-list .type-btn::after,
.type-grid .type-btn::after,
.close::after {
  border: 0;
}
</style>
