// Root-only second OS process for the actual production API and renderer; never production code.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {repositoryRoot} from '../database/connection.mjs';
assert.equal(process.env.AIJ_AF202_ROOT_PEER,'true');assert.ok(process.send);assert.equal(process.cwd(),repositoryRoot);
const require=createRequire(join(repositoryRoot,'apps/api/package.json'));
require('@nestjs/common').Logger.overrideLogger(false);
const {createApplication}=require(join(repositoryRoot,'apps/api/dist/bootstrap.js'));
const {GeneratedFileAssetsService}=require(join(repositoryRoot,'apps/api/dist/files/generated-file-assets.service.js'));
const app=await createApplication();let release,armed=false,closing=false;
const files=app.get(GeneratedFileAssetsService),original=files.stage.bind(files);
files.stage=async(...args)=>{const ticket=await original(...args);if(armed){armed=false;await new Promise(resolve=>{release=resolve;process.send({kind:'staged'});});}return ticket;};
const close=async()=>{if(closing)return;closing=true;release?.();app.getHttpServer().closeAllConnections();await app.close();process.send({kind:'closed',listening:app.getHttpServer().listening});process.exitCode=0;process.disconnect();};
process.on('message',message=>{if(message?.kind==='arm'){assert.equal(armed,false);assert.equal(release,undefined);armed=true;process.send({kind:'armed'});}else if(message?.kind==='release'){release?.();release=undefined;}else if(message?.kind==='close')void close();});
process.on('disconnect',()=>{void close();});
await app.listen(0,'127.0.0.1');process.send({kind:'ready',port:app.getHttpServer().address().port,pid:process.pid});
