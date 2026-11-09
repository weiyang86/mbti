<template>
  <view class="page social-page">
    <text class="heading">公开名片</text>
    <text v-if="loading" class="notice">正在读取公开名片…</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <button class="btn-secondary" :disabled="loading" @click="load">刷新公开名片</button>
    <view v-if="card" class="card">
      <text class="type-code">{{ card.type_code }}</text>
      <text class="section">{{ card.nickname || '匿名搭子' }} · {{ card.type_name }}</text>
      <text v-if="card.declaration" class="line">{{ card.declaration }}</text>
      <view><text v-for="item in card.interests" :key="item" class="tag">{{ item }}</text></view>
      <view v-if="card.manual">
        <text class="section">相处说明（类型模板参考）</text>
        <text class="line">充电方式：{{ card.manual.recharge }}</text>
        <text class="line">沟通偏好：{{ card.manual.communication }}</text>
        <text class="line">被照顾的方式：{{ card.manual.care }}</text>
      </view>
    </view>
    <text class="notice">这里只展示当前允许公开的字段，不含联系方式、历史结果或原始答题。</text>
    <button class="btn-secondary mt" @click="go('/pages/card/card')">我的名片</button>
    <button class="btn-secondary mt" @click="go('/pages/discover/discover')">发现搭子</button>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getPublicCard } from '@/api/cards'
import type { PublicCard } from '@/api/types-social'
import { socialErrorMessage } from '@/utils/social-display'
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
</script>
<style scoped lang="scss">@import '@/styles/social.scss';</style>
