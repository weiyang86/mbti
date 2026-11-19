import assert from 'node:assert/strict';
import { repositoryRoot } from '../database/connection.mjs';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
assert.equal(repositoryRoot, root);
assert.equal(process.cwd(), root);
process.env.AIJ_AF142_ROOT_ACCEPTANCE = 'true';
await import('./client-ai-workbench-live.test.mjs');
