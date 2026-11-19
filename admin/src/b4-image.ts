import { makeGateway } from '../vendor/mbti-image-kit/core.mjs'

export type Recipe = 'portrait' | 'balanced' | 'style'
export type ImageMode = 'offline' | 'real'
export type ImagePair = { portrait: string; style: string; consent: boolean; mode: ImageMode; recipe: Recipe }
export type CallRecord = { source: 'admin-local'; mode: 'offline'; status: 'success' | 'failed'; recipe: Recipe; at: string; durationMs: number; errorCategory: 'none' | 'local_failure' }
const recipes: Recipe[] = ['portrait', 'balanced', 'style']
export const recipeLabel = { portrait: '人物优先', balanced: '均衡融合', style: '风格优先' } as const
export const fixedPrompt = 'Image 1 is the portrait. Image 2 is the style reference. Local color composite sample.'
export function generationBlock(input: ImagePair): string {
  if (!input.consent) return '请先确认图片授权与本地处理同意。'
  if (!input.portrait || !input.style) return '请分别选择图 1 人像与图 2 风格。'
  if (input.mode !== 'offline') return '真实模型 UI_CONTRACT：双图 API、服务端试跑权限和费用/图片保留策略未核验。'
  if (!recipes.includes(input.recipe)) return '请选择有效的本地配方。'
  return ''
}
export function sanitizedRecord(status: CallRecord['status'], recipe: Recipe, durationMs: number): CallRecord {
  return { source: 'admin-local', mode: 'offline', status, recipe: recipes.includes(recipe) ? recipe : 'balanced', at: new Date().toISOString(), durationMs: Math.max(0, Math.round(durationMs)), errorCategory: status === 'success' ? 'none' : 'local_failure' }
}
// Deterministic color transfer plus spatial style mixing; both inputs causally
// affect the output. Only local decoded pixels are accepted here.
export function mixPixels(portrait: Uint8ClampedArray, style: Uint8ClampedArray, recipe: Recipe): Uint8ClampedArray {
  if (!portrait.length || portrait.length !== style.length || portrait.length % 4 || !recipes.includes(recipe)) throw Error('LOCAL_PIXELS')
  const amount = { portrait: .38, balanced: .60, style: .78 }[recipe]
  const mean = (p: Uint8ClampedArray) => [0, 1, 2].map(k => { let sum = 0; for (let i = k; i < p.length; i += 4) sum += p[i]!; return sum / (p.length / 4) })
  const a = mean(portrait), b = mean(style), result = new Uint8ClampedArray(portrait.length)
  for (let i = 0; i < result.length; i += 4) {
    for (let k = 0; k < 3; k++) result[i + k] = portrait[i + k]! * (1 - amount) + (portrait[i + k]! - a[k]! + b[k]!) * amount * .8 + style[i + k]! * amount * .2
    result[i + 3] = 255
  }
  return result
}
function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
function context(c: HTMLCanvasElement) { const x = c.getContext('2d', { willReadFrequently: true }); if (!x) throw Error('LOCAL_CANVAS'); return x }
function cover(x: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const s = Math.max(w / image.width, h / image.height)
  x.drawImage(image, (w - image.width * s) / 2, (h - image.height * s) / 2, image.width * s, image.height * s)
}
export async function localFile(file: File, consent: boolean): Promise<string> {
  if (!consent) throw Error('LOCAL_CONSENT')
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024) throw Error('LOCAL_FILE')
  const bitmap = await createImageBitmap(file)
  try {
    if (Math.min(bitmap.width, bitmap.height) < 240 || Math.max(bitmap.width, bitmap.height) > 8000) throw Error('LOCAL_SIZE')
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height)), w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
    if (Math.min(w, h) < 240) throw Error('LOCAL_SIZE')
    const c = canvas(w, h), x = context(c); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(bitmap, 0, 0, w, h)
    return c.toDataURL('image/jpeg', .85)
  } finally { bitmap.close() }
}
async function decodeLocal(data: string) {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(data)) throw Error('LOCAL_DATA')
  const im = new Image(); im.src = data; await im.decode(); return im
}
export async function composite(portrait: string, style: string, recipe: Recipe): Promise<Uint8Array> {
  const [a, b] = await Promise.all([decodeLocal(portrait), decodeLocal(style)])
  const w = 384, h = 512, ca = canvas(w, h), cb = canvas(w, h), x = context(ca), y = context(cb)
  cover(x, a, w, h); cover(y, b, w, h)
  const px = x.getImageData(0, 0, w, h)
  px.data.set(mixPixels(px.data, y.getImageData(0, 0, w, h).data, recipe)); x.putImageData(px, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => ca.toBlob(v => v ? resolve(v) : reject(Error('LOCAL_ENCODE')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
// Exact offline sample API: runOfflineSample(ImagePair, {fail?, render?}).
// It invokes the unmodified kit core in memory, with an injected, closed adapter.
// The two synthetic URL labels below are NEVER fetched, opened or assigned to img.
// Core requires a nonempty env marker; this is a public mode marker, no credential.
export async function runOfflineSample(input: ImagePair, options: { fail?: boolean; render?: typeof composite } = {}): Promise<string> {
  const block = generationBlock(input)
  if (block) throw Error(block)
  const render = options.render ?? composite
  let pixels: Uint8Array | undefined
  const upstream = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof url !== 'string') throw Error('LOCAL_ADAPTER')
    if (url === 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation' && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body))
      const content = payload.input.messages[0].content
      if (options.fail) throw Error('LOCAL_FAILURE')
      pixels = await render(content[1].image, content[2].image, input.recipe)
      return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ type: 'image', image: 'https://cdn.wanx.aliyuncs.com/offline-sample.png' }] } }] } }))
    }
    if (url === 'https://cdn.wanx.aliyuncs.com/offline-sample.png' && init?.method === 'GET' && pixels) return new Response(pixels as Uint8Array<ArrayBuffer>)
    throw Error('LOCAL_ADAPTER')
  }
  const gateway = makeGateway({ upstream })
  // Browser Request strips a caller-supplied Origin header. Supply only the
  // structural fields the pure core reads, with a local Blob stream: no Request
  // is sent, and none of this is a production authorization or proxy substitute.
  const body = JSON.stringify({ contract: 'mbti-image/v1', requestId: 'offline_sample_0001', model: 'wan2.6-image', adapter: 'wan', images: [{ role: 'portrait', data: input.portrait }, { role: 'style', data: input.style }], prompt: fixedPrompt, size: '960*1280', consent: true, n: 1 })
  const response = await gateway({
    url: 'https://offline.invalid/api/mbti-image/generate', method: 'POST',
    headers: new Headers({ Origin: 'https://offline.invalid', 'Content-Type': 'application/json' }), body: new Blob([body]).stream(),
  }, { DASHSCOPE_API_KEY: 'OFFLINE_MODE_MARKER_NOT_A_CREDENTIAL' }, 'loopback')
  if (!response.ok) throw Error('LOCAL_FAILURE')
  const result = await response.json() as { image?: string }
  if (!result.image?.startsWith('data:image/png;base64,')) throw Error('LOCAL_OUTPUT')
  return result.image
}
