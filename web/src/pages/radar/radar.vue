<template>
  <view class="page social-page">
    <text class="heading">同型雷达</text>
    <text class="notice">你可以选择参与或退出。当前只保存参与选择，统计暂不可用；不会请求定位。</text>
    <text class="line">参与不等于位置授权，也不会更改名片公开范围或联系方式授权。私密名片也可以参与。</text>
    <text v-if="state.loading" class="notice" role="status">正在读取本人类型和参与状态…</text>
    <text v-if="state.error" class="error" role="alert">{{ state.error }}</text>
    <text v-if="state.notice" class="success" role="status">{{ state.notice }}</text>
    <view class="card">
      <text class="section">{{ state.needsReload && state.enrolled !== null ? '上次确认的参与状态' : '当前参与状态' }}</text>
      <text class="line">{{ state.enrolled === null ? '尚未读取' : state.enrolled ? '已参与雷达' : '未参与雷达' }}</text>
      <text v-if="state.typeCode" class="line">本人名片类型：{{ state.typeCode }}</text>
      <text v-else-if="!state.loading && !state.needsReload" class="notice">缺少本人 MBTI 类型。请先到我的名片主动选择并保存，再回来重新读取。</text>
      <button v-if="state.enrolled !== true" class="btn-primary mt" :disabled="state.loading || state.saving || state.needsReload || !state.typeCode" @click="controller.save(true)">{{ state.saving ? '正在保存…' : '参与雷达' }}</button>
      <button v-else class="btn-secondary mt" :disabled="state.loading || state.saving || state.needsReload" @click="controller.save(false)">{{ state.saving ? '正在保存…' : '退出雷达' }}</button>
    </view>
    <view class="card" aria-live="polite">
      <text class="section">同型统计</text>
      <text v-if="state.statistics.kind === 'loading'" class="notice">正在读取统计状态…</text>
      <text v-else-if="state.statistics.kind === 'missing_type'" class="notice">缺少本人类型，暂不能查询同型统计。</text>
      <text v-else-if="state.statistics.kind === 'not_enrolled'" class="notice">尚未参与雷达。参与后可读取统计的可用状态。</text>
      <template v-else-if="state.statistics.kind === 'unavailable'">
        <text class="line">同型统计暂不可用</text>
        <text class="notice">尚未接通自愿位置来源，暂时无法统计所选范围的同型人数。参与选择已保存，你仍可随时退出。</text>
      </template>
      <text v-else-if="state.statistics.kind === 'error'" class="error" role="alert">{{ state.statistics.message }}</text>
      <text v-else class="notice">{{ state.saving ? '正在保存参与选择…' : '请先读取当前状态。' }}</text>
      <text class="field">查询范围</text>
      <view class="row">
        <button v-for="radius in RADII" :key="radius" :class="state.radius === radius ? 'btn-primary' : 'btn-secondary'" :disabled="state.loading || state.saving || state.needsReload || !state.typeCode || !state.enrolled" :aria-pressed="state.radius === radius" @click="controller.setRadius(radius)">{{ radius === 500 ? '500 米' : `${radius / 1000} 公里` }}</button>
      </view>
      <text class="notice">切换范围会重新查询当前可用状态；范围统计尚未开放。</text>
    </view>
    <button class="btn-secondary mt" :disabled="state.loading || state.saving" @click="controller.load">重新读取状态</button>
    <button class="btn-secondary mt" :disabled="state.saving" @click="go('/pages/card/card')">去我的名片设置类型</button>
    <button class="btn-secondary mt" :disabled="state.saving" @click="go('/pages/discover/discover')">发现搭子</button>
  </view>
</template>
<script setup lang="ts">
import { reactive } from 'vue'
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
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">@import '@/styles/social.scss';</style>
