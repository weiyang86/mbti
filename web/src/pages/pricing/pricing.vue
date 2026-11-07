<template>
  <view class="page pricing-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <view class="offer-head">
      <text class="tag">{{ latestType ? '为 ' + latestType + ' 的你准备' : '示例预览 · 尚未测试类型' }}</text>
      <text class="offer-title" v-if="!latestType">先测出你的类型，</text>
      <text class="offer-title">再做专属 MBTI 主角图。</text>
      <text class="offer-sub" v-if="latestType">把我的 MBTI，发成一条漂亮朋友圈。</text>
      <text class="offer-sub" v-else>下面是 INFP 示例样式；测完或选择你的类型后，会换成你的专属文案与名片。</text>
    </view>

    <view class="offer-preview">
      <image class="offer-img" :src="previewAsset" mode="aspectFill" />
      <view class="offer-overlay">
        <text class="offer-type">{{ previewType }}</text>
        <text class="offer-name">{{ previewName }} / {{ previewNickname }}</text>
        <text class="offer-quote">{{ previewQuote }}</text>
      </view>
      <text class="offer-note">AI 示例人物 · 文字按填写内容排版</text>
    </view>

    <view class="style-pills">
      <view
        v-for="s in STUDIO_STYLES"
        :key="s.key"
        class="style-pill"
        :class="{ active: studio.style === s.key }"
        @click="pickStyle(s.key)"
      >
        <text>{{ s.label }}</text>
      </view>
    </view>

    <view class="pack-grid">
      <view class="pack-item">
        <text class="pack-no">01 / 主角图</text>
        <text class="pack-name">朋友圈 MBTI 海报</text>
        <text class="pack-desc">3 种风格 · 3 种比例</text>
      </view>
      <view class="pack-item">
        <text class="pack-no">02 / 头像</text>
        <text class="pack-name">同款人格头像</text>
        <text class="pack-desc">1:1 PNG 独立保存</text>
      </view>
      <view class="pack-item">
        <text class="pack-no">03 / 相处卡</text>
        <text class="pack-name">我的相处小抄</text>
        <text class="pack-desc">充电 · 沟通 · 在意</text>
      </view>
      <view class="pack-item">
        <text class="pack-no">04 / 配文</text>
        <text class="pack-name">发圈文案准备好</text>
        <text class="pack-desc">改一句就能复制</text>
      </view>
    </view>

    <text class="choice-title">选一份想晒的自己</text>
    <view class="plan-picker">
      <view
        v-for="p in PLANS"
        :key="p.tier"
        class="plan-option"
        :class="{ active: studio.plan === p.tier }"
        @click="choosePlan(p.tier)"
      >
        <text v-if="p.tier === 1" class="recommended">先从这一套开始</text>
        <text class="plan-name">{{ p.name }}</text>
        <text class="plan-price">¥{{ p.price }}</text>
        <text class="plan-desc">{{ p.desc }}</text>
      </view>
    </view>

    <view class="notice" :class="{ warn: studio.plan === 2 }">
      {{ studio.plan === 1
        ? '晒图套装使用原创示例人物，按昵称、MBTI、兴趣和宣言组合个性化排版；正式版人物素材需确保可商用。'
        : '本人形象套装的正式目标是基于授权照片生成。目前上传仅本机预览，生成仍用示例人物，不会变成你的真实样貌。' }}
    </view>

    <view class="promise-row">
      <text>一次购买</text>
      <text>无自动续费</text>
      <text>基础结果免费</text>
    </view>

    <text v-if="studio.tier === 1 && studio.plan === 2" class="notice green">
      已有晒图套装，模拟升级补差 ¥10。
    </text>

    <view class="plan-faq">
      <view class="faq-item">
        <text class="faq-q">不付费也可以做什么？</text>
        <text class="faq-a">
          看基础类型结果、使用基础文字名片、申请换名片、体验相处小抄与模拟同型雷达。付费购买的是视觉套装，不购买他人的联系方式。
        </text>
      </view>
      <view class="faq-item">
        <text class="faq-q">图片不喜欢，怎么办？</text>
        <text class="faq-a">
          可以切换三种风格、重新选择宣言后再生成。正式版生成额度与退款条件在上线前明确，本页不承诺无限 AI 生图。
        </text>
      </view>
    </view>

    <view class="btn-primary" @click="primaryAction">{{ primaryLabel }}</view>

    <text class="redeem-link" @click="toggleRedeem">我有体验兑换码</text>

    <view v-if="showRedeem" class="redeem-box">
      <input v-model="redeemInput" class="redeem-input" placeholder="输入体验码" maxlength="16" />
      <view class="btn-secondary redeem-btn" @click="doRedeem">模拟兑换</view>
      <text class="redeem-tip">演示码：MBTI099A / MBTI199B</text>
    </view>

    <text class="foot">一次购买 · 当前为模拟支付，不扣款 · 图片与文字仅本机演示</text>

    <!-- 模拟支付确认 -->
    <view v-if="showCheckout" class="modal-backdrop" @click="closeCheckout">
      <view class="modal-card" @click.stop>
        <view class="modal-head">
          <text class="modal-title">这套 MBTI 形象，准备带走吗？</text>
          <text class="modal-close" @click="closeCheckout">✕</text>
        </view>
        <view class="checkout">
          <image class="checkout-img" :src="previewAsset" mode="aspectFill" />
          <view class="checkout-info">
            <text class="checkout-type">{{ checkoutLabel }}</text>
            <text class="checkout-plan">{{ PLAN_NAMES[checkoutTier] }}</text>
            <text class="checkout-price">¥{{ checkoutAmount.toFixed(1) }}</text>
          </view>
        </view>
        <text class="checkout-desc">
          {{ checkoutTier === 1
            ? '海报 + 同款头像 + 相处卡 + 配文。'
            : '包含晒图套装；照片功能目前仅本机预览，使用预置人物演示。' }}
        </text>
        <view class="checkout-notice">微信 · 模拟支付，不会扣款。一次购买，没有自动续费。</view>
        <view class="btn-row mt">
          <view class="btn-primary flex" @click="paySuccess">模拟支付成功</view>
          <view class="btn-secondary flex" @click="payFail">模拟支付失败</view>
        </view>
        <text class="checkout-cancel" @click="closeCheckout">先不买，再看看</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listResults } from '@/api/results'
import { TYPE_NAMES, DECLARATIONS } from '@/constants/types'
import type { PlanTier, StyleKey } from '@/store/studio'
import {
  STUDIO_STYLES,
  PLAN_NAMES,
  choosePlan,
  purchasePlan,
  redeemCode,
  saveStudio,
  studio,
  styleAsset,
} from '@/store/studio'

const PLANS = [
  {
    tier: 1 as const,
    name: PLAN_NAMES[1],
    price: '9.9',
    desc: '成图 + 头像 + 相处卡 + 配文',
  },
  {
    tier: 2 as const,
    name: PLAN_NAMES[2],
    price: '19.9',
    desc: '全部内容 + 本人照片风格方案',
  },
]

const latestType = ref('')
const showRedeem = ref(false)
const redeemInput = ref('')
const showCheckout = ref(false)
const checkoutTier = ref<PlanTier>(1)
const checkoutAmount = ref(9.9)

onShow(async () => {
  try {
    const res = await listResults({ limit: 1 })
    latestType.value = res.items[0]?.type_code || ''
  } catch {
    latestType.value = ''
  }
})

const previewType = computed(() => latestType.value || 'INFP')
const previewName = computed(() => TYPE_NAMES[previewType.value] || 'MBTI')
const previewAsset = computed(() => styleAsset(studio.style))
const previewNickname = computed(() => studio.nickname.trim() || '小禾')
const previewQuote = computed(
  () =>
    studio.customQuote.trim() ||
    DECLARATIONS[previewType.value] ||
    '四个字母之外，还有不一样的你。',
)

const needUpgrade = computed(() => studio.tier === 1 && studio.plan === 2)
const unlocked = computed(() => studio.tier >= studio.plan)

const checkoutLabel = computed(() =>
  latestType.value
    ? `${latestType.value} · ${TYPE_NAMES[latestType.value] || 'MBTI'}`
    : '待测试 · 示例样式',
)

const primaryLabel = computed(() => {
  if (unlocked.value) return '套装已解锁，开始制作 →'
  if (needUpgrade.value) return '补 ¥10 升级'
  return `¥${PLANS[studio.plan - 1].price} · 制作我的${studio.plan === 1 ? ' MBTI 晒图套装' : '本人形象套装'}`
})

function pickStyle(key: StyleKey) {
  studio.style = key
  saveStudio()
}

function primaryAction() {
  if (unlocked.value) {
    goCreate()
    return
  }
  openCheckout()
}

function openCheckout() {
  const tier = studio.plan
  checkoutTier.value = tier
  checkoutAmount.value = studio.tier === 1 && tier === 2 ? 10 : tier === 1 ? 9.9 : 19.9
  showCheckout.value = true
}

function closeCheckout() {
  showCheckout.value = false
}

function paySuccess() {
  purchasePlan(checkoutTier.value, true)
  showCheckout.value = false
  uni.showToast({ title: '模拟购买成功，套装已解锁', icon: 'none' })
  setTimeout(goCreate, 400)
}

function payFail() {
  purchasePlan(checkoutTier.value, false)
  showCheckout.value = false
  uni.showModal({
    title: '本次模拟支付未完成',
    content: '没有扣款，已保留失败记录。',
    confirmText: '重新模拟购买',
    cancelText: '稍后再说',
    success: (res) => {
      if (res.confirm) openCheckout()
    },
  })
}

function goCreate() {
  if (!latestType.value) {
    uni.navigateTo({ url: '/pages/self-select/self-select' })
    return
  }
  uni.navigateTo({ url: '/pages/create/create' })
}

function toggleRedeem() {
  showRedeem.value = !showRedeem.value
}

function doRedeem() {
  const result = redeemCode(redeemInput.value)
  if (!result.ok) {
    uni.showToast({ title: result.message, icon: 'none' })
    return
  }
  redeemInput.value = ''
  showRedeem.value = false
  uni.showToast({ title: result.message, icon: 'none' })
  setTimeout(goCreate, 400)
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：套餐与订单仅保存在本机，不会产生真实扣款。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.pricing-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 28rpx;
}
.demo-link {
  color: #7560df;
}

.offer-head {
  margin-top: 8rpx;
}
.tag {
  display: inline-block;
  font-size: 20rpx;
  color: #6d58b2;
  background: #efe9ff;
  border-radius: 999rpx;
  padding: 8rpx 20rpx;
}
.offer-title {
  display: block;
  margin-top: 22rpx;
  font-size: 46rpx;
  font-weight: 800;
  line-height: 1.35;
  letter-spacing: -1rpx;
}
.offer-sub {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.7;
}

.offer-preview {
  position: relative;
  margin-top: 30rpx;
  height: 520rpx;
  border-radius: 28rpx;
  overflow: hidden;
  box-shadow: 0 20rpx 50rpx rgba(49, 33, 77, 0.16);
}
.offer-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.offer-overlay {
  position: absolute;
  left: 32rpx;
  right: 32rpx;
  bottom: 56rpx;
}
.offer-type {
  display: block;
  font-size: 80rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 4rpx;
  line-height: 1;
}
.offer-name {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.9);
}
.offer-quote {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.75);
}
.offer-note {
  position: absolute;
  left: 32rpx;
  bottom: 22rpx;
  font-size: 16rpx;
  color: rgba(255, 255, 255, 0.6);
}

.style-pills {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}
.style-pill {
  flex: 1;
  text-align: center;
  font-size: 22rpx;
  color: #77727e;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 999rpx;
  padding: 14rpx 0;
}
.style-pill.active {
  color: #7560df;
  border-color: #7560df;
  background: #f4f0ff;
}

.pack-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16rpx;
  margin-top: 32rpx;
}
.pack-item {
  background: #fff;
  border: 2rpx solid #ece6f2;
  border-radius: 22rpx;
  padding: 24rpx;
}
.pack-no {
  display: block;
  font-size: 18rpx;
  color: #a398af;
  letter-spacing: 1rpx;
}
.pack-name {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  font-weight: 700;
}
.pack-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #a398af;
}

.choice-title {
  display: block;
  margin-top: 44rpx;
  font-size: 30rpx;
  font-weight: 800;
}
.plan-picker {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  margin-top: 20rpx;
}
.plan-option {
  position: relative;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 26rpx;
  padding: 30rpx 28rpx 26rpx;
}
.plan-option.active {
  border-color: #7560df;
  background: #f7f3ff;
}
.recommended {
  display: inline-block;
  font-size: 18rpx;
  color: #2f8f6b;
  background: #e3f4ec;
  border-radius: 999rpx;
  padding: 4rpx 14rpx;
  margin-bottom: 12rpx;
}
.plan-name {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
}
.plan-price {
  display: block;
  margin-top: 8rpx;
  font-size: 44rpx;
  font-weight: 800;
  color: #7560df;
  line-height: 1.1;
}
.plan-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #77727e;
}

.notice {
  margin-top: 22rpx;
  padding: 22rpx 24rpx;
  border-radius: 18rpx;
  background: #f3f0f8;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.7;
}
.notice.warn {
  background: #fdf3e8;
  color: #96603a;
}
.notice.green {
  background: #e9f5ee;
  color: #2f8f6b;
}

.promise-row {
  display: flex;
  justify-content: space-between;
  margin-top: 24rpx;
  font-size: 21rpx;
  color: #8b8099;
}

.plan-faq {
  margin-top: 32rpx;
}
.faq-item {
  background: #fff;
  border: 2rpx solid #ece6f2;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
}
.faq-q {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
}
.faq-a {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: #77727e;
  line-height: 1.8;
}

.btn-primary {
  margin-top: 36rpx;
  font-weight: 700;
}

.redeem-link {
  display: block;
  margin-top: 26rpx;
  text-align: center;
  font-size: 24rpx;
  color: #7560df;
}
.redeem-box {
  margin-top: 20rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 22rpx;
  padding: 24rpx;
}
.redeem-input {
  height: 76rpx;
  padding: 0 20rpx;
  background: #f6f3fa;
  border-radius: 14rpx;
  font-size: 26rpx;
}
.redeem-btn {
  margin-top: 16rpx;
  padding: 18rpx 0;
  font-size: 26rpx;
}
.redeem-tip {
  display: block;
  margin-top: 12rpx;
  font-size: 20rpx;
  color: #a398af;
}

.foot {
  display: block;
  margin-top: 36rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}

.modal-backdrop {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 100;
  background: rgba(43, 33, 51, 0.37);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx;
}
.modal-card {
  width: 100%;
  background: #fff;
  border-radius: 32rpx;
  padding: 36rpx 32rpx;
  box-sizing: border-box;
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20rpx;
}
.modal-title {
  flex: 1;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.45;
  color: #292630;
}
.modal-close {
  font-size: 30rpx;
  color: #a398af;
  padding: 4rpx 8rpx;
}
.checkout {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-top: 28rpx;
}
.checkout-img {
  width: 160rpx;
  height: 160rpx;
  border-radius: 22rpx;
  flex-shrink: 0;
}
.checkout-info {
  flex: 1;
  min-width: 0;
}
.checkout-type {
  display: block;
  font-size: 22rpx;
  color: #8b8099;
}
.checkout-plan {
  display: block;
  margin-top: 8rpx;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.checkout-price {
  display: block;
  margin-top: 8rpx;
  font-size: 36rpx;
  font-weight: 800;
  color: #7560df;
}
.checkout-desc {
  display: block;
  margin-top: 24rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.7;
}
.checkout-notice {
  margin-top: 20rpx;
  padding: 22rpx 24rpx;
  border-radius: 18rpx;
  background: #f3f0f8;
  font-size: 21rpx;
  color: #77727e;
  line-height: 1.7;
}
.btn-row {
  display: flex;
  gap: 18rpx;
}
.btn-row .btn-primary,
.btn-row .btn-secondary {
  flex: 1;
  margin-top: 0;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx 0;
  font-size: 26rpx;
  font-weight: 600;
}
.btn-row .btn-primary {
  background: #6c4cf3;
  color: #fff;
}
.btn-row .btn-secondary {
  background: #fff;
  color: #292630;
  border: 2rpx solid #ece7f1;
}
.checkout-cancel {
  display: block;
  margin-top: 24rpx;
  text-align: center;
  font-size: 24rpx;
  color: #8b8099;
}
.mt {
  margin-top: 28rpx;
}
</style>
