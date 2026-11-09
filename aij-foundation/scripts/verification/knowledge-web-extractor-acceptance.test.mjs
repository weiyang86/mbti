import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
assert.equal(resolve(process.cwd()),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const git=flag=>resolve(execFileSync('git',['rev-parse',flag],{encoding:'utf8'}).trim());
assert.equal(git('--git-dir'),git('--git-common-dir'));
assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');
process.env.AF174_COMPILED_API_DIR=resolve('apps/api/dist');
await import('./knowledge-web-extractor-live.test.mjs');
