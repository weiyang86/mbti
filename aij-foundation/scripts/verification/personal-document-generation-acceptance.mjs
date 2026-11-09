import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, readdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
assert.deepEqual(process.argv.slice(2), ['--root-af229']);
assert.equal(process.cwd(), '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const root = process.cwd(), parent = join(root, '.artifacts/auto-ai-program-20261105/AF-229'); mkdirSync(parent, { recursive: true });
const artifact = mkdtempSync(join(parent, 'acceptance-')), consumer = realpathSync(mkdtempSync('/private/tmp/aij-af229-packed-'));
const run = (binary, args, cwd = root, env = process.env, timeout = 120000) => {
 const result = spawnSync(binary, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
 if (result.status !== 0) { writeFileSync(join(artifact, 'failure.log'), (result.stdout ?? '') + '\n' + (result.stderr ?? ''), { mode: 0o600 }); throw Error('AF229_PACKED_ACCEPTANCE_FAILED: ' + artifact); }
 return result.stdout;
};
try {
 mkdirSync(join(consumer, 'packs')); writeFileSync(join(consumer, '.af229-owned'), 'AF-229\n');
 for (const name of ['contracts', 'sdk']) run('pnpm', ['pack', '--pack-destination', join(consumer, 'packs')], join(root, 'packages', name));
 writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}');
 const packs = readdirSync(join(consumer, 'packs')).filter(p => p.endsWith('.tgz') && !p.startsWith('._')); assert.equal(packs.length, 2);
 run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...packs.map(p => join(consumer, 'packs', p))], consumer);
 const types = `import {createPersonalDocumentGenerationClient,type ClientApi,type DocumentGenerationRef,type DocumentGenerationPreviewBody,type DocumentGenerationSubmitBody,type DocumentGenerationPreview,type DocumentGenerationRunEnvelope,type DocumentGenerationRecovery} from '@aij/sdk';\ndeclare const api:ClientApi;declare const body:DocumentGenerationPreviewBody;declare const submit:DocumentGenerationSubmitBody;declare const ref:DocumentGenerationRef;const client=createPersonalDocumentGenerationClient(api);const a:Promise<DocumentGenerationPreview>=client.preview('w',body);const b:Promise<DocumentGenerationRunEnvelope>=client.submit('w',submit);const c:Promise<DocumentGenerationRunEnvelope>=client.read('w','run');const d:Promise<DocumentGenerationRecovery>=client.recover('w','request-key');void a;void b;void c;void d;void ref;\n`;
 writeFileSync(join(consumer, 'types.mts'), types); writeFileSync(join(consumer, 'types.cts'), types);
 run(join(root, 'node_modules/.bin/tsc'), ['--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM', '--strict', '--skipLibCheck', 'types.mts', 'types.cts'], consumer);
 const log = run(process.execPath, ['--test', '--test-reporter=tap', 'scripts/verification/personal-document-generation-live.test.mjs'], root, { ...process.env, AIJ_AF229_ROOT_ACCEPTANCE: 'true', AIJ_AF229_PACKED_CONSUMER: consumer, AIJ_AF229_ROOT_ARTIFACT: artifact }, 540000);
 writeFileSync(join(artifact, 'live.log'), log, { mode: 0o600 });
 for (const pattern of [/# tests 1\b/, /# pass 1\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(log, pattern);
 console.log(JSON.stringify({ task: 'AF-229', status: 'PASS', artifact, publicPacked: ['fresh outside ESM', 'fresh outside CJS', 'NodeNext import/require declarations', 'actual Orca browser WebCrypto and four real API operations'], ownerAcceptance: 'PENDING' }));
} finally { assert.match(consumer, /^\/private\/tmp\/aij-af229-packed-[A-Za-z0-9]+$/); assert.equal(readFileSync(join(consumer, '.af229-owned'), 'utf8'), 'AF-229\n'); rmSync(consumer, { recursive: true }); }
