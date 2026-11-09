import assert from 'node:assert/strict';
import {repositoryRoot} from '../database/connection.mjs';
assert.equal(process.cwd(),repositoryRoot);
process.env.AIJ_AF145_LIVE='1';
await import('./ai-run-recovery-live.test.mjs');
