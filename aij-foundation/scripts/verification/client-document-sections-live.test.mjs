// Real original production page/API/SDK/PG/export owners, with transport-only faults.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRemainingClientFixture} from './remaining-client-fixture.mjs';
import {prepareW21UiHost} from './w21-ui-host.mjs';
import {w21NativeBrowser} from './w21-native-browser.mjs';
import {startNativeChrome} from './w22-native-chrome.mjs';
const root='/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation',hash=b=>createHash('sha256').update(b).digest('hex');
const gate=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,no)=>timer=setTimeout(()=>no(Error('AF225_REAL_HTTP_BARRIER_TIMEOUT')),15000))]);}finally{clearTimeout(timer);}};
test('AF225 actual section preview to original explicit save, recovery owners and native private lifecycle',{timeout:900000},async()=>{
  assert.equal(process.env.AIJ_AF225_ROOT_ACCEPTANCE,'true');assert.equal(process.cwd(),root);
  const artifact=process.env.AIJ_AF225_ROOT_ARTIFACT,consumer=process.env.AIJ_AF225_PACKED_CONSUMER;assert.match(consumer,/^\/private\/tmp\/aij-af225-packed-[A-Za-z0-9]+$/);
  const sdk=await import(pathToFileURL(join(consumer,'node_modules/@aij/sdk/dist/index.mjs')).href);assert.equal(hash(await readFile(join(consumer,'node_modules/@aij/sdk/dist/index.mjs'))),hash(await readFile('packages/sdk/dist/index.mjs')));
  let host,f,browser,chrome,held,storage,failure,phase='SETUP';const proof={task:'AF-225',status:'RUNNING',cases:[],ownerAcceptance:'PENDING',nativeHidden:'NOT_PROVEN'};
  const save=()=>writeFile(join(artifact,'proof.json'),JSON.stringify({...proof,phase},null,2),{mode:0o600});
  const step=async(name,fn)=>{phase=name;await save();await fn();proof.cases.push(name);await save();};
  try{
    host=await prepareW21UiHost('AF-225',artifact);
    f=await createRemainingClientFixture('AF-225',{workbenchTargetSafety:true,testBrowserOrigin:host.origin,storageEnabled:true,documentExport:{approvedImage:'sha256:b2322ac98afa484dd6722fc3e19775fca9c0bc8e360e9843b9dd0da663a602c1',dockerCliPath:'/usr/local/bin/docker'}});host.attach(f.baseUrl.replace(/\/api$/,''));
    const workspaceId=f.workspaces[0].id,memberId=f.accounts[0].id,raw=sdk.createClientApi(()=>host.origin+'/api');
    const request=(path,options={})=>raw(path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),cookie:f.cookies[0],origin:host.origin,connection:'close'}});
    const documents=sdk.createPersonalDocumentsClient(request),exports=sdk.createPersonalDocumentExportsClient(request);
    const {LocalStorageAdapter}=f.requireApi('files/local-storage.adapter.js');storage=f.app.get(LocalStorageAdapter);
    let doc=await documents.create(workspaceId,{code:'af225-native',name:'AF225 section document',body:'# One\nOriginal one.\n## Two\nKeep two.'});
    const originalExports=[];for(const format of ['docx','pdf'])originalExports.push(await exports.create(workspaceId,{documentId:doc.id,expectedRevision:1,format}));
    const oldBytes=await Promise.all(originalExports.map(e=>exports.download(workspaceId,e)));
    doc=await documents.update(workspaceId,doc.id,{expectedRevision:1,name:doc.name,body:'# One\nSecond saved body.\n## Two\nKeep two.'});
    const legacy=await Promise.all([1,2].map(r=>documents.getVersion(workspaceId,doc.id,r))),current=()=>documents.get(workspaceId,doc.id);
    const runtimeCounts=async()=>Promise.all([f.prisma.aiAgentRun.count(),f.prisma.runtimeJob.count(),f.prisma.aiExecutionTrace.count()]);const runtimeBefore=await runtimeCounts();
    const path='/api/client/documents/'+doc.id,patches=()=>host.traffic.filter(r=>r.method==='PATCH'&&r.path===path).length;
    await host.startWeb();browser=w21NativeBrowser(artifact);
    const account=JSON.parse(await readFile(f.accounts[0].initialPasswordFile,'utf8')).accounts.find(a=>a.id===memberId);
    const click=async(label,selector)=>{await browser.action('wait',['--fn','[...(document.querySelector('+JSON.stringify(selector??'body')+')?.querySelectorAll("button")??[])].filter(b=>!b.disabled&&(b.getAttribute("aria-label")??b.textContent).replace(/\\s/g,"")==='+JSON.stringify(label.replace(/\s/g,''))+').length===1']);return browser.action('click',['--element',await browser.ref(label,'button',selector)]);};
    const open=async()=>{await browser.action('goto',['--url',host.origin+'/client/documents?workspaceId='+workspaceId]);await browser.action('switch');await browser.action('wait',['--selector','[aria-label="个人文档库"]']);await click('读取文档列表');await browser.wait(doc.code);await click('打开','[aria-label="个人文档库"]');await browser.wait('编辑文档 · v');await click('退出编辑，比较历史');await browser.wait('已保存文档 · v');};
    const draftLabel='局部草稿（替换完整章节，含标题）',draftSelector='[aria-label="选中章节局部编辑"] textarea';
    const select=async()=>{await click('验证并读取章节目录');await click('1. One');await browser.action('wait',['--selector',draftSelector]);};
    const compare=async replacement=>{await select();await browser.fill(draftLabel,replacement,false,draftSelector);await click('验证并预览局部替换');await browser.action('wait',['--selector','[aria-label="局部替换前后预览"]']);};
    await step('production-desktop-noop-cancel-apply-is-unsaved-and-one-original-save',async()=>{
      await browser.action('create',['--url',host.origin+'/client/login','--split','right']);await browser.action('switch');await browser.action('wait',['--selector','input[type="email"]']);
      await browser.fill('邮箱',f.accounts[0].email,true,'input[type="email"]');await browser.fill('密码',account.password,true);await click('登录');await browser.action('wait',['--url','/client/workspaces']);await open();
      const before=patches();await select();await click('验证并预览局部替换');await browser.wait('相同，无需应用');assert.equal(patches(),before);assert.equal((await current()).revision,2);
      await browser.fill(draftLabel,'# One\nAF225 section draft.\n',false,draftSelector);await click('验证并预览局部替换');await click('检查应用到全文草稿（尚未保存）');await browser.wait('确认应用到全文草稿（尚未保存）');await click('取消，返回比较');assert.equal(patches(),before);
      await browser.shot('desktop-section-comparison');await click('检查应用到全文草稿（尚未保存）');await click('应用到全文草稿');await browser.wait('已应用到全文草稿，尚未保存');
      assert.equal(await browser.read('document.querySelector("textarea[aria-label=文档正文]")?.value==="# One\\nAF225 section draft.\\n## Two\\nKeep two."'),true);assert.equal((await current()).revision,2);assert.equal(patches(),before);
      assert.equal(await browser.read('document.body.innerText.includes("验证并读取章节目录")'),false);await click('明确保存');await browser.wait('编辑文档 · v3');assert.equal((await current()).revision,3);assert.equal(patches(),before+1);
      assert.equal(await f.prisma.personalDocumentVersion.count({where:{documentId:doc.id}}),3);
    });
    await step('mobile390-original-save-lost-reply-keeps-one-recovery-lock-and-no-replay',async()=>{
      await click('退出编辑，比较历史');await browser.action('viewport',['--width','390','--height','844','--scale','1','--mobile']);assert.equal(await browser.read('innerWidth'),390);
      await compare('# One\nAF225 mobile draft.\n');assert.equal(await browser.read('document.documentElement.scrollWidth<=innerWidth+1'),true);await browser.shot('mobile390-section-comparison');
      await click('检查应用到全文草稿（尚未保存）');await click('应用到全文草稿');const before=patches(),lost=host.lose('PATCH',path);await click('明确保存');await gate(lost.committed.promise);await browser.wait('后续变更已锁定');
      assert.equal((await current()).revision,4);assert.equal(patches(),before+1);assert.equal(await browser.read('document.body.innerText.includes("验证并读取章节目录")'),false);
      await click('关闭并清除正文');await browser.wait('后续变更已锁定');await click('主动读取当前结果');await browser.wait('当前服务端修订为 v4');await click('已核对，确认结果');await browser.wait('已确认当前读取结果');assert.equal(patches(),before+1);await click('退出编辑，比较历史');
    });
    await step('original-history-restore-unknown-lock-also-blocks-sections-and-is-not-replaced',async()=>{
      await click('验证并读取文档历史');await click('比较文档历史 v1');await click('检查恢复为新版本');const before=patches(),lost=host.lose('PATCH',path);await click('确认创建新版本');await gate(lost.committed.promise);await browser.wait('后续恢复已锁定');
      assert.equal((await current()).revision,5);assert.equal(await browser.read('document.body.innerText.includes("验证并读取章节目录")'),false);
      await click('关闭并清除正文');await click('读取文档列表');await browser.wait(doc.code);await click('打开','[aria-label="个人文档库"]');await browser.wait('已保存文档 · v5');
      assert.equal(await browser.read('document.body.innerText.includes("验证并读取章节目录")'),false);await click('读取前次恢复的当前结果');await browser.wait('当前保存版本 v5');await click('已核对，重新验证并解除恢复锁');await browser.wait('已保存文档 · v5');assert.equal(patches(),before+1);
    });
    await step('real-human-CAS-and-late-index-permission-revocation-clear-parent-and-child',async()=>{
      await compare('# One\nMust not overwrite human.\n');const head=await current();await documents.update(workspaceId,doc.id,{expectedRevision:head.revision,name:head.name,body:'# One\nHuman newer revision.\n## Two\nKeep two.'});const before=patches();
      await click('检查应用到全文草稿（尚未保存）');await browser.wait('当前修订或正文已变化');assert.equal((await current()).revision,6);assert.equal(patches(),before);
      await open();held=host.hold(path+'/sections');await click('验证并读取章节目录');await gate(held.entered.promise);
      const permission=await f.prisma.clientWorkspacePermission.findUniqueOrThrow({where:{code:'workspace.documents.read'}});await f.prisma.clientWorkspacePermission.update({where:{id:permission.id},data:{status:'disabled'}});
      try{held.release.resolve();held=undefined;await browser.action('wait',['--fn','!document.querySelector("pre[aria-label=已保存正文]")&&!document.querySelector("[aria-label=选中章节局部编辑]")&&!document.querySelector("textarea[aria-label=文档正文]")']);assert.equal(patches(),before);}
      finally{await f.prisma.clientWorkspacePermission.update({where:{id:permission.id},data:{status:permission.status}});}
    });
    await step('mandatory-headed-native-chrome-actual-blur-hidden-and-in-page-unmount',async()=>{
      await browser.close();await mkdir(join(artifact,'chrome'),{recursive:true});chrome=await startNativeChrome({origin:host.origin,artifact:join(artifact,'chrome'),disablePasswordManager:true,foregroundInputs:true,traceFocus:true});
      await chrome.fill('邮箱',f.accounts[0].email,'input[type="email"]',true);await chrome.fill('密码',account.password,'input[type="password"]',true);await chrome.click('登录');await chrome.wait('location.pathname==="/client/workspaces"');
      const reveal=async selector=>{
        for(let i=0;i<8;i++){
          const bounds=await chrome.read('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {visible:r.top>=0&&r.bottom<=innerHeight,up:r.top<0};})()');if(bounds.visible)return;
          const state=await chrome.native(['get-app-state']),area=state.snapshot.treeText.split('\n').find(l=>/^\s*\d+ 滚动区/.test(l));assert.ok(area);
          await chrome.native(['scroll','--element-index',area.trim().split(' ',1)[0],'--direction',bounds.up?'up':'down','--pages','1']);
        }assert.fail('AF225_NATIVE_FIELD_MUST_BE_VISIBLE');
      };
      const fillNativeSection=async value=>{
        await reveal(draftSelector);const state=await chrome.native(['get-app-state']);
        const bounds=await chrome.read('(()=>{const r=document.querySelector('+JSON.stringify(draftSelector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,h:innerHeight,w:innerWidth};})()');
        assert.equal(state.snapshot.window.width,bounds.w);assert.ok(bounds.y>0&&bounds.y<bounds.h);
        await chrome.native(['click','--x',String(Math.round(bounds.x)),'--y',String(Math.round(state.snapshot.window.height-bounds.h+bounds.y))]);
        await chrome.wait('document.activeElement===document.querySelector('+JSON.stringify(draftSelector)+')&&document.hasFocus()');
        const fresh=await chrome.native(['get-app-state','--query',draftLabel]);
        const fields=fresh.snapshot.treeText.split('\n').filter(l=>/^\s*\d+ /.test(l)&&l.includes('settable')&&l.includes(draftLabel));
        proof.nativeDraftFieldRoles=fresh.snapshot.treeText.split('\n').filter(l=>l.includes(draftLabel)).map(l=>l.split(/, (?:Value|Placeholder):/,1)[0]);
        assert.equal(fields.length,1,'AF225_NATIVE_UNIQUE_SETTABLE_DRAFT_REQUIRED');
        try{await chrome.native(['set-value','--element-index',fields[0].trim().split(' ',1)[0],'--value-stdin'],value);}catch(error){if(error.code!=='verification_failed')throw error;}
        assert.equal(await chrome.read('document.querySelector('+JSON.stringify(draftSelector)+')?.value==='+JSON.stringify(value)),true);
        proof.nativeDraftInput={exactValueObserved:true,byteLength:Buffer.byteLength(value)};
      };
      const nativeCompare=async()=>{
        proof.nativeStage='navigate';await chrome.navigate('/client/documents?workspaceId='+workspaceId);await chrome.wait('!!document.querySelector("h1")&&document.body.innerText.includes("我的文档")');await chrome.key('Escape');
        await chrome.foreground();await reveal('h1');const window=await chrome.native(['get-app-state']);const heading=await chrome.read('(()=>{const r=document.querySelector("h1").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,h:innerHeight};})()');
        await chrome.native(['click','--x',String(Math.round(heading.x)),'--y',String(Math.round(window.snapshot.window.height-heading.h+heading.y))]);
        await chrome.wait('document.hasFocus()&&document.body.innerText.includes("读取文档列表")');await chrome.click('读取文档列表');await chrome.wait('document.body.innerText.includes('+JSON.stringify(doc.code)+')');await chrome.click('打开');await chrome.click('退出编辑，比较历史');
        proof.nativeStage='load-sections';await chrome.click('验证并读取章节目录');await chrome.click('1. One');await chrome.wait('document.hasFocus()&&!!document.querySelector('+JSON.stringify(draftSelector)+')');proof.nativeStage='fill-section';await fillNativeSection('# One\nAF225 private native draft.\n');await chrome.click('验证并预览局部替换');await chrome.click('检查应用到全文草稿（尚未保存）');await chrome.wait('!!document.querySelector("[role=dialog]")');
      };
      const clear='!document.querySelector("textarea[aria-label=文档正文]")?.value&&!document.querySelector("pre[aria-label=已保存正文]")?.textContent&&!document.querySelector("[aria-label=选中章节局部编辑]")&&!document.querySelector("[aria-label=局部替换前后预览]")&&!document.querySelector("[aria-label=当前与历史文档比较]")&&!document.querySelector("[role=dialog]")';
      const before=patches();await nativeCompare();proof.chromeScreenshot=await chrome.shot('native-section-confirmation');const blur=await chrome.blur(clear);assert.equal(blur.focused,false);assert.equal(blur.hidden,false);assert.equal(blur.clear,true);
      await nativeCompare();const hidden=await chrome.hidden(clear);assert.equal(hidden.hidden,true);assert.equal(hidden.clear,true);proof.nativeHidden='ACTUAL_OBSERVED';
      await nativeCompare();await chrome.click('取消，返回比较');
      proof.nativeStage='unmount-link';await reveal('nav[aria-label="文档导航"] a[href="/client/ai"]');
      let focusedLink=false;
      for(let i=0;i<40;i++){
        focusedLink=await chrome.read('document.hasFocus()&&document.activeElement?.tagName==="A"&&document.activeElement.getAttribute("href")==="/client/ai"');if(focusedLink)break;
        await chrome.key('Tab');
      }
      assert.equal(focusedLink,true,'AF225_REAL_KEYBOARD_NAV_LINK_REQUIRED');await chrome.key('Return');await chrome.wait('location.pathname==="/client/ai"');assert.equal(await chrome.read(clear),true);assert.equal(await chrome.read('document.hasFocus()'),true);assert.equal(patches(),before);proof.nativeUnmountMethod='REAL_TAB_ENTER_ON_CURRENT_ANCHOR';
    });
    await step('all-old-immutable-history-export-references-and-bytes-original-runtime-owner-preserved',async()=>{
      assert.equal(hash(JSON.stringify(await Promise.all([1,2].map(r=>documents.getVersion(workspaceId,doc.id,r))))),hash(JSON.stringify(legacy)));
      for(const [i,e]of originalExports.entries()){assert.equal(hash(JSON.stringify(await exports.get(workspaceId,e.id))),hash(JSON.stringify(e)));assert.equal(hash((await exports.download(workspaceId,e)).bytes),hash(oldBytes[i].bytes));}
      assert.equal(await f.prisma.personalDocumentExport.count({where:{documentId:doc.id}}),2);assert.deepEqual(await runtimeCounts(),runtimeBefore);assert.equal((await current()).revision,6);proof.acceptanceId=f.lease.id;
    });proof.status='PASS';await save();
  }catch(error){failure=error;proof.status='FAIL';if(chrome)try{proof.nativeFailureState=await chrome.read('({focused:document.hasFocus(),hidden:document.hidden,path:location.pathname,activeElement:document.activeElement?.tagName,buttons:[...document.querySelectorAll("button")].map(b=>({label:b.getAttribute("aria-label")??b.textContent,disabled:b.disabled}))})');proof.nativeFailureScreenshot=await chrome.shot('failure');}catch{/* retain original failure */}
    await writeFile(join(artifact,'failure.json'),JSON.stringify({phase,code:error?.code??'FAILED',frames:String(error?.stack??'').split('\n').filter(l=>/^\s+at /.test(l)).slice(0,8),traffic:host?.traffic.slice(-12)},null,2),{mode:0o600});}
  finally{held?.release.resolve();const failures=[];for(const close of [()=>chrome?.close(),()=>browser?.close(),()=>host?.close()])try{await close();}catch{failures.push('HOST_OR_BROWSER');}
    if(f)try{if(storage)for(const a of await f.prisma.fileAsset.findMany({where:{workspaceId:{in:f.workspaces.map(w=>w.id)}},select:{objectKey:true}}))if(await storage.exists(a.objectKey))await storage.remove(a.objectKey);const closed=await f.close();for(const key of ['applicationPools0','ownedSockets0','environmentRestored'])assert.equal(closed[key],true);}catch{failures.push('FIXTURE');}
    await writeFile(join(artifact,'closed.json'),JSON.stringify({status:failures.length?'CLEANUP_FAILED':'CLOSED',failures}),{mode:0o600});if(failures.length)failure=Error('AF225_MEASURED_CLEANUP_FAILED');await save();}
  if(failure)throw Error('AF225_REAL_FAILED_AT_'+phase+': '+artifact);
});
