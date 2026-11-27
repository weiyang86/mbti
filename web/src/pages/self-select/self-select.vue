<template>
  <view>
    <proto-nav />
  <view class="page">
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">MY TYPE / 直接做名片</view>
      <view class="h1">把四个字母，<text class="line">做成你的专属形象。</text></view>
      <view class="p">选好类型，就能看你的朋友圈成图效果。</view>
    </view>

    <view class="field">
      <text class="label">名片昵称</text>
      <input class="input" v-model="profile.name" maxlength="12" placeholder="例如：小禾" />
    </view>

    <view class="field">
      <text class="label">我的 MBTI 类型</text>
      <button class="input type-selector" @click="pickerOpen = true">
        <text>{{ selected }} · {{ selectedName }}</text>
        <text>⌄</text>
      </button>
      <text v-if="loading" class="fine">正在加载 16 型…</text>
    </view>

    <view class="field">
      <text class="label">
        最近喜欢什么？ <text class="muted">选填 · 最多 3 项</text>
      </text>
      <view class="choice-row">
        <button
          v-for="i in INTERESTS"
          :key="i"
          class="choice"
          :class="{ sel: profile.interests.includes(i) }"
          @click="toggleInterest(i)"
        >
          {{ i }}
        </button>
      </view>
    </view>

    <view class="notice">这里使用你自选的类型，不会伪造测评成绩。</view>
  </view>

  <view class="action-dock">
    <button class="btn full" :disabled="submitting" @click="confirm">看看我的 MBTI 成图效果</button>
  </view>

  <view v-if="pickerOpen" class="modal-backdrop" @click="pickerOpen = false">
    <view class="modal" @click.stop>
      <button class="close" @click="pickerOpen = false">×</button>
      <view class="eyebrow">MBTI搭子 / V0.4</view>
      <view class="h2">选择已有的 MBTI 类型</view>
      <view v-for="g in groups" :key="g.label" class="type-group">
        <view class="group-label">{{ g.label }}</view>
        <view class="type-grid">
          <button
            v-for="t in g.items"
            :key="t.type_code"
            class="type-btn"
            :class="{ sel: selected === t.type_code }"
            @click="choose(t.type_code)"
          >
            <text>{{ t.type_code }}</text>
            <text class="small">{{ TYPE_NAMES[t.type_code] || t.name_zh }}</text>
          </button>
        </view>
      </view>
      <text v-if="!groups.length" class="fine">类型数据暂未加载，请稍后再试。</text>
    </view>
  </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { computed, onMounted, ref } from 'vue'
import type { TypeMeta } from '@/api/types'
import { listTypes } from '@/api/types-api'
import { createSelfSelectResult } from '@/api/results'
import { TYPE_NAMES } from '@/constants/types'
import { INTERESTS, loadProfile, saveProfile } from '@/store/profile'

const GROUP_DEFS: { label: string; codes: string[] }[] = [
  { label: '分析家', codes: ['INTJ', 'INTP', 'ENTJ', 'ENTP'] },
  { label: '外交家', codes: ['INFJ', 'INFP', 'ENFJ', 'ENFP'] },
  { label: '守护者', codes: ['ISTJ', 'ISFJ', 'ESTJ', 'ESFJ'] },
  { label: '探险家', codes: ['ISTP', 'ISFP', 'ESTP', 'ESFP'] },
]

const metas = ref<TypeMeta[]>([])
const groups = ref<{ label: string; items: TypeMeta[] }[]>([])
const selected = ref('INFP')
const profile = ref(loadProfile())
const loading = ref(true)
const submitting = ref(false)
const pickerOpen = ref(false)

const selectedName = computed(
  () =>
    TYPE_NAMES[selected.value] ||
    metas.value.find((t) => t.type_code === selected.value)?.name_zh ||
    'MBTI',
)

function choose(code: string) {
  selected.value = code
  pickerOpen.value = false
}

function toggleInterest(value: string) {
  const list = profile.value.interests
  const idx = list.indexOf(value)
  if (idx >= 0) {
    list.splice(idx, 1)
    return
  }
  if (list.length >= 3) {
    uni.showToast({ title: '最多选 3 项', icon: 'none' })
    return
  }
  list.push(value)
}

onMounted(async () => {
  try {
    const res = await listTypes()
    metas.value = res.items
    groups.value = GROUP_DEFS.map((g) => ({
      label: g.label,
      items: g.codes
        .map((code) => res.items.find((t) => t.type_code === code))
        .filter((t): t is TypeMeta => Boolean(t)),
    }))
  } catch {
    groups.value = []
  } finally {
    loading.value = false
  }
})

async function confirm() {
  if (submitting.value) return
  submitting.value = true
  saveProfile({ ...profile.value })
  try {
    const snapshot = await createSelfSelectResult({
      type_code: selected.value,
      source: 'self_select',
    })
    uni.redirectTo({ url: `/pages/result/result?id=${snapshot.id}` })
  } catch {
    uni.showToast({ title: '生成失败，请重试', icon: 'none' })
    submitting.value = false
  }
}
</script>

<style scoped lang="scss">
.modal .h2 {
  font-weight: 700;
}

.line {
  display: block;
  border-top: 0;
}

.fine {
  display: block;
  margin-top: 8px;
}

.input {
  display: block;
  height: 54px;
  min-height: 54px;
}

.type-selector {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: auto;
  height: 29px;
  min-height: 29px;
  margin: 0;
  padding: 1px 6px;
  border: 2px outset #8d8d8d;
  border-radius: 0;
  background: #f0f0f0;
  color: #000;
  font-size: 14px;
  line-height: 1.65;
  text-align: center;
  vertical-align: middle;
}

.choice {
  margin: 0;
}

.type-btn {
  width: 100%;
  margin: 0;
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
</style>
