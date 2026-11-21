<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">PRIVACY / 屏蔽管理</view>
      <view class="h1">不想再看到，<text class="line">就静静屏蔽。</text></view>
      <view class="p">只显示由你发起的屏蔽。管理标签用于区分记录，不展示对方私密资料。</view>
    </view>

    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <text v-if="loading" class="notice">正在读取屏蔽列表…</text>

    <view v-if="loaded && !items.length" class="panel">
      <view class="h3">还没有屏蔽任何搭子</view>
      <view class="p">解除屏蔽后，旧的名片交换与授权不会恢复。</view>
    </view>

    <view v-else-if="items.length" class="panel">
      <view class="h3">已屏蔽的搭子</view>
      <view class="p">列表按管理编号区分记录，不会展示对方的私密资料。</view>
      <view v-for="item in items" :key="item.id" class="wallet-item">
        <view class="wallet-head">
          <text class="b">{{ displayBuddyName(item.nickname, item.id) }} · {{ item.type_code }}</text>
          <text class="tag">已屏蔽</text>
        </view>
        <view class="p">管理编号：{{ item.id }}</view>
        <button class="btn secondary small" :disabled="busy || loading" @click="unblock(item.id)">解除此项屏蔽</button>
      </view>
    </view>

    <view class="btnrow mt">
      <button class="btn secondary" :disabled="loading" @click="load">刷新屏蔽列表</button>
      <button class="btn ghost" @click="goTab('/pages/discover/discover')">返回发现搭子</button>
    </view>
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listBlockedBuddies, unblockBuddy } from '@/api/buddies'
import type { BuddySummary } from '@/api/types-social'
import { displayBuddyName, socialErrorMessage } from '@/utils/social-display'
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
function toastDemo() { uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' }) }
function goTab(url: string) { uni.switchTab({ url, fail: () => uni.reLaunch({ url }) }) }
</script>
<style scoped lang="scss">
.line {
  display: block;
}
.error {
  display: block;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #a43b3b;
}
.notice {
  display: block;
}
.wallet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.panel .h3 {
  font-weight: 700;
}
.wallet-item .btn {
  margin-top: 4px;
}
.btn::after,
.textbtn::after {
  border: 0;
}
.demo-strip .textbtn {
  font-size: 9px;
  color: #a197ad;
}
.btnrow > .btn {
  margin: 0;
}
</style>
