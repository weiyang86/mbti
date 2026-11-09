// Root-only native-browser rendezvous over the SAME protected API fixture.
import assert from 'node:assert/strict';
import { createServer, request as relayRequest } from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const folder = join(root, '.artifacts/auto-ai-program-20261105/AF-189');
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
let host;

export async function prepareNativePublicationHost() {
  assert.equal(resolve(process.cwd()), root);
  assert.equal(host, undefined);
  await mkdir(folder, { recursive: true });
  const state = { task: 'AF-189', status: 'PREPARING', traffic: [], commands: [] };
  let fixture, nextHandler, nextApp, loseNext = false, closed = false;
  const server = createServer((incoming, outgoing) => {
    if (incoming.url === '/api' || incoming.url?.startsWith('/api/')) {
      if (!fixture) { outgoing.writeHead(503); outgoing.end(); return; }
      const target = new URL(fixture.baseUrl), path = incoming.url.split('?', 1)[0];
      const relay = relayRequest({ hostname: '127.0.0.1', port: target.port, method: incoming.method,
        path: incoming.url, headers: { ...incoming.headers, host: target.host } }, response => {
        const lost = loseNext && incoming.method === 'POST' && path.endsWith('/publication/publish') && response.statusCode === 200;
        state.traffic.push({ method: incoming.method, path, status: response.statusCode, lostAfterCommit: lost });
        if (lost) {
          loseNext = false; response.resume(); response.once('end', () => {
            outgoing.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }); outgoing.end('{"message":"Owned fixture lost committed reply"}');
          }); return;
        }
        outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
      });
      relay.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
      incoming.pipe(relay); return;
    }
    if (nextHandler) { void nextHandler(incoming, outgoing); return; }
    outgoing.writeHead(503); outgoing.end('Owned native acceptance preparing');
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  host = { origin, state, attach(f) { fixture = f; }, armLoss() { loseNext = true; },
    async startWeb() {
      const previous = process.env.NODE_ENV;
      process.env.AIJ_NEXT_DIST_DIR = '.next-af189'; process.env.AIJ_TEST_API_URL = '/api'; process.env.NODE_ENV = 'production';
      try { nextApp = requireWeb('next')({ dev: false, dir: join(root, 'apps/web'), hostname: '127.0.0.1' }); await nextApp.prepare(); nextHandler = nextApp.getRequestHandler(); }
      finally { process.env.NODE_ENV = previous; }
    },
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections(); await new Promise(r => server.close(r)); await nextApp?.close();
      state.status = 'CLOSED'; await writeFile(join(folder, 'native-runtime.json'), JSON.stringify(state, null, 2));
    }
  };
  return host;
}

export async function runNativePublicationAcceptance({ fixture, agent: seed, request, execute, expectedCases }) {
  assert.ok(host); host.attach(fixture);
  const original = (await request('GET', `client/ai/personal-agents/${seed.id}`)).data;
  const content = Object.fromEntries(Object.entries(original).filter(([k]) => !['id', 'code', 'revision', 'createdAt', 'updatedAt'].includes(k)));
  content.skillBindings = content.skillBindings.map(({ skillId, revision }) => ({ skillId, revision }));
  const agent = (await request('POST', 'client/ai/personal-agents', { status: 201, body: { ...content, code: 'af189-native-' + randomUUID(), name: '发布验收助手' } })).data;
  const state = host.state;
  const metadata = async () => (await request('GET', `client/ai/personal-agents/${agent.id}/publication`)).data;
  const mutate = async action => {
    const p = await metadata();
    return (await request('POST', `client/ai/personal-agents/${agent.id}/publication/${action}`, {
      body: { expectedAgentRevision: p.revision, expectedPublicationVersion: p.publicationVersion }
    })).data;
  };
  const membership = await fixture.prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: fixture.workspaces[0].id, memberId: fixture.accounts[0].id } } });
  const grant = await fixture.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: membership.roleId, permission: { code: 'workspace.ai.assets.manage' } } });
  Object.assign(state, { status: 'NATIVE_PENDING', acceptanceId: fixture.lease.id, database: fixture.lease.database, origin: host.origin,
    agentId: agent.id, agentCode: agent.code, workspaceId: fixture.workspaces[0].id, credentialFile: fixture.accounts[0].initialPasswordFile,
    buildId: (await readFile(join(root, 'apps/web/.next-af189/BUILD_ID'), 'utf8')).trim() });
  const save = () => writeFile(join(folder, 'native-runtime.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  let observer, timeout;
  try {
    await host.startWeb(); await save();
    return await new Promise((yes, no) => {
      let busy = false;
      observer = watch(folder, async (event, filename) => {
        if (filename !== 'native-command.json' || busy) return;
        busy = true;
        try {
          const command = JSON.parse(await readFile(join(folder, filename), 'utf8'));
          assert.match(command.id, /^[A-Za-z0-9_-]{1,80}$/);
          if (state.commands.some(c => c.id === command.id)) return;
          const action = command.action;
          if (action === 'lose-next') host.armLoss();
          else if (action === 'publish' || action === 'unpublish') await mutate(action);
          else if (action === 'readonly' || action === 'restore') await fixture.prisma.clientWorkspaceRolePermission.update({ where: { id: grant.id }, data: { deletedAt: action === 'readonly' ? new Date() : null } });
          else if (action === 'execute') await execute();
          else if (action === 'revoke-sessions') await fixture.prisma.clientAuthSession.updateMany({ where: { memberId: fixture.accounts[0].id, status: 'active' }, data: { status: 'revoked', revokedAt: new Date() } });
          else if (action !== 'finish' && action !== 'counts') throw Error('Unknown native command');
          state.commands.push({ id: command.id, action });
          state.nativeRuns = await fixture.prisma.aiAgentRun.findMany({ where: { agentCode: 'personal:' + agent.id }, select: { id: true, status: true, budgetStatus: true, output: true } });
          await save();
          await writeFile(join(folder, 'native-command-result.json'), JSON.stringify({ id: command.id, action, status: 'DONE', runs: state.nativeRuns.map(r => ({ id: r.id, status: r.status })) }));
          if (action === 'finish') {
            const proof = JSON.parse(await readFile(join(folder, 'native-observed-proof.json'), 'utf8'));
            assert.equal(proof.acceptanceId, fixture.lease.id); assert.equal(proof.agentId, agent.id); assert.equal(proof.buildId, state.buildId);
            assert.deepEqual(Object.keys(proof.cases).sort(), [...expectedCases].sort());
            assert.equal(state.nativeRuns.length, 1); assert.equal(state.nativeRuns[0].status, 'succeeded');
            assert.equal(state.nativeRuns[0].budgetStatus, 'settled');
            assert.equal(state.traffic.filter(t => t.lostAfterCommit).length, 1);
            assert.equal(state.traffic.filter(t => t.method === 'POST' && t.path === `/api/client/ai/personal-agents/${agent.id}/runs`).length, 1);
            yes(proof);
          }
        } catch (error) { no(error); }
        finally { busy = false; }
      });
      timeout = setTimeout(() => no(Error('Real native publication acceptance did not complete')), 600000);
    });
  } finally { clearTimeout(timeout); observer?.close(); await host.close(); }
}
