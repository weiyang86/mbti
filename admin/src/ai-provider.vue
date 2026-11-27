<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  errorMessage, providerLabel, readProviders, readService, saveApiKey, saveService,
  type AiProviderCode, type AiProviderEntry, type ExternalServiceView,
} from './ai-provider'

const props = defineProps<{ canWrite: boolean }>()
const providers = ref<AiProviderEntry[]>([])
const selected = ref<AiProviderCode>('deepseek')
const service = ref<ExternalServiceView | null>(null)
const baseUrl = ref('')
const model = ref('')
const apiKey = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
let epoch = 0

const statusLabel = computed(() => service.value?.configurationStatus === 'credentials_ready' ? '引用已就绪'
  : service.value?.configurationStatus === 'draft' ? '草稿' : '待配置')
const missingLabel = computed(() => {
  if (!service.value) return ''
  return service.value.missingFields.map(key => {
    const field = providers.value.find(p => p.code === selected.value)?.fields.find(f => f.key === key)
    if (field) return field.label
    return key === 'apiKey' ? 'API Key' : key
  }).join('、')
})
const canSave = computed(() => props.canWrite && !!service.value && !saving.value && !loading.value)

async function load() {
  const token = ++epoch
  loading.value = true
  error.value = ''
  try {
    if (!providers.value.length) providers.value = await readProviders()
    const view = await readService(selected.value)
    if (token !== epoch) return
    service.value = view
    baseUrl.value = view.fields.baseUrl ?? ''
    model.value = view.fields.model ?? ''
    apiKey.value = ''
  } catch (reason) {
    if (token !== epoch) return
    service.value = null
    error.value = errorMessage(reason)
  } finally {
    if (token === epoch) loading.value = false
  }
}

async function save() {
  if (!canSave.value || !service.value) return
  error.value = ''
  notice.value = ''
  const url = baseUrl.value.trim()
  const name = model.value.trim()
  const key = apiKey.value.trim()
  if (!/^https:\/\/[^\s]+$/i.test(url)) { error.value = 'Base URL 必须是 HTTPS 地址。'; return }
  if (!name) { error.value = '请填写模型 ID。'; return }
  if (key && (key.length < 16 || /\s/.test(key))) { error.value = 'API Key 至少 16 位且不能包含空白。'; return }
  saving.value = true
  try {
    let secretRef: string | undefined
    if (key) secretRef = (await saveApiKey(selected.value, key)).ref
    const view = await saveService(selected.value, service.value.version, url, name, secretRef)
    service.value = view
    baseUrl.value = view.fields.baseUrl ?? url
    model.value = view.fields.model ?? name
    apiKey.value = ''
    notice.value = view.configurationStatus === 'credentials_ready'
      ? '已保存：Base URL、模型与 API Key 引用均已就绪。真实调用仍需接入生成链路。'
      : `已保存草稿；仍有缺项：${view.missingFields.join('、') || '未知'}。`
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    saving.value = false
  }
}

watch(selected, () => {
  service.value = null
  baseUrl.value = ''
  model.value = ''
  apiKey.value = ''
  notice.value = ''
  void load()
})
onMounted(load)
onBeforeUnmount(() => { epoch++ })
</script>

<template>
  <section class="panel config-card ai-provider" aria-label="AI 模型接入">
    <div class="config-card-head">
      <div>
        <p class="eyebrow">SERVER / AI MODEL</p>
        <h2>AI 模型接入</h2>
        <p>填写供应商 Base URL、模型 ID 和 API Key。密钥只写不读，保存后不会回显。</p>
      </div>
      <span class="config-chip" :class="{ inactive: statusLabel !== '引用已就绪' }">{{ statusLabel }}</span>
    </div>

    <div class="ai-provider-tabs" role="group" aria-label="选择模型供应商">
      <button v-for="item in providers" :key="item.code" type="button" :aria-pressed="selected === item.code"
        :disabled="saving" @click="selected = item.code">{{ item.label }}</button>
    </div>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-if="notice" class="ai-notice" role="status">{{ notice }}</p>
    <div v-if="loading" class="config-unavailable">正在读取 {{ providerLabel(selected) }} 配置…</div>

    <template v-else-if="service">
      <div class="ai-fields">
        <label>API Base URL
          <input v-model="baseUrl" type="url" maxlength="512" placeholder="https://api.deepseek.com"
            autocomplete="off" spellcheck="false" :disabled="saving || !canWrite">
        </label>
        <label>模型 ID
          <input v-model="model" type="text" maxlength="128" placeholder="deepseek-chat"
            autocomplete="off" spellcheck="false" :disabled="saving || !canWrite">
        </label>
        <label class="wide">API Key
          <input v-model="apiKey" type="password" maxlength="8192" autocomplete="new-password" spellcheck="false"
            :placeholder="service.credentialStates.apiKey ? '已配置；留空保留原 Key' : '粘贴 API Key（至少 16 位）'"
            :disabled="saving || !canWrite">
        </label>
      </div>
      <p class="ai-provider-status">版本 {{ service.version }} · 缺项：{{ missingLabel || '无' }} · 真实生成调用：未启用</p>
      <p class="ai-provider-note">保存需要 admin.config.manage 与 admin.secret.manage；密钥由服务端加密存储，浏览器不会读回。</p>
      <div class="config-actions">
        <button type="button" class="primary" :disabled="!canSave" @click="save">{{ saving ? '正在保存…' : '保存 AI 模型参数' }}</button>
        <button type="button" class="outline-button" :disabled="loading || saving" @click="load()">重新读取</button>
      </div>
      <p v-if="!canWrite" class="ai-provider-note">当前账号缺少系统写权限，只能查看。</p>
    </template>

    <div v-else class="config-unavailable">AI 配置暂不可用。</div>
  </section>
</template>

<style scoped>
.ai-provider { margin-bottom: 18px; }
.ai-provider-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.ai-provider-tabs button { padding: 8px 16px; border: 1px solid var(--stroke); border-radius: 8px; background: #fff; color: var(--muted); font-size: 12px; }
.ai-provider-tabs button[aria-pressed='true'] { border-color: #6554d4; color: #6554d4; background: #f5f3fb; font-weight: 600; }
.ai-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 16px 0; }
.ai-fields label { display: grid; gap: 7px; font-size: 11px; font-weight: 600; color: #535064; min-width: 0; }
.ai-fields label.wide { grid-column: 1 / -1; }
.ai-fields input { min-width: 0; padding: 9px 10px; border: 1px solid #dcd9e5; border-radius: 7px; background: #fff; color: var(--ink); font: inherit; font-size: 12px; }
.ai-fields input:disabled { background: #f7f6fa; color: #817b8e; }
.ai-provider-status, .ai-provider-note { font-size: 11px; line-height: 1.8; color: var(--muted); margin: 8px 0 0; }
.ai-notice { padding: 10px 12px; border-radius: 8px; background: #eef8f1; color: #2f6b45; font-size: 11px; line-height: 1.8; }
@media (max-width: 760px) { .ai-fields { grid-template-columns: 1fr; } }
</style>
