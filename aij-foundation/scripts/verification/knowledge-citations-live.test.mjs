import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
import { prepareKnowledgeCitationHost, verifyKnowledgeCitationBrowser } from './knowledge-citations-browser.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(r => setTimeout(r, ms));
test('AF214 original knowledge citation HTTP/PG/installed SDK and original native question page', { timeout: 540000 }, async t => {
  assert.equal(process.env.AIJ_AF214_ROOT_ACCEPTANCE, 'true');
  const consumer = realpathSync(process.env.AIJ_AF214_PACKED_CONSUMER);
  assert.match(consumer, /^\/private\/tmp\/aij-af214-packed-[A-Za-z0-9]+$/);
  const artifact = process.env.AIJ_AF214_EVIDENCE;
  const esm = await import(pathToFileURL(join(consumer, 'entry.mjs'))), cjs = createRequire(join(consumer, 'package.json'))('@aij/sdk');
  const host = await prepareKnowledgeCitationHost(artifact);
  let f;
  try {
    f = await createRemainingClientFixture('AF-214', { workbenchTargetSafety: true, configuration: true, secrets: true, runtimeManagement: true,
      pluginManagement: true, realPluginLifecycle: true, testBrowserOrigin: host.origin });
    host.attach(f.baseUrl);
    const p = f.prisma, workspaceId = f.workspaces[0].id, memberId = f.accounts[0].id;
    const proof = { task: 'AF-214', acceptanceId: f.lease.id, database: f.lease.database, cases: [], generationProof: 'Only the native case executes the original offline test Provider and original Job. HTTP fixture questions below are explicitly synthetic source-read fixtures.' };
    const databaseValues = readDatabaseEnvironment('test', process.env, f.lease.id);
    const database = operation => withDatabase('test', databaseValues, operation, { acceptanceId: f.lease.id });
    const role = await p.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId, code: 'OWNER' } } });
    const grant = async (code, enabled) => {
      const g = await p.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code } } });
      await p.clientWorkspaceRolePermission.update({ where: { id: g.id }, data: { deletedAt: enabled ? null : new Date() } });
    };
    const created = (await f.request('POST', 'client/ai/knowledge/documents', { cookie: f.cookies[0], workspaceId, status: 201,
      body: { documentCode: 'af214-current-source', title: 'AF214 current source', content: 'Alpha response window is seven days. <b>literal source</b> 中文🙂' } })).data;
    const document = await p.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: created.id } });
    const { retrieveKnowledgeEvidence } = f.requireApi('plugins/aij-ai/ai-knowledge-retrieval.js');
    const qdata = { workspaceId, memberId, query: 'alpha response window', status: 'answered', answer: 'Synthetic source-read fixture, not model execution.',
      citations: retrieveKnowledgeEvidence('alpha response window', [document]).citations, idempotencyKeyHash: hash(randomUUID()), requestFingerprint: hash(randomUUID()) };
    const question = await p.aiKnowledgeQuestion.create({ data: qdata });
    const path = (q = question.id, d = document.id) => `client/ai/knowledge/questions/${q}/citations/${d}`;
    const read = (status = 200, options = {}, q, d) => f.request('GET', path(q, d), { cookie: f.cookies[0], workspaceId, status, ...options });
    const privateResponse = result => {
      assert.equal(result.response.headers.get('cache-control'), 'private, no-store');
      assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(result.response.headers.get('x-correlation-id'));
      if (result.response.status >= 400) {
        assert.equal(JSON.parse(result.text).success, false); assert.equal(result.data, null);
        for (const text of [document.content, memberId, workspaceId]) assert.ok(!result.text.includes(text));
      }
    };
    const counts = async () => {
      const result = {};
      const tables = await database(async client => (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r => r.tablename)
        .filter(name => /runtime_|ai_.*run|ai_execution|trace|budget|reservation|audit_log|notification|payment|ai_knowledge_/.test(name)).sort());
      await database(async client => { for (const table of tables) {
        assert.match(table, /^[a-z_]+$/);
        const rows = (await client.query('SELECT row_to_json(t)::text AS row FROM public."' + table + '" t')).rows.map(r => r.row).sort();
        result[table] = hash(JSON.stringify(rows));
      } });
      return result;
    };
    const sub = async (name, action) => {
      let failure;
      await t.test(name, async () => { try { await action(); proof.cases.push(name); } catch (e) { failure = e; throw e; } });
      writeFileSync(join(artifact, 'live-evidence.json'), JSON.stringify(proof, null, 2) + '\n');
      if (failure) throw failure;
    };
    const mutateQuestion = async (data, action) => {
      const before = await p.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: question.id } });
      try { await p.aiKnowledgeQuestion.update({ where: { id: question.id }, data }); await action(); }
      finally { await p.aiKnowledgeQuestion.update({ where: { id: question.id }, data: { ...data, ...Object.fromEntries(Object.keys(data).map(k => [k, before[k]])), updatedAt: before.updatedAt } }); }
    };
    const mutateDocument = async (data, action) => {
      const before = await p.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: document.id } });
      try { await p.aiKnowledgeDocument.update({ where: { id: document.id }, data }); await action(); }
      finally { await p.aiKnowledgeDocument.update({ where: { id: document.id }, data: { ...Object.fromEntries(Object.keys(data).map(k => [k, before[k]])), updatedAt: before.updatedAt } }); }
    };
    await sub('query-only real Cookie/Workspace GET, exact nine-key current source, SHA and no knowledge/runtime/audit writes', async () => {
      await grant('workspace.knowledge.manage', false);
      try {
        const context = (await f.request('GET', 'client/workspaces/context', { cookie: f.cookies[0], workspaceId })).data;
        assert.ok(context.permissions.includes('workspace.knowledge.query')); assert.ok(!context.permissions.includes('workspace.knowledge.manage'));
        const before = await counts(), result = await read(); privateResponse(result);
        assert.deepEqual(Object.keys(result.data).sort(), ['questionId', 'documentId', 'documentCode', 'title', 'content', 'excerpt', 'updatedAt', 'checksum', 'sourceState'].sort());
        assert.equal(result.data.content, document.content); assert.equal(result.data.checksum, hash(document.content)); assert.equal(result.data.sourceState, 'CURRENT');
        assert.deepEqual(await counts(), before);
      } finally { await grant('workspace.knowledge.manage', true); }
    });
    await sub('outside installed ESM and CJS SDK use one original JSON ClientApi GET and no retries', async () => {
      for (const sdk of [esm, cjs]) {
        let calls = 0; const api = sdk.createClientApi(() => f.baseUrl);
        const client = sdk.createKnowledgeCitationsClient((path, options) => { calls++; return api(path, { ...options, headers: { cookie: f.cookies[0], origin: host.origin } }); });
        const source = await client.read(workspaceId, question.id, document.id); assert.equal(source.content, document.content); assert.equal(calls, 1);
        await assert.rejects(client.read(workspaceId, question.id, 'z'.repeat(24)), e => e instanceof sdk.ClientRequestFailure && e.status === 404);
        assert.equal(calls, 2);
      }
    });
    await sub('anonymous/current grants/foreign product/same-workspace other member and legal other Workspace refuse privately', async () => {
      privateResponse(await read(401, { cookie: undefined }));
      await grant('workspace.knowledge.query', false);
      try { privateResponse(await read(403)); } finally { await grant('workspace.knowledge.query', true); }
      await p.clientWorkspaceMembership.create({ data: { workspaceId, memberId: f.accounts[1].id, roleId: role.id, status: 'active' } });
      privateResponse(await read(404, { cookie: f.cookies[1] }));
      const other = (await f.request('POST', 'client/workspaces', { cookie: f.cookies[0], body: { name: 'AF214 other own workspace', idempotencyKey: randomUUID() }, status: 201 })).data;
      privateResponse(await read(404, { workspaceId: other.id }));
      const { JwtService } = createRequire(join(process.cwd(), 'apps/api/package.json'))('@nestjs/jwt');
      const { ClientAuthGuard } = f.requireApi('client-auth/client-auth.guard.js');
      const own = { headers: { cookie: f.cookies[0] } }; await f.app.get(ClientAuthGuard).canActivate({ switchToHttp: () => ({ getRequest: () => own }) });
      const payload = Object.fromEntries(Object.entries(own.clientClaims).filter(([key]) => !['iat', 'exp', 'iss', 'aud'].includes(key)));
      const token = new JwtService({ secret: process.env.CLIENT_JWT_SECRET }).sign(payload, { issuer: 'other-product', audience: 'other-product', expiresIn: 300 });
      privateResponse(await read(401, { cookie: f.cookies[0].split('=', 1)[0] + '=' + token }));
    });
    await sub('source and question current-state 404/409/410, exact UTF8 bound and no mutating question maintenance', async () => {
      for (const data of [{ status: 'inactive' }, { deletedAt: new Date() }]) await mutateDocument(data, async () => privateResponse(await read(404)));
      for (const data of [{ title: 'changed' }, { documentCode: 'changed-code' }, { content: 'Alpha response changed.' }, { updatedAt: new Date(question.updatedAt.getTime() + 1) }]) {
        await mutateDocument({ ...data, ...(data.updatedAt ? {} : { updatedAt: document.updatedAt }) }, async () => privateResponse(await read(409)));
      }
      for (const data of [{ status: 'queued' }, { deletedAt: new Date() }, { contentPurgedAt: new Date() }, { citations: [] }]) await mutateQuestion(data, async () => {
        const before = await counts(); privateResponse(await read(404)); assert.deepEqual(await counts(), before);
      });
      await mutateQuestion({ createdAt: new Date(Date.now() - 7 * 86400000), contentPurgedAt: new Date() }, async () => privateResponse(await read(410)));
      const content = 'Alpha response ' + 'x'.repeat(65521); assert.equal(Buffer.byteLength(content), 65536);
      await mutateDocument({ content, updatedAt: document.updatedAt }, async () => {
        const current = await p.aiKnowledgeDocument.findUniqueOrThrow({ where: { id: document.id } });
        await mutateQuestion({ citations: retrieveKnowledgeEvidence(qdata.query, [current]).citations }, async () => {
          const r = await read(); assert.equal(Buffer.byteLength(r.data.content), 65536); assert.equal(r.data.checksum, hash(content));
          await p.aiKnowledgeDocument.update({ where: { id: document.id }, data: { content: content + 'x', updatedAt: document.updatedAt } }); privateResponse(await read(404));
        });
      });
    });
    await sub('real raw GET bodies/chunked bodies/query/ids reject with original envelope, privacy and stable correlation', async () => {
      for (const suffix of ['?extra=1', '?__proto__=x', '?constructor=x']) {
        privateResponse(await f.request('GET', path() + suffix, { cookie: f.cookies[0], workspaceId, status: 400 }));
      }
      for (const bad of ['a'.repeat(19), 'a'.repeat(33), 'A'.repeat(24)]) privateResponse(await read(400, {}, bad));
      for (const n of [20, 32]) privateResponse(await read(404, {}, 'a'.repeat(n)));
      for (const chunked of [false, true]) {
        const r = await new Promise((yes, no) => {
          const u = new URL(f.baseUrl + '/' + path());
          const req = httpRequest(u, { method: 'GET', headers: { cookie: f.cookies[0], 'x-aij-workspace-id': workspaceId, 'x-correlation-id': 'af214-raw-body',
            'content-type': 'application/json', ...(chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': 2 }) } }, res => {
            const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => yes({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
          }); req.on('error', no); req.end('{}');
        });
        assert.equal(r.status, 400); assert.equal(r.headers['cache-control'], 'private, no-store'); assert.equal(r.headers['x-content-type-options'], 'nosniff');
        assert.equal(r.headers['x-correlation-id'], 'af214-raw-body'); assert.equal(JSON.parse(r.text).success, false); assert.equal(JSON.parse(r.text).data, null);
      }
    });
    const heldRead = async (table, id, change, status) => database(async lock => {
      assert.ok(['ai_knowledge_document', 'ai_knowledge_question'].includes(table));
      await lock.query('BEGIN'); await lock.query('SELECT id FROM public.' + table + ' WHERE id=$1 FOR UPDATE', [id]);
      const result = read(status); let observed = false;
      try {
        for (let i = 0; i < 60; i++) {
          observed = await database(async observer => (await observer.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1) AS waiting", ['%FROM public.' + table + '%'])).rows[0].waiting);
          if (observed) break; await delay(25);
        }
        assert.equal(observed, true, 'Actual original source transaction waited in PostgreSQL'); await change(lock);
        await lock.query('COMMIT'); privateResponse(await result);
      } finally { await lock.query('ROLLBACK'); await result.catch(() => {}); }
    });
    await sub('actual held document row uses committed current source and current database clock after wait', async () => {
      try { await heldRead('ai_knowledge_document', document.id, lock => lock.query("UPDATE public.ai_knowledge_document SET status='inactive' WHERE id=$1", [document.id]), 404); }
      finally { await p.aiKnowledgeDocument.update({ where: { id: document.id }, data: { status: 'active', updatedAt: document.updatedAt } }); }
      try { await heldRead('ai_knowledge_question', question.id, lock => lock.query("UPDATE public.ai_knowledge_question SET created_at=clock_timestamp()-interval '7 days' WHERE id=$1", [question.id]), 410); }
      finally { await p.aiKnowledgeQuestion.update({ where: { id: question.id }, data: { createdAt: question.createdAt, updatedAt: question.updatedAt } }); }
    });
    await sub('original session expires while source lock waits, revoked Cookie and disabled plugin fail closed', async () => {
      const session = await p.clientAuthSession.findFirstOrThrow({ where: { memberId, status: 'active', deletedAt: null } });
      try {
        await heldRead('ai_knowledge_question', question.id, lock => lock.query("UPDATE public.client_auth_session SET expires_at=clock_timestamp()-interval '1 millisecond' WHERE id=$1", [session.id]), 401);
      } finally { await p.clientAuthSession.update({ where: { id: session.id }, data: { expiresAt: session.expiresAt } }); }
      try { await p.clientAuthSession.update({ where: { id: session.id }, data: { status: 'revoked' } }); privateResponse(await read(401)); }
      finally { await p.clientAuthSession.update({ where: { id: session.id }, data: { status: 'active' } }); }
      const installation = await p.pluginInstallation.findUniqueOrThrow({ where: { projectId_pluginCode: { projectId: f.project.id, pluginCode: 'aij-ai' } } });
      try { await p.pluginInstallation.update({ where: { id: installation.id }, data: { status: 'installed' } }); privateResponse(await read(404)); }
      finally { await p.pluginInstallation.update({ where: { id: installation.id }, data: { status: 'enabled' } }); }
    });
    await sub('actual lifecycle and membership advisory waiters recheck committed disable and grant revocation', async () => {
      const queryGrant = await p.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code: 'workspace.knowledge.query' } } });
      const installation = await p.pluginInstallation.findUniqueOrThrow({ where: { projectId_pluginCode: { projectId: f.project.id, pluginCode: 'aij-ai' } } });
      for (const kind of ['lifecycle', 'membership']) {
        try {
          await database(async lock => {
            await lock.query('BEGIN');
            const key = kind === 'lifecycle' ? 'plugin-lifecycle:' + f.project.id + ':aij-ai' : 'aij-client-workspace-membership:' + workspaceId;
            await lock.query(kind === 'lifecycle' ? 'SELECT pg_advisory_xact_lock(hashtext($1))' : 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
            const result = read(kind === 'lifecycle' ? 404 : 403); let observed = false;
            try {
              for (let i = 0; i < 60; i++) {
                observed = await database(async observer => (await observer.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%') AS waiting")).rows[0].waiting);
                if (observed) break; await delay(25);
              }
              assert.equal(observed, true, kind + ' actual PG waiter');
              if (kind === 'lifecycle') await lock.query("UPDATE public.plugin_installation SET status='installed' WHERE id=$1", [installation.id]);
              else await lock.query('UPDATE public.client_workspace_role_permission SET deleted_at=clock_timestamp() WHERE id=$1', [queryGrant.id]);
              await lock.query('COMMIT'); privateResponse(await result);
            } finally { await lock.query('ROLLBACK'); await result.catch(() => {}); }
          });
        } finally {
          await p.pluginInstallation.update({ where: { id: installation.id }, data: { status: 'enabled' } });
          await grant('workspace.knowledge.query', true);
        }
      }
    });
    await sub('original owner session-row lock rechecks revocation after an actual PostgreSQL wait', async () => {
      const { ClientAuthGuard } = f.requireApi('client-auth/client-auth.guard.js');
      const req = { headers: { cookie: f.cookies[0] } };
      await f.app.get(ClientAuthGuard).canActivate({ switchToHttp: () => ({ getRequest: () => req }) });
      const { AiKnowledgeService } = f.requireApi('plugins/aij-ai/ai-knowledge.service.js');
      try {
        await database(async lock => {
          await lock.query('BEGIN'); await lock.query('SELECT id FROM public.client_auth_session WHERE id=$1 FOR UPDATE', [req.clientClaims.sessionId]);
          const outcome = f.app.get(AiKnowledgeService).readCitation(memberId, workspaceId, question.id, document.id, req.clientClaims)
            .then(() => ({ status: 200 }), e => ({ status: e.getStatus?.() }));
          try {
            let observed = false;
            for (let i = 0; i < 60; i++) {
              observed = await database(async observer => (await observer.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM public.client_auth_session%') AS waiting")).rows[0].waiting);
              if (observed) break; await delay(25);
            }
            assert.equal(observed, true);
            await lock.query("UPDATE public.client_auth_session SET status='revoked' WHERE id=$1", [req.clientClaims.sessionId]); await lock.query('COMMIT');
            assert.equal((await outcome).status, 401);
          } finally { await lock.query('ROLLBACK'); await outcome; }
        });
      } finally { await p.clientAuthSession.update({ where: { id: req.clientClaims.sessionId }, data: { status: 'active' } }); }
    });
    await sub('actual original question page explicit current source, escaping, mobile width, close/revocation/late response privacy', async () => {
      await verifyKnowledgeCitationBrowser({ host, fixture: f, artifact, document, grant });
    });
  } finally {
    await host.close();
    if (f) {
      const closure = await f.close(); assert.equal(closure.applicationPools0, true); assert.equal(closure.ownedSockets0, true); assert.equal(closure.environmentRestored, true);
    }
  }
});
