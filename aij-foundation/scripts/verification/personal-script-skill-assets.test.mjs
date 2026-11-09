// Source-level branch checks with explicit in-memory collaborators; no PostgreSQL/live claims.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
require('ts-node').register({ project: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)), transpileOnly: true });
require('reflect-metadata');
const c = require('../../apps/api/src/plugins/aij-ai/ai-personal-script-skill-contract.ts');
const { createPersonalScriptVersionDto: dto } = require('../../apps/api/src/plugins/aij-ai/ai-personal-script-skill.dto.ts');
const { AiPersonalScriptSkillService: Service } = require('../../apps/api/src/plugins/aij-ai/ai-personal-script-skill.service.ts');
const { ForbiddenException, NotFoundException } = require('@nestjs/common');
const status = code => error => error.getStatus?.() === code;
const request = { skillId: 'skill', expectedRevision: 1, name: 'Private script', instructions: 'Private prompt', scriptSource: 'print("private sentinel")\n' };
const scope = { memberId: 'member', workspaceId: 'workspace' };
function fixture() {
  let current = { projectId: 'actual-project', skillId: 'skill', skillVersionId: 'original-version', revision: 1,
    name: request.name, instructions: request.instructions };
  let rows = [], audits = [], failAudit = false, deny = false, deleted = false, badAppend = false;
  const calls = [];
  const tx = {
    async $executeRaw(parts, ...v) {
      assert.ok(Array.isArray(parts.raw));
      assert.ok(parts.join('?').includes('INSERT INTO public.ai_personal_script_version'));
      assert.ok(!parts.join('').includes(request.scriptSource));
      const [id, project_id, workspace_id, member_id, skill_id, skill_version_id, revision, script_source, script_digest, policy_digest] = v;
      rows.push({ id, project_id, workspace_id, member_id, skill_id, skill_version_id, revision, script_source, script_digest, policy_digest });
      return 1;
    },
    async $queryRaw(parts, ...v) {
      assert.ok(Array.isArray(parts.raw));
      return rows.filter(r => r.id === v[0] && r.workspace_id === v[1] && r.member_id === v[2]);
    },
    auditLog: { async create({ data }) { if (failAudit) throw new Error(request.scriptSource); audits.push(data); } }
  };
  const owner = {
    async withCurrent(s, id, permissions, authorize, operation) {
      const save = structuredClone({ current, rows, audits });
      try { return await operation(tx, await this.currentInTransaction(tx, s, id, permissions, authorize)); }
      catch (e) { ({ current, rows, audits } = save); throw e; }
    },
    async currentInTransaction(t, s, id, permissions, authorize) {
      assert.equal(t, tx); calls.push([...permissions]);
      if (deny) throw new ForbiddenException('Denied');
      if (deleted || id !== current.skillId || s.memberId !== scope.memberId || s.workspaceId !== scope.workspaceId) throw new NotFoundException();
      if (authorize) await authorize(tx);
      return structuredClone(current);
    },
    async appendVersionInTransaction(t, previous, content) {
      assert.equal(t, tx); assert.deepEqual(previous, current);
      assert.equal(content.expectedRevision, current.revision);
      current = { ...current, ...content, revision: current.revision + 1, skillVersionId: badAppend ? current.skillVersionId : randomUUID() };
      return structuredClone(current);
    }
  };
  return { service: new Service(owner, tx), tx, calls, rows: () => rows, audits: () => audits, current: () => current,
    update: values => Object.assign(current, values), row: values => Object.assign(rows[0], values),
    fault: kind => { failAudit = kind === 'audit'; deny = kind === 'deny'; deleted = kind === 'deleted'; badAppend = kind === 'append'; } };
}
test('frozen policy bytes, source raw bytes, strict DTO and no getter execution', () => {
  assert.equal(c.SCRIPT_POLICY_DIGEST, createHash('sha256').update('{"version":"aij-private-python-json-v1","language":"python","sourceBytes":65536,"inputBytes":16384,"outputBytes":65536,"depth":16,"entries":2048,"timeoutMs":30000,"network":"none","tools":[],"attachments":[]}').digest('hex'));
  assert.equal(dto(request).scriptSource, request.scriptSource);
  assert.equal(c.scriptSource(' '.repeat(65536)).length, 65536);
  let invoked = false;
  const getter = { ...request }; Object.defineProperty(getter, 'name', { enumerable: true, get() { invoked = true; return 'x'; } });
  for (const raw of [getter, new Proxy(request, {}), { ...request, unknown: 1 }, { ...request, [Symbol()]: 1 },
    Object.assign(Object.create({}), request), { ...request, expectedRevision: Infinity }, { ...request, expectedRevision: 2147483648 },
    { ...request, name: '\ud800' }, { ...request, instructions: '\0' }, { ...request, scriptSource: '' },
    { ...request, scriptSource: '\udc00' }, { ...request, scriptSource: 'a\0b' }, { ...request, scriptSource: '汉'.repeat(21846) }]) assert.throws(() => dto(raw), status(400));
  assert.equal(invoked, false);
});
test('bounded canonical JSON, proxies/accessors/prototypes/symbols/cycles and hash provenance', () => {
  assert.equal(c.scriptInputCanonical({ z: [true, null], a: 1 }), '{"a":1,"z":[true,null]}');
  const cycle = {}; cycle.x = cycle;
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('getter invoked'); } });
  const sparse = new Array(1), decorated = [1]; decorated.extra = true;
  for (const raw of [undefined, NaN, Infinity, 1n, () => 1, new Date(), new Proxy({}, {}), cycle, getter, sparse, decorated,
    { [Symbol()]: 1 }, { x: undefined }, JSON.parse('{"constructor":1}'), JSON.parse('{"__proto__":0}'),
    '\ud800', { ['\udc00']: 0 }, 'x'.repeat(16383), Array(2049).fill(0)]) assert.throws(() => c.scriptInputCanonical(raw));
  let deep = 0; for (let i = 0; i < 16; i++) deep = [deep]; c.scriptInputCanonical(deep);
  assert.throws(() => c.scriptInputCanonical([deep]));
  assert.equal(c.scriptInputCanonical(Array(2048).fill(0)).length, 4097);
  const ref = { scriptVersionId: randomUUID(), skillId: 'skill', skillVersionId: 'version', revision: 1, scriptDigest: 'a'.repeat(64), policyDigest: c.SCRIPT_POLICY_DIGEST };
  assert.equal(c.scriptRequestHash(ref, { b: 2, a: 1 }), c.scriptRequestHash(ref, { a: 1, b: 2 }));
  for (const key of ['skillId', 'skillVersionId', 'scriptVersionId', 'revision', 'scriptDigest']) {
    const changed = { ...ref, [key]: key === 'revision' ? 2 : key === 'scriptVersionId' ? randomUUID() : key === 'scriptDigest' ? 'b'.repeat(64) : 'other' };
    assert.notEqual(c.scriptRequestHash(changed, null), c.scriptRequestHash(ref, null));
  }
  assert.throws(() => c.scriptRef({ ...ref, policyDigest: 'b'.repeat(64) }));
  assert.throws(() => c.scriptRef({ ...ref, source: 'secret' }));
});
test('raw UTF8 JSON preserves evidence and rejects duplicate/escaped keys and invalid documents', () => {
  assert.deepEqual(c.parseScriptJson(Buffer.from(' \n {"z":[1,true,null,"😀"]}\t')), { z: [1, true, null, '😀'] });
  for (const raw of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"constructor":0}', '{"x":"\\ud800"}', '1e999', '{}{}', 'prefix{}', '{}tail', '[1,]', '{"x":}', '\ufeff{}', '', '"bad\nstring"', ' '.repeat(65537)]) assert.throws(() => c.parseScriptJson(Buffer.from(raw)));
  assert.throws(() => c.parseScriptJson(Buffer.from([0xff])));
});
test('append unchanged prompt creates new immutable extension; exact permissions and session in TX', async () => {
  const f = fixture(); let gates = 0;
  const gate = async t => { assert.equal(t, f.tx); gates++; };
  const ref = await f.service.createVersion('member', 'workspace', request, gate);
  assert.equal(ref.revision, 2); assert.notEqual(ref.skillVersionId, 'original-version');
  assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].script_source, request.scriptSource);
  assert.equal(gates, 2); assert.deepEqual(f.calls[0], ['workspace.ai.assets.manage', 'workspace.ai.scripts.manage']);
  assert.ok(!JSON.stringify(f.audits()).includes(request.scriptSource)); assert.ok(!JSON.stringify(ref).includes('instructions'));
  assert.deepEqual(await f.service.readVersion('member', 'workspace', ref.scriptVersionId, gate), { ref, scriptSource: request.scriptSource });
  assert.deepEqual(f.calls.at(-1), ['workspace.ai.assets.read', 'workspace.ai.scripts.manage']);
  await f.service.resolveInTransaction(f.tx, scope, ref.scriptVersionId, gate);
  assert.deepEqual(f.calls.at(-1), ['workspace.ai.assets.read', 'workspace.ai.execute', 'workspace.ai.scripts.execute']);
  await f.service.resolveForReadInTransaction(f.tx, scope, ref.scriptVersionId, gate);
  assert.deepEqual(f.calls.at(-1), ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.scripts.execute']);
});
test('CAS, bad append, audit and late session rejection roll back original version and extension', async () => {
  for (const kind of ['audit', 'append', 'session', 'cas']) {
    const f = fixture(); f.fault(kind); let count = 0;
    const gate = async () => { if (kind === 'session' && ++count === 2) throw new ForbiddenException('Revoked'); };
    await assert.rejects(f.service.createVersion('member', 'workspace', { ...request, expectedRevision: kind === 'cas' ? 2 : 1 }, gate), status(kind === 'session' ? 403 : kind === 'cas' ? 409 : 503));
    assert.equal(f.current().revision, 1); assert.equal(f.rows().length, 0); assert.equal(f.audits().length, 0);
  }
});
test('current revision/version/project/digest/policy corruption, deletion, owner, grant and session refusals', async () => {
  const mutations = [ ['revision', 3], ['skillVersionId', 'other'], ['projectId', 'other'] ];
  for (const [key, value] of mutations) {
    const f = fixture(), ref = await f.service.createVersion('member', 'workspace', request); f.update({ [key]: value });
    await assert.rejects(f.service.resolveInTransaction(f.tx, scope, ref.scriptVersionId), status(409));
    await assert.rejects(f.service.readVersion('member', 'workspace', ref.scriptVersionId), status(409));
  }
  for (const mutation of [{ script_source: 'changed' }, { script_digest: 'b'.repeat(64) }, { policy_digest: 'b'.repeat(64) }]) {
    const f = fixture(), ref = await f.service.createVersion('member', 'workspace', request); f.row(mutation);
    await assert.rejects(f.service.resolveForReadInTransaction(f.tx, scope, ref.scriptVersionId), status(409));
  }
  const f = fixture(), ref = await f.service.createVersion('member', 'workspace', request);
  for (const s of [{ ...scope, memberId: 'other' }, { ...scope, workspaceId: 'other' }]) await assert.rejects(f.service.resolveInTransaction(f.tx, s, ref.scriptVersionId), status(404));
  f.fault('deny'); await assert.rejects(f.service.resolveForReadInTransaction(f.tx, scope, ref.scriptVersionId), status(403));
  f.fault('deleted'); await assert.rejects(f.service.readVersion('member', 'workspace', ref.scriptVersionId), status(404));
  f.fault(''); await assert.rejects(f.service.resolveInTransaction(f.tx, scope, ref.scriptVersionId, async () => { throw new ForbiddenException(); }), status(403));
});
test('absent DI is 503 and invalid ID is bounded 400', async () => {
  assert.throws(() => new Service().createVersion('member', 'workspace', request), status(503));
  const f = fixture(); assert.throws(() => f.service.readVersion('member', 'workspace', 'bad'), status(400));
  const ref = await f.service.createVersion('member', 'workspace', request);
  assert.throws(() => new Service(undefined, f.tx).resolveInTransaction(f.tx, scope, ref.scriptVersionId), status(503));
});
