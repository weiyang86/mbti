import assert from 'node:assert/strict';
import{execFileSync}from'node:child_process';
import{resolve}from'node:path';
assert.equal(resolve(process.cwd()),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const git=f=>resolve(execFileSync('git',['rev-parse',f],{encoding:'utf8'}).trim());assert.equal(git('--git-dir'),git('--git-common-dir'));assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');
process.env.AIJ_AF161_ROOT_LIVE='true';
await import('./personal-agent-runs-live.test.mjs');
