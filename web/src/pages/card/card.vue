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
      <text class="kicker">MY MBTI CARD / 我的名片</text>
      <text class="title">先选你的类型，</text>
      <text class="title"><text class="hl">再亮名片。</text></text>
      <text class="sub">测完基础类型免费查看，也可以直接使用已知 MBTI。</text>

      <view class="btn-primary mt" @click="goTest">免费测测我的 MBTI</view>
      <view class="btn-ghost mt" @click="goSelfSelect">已有类型，直接选</view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>

      <text class="kicker">MY CARD / 我的名片</text>
      <text class="title">先认识我，</text>
      <text class="title"><text class="hl">再交换联系。</text></text>
      <text class="sub">
        {{ hasVisual
          ? '成图素材已准备好，随时保存或亮给朋友看。'
          : '基础名片可以免费交换；想晒朋友圈，再制作视觉套装。' }}
      </text>

      <view v-if="hasVisual" class="portrait" @click="openAsset('poster')">
        <image class="portrait-img" :src="styleAsset(card.style)" mode="aspectFill" />
        <view class="portrait-shade" />
        <view class="portrait-top">
          <text>MBTI搭子 / MY TYPE</text>
          <text>16 TYPES / 01 ME</text>
        </view>
        <view class="portrait-info">
          <text class="portrait-type">{{ card.type_code }}</text>
          <text class="portrait-name">{{ publicName }} · {{ card.type_name }}</text>
          <text class="portrait-quote">{{ quoteText }}</text>
          <view
            v-if="card.visibility.interests && card.interests.length"
            class="tag-row portrait-tags"
          >
            <text v-for="i in card.interests" :key="i" class="interest">{{ i }}</text>
          </view>
          <text class="portrait-tiny">AI 示例人物 · 趣味人格探索</text>
        </view>
      </view>

      <!-- 基础名片 -->
      <view v-else class="basic-type-card">
        <text class="card-kicker">MBTI BUDDY / 基础名片</text>
        <text class="card-type">{{ card.type_code }}</text>
        <text class="card-name">{{ publicName }} · {{ card.type_name }}</text>
        <text class="card-declaration">{{ quoteText }}</text>
        <view v-if="card.visibility.interests && card.interests.length" class="tag-row">
          <text v-for="i in card.interests" :key="i" class="interest">{{ i }}</text>
        </view>
        <text class="card-small">联系方式仅在双方同意后单独交换</text>
      </view>

      <text class="fine centered mt">
        名片依据：最近一次结果 · 不含历史记录
        <text class="link" @click="goHistory">查看不同阶段的我 →</text>
      </text>

      <view class="card-quick-actions">
        <view class="quick" @click="goPublic">
          <text class="quick-icon">◇</text>
          <text class="quick-label">亮名片</text>
        </view>
        <view class="quick" @click="goStudio">
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

      <template v-if="hasVisual">
        <view class="btnrow">
          <view class="btn-secondary" @click="openAsset('poster')">保存主角图</view>
          <view class="btn-primary" @click="goShare">晒出我的 MBTI ↗</view>
        </view>
        <view class="asset-downloads">
          <view class="btn-secondary" @click="openAsset('avatar')">↓ 同款头像</view>
          <view class="btn-secondary" @click="openAsset('manual')">↓ 相处卡</view>
        </view>
      </template>
      <view v-else class="btn-primary mt" @click="goStudio">
        {{ studio.tier ? '套装已解锁 · 去制作我的名片' : '¥9.9 · 把名片升级成主角图' }}
      </view>

      <view class="contact-entries">
        <view class="contact-entry" @click="goContacts">
          <text class="entry-icon">⇄</text>
          <view class="entry-main">
            <text class="entry-title">我的联系方式</text>
            <text class="entry-desc">微信 / QQ / 电话 · 交换时逐项授权</text>
          </view>
          <text class="entry-arrow">→</text>
        </view>
        <view class="contact-entry" @click="goExchanges">
          <text class="entry-icon">▣</text>
          <view class="entry-main">
            <text class="entry-title">我的名片夹</text>
            <text class="entry-desc">{{ exchangeCount }} 张已交换 · 查看申请与授权</text>
          </view>
          <text class="entry-arrow">→</text>
        </view>
      </view>
    </view>

    <!-- 素材预览 -->
    <view v-if="assetKind && card" class="asset-backdrop" @click="assetKind = null">
      <view class="asset-sheet" @click.stop>
        <view class="asset-head">
          <text class="asset-title">{{ assetTitle }}</text>
          <text class="asset-close" @click="assetKind = null">✕</text>
        </view>
        <text class="asset-desc">
          {{ assetKind === 'manual' ? '手机可截屏保存这张相处卡。' : '手机可长按图片保存，也可以截屏保存 PNG。' }}
        </text>

        <view v-if="assetKind === 'manual'" class="manual-poster">
          <text class="mp-kicker">MBTI搭子 / 我的相处卡</text>
          <text class="mp-type">{{ card.type_code }}</text>
          <text class="mp-name">{{ publicName }} · {{ card.type_name }}</text>
          <view v-for="m in manual" :key="m.no" class="mp-item">
            <text class="mp-item-title">{{ m.no }} / {{ m.title }}</text>
            <text class="mp-item-body">{{ m.body }}</text>
          </view>
          <text class="mp-foot">类型模板建议 · 趣味参考 · 不含联系方式</text>
        </view>

        <view v-else class="asset-visual" :class="assetKind">
          <image class="asset-img" :src="styleAsset(card.style)" mode="aspectFill" />
          <view class="asset-shade" />
          <text class="asset-brand">MBTI搭子 / MY TYPE</text>
          <view class="asset-overlay">
            <text class="asset-type">{{ card.type_code }}</text>
            <text class="asset-name">{{ publicName }} · {{ card.type_name }}</text>
            <text v-if="assetKind === 'poster'" class="asset-quote">{{ quoteText }}</text>
            <text v-else class="asset-quote">AI 示例人物 · 趣味人格形象</text>
          </view>
        </view>

        <text class="fine centered">不含联系方式 · 不含原始答题选项</text>
        <view class="btn-primary mt" @click="assetKind = null">完成</view>
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
import { buildManual } from '@/constants/manual'
import { currentQuote, styleAsset, studio } from '@/store/studio'

type VisibilityKey = keyof CardVisibility
type AssetKind = 'poster' | 'avatar' | 'manual'

const card = ref<MyCard | null>(null)
const loading = ref(true)
const showVisibility = ref(false)
const exchangeCount = ref(0)
const assetKind = ref<AssetKind | null>(null)

const hasVisual = computed(() => Boolean(card.value?.has_visual_set || studio.hasCard))
const publicName = computed(() =>
  card.value?.visibility.name ? card.value.nickname : '匿名搭子',
)
const quoteText = computed(() => currentQuote(card.value?.type_code || 'INFP'))
const manual = computed(() => buildManual(card.value?.type_code || 'INFP'))
const assetTitle = computed(() => {
  if (assetKind.value === 'poster') return '主角图 / 朋友圈'
  if (assetKind.value === 'avatar') return '同款头像'
  return '相处卡 / 相处小抄'
})

const visibilityRows: { key: VisibilityKey; label: string; desc: string }[] = [
  { key: 'name', label: '昵称', desc: '关闭后公开名片显示“匿名搭子”' },
  { key: 'interests', label: '兴趣标签', desc: '用于推荐与共同点展示' },
  { key: 'declaration', label: '自我介绍', desc: '名片上的一句话说明' },
  { key: 'manual', label: '相处说明书', desc: '补充你的节奏与沟通偏好' },
]

onShow(() => {
  load()
})

async function load() {
  loading.value = !card.value
  try {
    const [data, exchanges] = await Promise.all([getMyCard(), listCardExchanges()])
    card.value = data
    exchangeCount.value = exchanges.items.filter((item) => item.status === 'accepted').length
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
    url: `/pages/share-preview/share-preview?id=${card.value.latest_result_id}${
      studio.hasCard ? `&style=${studio.style}` : ''
    }`,
  })
}

function goStudio() {
  uni.navigateTo({ url: studio.tier ? '/pages/create/create' : '/pages/pricing/pricing' })
}

function openAsset(kind: AssetKind) {
  if (!hasVisual.value) {
    uni.showToast({ title: '请先生成晒图套装', icon: 'none' })
    return
  }
  assetKind.value = kind
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

.studio-ready {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-top: 24rpx;
  padding: 26rpx;
  border-radius: 24rpx;
  background: linear-gradient(130deg, #2a2142, #443263 65%, #5a3f7d);
  box-shadow: 0 16rpx 36rpx rgba(42, 33, 66, 0.2);
}
.ready-body {
  flex: 1;
}
.ready-kicker {
  display: block;
  font-size: 17rpx;
  letter-spacing: 3rpx;
  color: rgba(255, 255, 255, 0.52);
}
.ready-title {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  font-weight: 700;
  color: #fff;
}
.ready-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #dfff8b;
}
.ready-mark {
  font-size: 30rpx;
  color: #dfff8b;
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
.entry-icon {
  width: 52rpx;
  font-size: 28rpx;
  color: #7560df;
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

.portrait {
  position: relative;
  margin-top: 36rpx;
  border-radius: 34rpx;
  overflow: hidden;
  aspect-ratio: 3 / 4;
  background: #2a2142;
  box-shadow: 0 24rpx 48rpx rgba(42, 33, 66, 0.22);
}
.portrait-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.portrait-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(20, 14, 34, 0.18) 0%, rgba(20, 14, 34, 0) 38%, rgba(20, 14, 34, 0.82) 100%);
}
.portrait-top {
  position: absolute;
  top: 26rpx;
  left: 28rpx;
  right: 28rpx;
  display: flex;
  justify-content: space-between;
  font-size: 16rpx;
  letter-spacing: 2rpx;
  color: rgba(255, 255, 255, 0.78);
}
.portrait-info {
  position: absolute;
  left: 30rpx;
  right: 30rpx;
  bottom: 28rpx;
}
.portrait-type {
  display: block;
  font-size: 88rpx;
  font-weight: 800;
  letter-spacing: -2rpx;
  line-height: 1.05;
  color: #fff;
}
.portrait-name {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  font-weight: 700;
  color: #fff;
}
.portrait-quote {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.86);
}
.portrait-tags .interest {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.portrait-tiny {
  display: block;
  margin-top: 20rpx;
  font-size: 16rpx;
  letter-spacing: 1rpx;
  color: rgba(255, 255, 255, 0.52);
}

.btnrow {
  display: flex;
  gap: 18rpx;
  margin-top: 28rpx;
}
.btnrow > view {
  flex: 1;
}
.btn-secondary {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx;
  font-size: 26rpx;
  font-weight: 600;
  background: #fff;
  color: #4b3fa6;
  border: 2rpx solid #dcd2f5;
}
.asset-downloads {
  display: flex;
  gap: 18rpx;
  margin-top: 18rpx;
}
.asset-downloads > view {
  flex: 1;
}

.asset-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(24, 18, 38, 0.72);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.asset-sheet {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  background: #f7f4fb;
  border-radius: 36rpx 36rpx 0 0;
  padding: 32rpx 32rpx calc(48rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.asset-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.asset-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #292630;
}
.asset-close {
  font-size: 28rpx;
  color: #a398af;
  padding: 6rpx 10rpx;
}
.asset-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #a398af;
}
.asset-visual {
  position: relative;
  margin-top: 24rpx;
  border-radius: 28rpx;
  overflow: hidden;
  aspect-ratio: 3 / 4;
  background: #2a2142;
}
.asset-visual.avatar {
  aspect-ratio: 1 / 1;
}
.asset-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;

  :deep(div) {
    background-position: 50% 10% !important;
  }
}
.asset-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(20, 14, 34, 0.05) 30%, rgba(20, 14, 34, 0.82) 100%);
}
.asset-brand {
  position: absolute;
  top: 24rpx;
  left: 24rpx;
  font-size: 16rpx;
  letter-spacing: 2rpx;
  color: rgba(255, 255, 255, 0.76);
}
.asset-overlay {
  position: absolute;
  left: 26rpx;
  right: 26rpx;
  bottom: 24rpx;
}
.asset-type {
  display: block;
  font-size: 72rpx;
  font-weight: 800;
  line-height: 1.05;
  color: #fff;
}
.asset-name {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: #fff;
}
.asset-quote {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.86);
}

.manual-poster {
  margin-top: 24rpx;
  padding: 40rpx 34rpx;
  border-radius: 28rpx;
  background: #2a2142;
  color: #fff;
}
.mp-kicker {
  display: block;
  font-size: 17rpx;
  letter-spacing: 3rpx;
  color: rgba(255, 255, 255, 0.55);
}
.mp-type {
  display: block;
  margin-top: 14rpx;
  font-size: 76rpx;
  font-weight: 800;
  line-height: 1.05;
  color: #dfff8b;
}
.mp-name {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  font-weight: 700;
}
.mp-item {
  margin-top: 26rpx;
  padding-top: 22rpx;
  border-top: 2rpx solid rgba(255, 255, 255, 0.12);
}
.mp-item-title {
  display: block;
  font-size: 19rpx;
  letter-spacing: 1rpx;
  color: #dfff8b;
}
.mp-item-body {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.9);
}
.mp-foot {
  display: block;
  margin-top: 28rpx;
  font-size: 17rpx;
  color: rgba(255, 255, 255, 0.42);
}

.mt {
  margin-top: 24rpx;
}
</style>
