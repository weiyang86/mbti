<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">MEET YOUR TYPE / MBTI 搭子</view>
      <view class="h1">先换张名片，<text class="line">看看合不合拍。</text></view>
      <view class="p">推荐依据是自选类型和兴趣。是否交换，由你们双方决定。</view>
    </view>

    <text v-if="error" class="error" role="alert">{{ error }}</text>

    <view class="notice mb">
      当前以 {{ myType }} 示例类型体验。
      <text class="textbtn" @click="goTab('/pages/card/card')">选择我的 MBTI →</text>
    </view>

    <view class="exchange-shortcuts">
      <view class="a" @click="go('/pages/radar/radar')">
        <text class="b">◎ 同型雷达</text>
        <text class="small">周边人数 · 模拟</text>
      </view>
      <view class="a" @click="go('/pages/compat/compat')">
        <text class="b">✧ 相处小抄</text>
        <text class="small">看看彼此的偏好</text>
      </view>
    </view>

    <view class="buddy-tabs">
      <button class="btn" :class="{ active: mode === 'recommend' }" @click="switchMode('recommend')">
        推荐搭子
      </button>
      <button class="btn" :class="{ active: mode === 'same', off: !myType }" @click="switchMode('same')">
        同型{{ myType ? ` ${myType}` : '' }}
      </button>
      <text class="a" @click="go('/pages/exchanges/exchanges')">名片夹{{ pendingCount ? ` ${pendingCount}` : '' }}</text>
    </view>

    <StateView v-if="loading" state="loading" title="正在读取搭子…" />

    <view v-for="buddy in items" :key="buddy.id" class="buddy-tile" @click="openBuddy(buddy.id)">
      <view class="buddy-avatar" :style="{ background: avatarTint(buddy.id).bg }">
        <text :style="{ color: avatarTint(buddy.id).fg }">{{ avatarText(buddy) }}</text>
      </view>
      <view class="buddy-main">
        <view class="b">
          {{ displayBuddyName(buddy.nickname, buddy.id) }}
          <text class="em">{{ buddy.type_code }}</text>
        </view>
        <view class="p">{{ buddy.tagline || buddy.type_name }}</view>
        <text class="small">{{ sharedText(buddy) }} · {{ buddy.exchange_status === 'accepted' ? '已交换名片' : '示例用户' }}</text>
      </view>
      <text class="span">↗</text>
    </view>

    <StateView v-if="loaded && !loading && !items.length" state="empty" title="这一组暂时没有可查看的搭子" description="可以在「我的」中管理屏蔽列表，或切换到另一组推荐。" />

    <view class="fine mt">全部为虚构成年人资料。没有聊天、评论或自由发布动态的入口。</view>
  <proto-tabbar />
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import { listResults } from '@/api/results'
import { listBuddies } from '@/api/buddies'
import { ensurePublishedConfig, published } from '@/store/published'
import { LIMITS } from '@/constants/copy'
import { listCardExchanges } from '@/api/card-exchanges'
import type { BuddySummary, CardExchange, MyCard } from '@/api/types-social'
import { avatarTint, displayBuddyName, socialErrorMessage } from '@/utils/social-display'
const myCard = ref<MyCard | null>(null)
const myType = ref('')
const items = ref<BuddySummary[]>([])
const exchanges = ref<CardExchange[]>([])
const mode = ref<'recommend' | 'same'>('recommend')
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const pendingCount = computed(() => exchanges.value.filter((item) => item.status === 'pending').length)
let modeInitialized = false
onShow(load)
async function load() {
  if (loading.value) return
  loading.value = true; loaded.value = false; items.value = []; exchanges.value = []; myCard.value = null; error.value = ''
  try {
    await ensurePublishedConfig()
    if (!modeInitialized) { mode.value = published.discovery?.order ?? 'recommend'; modeInitialized = true }
    const [card, exchangeList] = await Promise.all([
      getMyCard(),
      listCardExchanges().catch(() => ({ items: [] as CardExchange[] })),
    ])
    myCard.value = card
    exchanges.value = exchangeList.items
    let latestType = ''
    try { latestType = (await listResults({ limit: 1 })).items[0]?.type_code || '' } catch { latestType = '' }
    // 同型筛选以最近一次测试结果为准，名片里保存的类型只作兜底
    myType.value = latestType || card.type_code || 'INFP'
    const limit = published.discovery?.daily ?? LIMITS.discovery
    const list = mode.value === 'same' && myType.value
      ? await listBuddies({ mode: 'recommend', type_code: myType.value, limit })
      : await listBuddies({ mode: 'recommend', limit })
    items.value = list.items; loaded.value = true
  } catch (e) { error.value = socialErrorMessage(e, '搭子列表读取失败，请重试') }
  finally { loading.value = false }
}
function switchMode(next: 'recommend' | 'same') {
  if (loading.value || (next === 'same' && !myType.value)) return
  mode.value = next; load()
}
function avatarText(buddy: BuddySummary) {
  return Array.from(displayBuddyName(buddy.nickname, buddy.id))[0] || '搭'
}
function sharedText(buddy: BuddySummary) {
  if (buddy.shared_interests.length) return `共同兴趣：${buddy.shared_interests.join('、')}`
  return buddy.type_code === myType.value ? '同型搭子' : '不同类型，也可以认识'
}
function openBuddy(id: string) { go(`/pages/buddies/detail?id=${encodeURIComponent(id)}`) }
function toastDemo() { uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' }) }
function go(url: string) { uni.navigateTo({ url }) }
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
.notice .textbtn {
  padding: 4px;
  display: inline-block;
  font-size: 13px;
}
.demo-strip .textbtn {
  font-size: 9px;
  color: #a197ad;
}
.buddy-main {
  flex: 1;
  min-width: 0;
}
.btn::after,
.textbtn::after {
  border: 0;
}
.btnrow > .textbtn {
  margin: 0;
}
.buddy-tabs > .btn {
  border: 0;
  margin: 0;
  padding: 10px 13px;
  min-height: 44px;
  border-radius: 11px;
  background: #eee7f5;
  color: #90779f;
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;
}
.buddy-tabs > .btn.active {
  background: #6c4cf3;
  color: #fff;
}
.buddy-tabs .btn.off {
  opacity: 0.5;
}
.buddy-tile > .span {
  font-size: 16px;
  color: #baa7ca;
}
.fine.mt {
  margin-bottom: 10px;
}
</style>

