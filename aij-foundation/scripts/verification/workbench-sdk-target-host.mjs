// AF191 root-only host. Next and the outside SDK page share the actual API origin.
import assert from 'node:assert/strict';
import { createServer, request as relayRequest } from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function createTargetHost() {
  let base, consumer, web, next, closed, loseSubmit = false, actor = 'owner', submittedRun;
  const responses = [], sockets = new Set();
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.url?.startsWith('/af191-consumer')) {
        assert.equal(typeof consumer, 'function'); await consumer(incoming, outgoing); return;
      }
      if (!incoming.url?.startsWith('/api/')) {
        if (next) { await next(incoming, outgoing); return; }
        outgoing.writeHead(503); outgoing.end(); return;
      }
      assert.ok(base);
      const target = new URL(base), path = incoming.url.split('?', 1)[0], label = actor;
      const request = relayRequest({ hostname: '127.0.0.1', port: target.port, method: incoming.method,
        path: incoming.url, headers: { ...incoming.headers, host: target.host } }, response => {
        const chunks = []; let length = 0;
        response.on('data', chunk => { length += chunk.length; if (length > 1024 * 1024) response.destroy(); else chunks.push(chunk); });
        response.once('end', () => {
          const bytes = Buffer.concat(chunks);
          const observation = { method: incoming.method, path: path.slice(4), actor: label, status: response.statusCode, bodySha256: hash(bytes) };
          responses.push(observation);
          const submit = incoming.method === 'POST' && path === '/api/client/ai/agents/general-text/runs' && response.statusCode === 202;
          if (submit) { const body = JSON.parse(bytes.toString('utf8')); submittedRun = body.data.id; }
          outgoing.writeHead(response.statusCode, response.headers);
          if (submit && loseSubmit) {
            loseSubmit = false; outgoing.flushHeaders(); outgoing.write(bytes.subarray(0, 1), () => { const timer = setTimeout(() => outgoing.destroy(), 50); timer.unref(); });
          } else outgoing.end(bytes);
        });
        response.once('error', () => outgoing.destroy());
      });
      request.once('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
      incoming.pipe(request);
    } catch { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, responses,
    attach(api) { assert.equal(base, undefined); base = api; },
    actor(value) { assert.ok(['owner', 'anonymous', 'no-permission', 'other-member'].includes(value)); actor = value; },
    loseFirstSubmit() { assert.equal(loseSubmit, false); loseSubmit = true; },
    submittedRun: () => submittedRun,
    async mount(handler) {
      assert.equal(consumer, undefined); consumer = handler;
      const keys = ['NODE_ENV', 'AIJ_NEXT_DIST_DIR', 'AIJ_TEST_API_URL'];
      const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
      Object.assign(process.env, { NODE_ENV: 'production', AIJ_NEXT_DIST_DIR: '.next-af191', AIJ_TEST_API_URL: '/api' });
      try { web = requireWeb('next')({ dev: false, dir: join(root, 'apps/web'), hostname: '127.0.0.1' }); await web.prepare(); next = web.getRequestHandler(); }
      finally { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } }
    },
    close() { return closed ??= (async () => {
      const disconnected = new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
      server.closeAllConnections(); for (const socket of sockets) socket.destroy();
      await disconnected; await web?.close();
      await new Promise((yes, no) => {
        const deadline = Date.now() + 5000;
        const observe = () => { if (sockets.size === 0) yes(); else if (Date.now() >= deadline) no(Error('AF191 owned socket close events did not settle')); else setTimeout(observe, 20); };
        observe();
      });
      const count = await new Promise((yes, no) => server.getConnections((error, n) => error ? no(error) : yes(n)));
      assert.equal(count, 0); assert.equal(sockets.size, 0); assert.equal(server.listening, false);
      return { ownedSockets: count };
    })(); }
  };
}
