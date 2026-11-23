import { reactive } from 'vue'
import { currentSession, loginWithWeChat, clearSession, type AuthSession } from '@/api/auth'

export type ConsentField = 'avatar' | 'nickname' | 'phone'

export interface AccountProfile {
  avatar: string
  nickname: string
  phone: string
  avatar_at: string
  nickname_at: string
  phone_at: string
}

const PROFILE_KEY = 'mbti_account_profile_v1'

function emptyProfile(): AccountProfile {
  return { avatar: '', nickname: '', phone: '', avatar_at: '', nickname_at: '', phone_at: '' }
}

function readProfile(): AccountProfile {
  try {
    const raw = uni.getStorageSync(PROFILE_KEY)
    if (raw && typeof raw === 'object') {
      return {
        avatar: typeof raw.avatar === 'string' ? raw.avatar : '',
        nickname: typeof raw.nickname === 'string' ? raw.nickname : '',
        phone: typeof raw.phone === 'string' ? raw.phone : '',
        avatar_at: typeof raw.avatar_at === 'string' ? raw.avatar_at : '',
        nickname_at: typeof raw.nickname_at === 'string' ? raw.nickname_at : '',
        phone_at: typeof raw.phone_at === 'string' ? raw.phone_at : '',
      }
    }
  } catch {
    /* ignore */
  }
  return emptyProfile()
}

export const account = reactive({
  session: currentSession() as AuthSession | null,
  profile: readProfile(),
  busy: false,
})

function persist() {
  uni.setStorageSync(PROFILE_KEY, account.profile)
}

export async function login(force = false) {
  if (account.session && !force) return account.session
  account.busy = true
  try {
    account.session = await loginWithWeChat()
    return account.session
  } finally {
    account.busy = false
  }
}

export function logout() {
  clearSession()
  account.session = null
  account.profile = emptyProfile()
  persist()
}

/** 仅退出登录：保留本机测试记录、订单与名片数据。 */
export function logoutSession() {
  clearSession()
  account.session = null
}

export function isLoggedIn(): boolean {
  return !!account.session
}

export function hasConsent(field: ConsentField): boolean {
  if (field === 'avatar') return !!account.profile.avatar_at
  if (field === 'nickname') return !!account.profile.nickname_at
  return !!account.profile.phone_at
}

export function authorizeAvatar(path: string) {
  if (!path) return
  account.profile.avatar = path
  account.profile.avatar_at = new Date().toISOString()
  persist()
}

export function authorizeNickname(nickname: string) {
  const value = nickname.trim().slice(0, 12)
  if (!value) return
  account.profile.nickname = value
  account.profile.nickname_at = new Date().toISOString()
  persist()
}

export function authorizePhone(phone: string) {
  account.profile.phone = phone
  account.profile.phone_at = new Date().toISOString()
  persist()
}

export function revoke(field: ConsentField) {
  if (field === 'avatar') {
    account.profile.avatar = ''
    account.profile.avatar_at = ''
  } else if (field === 'nickname') {
    account.profile.nickname = ''
    account.profile.nickname_at = ''
  } else {
    account.profile.phone = ''
    account.profile.phone_at = ''
  }
  persist()
}

/** 模拟微信手机号授权的返回值；真实接入时替换为 getPhoneNumber 的 code 换号结果。 */
export function mockPhoneNumber(): string {
  const tail = String(Math.floor(1000 + Math.random() * 9000))
  return `138****${tail}`
}

export function displayName(): string {
  return account.profile.nickname.trim() || '小禾'
}

export function maskedPhone(): string {
  return account.profile.phone || ''
}
