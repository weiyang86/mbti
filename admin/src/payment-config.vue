<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { configApi } from './config-api'
import {
  checkPaymentChannel, credentialProblem, errorMessage, paymentChannelMeta, paymentChannels, probePaymentChannel, readPaymentConfig, saveSecretValue,
  validatePaymentSettings, type CredentialField, type PaymentCheck, type PaymentChannel, type PaymentProbe, type PaymentProjection, type PaymentSettings,
} from './payment-config'

const props = defineProps<{ canWrite?: boolean }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()

const projection = ref<PaymentProjection | null>(null)
const channel = ref<PaymentChannel>('wechat')
const loading = ref(false), saving = ref(false), publishing = ref(false), checking = ref(false)
const error = ref(''), notice = ref('')
const check = ref<PaymentCheck | null>(null)
const probe = ref<PaymentProbe | null>(null)
const probing = ref(false)
const entered = reactive<Record<CredentialField, string>>({ privateKey: '', apiV3Key: '', platformPublicKey: '', appSecret: '' })

const settings = computed<PaymentSettings | null>(() => projection.value?.draftPayments[channel.value] ?? null)
const baseline = ref('')
const dirty = computed(() => !!settings.value && JSON.stringify(projection.value?.draftPayments) !== baseline.value)
const credentialsPending = computed(() => Object.values(entered).some(value => value.trim().length > 0))
const canSaveDraft = computed(() => props.canWrite !== false && !!projection.value?.draft.authorization.canSaveDraft)
const canPublish = computed(() => !!projection.value?.published.authorization.canPublish)
const diff = computed(() => projection.value?.draft.diff ?? [])
const published = computed(() => projection.value?.publishedPayments[channel.value] ?? null)
const stateLabel = computed(() => {
  if (!settings.value) return '未配置'
  if (!settings.value.enabled) return '已暂停新下单'
  return settings.value.mode === 'live' ? '正式收款' : '模拟模式'
})

function resetEntry() { (Object.keys(entered) as CredentialField[]).forEach(key => { entered[key] = '' }) }
function snapshot() { baseline.value = JSON.stringify(projection.value?.draftPayments ?? {}) }
function syncDirty() { emit('dirty', dirty.value || credentialsPending.value) }
watch([dirty, credentialsPending], syncDirty)

async function load() {
  loading.value = true; error.value = ''; notice.value = ''; check.value = null; probe.value = null
  try {
    const next = await readPaymentConfig()
    projection.value = next
    resetEntry()
    snapshot()
    syncDirty()
  } catch (reason) {
    projection.value = null; error.value = errorMessage(reason)
  } finally { loading.value = false }
}

function switchChannel(next: PaymentChannel) {
  if (next === channel.value) return
  if ((dirty.value || credentialsPending.value) && !window.confirm('当前渠道有未保存输入，切换将丢弃这些输入，继续吗？')) return
  channel.value = next; check.value = null; probe.value = null; notice.value = ''
  resetEntry(); syncDirty()
}

async function save() {
  if (!settings.value || !projection.value || !canSaveDraft.value || saving.value) return
  const issues = validatePaymentSettings(settings.value)
  if (issues.length) { error.value = issues.join(' '); return }
  const credentialIssues = (['privateKey', 'apiV3Key', 'platformPublicKey', 'appSecret'] as CredentialField[])
    .map(field => credentialProblem(field, entered[field]))
    .filter((problem): problem is string => !!problem)
  if (credentialIssues.length) { error.value = credentialIssues.join(' '); return }
  saving.value = true; error.value = ''; notice.value = ''
  try {
    for (const field of ['privateKey', 'apiV3Key', 'platformPublicKey', 'appSecret'] as CredentialField[]) {
      const value = entered[field].trim()
      if (!value) continue
      const ref = await saveSecretValue(channel.value, field, value)
      const target = settings.value
      if (field === 'privateKey') target.privateKeyRef = ref
      if (field === 'apiV3Key') target.apiV3KeyRef = ref
      if (field === 'platformPublicKey') target.platformPublicKeyRef = ref
      if (field === 'appSecret') target.appSecretRef = ref
    }
    const saved = await configApi.save('payments', projection.value.draftPayments, projection.value.draft.expectedDraftVersion)
    resetEntry(); snapshot(); syncDirty()
    await load()
    notice.value = `支付参数草稿已保存 · 修订 ${saved.expectedDraftVersion}；发布后新订单使用新参数。`
  } catch (reason) { error.value = errorMessage(reason) }
  finally { saving.value = false }
}

async function publish() {
  if (!projection.value || !canPublish.value || publishing.value) return
  if (dirty.value || credentialsPending.value) { error.value = '请先保存当前输入，再发布。'; return }
  if (!diff.value.includes('payments')) { error.value = '草稿与已发布版本没有支付参数差异。'; return }
  if (!window.confirm(`发布支付参数到版本 ${projection.value.published.expectedVersion + 1}？新订单立即使用新配置。`)) return
  publishing.value = true; error.value = ''; notice.value = ''
  try {
    const result = await configApi.publish(projection.value.published.expectedVersion, projection.value.draft.expectedDraftVersion)
    notice.value = `已发布版本 ${result.version} · 审计 ${result.auditLogId}`
    await load()
    notice.value = `已发布版本 ${result.version}；新订单将使用新的支付参数。`
  } catch (reason) { error.value = errorMessage(reason) }
  finally { publishing.value = false }
}

async function runCheck() {
  if (!settings.value || checking.value) return
  const issues = validatePaymentSettings(settings.value)
  if (issues.length) { error.value = issues.join(' '); check.value = null; return }
  if (dirty.value || credentialsPending.value) { error.value = '检查针对服务端草稿，请先保存当前输入。'; return }
  checking.value = true; error.value = ''; check.value = null
  try { check.value = await checkPaymentChannel(channel.value) }
  catch (reason) { error.value = errorMessage(reason) }
  finally { checking.value = false }
}

/** Real WeChat Pay request; proves the merchant certificate and signature are accepted. */
async function runProbe() {
  if (!settings.value || probing.value) return
  if (dirty.value || credentialsPending.value) { error.value = '验证针对服务端草稿，请先保存当前输入。'; return }
  probing.value = true; error.value = ''; probe.value = null
  try { probe.value = await probePaymentChannel(channel.value) }
  catch (reason) { error.value = errorMessage(reason) }
  finally { probing.value = false }
}

onMounted(load)
</script>

<template>
  <section class="panel payment-config" aria-label="支付参数配置">
    <div class="config-card-head">
      <div>
        <p class="eyebrow">SERVER / WECHAT PAY</p>
        <h2>微信支付参数</h2>
        <p>小程序与公众号分别配置；保存草稿并发布后，新订单支付立即使用这里的商户参数。</p>
      </div>
      <div class="payment-state"><span class="config-chip" :class="{ inactive: stateLabel !== '正式收款' }">{{ stateLabel }}</span><button class="outline-button" :disabled="loading || saving" @click="load">{{ loading ? '正在读取…' : '重新读取' }}</button></div>
    </div>

    <div class="payment-tabs" role="group" aria-label="选择支付渠道">
      <button v-for="key in paymentChannels" :key="key" type="button" :aria-pressed="channel === key" :disabled="saving || publishing"
        @click="switchChannel(key)"><b>{{ paymentChannelMeta[key].label }}</b><small>{{ paymentChannelMeta[key].rail }}</small></button>
    </div>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-if="notice" class="payment-notice" role="status">{{ notice }}</p>
    <div v-if="loading && !projection" class="config-unavailable">正在读取支付参数…</div>
    <div v-else-if="!projection" class="config-unavailable">支付配置暂不可用；没有使用本机缓存或演示值。</div>

    <template v-else-if="settings">
      <p class="payment-versions">已发布 v{{ projection.published.expectedVersion }} · 草稿修订 {{ projection.draft.expectedDraftVersion }} · 服务端差异：{{ diff.length ? diff.join('、') : '无差异' }}</p>

      <div class="payment-grid">
        <section class="payment-group">
          <h3>收银入口</h3>
          <label class="payment-check"><input v-model="settings.enabled" type="checkbox" :disabled="saving || !canSaveDraft">允许本渠道新下单</label>
          <div class="payment-fields">
            <label>交易环境<select v-model="settings.mode" :disabled="saving || !canSaveDraft"><option value="mock">模拟 · 不扣款</option><option value="live">正式收款</option></select><small>只有“正式收款”会调用微信支付。</small></label>
            <label>收款方展示名<input v-model="settings.merchantLabel" maxlength="40" autocomplete="off" :disabled="saving || !canSaveDraft"><small>1–40 字，不使用个人信息。</small></label>
          </div>
        </section>

        <section class="payment-group">
          <h3>商户与回调</h3>
          <div class="payment-fields">
            <label>AppID<input v-model="settings.appId" maxlength="64" placeholder="wx…（18 位）" autocomplete="off" spellcheck="false" :disabled="saving || !canSaveDraft"></label>
            <label>商户号 MchID<input v-model="settings.mchId" maxlength="64" placeholder="6–20 位数字" autocomplete="off" spellcheck="false" :disabled="saving || !canSaveDraft"></label>
            <label>商户证书序列号<input v-model="settings.serialNo" maxlength="64" placeholder="8–64 位十六进制" autocomplete="off" spellcheck="false" :disabled="saving || !canSaveDraft"></label>
            <label>微信支付公钥 ID<input v-model="settings.publicKeyId" maxlength="80" placeholder="PUB_KEY_ID_…（可留空）" autocomplete="off" spellcheck="false" :disabled="saving || !canSaveDraft"></label>
            <label class="wide">支付通知地址（HTTPS）<input v-model="settings.notifyUrl" maxlength="240" placeholder="https://…/api/v1/payments/wechat/notify" autocomplete="off" spellcheck="false" :disabled="saving || !canSaveDraft"></label>
            <label class="wide">退款通知地址（HTTPS，可留空）<input v-model="settings.refundNotifyUrl" maxlength="240" autocomplete="off" spellcheck="false" :disabled="saving || !canSaveDraft"></label>
          </div>
        </section>

        <section class="payment-group wide-group">
          <h3>服务端凭据</h3>
          <p class="payment-note">凭据只写不读；保存后浏览器只显示引用，不会回显密钥内容。</p>
          <div class="payment-fields">
            <label>AppSecret<input v-model="entered.appSecret" type="password" maxlength="8192" autocomplete="new-password" spellcheck="false" :placeholder="settings.appSecretRef ? '留空则沿用已有引用' : '粘贴 AppSecret'" :disabled="saving || !canSaveDraft"><small>{{ settings.appSecretRef ? `已有引用 ${settings.appSecretRef}` : '未配置' }}</small></label>
            <label>商户签名私钥<textarea v-model="entered.privateKey" rows="3" maxlength="16384" autocomplete="off" spellcheck="false" :placeholder="settings.privateKeyRef ? '留空则沿用已有引用' : '粘贴 apiclient_key.pem 全文'" :disabled="saving || !canSaveDraft"></textarea><small>{{ settings.privateKeyRef ? `已有引用 ${settings.privateKeyRef}` : '未配置' }} · 首行应为 BEGIN PRIVATE KEY，整段粘贴</small></label>
            <label>APIv3 密钥<input v-model="entered.apiV3Key" type="password" maxlength="256" autocomplete="new-password" spellcheck="false" :placeholder="settings.apiV3KeyRef ? '留空则沿用已有引用' : '32 位 APIv3 密钥'" :disabled="saving || !canSaveDraft"><small>{{ settings.apiV3KeyRef ? `已有引用 ${settings.apiV3KeyRef}` : '未配置' }}</small></label>
            <label>微信支付验签公钥<textarea v-model="entered.platformPublicKey" rows="3" maxlength="16384" autocomplete="off" spellcheck="false" :placeholder="settings.platformPublicKeyRef ? '留空则沿用已有引用' : '粘贴 pub_key.pem 或平台证书全文'" :disabled="saving || !canSaveDraft"></textarea><small>{{ settings.platformPublicKeyRef ? `已有引用 ${settings.platformPublicKeyRef}` : '未配置' }} · 首行应为 BEGIN PUBLIC KEY 或 BEGIN CERTIFICATE</small></label>
          </div>
        </section>
      </div>

      <div v-if="check" class="payment-check-result" :class="{ ready: check.ready }" role="status">
        <b>{{ check.ready ? '参数检查通过' : '参数检查未通过' }} · {{ check.label }}</b>
        <ul v-if="check.problems.length"><li v-for="problem in check.problems" :key="problem">{{ problem }}</li></ul>
        <p v-else>字段与凭据均可解析；未向微信发起真实下单。</p>
      </div>

      <div v-if="probe" class="payment-check-result" :class="{ ready: probe.ok }" role="status">
        <b>{{ probe.ok ? '微信商户验证通过' : '微信商户验证未通过' }} · {{ probe.label }}<template v-if="probe.status"> · HTTP {{ probe.status }}</template></b>
        <p>{{ probe.message }}</p>
        <p v-if="probe.hint">建议：{{ probe.hint }}</p>
        <p v-if="probe.ok">签名、证书序列号与商户号已被微信支付接受；这只是连通性验证，没有创建订单、没有扣款。</p>
      </div>

      <div class="config-actions">
        <button type="button" class="primary" :disabled="saving || !canSaveDraft || (!dirty && !credentialsPending)" @click="save">{{ saving ? '正在保存…' : '保存支付草稿' }}</button>
        <button v-if="canPublish" type="button" class="primary" :disabled="saving || publishing || dirty || credentialsPending || !diff.includes('payments')" @click="publish">{{ publishing ? '正在发布…' : '发布支付参数' }}</button>
        <button type="button" class="outline-button" :disabled="checking || saving || dirty || credentialsPending" @click="runCheck">{{ checking ? '正在检查…' : '检查参数（本机+凭据）' }}</button>
        <button type="button" class="outline-button" :disabled="probing || saving || dirty || credentialsPending" @click="runProbe">{{ probing ? '正在连接微信…' : '连接微信验证商户' }}</button>
      </div>
      <p v-if="!canSaveDraft" class="payment-note">当前账号缺少系统写权限，只能查看。</p>
      <p v-else-if="!canPublish" class="payment-note">发布需要平台超级管理员与 admin.secret.manage 权限。</p>
      <p v-if="published" class="payment-note">线上当前：{{ published.enabled ? (published.mode === 'live' ? '正式收款' : '模拟') : '已暂停' }} · AppID {{ published.appId || '未配置' }} · MchID {{ published.mchId || '未配置' }}</p>
    </template>
  </section>
</template>

<style scoped>
.payment-config { margin-bottom: 18px; }
.payment-state { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.payment-tabs { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
.payment-tabs button { display: grid; gap: 3px; padding: 10px 16px; border: 1px solid var(--stroke, #dcd9e5); border-radius: 9px; background: #fff; color: var(--muted, #6b6678); text-align: left; font: inherit; }
.payment-tabs button[aria-pressed='true'] { border-color: #6554d4; color: #6554d4; background: #f5f3fb; }
.payment-tabs small { font-size: 10px; color: inherit; opacity: .72; }
.payment-versions { font-size: 12px; color: var(--muted, #6b6678); margin: 4px 0 14px; }
.payment-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.payment-group { border: 1px solid #e2e8f0; border-radius: 8px; background: #fbfcfe; padding: 14px 16px; min-width: 0; }
.payment-group.wide-group { grid-column: 1 / -1; }
.payment-group h3 { margin: 0 0 10px; font-size: 13px; color: #334155; }
.payment-check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #334155; margin-bottom: 12px; }
.payment-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.payment-fields label { display: grid; gap: 6px; font-size: 12px; color: #334155; min-width: 0; }
.payment-fields label.wide { grid-column: 1 / -1; }
.payment-fields input:not([type='checkbox']), .payment-fields select { width: 100%; box-sizing: border-box; padding: 7px 9px; font: 13px/1.5 inherit; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; }
.payment-fields textarea { width: 100%; box-sizing: border-box; padding: 7px 9px; font: 12px/1.6 ui-monospace, Consolas, monospace; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; resize: vertical; }
.payment-fields textarea:disabled { background: #f4f5f8; color: #7d8592; }
.payment-fields input:disabled, .payment-fields select:disabled { background: #f4f5f8; color: #7d8592; }
.payment-fields small { font-size: 10px; color: #7d8592; overflow-wrap: anywhere; }
.payment-note { font-size: 11px; line-height: 1.8; color: var(--muted, #6b6678); margin: 8px 0 0; }
.payment-notice { padding: 10px 12px; border-radius: 8px; background: #eef8f1; color: #2f6b45; font-size: 12px; line-height: 1.7; }
.payment-check-result { margin-top: 14px; padding: 12px 14px; border: 1px solid #f0c9c9; border-radius: 8px; background: #fdf3f3; color: #8a3b3b; font-size: 12px; }
.payment-check-result.ready { border-color: #c6e5d1; background: #eef8f1; color: #2f6b45; }
.payment-check-result ul { margin: 8px 0 0; padding-left: 18px; }
.payment-check-result p { margin: 6px 0 0; }
@media (max-width: 900px) { .payment-grid { grid-template-columns: 1fr; } .payment-fields { grid-template-columns: 1fr; } }
</style>
