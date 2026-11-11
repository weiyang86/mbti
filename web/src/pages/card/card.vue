<template>
  <view class="page social-page card-page">
    <text v-if="loading" class="notice">正在读取本人名片…</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>

    <!-- 还没有类型：先引导去做测试或直接选 -->
    <template v-if="card && !card.type_code">
      <text class="kicker">MY MBTI CARD</text>
      <text class="big-title">先选你的类型，再亮名片。</text>
      <text class="sub">测完基础类型免费查看，也可以直接使用已知 MBTI。</text>

      <view class="btn-primary big-btn" @click="goTest">免费测测我的 MBTI</view>
      <view class="btn-secondary big-btn" @click="goSelfSelect">已有类型，直接选</view>
      <text class="picker-entry" @click="showEditor = !showEditor">或在这里直接选类型 {{ showEditor ? '↑' : '↓' }}</text>

      <view v-if="latestType" class="latest-hint" @click="useLatest">
        检测到你的最近结果 {{ latestType }}，直接用它亮名片 →
      </view>

      <view v-if="showEditor" class="card editor-card">
        <text class="editor-label">名片类型</text>
        <view class="type-grid">
          <button
            v-for="item in types"
            :key="item.type_code"
            :class="form.type_code === item.type_code ? 'btn-primary' : 'btn-secondary'"
            :disabled="busy"
            :aria-pressed="form.type_code === item.type_code"
            @click="form.type_code = item.type_code"
          >{{ item.type_code }}</button>
        </view>
        <text v-if="typesError" class="error">{{ typesError }}</text>
        <view class="btn-primary mt" :class="{ disabled: busy }" @click="saveType">保存类型</view>
        <text v-if="success" class="success" role="status">{{ success }}</text>
      </view>

      <text class="foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
    </template>

    <!-- 已有类型：名片主页 -->
    <template v-else-if="card">
      <text class="kicker">MY CARD / 我的名片</text>
      <text class="big-title">先认识我，再交换联系。</text>
      <text class="sub">基础名片可以免费交换；想晒朋友圈，再制作视觉套装。</text>

      <view class="namecard">
        <text class="nc-label">MBTI BUDDY / 基础名片</text>
        <text class="nc-type">{{ card.type_code }}</text>
        <text class="nc-name">{{ card.nickname || '我' }} · {{ typeName }}</text>
        <text class="nc-decl">{{ card.declaration || declarationText }}</text>
        <text class="nc-foot">联系方式仅在双方同意后单独交换</text>
      </view>

      <text class="journey-link" @click="goHistory">查看不同阶段的我 →</text>

      <view class="quick-row">
        <view class="quick" @click="openPublic">
          <text class="quick-icon">▣</text>
          <text class="quick-text">亮名片</text>
        </view>
        <view class="quick" @click="goCreate">
          <text class="quick-icon">✦</text>
          <text class="quick-text">换形象</text>
        </view>
        <view class="quick" @click="showSettings = !showSettings">
          <text class="quick-icon">◎</text>
          <text class="quick-text">公开范围</text>
        </view>
      </view>

      <view v-if="unlockTier" class="unlocked">
        <view class="unlocked-head">
          <text class="unlocked-tag">套装已解锁</text>
          <text class="unlocked-tier">{{ unlockTier === 2 ? '本人形象套装' : 'MBTI 晒图套装' }}</text>
        </view>
        <text class="unlocked-title">你的 MBTI 形象，随时可以换。</text>
        <text class="unlocked-desc">海报 · 头像 · 相处卡 · 配文，现在都可以制作。</text>
        <view class="btn-primary mt" @click="goCreate">去制作我的 MBTI 晒图套装</view>
      </view>
      <view v-else class="upgrade" @click="goUpgrade">
        <text class="upgrade-text">¥9.9 · 把名片升级成主角图</text>
      </view>

      <view class="row-card" @click="go('/pages/contacts/contacts')">
        <text class="row-icon">⇄</text>
        <view class="row-body">
          <text class="row-title">我的联系方式</text>
          <text class="row-desc">微信 / QQ / 电话 · 交换时逐项授权</text>
        </view>
        <text class="row-arrow">→</text>
      </view>
      <view class="row-card" @click="go('/pages/exchanges/exchanges')">
        <text class="row-icon">▤</text>
        <view class="row-body">
          <text class="row-title">我的名片夹</text>
          <text class="row-desc">查看已交换名片、申请与授权</text>
        </view>
        <text class="row-arrow">→</text>
      </view>

      <view v-if="showSettings" class="card settings-card">
        <view class="settings-head">
          <text class="settings-title">公开范围</text>
          <text class="settings-state">{{ card.discoverable ? '已公开' : '未公开' }}</text>
        </view>
        <text class="settings-desc">开启后类型会公开；昵称、兴趣、自我介绍和相处说明由下面四项控制。关闭后整张名片不可公开直访或发现。</text>
        <button :class="card.discoverable ? 'btn-primary' : 'btn-secondary'" :disabled="busy || (!card.type_code && !card.discoverable)" role="switch" :aria-checked="card.discoverable" @click="setDiscovery">{{ card.discoverable ? '关闭公开与发现' : '开启公开与发现' }}</button>
        <view v-for="row in visibilityRows" :key="row.key" class="visibility">
          <text class="visibility-label">{{ row.label }}</text>
          <button class="btn-secondary" :disabled="busy" role="switch" :aria-checked="card.visibility[row.key]" @click="toggleField(row.key)">{{ card.visibility[row.key] ? '公开' : '隐藏' }}</button>
        </view>
      </view>

      <view class="card editor-card">
        <view class="editor-head" @click="showEditor = !showEditor">
          <text class="editor-title">编辑名片资料</text>
          <text class="editor-chev">{{ showEditor ? '−' : '+' }}</text>
        </view>

        <template v-if="showEditor">
          <label class="field" for="nickname">昵称（最多 40 字符）</label>
          <input id="nickname" v-model="form.nickname" aria-label="昵称" :maxlength="40" :disabled="busy" placeholder="可留空" />

          <text class="field">名片类型：{{ form.type_code || '未选择' }}</text>
          <view class="type-grid">
            <button v-for="item in types" :key="item.type_code" :class="form.type_code === item.type_code ? 'btn-primary' : 'btn-secondary'" :disabled="busy" :aria-pressed="form.type_code === item.type_code" @click="form.type_code = item.type_code">{{ item.type_code }}</button>
          </view>
          <text v-if="typesError" class="error">{{ typesError }}</text>
          <text class="notice">主动保存类型只更新名片，不修改历史结果；新测评不会覆盖已保存的名片类型。</text>

          <label class="field" for="declaration">自我介绍（最多 160 字符）</label>
          <textarea id="declaration" v-model="form.declaration" aria-label="自我介绍" :maxlength="160" :disabled="busy" placeholder="可留空" />

          <label class="field" for="interests">兴趣（用逗号分隔，最多 10 项，每项最多 24 字符）</label>
          <input id="interests" v-model="form.interests" aria-label="兴趣" :maxlength="-1" :disabled="busy" placeholder="例如：阅读，散步" />

          <text class="field">名片风格</text>
          <view class="row">
            <button v-for="item in styles" :key="item.value" :class="form.style === item.value ? 'btn-primary' : 'btn-secondary'" :disabled="busy" @click="form.style = item.value">{{ item.label }}</button>
          </view>

          <view class="btn-primary mt" :class="{ disabled: busy || loading }" @click="save">保存名片资料</view>
          <text v-if="success" class="success" role="status">{{ success }}</text>
        </template>
      </view>

      <text v-if="!card.has_visual_set && !unlockTier" class="fine">当前还没有已交付的视觉套装，升级后可制作成主角图。</text>

      <view class="minor-links">
        <text class="minor" @click="load">重新读取名片</text>
        <text class="minor" @click="goTab('/pages/discover/discover')">去换名片</text>
        <text class="minor" @click="go('/pages/buddies/blocked')">屏蔽管理</text>
      </view>

      <text class="foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyCard, updateMyCard, type UpdateCardBody } from '@/api/cards'
import { listResults } from '@/api/results'
import { getMyEntitlements, type Entitlement } from '@/api/payment'
import { saveStudio, studio } from '@/store/studio'
import { listTypes } from '@/api/types-api'
import type { TypeMeta } from '@/api/types'
import type { CardStyle, CardVisibility, MyCard } from '@/api/types-social'
import { TYPE_NAMES, DECLARATIONS } from '@/constants/types'
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
const entitlements = ref<Entitlement[]>([])
const form = reactive({ nickname: '', type_code: '', declaration: '', interests: '', style: 'illustration' as CardStyle })
const styles: { value: CardStyle; label: string }[] = [{ value: 'illustration', label: '插画' }, { value: 'editorial', label: '杂志' }, { value: 'game', label: '游戏' }]
const visibilityRows: { key: keyof CardVisibility; label: string }[] = [
  { key: 'name', label: '昵称' }, { key: 'interests', label: '兴趣' }, { key: 'declaration', label: '自我介绍' }, { key: 'manual', label: '相处说明' },
]

const typeName = computed(() => TYPE_NAMES[card.value?.type_code || ''] || 'MBTI')
const declarationText = computed(
  () => DECLARATIONS[card.value?.type_code || ''] || '四个字母之外，还有不一样的我。',
)
/** 付费态只认服务端权益：有 studio_tier_2 优先，其次 studio_tier_1 */
const unlockTier = computed<0 | 1 | 2>(() => {
  const codes = entitlements.value.map((item) => item.product_code)
  if (codes.includes('studio_tier_2')) return 2
  if (codes.includes('studio_tier_1')) return 1
  return 0
})

onShow(load)
async function load() {
  if (loading.value || busy.value) return
  loading.value = true; card.value = null; error.value = ''; success.value = ''; typesError.value = ''
  await Promise.all([
    getMyCard().then(async (data) => {
      card.value = data
      resetForm(data)
      latestType.value = ''
      if (!data.type_code) {
        try {
          const res = await listResults({ limit: 1 })
          latestType.value = res.items[0]?.type_code || ''
          if (latestType.value) form.type_code = latestType.value
        } catch { latestType.value = '' }
      }
    }).catch((e) => { error.value = socialErrorMessage(e, '本人名片读取失败，请重试') }),
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
function goTest() { uni.navigateTo({ url: '/pages/test-intro/test-intro' }) }
function goSelfSelect() { uni.navigateTo({ url: '/pages/self-select/self-select' }) }
function goCreate() { uni.navigateTo({ url: '/pages/create/create' }) }
function goHistory() { uni.switchTab({ url: '/pages/history/list' }) }
function goUpgrade() {
  const id = card.value?.latest_result_id
  uni.navigateTo({ url: `/pages/pricing/pricing${id ? `?result_id=${encodeURIComponent(id)}` : ''}` })
}
function go(url: string) { uni.navigateTo({ url }) }
function goTab(url: string) { uni.switchTab({ url }) }
</script>

<style scoped lang="scss">
@import '@/styles/social.scss';

.card-page {
  padding-bottom: 56rpx;
}


.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #7560df;
  font-weight: 600;
}
.big-title {
  display: block;
  margin-top: 16rpx;
  font-size: 56rpx;
  font-weight: 800;
  line-height: 1.3;
  color: #241f2e;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.7;
}

.big-btn {
  margin-top: 24rpx;
  padding: 30rpx 40rpx;
  font-size: 32rpx;
  font-weight: 700;
}
.picker-entry {
  display: block;
  margin-top: 26rpx;
  text-align: center;
  font-size: 22rpx;
  color: #7560df;
}
.latest-hint {
  margin-top: 18rpx;
  padding: 20rpx 22rpx;
  border-radius: 18rpx;
  background: #f1ecfb;
  font-size: 21rpx;
  color: #5b47a8;
}

.namecard {
  margin-top: 30rpx;
  padding: 34rpx 30rpx 26rpx;
  border-radius: 28rpx;
  background: linear-gradient(160deg, #f4efff 0%, #efe8ff 60%, #f7f2ff 100%);
  border: 2rpx solid #e6ddf8;
}
.nc-label {
  display: block;
  font-size: 19rpx;
  letter-spacing: 2rpx;
  color: #8b78b3;
}
.nc-type {
  display: block;
  margin-top: 18rpx;
  font-size: 96rpx;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 2rpx;
  color: #7560df;
}
.nc-name {
  display: block;
  margin-top: 18rpx;
  font-size: 32rpx;
  font-weight: 800;
  color: #241f2e;
}
.nc-decl {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #6f6880;
  line-height: 1.7;
}
.nc-foot {
  display: block;
  margin-top: 32rpx;
  padding-top: 20rpx;
  border-top: 2rpx solid rgba(117, 96, 223, 0.12);
  font-size: 19rpx;
  color: #a398af;
}

.journey-link {
  display: block;
  margin-top: 22rpx;
  font-size: 23rpx;
  color: #7560df;
}

.quick-row {
  display: flex;
  gap: 14rpx;
  margin-top: 22rpx;
}
.quick {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  padding: 22rpx 8rpx;
  border-radius: 20rpx;
  background: #fff;
  border: 2rpx solid #ede8f4;
}
.quick-icon {
  font-size: 26rpx;
  color: #7560df;
}
.quick-text {
  font-size: 23rpx;
  color: #3f3552;
}

.upgrade {
  margin-top: 24rpx;
  padding: 30rpx 26rpx;
  border-radius: 24rpx;
  background: linear-gradient(120deg, #6c4cf3, #8b6cf6);
  box-shadow: 0 18rpx 36rpx rgba(108, 76, 243, 0.24);
  text-align: center;
}
.upgrade-text {
  font-size: 30rpx;
  font-weight: 800;
  color: #fff;
}

.unlocked {
  margin-top: 24rpx;
  padding: 30rpx 26rpx;
  border-radius: 24rpx;
  background: linear-gradient(150deg, #f6f1ff, #efe8ff 60%, #eef4e4);
  border: 2rpx solid #e3d9f6;
}
.unlocked-head {
  display: flex;
  align-items: center;
  gap: 14rpx;
}
.unlocked-tag {
  font-size: 18rpx;
  color: #5a7a3a;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 999rpx;
  padding: 6rpx 16rpx;
}
.unlocked-tier {
  font-size: 19rpx;
  color: #6d58b2;
}
.unlocked-title {
  display: block;
  margin-top: 16rpx;
  font-size: 32rpx;
  font-weight: 800;
  color: #2c2550;
}
.unlocked-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #6f6880;
  line-height: 1.7;
}

.row-card {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin-top: 16rpx;
  padding: 26rpx 24rpx;
  border-radius: 24rpx;
  background: #fff;
  border: 2rpx solid #ede8f4;
}
.row-icon {
  font-size: 30rpx;
  color: #7560df;
}
.row-body {
  flex: 1;
  min-width: 0;
}
.row-title {
  display: block;
  font-size: 27rpx;
  font-weight: 700;
  color: #241f2e;
}
.row-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #a398af;
}
.row-arrow {
  font-size: 26rpx;
  color: #b9a4da;
}

.settings-card,
.editor-card {
  margin-top: 20rpx;
  padding: 28rpx 24rpx;
}
.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.settings-title {
  font-size: 28rpx;
  font-weight: 800;
  color: #241f2e;
}
.settings-state {
  font-size: 20rpx;
  color: #7560df;
  background: #f1ecfb;
  border-radius: 999rpx;
  padding: 6rpx 16rpx;
}
.settings-desc {
  display: block;
  margin: 14rpx 0 20rpx;
  font-size: 21rpx;
  color: #77727e;
  line-height: 1.7;
}
.visibility {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 14rpx;
}
.visibility-label {
  font-size: 23rpx;
  color: #3f3552;
}
.visibility button {
  width: 180rpx;
  padding: 12rpx 0;
  font-size: 22rpx;
}

.editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.editor-title {
  font-size: 28rpx;
  font-weight: 800;
  color: #241f2e;
}
.editor-chev {
  font-size: 30rpx;
  color: #a398af;
}
.editor-label {
  display: block;
  margin: 18rpx 0 12rpx;
  font-weight: 600;
  font-size: 24rpx;
}

.fine {
  display: block;
  margin-top: 20rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}

.minor-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 28rpx;
  margin-top: 30rpx;
}
.minor {
  font-size: 22rpx;
  color: #7560df;
}

.foot {
  display: block;
  margin-top: 36rpx;
  text-align: center;
  font-size: 19rpx;
  color: #b9b3c4;
}

.disabled {
  opacity: 0.6;
}
</style>
