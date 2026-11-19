/**
 * 小程序登录 SDK 适配层。
 * 默认走高保真 mock：仍会调用 uni.login 取 code，再换取本地 mock 会话。
 * 后端 code2session 就绪后，把 VITE_AUTH_MODE 设为 real 即可切到 /auth/wechat/login。
 */
import { request } from './client'

export type AuthMode = 'mock' | 'real'

export interface AuthSession {
  token: string
  user_id: string
  provider: 'wechat' | 'mock'
  logged_in_at: string
}

const SESSION_KEY = 'mbti_auth_session_v1'
const realMode = String(import.meta.env.VITE_AUTH_MODE || 'mock').toLowerCase() === 'real'

export function isRealAuth(): boolean {
  return realMode
}

function readSession(): AuthSession | null {
  try {
    const raw = uni.getStorageSync(SESSION_KEY)
    if (raw && typeof raw === 'object' && typeof raw.token === 'string' && raw.token) {
      return raw as AuthSession
    }
  } catch {
    /* ignore */
  }
  return null
}

export function currentSession(): AuthSession | null {
  return readSession()
}

function saveSession(session: AuthSession): AuthSession {
  uni.setStorageSync(SESSION_KEY, session)
  return session
}

export function clearSession() {
  uni.removeStorageSync(SESSION_KEY)
}

function loginCode(): Promise<string> {
  return new Promise((resolve) => {
    // #ifdef MP-WEIXIN
    uni.login({
      provider: 'weixin',
      success: (res) => resolve(res.code || mockCode()),
      fail: () => resolve(mockCode()),
    })
    // #endif
    // #ifndef MP-WEIXIN
    resolve(mockCode())
    // #endif
  })
}

function mockCode() {
  return `mock_code_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function loginWithWeChat(): Promise<AuthSession> {
  const code = await loginCode()
  if (realMode) {
    const session = await request<AuthSession>('/auth/wechat/login', {
      method: 'POST',
      data: { code },
    })
    return saveSession(session)
  }
  const session: AuthSession = {
    token: `mock_${code}`,
    user_id: `mock_user_${code.slice(-6)}`,
    provider: 'mock',
    logged_in_at: new Date().toISOString(),
  }
  return saveSession(session)
}
