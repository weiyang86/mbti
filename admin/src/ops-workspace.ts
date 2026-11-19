// UI vocabulary and prototype definitions only; no inferred server payload/endpoint.
export const channels = [
  { id: 'wechat', label: '微信小程序' },
  { id: 'xhs', label: '小红书小程序' },
  { id: 'douyin', label: '抖音小程序' },
  { id: 'mp', label: '公众号 H5' },
] as const
export type WorkspacePage = 'overview' | 'growth' | 'moderation'
export type Period = '今日' | '近 7 天' | '近 30 天' | '自定义'
const day = 86_400_000

export function shanghaiToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-')
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
function shift(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * day).toISOString().slice(0, 10)
}
export function presetRange(period: Exclude<Period, '自定义'>, today = shanghaiToday()) {
  const days = period === '今日' ? 1 : period === '近 7 天' ? 7 : 30
  return { from: shift(today, 1 - days), to: today }
}
export function dateWindow(from: string, to: string, today = shanghaiToday()) {
  if (!validDate(from) || !validDate(to)) return { error: '请选择有效的开始和结束日期。' } as const
  if (from > to) return { error: '开始日期不能晚于结束日期。' } as const
  if (to > today) return { error: '结束日期不能晚于北京时间今天。' } as const
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day + 1
  return { from, to, days, previousFrom: shift(from, -days), previousTo: shift(from, -1), error: '' } as const
}

// These explain the original prototype, with actual source gaps. They are not KPI values.
export const definitions = [
  { title: '日期、渠道与周期对比', detail: '北京时间自然日，起止日均含；比较紧邻的前一等长周期。今日尚未结束；实际数据截止时间须由服务端返回。四渠道为原型枚举，现存 MBTI 业务表没有获客渠道字段，不能用支付 provider 代替渠道。' },
  { title: '净实收 / 支付订单', detail: '原型按订单归属日选取成功支付订单：支付总额（gross）减去该批订单截至统计时点的累计成功退款（net）；退款单保留在支付订单数内，不代表利润。现有 /orders/summary 只返回创建日（UTC）pending/paid/failed 与已支付毛额，净实收恒为 null（refundsUnavailable）。币种隔离、真实/测试隔离及退款事实映射待确认，退款申请不等于已退金额。' },
  { title: '访问人次（日内去重）', detail: '同渠道同北京时间日去重，再按日/渠道相加，不代表周期去重用户。缺访问事件、稳定去重键和渠道归因，不能用 guest 数或 session 数代替访问。' },
  { title: '测试完成率 / 测评完成', detail: '同一批开始测试的人次中完成 12 题者 ÷ 开始人次；按开始日期归组，排除自选类型，分母为零显示 —。现存 QuizSession 与关联 Result 可作为候选事实；人次去重、跨日完成截止和渠道仍待确认。' },
  { title: '成图预览 / 预览后 7 日付费率', detail: '按用户首看预览归组，以首看满 7 天之日归入筛选周期；分子为该批用户在随后 7 天内成功付费人数，分母为观察满 7 天的首看人数。未成熟样本剔除，分母为零显示 —。缺首看事件、用户去重键、支付关联和成熟队列，生成 ShareAsset 不能当作已看预览。' },
  { title: '传播行为 / 可归因新访客', detail: '保存成图、调用分享、回流新客为三项独立事件，不能视作连续漏斗。回流按首次可归因新访问计，排除自点和重复首次归因；渠道取该次有效归因。缺持久化事件、首次触达/去重和归因窗口，不能用图片生成或资源 GET 代替。' },
  { title: '渠道收入构成 / 热门视觉模板', detail: '渠道占比 = 该渠道净实收 ÷ 所选渠道净实收合计；零分母显示 —。模板按周期内有效交付数排序，使用交付时模板快照；有效交付须排除退款。Entitlement 仅表示权益，不证明素材交付；缺模板快照与交付事实。' },
  { title: '互换申请 / 名片同意率', detail: '互换申请按创建日期归组；名片同意率 = 同批同意申请 ÷ 申请数，分母为零显示 —。MbtiCardExchange 有创建/响应时间及可撤销的当前状态；曾同意后撤销不可从当前状态完整复算，响应截止、历史事实和渠道待确认。' },
  { title: '联系授权完成率', detail: '同批联系请求中完成授权数 ÷ 联系请求数，按请求创建日期归组，零分母显示 —。当前 accepted 还受互换撤销、拉黑和联系方式 epoch 有效性约束，不能只数 accepted。缺历史完成事实、观察截止及渠道；不读取联系方式值或申请渠道。' },
  { title: '举报队列 / 运营待办', detail: '待处理举报与运营待办为全部日期的当前积压，不受上方指标日期/渠道筛选影响。当前无匿名举报工单、处置记录、素材任务队列或配置差异服务；未连接显示 —，不把未知显示成零。' },
] as const
