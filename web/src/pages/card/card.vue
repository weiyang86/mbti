<template>
  <view class="page social-page">
    <text class="heading">我的名片</text>
    <text v-if="loading" class="notice">正在读取本人名片…</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <button class="btn-secondary" :disabled="loading || busy" @click="load">重新读取名片</button>
    <template v-if="card">
      <text class="notice">{{ card.discoverable ? '名片已公开并加入发现。' : '名片尚未公开，不会出现在发现中。' }}</text>
      <text v-if="!card.type_code" class="notice">尚未选择类型。请先选择并保存，或返回首页完成测评，再决定是否公开。</text>
      <label class="field" for="nickname">昵称（最多 40 字符）</label>
      <input id="nickname" v-model="form.nickname" aria-label="昵称" :maxlength="40" :disabled="busy" placeholder="可留空" />
      <text class="field">名片类型：{{ form.type_code || '未选择' }}</text>
      <text v-if="typesError" class="error">{{ typesError }}</text>
      <view class="type-grid">
        <button v-for="item in types" :key="item.type_code" :class="form.type_code === item.type_code ? 'btn-primary' : 'btn-secondary'" :disabled="busy" :aria-pressed="form.type_code === item.type_code" @click="form.type_code = item.type_code">{{ item.type_code }}</button>
      </view>
      <text class="notice">主动保存类型只更新名片，不修改历史结果；新测评不会覆盖已保存的名片类型。</text>
      <label class="field" for="declaration">自我介绍（最多 160 字符）</label>
      <textarea id="declaration" v-model="form.declaration" aria-label="自我介绍" :maxlength="160" :disabled="busy" placeholder="可留空" />
      <label class="field" for="interests">兴趣（用逗号分隔，最多 10 项，每项最多 24 字符）</label>
      <input id="interests" v-model="form.interests" aria-label="兴趣" :maxlength="-1" :disabled="busy" placeholder="例如：阅读，散步" />
      <text class="field">名片风格</text>
      <view class="row">
        <button v-for="item in styles" :key="item.value" :class="form.style === item.value ? 'btn-primary' : 'btn-secondary'" :disabled="busy" @click="form.style = item.value">{{ item.label }}</button>
      </view>
      <button class="btn-primary mt" :disabled="busy || loading" @click="save">保存名片资料</button>
      <text v-if="success" class="success" role="status">{{ success }}</text>
      <view class="card">
        <text class="section">公开名片并加入发现</text>
        <text class="notice">开启后类型会公开；昵称、兴趣、自我介绍和相处说明由下面四项控制。关闭后整张名片不可公开直访或发现。</text>
        <button :class="card.discoverable ? 'btn-primary' : 'btn-secondary'" :disabled="busy || (!card.type_code && !card.discoverable)" role="switch" :aria-checked="card.discoverable" @click="setDiscovery">{{ card.discoverable ? '关闭公开与发现' : '开启公开与发现' }}</button>
        <view v-for="row in visibilityRows" :key="row.key" class="mt">
          <text class="line">{{ row.label }}</text>
          <button class="btn-secondary" :disabled="busy" role="switch" :aria-checked="card.visibility[row.key]" @click="toggleField(row.key)">{{ row.label }}：{{ card.visibility[row.key] ? '公开' : '隐藏' }}</button>
        </view>
      </view>
      <button class="btn-secondary mt" :disabled="!card.discoverable || busy" @click="openPublic">查看服务端公开投影</button>
      <text v-if="!card.has_visual_set" class="notice">当前没有已交付的视觉套装。</text>
    </template>
    <button class="btn-secondary mt" @click="go('/pages/discover/discover')">发现搭子</button>
    <button class="btn-secondary mt" @click="go('/pages/exchanges/exchanges')">我的名片夹</button>
    <button class="btn-secondary mt" @click="go('/pages/buddies/blocked')">屏蔽管理</button>
    <text class="notice">名片交换不会授予联系方式。联系方式功能尚未开放。</text>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyCard, updateMyCard, type UpdateCardBody } from '@/api/cards'
import { listTypes } from '@/api/types-api'
import type { TypeMeta } from '@/api/types'
import type { CardStyle, CardVisibility, MyCard } from '@/api/types-social'
import { socialErrorMessage } from '@/utils/social-display'

const card = ref<MyCard | null>(null)
const types = ref<TypeMeta[]>([])
const typesError = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const success = ref('')
const form = reactive({ nickname: '', type_code: '', declaration: '', interests: '', style: 'illustration' as CardStyle })
const styles: { value: CardStyle; label: string }[] = [{ value: 'illustration', label: '插画' }, { value: 'editorial', label: '杂志' }, { value: 'game', label: '游戏' }]
const visibilityRows: { key: keyof CardVisibility; label: string }[] = [
  { key: 'name', label: '昵称' }, { key: 'interests', label: '兴趣' }, { key: 'declaration', label: '自我介绍' }, { key: 'manual', label: '相处说明' },
]
onShow(load)
async function load() {
  if (loading.value || busy.value) return
  loading.value = true; card.value = null; error.value = ''; success.value = ''; typesError.value = ''
  await Promise.all([
    getMyCard().then((data) => { card.value = data; resetForm(data) }).catch((e) => { error.value = socialErrorMessage(e, '本人名片读取失败，请重试') }),
    listTypes().then((data) => { types.value = data.items }).catch((e) => { types.value = []; typesError.value = socialErrorMessage(e, '类型列表读取失败，请重新读取') }),
  ])
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
function toggleField(key: keyof CardVisibility) {
  if (card.value) patch({ visibility: { [key]: !card.value.visibility[key] } })
}
function setDiscovery() { if (card.value) patch({ discoverable: !card.value.discoverable }) }
function openPublic() { if (card.value?.discoverable) go(`/pages/card/public?id=${encodeURIComponent(card.value.id)}`) }
function go(url: string) { uni.navigateTo({ url }) }
</script>

<style scoped lang="scss">@import '@/styles/social.scss';</style>
