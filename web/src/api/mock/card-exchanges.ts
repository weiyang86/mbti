// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import type { CardExchange } from '../types-social'
import { BUDDY_SEEDS, currentInterests, toSummary } from './buddies'
import { getMyCard } from './cards'
import { clone, getSocial, latestExchange, persistSocial, uid } from './social-state'

async function exchangeWithBuddy(exchange: CardExchange): Promise<CardExchange> {
  const seed = BUDDY_SEEDS.find((item) => item.id === exchange.buddy_id)
  if (!seed) return clone(exchange)
  const card = await getMyCard()
  return {
    ...clone(exchange),
    buddy: toSummary(seed, card.type_code, card.interests),
  }
}

export async function listCardExchanges(): Promise<{ items: CardExchange[] }> {
  const items = await Promise.all(
    getSocial()
      .exchanges.filter(
        (item) => item.status !== 'revoked' && !getSocial().blocked.includes(item.buddy_id),
      )
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((item) => exchangeWithBuddy(item)),
  )
  return { items }
}

export async function createCardExchange(body: { buddy_id: string }): Promise<CardExchange> {
  const seed = BUDDY_SEEDS.find((item) => item.id === body.buddy_id)
  if (!seed) {
    return Promise.reject({ code: 'not_found', message: 'buddy not found' })
  }
  const existing = latestExchange(body.buddy_id)
  if (existing && (existing.status === 'pending' || existing.status === 'accepted')) {
    return exchangeWithBuddy(existing)
  }
  const social = getSocial()
  social.exchanges = social.exchanges.filter((item) => item.buddy_id !== body.buddy_id)
  const exchange: CardExchange = {
    id: uid('ex'),
    buddy_id: body.buddy_id,
    buddy: toSummary(seed, '', currentInterests()),
    status: 'pending',
    created_at: new Date().toISOString(),
    simulated: false,
  }
  getSocial().exchanges.push(exchange)
  persistSocial()
  return exchangeWithBuddy(exchange)
}

export async function respondCardExchange(
  exchangeId: string,
  action: 'accept' | 'decline',
): Promise<CardExchange> {
  const exchange = getSocial().exchanges.find((item) => item.id === exchangeId)
  if (!exchange) {
    return Promise.reject({ code: 'not_found', message: 'exchange not found' })
  }
  exchange.status = action === 'accept' ? 'accepted' : 'declined'
  exchange.responded_at = new Date().toISOString()
  exchange.simulated = true
  persistSocial()
  return exchangeWithBuddy(exchange)
}

export function revokeCardExchange(exchangeId: string): Promise<void> {
  const exchange = getSocial().exchanges.find((item) => item.id === exchangeId)
  if (exchange) {
    exchange.status = 'revoked'
    persistSocial()
  }
  return Promise.resolve()
}