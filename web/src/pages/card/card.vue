<template>
  <view class="page">
    <proto-nav />
    <text v-if="loading" class="notice">正在读取本人名片…</text>
    <view v-if="error" class="notice warn">{{ error }}</view>
    <view v-if="success" class="notice green">{{ success }}</view>

    <!-- 还没有类型：先引导去做测试或直接选 -->
    <template v-if="card && !displayType">
      <view class="page-intro">
        <view class="eyebrow">MY MBTI CARD</view>
        <view class="h1">先选你的类型，再亮名片。</view>
        <view class="p">测完基础类型免费查看，也可以直接使用已知 MBTI。</view>
      </view>

      <view class="btn full" @click="goTest">免费测测我的 MBTI</view>
      <view class="btn secondary full mt" @click="goSelfSelect">已有类型，直接选</view>
    </template>

    <!-- 已有类型：名片主页 -->
    <template v-else-if="card">
      <DemoStrip />
      <view class="page-intro">
        <view class="eyebrow">MY CARD / 我的名片</view>
        <view class="h1">先认识我，再交换联系。</view>
        <view class="p">{{ introText }}</view>
      </view>

      <!-- 已生成视觉套装：主角图名片 -->
      <view v-if="hasVisual" class="portrait">
        <image class="portrait-img" :src="cardAsset" mode="aspectFill" />
        <view class="portrait-top">
          <text>MBTI搭子 / MY TYPE</text>
          <text>16 TYPES / 01 ME</text>
        </view>
        <view class="portrait-info">
          <view class="mbti">{{ displayType }}</view>
          <view class="name">{{ cardName }} · {{ displayTypeName }}</view>
          <view class="p">{{ cardQuote }}</view>
          <view v-if="showInterests" class="choice-row">
            <text v-for="item in cardInterests" :key="item" class="tag">{{ item }}</text>
          </view>
          <view class="tiny" style="margin-top: 14px">AI 示例人物 · 趣味人格探索</view>
        </view>
      </view>

      <!-- 未生成视觉套装：基础文字名片 -->
      <view v-else class="basic-type-card">
        <text class="span">MBTI BUDDY / 基础名片</text>
        <text class="strong">{{ displayType }}</text>
        <view class="h3">{{ cardName }} · {{ displayTypeName }}</view>
        <view class="p">{{ cardQuote }}</view>
        <view v-if="showInterests" class="choice-row">
          <text v-for="item in cardInterests" :key="item" class="tag">{{ item }}</text>
        </view>
        <text class="small">联系方式仅在双方同意后单独交换</text>
      </view>

      <text v-if="basisDate" class="fine centered mt">
        名片依据：{{ dateLabel(basisDate) }} 的结果 · 不含历史记录
      </text>
      <text class="textbtn full centered mt" @click="goHistory">查看不同阶段的我 →</text>

      <view class="card-quick-actions">
        <view class="a" @click="openPublic">
          <AppIcon name="card" :size="16" color="#a18ab4" />
          <text>亮名片</text>
        </view>
        <view class="a" @click="goCreate">
          <AppIcon name="spark" :size="16" color="#a18ab4" />
          <text>换形象</text>
        </view>
        <view class="a" @click="showSettings = !showSettings">
          <AppIcon name="lock" :size="16" color="#a18ab4" />
          <text>公开范围</text>
        </view>
      </view>

      <template v-if="hasVisual">
        <view class="btnrow mb">
          <button class="btn secondary" @click="previewAsset">保存主角图</button>
          <view class="btn" @click="goShare">晒出我的 MBTI ↗</view>
        </view>
        <view class="asset-downloads">
          <button class="btn secondary" @click="previewAsset">↓ 同款头像</button>
          <button class="btn secondary" @click="go('/pages/compat/compat')">↓ 相处卡</button>
        </view>
      </template>
      <view v-else-if="unlockTier" class="btn full mt" @click="goCreate">去制作我的 MBTI 晒图套装</view>
      <view v-else class="btn full mt" @click="goUpgrade">¥9.9 · 把名片升级成主角图</view>

      <view v-if="showSettings" class="panel mt">
        <view class="h3">公开范围</view>
        <view class="p fine">
          开启后类型会公开；昵称、兴趣、自我介绍和相处说明由下面四项控制。关闭后整张名片不可公开直访或发现。
        </view>
        <button
          class="btn secondary full mt"
          :disabled="busy || (!card.type_code && !card.discoverable)"
          role="switch"
          :aria-checked="card.discoverable"
          @click="setDiscovery"
        >{{ card.discoverable ? '关闭公开与发现' : '开启公开与发现' }}</button>
        <view v-for="row in visibilityRows" :key="row.key" class="settings-row">
          <text class="label">{{ row.label }}</text>
          <button
            class="btn secondary small"
            :disabled="busy"
            role="switch"
            :aria-checked="card.visibility[row.key]"
            @click="toggleField(row.key)"
          >{{ card.visibility[row.key] ? '公开' : '隐藏' }}</button>
        </view>
      </view>

      <view v-if="showEditor" class="panel mt">
        <view class="field">
          <text class="label">昵称（最多 40 字符）</text>
          <input v-model="form.nickname" class="input" maxlength="40" :disabled="busy" placeholder="可留空" />
        </view>

        <view class="field">
          <text class="label">名片类型：{{ form.type_code || '未选择' }}</text>
          <view class="choice-row">
            <button
              v-for="item in types"
              :key="item.type_code"
              class="choice"
              :class="{ sel: form.type_code === item.type_code }"
              :disabled="busy"
              @click="form.type_code = item.type_code"
            >{{ item.type_code }}</button>
          </view>
          <view v-if="typesError" class="notice warn mt">{{ typesError }}</view>
          <view class="notice mt">主动保存类型只更新名片，不修改历史结果；新测评不会覆盖已保存的名片类型。</view>
        </view>

        <view class="field">
          <text class="label">自我介绍（最多 160 字符）</text>
          <textarea v-model="form.declaration" class="input" maxlength="160" :disabled="busy" placeholder="可留空" />
        </view>

        <view class="field">
          <text class="label">兴趣（用逗号分隔，最多 10 项，每项最多 24 字符）</text>
          <input v-model="form.interests" class="input" :disabled="busy" placeholder="例如：阅读，散步" />
        </view>

        <view class="field">
          <text class="label">名片风格</text>
          <view class="choice-row">
            <button
              v-for="item in styles"
              :key="item.value"
              class="choice"
              :class="{ sel: form.style === item.value }"
              :disabled="busy"
              @click="form.style = item.value"
            >{{ item.label }}</button>
          </view>
        </view>

        <button class="btn full mt" :disabled="busy || loading" @click="save">保存名片资料</button>
      </view>

      <view class="mini-links">
        <text class="textbtn" @click="showEditor = !showEditor">编辑名片资料 {{ showEditor ? '↑' : '↓' }}</text>
        <text class="textbtn" @click="load">重新读取名片</text>
        <text class="textbtn" @click="goTab('/pages/discover/discover')">去换名片</text>
        <text class="textbtn" @click="go('/pages/buddies/blocked')">屏蔽管理</text>
      </view>

      <view class="contact-entry" @click="go('/pages/contacts/contacts')">
        <text class="span">⇄</text>
        <view>
          <text class="b">我的联系方式</text>
          <text class="small">微信 / QQ / 电话 · 交换时逐项授权</text>
        </view>
        <text class="em">→</text>
      </view>
      <view class="contact-entry" @click="go('/pages/exchanges/exchanges')">
        <text class="span">▣</text>
        <view>
          <text class="b">我的名片夹</text>
          <text class="small">查看申请与授权 · 逐张管理已交换名片</text>
        </view>
        <text class="em">→</text>
      </view>

      <text class="p fine centered mt">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
    </template>
  <proto-tabbar />
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '@/components/AppIcon.vue'
import { getMyCard, updateMyCard, type UpdateCardBody } from '@/api/cards'
import { listResults } from '@/api/results'
import { getMyEntitlements, type Entitlement } from '@/api/payment'
import { saveStudio, studio, styleAsset } from '@/store/studio'
import { loadProfile } from '@/store/profile'
import { listTypes } from '@/api/types-api'
import type { TypeMeta } from '@/api/types'
import type { CardStyle, CardVisibility, MyCard } from '@/api/types-social'
import { TYPE_NAMES, DECLARATIONS } from '@/constants/types'
import { dateLabel } from '@/constants/journey'
import { socialErrorMessage } from '@/utils/social-display'

const card = ref<MyCard | null>(null)
const types = ref<TypeMeta[]>([])
const typesError = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const success = ref('')
const showEditor = ref(false)
const showSettings = ref(false)
const latestType = ref('')
const latestResultId = ref('')
const latestAt = ref('')
const entitlements = ref<Entitlement[]>([])
const form = reactive({ nickname: '', type_code: '', declaration: '', interests: '', style: 'illustration' as CardStyle })
const styles: { value: CardStyle; label: string }[] = [{ value: 'illustration', label: '插画' }, { value: 'editorial', label: '杂志' }, { value: 'game', label: '游戏' }]
const visibilityRows: { key: keyof CardVisibility; label: string }[] = [
  { key: 'name', label: '昵称' }, { key: 'interests', label: '兴趣' }, { key: 'declaration', label: '自我介绍' }, { key: 'manual', label: '相处说明' },
]

/** 名片大卡优先展示名片上保存的类型；名片还没类型时才回落到最近一次测试结果 */
const displayType = computed(() => card.value?.type_code || latestType.value || '')
const displayTypeName = computed(() => TYPE_NAMES[displayType.value] || 'MBTI')
const displayDeclaration = computed(
  () => DECLARATIONS[displayType.value] || '四个字母之外，还有不一样的我。',
)
/** 付费态只认服务端权益：有 studio_tier_2 优先，其次 studio_tier_1 */
const unlockTier = computed<0 | 1 | 2>(() => {
  const codes = entitlements.value.map((item) => item.product_code)
  if (codes.includes('studio_tier_2')) return 2
  if (codes.includes('studio_tier_1')) return 1
  return 0
})
/** 与原型 state.hasCard 对齐：服务端已交付视觉套装，或本机生成已完成 */
const hasVisual = computed(() => !!card.value && (card.value.has_visual_set || studio.hasCard))
const profile = ref(loadProfile())
/** 名片内容优先取服务端名片，未保存时回落到生成时选择的昵称与宣言 */
const cardName = computed(() => {
  if (card.value?.visibility.name === false) return '匿名搭子'
  return card.value?.nickname || studio.nickname || '小禾'
})
const cardQuote = computed(
  () => card.value?.declaration || studio.quote || displayDeclaration.value,
)
const cardInterests = computed(() =>
  card.value?.interests.length ? card.value.interests : profile.value.interests,
)
const showInterests = computed(
  () => card.value?.visibility.interests !== false && cardInterests.value.length > 0,
)
const cardAsset = computed(() => styleAsset(card.value?.style || studio.style))
/** 与原型 cardRecordId 对齐：只有能确认名片依据是最近一次结果时才展示日期 */
const basisDate = computed(() => {
  const id = card.value?.latest_result_id
  return id && latestResultId.value === id ? latestAt.value : ''
})
const introText = computed(() =>
  hasVisual.value
    ? '成图素材已准备好，随时保存或亮给朋友看。'
    : '基础名片可以免费交换；想晒朋友圈，再制作视觉套装。',
)

onShow(load)
async function load() {
  if (loading.value || busy.value) return
  loading.value = true; card.value = null; error.value = ''; success.value = ''; typesError.value = ''
  profile.value = loadProfile()
  await Promise.all([
    getMyCard().then((data) => {
      card.value = data
      resetForm(data)
    }).catch((e) => { error.value = socialErrorMessage(e, '本人名片读取失败，请重试') }),
    listResults({ limit: 1 }).then((res) => {
      latestResultId.value = res.items[0]?.id || ''
      latestAt.value = res.items[0]?.submitted_at || ''
      latestType.value = res.items[0]?.type_code || ''
      // 名片还没有保存类型时，预选最近一次结果，方便一键保存
      if (!form.type_code && latestType.value) form.type_code = latestType.value
    }).catch(() => { latestType.value = ''; latestResultId.value = ''; latestAt.value = '' }),
    listTypes().then((data) => { types.value = data.items }).catch((e) => { types.value = []; typesError.value = socialErrorMessage(e, '类型列表读取失败，请重新读取') }),
    getMyEntitlements().then((data) => { entitlements.value = data.items }).catch(() => { entitlements.value = [] }),
  ])
  // 服务端权益是付费态的唯一来源，同步给本地套餐缓存，供「去制作」页判断是否已解锁
  if (unlockTier.value > studio.tier) {
    studio.tier = unlockTier.value
    saveStudio()
  }
  loading.value = false
}
function resetForm(data: MyCard) {
  Object.assign(form, { nickname: data.nickname, type_code: data.type_code, declaration: data.declaration, interests: data.interests.join('，'), style: data.style })
}
async function patch(body: UpdateCardBody, reset = false) {
  if (busy.value || !card.value) return
  busy.value = true; error.value = ''; success.value = ''
  try {
    const data = await updateMyCard(body)
    card.value = data
    if (reset) resetForm(data)
    success.value = '已保存到服务端'
  } catch (e) { error.value = socialErrorMessage(e, '保存失败，请重试') }
  finally { busy.value = false }
}
function save() {
  const interests = [...new Set(form.interests.split(/[,，]/).map((item) => item.trim()).filter(Boolean))]
  if (interests.length > 10 || interests.some((item) => Array.from(item).length > 24)) { error.value = '兴趣最多 10 项，每项最多 24 字符'; return }
  // Empty type is an unset state, never a fabricated type or an invalid PUT value.
  patch({ nickname: form.nickname, declaration: form.declaration, interests, style: form.style, ...(form.type_code ? { type_code: form.type_code } : {}) }, true)
}
function saveType() {
  if (!form.type_code) { error.value = '请先选择一个类型'; return }
  patch({ type_code: form.type_code }, true)
}
function useLatest() {
  if (!latestType.value) return
  patch({ type_code: latestType.value }, true)
}
function toggleField(key: keyof CardVisibility) {
  if (card.value) patch({ visibility: { [key]: !card.value.visibility[key] } })
}
function setDiscovery() { if (card.value) patch({ discoverable: !card.value.discoverable }) }
function openPublic() {
  if (!card.value) return
  if (!card.value.discoverable) {
    showSettings.value = true
    uni.showToast({ title: '先开启公开与发现', icon: 'none' })
    return
  }
  go(`/pages/card/public?id=${encodeURIComponent(card.value.id)}`)
}
/** 原型为下载成图；当前无成图接口，改为预览预置素材 */
function previewAsset() {
  if (!card.value) return
  const url = styleAsset(card.value.style)
  uni.previewImage({ urls: [url], current: url })
}
function demoInfo() {
  uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' })
}
function goTest() { uni.navigateTo({ url: '/pages/test-intro/test-intro' }) }
function goSelfSelect() { uni.navigateTo({ url: '/pages/self-select/self-select' }) }
function goCreate() { uni.navigateTo({ url: '/pages/create/create' }) }
function goHistory() { uni.switchTab({ url: '/pages/history/list', fail: () => uni.reLaunch({ url: '/pages/history/list' }) }) }
function goUpgrade() {
  const id = card.value?.latest_result_id
  uni.navigateTo({ url: `/pages/pricing/pricing${id ? `?result_id=${encodeURIComponent(id)}` : ''}` })
}
function goShare() {
  const id = latestResultId.value || card.value?.latest_result_id || ''
  uni.navigateTo({ url: `/pages/share-preview/share-preview${id ? `?id=${encodeURIComponent(id)}` : ''}` })
}
function go(url: string) { uni.navigateTo({ url }) }
function goTab(url: string) { uni.switchTab({ url, fail: () => uni.reLaunch({ url }) }) }
</script>

<style scoped lang="scss">
.portrait {
  position: relative;
  overflow: hidden;
}
.portrait-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.textbtn.full {
  display: block;
  width: 100%;
  text-align: center;
}
.mini-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 16px;
  margin: 18px 0 4px;
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.settings-row .label {
  margin-bottom: 0;
}
.basic-type-card .h3 {
  font-weight: 700;
}
</style>

