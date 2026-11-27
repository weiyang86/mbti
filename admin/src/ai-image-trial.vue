<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { localFile } from './b4-image'
import { generateAiImage, imageTrialError, type ImageSize } from './ai-image'

const props = defineProps<{ canWrite: boolean }>()
const consent = ref(false)
const portrait = ref('')
const style = ref('')
const prompt = ref('参考第一张人像的构图和人物，融合第二张图片的色彩与质感，生成一张干净的人物主视觉。不要添加文字。')
const size = ref<ImageSize>('960*1280')
const sizes: { value: ImageSize; label: string }[] = [
  { value: '960*1280', label: '3:4 · 960×1280' },
  { value: '1024*1024', label: '1:1 · 1024×1024' },
  { value: '720*1280', label: '9:16 · 720×1280' },
]
const busy = ref(false)
const error = ref('')
const notice = ref('')
const result = ref('')
const latency = ref(0)
let active = true

function reset() { result.value = ''; error.value = ''; notice.value = ''; latency.value = 0 }
function authorize(event: Event) {
  consent.value = props.canWrite && (event.target as HTMLInputElement).checked
  if (!consent.value) { portrait.value = ''; style.value = ''; reset() }
}
async function choose(role: 'portrait' | 'style', event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file || !consent.value || !props.canWrite) return
  try {
    const data = await localFile(file, true)
    if (!active) return
    if (role === 'portrait') portrait.value = data; else style.value = data
    reset()
  } catch {
    error.value = '图片读取失败：请选择 8 MB 以内、240–8000 像素的 JPG / PNG / WEBP。'
  }
}
async function run() {
  if (!props.canWrite || busy.value || !consent.value || !portrait.value || !style.value) return
  reset()
  busy.value = true
  const started = performance.now()
  try {
    const response = await generateAiImage({
      requestId: `admin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`,
      portrait: portrait.value, style: style.value, prompt: prompt.value, size: size.value, consent: true,
    })
    if (!active) return
    result.value = response.image
    latency.value = Math.round(performance.now() - started)
    notice.value = '真实模型已返回图片；结果仅在本页展示，未保存、未发布。'
  } catch (reason) {
    if (active) error.value = imageTrialError(reason)
  } finally {
    if (active) busy.value = false
  }
}
onBeforeUnmount(() => { active = false; portrait.value = ''; style.value = ''; result.value = '' })
</script>

<template>
  <section class="panel config-card ai-image-trial" aria-label="真实模型试跑">
    <div class="config-card-head">
      <div>
        <p class="eyebrow">SERVER / IMAGE MODEL</p>
        <h2>真实模型试跑</h2>
        <p>两图会压缩后上传到服务器并发送给阿里云百炼，结果只在本页显示，不保存、不发布。</p>
        <p class="ai-trial-hint">需先在「AI 模型接入」选择阿里云百炼：Base URL 填 <code>https://dashscope.aliyuncs.com</code>，模型填 <code>wan2.6-image</code>，并保存 DashScope API Key。DeepSeek Key 不能用于图像生成。</p>
      </div>
      <span class="config-chip">管理员试用</span>
    </div>

    <p v-if="!canWrite" class="config-notice">当前账号没有系统写权限，真实模型试跑已禁用。</p>

    <label class="ai-trial-consent">
      <input type="checkbox" :checked="consent" :disabled="!canWrite" aria-label="真实模型上传授权" @change="authorize">
      <span>我确认有权使用这两张图片，并同意本次上传到服务器调用图像模型；结果不自动保存或发布。</span>
    </label>

    <div class="ai-trial-images">
      <article>
        <b>01 / 人像</b>
        <div class="ai-trial-frame"><img v-if="portrait" :src="portrait" alt="待上传的人像图片"><p v-else>先选择人像图片</p></div>
        <input type="file" accept="image/jpeg,image/png,image/webp" :disabled="!canWrite || !consent" aria-label="选择真实模型人像" @change="choose('portrait', $event)">
      </article>
      <article>
        <b>02 / 风格</b>
        <div class="ai-trial-frame"><img v-if="style" :src="style" alt="待上传的风格图片"><p v-else>独立选择风格参考</p></div>
        <input type="file" accept="image/jpeg,image/png,image/webp" :disabled="!canWrite || !consent" aria-label="选择真实模型风格" @change="choose('style', $event)">
      </article>
    </div>

    <div class="ai-trial-fields">
      <label>生成指令<textarea v-model="prompt" rows="3" maxlength="1800" :disabled="busy || !canWrite" spellcheck="false"></textarea></label>
      <label>生成尺寸<select v-model="size" :disabled="busy || !canWrite"><option v-for="item in sizes" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
    </div>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-if="notice" class="ai-trial-notice" role="status">{{ notice }}<span v-if="latency"> · {{ latency }}ms</span></p>

    <div class="config-actions">
      <button type="button" class="primary" :disabled="!canWrite || busy || !consent || !portrait || !style" @click="run">
        {{ busy ? '正在调用真实模型…' : '提交真实模型 · 生成' }}
      </button>
      <button type="button" class="outline-button" :disabled="busy || (!portrait && !style && !result)" @click="portrait = ''; style = ''; result = ''; reset()">清空当前试跑</button>
    </div>

    <figure v-if="result" class="ai-trial-result">
      <img :src="result" alt="真实模型生成结果">
      <figcaption>真实模型输出 · {{ size }} · 未保存到名片或素材库</figcaption>
    </figure>
  </section>
</template>

<style scoped>
.ai-image-trial { margin-bottom: 18px; }
.ai-trial-hint { margin-top: 6px; padding: 10px 12px; background: #fff8e8; border-radius: 8px; color: #7a5b1e; font-size: 10px; line-height: 1.8; }
.ai-trial-consent { display: flex; align-items: flex-start; gap: 9px; margin: 16px 0; padding: 12px; background: #f5f3fb; border-radius: 8px; font-size: 11px; line-height: 1.8; color: #535064; }
.ai-trial-consent input { margin-top: 3px; }
.ai-trial-images { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.ai-trial-images article { min-width: 0; display: grid; gap: 8px; }
.ai-trial-images b { font-size: 12px; color: #535064; }
.ai-trial-frame { height: 200px; display: grid; place-items: center; background: #f0edf7; border-radius: 8px; overflow: hidden; }
.ai-trial-frame img { width: 100%; height: 100%; object-fit: contain; }
.ai-trial-frame p { color: var(--muted); font-size: 11px; }
.ai-trial-images input[type='file'] { font-size: 10px; }
.ai-trial-fields { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; margin-top: 16px; }
.ai-trial-fields label { display: grid; gap: 7px; font-size: 11px; font-weight: 600; color: #535064; }
.ai-trial-fields textarea, .ai-trial-fields select { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #dcd9e5; border-radius: 7px; background: #fff; font: inherit; font-size: 12px; }
.ai-trial-fields textarea { resize: vertical; }
.ai-trial-notice { padding: 10px 12px; border-radius: 8px; background: #eef8f1; color: #2f6b45; font-size: 11px; line-height: 1.8; }
.ai-trial-result { width: min(100%, 360px); margin: 20px auto 0; }
.ai-trial-result img { width: 100%; border-radius: 10px; display: block; }
.ai-trial-result figcaption { color: var(--muted); font-size: 10px; line-height: 1.8; padding: 8px 0; text-align: center; }
@media (max-width: 760px) { .ai-trial-images, .ai-trial-fields { grid-template-columns: 1fr; } }
</style>
