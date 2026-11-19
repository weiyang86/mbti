// Root-only actual startup failures, each using a newly created protected lease.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createSafeWorkbenchRuntimeFixture } from './workbench-runtime-safe-fixture.mjs';
import { readDatabaseEnvironment, repositoryRoot, withDatabase } from '../database/connection.mjs';
const require = createRequire(join(repositoryRoot, 'apps/api/package.json'));
test('AF198 real creation-return/listen/login/database refusal restores only owned resources', { timeout: 480000 }, async t => {
  assert.equal(process.env.AIJ_AF198_ROOT_ACCEPTANCE, 'true');
  const parent = join(repositoryRoot, '.artifacts/auto-ai-program-20261105/AF-198');
  const { Logger } = require('@nestjs/common'), { NestFactory } = require('@nestjs/core');
  for (const failureAt of ['before-app-return', 'listen', 'login', 'database-unavailable']) {
    await t.test(failureAt, async () => {
      const before = new Set((await readdir(parent)).filter(n => n.startsWith('fixture-')));
      const environment = { ...process.env }, originalFetch = globalThis.fetch, originalCreate = NestFactory.create;
      const loggerState = { instance: Logger.staticInstanceRef, levels: Logger.logLevels, buffer: Logger.logBuffer, attached: Logger.isBufferAttached };
      await assert.rejects(createSafeWorkbenchRuntimeFixture('AF-198', {
        workbenchTargetSafety: true, workbenchFailureAt: failureAt,
        configuration: true, secrets: true, runtimeManagement: true
      }), error => error.message === 'AF198_FIXTURE_START_FAILED');
      assert.equal(globalThis.fetch, originalFetch); assert.equal(NestFactory.create, originalCreate);
      assert.deepEqual({ ...process.env }, environment);
      assert.equal(Logger.staticInstanceRef, loggerState.instance); assert.equal(Logger.logLevels, loggerState.levels);
      assert.equal(Logger.logBuffer, loggerState.buffer); assert.equal(Logger.isBufferAttached, loggerState.attached);
      const created = (await readdir(parent)).filter(n => n.startsWith('fixture-') && !before.has(n));
      assert.equal(created.length, 1);
      const report = JSON.parse(await readFile(join(parent, created[0], 'closed.json'), 'utf8'));
      const failure = JSON.parse(await readFile(join(parent, created[0], 'failed.json'), 'utf8'));
      assert.equal(report.status, 'CLOSED'); assert.deepEqual(report.failedSteps, []);
      assert.equal(report.applicationPools, 0); assert.equal(report.ownedSockets, 0);
      assert.equal(report.databaseAcceptingConnections, true);
      assert.equal(report.environmentRestored, true); assert.equal(failure.acceptanceId, report.acceptanceId);
      if (failureAt === 'database-unavailable') { assert.equal(report.stage, 'DATABASE_UNAVAILABLE'); assert.equal(report.databaseRefusalObserved, true); }
      if (failureAt !== 'database-unavailable') assert.ok(report.applicationPidsObserved.length >= 1, 'Actual application connection existed before the failure');
      const readback = await withDatabase('test', readDatabaseEnvironment('test', environment, report.acceptanceId), async client => {
        const { rows: [row] } = await client.query('SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS pools, datallowconn FROM pg_database WHERE datname=current_database()');
        return row;
      }, { acceptanceId: report.acceptanceId });
      assert.deepEqual(readback, { pools: 0, datallowconn: true });
    });
  }
});
