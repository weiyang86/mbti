import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {URL,fileURLToPath} from 'node:url';
import process from 'node:process';
test('actual typed parser/controller/service suite: 19 tests, none skipped', context=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!['NODE_TEST_CONTEXT','NODE_OPTIONS'].includes(key)));
  const r=spawnSync(process.execPath,['--test','-r','ts-node/register','--test-reporter=tap','test/personal-document-sections.test.ts'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024,env});
  context.diagnostic(r.stdout??'');if(r.stderr)context.diagnostic(r.stderr);
  assert.ifError(r.error);assert.equal(r.status,0);
  for(const [key,value]of Object.entries({tests:19,pass:19,fail:0,cancelled:0,skipped:0,todo:0}))assert.match(r.stdout,new RegExp('# '+key+' '+value+'\\b'));
});
