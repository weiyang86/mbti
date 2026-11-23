/**
 * 小程序登录适配层。
 * - mock 模式：本地生成稳定的 mock code，联调环境由后端发 mock 身份；纯 mock 前端时不连后端。
 * - real 模式：小程序端调用 uni.login 取 code，再请求 /auth/wechat/login。
 * 登录成功后接管服务端返回的游客 token，历史数据原地保留。
 */
import { adoptGuestSession, currentGuestToken, request, useMock } from './client'

export type AuthMode = 'mock' | 'real'

export interface AuthSession {
  token: string
  user_id: string
  provider: 'wechat' | 'mock'
  logged_in_at: string
  guest_token?: string
  expires_at?: string
}

const SESSION_KEY = 'mbti_auth_session_v1'
const MOCK_CODE_KEY = 'mbti_mock_login_code_v1'
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

/** mock 模式使用稳定 code，保证重新登录还是同一个开发身份。 */
function stableMockCode(): string {
  try {
    const saved = uni.getStorageSync(MOCK_CODE_KEY)
    if (typeof saved === 'string' && saved) return saved
  } catch {
    /* ignore */
  }
  const code = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  try {
    uni.setStorageSync(MOCK_CODE_KEY, code)
  } catch {
    /* ignore */
  }
  return code
}

function wechatCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.login({
      provider: 'weixin',
      success: (res) => {
        if (res.code) resolve(res.code)
        else reject(new Error('微信登录未返回凭证，请重试'))
      },
      fail: () => reject(new Error('微信登录失败，请重试')),
    })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('请在微信小程序中使用微信登录'))
    // #endif
  })
}

export async function loginWithWeChat(): Promise<AuthSession> {
  const code = realMode ? await wechatCode() : stableMockCode()
  if (useMock()) {
    return saveSession({
      token: `mock_${code}`,
      user_id: `mock_user_${code.slice(-6)}`,
      provider: 'mock',
      logged_in_at: new Date().toISOString(),
    })
  }
  const guest = currentGuestToken()
  const session = await request<AuthSession>('/auth/wechat/login', {
    method: 'POST',
    data: { code, ...(guest ? { guest_token: guest } : {}) },
  })
  if (!session || typeof session.token !== 'string' || !session.token || !session.guest_token || !session.expires_at) {
    throw new Error('登录响应无效，请重试')
  }
  adoptGuestSession({ guest_token: session.guest_token, expires_at: session.expires_at })
  return saveSession(session)
}
