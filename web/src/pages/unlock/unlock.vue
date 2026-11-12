<template>
  <view class="page commerce-page unlock-page">
    <view class="buy-head">
      <text class="chip">为 {{ typeCode }} 的你准备</text>
      <text class="buy-title">把我的 MBTI，发成一条漂亮朋友圈。</text>
      <text class="buy-desc">你专享的是一整套能晒、能留、能展示的专属素材。</text>
    </view>

    <text v-if="loading" class="muted">正在核对商品和本人结果…</text>
    <text v-if="error" class="error">{{ error }}</text>

    <ShareShowcase :type-code="typeCode" :type-name="typeName" />

    <view class="pack-grid">
      <view v-for="p in PACKS" :key="p.no" class="pack-item">
        <text class="pack-no">{{ p.no }}</text>
        <text class="pack-title">{{ p.title }}</text>
        <text class="pack-desc">{{ p.desc }}</text>
      </view>
    </view>

    <text class="section">选一份想晒的自己</text>
    <view class="plan-list">
      <view
        v-for="plan in PLANS"
        :key="plan.code"
        class="plan-card"
        :class="{ sel: productCode === plan.code }"
        @click="pickPlan(plan.code)"
      >
        <view class="plan-head">
          <text class="plan-name">{{ plan.name }}</text>
          <text class="plan-badge">{{ plan.badge }}</text>
        </view>
        <text class="plan-desc">{{ plan.desc }}</text>
        <text class="plan-price">{{ planPrice(plan.code, plan.fallbackPrice) }}</text>
        <text v-for="line in plan.includes" :key="line" class="plan-line">· {{ line }}</text>
      </view>
    </view>

    <text class="fine">人物形象由 AI 生成；文字按模板、MBTI、兴趣与宣言排版；上传本人照片需本人授权。</text>

    <view class="checks">
      <view class="check"><text class="check-icon">✓</text><text>一次购买</text></view>
      <view class="check"><text class="check-icon">✓</text><text>无自动续费</text></view>
      <view class="check"><text class="check-icon">✓</text><text>基础结果免费</text></view>
    </view>

    <view class="faq">
      <view v-for="f in FAQS" :key="f.q" class="faq-item">
        <view class="faq-q" @click="toggleFaq(f.q)">
          <text>{{ f.q }}</text>
          <text class="faq-arrow">{{ openFaq === f.q ? '−' : '+' }}</text>
        </view>
        <text v-if="openFaq === f.q" class="faq-a">{{ f.a }}</text>
      </view>
    </view>

    <text class="redeem" @click="showRedeem">我有体验兑换码</text>

    <view v-if="result && product" class="order-box">
      <text class="notice">受控测试价格，以服务端订单快照为准。当前为受控测试；支付通道未配置时，订单保持待支付，不能发起支付。</text>
      <text v-if="!product.saleable" class="notice">该商品暂未开放，暂不可创建测试订单。</text>
      <text class="identifier">本次订单绑定结果：{{ result.id }}</text>
      <button
        class="btn-primary mt"
        :disabled="creating || loading || !product.saleable || !intentReady"
        @click="create"
      >
        {{ creating ? '正在创建订单…' : `创建待支付测试订单 · ${planPrice(productCode, '¥9.9')}` }}
      </button>
      <text class="fine">网络失败后可点击重试或刷新；同一购买意图会复用订单号。</text>
    </view>

    <button v-if="error && !creating" class="btn-secondary mt" @click="load">重新核对</button>
    <button class="btn-secondary mt" :disabled="creating" @click="goOrders">查询我的订单与权益</button>
    <button class="btn-secondary mt" :disabled="creating" @click="goCatalog">返回商品目录</button>

    <text class="foot">趣味倾向体验 · 非临床测评 · 不宣称官方量表效度</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createOrder, listProducts, preparePurchaseIntent, type PaymentProduct } from '@/api/payment'
import { getResult } from '@/api/results'
import type { ResultSnapshot } from '@/api/types'
import { requestErrorMessage } from '@/api/client'
import { TYPE_NAMES } from '@/constants/types'
import ShareShowcase from '@/components/ShareShowcase.vue'

const PACKS = [
  { no: '01', title: '朋友圈 MBTI 海报', desc: '3 种风格 · 3 种比例' },
  { no: '02', title: '同款人格头像', desc: '1:1 PNG 独立保存' },
  { no: '03', title: '我的相处小抄', desc: '充电 · 沟通 · 在意' },
  { no: '04', title: '发朋友圈文案准备', desc: '统一风格配文' },
]

const PLANS = [
  {
    code: 'studio_tier_1',
    name: 'MBTI 晒图套装',
    badge: '先选 · 再套用',
    desc: '成图 + 头像 + 相处卡 + 配文',
    fallbackPrice: '¥9.9',
    includes: ['朋友圈 MBTI 海报', '同款人格头像', '相处卡与发圈文案'],
  },
  {
    code: 'studio_tier_2',
    name: '本人形象套装',
    badge: '含本人照片方案',
    desc: '全部内容 + 本人照片风格方案',
    fallbackPrice: '¥19.9',
    includes: ['包含晒图套装全部内容', '本人照片风格方案（本机预览）'],
  },
]

const FAQS = [
  {
    q: '不付费也可以做什么？',
    a: '基础测评结果、四维分布与阶段记录都免费；付费只解锁成图、头像、相处卡与配文。',
  },
  {
    q: '图片不满意怎么办？',
    a: '素材风格与宣言可以随时更换；本人照片方案需另行授权。',
  },
]

const resultId = ref('')
const productCode = ref('')
const catalog = ref<PaymentProduct[]>([])
const product = ref<PaymentProduct | null>(null)
const result = ref<ResultSnapshot | null>(null)
const loading = ref(false)
const creating = ref(false)
const intentReady = ref(false)
const error = ref('')
const openFaq = ref('')

const typeCode = computed(() => result.value?.type_code || 'MBTI')
const typeName = computed(() => TYPE_NAMES[result.value?.type_code || ''] || 'MBTI')

onLoad((q) => {
  resultId.value = (q?.result_id as string) || ''
  productCode.value = (q?.product_code as string) || ''
  load()
})

function planPrice(code: string, fallback: string) {
  const hit = catalog.value.find((item) => item.code === code)
  return hit ? `¥${(hit.amount / 100).toFixed(1)}` : fallback
}

async function load() {
  if (loading.value || creating.value) return
  loading.value = true
  intentReady.value = false
  product.value = null
  result.value = null
  error.value = ''
  try {
    if (!resultId.value || !productCode.value) throw new Error('请从商品目录选择本人的结果和商品')
    const [list, owned] = await Promise.all([listProducts(), getResult(resultId.value)])
    catalog.value = list.items
    result.value = owned
    if (!catalog.value.some((item) => item.code === productCode.value)) {
      throw new Error('商品不存在，请返回目录')
    }
    await prepare(productCode.value)
  } catch (e) {
    error.value = requestErrorMessage(e, e instanceof Error ? e.message : '核对失败，请稍后重试')
  } finally { loading.value = false }
}

async function prepare(code: string) {
  const hit = catalog.value.find((item) => item.code === code) || null
  product.value = hit
  intentReady.value = false
  if (!hit?.saleable) return
  await preparePurchaseIntent({ result_id: resultId.value, product_code: code })
  if (productCode.value !== code) return
  intentReady.value = true
}

async function pickPlan(code: string) {
  if (creating.value || loading.value || code === productCode.value) return
  productCode.value = code
  error.value = ''
  try {
    await prepare(code)
  } catch (e) {
    error.value = requestErrorMessage(e, '暂时无法选择该套装，请稍后重试')
  }
}

async function create() {
  if (creating.value || loading.value || !product.value?.saleable || !result.value || !intentReady.value) return
  creating.value = true
  error.value = ''
  try {
    const order = await createOrder({ result_id: resultId.value, product_code: productCode.value })
    // Never infer payment success or write local unlocked state from order creation.
    uni.redirectTo({ url: `/pages/order-status/order-status?order_id=${encodeURIComponent(order.id)}` })
  } catch (e) {
    error.value = requestErrorMessage(e, '创建结果尚未确认，请查询本人订单或重试；重试会保留同一购买意图')
  } finally { creating.value = false }
}

function toggleFaq(q: string) {
  openFaq.value = openFaq.value === q ? '' : q
}

function showRedeem() {
  uni.showModal({
    title: '体验兑换码',
    content: '兑换码由活动渠道发放；当前受控测试暂未开放兑换，可先免费查看基础结果。',
    showCancel: false,
    confirmText: '知道了',
  })
}

function goOrders() { uni.navigateTo({ url: '/pages/orders/orders' }) }
function goCatalog() { uni.redirectTo({ url: `/pages/pricing/pricing?result_id=${encodeURIComponent(resultId.value)}` }) }
</script>

<style scoped lang="scss">
@import '@/styles/payment.scss';

.unlock-page {
  padding-bottom: 56rpx;
}

.buy-head {
  margin-bottom: 8rpx;
}
.chip {
  display: inline-block;
  font-size: 19rpx;
  color: #6d58b2;
  background: #f1ecfb;
  border-radius: 999rpx;
  padding: 8rpx 20rpx;
}
.buy-title {
  display: block;
  margin-top: 18rpx;
  font-size: 44rpx;
  font-weight: 800;
  line-height: 1.4;
  color: #2c2550;
}
.buy-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 23rpx;
  color: #6f6880;
  line-height: 1.7;
}

.pack-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 24rpx;
}
.pack-item {
  width: calc(50% - 8rpx);
  box-sizing: border-box;
  padding: 22rpx 20rpx;
  border-radius: 22rpx;
  background: #fff;
  border: 2rpx solid #ece5f6;
}
.pack-no {
  display: block;
  font-size: 18rpx;
  color: #8f7bb0;
  letter-spacing: 2rpx;
}
.pack-title {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: #2c2550;
}
.pack-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: #8b8099;
}

.plan-list {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}
.plan-card {
  padding: 28rpx 26rpx;
  border-radius: 26rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.plan-card.sel {
  border-color: #7560df;
  box-shadow: 0 0 0 4rpx rgba(117, 96, 223, 0.12);
}
.plan-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
}
.plan-name {
  font-size: 30rpx;
  font-weight: 800;
  color: #2c2550;
}
.plan-badge {
  font-size: 18rpx;
  color: #5a7a3a;
  background: #eef4e4;
  border-radius: 999rpx;
  padding: 6rpx 16rpx;
}
.plan-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.6;
}
.plan-price {
  display: block;
  margin-top: 14rpx;
  font-size: 36rpx;
  font-weight: 800;
  color: #7560df;
}
.plan-line {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  color: #8b8099;
  line-height: 1.6;
}

.fine {
  display: block;
  margin-top: 18rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx 24rpx;
  margin-top: 24rpx;
}
.check {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 21rpx;
  color: #77727e;
}
.check-icon {
  color: #5a7a3a;
  font-weight: 700;
}

.faq {
  margin-top: 28rpx;
  border-top: 2rpx solid #f0ecf6;
}
.faq-item {
  border-bottom: 2rpx solid #f0ecf6;
}
.faq-q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26rpx 4rpx;
  font-size: 24rpx;
  color: #3f3552;
}
.faq-arrow {
  font-size: 28rpx;
  color: #a398af;
}
.faq-a {
  display: block;
  padding: 0 4rpx 26rpx;
  font-size: 21rpx;
  color: #77727e;
  line-height: 1.7;
}

.redeem {
  display: block;
  margin-top: 28rpx;
  text-align: center;
  font-size: 23rpx;
  color: #7560df;
}

.order-box {
  margin-top: 28rpx;
  padding: 26rpx 24rpx;
  border-radius: 26rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
}

.foot {
  display: block;
  margin-top: 40rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}
</style>
