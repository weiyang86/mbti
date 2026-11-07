import type { RadarParticipation, SameTypeCount } from '../radar'

const RADAR_KEY = 'mbti_mock_radar_v1'

function loadEnrolled(): boolean {
  try {
    const raw = uni.getStorageSync(RADAR_KEY)
    if (raw && typeof raw === 'object' && typeof raw.enrolled === 'boolean') {
      return raw.enrolled
    }
  } catch {
    /* ignore */
  }
  return false
}

let enrolled = loadEnrolled()

function persist() {
  try {
    uni.setStorageSync(RADAR_KEY, { enrolled })
  } catch {
    /* ignore */
  }
}

/** 与原型一致：不同半径下的虚构同型人数（仅本地演示，不读取 GPS） */
const COUNTS: Record<number, number> = { 500: 18, 1000: 43, 3000: 96 }

export function getRadarParticipation(): Promise<RadarParticipation> {
  return Promise.resolve({ enrolled })
}

export function updateRadarParticipation(body: { enrolled: boolean }): Promise<RadarParticipation> {
  enrolled = Boolean(body.enrolled)
  persist()
  return Promise.resolve({ enrolled })
}

export function getSameTypeCount(params: { radius_m?: number }): Promise<SameTypeCount> {
  if (!enrolled) return Promise.resolve({ count: null })
  const count = COUNTS[params.radius_m || 500] ?? 0
  return Promise.resolve({ count: count < 10 ? null : count })
}

export function resetRadarMock() {
  enrolled = false
  persist()
}