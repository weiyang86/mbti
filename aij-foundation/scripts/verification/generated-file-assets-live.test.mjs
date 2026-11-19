import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { withDatabase, readDatabaseEnvironment, repositoryRoot } from '../database/connection.mjs';
const task = 'AF-201';
const hash = b => createHash('sha256').update(b).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const pause = ms => new Promise(r => setTimeout(r, ms));

test('AF201 actual FileAsset/local content/PG commit locks, rollback, cancellation and legacy HTTP scope', { timeout: 420000 }, async t => {
  assert.equal(process.env.AIJ_AF201_ROOT_ACCEPTANCE, 'true');
  assert.equal(process.cwd(), repositoryRoot);
  assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
  let f, peer, storage, directory, result, failure;
  const cleanupErrors = [], keys = new Set(), cases = [];
  const caseOf = async (name, operation) => t.test(name, async () => {
    try { await operation(); cases.push({ name, status: 'PASS' }); }
    catch (e) { cases.push({ name, status: 'FAIL' }); throw e; }
  });
  try {
    f = await createRemainingClientFixture(task, { workbenchTargetSafety: true, storageEnabled: true });
    const { ConfigService } = createRequire(join(repositoryRoot, 'apps/api/package.json'))('@nestjs/config');
    const { GeneratedFileAssetsService, GeneratedFileError } = f.requireApi('files/generated-file-assets.service.js');
    const { LocalStorageAdapter } = f.requireApi('files/local-storage.adapter.js');
    const { PrismaService } = f.requireApi('prisma/prisma.service.js');
    const service = f.app.get(GeneratedFileAssetsService);
    storage = f.app.get(LocalStorageAdapter);
    assert.equal(service.prisma, f.prisma, 'One original Prisma provider per actual app');
    directory = f.app.get(ConfigService).getOrThrow('storageRoot');
    assert.equal(directory, join(f.artifactDirectory, 'aij-foundation/test/storage'));
    const { createApplication } = f.requireApi('bootstrap.js');
    peer = await createApplication(); await peer.listen(0, '127.0.0.1');
    const peerDb = peer.get(PrismaService); assert.equal((await peerDb.readiness()).ready, true);
    const scope = { projectId: f.project.id, workspaceId: f.workspaces[0].id, memberId: f.accounts[0].id, pluginCode: 'aij-ai' };
    const { renderPlainDocument, DOCUMENT_FONT_SHA256 } = f.requireApi('documents/document-renderer.js');
    const artifacts = {};
    for (const format of ['pdf', 'docx']) artifacts[format] = await renderPlainDocument({ format, name: '附件中心验证', body: '自有合成中文\n\n完整性与事务验证\tEND' }, { fontPath: join(repositoryRoot, 'assets/document-fonts/NotoSansCJKsc-Regular.otf'), fontSha256: DOCUMENT_FONT_SHA256 });
    const objectNames = async () => (await readdir(join(directory, 'objects')).catch(e => { if (e.code === 'ENOENT') return []; throw e; })).filter(n => !n.startsWith('._'));
    const spec = (format = 'pdf', name = 'generated.' + format) => ({ format, mimeType: artifacts[format].mimeType, bytes: artifacts[format].bytes, checksum: artifacts[format].sha256, originalName: name, downloadUrl: '/api/client/document-exports/' + randomUUID() + '/content' });
    const stage = async (...args) => {
      const before = new Set(await objectNames()); const ticket = await service.stage(scope, spec(...args));
      const fresh = (await objectNames()).filter(n => !before.has(n)); assert.equal(fresh.length, 1); keys.add(fresh[0]);
      return { ticket, key: fresh[0] };
    };
    const error = code => e => e instanceof GeneratedFileError && e.code === code && e.message === 'Generated file ' + code && !e.cause;
    const txRead = (id, selected = scope) => f.prisma.$transaction(tx => service.readInTransaction(tx, id, selected));
    const counters = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count(), await f.prisma.aiExecutionTrace.count()];
    const beforeCounters = await counters();
    let firstAsset;
    await caseOf('original app DI, actual PDF/DOCX bytes and exact ownership, no forged or replayed capability', async () => {
      for (const format of ['pdf', 'docx']) {
        const { ticket } = await stage(format);
        assert.deepEqual(Object.keys(ticket), ['assetId']); assert.ok(Object.isFrozen(ticket));
        await assert.rejects(service.discard({ assetId: ticket.assetId }), error('INVALID_TICKET'));
        await assert.rejects(peer.get(GeneratedFileAssetsService).discard(ticket), error('INVALID_TICKET'));
        const metadata = await f.prisma.$transaction(tx => service.commitInTransaction(tx, ticket));
        assert.equal(metadata.assetId, ticket.assetId); assert.equal('path' in metadata, false); assert.equal('objectKey' in metadata, false);
        const row = await f.prisma.fileAsset.findUniqueOrThrow({ where: { id: ticket.assetId } });
        for (const [k, v] of Object.entries({ projectId: scope.projectId, workspaceId: scope.workspaceId, pluginCode: 'aij-ai', ownerType: 'user', ownerId: scope.memberId, uploaderId: scope.memberId, status: 'active', storageType: 'local' })) assert.equal(row[k], v);
        const actual = await txRead(ticket.assetId); assert.deepEqual(actual.bytes, artifacts[format].bytes); assert.equal(hash(actual.bytes), artifacts[format].sha256);
        await service.confirm(ticket); await assert.rejects(service.discard(ticket), error('INVALID_TICKET'));
        if (format === 'pdf') firstAsset = ticket.assetId;
      }
      for (const selected of [{ ...scope, workspaceId: f.workspaces[1].id }, { ...scope, memberId: f.accounts[1].id }, { ...scope, projectId: 'other-product' }]) await assert.rejects(txRead(firstAsset, selected), error('NOT_FOUND'));
    });
    await withDatabase('test', readDatabaseEnvironment('test', process.env, f.lease.id), async observer => {
      const [{ pid: firstPid }] = await f.prisma.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
      const [{ pid: secondPid }] = await peerDb.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
      assert.notEqual(firstPid, secondPid);
      const waitForLock = async () => {
        const until = Date.now() + 2000;
        while (Date.now() < until) {
          const { rows } = await observer.query('SELECT pid,datname,query,wait_event_type,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1 AND datname=$2', [firstPid, f.lease.database]);
          if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.includes(secondPid) && rows[0].query.includes('pg_advisory_xact_lock')) return rows[0];
          await pause(20);
        }
        assert.fail('Real same-ticket PG advisory lock wait not observed');
      };
      await caseOf('pending outer transaction: real second connection cleanup waits, committed bytes survive', async () => {
        const { ticket, key } = await stage(), ready = deferred(), release = deferred();
        const pending = peerDb.$transaction(async tx => { await service.commitInTransaction(tx, ticket); ready.resolve(); await release.promise; }, { timeout: 10000 });
        let disposal;
        try {
          await ready.promise; disposal = service.discard(ticket); const waiting = await waitForLock(); assert.equal(waiting.pid, firstPid);
          assert.ok(await storage.exists(key)); release.resolve(); await pending;
          assert.deepEqual(await disposal, { removed: false, retainedBecauseCommitted: true }); assert.ok(await storage.exists(key));
        } finally { release.resolve(); await pending.catch(() => {}); await disposal?.catch(() => {}); }
      });
      await caseOf('pending real rollback: cleanup waits, then removes only uncommitted object', async () => {
        const { ticket, key } = await stage(), ready = deferred(), release = deferred();
        const pending = peerDb.$transaction(async tx => { await service.commitInTransaction(tx, ticket); ready.resolve(); await release.promise; throw Error('OWNED_EXPECTED_ROLLBACK'); }, { timeout: 10000 });
        const rejected = assert.rejects(pending, /OWNED_EXPECTED_ROLLBACK/); let disposal;
        try {
          await ready.promise; disposal = service.discard(ticket); await waitForLock(); assert.ok(await storage.exists(key));
          release.resolve(); await rejected; assert.deepEqual(await disposal, { removed: true, retainedBecauseCommitted: false });
          assert.equal(await storage.exists(key), false); assert.equal(await f.prisma.fileAsset.count({ where: { id: ticket.assetId } }), 0);
        } finally { release.resolve(); await rejected; await disposal?.catch(() => {}); }
      });
      await caseOf('actual cancelled cleanup query preserves bytes and capability; later committed readback retains', async () => {
        const { ticket, key } = await stage(), ready = deferred(), release = deferred();
        const pending = peerDb.$transaction(async tx => { await service.commitInTransaction(tx, ticket); ready.resolve(); await release.promise; }, { timeout: 10000 });
        let refused;
        try {
          await ready.promise;
          refused = assert.rejects(service.discard(ticket), error('UNAVAILABLE'));
          await waitForLock();
          // Exactly the observed own app PID in this fresh AF201 DB, never a daemon/foreign session.
          const cancelled = await observer.query('SELECT pg_cancel_backend(pid) AS cancelled FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND wait_event_type=$3 AND query LIKE $4', [firstPid, f.lease.database, 'Lock', '%pg_advisory_xact_lock%']);
          assert.equal(cancelled.rows.length, 1); assert.equal(cancelled.rows[0].cancelled, true);
          await refused; assert.ok(await storage.exists(key)); release.resolve(); await pending;
          assert.deepEqual(await service.discard(ticket), { removed: false, retainedBecauseCommitted: true }); assert.ok(await storage.exists(key));
        } finally { release.resolve(); await pending.catch(() => {}); await refused?.catch(() => {}); }
      });
      await caseOf('real create and downstream audit failure roll back metadata; explicit compensation removes own bytes', async () => {
        await observer.query(`CREATE FUNCTION public.aij_af201_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.original_name='reject.pdf' THEN RAISE EXCEPTION 'AF201_EXPECTED_INSERT'; END IF; RETURN NEW; END $$`);
        await observer.query('CREATE TRIGGER aij_af201_insert_failure BEFORE INSERT ON public.file_asset FOR EACH ROW EXECUTE FUNCTION public.aij_af201_insert_failure()');
        await observer.query(`CREATE FUNCTION public.aij_af201_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='af201.reject' THEN RAISE EXCEPTION 'AF201_EXPECTED_AUDIT'; END IF; RETURN NEW; END $$`);
        await observer.query('CREATE TRIGGER aij_af201_audit_failure BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.aij_af201_audit_failure()');
        try {
          for (const mode of ['insert', 'audit']) {
            const { ticket, key } = await stage('pdf', mode === 'insert' ? 'reject.pdf' : 'generated.pdf');
            const change = f.prisma.$transaction(async tx => {
              await service.commitInTransaction(tx, ticket);
              if (mode === 'audit') await tx.auditLog.create({ data: { module: 'files', action: 'af201.reject', resourceType: 'file', resourceId: ticket.assetId, workspaceId: scope.workspaceId } });
            });
            await assert.rejects(change, mode === 'insert' ? error('UNAVAILABLE') : undefined);
            assert.equal(await f.prisma.fileAsset.count({ where: { id: ticket.assetId } }), 0); assert.ok(await storage.exists(key));
            assert.deepEqual(await service.discard(ticket), { removed: true, retainedBecauseCommitted: false }); assert.equal(await storage.exists(key), false);
          }
        } finally {
          await observer.query('DROP TRIGGER aij_af201_insert_failure ON public.file_asset'); await observer.query('DROP FUNCTION public.aij_af201_insert_failure()');
          await observer.query('DROP TRIGGER aij_af201_audit_failure ON public.audit_log'); await observer.query('DROP FUNCTION public.aij_af201_audit_failure()');
        }
      });
    }, { acceptanceId: f.lease.id });
    await caseOf('real committed inactive/key-only metadata is never deleted, lost caller return recovers original asset', async () => {
      const { ticket, key } = await stage();
      await assert.rejects((async () => { await f.prisma.$transaction(tx => service.commitInTransaction(tx, ticket)); throw Error('OWNED_CALLER_RETURN_LOST'); })(), /OWNED_CALLER_RETURN_LOST/);
      await f.prisma.fileAsset.update({ where: { id: ticket.assetId }, data: { status: 'deleted', deletedAt: new Date() } });
      await assert.rejects(service.confirm(ticket), error('UNAVAILABLE'));
      assert.deepEqual(await service.discard(ticket), { removed: false, retainedBecauseCommitted: true }); assert.ok(await storage.exists(key));
      const other = await stage();
      await f.prisma.fileAsset.create({ data: { id: randomUUID(), originalName: 'generated.pdf', filename: other.key + '.pdf', mimeType: artifacts.pdf.mimeType,
        size: artifacts.pdf.size, checksum: artifacts.pdf.sha256, path: storage.relativePath(other.key), objectKey: other.key, url: '/api/client/document-exports/other/content',
        storageType: 'local', projectId: scope.projectId, workspaceId: scope.workspaceId, pluginCode: 'aij-ai', ownerType: 'user', ownerId: scope.memberId, uploaderId: scope.memberId } });
      assert.deepEqual(await service.discard(other.ticket), { removed: false, retainedBecauseCommitted: true }); assert.ok(await storage.exists(other.key));
    });
    await caseOf('actual missing/corrupt objects and inactive private metadata safely refuse reads', async () => {
      const { ticket, key } = await stage(); await f.prisma.$transaction(tx => service.commitInTransaction(tx, ticket)); await service.confirm(ticket);
      await writeFile(join(directory, 'objects', key), 'OWNED_CORRUPT_FIXTURE'); await assert.rejects(txRead(ticket.assetId), error('UNAVAILABLE'));
      await storage.remove(key); await assert.rejects(txRead(ticket.assetId), error('UNAVAILABLE'));
      const row = await f.prisma.fileAsset.findUniqueOrThrow({ where: { id: firstAsset } });
      for (const data of [{ status: 'deleted' }, { uploaderId: scope.memberId + '-else' }, { pluginCode: null }]) {
        await f.prisma.fileAsset.update({ where: { id: firstAsset }, data }); await assert.rejects(txRead(firstAsset), error('NOT_FOUND'));
        await f.prisma.fileAsset.update({ where: { id: firstAsset }, data: { status: row.status, uploaderId: row.uploaderId, pluginCode: row.pluginCode } });
      }
    });
    await caseOf('real legacy HTTP upload/list/download/delete still null-scope, generated workspace files and DOCX arbitrary upload refused', async () => {
      const request = async (method, path, { form, cookie = f.cookies[0], status = 200 } = {}) => {
        const r = await fetch(f.baseUrl + path, { method, headers: { cookie, origin: process.env.WEB_URL, connection: 'close' }, body: form, signal: AbortSignal.timeout(15000) });
        assert.equal(r.status, status); return r;
      };
      const inaccessible = await request('GET', '/client/files/' + firstAsset, { status: 404 }); await inaccessible.arrayBuffer();
      const form = new FormData(); form.set('file', new Blob(['OWNED_LEGACY_CONTENT'], { type: 'text/plain' }), 'legacy.txt');
      const uploaded = await request('POST', '/client/files', { form, status: 201 }); const old = (await uploaded.json()).data;
      const row = await f.prisma.fileAsset.findUniqueOrThrow({ where: { id: old.id } }); keys.add(row.objectKey); assert.equal(row.workspaceId, null); assert.equal(row.pluginCode, null);
      const downloaded = await request('GET', '/client/files/' + old.id); assert.equal(await downloaded.text(), 'OWNED_LEGACY_CONTENT');
      const foreign = await request('GET', '/client/files/' + old.id, { cookie: f.cookies[1], status: 404 }); await foreign.arrayBuffer();
      const listed = await request('GET', '/client/files'); const list = (await listed.json()).data;
      assert.ok(list.items.some(i => i.id === old.id)); assert.ok(!list.items.some(i => i.id === firstAsset));
      const docx = new FormData(); docx.set('file', new Blob([artifacts.docx.bytes], { type: artifacts.docx.mimeType }), 'untrusted.docx');
      const denied = await request('POST', '/client/files', { form: docx, status: 400 }); await denied.arrayBuffer();
      const removed = await request('DELETE', '/client/files/' + old.id); await removed.arrayBuffer(); assert.equal(await storage.exists(row.objectKey), false);
    });
    assert.deepEqual(await counters(), beforeCounters);
    assert.equal(cases.length, 8); assert.ok(cases.every(c => c.status === 'PASS'), 'Actual PG/HTTP subcase failed');
    result = { status: 'PASS', task, acceptanceId: f.lease.id, scenarios: 8, realFormats: 2, observedDifferentApplicationPids: true,
      unknownProof: 'Exact owned blocked query cancelled by PG; bytes retained, later committed readback retained. Caller-return loss separately synthetic after real commit, not a claimed network outage.', originalLegacyHttp: true, noNewAiLedger: true };
    await writeFile(join(f.artifactDirectory, 'generated-files-evidence.json'), JSON.stringify(result, null, 2));
  } catch (error) { failure = error; }
  finally {
    if (peer) { try { peer.getHttpServer().closeAllConnections(); await peer.close(); assert.equal(peer.getHttpServer().listening, false); } catch (e) { cleanupErrors.push(e); } }
    if (storage) {
      try {
        for (const key of keys) if (await storage.exists(key)) await storage.remove(key);
        assert.deepEqual((await readdir(join(directory, 'objects'))).filter(n => !n.startsWith('._')), []);
      } catch (e) { cleanupErrors.push(e); }
    }
    if (f) {
      try { const closed = await f.close(); assert.equal(closed.applicationPools, 0); assert.equal(closed.ownedSockets, 0); } catch (e) { cleanupErrors.push(e); }
      await writeFile(join(f.artifactDirectory, 'generated-files-close.json'), JSON.stringify({ status: failure || cleanupErrors.length ? 'FAILED' : 'CLOSED', cleanupErrors: cleanupErrors.map(e => e.message), ownObjectKeys: keys.size, remainingContentObjects: await readdir(join(directory, 'objects')).then(a => a.filter(n => !n.startsWith('._')).length).catch(() => null), closure: f.closure() }, null, 2));
    }
  }
  if (failure || cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'AF201_REAL_PG_OR_CLEANUP_FAILED');
  const closed = JSON.parse(await readFile(join(f.artifactDirectory, 'generated-files-close.json'))); assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.remainingContentObjects, 0);
  console.log(JSON.stringify({ ...result, evidenceDirectory: f.artifactDirectory, pools: 0, sockets: 0, ownedContentObjects: 0 }));
});
