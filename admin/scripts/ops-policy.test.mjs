import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { capabilities, grants, roles } = require('../../aij-foundation/scripts/mbti/ops-policy.cjs')

test('B1 role grants follow ADMIN-COVERAGE policy without superadmin grants', () => {
  assert.deepEqual(Object.keys(roles), ['owner', 'editor', 'support', 'reader'])
  assert.ok(roles.owner.includes(grants.systemWrite) && roles.owner.includes(grants.release) && roles.owner.includes(grants.redemption))
  assert.ok(roles.editor.includes(grants.draft) && roles.editor.includes(grants.moderation) && !roles.editor.includes(grants.systemWrite))
  assert.ok(roles.support.includes(grants.fulfillment) && roles.support.includes(grants.moderation) && !roles.support.includes(grants.release))
  assert.deepEqual(roles.reader, [grants.access, grants.orders, grants.systemRead, grants.moderationRead])
  assert.deepEqual(capabilities(roles.reader), Object.fromEntries(Object.keys(grants).map(key => [key, ['access', 'orders', 'systemRead', 'moderationRead'].includes(key)])))
  assert.ok(roles.support.includes(grants.generationRetry))
})

test('operations UI has 14 ordered routes and never persists client role or token', async () => {
  const source = await readFile(new URL('../src/ops.vue', import.meta.url), 'utf8')
  const ids = [...source.matchAll(/id: '([a-z-]+)', name:/g)].map(match => match[1])
  assert.deepEqual(ids, ['overview','growth','orders','moderation','ai','content','catalog','assessment','retention','social','ai-settings','payment-settings','trade-settings','release'])
  assert.doesNotMatch(source, /localStorage|sessionStorage/)
  const orders = await readFile(new URL('../src/orders.vue', import.meta.url), 'utf8')
  assert.match(orders, /mbti:orders:read/)
  assert.doesNotMatch(orders, /localStorage|sessionStorage|\.role\b/)
})
