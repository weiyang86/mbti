import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { ClientClaims } from '../src/client-auth/client-auth.security';
import { redactAiExternalText } from '../src/plugins/aij-ai/deepseek-provider';
import { AiPersonalDocumentRunOriginService, DocumentSourceRuntimePort, DocumentGenerationSessionPort,
  type DocumentGenerationRef, type DocumentGenerationRun, type DocumentSectionRef, type DocumentGenerationScope, type SessionGate,
  type OriginRow, parseDocumentGenerationRef, parseDocumentSectionRef, parseDocumentSectionSelector, documentGenerationMarker,
  documentGenerationInputDigest, documentGenerationRequestHash, makeDocumentGenerationOrigin, withoutDocumentGenerationMarker,
} from '../src/plugins/aij-ai/ai-personal-document-run-origin.service';

const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const scope: DocumentGenerationScope = { projectId: 'project', workspaceId: 'workspace', memberId: 'member' };
const claims: ClientClaims = { sub: 'member', sessionId: 'session_original', tokenVersion: 2 };
const fresh: ClientClaims = { sub: 'member', sessionId: 'session_fresh', tokenVersion: 3 };
const agentId = '12345678-1234-4123-8123-123456789abc';
const documentId = '87654321-4321-4321-8321-cba987654321';
const text = '# 来源\r\n😀 contact alpha@example.com';
const instruction = '扩写此段，联系 beta@example.com';
const section = (body = text): DocumentSectionRef => ({ format: 'aij-document-section-source-v1', indexFormat: 'aij-plain-sections-v1',
  documentId, revision: 1, bodySha256: hash(body), sectionId: 'section-0', start: 0, end: body.length, sectionSha256: hash(body) });
function snapshot() {
  return { source: { type: 'personal', agentId, versionId: 'agent_version_1', revision: 1, publicationVersion: 4, skills: [] },
    agent: { code: 'personal:' + agentId, revision: 1, modelCode: 'text-model', enabled: true, published: true,
      inputFields: ['source', 'instruction'], outputFormat: 'text' }, model: { code: 'text-model', revision: 2, capability: 'text', enabled: true },
    provider: { code: 'original-provider' }, skills: [] };
}
function fixture(body = text, rawInstruction = instruction) {
  const base = snapshot(), made = makeDocumentGenerationOrigin({ ref: section(body), text: body }, base, rawInstruction, '123', 3);
  const run: DocumentGenerationRun = { ...scope, id: 'run_1', agentCode: 'personal:' + agentId, agentRevision: 1, catalogVersion: 3,
    snapshot: { ...base, source: { ...base.source, documentOrigin: made.ref } },
    input: { source: redactAiExternalText(body), instruction: redactAiExternalText(rawInstruction) }, contentPurgedAt: null };
  const row: OriginRow = { run_id: run.id, project_id: scope.projectId, workspace_id: scope.workspaceId, member_id: scope.memberId,
    document_id: documentId, document_revision: 1, agent_id: agentId, agent_version_id: 'agent_version_1', agent_revision: 1,
    ref: made.ref, session_id: claims.sessionId, token_version: claims.tokenVersion };
  return { run, row, made };
}
function harness(body = text, withRow = true) {
  const f = fixture(body), events: string[] = [], sessions: ClientClaims[] = [], writes: unknown[][] = [], audits: unknown[] = [];
  let rows: unknown[] = withRow ? [f.row] : [], current = true, sessionError: Error | undefined;
  let gateMode: 'normal' | 'skip' | 'wrong-tx' | 'swallow' | 'duplicate' = 'normal';
  const tx = { $queryRaw: async (_sql: unknown, ...values: unknown[]) => { events.push('relation'); assert.deepEqual(values, ['run_1']); return rows; },
    $executeRaw: async (_sql: unknown, ...values: unknown[]) => { writes.push(values); return 1; },
    auditLog: { create: async (data: unknown) => { audits.push(data); return data; } } } as unknown as Prisma.TransactionClient;
  const gate = async (t: Prisma.TransactionClient, authorize: SessionGate) => {
    if (gateMode === 'skip') return;
    if (gateMode === 'swallow') { try { await authorize(t); } catch { /* simulate a broken adapter */ } return; }
    await authorize(gateMode === 'wrong-tx' ? {} as Prisma.TransactionClient : t);
    if (gateMode === 'duplicate') await authorize(t);
  };
  const documents: DocumentSourceRuntimePort = {
    async resolveInTransaction(t, gotScope, selector, purpose, authorize) {
      assert.equal(t, tx); assert.deepEqual(gotScope, scope); assert.equal(selector.documentId, documentId);
      events.push('document:' + purpose); await gate(t, authorize);
      return { projectId: scope.projectId, ref: section(body), text: body };
    },
    async inspectInTransaction(t, gotScope, _selector, authorize) {
      assert.equal(t, tx); assert.deepEqual(gotScope, scope); events.push('inspect'); await gate(t, authorize);
      return { projectId: scope.projectId, documentCurrent: current };
    }
  };
  const sessionPort: DocumentGenerationSessionPort = { async assertSessionInTransaction(t, c) {
    assert.equal(t, tx); events.push('session'); sessions.push(c); if (sessionError) throw sessionError;
  } };
  return { ...f, tx, documents, sessionPort, service: new AiPersonalDocumentRunOriginService(documents, sessionPort), events, sessions, writes, audits,
    setRows: (value: unknown[]) => { rows = value; }, setCurrent: (value: boolean) => { current = value; },
    setGate: (value: typeof gateMode) => { gateMode = value; }, setSessionError: (value: Error) => { sessionError = value; } };
}
function status(code: number) { return (error: unknown) => {
  assert.equal((error as { getStatus(): number }).getStatus(), code); return true;
}; }
const selector = () => ({ documentId, expectedRevision: 1, bodySha256: hash(text), sectionId: 'section-0' });

test('ref has canonical fixed key order, detached frozen nested refs, UTF16 and UTF8 remain exact', () => {
  const raw = fixture().made.ref;
  const reordered = Object.fromEntries(Object.entries(raw).reverse());
  const parsed = parseDocumentGenerationRef(reordered);
  assert.deepEqual(parsed, raw); assert.notEqual(parsed, raw); assert.notEqual(parsed.document, raw.document);
  assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.document));
  assert.equal(parsed.document.end, text.length); assert.equal(parsed.document.sectionSha256, hash(text));
  assert.equal(parsed.instructionSha256, hash(instruction));
  assert.equal(parsed.inputSha256, hash(JSON.stringify([['instruction', redactAiExternalText(instruction)], ['source', redactAiExternalText(text)]])));
  assert.notEqual(parsed.inputSha256, hash(JSON.stringify([['instruction', instruction], ['source', text]])));
  assert.equal(documentGenerationRequestHash(raw, instruction), documentGenerationRequestHash(reordered as DocumentGenerationRef, instruction));
});

test('null-prototype data is accepted and copied without mutating input', () => {
  const raw = Object.assign(Object.create(null), fixture().made.ref);
  const before = JSON.stringify(raw); assert.deepEqual(parseDocumentGenerationRef(raw), fixture().made.ref); assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(parseDocumentSectionSelector(Object.assign(Object.create(null), selector())), selector());
});

test('distinct raw instructions sharing redaction occupy distinct idempotency hash domains', () => {
  const a = fixture(text, 'mail alpha@example.com'), b = fixture(text, 'mail bravo@example.com');
  assert.equal(a.made.ref.inputSha256, b.made.ref.inputSha256);
  assert.notEqual(a.made.ref.instructionSha256, b.made.ref.instructionSha256);
  assert.notEqual(documentGenerationRequestHash(a.made.ref, a.made.input.instruction), documentGenerationRequestHash(b.made.ref, b.made.input.instruction));
  assert.throws(() => documentGenerationRequestHash(a.made.ref, b.made.input.instruction), status(409));
});

test('source and instruction bounds never truncate or normalize', () => {
  const make = (body: string, raw = instruction) => makeDocumentGenerationOrigin({ ref: section(body), text: body }, snapshot(), raw, '0', 1);
  assert.equal(make('x'.repeat(2000), ' x ').input.instruction, ' x ');
  for (const body of ['', ' \r\n', 'x'.repeat(2001)]) assert.throws(() => make(body), status(400));
  for (const raw of ['', ' \t', 'x'.repeat(2001)]) assert.throws(() => make(text, raw), status(400));
  assert.throws(() => makeDocumentGenerationOrigin({ ref: section(text), text: text.replace('\r\n', '\n') }, snapshot(), instruction, '0', 1), status(400));
  assert.notEqual(make('é').ref.document.bodySha256, make('e\u0301').ref.document.bodySha256);
});

test('refs reject extra keys, malformed canonical identities, revisions, offsets and bigint costs', () => {
  const ref = fixture().made.ref;
  for (const patch of [{ extra: 1 }, { agentId: agentId.toUpperCase() }, { agentVersionId: '' }, { agentRevision: 0 },
    { agentPublicationEpoch: 1.5 }, { catalogVersion: 2147483648 }, { modelRevision: 0 }, { modelCode: 'Bad' },
    { instructionSha256: 'A'.repeat(64) }, { maximumEstimatedCostNanos: '01' }, { maximumEstimatedCostNanos: '9223372036854775808' }])
    assert.throws(() => parseDocumentGenerationRef({ ...ref, ...patch }), status(400));
  for (const patch of [{ start: -1 }, { end: 65537 }, { end: 0 }, { revision: 201 }, { sectionId: 'section-01' }, { sectionId: 'section-128' }])
    assert.throws(() => parseDocumentSectionRef({ ...ref.document, ...patch }), status(400));
  assert.equal(parseDocumentGenerationRef({ ...ref, maximumEstimatedCostNanos: '9223372036854775807' }).maximumEstimatedCostNanos, '9223372036854775807');
});

test('reject accessors, symbol/hidden fields, arrays, class/prototype objects and pollution without invoking getter', () => {
  const ref = fixture().made.ref; let reads = 0;
  const getter = { ...ref }; Object.defineProperty(getter, 'agentId', { enumerable: true, get() { reads++; throw new Error('secret'); } });
  const hidden = { ...ref }; Object.defineProperty(hidden, 'secret', { value: 1 });
  const symbol = { ...ref, [Symbol('secret')]: 1 };
  const polluted = JSON.parse(JSON.stringify(ref).replace('"format":', '"__proto__":{},"format":'));
  for (const raw of [getter, hidden, symbol, polluted, [], new (class { value = ref; })(), Object.assign(Object.create({ inherited: 1 }), ref)])
    assert.throws(() => parseDocumentGenerationRef(raw), status(400));
  assert.equal(reads, 0);
  const bad = snapshot(); Object.defineProperty(bad.source, 'agentId', { enumerable: true, get() { reads++; return agentId; } });
  assert.throws(() => makeDocumentGenerationOrigin({ ref: section(), text }, bad, instruction, '0', 1), status(400)); assert.equal(reads, 0);
});

test('make requires personal published text Agent, exact two fields and current matching model', () => {
  for (const change of [
    (s: ReturnType<typeof snapshot>) => { s.source.type = 'catalog'; },
    (s: ReturnType<typeof snapshot>) => { s.agent.published = false; },
    (s: ReturnType<typeof snapshot>) => { s.agent.outputFormat = 'json'; },
    (s: ReturnType<typeof snapshot>) => { s.model.capability = 'image'; },
    (s: ReturnType<typeof snapshot>) => { s.agent.inputFields = ['source', 'source']; },
    (s: ReturnType<typeof snapshot>) => { s.agent.inputFields.push('extra'); },
    (s: ReturnType<typeof snapshot>) => { s.agent.revision++; },
    (s: ReturnType<typeof snapshot>) => { s.agent.modelCode = 'other-model'; },
    (s: ReturnType<typeof snapshot>) => { Object.assign(s.source, { workflowOrigin: {} }); }
  ]) { const s = snapshot(); change(s); assert.throws(() => makeDocumentGenerationOrigin({ ref: section(), text }, s, instruction, '1', 1), status(409)); }
  const s = snapshot(); s.agent.inputFields.reverse(); assert.ok(makeDocumentGenerationOrigin({ ref: section(), text }, s, instruction, '1', 1));
});

test('legacy requires BOTH marker and relation absent; single missing side always rejects', async () => {
  const h = harness(); h.setRows([]);
  await h.service.assertOriginCurrent(h.tx, { ...h.run, snapshot: snapshot() });
  assert.deepEqual(h.events, ['relation']);
  await assert.rejects(h.service.assertOriginCurrent(h.tx, h.run), status(409));
  h.setRows([h.row]); await assert.rejects(h.service.assertOriginCurrent(h.tx, { ...h.run, snapshot: snapshot() }), status(409));
});

test('relation is looked up by run ID first and rejects cross-scope and identity mismatches', async () => {
  const h = harness();
  for (const patch of [{ run_id: 'other' }, { project_id: 'other' }, { workspace_id: 'other' }, { member_id: 'other' },
    { document_id: agentId }, { document_revision: 2 }, { agent_id: documentId }, { agent_version_id: 'other' }, { agent_revision: 2 }]) {
    h.setRows([{ ...h.row, ...patch }]); await assert.rejects(h.service.relation(h.tx, h.run), status(409));
  }
  h.setRows([h.row, h.row]); await assert.rejects(h.service.relation(h.tx, h.run), status(409));
  h.setRows([h.row]); const found = await h.service.relation(h.tx, h.run); assert.ok(Object.isFrozen(found)); assert.notEqual(found?.ref, h.row.ref);
});

test('execute uses original session and read uses this request fresh session, within document callback same TX', async () => {
  const h = harness(); await h.service.assertOriginCurrent(h.tx, h.run);
  assert.deepEqual(h.events, ['relation', 'document:execute', 'session']); assert.deepEqual(h.sessions, [claims]);
  h.events.length = 0; await h.service.assertOriginCurrent(h.tx, h.run, fresh);
  assert.deepEqual(h.events, ['relation', 'document:read', 'session']); assert.deepEqual(h.sessions[1], fresh);
});

test('missing ports fail 503, skipped/wrong/duplicate gate fails closed and swallowed session failure survives', async () => {
  const h = harness();
  for (const svc of [new AiPersonalDocumentRunOriginService(), new AiPersonalDocumentRunOriginService(h.documents),
    new AiPersonalDocumentRunOriginService(undefined, h.sessionPort)])
    await assert.rejects(svc.resolveSource(h.tx, scope, selector(), claims, 'execute'), status(503));
  for (const mode of ['skip', 'wrong-tx', 'duplicate'] as const) {
    h.setGate(mode); await assert.rejects(h.service.resolveSource(h.tx, scope, selector(), claims, 'execute'), status(503));
  }
  h.setGate('swallow'); h.setSessionError(new Error('revoked'));
  await assert.rejects(h.service.resolveSource(h.tx, scope, selector(), claims, 'read'), /revoked/);
});

test('unawaited async session callback cannot satisfy the source gate', async () => {
  const h = harness(); let release!: () => void;
  const sessions: DocumentGenerationSessionPort = { async assertSessionInTransaction() { await new Promise<void>(r => { release = r; }); } };
  const documents: DocumentSourceRuntimePort = { inspectInTransaction: h.documents.inspectInTransaction.bind(h.documents), async resolveInTransaction(tx, _s, _sel, _p, gate) {
    void gate(tx); return { projectId: scope.projectId, ref: section(), text };
  } };
  const svc = new AiPersonalDocumentRunOriginService(documents, sessions);
  await assert.rejects(svc.resolveSource(h.tx, scope, selector(), claims, 'execute'), status(503)); release();
});

test('source results require correct scope, selector and raw hash, not only redacted equality', async () => {
  const h = harness(), altered = text.replace('alpha', 'bravo');
  assert.equal(redactAiExternalText(text), redactAiExternalText(altered));
  for (const patch of [{ projectId: 'other' }, { ref: section(altered), text: altered }, { text: altered },
    { ref: { ...section(), sectionId: 'section-1' } }]) {
    const docs: DocumentSourceRuntimePort = { inspectInTransaction: h.documents.inspectInTransaction.bind(h.documents), async resolveInTransaction(tx, _s, _sel, _p, gate) {
      await gate(tx); return { projectId: scope.projectId, ref: section(), text, ...patch };
    } };
    await assert.rejects(new AiPersonalDocumentRunOriginService(docs, h.sessionPort).resolveSource(h.tx, scope, selector(), claims, 'execute'));
  }
});

test('assertCurrent rejects changed raw source even if redacted source and digest stay equal', async () => {
  const original = fixture(), h = harness(text.replace('alpha', 'bravo'));
  h.setRows([original.row]); await assert.rejects(h.service.assertOriginCurrent(h.tx, original.run), status(409));
});

test('stored input must be exact redacted two fields and digest bound to marker/relation', async () => {
  const h = harness();
  for (const input of [{ source: text, instruction }, { ...(h.run.input as object), extra: 'x' },
    { ...(h.run.input as object), instruction: 'changed' }, { source: 1, instruction: 'text' }])
    await assert.rejects(h.service.assertOriginCurrent(h.tx, { ...h.run, input }));
  assert.throws(() => documentGenerationInputDigest({ source: text }), status(400));
  await assert.rejects(h.service.assertOriginCurrent(h.tx, { ...h.run, catalogVersion: 4 }), status(409));
});

test('record requires earlier execute gate on SAME tx, validates input/marker, then inserts and small audit only', async () => {
  const h = harness();
  await assert.rejects(h.service.recordOrigin(h.tx, h.run, h.made.ref, claims), status(409));
  await h.service.resolveSource(h.tx, scope, selector(), claims, 'read');
  await assert.rejects(h.service.recordOrigin(h.tx, h.run, h.made.ref, claims), status(409));
  await h.service.resolveSource(h.tx, scope, selector(), claims, 'execute');
  await assert.rejects(h.service.recordOrigin({ ...h.tx } as Prisma.TransactionClient, h.run, h.made.ref, claims), status(409));
  await assert.rejects(h.service.recordOrigin(h.tx, h.run, h.made.ref, fresh), status(409));
  const before = [...h.events]; await h.service.recordOrigin(h.tx, h.run, h.made.ref, claims);
  assert.deepEqual(h.events, before); assert.equal(h.writes.length, 1); assert.equal(h.audits.length, 1);
  const persisted = JSON.stringify([h.writes, h.audits]); assert.ok(!persisted.includes('alpha@example.com')); assert.ok(!persisted.includes(instruction));
  assert.ok(!JSON.stringify(h.audits).includes(h.made.ref.inputSha256));
});

test('record rejects snapshot/ref/input mismatch and unsafe claims without any writes', async () => {
  const h = harness(); await h.service.resolveSource(h.tx, scope, selector(), claims, 'execute');
  for (const run of [{ ...h.run, snapshot: snapshot() }, { ...h.run, input: { source: 'bad', instruction: 'bad' } }, { ...h.run, agentRevision: 9 }])
    await assert.rejects(h.service.recordOrigin(h.tx, run, h.made.ref, claims));
  await assert.rejects(h.service.recordOrigin(h.tx, h.run, h.made.ref, { ...claims, sub: 'other' }), status(401));
  assert.deepEqual(h.writes, []); assert.deepEqual(h.audits, []);
});

test('metadata inspect uses fresh session and source inspect, returns current=false without text/output', async () => {
  const h = harness(); h.setCurrent(false);
  const result = await h.service.inspectOrigin(h.tx, h.run, fresh);
  assert.deepEqual(Object.keys(result), ['origin', 'documentCurrent']); assert.equal(result.documentCurrent, false);
  assert.deepEqual(h.events, ['relation', 'inspect', 'session']); assert.deepEqual(h.sessions, [fresh]);
  assert.notEqual(result.origin, h.row.ref); assert.ok(!JSON.stringify(result).includes('alpha@example.com'));
});

test('metadata recovery after real purge uses durable row only; no timestamp/mixed marker/content means rejection', async () => {
  const h = harness(), purged = { ...h.run, snapshot: null, input: null, contentPurgedAt: new Date() };
  h.setCurrent(false); assert.equal((await h.service.inspectOrigin(h.tx, purged, fresh)).documentCurrent, false);
  for (const run of [{ ...purged, contentPurgedAt: null }, { ...purged, contentPurgedAt: undefined },
    { ...purged, contentPurgedAt: new Date(NaN) }, { ...purged, snapshot: {} }, { ...purged, input: {} },
    { ...purged, snapshot: h.run.snapshot }, { ...h.run, snapshot: { ...snapshot(), source: { ...snapshot().source, documentOrigin: { ...h.made.ref, modelRevision: 9 } } } }])
    await assert.rejects(h.service.inspectOrigin(h.tx, run, fresh));
  await assert.rejects(h.service.assertOriginCurrent(h.tx, purged), status(409));
});

test('metadata without relation, cross-scope and missing source/session port cannot expose durable ref', async () => {
  const h = harness(); h.setRows([]); await assert.rejects(h.service.inspectOrigin(h.tx, h.run, fresh), status(404));
  h.setRows([{ ...h.row, workspace_id: 'other' }]); await assert.rejects(h.service.inspectOrigin(h.tx, h.run, fresh), status(409));
  h.setRows([h.row]); await assert.rejects(new AiPersonalDocumentRunOriginService().inspectOrigin(h.tx, h.run, fresh), status(503));
});

test('known marker removal preserves unknown provenance and Memory for original owner deep comparison', () => {
  const h = fixture(), s = h.run.snapshot as ReturnType<typeof snapshot>;
  const extended = { ...s, source: { ...s.source, memoryRefs: [{ memoryId: 'memory', revision: 2 }], futureExtension: { mustReject: true } }, futureRoot: 7 };
  const before = JSON.stringify(extended);
  const stripped = withoutDocumentGenerationMarker(extended, h.made.ref) as typeof extended;
  assert.equal(documentGenerationMarker(stripped), undefined); assert.deepEqual(stripped.source.futureExtension, { mustReject: true });
  assert.deepEqual(stripped.source.memoryRefs, extended.source.memoryRefs); assert.equal(stripped.futureRoot, 7); assert.equal(JSON.stringify(extended), before);
});

test('redaction expansion beyond 2000 UTF16 remains valid stored owner input', async () => {
  const raw = 'Bearer a '.repeat(222).slice(0, 1998), h = harness(raw), f = fixture(raw, raw);
  assert.ok((f.run.input as { source: string }).source.length > 2000);
  h.setRows([f.row]); await h.service.assertOriginCurrent(h.tx, f.run);
});

test('metadata after purge still rejects Run Agent/catalog identity corruption', async () => {
  const h = harness(), purged = { ...h.run, snapshot: null, input: null, contentPurgedAt: new Date() };
  for (const patch of [{ agentCode: 'personal:' + documentId }, { agentRevision: 9 }, { catalogVersion: 9 }])
    await assert.rejects(h.service.inspectOrigin(h.tx, { ...purged, ...patch }, fresh), status(409));
});

test('read session never falls back to persisted session for null or mismatched claims', async () => {
  const h = harness();
  await assert.rejects(h.service.assertOriginCurrent(h.tx, h.run, null as unknown as ClientClaims), status(400));
  await assert.rejects(h.service.assertOriginCurrent(h.tx, h.run, { ...fresh, sub: 'other_member' }), status(401));
  assert.deepEqual(h.sessions, []);
});

test('metadata inspection also enforces mandatory same-TX callback', async () => {
  const h = harness();
  for (const mode of ['skip', 'wrong-tx', 'duplicate'] as const) {
    h.setGate(mode); await assert.rejects(h.service.inspectOrigin(h.tx, h.run, fresh), status(503));
  }
});

test('required INSERT/audit errors propagate to original caller transaction with no retry', async () => {
  const h = harness(); await h.service.resolveSource(h.tx, scope, selector(), claims, 'execute');
  let inserts = 0;
  const original = h.tx.$executeRaw;
  h.tx.$executeRaw = (async () => { inserts++; throw new Error('insert fault'); }) as typeof original;
  await assert.rejects(h.service.recordOrigin(h.tx, h.run, h.made.ref, claims), /insert fault/);
  assert.equal(inserts, 1); assert.deepEqual(h.audits, []);
  h.tx.$executeRaw = original;
  h.tx.auditLog.create = (async () => { throw new Error('audit fault'); }) as unknown as typeof h.tx.auditLog.create;
  await assert.rejects(h.service.recordOrigin(h.tx, h.run, h.made.ref, claims), /audit fault/);
  assert.equal(h.writes.length, 1); // Collaborator proves propagation only; PG rollback remains root-only.
});

test('polluted claims, input, relation and nested snapshot arrays never invoke getters or return metadata', async () => {
  const h = harness(); let calls = 0;
  const input = { source: 'x', instruction: 'x' };
  Object.defineProperty(input, 'source', { enumerable: true, get() { calls++; return text; } });
  await assert.rejects(h.service.assertOriginCurrent(h.tx, { ...h.run, input }), status(400));
  const badClaims = { ...fresh }; Object.defineProperty(badClaims, 'sessionId', { enumerable: true, get() { calls++; return fresh.sessionId; } });
  await assert.rejects(h.service.inspectOrigin(h.tx, h.run, badClaims), status(400));
  const badRow = { ...h.row }; Object.defineProperty(badRow, 'workspace_id', { enumerable: true, get() { calls++; return scope.workspaceId; } });
  h.setRows([badRow]); await assert.rejects(h.service.relation(h.tx, h.run), status(400)); h.setRows([h.row]);
  const s = snapshot(); Object.defineProperty(s.agent.inputFields, '0', { enumerable: true, get() { calls++; return 'source'; } });
  assert.throws(() => makeDocumentGenerationOrigin({ ref: section(), text }, s, instruction, '0', 1), status(400));
  assert.equal(calls, 0);
});
