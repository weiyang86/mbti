import assert from 'node:assert/strict';
import{repositoryRoot}from'../database/connection.mjs';
assert.equal(process.cwd(),repositoryRoot);
process.env.AIJ_AF146_ROOT_LIVE='1';
await import('./knowledge-csv-import-live.test.mjs');
