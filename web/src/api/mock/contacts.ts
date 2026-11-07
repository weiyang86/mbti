// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import type {
  ContactChannel,
  ContactRequest,
  GrantedChannel,
  MyContacts,
} from '../types-social'
import { BUDDY_SEEDS } from './buddies'
import { clone, getSocial, latestExchange, persistSocial, uid } from './social-state'

export function getContacts(): Promise<MyContacts> {
  return Promise.resolve(clone(getSocial().contacts))
}

export function updateContacts(body: MyContacts): Promise<MyContacts> {
  const next: MyContacts = {}
  ;(['wechat', 'qq', 'phone'] as ContactChannel[]).forEach((key) => {
    const value = (body[key] || '').trim()
    if (value) next[key] = value
  })
  getSocial().contacts = next
  persistSocial()
  return Promise.resolve(clone(next))
}

export function clearContacts(): Promise<void> {
  getSocial().contacts = {}
  persistSocial()
  return Promise.resolve()
}

function contactRequestsOf(buddyId?: string) {
  return getSocial()
    .contactRequests.filter((item) => item.status !== 'revoked')
    .filter((item) => (buddyId ? item.buddy_id === buddyId : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

export function listContactRequests(buddyId?: string): Promise<{ items: ContactRequest[] }> {
  return Promise.resolve({ items: clone(contactRequestsOf(buddyId)) })
}

function hasAcceptedCardExchange(buddyId: string) {
  return latestExchange(buddyId)?.status === 'accepted'
}

export function createContactRequest(body: {
  buddy_id: string
  channels: ContactChannel[]
}): Promise<ContactRequest> {
  if (!hasAcceptedCardExchange(body.buddy_id)) {
    return Promise.reject({ code: 'conflict', message: 'card exchange not accepted' })
  }
  const existing = contactRequestsOf(body.buddy_id)[0]
  if (existing && (existing.status === 'pending' || existing.status === 'accepted')) {
    return Promise.resolve(clone(existing))
  }
  const request: ContactRequest = {
    id: uid('creq'),
    buddy_id: body.buddy_id,
    status: 'pending',
    channels: body.channels.slice(),
    created_at: new Date().toISOString(),
    simulated: false,
  }
  getSocial().contactRequests.push(request)
  persistSocial()
  return Promise.resolve(clone(request))
}

export function respondContactRequest(
  requestId: string,
  action: 'accept' | 'decline',
): Promise<ContactRequest> {
  const request = getSocial().contactRequests.find((item) => item.id === requestId)
  if (!request) {
    return Promise.reject({ code: 'not_found', message: 'request not found' })
  }
  request.status = action === 'accept' ? 'accepted' : 'declined'
  request.responded_at = new Date().toISOString()
  request.simulated = true
  persistSocial()
  return Promise.resolve(clone(request))
}

export function revokeContactRequest(requestId: string): Promise<void> {
  const request = getSocial().contactRequests.find((item) => item.id === requestId)
  if (request) {
    request.status = 'revoked'
    persistSocial()
  }
  return Promise.resolve()
}

function demoContactValue(buddyId: string, channel: ContactChannel): string {
  const index = Math.max(BUDDY_SEEDS.findIndex((item) => item.id === buddyId), 0) + 1
  if (channel === 'wechat') return `demo_${buddyId}_01`
  if (channel === 'qq') return `10${String(index).padStart(6, '0')}`
  return `1380000${String(index).padStart(4, '0')}`
}

export function getGrantedContacts(
  requestId: string,
): Promise<{ channels: GrantedChannel[] }> {
  const request = getSocial().contactRequests.find((item) => item.id === requestId)
  if (!request || request.status !== 'accepted') {
    return Promise.reject({ code: 'forbidden', message: 'contact not granted' })
  }
  return Promise.resolve({
    channels: request.channels.map((channel) => ({
      channel,
      value: demoContactValue(request.buddy_id, channel),
    })),
  })
}