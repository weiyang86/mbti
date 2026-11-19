import { HttpError } from '@/api/client'
import type { RadarParticipation, RadarRadius, SameTypeCount } from '@/api/radar'

type Statistics =
  | { kind: 'idle' | 'loading' | 'not_enrolled' | 'missing_type' | 'unavailable' }
  | { kind: 'error'; message: string }
export function createRadarViewState() {
  return {
    typeCode: '', enrolled: null as boolean | null, radius: 500 as RadarRadius,
    loading: false, saving: false, needsReload: true, error: '', notice: '',
    statistics: { kind: 'idle' } as Statistics,
  }
}
export function hasRadarType(type: string): boolean { return /^[EI][NS][TF][JP]$/.test(type) }
export function radarErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    if (error.status === 401) return '游客会话已失效，请返回首页处理；本次操作未自动重试。'
    if (error.body?.code === 'RADAR_TYPE_REQUIRED') return '请先到我的名片设置本人 MBTI 类型，再重新读取。'
    if (error.body?.code === 'RADAR_TYPE_MISMATCH') return '本人名片类型已变化，请重新读取后再查询。'
    return `${fallback}（HTTP ${error.status}），请重新读取确认。`
  }
  return error instanceof Error && error.message.includes('响应格式') ? error.message : `${fallback}，请重新读取确认。`
}
interface RadarApi {
  getMyCard(): Promise<{ type_code: string }>
  getRadarParticipation(): Promise<RadarParticipation>
  updateRadarParticipation(body: RadarParticipation): Promise<RadarParticipation>
  getSameTypeCount(params: { type_code: string; radius_m: RadarRadius }): Promise<SameTypeCount>
}

// Lifecycle and selection generations fence every asynchronous read. Nothing is persisted here.
export function createRadarController(api: RadarApi, state = createRadarViewState()) {
  let active = false
  let revision = 0
  let countRevision = 0
  const current = (ticket: number) => active && ticket === revision
  const clearStatistics = () => { ++countRevision; state.statistics = { kind: 'idle' } }

  async function refreshStatistics() {
    const ticket = ++countRevision
    if (!active || state.loading || state.saving || state.needsReload) return
    if (!hasRadarType(state.typeCode)) { state.statistics = { kind: 'missing_type' }; return }
    if (!state.enrolled) { state.statistics = { kind: 'not_enrolled' }; return }
    const type = state.typeCode
    const radius = state.radius
    state.statistics = { kind: 'loading' }
    const valid = () => active && ticket === countRevision && state.enrolled === true
      && state.typeCode === type && state.radius === radius && !state.needsReload
    try {
      const result = await api.getSameTypeCount({ type_code: type, radius_m: radius })
      if (!valid()) return
      state.statistics = result.reason === 'location_source_not_configured'
        ? { kind: 'unavailable' }
        : { kind: 'error', message: '参与状态可能已变化，请重新读取确认。' }
    } catch (error) {
      if (valid()) state.statistics = { kind: 'error', message: radarErrorMessage(error, '统计请求失败') }
    }
  }
  async function load() {
    if (!active || state.saving) return
    const ticket = ++revision
    clearStatistics()
    state.loading = true; state.needsReload = true; state.error = ''; state.notice = ''; state.typeCode = ''
    try {
      const [card, participation] = await Promise.all([api.getMyCard(), api.getRadarParticipation()])
      if (!current(ticket)) return
      state.typeCode = hasRadarType(card.type_code) ? card.type_code : ''
      state.enrolled = participation.enrolled
      state.needsReload = false
    } catch (error) {
      if (current(ticket)) state.error = radarErrorMessage(error, '雷达读取失败')
    } finally {
      if (current(ticket)) { state.loading = false; await refreshStatistics() }
    }
  }
  async function save(enrolled: boolean) {
    if (!active || state.saving || state.loading || state.needsReload || state.enrolled === null
      || (enrolled && !hasRadarType(state.typeCode))) return
    const ticket = ++revision
    clearStatistics()
    state.saving = true; state.error = ''; state.notice = ''
    try {
      const result = await api.updateRadarParticipation({ enrolled })
      if (!current(ticket)) return
      state.enrolled = result.enrolled
      state.notice = result.enrolled ? '已保存参与选择。' : '已退出雷达。'
    } catch (error) {
      if (current(ticket)) {
        // A failed/lost PUT response may already have committed. Only GET can reconcile it.
        state.needsReload = true
        state.error = `${radarErrorMessage(error, '参与选择保存失败')} 保留上次确认状态；请先重新读取，再决定是否操作。`
      }
    } finally {
      state.saving = false
      if (active) {
        if (current(ticket)) await refreshStatistics()
        else await load() // A hidden write finished after reentry: reconcile with GET, never replay PUT.
      }
    }
  }
  function setRadius(radius: RadarRadius) {
    if (![500, 1000, 3000].includes(radius) || state.saving || state.loading || state.needsReload) return
    state.radius = radius
    clearStatistics()
    return refreshStatistics()
  }
  return {
    state, load, save, setRadius, refreshStatistics,
    enter() { active = true; ++revision; clearStatistics(); return load() },
    leave() { active = false; ++revision; clearStatistics(); state.loading = false; state.needsReload = true; state.error = ''; state.notice = '' },
  }
}
