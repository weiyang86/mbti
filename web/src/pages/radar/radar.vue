<template>
  <view class="page social-page radar-page">
    <text class="kicker">SAME TYPE RADAR / 同型雷达</text>
    <text class="page-title">周边 {{ radiusLabel }}，<text class="hl">有多少个同型的你？</text></text>
    <text class="page-sub">查看自愿参与者的类型人数，不展示任何人的具体位置。</text>

    <view class="radar">
      <view class="ring ring-outer">
        <view class="ring ring-mid">
          <view class="ring ring-inner">
            <text class="radar-type">{{ state.typeCode || 'MBTI' }} / {{ radiusLabel }}</text>
            <view class="radar-bar"><view class="radar-fill" :style="{ width: radarFill }" /></view>
            <text class="radar-status">{{ radarStatus }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="radius-row">
      <view
        v-for="radius in RADII"
        :key="radius"
        class="radius-chip"
        :class="{ on: state.radius === radius, dim: !canQuery }"
        @click="controller.setRadius(radius)"
      >{{ radius === 500 ? '500 米' : `${radius / 1000} 公里` }}</view>
    </view>

    <view
      v-if="state.enrolled !== true"
      class="btn-primary cta"
      :class="{ disabled: ctaDisabled }"
      @click="join"
    >{{ state.saving ? '正在保存…' : '体验同型雷达' }}</view>
    <view v-else class="btn-secondary cta" :class="{ disabled: ctaDisabled }" @click="leave">{{ state.saving ? '正在保存…' : '退出雷达' }}</view>

    <text v-if="state.loading" class="notice" role="status">正在读取本人类型和参与状态…</text>
    <text v-if="state.error" class="error" role="alert">{{ state.error }}</text>
    <text v-if="state.notice" class="success" role="status">{{ state.notice }}</text>
    <text v-if="!state.typeCode && !state.loading" class="notice">缺少本人 MBTI 类型，请先到我的名片选择并保存。</text>
    <text v-if="state.statistics.kind === 'error'" class="error" role="alert">{{ state.statistics.message }}</text>

    <text class="radar-section">看见同类，不暴露行踪。</text>
    <text class="radar-note">主动加入、可随时关闭；少于 10 人时仅显示“人数较少”，不展示精确人数或个人轨迹。</text>
    <text class="radar-note">参与不等于位置授权，也不会更改名片公开范围或联系方式授权；私密名片也可以参与。</text>

    <view class="btn-secondary cta" @click="goTab('/pages/discover/discover')">去看非位置推荐的 MBTI 搭子</view>

    <view class="sk-foot-links">
      <text class="sk-foot-link" @click="controller.load">重新读取状态</text>
      <text class="sk-foot-link" @click="goTab('/pages/card/card')">去我的名片设置类型</text>
    </view>
    <text class="sk-foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
  </view>
</template>
<script setup lang="ts">
import { computed, reactive } from 'vue'
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import { getRadarParticipation, getSameTypeCount, updateRadarParticipation } from '@/api/radar'
import { createRadarController, createRadarViewState } from '@/utils/radar-state'
const RADII = [500, 1000, 3000] as const
const state = reactive(createRadarViewState())
const controller = createRadarController({ getMyCard, getRadarParticipation, updateRadarParticipation, getSameTypeCount }, state)
onShow(controller.enter)
onHide(controller.leave)
onUnload(controller.leave)

const radiusLabel = computed(() => (state.radius === 500 ? '500 米' : `${state.radius / 1000} 公里`))
const canQuery = computed(() => !state.loading && !state.saving && !state.needsReload && !!state.typeCode && state.enrolled === true)
const ctaDisabled = computed(() => state.loading || state.saving || state.needsReload || (state.enrolled !== true && !state.typeCode))
const radarFill = computed(() => (state.enrolled === true ? '62%' : '18%'))
const radarStatus = computed(() => {
  if (state.loading) return '正在读取…'
  if (!state.typeCode) return '先到我的名片设置类型'
  if (state.enrolled !== true) return '先选择体验状态'
  if (state.statistics.kind === 'loading') return '正在统计…'
  if (state.statistics.kind === 'error') return '统计读取失败'
  return '同型统计暂不可用'
})

function join() {
  if (ctaDisabled.value) return
  controller.save(true)
}
function leave() {
  if (ctaDisabled.value) return
  controller.save(false)
}
function goTab(url: string) { uni.switchTab({ url, fail: () => uni.reLaunch({ url }) }) }
</script>
<style scoped lang="scss">
@import '@/styles/social.scss';
@import '@/styles/page-frame.scss';

.radar-page {
  padding-bottom: 48rpx;
}

.radar {
  display: flex;
  justify-content: center;
  padding: 34rpx 0 10rpx;
}
.ring {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ring-outer {
  width: 560rpx;
  height: 560rpx;
  background: #fdfbf5;
  border: 2rpx solid #ede4d1;
}
.ring-mid {
  width: 400rpx;
  height: 400rpx;
  border: 2rpx solid #e8e0f3;
  background: #fbf9ff;
}
.ring-inner {
  width: 270rpx;
  height: 270rpx;
  flex-direction: column;
  border: 2rpx dashed #dcd2f0;
  background: #f7f4fd;
}
.radar-type {
  font-size: 24rpx;
  color: #6f6880;
}
.radar-bar {
  margin-top: 18rpx;
  width: 130rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: #e3dcef;
  overflow: hidden;
}
.radar-fill {
  height: 100%;
  border-radius: 999rpx;
  background: #6b7a45;
  transition: width 0.3s ease;
}
.radar-status {
  margin-top: 18rpx;
  font-size: 19rpx;
  color: #a398af;
  text-align: center;
  padding: 0 16rpx;
}

.radius-row {
  display: flex;
  gap: 14rpx;
  margin-top: 26rpx;
}
.radius-chip {
  flex: 1;
  text-align: center;
  padding: 22rpx 0;
  border-radius: 18rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  font-size: 23rpx;
  color: #5c5368;
}
.radius-chip.on {
  background: #6b7a45;
  border-color: #6b7a45;
  color: #fff;
  font-weight: 700;
}
.radius-chip.dim {
  opacity: 0.55;
}

.cta {
  margin-top: 22rpx;
  padding: 30rpx 40rpx;
  font-size: 30rpx;
  font-weight: 700;
}
.cta.disabled {
  opacity: 0.55;
}
.cta-link {
  display: block;
  margin-top: 18rpx;
  font-size: 22rpx;
  color: #7560df;
}

.radar-section {
  display: block;
  margin-top: 44rpx;
  font-size: 40rpx;
  font-weight: 800;
  color: #241f2e;
}
.radar-note {
  display: block;
  margin-top: 16rpx;
  font-size: 23rpx;
  color: #77727e;
  line-height: 1.8;
}
</style>
