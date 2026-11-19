import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
assert.deepEqual(process.argv.slice(2),['--root-af202']);
assert.equal(process.cwd(),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const root=process.cwd(),artifact=join(root,'.artifacts/auto-ai-program-20261105/W17','AF-202-actual-'+randomUUID());mkdirSync(artifact,{recursive:true,mode:0o700});
const consumer=realpathSync(mkdtempSync('/private/tmp/aij-af202-packed-'));mkdirSync(join(consumer,'packs'));
const run=(command,args,cwd=root,env=process.env,timeout=180000)=>{const r=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout,maxBuffer:4*1024*1024});assert.equal(r.error,undefined);if(r.status!==0){writeFileSync(join(artifact,'failed-command.log'),(r.stdout??'')+'\n'+(r.stderr??''));assert.fail('AF202 command failed; see '+artifact);}return r.stdout;};
try{
 for(const name of ['contracts','sdk'])run('pnpm',['pack','--pack-destination',join(consumer,'packs')],join(root,'packages',name));
 const packs=readdirSync(join(consumer,'packs')).filter(n=>n.endsWith('.tgz'));assert.equal(packs.length,2);
 writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
 run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',...packs.map(n=>join(consumer,'packs',n))],consumer);
 for(const ext of ['mts','cts']){
  writeFileSync(join(consumer,'types.'+ext),`import {createClientApi,createPersonalDocumentExportsClient,type ExportMeta,type ClientBinaryResponse,type ClientApiOptions} from '@aij/sdk';const options:ClientApiOptions={responseKind:'binary',maxResponseBytes:1024};const sdk=createPersonalDocumentExportsClient(createClientApi(()=> 'http://localhost'));declare const meta:ExportMeta;declare const binary:ClientBinaryResponse;void binary.bytes;void options;void sdk.download('space',meta);`);
  run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--lib','ES2022,DOM',join(consumer,'types.'+ext)],consumer);
 }
 run(process.execPath,['--input-type=commonjs','--eval',"const a=require('@aij/sdk');if(typeof a.createPersonalDocumentExportsClient!=='function')process.exit(1);"],consumer);
 const log=run(process.execPath,['--test','--test-reporter=tap','scripts/verification/personal-document-exports-live.test.mjs'],root,{...process.env,AIJ_AF202_ROOT_ACCEPTANCE:'true',AIJ_AF202_PACKED_CONSUMER:consumer},600000);
 writeFileSync(join(artifact,'live.log'),log);for(const p of [/# tests 11\b/,/# pass 11\b/,/# fail 0\b/,/# skipped 0\b/])assert.match(log,p);
 console.log(JSON.stringify({task:'AF-202',status:'PASS',artifact,packedConsumer:'outside repository actual ESM/CJS/strict NodeNext declarations; removed after acceptance',tapTests:11}));
}finally{assert.match(consumer,/^\/private\/tmp\/aij-af202-packed-[A-Za-z0-9]+$/);rmSync(consumer,{recursive:true,force:false});}
