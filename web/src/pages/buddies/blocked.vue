<template>
  <view class="page social-page">
    <text class="heading">屏蔽管理</text>
    <text class="notice">只显示由你发起的屏蔽。管理标签用于区分记录，不展示对方私密资料。解除后旧交换不会恢复。</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <button class="btn-secondary" :disabled="loading || busy" @click="load">刷新屏蔽列表</button>
    <text v-if="loading" class="notice">正在读取屏蔽列表…</text>
    <text v-if="loaded && !items.length" class="notice">你尚未屏蔽任何搭子。</text>
    <view v-for="(item, index) in items" :key="item.id" class="card">
      <text class="section">已屏蔽搭子 {{ index + 1 }}</text>
      <text class="line">管理编号：{{ item.id }}</text>
      <button class="btn-secondary mt" :disabled="busy || loading" @click="unblock(item.id)">解除此项屏蔽</button>
    </view>
    <button class="btn-secondary mt" @click="go('/pages/discover/discover')">返回发现搭子</button>
    <button class="btn-secondary mt" @click="go('/pages/card/card')">我的名片</button>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listBlockedBuddies, unblockBuddy } from '@/api/buddies'
import type { BuddySummary } from '@/api/types-social'
import { socialErrorMessage } from '@/utils/social-display'
const items = ref<BuddySummary[]>([])
const loading = ref(false)
const loaded = ref(false)
const busy = ref(false)
const error = ref('')
const actionError = ref('')
onShow(() => { actionError.value = ''; load() })
async function load() {
  if (loading.value) return
  loading.value = true; loaded.value = false; items.value = []; error.value = ''
  try { items.value = (await listBlockedBuddies()).items; loaded.value = true }
  catch (e) { error.value = socialErrorMessage(e, '屏蔽列表读取失败，请重试') }
  finally { loading.value = false }
}
async function unblock(id: string) {
  if (busy.value || loading.value) return
  busy.value = true; actionError.value = ''
  try { await unblockBuddy(id); await load() }
  catch (e) { actionError.value = socialErrorMessage(e, '解除屏蔽失败，请重试'); await load() }
  finally { busy.value = false }
}
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">@import '@/styles/social.scss';</style>
