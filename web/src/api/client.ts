import type { ApiError } from './types'

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

function authHeaders(): Record<string, string> {
  const guest = import.meta.env.VITE_GUEST_TOKEN
  if (guest) {
    return { 'X-Guest-Token': guest }
  }
  return {}
}

export class HttpError extends Error {
  status: number
  body: ApiError | null

  constructor(status: number, body: ApiError | null) {
    super(body?.message || `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

export async function request<T>(
  path: string,
  options: Omit<UniApp.RequestOptions, 'url'> = {},
): Promise<T> {
  const url = `${baseURL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options.header as Record<string, string> | undefined),
      },
      success: (res) => {
        const status = res.statusCode || 0
        if (status >= 200 && status < 300) {
          resolve(res.data as T)
          return
        }
        reject(new HttpError(status, res.data as ApiError))
      },
      fail: (err) => reject(err),
    })
  })
}

export function useMock(): boolean {
  return String(import.meta.env.VITE_USE_MOCK).toLowerCase() === 'true'
}
