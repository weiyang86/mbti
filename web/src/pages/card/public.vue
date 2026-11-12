<template>
  <view class="page social-page public-page">
    <text class="kicker">PUBLIC CARD / 公开名片</text>
    <text class="page-title">只看得到，<text class="hl">对方允许公开的部分。</text></text>
    <text class="page-sub">这里只展示当前允许公开的字段，不含联系方式、历史结果或原始答题。</text>

    <text v-if="loading" class="notice">正在读取公开名片…</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <view v-if="card" class="panel">
      <text class="pc-label">MBTI BUDDY / 公开名片</text>
      <text class="pc-type">{{ card.type_code }}</text>
      <text class="panel-title">{{ displayBuddyName(card.nickname, card.id) }} · {{ card.type_name }}</text>
      <text v-if="card.declaration" class="line">{{ card.declaration }}</text>
      <view class="pc-tags"><text v-for="item in card.interests" :key="item" class="tag">{{ item }}</text></view>
      <view v-if="card.manual">
        <text class="kicker sub">MANUAL / 相处说明</text>
        <text class="panel-desc">充电方式：{{ card.manual.recharge }}</text>
        <text class="panel-desc">沟通偏好：{{ card.manual.communication }}</text>
        <text class="panel-desc">被照顾的方式：{{ card.manual.care }}</text>
      </view>
    </view>

    <view class="sk-foot-links">
      <text class="sk-foot-link" @click="load">刷新公开名片</text>
      <text class="sk-foot-link" @click="goTab('/pages/card/card')">我的名片</text>
      <text class="sk-foot-link" @click="goTab('/pages/discover/discover')">发现搭子</text>
    </view>
    <text class="sk-foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getPublicCard } from '@/api/cards'
import type { PublicCard } from '@/api/types-social'
import { displayBuddyName, socialErrorMessage } from '@/utils/social-display'
const id = ref('')
const card = ref<PublicCard | null>(null)
const loading = ref(false)
const error = ref('')
onLoad((query) => { id.value = typeof query?.id === 'string' ? query.id : '' })
onShow(load)
async function load() {
  if (loading.value) return
  card.value = null; error.value = ''
  if (!id.value) { error.value = '缺少公开名片编号，请从我的名片或搭子详情进入'; return }
  loading.value = true
  try { card.value = await getPublicCard(id.value) }
  catch (e) { error.value = socialErrorMessage(e, '公开名片读取失败，请重试') }
  finally { loading.value = false }
}
function go(url: string) { uni.navigateTo({ url }) }
function goTab(url: string) { uni.switchTab({ url, fail: () => uni.reLaunch({ url }) }) }
</script>
<style scoped lang="scss">
@import '@/styles/social.scss';
@import '@/styles/page-frame.scss';

.public-page {
  padding-bottom: 48rpx;
}
.pc-label {
  display: block;
  font-size: 19rpx;
  letter-spacing: 2rpx;
  color: #8b78b3;
}
.pc-type {
  display: block;
  margin-top: 14rpx;
  font-size: 84rpx;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 2rpx;
  color: #6c4cf3;
}
.pc-tags {
  margin-top: 10rpx;
}
</style>
