import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root='/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';assert.equal(resolve(process.cwd()),root);
const git=f=>resolve(execFileSync('git',['rev-parse',f],{encoding:'utf8'}).trim());assert.equal(git('--git-dir'),git('--git-common-dir'));assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');
const folder=join(root,'.artifacts/auto-ai-program-20261105/AF-163');mkdirSync(folder,{recursive:true});const owned=mkdtempSync(join(folder,'packed-')),packs=join(owned,'packs'),consumer=join(owned,'consumer');mkdirSync(packs);mkdirSync(consumer);execFileSync('git',['check-ignore','--quiet',owned]);
const dependencies={};
for(const name of ['contracts','sdk']){const before=new Set(readdirSync(packs));execFileSync('pnpm',['pack','--pack-destination',packs],{cwd:join(root,'packages',name),stdio:'pipe'});const made=readdirSync(packs).filter(f=>f.endsWith('.tgz')&&!f.startsWith('._')&&!before.has(f));assert.equal(made.length,1);const manifest=JSON.parse(execFileSync('tar',['-xOf',join(packs,made[0]),'package/package.json'],{encoding:'utf8'}));assert.equal(manifest.name,'@aij/'+name);assert.equal(manifest.private,true);assert.deepEqual(manifest.files,['dist']);if(name==='sdk')assert.equal(manifest.dependencies['@aij/contracts'],'0.1.0');dependencies['@aij/'+name]='file:../packs/'+made[0];}
writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'aij-af163-packed-http-consumer',version:'0.0.0',private:true,type:'module',dependencies,pnpm:{overrides:{'@aij/contracts':dependencies['@aij/contracts']}}},null,2)+'\n');
execFileSync('pnpm',['--dir',consumer,'install','--offline','--ignore-workspace','--ignore-scripts','--lockfile=false','--store-dir',join(owned,'store')],{cwd:root,stdio:'pipe',timeout:120000});assert.ok(realpathSync(join(consumer,'node_modules/@aij/sdk')).startsWith(consumer+'/node_modules/'));
writeFileSync(join(folder,'packed-consumer.json'),JSON.stringify({task:'AF-163',consumer,dependencies,network:'offline',scripts:false},null,2)+'\n');
process.env.AIJ_AF163_PACKED_CONSUMER=consumer;process.env.AIJ_AF163_ROOT_LIVE='1';
await import('./personal-memories-live.test.mjs');
