import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { buildSync } from 'esbuild'

const api = 'http://test.invalid/api/v1'
const guestKey = `mbti_guest_v1:${api}`
const future = '2099-01-01T00:00:00.000Z'
const env = { VITE_API_BASE_URL: api, VITE_USE_MOCK: 'false' }
const compile = (entry) => buildSync({
  entryPoints: [new URL(entry, import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs',
  define: { 'import.meta.env': JSON.stringify(env) },
}).outputFiles[0].text
const clientCode = compile('../src/api/client.ts')
const draftCode = compile('../src/store/quiz-draft.ts')
const apiCode = compile('../src/api/index.ts')
const socialDisplayCode = compile('../src/utils/social-display.ts')
const contactDisplayCode = compile('../src/utils/contact-display.ts')
const privateScopeCode = compile('../src/utils/private-page.ts')

function browser(storage = new Map(), respond = () => ({ statusCode: 200, data: { items: [], next_cursor: null } }), globals = {}) {
  const calls = []
  const uni = {
    getStorageSync: (key) => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      calls.push(options)
      queueMicrotask(() => {
        const response = options.url.endsWith('/auth/guest')
          ? { statusCode: 201, data: { guest_token: 'synthetic-guest', expires_at: future } }
          : respond(options)
        if (response.networkError) options.fail(response.networkError)
        else options.success(response)
      })
    },
  }
  const load = (code) => {
    const context = { module: { exports: {} }, uni, URLSearchParams, crypto, ...globals }
    vm.runInNewContext(code, context)
    return context.module.exports
  }
  return { storage, calls, uni, load, client: load(clientCode), drafts: load(draftCode) }
}

test('concurrent first requests issue one guest, attach its token and return bare objects', async () => {
  const b = browser()
  const responses = await Promise.all([
    b.client.request('/results'), b.client.request('/quiz/versions/current'), b.client.request('/results'),
  ])
  assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
  assert.equal(b.calls.length, 4)
  assert.ok(b.calls.slice(1).every((c) => c.header['X-Guest-Token'] === 'synthetic-guest'))
  assert.equal(responses[0].items.length, 0)
  assert.equal(responses[0].next_cursor, null)
})

test('refresh reuses persisted identity; another browser has its own issuance', async () => {
  const b = browser()
  await b.client.request('/results')
  const refreshed = browser(b.storage)
  await refreshed.client.request('/results')
  assert.equal(refreshed.calls.length, 1)
  const other = browser()
  await other.client.request('/results')
  assert.equal(other.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
})

test('401 on a write is shown explicitly, never replayed or replaced, including after refresh', async () => {
  const b = browser(new Map([[guestKey, { guest_token: 'invalid-guest', expires_at: future }]]),
    () => ({ statusCode: 401, data: { code: 'guest_invalid', message: 'invalid' } }))
  await assert.rejects(b.client.request('/quiz/sessions', { method: 'POST' }), (e) => e.status === 401 && e.message.includes('会话已失效'))
  await assert.rejects(b.client.request('/quiz/sessions', { method: 'POST' }), (e) => e.status === 401)
  const refreshed = browser(b.storage)
  await assert.rejects(refreshed.client.request('/results'), (e) => e.status === 401)
  assert.equal(b.calls.length, 1)
  assert.equal(refreshed.calls.length, 0)
  assert.equal(b.storage.get(guestKey).invalid, true)
})

test('expired and malformed stored identities block protected requests without silently creating a guest', async () => {
  for (const value of [{ guest_token: 'expired', expires_at: '2000-01-01T00:00:00Z' }, { guest_token: 'broken' }]) {
    const b = browser(new Map([[guestKey, value]]))
    await assert.rejects(b.client.request('/quiz/sessions', { method: 'POST' }), (e) => e.status === 401)
    assert.equal(b.calls.length, 0)
    assert.equal(b.client.isGuestSessionExpired(), true)
  }
})

test('an explicit new identity request does not replay the rejected operation', async () => {
  const b = browser(new Map([[guestKey, { guest_token: 'expired', expires_at: '2000-01-01T00:00:00Z' }]]))
  await b.client.startNewGuestSession()
  assert.equal(b.calls.length, 1)
  assert.ok(b.calls[0].url.endsWith('/auth/guest'))
  assert.equal(b.client.isGuestSessionExpired(), false)
})

test('failure to persist a new credential prevents protected writes', async () => {
  const b = browser()
  b.uni.setStorageSync = () => { throw new Error('storage denied') }
  await assert.rejects(b.client.request('/quiz/sessions', { method: 'POST' }), /storage denied/)
  assert.equal(b.calls.length, 1)
})

test('409 and other API errors preserve the server message and status', async () => {
  const b = browser(new Map([[guestKey, { guest_token: 'synthetic-guest', expires_at: future }]]),
    () => ({ statusCode: 409, data: { code: 'already_submitted', message: 'already submitted' } }))
  await assert.rejects(b.client.request('/quiz/sessions/s/submit', { method: 'POST' }),
    (e) => e.status === 409 && e.body.code === 'already_submitted' && e.message === 'already submitted')
  assert.equal(b.calls.length, 1)
})

test('F2 detail, metadata and list share one guest during concurrent first visit', async () => {
  const b = browser()
  const calls = b.load(apiCode)
  await Promise.all([calls.getResult('owned'), calls.listTypes(), calls.listResults({ limit: 50 })])
  assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
  assert.deepEqual(b.calls.slice(1).map((c) => c.url.slice(api.length)).sort(),
    ['/results/owned', '/results?limit=50', '/types'])
  assert.ok(b.calls.slice(1).every((c) => c.header['X-Guest-Token'] === 'synthetic-guest'))
})

test('F2 writes return bare self-select and empty 204; share uses the server asset URL', async () => {
  const snapshot = { id: 'self-1', source: 'self_select', type_code: 'INFP', question_bank_version: 'self-select', submitted_at: future }
  const preview = { status: 'ready', preview_url: 'https://assets.invalid/share.svg' }
  const b = browser(new Map(), (options) => options.method === 'DELETE'
    ? { statusCode: 204, data: '' }
    : options.url.endsWith('/share/preview') ? { statusCode: 200, data: preview }
      : { statusCode: 201, data: snapshot })
  const calls = b.load(apiCode)
  const result = await calls.createSelfSelectResult({ type_code: 'INFP', source: 'self_select' })
  assert.equal(result.id, snapshot.id)
  assert.equal(result.source, 'self_select')
  assert.equal('dimension_counts' in result, false)
  assert.deepEqual(await calls.createSharePreview({ result_id: result.id, scene: 'moments' }), preview)
  await calls.deleteResult(result.id)
  assert.deepEqual(b.calls.slice(1).map((c) => [c.method, c.url.slice(api.length)]),
    [['POST', '/results'], ['POST', '/share/preview'], ['DELETE', '/results/self-1']])
  assert.deepEqual(JSON.parse(JSON.stringify(b.calls[1].data)), { type_code: 'INFP', source: 'self_select' })
})

test('F2 compare uses static route; 404/422/503 remain failures with no fallback or replay', async () => {
  for (const status of [404, 422, 503]) {
    const b = browser(new Map(), () => ({ statusCode: status, data: { code: 'rejected', message: `拒绝 ${status}` } }))
    const calls = b.load(apiCode)
    await assert.rejects(calls.compareResults('older /', 'newer?'), (e) => e.status === status && e.message === `拒绝 ${status}`)
    await assert.rejects(calls.createSharePreview({ result_id: 'owned' }), (e) => e.status === status)
    await assert.rejects(calls.deleteResult('owned'), (e) => e.status === status)
    assert.equal(b.calls.length, 4)
    assert.equal(b.calls[1].url, `${api}/results/compare?baseline_id=older%20%2F&target_id=newer%3F`)
  }
})

test('F2 synchronous share rejects pending jobs, missing URLs and local placeholders', async () => {
  for (const response of [{ status: 'pending', job_id: 'job' }, { status: 'ready' }, { status: 'ready', preview_url: '/static/share-mock.png' }]) {
    const b = browser(new Map(), () => ({ statusCode: 200, data: response }))
    const calls = b.load(apiCode)
    await assert.rejects(calls.createSharePreview({ result_id: 'owned' }), /分享预览未就绪/)
    assert.equal(b.calls.length, 2)
  }
})

test('F3 a lost order response and refresh reuse the same intent key, with only allowed fields', async () => {
  const b = browser(new Map(), () => ({ networkError: { errMsg: 'connection lost' } }))
  const calls = b.load(apiCode)
  const body = { result_id: 'owned', product_code: 'server-sku', amount: 1, status: 'paid', unlocked: true }
  await assert.rejects(calls.createOrder(body))
  assert.equal(b.calls.length, 2)
  const originalKey = b.calls[1].header['Idempotency-Key']
  assert.ok(originalKey)
  const refreshed = browser(b.storage, () => ({ statusCode: 201, data: { id: 'persistent-order', status: 'pending', unlocked: false, amount: 990, currency: 'CNY' } }))
  const result = await refreshed.load(apiCode).createOrder(body)
  assert.equal(refreshed.calls.length, 1)
  assert.equal(refreshed.calls[0].header['Idempotency-Key'], originalKey)
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.calls[0].data)), { result_id: 'owned', product_code: 'server-sku' })
  assert.equal(result.id, 'persistent-order')
  assert.equal(result.status, 'pending')
  assert.equal(result.unlocked, false)
  assert.equal('order' in b.storage.get(`mbti_purchase_intent_v1:${api}`), false)
})

test('F3 changing result, product or guest starts another intent; concurrent attempts share one key', async () => {
  const b = browser()
  const calls = b.load(apiCode)
  const body = { result_id: 'result-1', product_code: 'sku-1' }
  const keys = await Promise.all([calls.preparePurchaseIntent(body), calls.preparePurchaseIntent(body)])
  assert.equal(keys[0], keys[1])
  const productKey = await calls.preparePurchaseIntent({ ...body, product_code: 'sku-2' })
  assert.notEqual(productKey, keys[0])
  const resultKey = await calls.preparePurchaseIntent({ ...body, result_id: 'result-2' })
  assert.notEqual(resultKey, productKey)
  const other = browser(new Map(b.storage))
  other.storage.set(guestKey, { guest_token: 'another-guest', expires_at: future })
  const otherKey = await other.load(apiCode).preparePurchaseIntent({ ...body, result_id: 'result-2' })
  assert.notEqual(otherKey, resultKey)
})

test('F3 failure to persist the purchase intent prevents POST orders', async () => {
  const b = browser(new Map([[guestKey, { guest_token: 'synthetic-guest', expires_at: future }]]))
  b.uni.setStorageSync = () => { throw new Error('storage denied') }
  await assert.rejects(b.load(apiCode).createOrder({ result_id: 'owned', product_code: 'sku' }), /storage denied/)
  assert.equal(b.calls.length, 0)
})

test('F3 401 order creation is never replayed, replaced or treated as unlocked', async () => {
  const b = browser(new Map(), () => ({ statusCode: 401, data: { code: 'guest_invalid', message: 'invalid' } }))
  const calls = b.load(apiCode)
  await assert.rejects(calls.createOrder({ result_id: 'owned', product_code: 'sku' }), (e) => e.status === 401)
  await assert.rejects(calls.createOrder({ result_id: 'owned', product_code: 'sku' }), (e) => e.status === 401)
  assert.equal(b.calls.length, 2)
  assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
  assert.equal(b.storage.get(guestKey).invalid, true)
})

test('F3 catalog, paginated orders, status and entitlements use the shared guest and server responses', async () => {
  const b = browser(new Map(), (options) => ({ statusCode: 200, data: options.url.includes('/orders/')
    ? { order_id: 'owned /?', status: 'pending', unlocked: false, payment_availability: 'unconfigured' }
    : { items: [], next_cursor: null } }))
  const calls = b.load(apiCode)
  const [catalog, orders, status, entitlements] = await Promise.all([
    calls.listProducts(), calls.listOrders({ limit: 20, cursor: 'next /?' }), calls.getOrderStatus('owned /?'), calls.getMyEntitlements(),
  ])
  assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
  assert.ok(b.calls.slice(1).every((c) => c.header['X-Guest-Token'] === 'synthetic-guest'))
  assert.deepEqual(b.calls.slice(1).map((c) => c.url.slice(api.length)).sort(),
    ['/entitlements/me', '/orders/owned%20%2F%3F', '/orders?limit=20&cursor=next+%2F%3F', '/products'])
  assert.equal(catalog.items.length + orders.items.length + entitlements.items.length, 0)
  assert.equal(status.unlocked, false)
  assert.equal(status.payment_availability, 'unconfigured')
})

test('F3 404/409/422/503 remain explicit failures with no local order or entitlement fallback', async () => {
  for (const status of [404, 409, 422, 503]) {
    const b = browser(new Map([['mbti_mock_orders_v1', [{ id: 'old', status: 'paid' }]], ['mbti_studio_v1', { tier: 2 }]]),
      () => ({ statusCode: status, data: { code: 'rejected', message: `拒绝 ${status}` } }))
    const calls = b.load(apiCode)
    for (const action of [() => calls.listProducts(), () => calls.listOrders(), () => calls.getMyEntitlements(),
      () => calls.getOrderStatus('old'), () => calls.createOrder({ result_id: 'owned', product_code: 'sku' })]) {
      await assert.rejects(action(), (e) => e.status === status && e.message === `拒绝 ${status}`)
    }
    assert.equal(b.calls.length, 6)
    assert.equal(b.storage.get('mbti_studio_v1').tier, 2)
  }
})

test('F3 intent keys meet the candidate header format without secure-context randomUUID', async () => {
  for (const unavailableCrypto of [{ getRandomValues: crypto.getRandomValues.bind(crypto) }, undefined]) {
    const b = browser(new Map(), undefined, { crypto: unavailableCrypto })
    const key = await b.load(apiCode).preparePurchaseIntent({ result_id: 'owned', product_code: 'sku' })
    assert.match(key, /^[A-Za-z0-9_-]{16,128}$/)
  }
})

test('F4 concurrent pages share one guest; all twelve operations use real routes and preserve partial visibility', async () => {
  const b = browser(new Map(), (options) => ({ statusCode: options.method === 'DELETE' ? 204 : 200, data: options.method === 'DELETE' ? '' : { items: [] } }))
  const calls = b.load(apiCode)
  await Promise.all([calls.getMyCard(), calls.listCardExchanges(), calls.listBlockedBuddies()])
  await calls.updateMyCard({ discoverable: false, visibility: { name: false } })
  await calls.getPublicCard('public /?')
  await calls.listBuddies({ mode: 'same', limit: 20 })
  await calls.getBuddy('public /?')
  await calls.blockBuddy('public /?')
  await calls.unblockBuddy('public /?')
  await calls.createCardExchange({ buddy_id: 'public /?' })
  await calls.respondCardExchange('exchange /?', 'decline')
  await calls.revokeCardExchange('exchange /?')
  assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
  assert.ok(b.calls.slice(1).every((c) => c.header['X-Guest-Token'] === 'synthetic-guest'))
  assert.deepEqual(b.calls.slice(1).map((c) => [c.method, c.url.slice(api.length)]), [
    ['GET', '/cards/me'], ['GET', '/card-exchanges'], ['GET', '/buddies/blocked'],
    ['PUT', '/cards/me'], ['GET', '/cards/public%20%2F%3F'], ['GET', '/buddies?mode=same&limit=20'],
    ['GET', '/buddies/public%20%2F%3F'], ['POST', '/buddies/public%20%2F%3F/block'], ['DELETE', '/buddies/public%20%2F%3F/block'],
    ['POST', '/card-exchanges'], ['POST', '/card-exchanges/exchange%20%2F%3F/respond'], ['DELETE', '/card-exchanges/exchange%20%2F%3F'],
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(b.calls[4].data)), { discoverable: false, visibility: { name: false } })
})

test('F4 failures stay failures despite old demo data; 401 never changes identity or replays a response', async () => {
  for (const status of [401, 404, 409, 422]) {
    const b = browser(new Map([['mbti_studio_v1', { hasCard: true, customQuote: 'private cached text' }]]),
      () => ({ statusCode: status, data: { code: 'rejected', message: '服务端拒绝' } }))
    const calls = b.load(apiCode)
    await assert.rejects(calls.respondCardExchange('private-exchange', 'accept'), (e) => e.status === status)
    if (status === 401) {
      await assert.rejects(calls.respondCardExchange('private-exchange', 'accept'), (e) => e.status === 401)
      assert.equal(b.calls.length, 2)
    } else {
      await assert.rejects(calls.getPublicCard('private-card'), (e) => e.status === status)
      assert.equal(b.calls.length, 3)
    }
    assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
    assert.ok(b.calls.every((c) => !c.url.includes('contacts')))
  }
})

test('F4 action visibility follows incoming/outgoing and pending/accepted state, never a guessed actor', () => {
  const display = browser().load(socialDisplayCode)
  for (const direction of ['incoming', 'outgoing', undefined]) {
    for (const status of ['pending', 'accepted', 'declined', 'revoked']) {
      assert.equal(display.canRespond({ direction, status }), direction === 'incoming' && status === 'pending')
      assert.equal(display.canRevoke({ direction, status }), direction === 'outgoing' && ['pending', 'accepted'].includes(status))
    }
  }
})

test('F5 all eight operations share one identity; values never enter persistent storage', async () => {
  const b = browser(new Map(), (o) => ({ statusCode: o.method === 'DELETE' ? 204 : 200, data: o.method === 'DELETE' ? '' : {} }))
  const calls = b.load(apiCode)
  await Promise.all([calls.getContacts(), calls.listContactRequests('card /?')])
  await calls.updateContacts({ wechat: 'synthetic_private' })
  await calls.clearContacts()
  await calls.createContactRequest({ buddy_id: 'card /?', channels: ['wechat'] })
  await calls.respondContactRequest('request /?', 'accept')
  await calls.revokeContactRequest('request /?')
  await calls.getGrantedContacts('request /?')
  assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
  assert.deepEqual(b.calls.slice(1).map((c) => [c.method, c.url.slice(api.length)]), [
    ['GET', '/contacts/me'], ['GET', '/contact-requests?buddy_id=card%20%2F%3F'],
    ['PUT', '/contacts/me'], ['DELETE', '/contacts/me'], ['POST', '/contact-requests'],
    ['POST', '/contact-requests/request%20%2F%3F/respond'], ['DELETE', '/contact-requests/request%20%2F%3F'],
    ['GET', '/contact-requests/request%20%2F%3F/granted'],
  ])
  assert.deepEqual([...b.storage.keys()], [guestKey])
  assert.equal(JSON.stringify([...b.storage]).includes('synthetic_private'), false)
  assert.ok(b.calls.every((c) => !c.url.includes('synthetic_private')))
})

test('F5 revoked/unapproved/input/conflict failures never read a stored grant or replay writes', async () => {
  for (const status of [401, 404, 409, 422, 503]) {
    const b = browser(new Map([['mbti_mock_contacts', { wechat: 'stale_private' }]]),
      () => ({ statusCode: status, data: { code: 'denied', message: 'server denial' } }))
    const calls = b.load(apiCode)
    await assert.rejects(calls.getGrantedContacts('old'), (e) => e.status === status)
    await assert.rejects(calls.updateContacts({}), (e) => e.status === status)
    assert.equal(b.calls.length, status === 401 ? 2 : 3)
    assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
  }
})

test('F5 recipient alone responds, both participants can revoke active requests, incoming is never mutual grant', () => {
  const display = browser().load(contactDisplayCode)
  for (const direction of ['incoming', 'outgoing', undefined]) {
    for (const status of ['pending', 'accepted', 'declined', 'revoked']) {
      assert.equal(display.canRespondContact({ direction, status }), direction === 'incoming' && status === 'pending')
      assert.equal(display.canRevokeContact({ direction, status }), !!direction && ['pending', 'accepted'].includes(status))
    }
  }
})

test('F5 leaving or refreshing invalidates a delayed private response, including after reentry', () => {
  let value = 'visible-private-value'
  const scope = browser().load(privateScopeCode).createPrivateScope(() => { value = '' })
  scope.enter()
  assert.equal(value, '')
  const slowRead = scope.begin()
  assert.equal(scope.current(slowRead), true)
  value = 'new-value'
  const refresh = scope.begin()
  assert.equal(value, '')
  assert.equal(scope.current(slowRead), false)
  scope.leave()
  assert.equal(scope.current(refresh), false)
  scope.enter()
  assert.equal(scope.current(refresh), false)
  assert.equal(value, '')
})

test('F5 errors never interpolate private response details; candidate format validates trimmed full form', () => {
  const b = browser()
  const display = b.load(contactDisplayCode)
  // Compile together so instanceof uses the same HttpError constructor.
  const code = buildSync({ stdin: { contents: `export { HttpError } from './src/api/client'; export { contactErrorMessage } from './src/utils/contact-display'`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'import.meta.env': JSON.stringify(env) } }).outputFiles[0].text
  const combined = b.load(code)
  for (const status of [401, 404, 409, 422, 503]) {
    const message = combined.contactErrorMessage(new combined.HttpError(status, { message: 'private-canary' }), '读取失败')
    assert.equal(message.includes('private-canary'), false)
  }
  assert.equal(display.validateContacts({ wechat: ' synthetic_ok ', qq: '', phone: '' }), '')
  assert.ok(display.validateContacts({ wechat: '1bad' }))
  assert.ok(display.validateContacts({ qq: '01234' }))
  assert.ok(display.validateContacts({ phone: '123' }))
})

const bank = {
  question_bank_version: 'frozen-version',
  questions: Array.from({ length: 12 }, (_, i) => ({
    id: `q${i + 1}`, index: i + 1, dimension: 'EI', prompt: `original ${i}`,
    options: [{ id: 'a', label: 'original A' }, { id: 'b', label: 'original B' }],
  })),
}

test('draft restores exact cached questions and progress without fetching the current bank', () => {
  const b = browser()
  const draft = b.drafts.createQuizDraft({ id: 'session-1', question_bank_version: 'frozen-version', answers: [] }, bank)
  b.drafts.saveQuizDraft({ ...draft, answers: { q1: 'b' }, index: 1 })
  bank.questions[0].prompt = 'new current question'
  const refreshed = browser(b.storage)
  const restored = refreshed.drafts.loadQuizDraft()
  assert.ok(refreshed.drafts.isRestorableDraft(restored))
  assert.equal(restored.questionBank.questions[0].prompt, 'original 0')
  assert.equal(restored.answers.q1, 'b')
  assert.equal(restored.index, 1)
  assert.equal(refreshed.calls.length, 0)
})

test('legacy draft without original bank is refused; clearing it preserves result history', () => {
  const b = browser(new Map([
    ['mbti_quiz_draft_v1', { sessionId: 'old-session', questionBankVersion: 'old-version', answers: {}, index: 0 }],
    ['mbti_mock_results_v1', { results: [{ id: 'history' }] }],
  ]))
  assert.equal(b.drafts.isRestorableDraft(b.drafts.loadQuizDraft()), false)
  b.drafts.clearQuizDraft()
  assert.equal(b.storage.get('mbti_mock_results_v1').results[0].id, 'history')
})

test('session binding mismatch never saves a draft under a different bank version', () => {
  const b = browser()
  assert.throws(() => b.drafts.createQuizDraft({ id: 'session-1', question_bank_version: 'other-version', answers: [] }, bank), /原题库/)
  assert.equal(b.drafts.loadQuizDraft(), null)
})

test('corrupted cached questions are refused without throwing during recovery', () => {
  const b = browser()
  const draft = { sessionId: 's', questionBankVersion: 'v', questionBank: { question_bank_version: 'v', questions: Array(12).fill(null) }, answers: {}, index: 0 }
  assert.equal(b.drafts.isRestorableDraft(draft), false)
})
