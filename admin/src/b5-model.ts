/** Local presentation models, never a config payload or an order/entitlement model. */
export const channelKeys = ['wechat', 'mp', 'douyin', 'xhs'] as const
export type PaymentChannel = typeof channelKeys[number]
export const channels = {
  wechat: { title: '微信小程序', rail: '微信支付 · 小程序', mark: '微', wx: true, references: ['商户签名私钥引用', 'APIv3 密钥引用', '微信支付验签公钥引用'] },
  mp: { title: '微信公众号', rail: '微信内网页 · JSAPI', mark: '公', wx: true, references: ['商户签名私钥引用', 'APIv3 密钥引用', '微信支付验签公钥引用'] },
  douyin: { title: '抖音小程序', rail: '抖音开放平台 · 交易系统', mark: '抖', wx: false, references: ['开发者签名私钥引用', '平台回调验签凭据引用'] },
  xhs: { title: '小红书小程序', rail: '小红书开放平台 · 交易组件', mark: '红', wx: false, references: ['应用凭据引用', '回调验签凭据引用'] },
} as const
export const sizes = ['960*1280', '1024*1024', '720*1280'] as const
export const fixedInstruction = '图1仅作人物参考，图2仅作画风参考；生成一张主视觉，不添加文字。可使用 {mbti} 与 {style} 占位符。'
export function initialAI() { return { mode: 'mock', size: '960*1280', timeout: 90 } }
export function initialPayment() { return { enabled: true, mode: 'mock', merchantLabel: 'MBTI搭子体验店' } }
export function initialTrade() { return { ttl: 30, redeem: true, selfRefund: 'self', refundDays: 7 } }
export function validateAI(value: ReturnType<typeof initialAI>): string[] {
  const issues: string[] = []
  if (!['mock', 'gateway'].includes(value.mode)) issues.push('请选择本机演示或真实网关预案。')
  if (!sizes.includes(value.size as typeof sizes[number])) issues.push('请选择原型支持的输出画幅。')
  if (!Number.isInteger(value.timeout) || value.timeout < 20 || value.timeout > 180) issues.push('最长等待须为 20–180 秒的整数。')
  return issues
}
export function validatePayment(value: ReturnType<typeof initialPayment>): string[] {
  const issues: string[] = []
  if (typeof value.enabled !== 'boolean' || !['mock', 'live'].includes(value.mode)) issues.push('请核对渠道开关和交易环境。')
  if (!['MBTI搭子体验店', '品牌展示样例'].includes(value.merchantLabel)) issues.push('当前仅允许无个人信息的展示名样例。')
  return issues
}
export function validateTrade(value: ReturnType<typeof initialTrade>): string[] {
  const issues: string[] = []
  if (!Number.isInteger(value.ttl) || value.ttl < 1 || value.ttl > 120) issues.push('付款时限须为 1–120 分钟的整数。')
  if (!Number.isInteger(value.refundDays) || value.refundDays < 1 || value.refundDays > 30) issues.push('自助售后期限须为 1–30 天的整数。')
  if (typeof value.redeem !== 'boolean' || !['self', 'support'].includes(value.selfRefund)) issues.push('请选择有效的兑换开关和售后方式。')
  return issues
}
export type Scenario = 'paid' | 'dup' | 'amount' | 'sign'
export const scenarios: ReadonlyArray<{ value: Scenario; label: string }> = [
  { value: 'paid', label: '支付成功' }, { value: 'dup', label: '重复发送同一通知' },
  { value: 'amount', label: '通知金额少 1 分' }, { value: 'sign', label: '验签失败' },
]
/** Pure isolated decision illustration. No order identifiers, signatures, API or shared state. */
export function simulateCallback(scenario: Scenario): { steps: string[]; illustratedGrants: number } {
  if (!scenarios.some(item => item.value === scenario)) throw Error('未知演练场景。')
  // Fixed, noncommercial condition values. Each invocation owns its own counter.
  const expectedCents = 100, receivedCents = scenario === 'amount' ? 99 : 100
  const verified = scenario !== 'sign', steps: string[] = []
  let accepted = false, illustratedGrants = 0
  for (let i = 0; i < (scenario === 'dup' ? 2 : 1); i++) {
    if (!verified) steps.push('样例验签条件为失败 · 拒绝；没有执行真实验签')
    else if (receivedCents !== expectedCents) steps.push('样例金额不一致（少 1 分）· 拒绝')
    else if (accepted) steps.push('相同样例再次输入 · 忽略重复，累计仍为 1')
    else { accepted = true; illustratedGrants++; steps.push('样例判断通过 · 计数 1') }
  }
  return { steps, illustratedGrants }
}
export function changed(left: object, right: object): boolean { return JSON.stringify(left) !== JSON.stringify(right) }
export function localDifferences(left: object, right: object): { field: string; before: string; after: string }[] {
  const baseline = left as Record<string, unknown>, candidate = right as Record<string, unknown>
  return Object.keys(baseline).filter(key => baseline[key] !== candidate[key]).map(key => ({ field: key, before: String(baseline[key]), after: String(candidate[key]) }))
}
