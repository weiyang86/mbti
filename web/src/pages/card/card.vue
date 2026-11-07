<template>
  <view class="page card-page">
    <view v-if="loading" class="state"><text class="state-text">正在整理名片…</text></view>

    <view v-else-if="!card" class="state"><text class="state-text">名片暂时读不到</text></view>

    <!-- 还没有类型 -->
    <view v-else-if="!card.type_code">
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>
      <text class="kicker">MY TYPE CARD / 我的名片</text>
      <text class="title">还没有</text>
      <text class="title"><text class="hl">可以分享的名片。</text></text>
      <text class="sub">先做一次趣味测试，或用已有类型开始。</text>

      <view class="empty">
        <text class="empty-mark">□</text>
        <text class="empty-title">名片从一次选择开始</text>
        <text class="empty-desc">测试结果只用于生成名片和阶段记录，不含联系方式。</text>
        <view class="btn-primary mt" @click="goTest">免费测测</view>
        <view class="btn-ghost mt" @click="goSelfSelect">已有类型，直接选</view>
      </view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>

      <text class="kicker">MY TYPE CARD / 我的名片</text>
      <text class="title">一张不写联系方式的</text>
      <text class="title"><text class="hl">MBTI 名片。</text></text>
      <text class="sub">公开、换名片、晒图都使用这里展示的字段。</text>

      <view class="basic-type-card">
        <text class="card-kicker">TYPE CARD / 基础名片</text>
        <text class="card-type">{{ card.type_code }}</text>
        <text class="card-type-name">{{ card.type_name }}</text>
        <text class="card-name">{{ card.nickname }} · {{ card.type_code }}</text>
        <text class="card-declaration">{{ card.declaration || '还没有写介绍。' }}</text>
        <view class="tag-row">
          <text v-for="i in card.interests" :key="i" class="interest">{{ i }}</text>
          <text v-if="!card.interests.length" class="interest muted">未填写兴趣</text>
        </view>
        <text class="card-small">只展示公开字段 · 不含联系方式</text>
      </view>

      <text class="fine centered mt">
        名片依据：最近一次结果 · 不含历史记录
        <text class="link" @click="goHistory">看看不同阶段的我 →</text>
      </text>

      <view class="card-quick-actions">
        <view class="quick" @click="goPublic">
          <text class="quick-icon">◇</text>
          <text class="quick-label">亮名片</text>
        </view>
        <view class="quick" @click="goShare">
          <text class="quick-icon">▧</text>
          <text class="quick-label">换形象</text>
        </view>
        <view class="quick" @click="toggleVisibility">
          <text class="quick-icon">◐</text>
          <text class="quick-label">公开范围</text>
        </view>
      </view>

      <view v-if="showVisibility" class="privacy-fields">
        <text class="privacy-title">公开名片展示哪些字段？</text>
        <view v-for="row in visibilityRows" :key="row.key" class="privacy-row">
          <view class="privacy-text">
            <text class="privacy-name">{{ row.label }}</text>
            <text class="privacy-desc">{{ row.desc }}</text>
          </view>
          <view
            class="toggle"
            :class="{ on: card.visibility[row.key] }"
            @click="toggleField(row.key)"
          >
            <view class="knob" />
          </view>
        </view>
        <text class="fine">联系方式永远不在公开名片中展示。</text>
      </view>

      <view class="btn-primary mt" @click="goShare">去晒成一张图</view>
      <text class="fine centered">
        使用最近一次结果生成朋友圈图；不含联系方式与原始答题。
      </text>

      <view class="contact-entries">
        <view class="contact-entry" @click="goContacts">
          <view class="entry-main">
            <text class="entry-title">我的联系方式</text>
            <text class="entry-desc">{{ contactDesc }}</text>
          </view>
          <text class="entry-arrow">↗</text>
        </view>
        <view class="contact-entry" @click="goExchanges">
          <view class="entry-main">
            <text class="entry-title">我的名片夹</text>
            <text class="entry-desc">{{ exchangeDesc }}</text>
          </view>
          <text class="entry-arrow">↗</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { CardVisibility, MyCard } from '@/api/types-social'
import { getMyCard, updateMyCard } from '@/api/cards'
import { listCardExchanges } from '@/api/card-exchanges'
import { getContacts } from '@/api/contacts'

type VisibilityKey = keyof CardVisibility

const card = ref<MyCard | null>(null)
const loading = ref(true)
const showVisibility = ref(false)
const exchangeCount = ref(0)
const exchangePending = ref(0)
const contactCount = ref(0)

const visibilityRows: { key: VisibilityKey; label: string; desc: string }[] = [
  { key: 'name', label: '昵称', desc: '关闭后公开名片显示“匿名搭子”' },
  { key: 'interests', label: '兴趣标签', desc: '用于推荐与共同点展示' },
  { key: 'declaration', label: '自我介绍', desc: '名片上的一句话说明' },
  { key: 'manual', label: '相处说明书', desc: '补充你的节奏与沟通偏好' },
]

const contactDesc = computed(() =>
  contactCount.value ? `已填写 ${contactCount.value} 项，仅授权后展示` : '还未填写，授权后才会展示',
)

const exchangeDesc = computed(() => {
  if (!exchangeCount.value) return '还没有交换记录'
  if (exchangePending.value) return `${exchangeCount.value} 张名片 · ${exchangePending.value} 个待回应`
  return `${exchangeCount.value} 张名片`
})

onShow(() => {
  load()
})

async function load() {
  loading.value = !card.value
  try {
    const [data, exchanges, contacts] = await Promise.all([
      getMyCard(),
      listCardExchanges(),
      getContacts(),
    ])
    card.value = data
    exchangeCount.value = exchanges.items.length
    exchangePending.value = exchanges.items.filter((item) => item.status === 'pending').length
    contactCount.value = (['wechat', 'qq', 'phone'] as const).filter((key) => contacts[key]).length
  } catch {
    card.value = null
  } finally {
    loading.value = false
  }
}

function toggleVisibility() {
  showVisibility.value = !showVisibility.value
}

async function toggleField(key: VisibilityKey) {
  if (!card.value) return
  const previous = card.value.visibility[key]
  card.value.visibility[key] = !previous
  try {
    card.value = await updateMyCard({ visibility: { [key]: !previous } })
  } catch {
    if (card.value) card.value.visibility[key] = previous
    uni.showToast({ title: '保存失败，请稍后再试', icon: 'none' })
  }
}

function goTest() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function goHistory() {
  uni.switchTab({ url: '/pages/history/list' })
}

function goPublic() {
  uni.navigateTo({ url: '/pages/card/public' })
}

function goShare() {
  if (!card.value?.latest_result_id) {
    uni.showToast({ title: '先完成一次测试', icon: 'none' })
    return
  }
  uni.navigateTo({
    url: `/pages/share-preview/share-preview?id=${card.value.latest_result_id}`,
  })
}

function goContacts() {
  uni.navigateTo({ url: '/pages/contacts/contacts' })
}

function goExchanges() {
  uni.navigateTo({ url: '/pages/exchanges/exchanges' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：名片字段与公开范围保存在本机，不会同步给真实用户。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.card-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 24rpx;
}
.demo-link {
  color: #7560df;
}

.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
  font-weight: 600;
}
.title {
  display: block;
  margin-top: 12rpx;
  font-size: 56rpx;
  font-weight: 800;
  line-height: 1.28;
  letter-spacing: -1rpx;
}
.hl {
  color: #7560df;
  border-bottom: 10rpx solid #dfff8b;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.state {
  padding-top: 220rpx;
  text-align: center;
}
.state-text {
  font-size: 28rpx;
  color: #77727e;
}

.empty {
  margin-top: 44rpx;
  padding: 64rpx 32rpx;
  border-radius: 28rpx;
  border: 2rpx dashed #d7cbe7;
  background: rgba(255, 255, 255, 0.6);
  text-align: center;
}
.empty-mark {
  display: block;
  font-size: 44rpx;
  color: #b9a4da;
}
.empty-title {
  display: block;
  margin-top: 20rpx;
  font-size: 32rpx;
  font-weight: 700;
}
.empty-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.7;
}

.basic-type-card {
  margin-top: 36rpx;
  padding: 42rpx 38rpx;
  border-radius: 34rpx;
  background: #e6e0ff;
  border: 2rpx solid #d5c9f7;
  color: #2c2550;
}
.card-kicker {
  display: block;
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: #7560df;
  font-weight: 700;
}
.card-type {
  display: block;
  font-size: 92rpx;
  font-weight: 800;
  letter-spacing: -2rpx;
  line-height: 1.1;
  margin-top: 18rpx;
}
.card-type-name {
  display: block;
  font-size: 24rpx;
  color: #6d58b2;
  margin-top: 6rpx;
}
.card-name {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  margin-top: 28rpx;
}
.card-declaration {
  display: block;
  font-size: 24rpx;
  line-height: 1.7;
  margin-top: 12rpx;
  color: #4b4268;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 24rpx;
}
.interest {
  font-size: 20rpx;
  padding: 8rpx 18rpx;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.6);
  color: #6d58b2;
}
.interest.muted {
  color: #9b8fb3;
}
.card-small {
  display: block;
  margin-top: 28rpx;
  font-size: 18rpx;
  color: #7f6aa1;
}

.fine {
  display: block;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
  margin-top: 20rpx;
}
.fine.centered {
  text-align: center;
}
.link {
  color: #7560df;
  margin-left: 6rpx;
}

.card-quick-actions {
  display: flex;
  gap: 18rpx;
  margin-top: 32rpx;
}
.quick {
  flex: 1;
  background: #fff;
  border: 2rpx solid #e9e3f1;
  border-radius: 28rpx;
  padding: 28rpx 12rpx;
  text-align: center;
}
.quick-icon {
  display: block;
  font-size: 34rpx;
  color: #7560df;
}
.quick-label {
  display: block;
  font-size: 22rpx;
  margin-top: 10rpx;
  color: #292630;
}

.privacy-fields {
  margin-top: 24rpx;
  background: #fff;
  border: 2rpx solid #e9e3f1;
  border-radius: 28rpx;
  padding: 32rpx;
}
.privacy-title {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  margin-bottom: 10rpx;
}
.privacy-row {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 22rpx 0;
  border-bottom: 2rpx solid #f3eef7;
}
.privacy-row:last-of-type {
  border-bottom: none;
}
.privacy-text {
  flex: 1;
}
.privacy-name {
  display: block;
  font-size: 24rpx;
  color: #292630;
}
.privacy-desc {
  display: block;
  font-size: 20rpx;
  color: #a398af;
  margin-top: 4rpx;
}
.toggle {
  width: 84rpx;
  height: 46rpx;
  border-radius: 30rpx;
  background: #e3dbea;
  padding: 4rpx;
  box-sizing: border-box;
  flex-shrink: 0;
}
.toggle.on {
  background: #6c4cf3;
}
.knob {
  width: 38rpx;
  height: 38rpx;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.toggle.on .knob {
  transform: translateX(38rpx);
}

.btn-primary,
.btn-ghost {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx;
  font-size: 28rpx;
  font-weight: 600;
}
.btn-primary {
  background: #6c4cf3;
  color: #fff;
}
.btn-ghost {
  background: transparent;
  color: #77727e;
  border: 2rpx solid #ece7f1;
}

.contact-entries {
  margin-top: 36rpx;
}
.contact-entry {
  display: flex;
  align-items: center;
  background: #fff;
  border: 2rpx solid #e9e3f1;
  border-radius: 28rpx;
  padding: 30rpx 32rpx;
  margin-bottom: 20rpx;
}
.entry-main {
  flex: 1;
}
.entry-title {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  color: #292630;
}
.entry-desc {
  display: block;
  font-size: 20rpx;
  color: #a398af;
  margin-top: 6rpx;
}
.entry-arrow {
  font-size: 30rpx;
  color: #baa7ca;
}

.mt {
  margin-top: 24rpx;
}
</style>
