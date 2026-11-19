import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const status = code => error => error.getStatus?.() === code;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
test('AF227 real original document transaction source, fresh session and additive PG relation structure', { timeout: 360000 }, async t => {
 assert.equal(process.env.AIJ_AF227_ROOT_ACCEPTANCE, 'true');
 const f = await createRemainingClientFixture('AF-227', { workbenchTargetSafety: true, storageEnabled: true,
  documentExport: { approvedImage: 'sha256:b2322ac98afa484dd6722fc3e19775fca9c0bc8e360e9843b9dd0da663a602c1', dockerCliPath: '/usr/local/bin/docker' } });
 const cases = [], renderer = []; let failure, phase = 'SETUP', storage;
 const sub = async (name, fn) => { phase = name; let error; await t.test(name, async () => { try { await fn(); cases.push(name); } catch (e) { error = e; throw e; } }); if (error) throw error; };
 const db = fn => withDatabase('test', readDatabaseEnvironment('test', process.env, f.lease.id), fn, { acceptanceId: f.lease.id });
 const { PersonalDocumentsService } = f.requireApi('documents/personal-documents.service.js');
 const { buildPersonalDocumentSectionIndex } = f.requireApi('documents/personal-document-sections.js');
 const { ClientAuthGuard } = f.requireApi('client-auth/client-auth.guard.js');
 const { ClientAuthService } = f.requireApi('client-auth/client-auth.service.js');
 const { LocalStorageAdapter } = f.requireApi('files/local-storage.adapter.js');
 const service = f.app.get(PersonalDocumentsService), auth = f.app.get(ClientAuthService);
 const member = f.accounts[0].id, workspace = f.workspaces[0].id, scope = { projectId: f.project.id, workspaceId: workspace, memberId: member };
 const req = { headers: { cookie: f.cookies[0] } }; await f.app.get(ClientAuthGuard).canActivate({ switchToHttp: () => ({ getRequest: () => req }) });
 const gate = tx => auth.assertSessionInTransaction(tx, req.clientClaims);
 const selector = (doc, section = 'section-0') => ({ documentId: doc.id, expectedRevision: doc.revision, bodySha256: hash(doc.body), sectionId: section });
 const resolve = (selection, purpose = 'read', authorize = gate, s = scope) => f.prisma.$transaction(tx => service.resolveGenerationSourceInTransaction(tx, s, selection, purpose, authorize));
 const inspect = selection => f.prisma.$transaction(tx => service.inspectGenerationSourceInTransaction(tx, scope, selection, gate));
 const runtime = () => Promise.all([f.prisma.aiAgentRun.count(), f.prisma.runtimeJob.count(), f.prisma.aiEvaluationBudgetReservation.count(), f.prisma.aiExecutionTrace.count(), f.prisma.aiPersonalDocumentRunOrigin.count()]);
 const sqlState = async (sql, values = []) => db(async c => { try { await c.query(sql, values); return null; } catch (error) { return error.code; } });
 const lockRace = async ({ begin, pending, commit, after }) => {
  const ready = deferred(), release = deferred(); let outcome;
  const locked = db(async c => { await c.query('BEGIN'); try { await begin(c); ready.resolve(); await release.promise; await commit(c); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } });
  await ready.promise; const work = Promise.resolve().then(pending).then(value => { outcome = { value }; }, error => { outcome = { error }; });
  try {
   let waiting = 0;
   for (let i = 0; i < 150; i++) { waiting = await db(async c => (await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'")).rows[0].n); if (waiting) break; await new Promise(r => setTimeout(r, 20)); }
   assert.ok(waiting > 0, 'Original service must actually wait on an independent PG connection');
   release.resolve(); await locked; await work; await after(outcome);
  } finally { release.resolve(); await locked; await work; }
 };
 let doc, initial, oldExport, oldBytes, exports, documents;
 try {
  const sdk = await import('../../packages/sdk/dist/index.mjs'), raw = sdk.createClientApi(() => f.baseUrl);
  const request = (path, options = {}) => raw(path, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), cookie: f.cookies[0], origin: process.env.WEB_URL, connection: 'close' } });
  documents = sdk.createPersonalDocumentsClient(request); exports = sdk.createPersonalDocumentExportsClient(request); storage = f.app.get(LocalStorageAdapter);
  doc = await documents.create(workspace, { code: 'af227-source', name: 'Source', body: 'AF227 original renderer-supported export reference.' }); initial = await documents.getVersion(workspace, doc.id, 1);
  const { DocumentExportProfile } = f.requireApi('documents/document-export-profile.js');
  const executor = f.app.get(DocumentExportProfile).executor, originalRender = executor.run.bind(executor);
  executor.run = async (...args) => { const result = await originalRender(...args); renderer.push({ format: args[0]?.input?.format, outcome: result.outcome, cleanupConfirmed: result.cleanupConfirmed }); return result; };
  oldExport = []; oldBytes = [];
  for (const format of ['docx', 'pdf']) { phase = 'SETUP_EXPORT_' + format; const e = await exports.create(workspace, { documentId: doc.id, expectedRevision: 1, format }); oldExport.push(e); oldBytes.push(hash((await exports.download(workspace, e)).bytes)); }
  doc = await documents.update(workspace, doc.id, { expectedRevision: 1, name: doc.name, body: '# Original 😀\r\nquotation "a" \\ tab\t e\u0301\r\n## Other\nretained' });
  const before = await runtime(); assert.deepEqual(before, [0, 0, 0, 0, 0]);
  await sub('existing renderer unsupported-glyph refusal remains explicit while source UTF16 text is preserved', async () => {
   await assert.rejects(exports.create(workspace, { documentId: doc.id, expectedRevision: doc.revision, format: 'docx' }), error => error.status === 503);
   assert.equal(renderer.at(-1).outcome, 'RENDERER_REJECTED'); assert.equal(renderer.at(-1).cleanupConfirmed, true); assert.deepEqual(await runtime(), before);
  });
  await sub('actual additive migration has five scoped validated FKs and immutable/exclusion guards', async () => {
   const constraints = await db(async c => (await c.query("SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.ai_personal_document_run_origin'::regclass")).rows);
   const keys = ['document_run_origin_run_fk', 'document_run_origin_document_fk', 'document_run_origin_version_fk', 'document_run_origin_agent_fk', 'document_run_origin_session_fk'];
   assert.equal(constraints.filter(c => c.contype === 'f').length, 5);
   for (const key of keys) { const c = constraints.find(c => c.conname === key); assert.ok(c?.convalidated); assert.match(c.definition, /ON UPDATE RESTRICT ON DELETE RESTRICT/); }
   assert.ok(constraints.some(c => c.conname === 'document_run_origin_ref_identity' && c.contype === 'c'));
   const triggers = await db(async c => (await c.query("SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.ai_personal_document_run_origin'::regclass,'public.ai_personal_workflow_run_origin'::regclass) AND NOT tgisinternal")).rows.map(r => r.tgname));
   for (const name of ['document_run_origin_immutable', 'document_run_origin_no_truncate', 'document_run_origin_insert', 'workflow_run_origin_document_exclusion']) assert.ok(triggers.includes(name));
   assert.equal(await sqlState('TRUNCATE public.ai_personal_document_run_origin'), '55000');
   assert.equal((await db(async c => (await c.query("SELECT count(*)::int n FROM public._prisma_migrations WHERE migration_name='20261108160000_personal_document_run_origin' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")).rows[0])).n, 1);
  });
  await sub('SQL UTF8 digest exactly matches original JSON.stringify escaping without copied raw instruction', async () => {
   for (const [instruction, source] of [['a', 'b'], ['quote" slash\\\t\r\n', '# 中文😀\r\ne\u0301'], ['\b\f\u0001', 'line\u2028separator\u2029'], ['Bearer synthetic-secret', 'x'.repeat(2000)]]) {
    const row = await db(async c => (await c.query("SELECT encode(sha256(convert_to('[[\"instruction\",'||to_json($1::text)::text||'],[\"source\",'||to_json($2::text)::text||']]','UTF8')),'hex') AS digest", [instruction, source])).rows[0]);
    assert.equal(row.digest, hash(JSON.stringify([['instruction', instruction], ['source', source]])));
   }
  });
  await sub('same caller transaction supplies exact current full slice and original session callback', async () => {
   let callbacks = 0;
   const result = await f.prisma.$transaction(async tx => service.resolveGenerationSourceInTransaction(tx, scope, selector(doc), 'execute', async current => { assert.strictEqual(current, tx); callbacks++; await gate(current); }));
   const index = buildPersonalDocumentSectionIndex({ id: doc.id, revision: doc.revision, body: doc.body }), section = index.sections[0];
   assert.equal(result.text, doc.body.slice(section.start, section.end)); assert.equal(result.ref.sectionSha256, hash(result.text)); assert.ok(Object.isFrozen(result.ref)); assert.equal(result.projectId, scope.projectId); assert.equal(callbacks, 1);
   assert.deepEqual(await inspect(selector(doc)), { projectId: scope.projectId, documentCurrent: true });
   assert.deepEqual(await runtime(), before);
  });
  await sub('session callback failure rolls back caller writes and no nested transaction is substituted', async () => {
   const count = await f.prisma.auditLog.count({ where: { action: 'af227_rollback_probe' } });
   await assert.rejects(f.prisma.$transaction(async tx => {
    await tx.auditLog.create({ data: { module: 'af227', action: 'af227_rollback_probe', status: 'success', resourceType: 'personal_document', resourceId: doc.id } });
    await service.resolveGenerationSourceInTransaction(tx, scope, selector(doc), 'read', async current => { assert.strictEqual(current, tx); await gate(current); throw Error('AF227_OWNED_FAULT'); });
   }), status(503));
   assert.equal(await f.prisma.auditLog.count({ where: { action: 'af227_rollback_probe' } }), count);
   await assert.rejects(f.prisma.$transaction(tx => service.resolveGenerationSourceInTransaction(tx, scope, selector(doc), 'read', undefined)), status(503));
  });
  const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
  const grant = code => f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code } } });
  await sub('current read works without export/manage/execute; execution still requires both write grants', async () => {
   const removed = await Promise.all(['workspace.documents.export', 'workspace.documents.manage', 'workspace.ai.execute'].map(grant));
   for (const row of removed) await f.prisma.clientWorkspaceRolePermission.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
   try { assert.equal((await resolve(selector(doc))).ref.documentId, doc.id); assert.equal((await inspect(selector(doc))).documentCurrent, true); await assert.rejects(resolve(selector(doc), 'execute'), status(403)); }
   finally { for (const row of removed) await f.prisma.clientWorkspaceRolePermission.update({ where: { id: row.id }, data: { deletedAt: row.deletedAt } }); }
   for (const code of ['workspace.documents.manage', 'workspace.ai.execute', 'workspace.documents.read', 'workspace.ai.read', 'workspace.ai.assets.read']) {
    const row = await grant(code); await f.prisma.clientWorkspaceRolePermission.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    try { await assert.rejects(resolve(selector(doc), 'execute'), status(403)); if (!['workspace.documents.manage', 'workspace.ai.execute'].includes(code)) { await assert.rejects(resolve(selector(doc)), status(403)); await assert.rejects(inspect(selector(doc)), status(403)); } }
    finally { await f.prisma.clientWorkspaceRolePermission.update({ where: { id: row.id }, data: { deletedAt: row.deletedAt } }); }
   }
  });
  await sub('cross member/document/project and plugin/project/role/membership current refusal', async () => {
   const ownerMembership = await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: workspace, memberId: member } } });
   await f.prisma.clientWorkspaceMembership.create({ data: { workspaceId: workspace, memberId: f.accounts[1].id, roleId: role.id } });
   await assert.rejects(resolve(selector(doc), 'read', gate, { ...scope, memberId: f.accounts[1].id }), status(404));
   await assert.rejects(resolve(selector(doc), 'read', gate, { ...scope, projectId: randomUUID() }), status(409));
   for (const [model, id, next] of [[f.prisma.clientWorkspaceMembership, ownerMembership.id, 'disabled'], [f.prisma.clientWorkspaceRole, role.id, 'disabled'], [f.prisma.projectProfile, scope.projectId, 'disabled'], [f.prisma.pluginInstallation, (await f.prisma.pluginInstallation.findFirstOrThrow({ where: { projectId: scope.projectId, pluginCode: 'aij-ai' } })).id, 'installed']]) {
    const previous = await model.findUniqueOrThrow({ where: { id } }); await model.update({ where: { id }, data: { status: next } });
    try { await assert.rejects(resolve(selector(doc)), error => [403, 404, 503].includes(error.getStatus?.())); }
    finally { await model.update({ where: { id }, data: { status: previous.status } }); }
   }
  });
  await sub('real independent grant lock waits then current revocation refuses before session or source release', async () => {
   const row = await grant('workspace.documents.read'); let callbacks = 0;
   try { await lockRace({ begin: c => c.query('UPDATE public.client_workspace_role_permission SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1', [row.id]), pending: () => resolve(selector(doc), 'read', async tx => { callbacks++; await gate(tx); }), commit: async () => {}, after: outcome => { assert.ok(status(403)(outcome.error)); assert.equal(callbacks, 0); } }); }
   finally { await f.prisma.clientWorkspaceRolePermission.update({ where: { id: row.id }, data: { deletedAt: row.deletedAt } }); }
  });
  await sub('real independent document row lock waits then deletion refuses current body', async () => {
   const doomed = await documents.create(workspace, { code: 'af227-concurrent-delete', name: 'Deletion', body: '# Owned\nbody' });
   let callbacks = 0;
   await lockRace({ begin: c => c.query('SELECT id FROM public.personal_document WHERE id=$1::uuid FOR UPDATE', [doomed.id]), pending: () => resolve(selector(doomed), 'read', async tx => { callbacks++; await gate(tx); }), commit: c => c.query('UPDATE public.personal_document SET deleted_at=CURRENT_TIMESTAMP WHERE id=$1::uuid', [doomed.id]), after: outcome => { assert.ok(status(404)(outcome.error)); assert.equal(callbacks, 0); } });
   assert.ok((await f.prisma.personalDocument.findUniqueOrThrow({ where: { id: doomed.id } })).deletedAt);
  });
  await sub('real independent original session lock waits then actual clock expiry refuses after document lock', async () => {
   const session = await f.prisma.clientAuthSession.findUniqueOrThrow({ where: { id: req.clientClaims.sessionId } });
   try { await lockRace({ begin: c => c.query("UPDATE public.client_auth_session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [session.id]), pending: () => resolve(selector(doc)), commit: async () => {}, after: outcome => { assert.ok(status(401)(outcome.error)); } }); }
   finally { await f.prisma.clientAuthSession.update({ where: { id: session.id }, data: { expiresAt: session.expiresAt } }); }
  });
  await sub('whole source 2000 accepted; 2001, blank and empty rejected without truncation or runtime writes', async () => {
   for (const [code, body, expected] of [['limit', '# A\r\n' + '😀'.repeat(997) + 'x', 2000], ['over', '# A\r\n' + 'x'.repeat(1996), 400], ['blank', ' \t\r\n', 400], ['empty', '', 400]]) {
    const current = await documents.create(workspace, { code: 'af227-' + code, name: 'Boundary', body });
    if (expected === 2000) assert.equal((await resolve(selector(current))).text.length, 2000);
    else await assert.rejects(resolve(selector(current)), status(expected));
   }
   assert.deepEqual(await runtime(), before);
  });
  await sub('changed revision/body is conflict while metadata inspect returns false even for invalid new heading', async () => {
   const old = selector(doc); doc = await documents.update(workspace, doc.id, { expectedRevision: doc.revision, name: doc.name, body: '# ' + 'x'.repeat(257) });
   await assert.rejects(resolve(old), status(409)); assert.deepEqual(await inspect(old), { projectId: scope.projectId, documentCurrent: false });
   await assert.rejects(resolve(selector(doc)), status(400));
   assert.deepEqual(await documents.getVersion(workspace, doc.id, 1), initial);
   for (const [i, item] of oldExport.entries()) { assert.deepEqual(await exports.get(workspace, item.id), item); assert.equal(hash((await exports.download(workspace, item)).bytes), oldBytes[i]); }
   assert.deepEqual(await runtime(), before);
  });
  await sub('current original logout revokes session even on metadata-only inspect', async () => {
   await f.request('POST', 'client/auth/logout', { cookie: f.cookies[0] });
   await assert.rejects(inspect(selector(doc)), status(401));
   assert.deepEqual(await runtime(), before);
  });
  await writeFile(join(f.artifactDirectory, 'source-proof.json'), JSON.stringify({ status: 'PASS', task: 'AF-227', acceptanceId: f.lease.id, cases, originalRuntimeWrites: 0, renderer, existingRendererUnsupportedGlyphRefusalPreserved: true, oldDocumentHistoryAndExportBytesPreserved: true, originalSessionSameTransaction: true, originRowsAndRuntimeBinding: 'NOT_RUN_DEFERRED_TO_AF228', ownerAcceptance: 'PENDING' }, null, 2), { mode: 0o600 });
 } catch (error) { failure = error; await writeFile(join(f.artifactDirectory, 'source-failure.json'), JSON.stringify({ phase, httpStatus: error?.status ?? null, renderer, code: error?.code ?? 'FAILED', frames: String(error?.stack ?? '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 7) }, null, 2), { mode: 0o600 }); }
 finally {
  if (storage) for (const asset of await f.prisma.fileAsset.findMany({ select: { objectKey: true } })) if (await storage.exists(asset.objectKey)) await storage.remove(asset.objectKey);
  const closed = await f.close(); assert.equal(closed.applicationPools0, true); assert.equal(closed.ownedSockets0, true); assert.equal(closed.environmentRestored, true);
 }
 if (failure) throw Error('AF227_REAL_SOURCE_FAILED_AT_' + phase);
});
