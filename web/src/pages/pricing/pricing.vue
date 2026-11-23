<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="scene-offer">
      <view class="offer-heading">
        <text class="tag">为 {{ typeCode }} 的你准备</text>
        <view class="h2">
          <view v-for="line in sceneTitle" :key="line" class="title-line">{{ line }}</view>
        </view>
        <view class="p">{{ offerIntro }}</view>
      </view>

      <view class="scene-tabs">
        <button
          v-for="item in SCENES"
          :key="item.key"
          :class="{ active: scene === item.key }"
          @click="scene = item.key"
        >
          {{ item.label }}
        </button>
      </view>

      <view v-if="scene === 'avatar'" class="scenario-preview avatar-scenario">
        <view class="avatar-stack">
          <image :src="previewAsset" mode="aspectFill" />
          <text class="b">{{ typeCode }}</text>
        </view>
        <view class="h3">头像也要有我的 MBTI 气质。</view>
        <view class="p">同款 1:1 头像，可单独下载。</view>
        <text class="preview-badge">AI 虚构人物样例</text>
      </view>

      <view v-else-if="scene === 'meet'" class="scenario-preview meet-scenario">
        <view class="mini-pass">
          <text class="span">HELLO, I'M</text>
          <text class="strong">{{ typeCode }}</text>
          <text class="b">{{ nickname }}</text>
          <view class="mini-pass-tags">
            <text v-for="tag in previewInterests" :key="tag" class="tag">{{ tag }}</text>
          </view>
          <text class="small">{{ declaration }}</text>
        </view>
        <view class="p">初次见面，亮一下我的 MBTI 名片。</view>
        <text class="preview-badge">不含联系方式</text>
      </view>

      <view v-else class="scenario-preview moments-scenario">
        <view class="feed-head">
          <image :src="previewAsset" mode="aspectFill" />
          <view class="feed-head-main">
            <text class="b">{{ nickname }}</text>
            <text class="small">朋友圈效果预览 · 未发布</text>
          </view>
        </view>
        <view class="p feed-caption">同样是 {{ typeCode }}，我也有自己的主角感。✦</view>
        <view class="feed-photo">
          <image :src="previewAsset" mode="aspectFill" />
          <view class="feed-photo-info">
            <text class="strong">{{ typeCode }}</text>
            <text class="span">{{ nickname }} / {{ typeName }}</text>
          </view>
        </view>
        <text class="preview-badge">AI 示例人物</text>
      </view>

      <view class="style-pills">
        <button
          v-for="item in STUDIO_STYLES"
          :key="item.key"
          :class="{ active: style === item.key }"
          @click="style = item.key"
        >
          {{ item.label }}
        </button>
      </view>

      <view class="pack-grid">
        <view v-for="item in VALUE_PACKS" :key="item.no">
          <text class="span">{{ item.no }}</text>
          <text class="b">{{ item.title }}</text>
          <text class="small">{{ item.desc }}</text>
        </view>
      </view>
    </view>

    <view class="h3 offer-choice-title">选一份想晒的自己</view>

    <StateView v-if="loading" state="loading" title="正在读取商品…" />
    <StateView v-else-if="error" state="error" title="商品读取失败" :description="error">
      <button class="btn secondary full" @click="loadProducts">重新加载</button>
    </StateView>
    <StateView v-else-if="!products.length" state="empty" title="当前没有可购买的商品" description="稍后再来看看，或先回到首页继续探索。" />
    <view v-else class="plan-picker">
      <view
        v-for="(product, index) in products"
        :key="product.code"
        class="plan-option"
        :class="{ active: activePlanCode === product.code }"
        @click="choosePlan(product.code)"
      >
        <text v-if="index === 0" class="recommended">先从这一套开始</text>
        <text class="strong">{{ product.name }}</text>
        <text class="b">{{ priceLabel(product) }}</text>
        <text class="small">{{ product.description }}</text>
      </view>
    </view>

    <view class="notice" :class="{ warn: activeProduct?.tier === 2 }">{{ planNotice }}</view>
    <view class="promise-row">
      <text class="span">一次购买</text>
      <text class="span">无自动续费</text>
      <text class="span">基础结果免费</text>
    </view>

    <view v-if="activeProduct && !activeProduct.saleable" class="notice warn">
      {{ unavailableText }}
    </view>

    <view class="plan-faq">
      <view v-for="item in FAQS" :key="item.q" class="faq-item">
        <view class="faq-q" :class="{ open: openFaq === item.q }" @click="toggleFaq(item.q)">
          {{ item.q }}
        </view>
        <view v-if="openFaq === item.q" class="faq-a">{{ item.a }}</view>
      </view>
    </view>

    <view class="textbtn mt" @click="showRedeem">我有体验兑换码</view>

    <view class="action-dock">
      <button
        class="btn full"
        :disabled="!activeProduct || loading || !activeProduct.saleable"
        @click="onDockTap"
      >
        {{ dockLabel }}
      </button>
      <text class="dock-hint">一次购买 · 受控测试订单，不发起真实支付</text>
    </view>

    <view v-if="payOpen" class="modal-backdrop" @click.self="payOpen = false">
      <view class="modal">
        <button class="close" @click="payOpen = false">×</button>
        <view class="eyebrow">MBTI搭子 / V0.4</view>
        <view class="h2">这套 MBTI 形象，准备带走吗？</view>
        <view class="checkout-summary">
          <image :src="payArt" mode="aspectFill" />
          <view>
            <text class="span">{{ typeCode }} · {{ TYPE_NAMES[typeCode] || 'MBTI' }}</text>
            <view class="h3">{{ payProduct?.name || 'MBTI 晒图套装' }}</view>
            <text class="b">{{ payPriceLabel }}</text>
          </view>
        </view>
        <view class="p">{{ payProduct?.tier === 2 ? '包含晒图套装；照片功能目前仅本机预览，使用预置人物演示。' : '海报 + 同款头像 + 相处卡 + 配文。' }}</view>
        <view class="notice">{{ channelName }} · 受控测试订单，不会扣款。一次购买，没有自动续费。</view>
        <view v-if="payError" class="notice warn">{{ payError }}</view>
        <view class="btnrow mt">
          <button class="btn full" :disabled="creating" @click="confirmOrder">
            {{ creating ? '正在创建订单…' : '创建测试订单' }}
          </button>
          <button class="btn secondary full" :disabled="creating" @click="payOpen = false">先不下单</button>
        </view>
      </view>
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { createOrder, getMyEntitlements, listProducts, requestWechatPay, devPaymentAvailable, type Entitlement, type PaymentProduct, type WechatPayParams } from '@/api/payment'
import { getResult, listResults } from '@/api/results'
import { requestErrorMessage } from '@/api/client'
import { entitledTier, formatMoney } from '@/utils/payment-display'
import { DECLARATIONS, TYPE_NAMES } from '@/constants/types'
import { loadProfile } from '@/store/profile'
import { STUDIO_STYLES, studio, styleAsset, type StyleKey } from '@/store/studio'
import { account } from '@/store/account'

import { publicChannel, readPublishedPreview, type PublishedPreview } from '@/api/published-config'

type SceneKey = 'moments' | 'avatar' | 'meet'

const SCENES: { key: SceneKey; label: string }[] = [
  { key: 'moments', label: '发朋友圈' },
  { key: 'avatar', label: '换同款头像' },
  { key: 'meet', label: '见面亮名片' },
]

const SCENE_TITLES: Record<SceneKey, string[]> = {
  moments: ['把我的 MBTI，', '发成一条漂亮朋友圈。'],
  avatar: ['换个头像，', '让我的 MBTI 有点辨识度。'],
  meet: ['认识新朋友，', '先亮出我的 MBTI 名片。'],
}

const VALUE_PACKS = [
  { no: '01 / 主角图', title: '朋友圈 MBTI 海报', desc: '3 种风格 · 3 种比例' },
  { no: '02 / 头像', title: '同款人格头像', desc: '1:1 PNG 独立保存' },
  { no: '03 / 相处卡', title: '我的相处小抄', desc: '充电 · 沟通 · 在意' },
  { no: '04 / 配文', title: '发圈文案准备好', desc: '改一句就能复制' },
]

const FAQS = [
  {
    q: '不付费也可以做什么？',
    a: '看基础类型结果、使用基础文字名片、申请换名片、体验相处小抄与模拟同型雷达。付费购买的是视觉套装，不购买他人的联系方式。',
  },
  {
    q: '图片不喜欢，怎么办？',
    a: '原型可切换三种风格、重新选择宣言后再生成。正式版生成额度与退款条件在上线前明确，本页不承诺无限 AI 生图。',
  },
]

const scene = ref<SceneKey>('moments')
const style = ref<StyleKey>(studio.style)
const openFaq = ref('')
const profile = loadProfile()

const previewAsset = computed(() => styleAsset(style.value))
const sceneTitle = computed(() => {
  const configured = scene.value === 'moments' ? published.value?.content?.moments
    : scene.value === 'avatar' ? published.value?.content?.avatar : published.value?.content?.meet
  const lines = configured?.split(/[，,]/).map((item) => item.trim()).filter(Boolean)
  return lines?.length ? lines.slice(0, 2) : SCENE_TITLES[scene.value]
})
const nickname = computed(() => account.profile.nickname.trim() || studio.nickname.trim() || '小禾')
const previewInterests = computed(() => (profile.interests.length ? profile.interests : ['摄影', '音乐']))

let channelName = '微信小程序'

const products = ref<PaymentProduct[]>([])
const entitlements = ref<Entitlement[]>([])
const selectedId = ref('')
const resultType = ref('')
const activePlanCode = ref('')
const loading = ref(false)
const error = ref('')
const activeProduct = computed(() => products.value.find((item) => item.code === activePlanCode.value) || null)
const typeCode = computed(() => resultType.value || 'INFP')
const typeName = computed(() => TYPE_NAMES[typeCode.value] || 'MBTI')
const declaration = computed(() => DECLARATIONS[typeCode.value] || '四个字母之外，还有不一样的我。')
const planNotice = computed(() =>
  activeProduct.value?.tier === 2
    ? '本人形象套装的正式目标是基于授权照片生成。目前上传仅本机预览，生成仍用示例人物，不会变成你的真实样貌。'
    : '晒图套装使用原创示例人物，按昵称、MBTI、兴趣和宣言组合个性化排版；正式版人物素材需确保可商用。',
)
const unavailableText = computed(() =>
  activeProduct.value?.unavailable_reason === 'FULFILLMENT_UNCONFIGURED'
    ? '本人形象套装暂不可下单：后端履约通道尚未配置。'
    : '该商品暂不可下单，请选择其他套装。',
)
const published = ref<PublishedPreview | null>(null)
const offerIntro = computed(() => published.value?.content?.sub || '你拿到的是一套能保存、能展示的专属素材。')

onLoad((q) => {
  selectedId.value = (q?.result_id as string) || ''
  if (q?.channel !== undefined) channelName = publicChannel(q.channel) ? String(q.channel) : ''
  if (selectedId.value) {
    getResult(selectedId.value)
      .then((result) => { resultType.value = result.type_code })
      .catch(() => { resultType.value = '' })
  }
})
onShow(() => {
  void loadProducts()
  void loadEntitlements()
  void loadPublished()
})

async function loadPublished() {
  published.value = await readPublishedPreview('微信小程序')
}

async function loadProducts() {
  if (loading.value) return
  loading.value = true
  products.value = []
  error.value = ''
  try {
    products.value = (await listProducts()).items
    if (!products.value.some((item) => item.code === activePlanCode.value)) {
      activePlanCode.value = products.value[0]?.code || ''
    }
  }
  catch (e) { error.value = requestErrorMessage(e, '读取商品失败，请确认在线服务后重试') }
  finally { loading.value = false }
}

async function loadEntitlements() {
  try { entitlements.value = (await getMyEntitlements()).items }
  catch { entitlements.value = [] }
}

function priceLabel(product: PaymentProduct) {
  return formatMoney(product.amount, product.currency).replace(/^CNY\s*/, '¥').replace(/\.(\d)0$/, '.$1')
}

function choosePlan(code: string) {
  activePlanCode.value = code
}

const payOpen = ref(false)
const payProduct = ref<PaymentProduct | null>(null)
const creating = ref(false)
const payError = ref('')
const payArt = computed(() => styleAsset(style.value))
const dockPrice = computed(() => (activeProduct.value ? priceLabel(activeProduct.value) : '¥9.9'))
const ownedTier = computed(() => entitledTier(entitlements.value))
const isOwned = computed(() => !!activeProduct.value && ownedTier.value >= activeProduct.value.tier)
const dockLabel = computed(() => {
  if (!activeProduct.value) return '制作我的 MBTI 晒图套装'
  if (!activeProduct.value.saleable) return `${dockPrice.value} · 暂不可下单`
  if (isOwned.value) return '套装已解锁，开始制作 →'
  return `${dockPrice.value} · ${activeProduct.value.tier === 2 ? '制作我本人形象套装' : '制作我的 MBTI 晒图套装'}`
})
const payPriceLabel = computed(() => dockPrice.value)

function onDockTap() {
  if (!activeProduct.value) return
  if (!activeProduct.value.saleable) {
    uni.showToast({ title: unavailableText.value, icon: 'none' })
    return
  }
  if (isOwned.value) {
    startCreate()
    return
  }
  openPay(activeProduct.value)
}

function openPay(product: PaymentProduct | null | undefined) {
  if (!product) return
  payError.value = ''
  payProduct.value = product
  payOpen.value = true
}

function startCreate() {
  const resultId = selectedId.value
  if (resultId) {
    uni.navigateTo({ url: `/pages/create/create?result_id=${encodeURIComponent(resultId)}` })
  } else {
    uni.navigateTo({ url: '/pages/self-select/self-select' })
  }
}

/** F3：创建受控测试订单，金额/状态/权益全部以服务端响应为准 */
async function confirmOrder() {
  if (!payProduct.value || creating.value) return
  creating.value = true
  payError.value = ''
  try {
    let resultId = selectedId.value
    if (!resultId) {
      const latest = await listResults({ limit: 1 })
      resultId = latest.items[0]?.id || ''
    }
    if (!resultId) {
      payOpen.value = false
      uni.showToast({ title: '先选一个类型，再创建订单', icon: 'none' })
      setTimeout(() => uni.navigateTo({ url: '/pages/self-select/self-select' }), 400)
      return
    }
    const order = await createOrder({ result_id: resultId, product_code: payProduct.value.code })
    payOpen.value = false
    if (!devPaymentAvailable) {
      try {
        const payment = await requestWechatPay(order.id)
        await requestPayment(payment.pay_params)
        uni.redirectTo({ url: `/pages/order-status/order-status?order_id=${encodeURIComponent(order.id)}&paid=1` })
      } catch (e) {
        const cancelled = /cancel/i.test(String((e as { errMsg?: string })?.errMsg || ''))
        uni.showToast({ title: cancelled ? '已取消支付' : e instanceof Error ? e.message : '支付未完成，请稍后重试', icon: 'none' })
        uni.redirectTo({ url: `/pages/order-status/order-status?order_id=${encodeURIComponent(order.id)}` })
      }
      return
    }
    uni.navigateTo({ url: `/pages/order-status/order-status?order_id=${encodeURIComponent(order.id)}` })
  } catch (e) {
    payError.value = requestErrorMessage(e, '创建订单失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

/** 小程序端唤起微信支付；H5 仅用于预览，会给出明确提示。 */
function requestPayment(params: WechatPayParams): Promise<void> {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.requestPayment({
      provider: 'wxpay',
      timeStamp: params.timeStamp,
      nonceStr: params.nonceStr,
      package: params.package,
      signType: params.signType,
      paySign: params.paySign,
      success: () => resolve(),
      fail: (err) => reject(err),
    })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('请在微信小程序内完成支付'))
    // #endif
  })
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

function showDemoStatus() {
  uni.showModal({
    title: '演示状态',
    content: '当前为受控测试环境：基础结果免费，商品下单为受控测试订单，不产生真实扣款。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.title-line {
  display: block;
}

.offer-heading .h2 {
  font-weight: 700;
}
.scenario-preview .h3 {
  font-weight: 700;
}
.offer-choice-title {
  font-size: 16px;
  font-weight: 700;
  line-height: 24px;
}
.pack-grid .b {
  font-size: 12px;
}
.plan-option.active {
  padding: 19px 12px;
}
.plan-option .recommended {
  font-size: 9px;
}
.modal .h2,
.modal .h3 {
  font-weight: 700;
}

.feed-head-main {
  display: flex;
  flex-direction: column;
}

.mini-pass-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pack-grid > view {
  border: 1px solid #e9e2f1;
  border-radius: 14px;
  padding: 14px 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.feed-photo > view {
  position: absolute;
  left: 15px;
  bottom: 18px;
  color: #fff;
  z-index: 1;
}

.plan-option {
  min-height: 155px;
  cursor: pointer;
}

.faq-item {
  border-bottom: 1px solid var(--line);
  padding: 14px 0;
  font-size: 12px;
}
.faq-item:last-child {
  border-bottom: 0;
}
.faq-q {
  position: relative;
  padding-left: 15px;
  font-weight: 600;
  min-height: 26px;
  line-height: 1.65;
  cursor: pointer;
}
.faq-q::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  width: 0;
  height: 0;
  border-left: 5px solid #292432;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transform: translateY(-50%);
  transition: transform 0.15s;
}
.faq-q.open::before {
  transform: translateY(-50%) rotate(90deg);
}
.faq-a {
  margin: 12px 0 0;
  line-height: 1.8;
  color: var(--muted);
}

.btnrow {
  width: 100%;
}
.action-dock {
  display: block;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-width: 480px;
  margin: 0 auto;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  overflow-y: auto;
}
.modal {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
}
.modal .btnrow.mt {
  margin-top: 20px;
}
.modal .textbtn {
  display: block;
  width: fit-content;
}
.page {
  padding-bottom: 128px;
}</style>

