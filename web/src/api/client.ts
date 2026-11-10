import type { ApiError } from './types'

export const baseURL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')
const guestKey = `mbti_guest_v1:${baseURL}`
const expiredMessage = '游客会话已失效，请返回首页重新建立会话'
type RequestOptions = Pick<UniApp.RequestOptions, 'method' | 'data' | 'header'>

interface GuestSession {
  guest_token: string
  expires_at: string
  invalid?: boolean
}

let initializing: Promise<GuestSession> | undefined

function storedGuest(): GuestSession | null {
  const value = uni.getStorageSync(guestKey)
  if (!value) return null
  if (typeof value !== 'object' || typeof value.guest_token !== 'string' || !value.guest_token || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))) {
    throw new HttpError(401, null)
  }
  return value
}

export function isGuestSessionExpired(): boolean {
  if (useMock()) return false
  try {
    const guest = storedGuest()
    return !!guest && (!!guest.invalid || Date.parse(guest.expires_at) <= Date.now())
  } catch {
    return true
  }
}

export class HttpError extends Error {
  status: number
  body: ApiError | null

  constructor(status: number, body: ApiError | null) {
    super(status === 401 ? expiredMessage : body?.message || `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

function send<T>(
  path: string,
  options: RequestOptions = {},
  guest?: GuestSession,
): Promise<T> {
  const url = `${baseURL}${path.startsWith('/') ? path : `/${path}`}`

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(options.header as Record<string, string> | undefined),
        ...(guest ? { 'X-Guest-Token': guest.guest_token } : {}),
      },
      success: (res) => {
        const status = res.statusCode || 0
        if (status >= 200 && status < 300) {
          resolve(res.data as T)
          return
        }
        if (status === 401 && guest) {
          // Keep the expired identity: never mint a new guest or replay a write on 401.
          try {
            if (storedGuest()?.guest_token === guest.guest_token) {
              uni.setStorageSync(guestKey, { ...guest, invalid: true })
            }
          } catch { /* The request still fails explicitly. */ }
        }
        reject(new HttpError(status, res.data as ApiError))
      },
      fail: (err) => reject(err),
    })
  })
}

export async function ensureGuestSession(): Promise<GuestSession> {
  const existing = storedGuest()
  if (existing) {
    if (existing.invalid || Date.parse(existing.expires_at) <= Date.now()) {
      throw new HttpError(401, null)
    }
    return existing
  }
  return createGuestSession()
}

function createGuestSession(): Promise<GuestSession> {
  if (!initializing) {
    initializing = send<GuestSession>('/auth/guest', { method: 'POST' })
      .then((guest) => {
        if (!guest || typeof guest.guest_token !== 'string' || !guest.guest_token || typeof guest.expires_at !== 'string' || !Number.isFinite(Date.parse(guest.expires_at)) || Date.parse(guest.expires_at) <= Date.now()) {
          throw new Error('游客身份初始化失败，请重试')
        }
        // Persist before sending protected requests, so a refresh keeps the same owner.
        uni.setStorageSync(guestKey, guest)
        return guest
      })
      .finally(() => { initializing = undefined })
  }
  return initializing
}

/** Called only after the person explicitly confirms creating a new identity. */
export async function startNewGuestSession(): Promise<void> {
  if (!isGuestSessionExpired()) return
  // Keep the invalid identity if issuance fails; replace it only after a valid response.
  await createGuestSession()
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const guest = await ensureGuestSession()
  return send<T>(path, options, guest)
}

export function requestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof HttpError ? error.message : fallback
}

export function useMock(): boolean {
  return String(import.meta.env.VITE_USE_MOCK).toLowerCase() === 'true'
}

/** Anonymous GET only. Does not initialize a guest or attach a guest token. */
export function publicRequest<T>(path: string): Promise<T> {
  return send<T>(path, { method: 'GET', header: { 'Cache-Control': 'no-cache' } })
}
