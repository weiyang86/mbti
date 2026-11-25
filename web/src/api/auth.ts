/**
 * 微信登录适配层。
 * - 小程序：uni.login 取 code，再请求 /auth/wechat/login。
 * - 微信内网页：公众号 OAuth 授权，再请求 /auth/wechat/mp/login。
 * 登录成功后接管服务端返回的游客 token，历史数据原地保留。
 */
import { adoptGuestSession, currentGuestToken, HttpError, request, useMock } from './client'

export interface AuthSession {
  token: string
  user_id: string
  provider: 'wechat' | 'mock'
  channel?: 'wechat' | 'mp'
  logged_in_at: string
  guest_token?: string
  expires_at?: string
}

const SESSION_KEY = 'mbti_auth_session_v1'

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

export function isWechatBrowser(): boolean {
  // #ifdef H5
  return typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent)
  // #endif
  return false
}

async function mpPublicConfig(): Promise<{ appid: string | null }> {
  const value = await request<{ channel?: string; appid?: unknown }>('/auth/wechat/mp/config')
  if (!value || typeof value !== 'object') throw new Error('公众号配置响应无效')
  return { appid: typeof value.appid === 'string' && value.appid ? value.appid : null }
}

/** WeChat appends `code` either before or after the UniApp hash route. */
function mpOAuthCode(url: URL): string | null {
  const direct = url.searchParams.get('code')
  if (direct) return direct
  const index = url.hash.indexOf('?')
  return index >= 0 ? new URLSearchParams(url.hash.slice(index + 1)).get('code') : null
}

function stripMpOAuthParams(url: URL) {
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  const index = url.hash.indexOf('?')
  if (index < 0) return
  const params = new URLSearchParams(url.hash.slice(index + 1))
  params.delete('code')
  params.delete('state')
  const rest = params.toString()
  url.hash = url.hash.slice(0, index) + (rest ? `?${rest}` : '')
}

/**
 * 微信内网页通过公众号 OAuth 获取身份；回到页面后再次调用即完成登录。
 * 小程序支付缺少公众号身份时也会复用这里。
 */
export async function ensureWechatMpSession(): Promise<AuthSession> {
  // #ifdef H5
  const saved = readSession()
  if (saved?.channel === 'mp' && saved.token) return saved
  if (!isWechatBrowser()) throw new Error('请在微信中打开后再登录')
  const location = globalThis.location
  if (!location) throw new Error('当前环境不支持微信登录')
  const current = new URL(location.href)
  const code = mpOAuthCode(current)
  if (code) {
    const session = await exchangeMpCode(code, currentGuestToken())
    stripMpOAuthParams(current)
    globalThis.history?.replaceState(null, '', current.toString())
    return session
  }
  const config = await mpPublicConfig()
  if (!config.appid) throw new Error('微信登录尚未在后台配置 AppID')
  const redirect = new URL(location.href)
  stripMpOAuthParams(redirect)
  const authorize = new URL('https://open.weixin.qq.com/connect/oauth2/authorize')
  authorize.searchParams.set('appid', config.appid)
  authorize.searchParams.set('redirect_uri', redirect.toString())
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', 'snsapi_base')
  authorize.searchParams.set('state', 'mbti')
  location.replace(authorize.toString() + '#wechat_redirect')
  throw new Error('正在跳转微信授权，请稍候重试')
  // #endif
  throw new Error('微信登录仅在微信内网页中可用')
}

/** 当前网页是否带着公众号 OAuth 回调 code，用于登录页自动完成登录 */
export function hasWechatMpCallback(): boolean {
  // #ifdef H5
  if (!isWechatBrowser()) return false
  const location = globalThis.location
  return !!location && !!mpOAuthCode(new URL(location.href))
  // #endif
  return false
}

function loginError(error: unknown, fallback: string): Error {
  if (error instanceof HttpError) {
    if (error.status === 404) return new Error('微信登录服务尚未部署，请联系管理员')
    return new Error(error.message || fallback)
  }
  return error instanceof Error ? error : new Error(fallback)
}

async function exchangeMpCode(code: string, guest: string | null): Promise<AuthSession> {
  let session: AuthSession
  try {
    session = await request<AuthSession>('/auth/wechat/mp/login', {
      method: 'POST',
      data: { code, ...(guest ? { guest_token: guest } : {}) },
    })
  } catch (e) {
    throw loginError(e, '公众号登录失败，请稍后重试')
  }
  if (!session || typeof session.token !== 'string' || !session.token || !session.guest_token || !session.expires_at) {
    throw new Error('公众号登录响应无效，请重试')
  }
  adoptGuestSession({ guest_token: session.guest_token, expires_at: session.expires_at })
  return saveSession({ ...session, channel: 'mp' })
}

async function exchangeMiniProgramCode(code: string): Promise<AuthSession> {
  const guest = currentGuestToken()
  let session: AuthSession
  try {
    session = await request<AuthSession>('/auth/wechat/login', {
      method: 'POST',
      data: { code, ...(guest ? { guest_token: guest } : {}) },
    })
  } catch (e) {
    throw loginError(e, '微信登录失败，请稍后重试')
  }
  if (!session || typeof session.token !== 'string' || !session.token || !session.guest_token || !session.expires_at) {
    throw new Error('登录响应无效，请重试')
  }
  adoptGuestSession({ guest_token: session.guest_token, expires_at: session.expires_at })
  return saveSession(session)
}

export async function loginWithWeChat(): Promise<AuthSession> {
  // #ifdef H5
  return ensureWechatMpSession()
  // #endif
  // #ifdef MP-WEIXIN
  if (useMock()) throw new Error('离线演示模式暂不支持微信登录')
  return exchangeMiniProgramCode(await wechatCode())
  // #endif
  throw new Error('当前环境暂不支持微信登录')
}
