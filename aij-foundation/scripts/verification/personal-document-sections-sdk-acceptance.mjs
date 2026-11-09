import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,realpathSync,readdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
assert.deepEqual(process.argv.slice(2),['--root-af224']);
assert.equal(process.cwd(),'/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation');
const root=process.cwd(),parent=join(root,'.artifacts/auto-ai-program-20261105/AF-224');mkdirSync(parent,{recursive:true});
const artifact=mkdtempSync(join(parent,'acceptance-')),consumer=realpathSync(mkdtempSync('/private/tmp/aij-af224-packed-'));
const run=(bin,args,cwd=root,env=process.env,timeout=120000)=>{
  const r=spawnSync(bin,args,{cwd,env,encoding:'utf8',timeout,maxBuffer:4*1024*1024});
  if(r.status!==0){writeFileSync(join(artifact,'failure.log'),(r.stdout??'')+'\n'+(r.stderr??''),{mode:0o600});throw Error('AF224_ACCEPTANCE_FAILED: '+artifact);}return r.stdout;
};
try{
  mkdirSync(join(consumer,'packs'));writeFileSync(join(consumer,'.af224-owned'),'AF-224\n');
  for(const name of ['contracts','sdk'])run('pnpm',['pack','--pack-destination',join(consumer,'packs')],join(root,'packages',name));
  writeFileSync(join(consumer,'package.json'),'{"private":true,"type":"module"}');
  const packs=readdirSync(join(consumer,'packs')).filter(p=>p.endsWith('.tgz')&&!p.startsWith('._'));assert.equal(packs.length,2);
  run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',...packs.map(p=>join(consumer,'packs',p))],consumer);
  const types=`import {createPersonalDocumentSectionsClient,composePersonalDocumentSectionDraft,type PersonalDocumentSectionIndex,type PersonalDocumentSectionDraft,type ComposePersonalDocumentSectionDraftInput,type ClientApi} from '@aij/sdk';\ndeclare const request:ClientApi;declare const input:ComposePersonalDocumentSectionDraftInput;const index:Promise<PersonalDocumentSectionIndex>=createPersonalDocumentSectionsClient(request).get('w','d',1);const draft:Promise<PersonalDocumentSectionDraft>=composePersonalDocumentSectionDraft(input);void index;void draft;\n`;
  writeFileSync(join(consumer,'types.mts'),types);writeFileSync(join(consumer,'types.cts'),types);
  run(join(root,'node_modules/.bin/tsc'),['--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--lib','ES2022,DOM','--strict','--skipLibCheck','types.mts','types.cts'],consumer);
  const log=run(process.execPath,['--test','--test-reporter=tap','scripts/verification/personal-document-sections-sdk-live.test.mjs'],root,{...process.env,AIJ_AF224_ROOT_ACCEPTANCE:'true',AIJ_AF224_PACKED_CONSUMER:consumer,AIJ_AF224_ROOT_ARTIFACT:artifact},360000);
  writeFileSync(join(artifact,'live.log'),log,{mode:0o600});for(const p of [/# tests 1\b/,/# pass 1\b/,/# fail 0\b/,/# skipped 0\b/])assert.match(log,p);
  console.log(JSON.stringify({task:'AF-224',status:'PASS',artifact,publicPacked:['ESM','CJS','NodeNext import/require types','actual Orca browser'],ownerAcceptance:'PENDING'}));
}finally{assert.match(consumer,/^\/private\/tmp\/aij-af224-packed-[A-Za-z0-9]+$/);rmSync(consumer,{recursive:true});}
