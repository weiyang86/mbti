// Trusted formal-runner adapter: keep its exact Node test command and sanitised
// environment, then opt in only from the explicitly authorised root workspace.
import assert from 'node:assert/strict';
import { repositoryRoot } from '../database/connection.mjs';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
assert.equal(repositoryRoot, root);
assert.equal(process.cwd(), root);
process.env.AIJ_AF141_LIVE = '1';
await import('./client-username-login-live.test.mjs');
