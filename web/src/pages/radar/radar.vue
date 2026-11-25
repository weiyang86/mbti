<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">SAME TYPE RADAR / 同型雷达</view>
      <view class="h1">周边 {{ radiusLabel }}，<text class="line">有多少个同型的你？</text></view>
      <view class="p">查看自愿参与者的类型人数，不展示任何人的具体位置。</view>
    </view>

    <view class="radar-visual">
      <view class="radar-ring r1" />
      <view class="radar-ring r2" />
      <view class="radar-ring r3" />
      <view class="radar-center">
        <text class="span">{{ state.typeCode || 'INFP' }} / {{ radiusLabel }}</text>
        <text class="strong">{{ demoCount }}</text>
        <text class="b">{{ countLabel }}</text>
      </view>
    </view>

    <view class="radius-tabs">
      <button
        v-for="radius in RADII"
        :key="radius"
        :class="{ active: state.radius === radius }"
        @click="controller.setRadius(radius)"
      >{{ radius === 500 ? '500 米' : `${radius / 1000} 公里` }}</button>
    </view>

    <StateView v-if="state.loading" state="loading" title="正在读取本人类型和参与状态…" />
    <text v-if="state.error" class="error" role="alert">{{ state.error }}</text>
    <text v-if="state.notice" class="success" role="status">{{ state.notice }}</text>
    <text v-if="state.statistics.kind === 'error'" class="error" role="alert">{{ state.statistics.message }}</text>

    <template v-if="state.enrolled === true">
      <view class="notice green">仅展示匿名人数统计，不生成附近人员列表，也不展示位置标记。</view>
      <button class="btn ghost full mt" :class="{ dim: ctaDisabled }" @click="leave">
        {{ state.saving ? '正在保存…' : '关闭本次雷达体验' }}
      </button>
    </template>
    <template v-else>
      <button class="btn full mt" :class="{ dim: ctaDisabled }" @click="join">
        {{ state.saving ? '正在保存…' : '体验同型雷达' }}
      </button>
    </template>

    <view class="radar-rules">
      <view class="h3">看见同类，不暴露行踪。</view>
      <view class="p">主动加入、可随时关闭；少于 10 人时仅显示“人数较少”，不展示精确人数或个人轨迹。</view>
      <view class="p">参与不等于位置授权，也不会更改名片公开范围或联系方式授权；私密名片也可以参与。</view>
    </view>

    <button class="btn secondary full" @click="goDiscover">去看非位置推荐的 MBTI 搭子</button>
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
import { computed, reactive } from 'vue'
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import { getRadarParticipation, getSameTypeCount, updateRadarParticipation } from '@/api/radar'
import { createRadarController, createRadarViewState } from '@/utils/radar-state'
import { ensurePublishedConfig, published } from '@/store/published'
const RADII = [500, 1000, 3000] as const
/** 示例人数：未接真实位置统计 */
const DEMO_COUNTS: Record<number, number> = { 500: 18, 1000: 43, 3000: 96 }
const state = reactive(createRadarViewState())
const controller = createRadarController({ getMyCard, getRadarParticipation, updateRadarParticipation, getSameTypeCount }, state)
onShow(async () => {
  await ensurePublishedConfig()
  if (published.discovery?.radius) state.radius = published.discovery.radius as typeof state.radius
  controller.enter()
})
onHide(controller.leave)
onUnload(controller.leave)

const radiusLabel = computed(() => (state.radius === 500 ? '500 米' : `${state.radius / 1000} 公里`))
const ctaDisabled = computed(() => state.loading || state.saving || state.needsReload)
const demoCount = computed(() => (state.enrolled === true ? DEMO_COUNTS[state.radius] : '—'))
const countLabel = computed(() => (state.enrolled === true ? '位同型参与者' : '先选择体验状态'))

function join() {
  if (ctaDisabled.value) return
  controller.save(true)
}
function leave() {
  if (ctaDisabled.value) return
  controller.save(false)
}
function goDiscover() { uni.switchTab({ url: '/pages/discover/discover', fail: () => uni.reLaunch({ url: '/pages/discover/discover' }) }) }
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
.success {
  display: block;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #286747;
}
.radius-tabs button,
.radius-tabs uni-button {
  padding: 1px 6px;
}
.radius-tabs button.dim {
  opacity: 0.55;
}
.radar-rules .h3 {
  font-weight: 700;
}
.btn.dim {
  opacity: 0.55;
}
.btn::after,
.textbtn::after {
  border: 0;
}
</style>
