export interface TestProfile {
  name: string
  interests: string[]
  stage: string
  recent: string
}

const KEY = 'mbti_test_profile_v1'

export const INTERESTS = ['摄影', '阅读', '音乐', '散步', '电影', '咖啡', '运动', '游戏']
export const STAGES = ['日常生活', '新学期', '新工作', '新城市', '生活转折', '项目冲刺', '假期休息']
export const RECENT_STATES = ['不记录', '轻松', '平稳', '忙碌', '疲惫']

const DEFAULTS: TestProfile = {
  name: '',
  interests: [],
  stage: '日常生活',
  recent: '不记录',
}

export function loadProfile(): TestProfile {
  try {
    const raw = uni.getStorageSync(KEY)
    if (raw && typeof raw === 'object') {
      return {
        name: typeof raw.name === 'string' ? raw.name : '',
        interests: Array.isArray(raw.interests) ? raw.interests.slice(0, 3) : [],
        stage: typeof raw.stage === 'string' ? raw.stage : DEFAULTS.stage,
        recent: typeof raw.recent === 'string' ? raw.recent : DEFAULTS.recent,
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

export function saveProfile(profile: TestProfile) {
  try {
    uni.setStorageSync(KEY, profile)
  } catch {
    /* ignore */
  }
}

/** 昵称缺省展示值，与原型一致 */
export function displayName(profile: TestProfile) {
  return profile.name.trim() || '小禾'
}
