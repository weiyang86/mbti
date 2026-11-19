import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
assert.equal(process.cwd(), root);
assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
process.env.AIJ_AF189_ROOT_LIVE = '1';
process.env.AIJ_AF189_NATIVE_ADAPTER = resolve('.artifacts/auto-ai-program-20261105/AF-189/native-publications.mjs');
await import('./personal-agent-publications-live.test.mjs');
