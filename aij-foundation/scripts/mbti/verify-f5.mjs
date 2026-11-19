// Test4156 only. Raw synthetic contacts/tokens live only in ignored 0600 state.
// Evidence contains statuses, channel names and boolean assertions, never response/request bodies.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { root, testContext } from "./test-context.mjs";
const phase = process.argv[2] || "prepare";
assert.ok(["prepare", "restart"].includes(phase));
const base = "http://192.168.0.200:4156/api/v1";
const { db, env, ownerRoot } = await testContext();
const dir = resolve(root, ".artifacts"); mkdirSync(dir, { recursive: true, mode: 0o700 });
const statePath = resolve(dir, "mbti-f5-http-state.json");
let s = { tokens: {}, cards: {}, owners: {}, contacts: {}, invalid: [] };
if (phase === "restart") s = JSON.parse(readFileSync(statePath, "utf8"));
const report = { status: "candidate / needs_human_review", phase, base, revision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), checks: [], assertions: [] };
function ok(label, value) { assert.ok(!!value, label); report.assertions.push({ label, passed: true }); }
const rawValues = () => Object.values(s.contacts).flatMap(c => Object.values(c));
function noValues(data) { const raw = JSON.stringify(data) || ""; ok("public projection contains no contact canary", rawValues().every(value => !raw.includes(value))); }
function noInternal(data) {
 const forbidden = ["ownerId", "senderId", "recipientId", "exchangeId", "objectKey", "checksum", "contactEpoch", "epoch", "path", "tokenHash"];
 const walk = value => !value || typeof value !== "object" || Object.entries(value).every(([k,v]) => !forbidden.includes(k) && walk(v));
 ok("HTTP has no internal storage/owner identifiers", walk(data));
}
async function req(actor, method, path, body, expected = 200, label = path, allowValues = false) {
 const headers = { ...(s.tokens[actor] ? {"X-Guest-Token":s.tokens[actor]} : {}), ...(body !== undefined ? {"Content-Type":"application/json"} : {}) };
 const r = await fetch(base+path, {method,headers,body:body === undefined ? undefined : JSON.stringify(body)});
 const text = await r.text(); let data;
 try { data = text ? JSON.parse(text) : undefined; } catch { data = {}; }
 const passed = (Array.isArray(expected) ? expected : [expected]).includes(r.status);
 report.checks.push({ id: `${phase === "prepare" ? "P" : "R"}${String(report.checks.length+1).padStart(3,"0")}`, actor, method, path, label, status:r.status, expected, passed, no_store:r.headers.get("cache-control")==="no-store", ...(data?.code ? {code:data.code} : {}), ...(Array.isArray(data?.channels) ? {channels:data.channels.map(x=>typeof x === "string"?x:x.channel)} : {}) });
 assert.ok(passed, `${label}: unexpected status ${r.status}`);
 if (!path.startsWith("/auth/guest")) {
  assert.ok(r.headers.get("cache-control")==="no-store", `${label}: no-store`);
  noInternal(data); if (!allowValues || r.status >= 400) noValues(data);
 }
 if (r.status>=400) ok("error exact code/message only", !!data?.code && !!data?.message && Object.keys(data).sort().join(",")==="code,message");
 return {status:r.status,data};
}
const get = async (a,p,e=200,l=p,v=false)=>(await req(a,"GET",p,undefined,e,l,v)).data;
const put = async (a,b,e=200)=>(await req(a,"PUT","/contacts/me",b,e,"own full replacement",true)).data;
const list = a=>get(a,"/contact-requests");
const create = async (a,b,channels=["wechat"],e=201,l="create directional request")=>(await req(a,"POST","/contact-requests",{buddy_id:s.cards[b],channels},e,l)).data;
const respond = async (a,id,action="accept",e=200,l="respond pending recipient")=>(await req(a,"POST",`/contact-requests/${id}/respond`,{action},e,l)).data;
const revoke = (a,id,e=204,l="both parties revoke")=>req(a,"DELETE",`/contact-requests/${id}`,undefined,e,l);
const grant = (a,id,e=200)=>get(a,`/contact-requests/${id}/granted`,e,"sender exact grant",true);
const card = (a,b)=>req(a,"PUT","/cards/me",b,200,"explicit card choice");
const block = (a,b)=>req(a,"POST",`/buddies/${s.cards[b]}/block`,undefined,200,"block invalidates");
const unblock = (a,b)=>req(a,"DELETE",`/buddies/${s.cards[b]}/block`,undefined,204,"unblock no revival");
async function exchange(a,b) {
 const r=(await req(a,"POST","/card-exchanges",{buddy_id:s.cards[b]},201,"new base exchange")).data;
 await req(b,"POST",`/card-exchanges/${r.id}/respond`,{action:"accept"},200,"accept base exchange"); return r.id;
}
async function accepted(a="A",b="B",channels=["wechat"]) { const r=await create(a,b,channels);await respond(b,r.id);return r.id; }
async function absent(a,id,label) { await grant(a,id,404);ok(label,true); }
function synth() {return {wechat:"f5_"+randomBytes(7).toString("hex"),qq:String(100000000+randomBytes(3).readUIntBE(0,3)),phone:"199"+String(randomBytes(4).readUInt32BE()%100000000).padStart(8,"0")};}
async function refs(a) {return (await db.query('SELECT * FROM "MbtiPrivateContacts" WHERE "ownerId"=$1',[s.owners[a]])).rows[0];}
function storageOwner(a) {return resolve(ownerRoot,env.LOCAL_STORAGE_ROOT,"mbti-contacts",createHash("sha256").update(s.owners[a]).digest("hex"));}
async function scan() {
 for(const a of ["A","B","C"]) {
  await get(a,"/cards/me");await get(a,"/buddies?limit=100");await get(a,"/buddies/blocked");await get(a,"/card-exchanges");await list(a);
  for(const b of ["A","B","C"].filter(b=>a!==b)) {await get(a,"/cards/"+s.cards[b]);await get(a,"/buddies/"+s.cards[b]);}
 }
 const log=readFileSync(resolve(ownerRoot,".local-data/mbti-foundation/test/api.log"),"utf8");
 ok("API log canary scan: absent",rawValues().every(v=>!log.includes(v)));
 const rows=(await db.query('SELECT row_to_json(c) r FROM "MbtiPrivateContacts" c WHERE "ownerId"=ANY($1::text[])',[Object.values(s.owners)])).rows;
 const rel=(await db.query('SELECT row_to_json(c) r FROM "MbtiContactRequest" c WHERE "senderId"=ANY($1::text[]) OR "recipientId"=ANY($1::text[])',[Object.values(s.owners)])).rows;
 noValues(rows);noValues(rel);ok("DB references only, no contact columns",rows.every(x=>Object.keys(x.r).sort().join(",")==="checksum,epoch,objectKey,ownerId,size,updatedAt"));
 const count=(await db.query('SELECT COUNT(*)::int n FROM "MbtiContactRequest" WHERE "senderId"=ANY($1::text[]) AND status IN (\'pending\',\'accepted\') GROUP BY "senderId","recipientId"',[Object.values(s.owners)])).rows;
 ok("auxiliary DB directed active uniqueness",count.every(x=>x.n<=1));
}
try {
 if(phase==="restart") {
  for(const a of ["A","B","C"]) {
   ok("original guest/card identity persists",(await get(a,"/cards/me")).id===s.cards[a]);
   ok("original own contacts persist",JSON.stringify(await get(a,"/contacts/me",200,"own persistence",true))===JSON.stringify(s.contacts[a]));
  }
  const g=await grant("A",s.valid);ok("valid grant persists exact set",g.channels.length===1&&g.channels[0].channel==="wechat"&&g.channels[0].value===s.contacts.B.wechat);
  for(const id of s.invalid) await absent("A",id,"invalid grant remains invalid after restart");
  await absent("B",s.valid,"recipient cannot granted after restart");await absent("C",s.valid,"C cannot granted after restart");
  ok("pending persists without grant",(await list("A")).items.some(x=>x.id===s.pending&&x.status==="pending"));await absent("A",s.pending,"pending never grants");await scan();
 } else {
  for(const a of ["A","B","C"]) {
   s.tokens[a]=(await req("none","POST","/auth/guest",undefined,201,"separate guest "+a)).data.guest_token;
   s.owners[a]=(await db.query('SELECT id FROM "MbtiGuest" WHERE "tokenHash"=$1',[createHash("sha256").update(s.tokens[a]).digest("hex")])).rows[0].id;
   ok("new own contacts empty",Object.keys(await get(a,"/contacts/me")).length===0);
   s.cards[a]=(await card(a,{type_code:a==="B"?"INFP":"ESTJ",discoverable:true})).data.id;
   s.contacts[a]=synth();ok("own PUT own values only",JSON.stringify(await put(a,s.contacts[a]))===JSON.stringify(s.contacts[a]));
  }
  s.tokens.D=(await req("none","POST","/auth/guest",undefined,201,"sender without card")).data.guest_token;
  await create("D","B",["wechat"],404,"no-card sender cannot request");
  await req("A","DELETE","/contacts/me?ownerId=x",undefined,422,"clear has no owner selector");
  const first=await refs("B");await put("B",{phone:s.contacts.B.phone,qq:s.contacts.B.qq,wechat:"  "+s.contacts.B.wechat+"  "});ok("identical normalized PUT version idempotent",(await refs("B")).epoch===first.epoch);
  for(const b of [{ownerId:"x"},{wechat:null},{qq:12345},{phone:[]},{wechat:"x"},{qq:"0"},{phone:"bad"},{authorized:{}},[]])await put("B",b,422);
  for(const b of [null,1,"x"])await put("B",b,400);
  await req("A","GET","/contacts/me?ownerId=x",undefined,422,"no owner query");await req("A","GET","/contact-requests?buddy_id=x&buddy_id=y",undefined,422,"no duplicate query");
  await create("A","B",["wechat"],409,"base exchange required");s.baseAB=await exchange("A","B");s.baseAC=await exchange("A","C");await absent("A","unknown","base acceptance alone gives no grant");
  for(const channels of [[],["wechat","wechat"],["email"],["wechat","qq","phone","wechat"],null,"wechat",[1]])await create("A","B",channels,422,"strict channel validation");
  await create("A","A",["wechat"],422,"no self request");await req("A","POST","/contact-requests",{buddy_id:s.cards.B,channels:["wechat"],senderId:"x"},422,"no forged sender");
  ok("PUT omitted fields removed",Object.keys(await put("B",{wechat:s.contacts.B.wechat})).join(",")==="wechat");await create("A","B",["qq"],409,"missing recipient channel generic conflict");await put("B",s.contacts.B);
  let p=await create("A","B");await absent("A",p.id,"pending404");await absent("B",p.id,"recipient404");await absent("C",p.id,"C404");
  ok("pending retry same ID",(await create("A","B",["wechat"],200)).id===p.id);await create("A","B",["qq"],409,"different pending set conflict");
  ok("incoming buddy sender card",(await list("B")).items.some(x=>x.id===p.id&&x.direction==="incoming"&&x.buddy_id===s.cards.A));ok("outgoing buddy recipient card",(await list("A")).items.some(x=>x.id===p.id&&x.direction==="outgoing"&&x.buddy_id===s.cards.B));
  ok("C cannot list request",!(await list("C")).items.some(x=>x.id===p.id));ok("buddy filter exact",(await get("B","/contact-requests?buddy_id="+s.cards.A)).items.every(x=>x.buddy_id===s.cards.A));
  await respond("A",p.id,"accept",409);await respond("C",p.id,"accept",404);await revoke("C",p.id,404);await req("C","POST",`/contact-requests/${p.id}/respond`,{action:"bad",ownerId:"x"},404,"third party before body");
  await respond("B",p.id,"bad",422);await req("B","POST",`/contact-requests/${p.id}/respond`,{action:"accept",channels:["qq"]},422,"no partial expansion");await respond("B",p.id);
  let g=await grant("A",p.id);ok("only exact wechat no QQ phone",g.channels.length===1&&g.channels[0].channel==="wechat"&&g.channels[0].value===s.contacts.B.wechat);await absent("B",p.id,"recipient cannot granted");await absent("C",p.id,"C cannot granted");
  await create("A","B",["wechat"],409,"accepted duplicate");await respond("B",p.id,"decline",409);
  const reverse=await create("B","A",["qq"]);await absent("B",reverse.id,"reverse not autoaccepted");await respond("A",reverse.id);g=await grant("B",reverse.id);ok("reverse exact QQ grant independent",g.channels.length===1&&g.channels[0].channel==="qq"&&g.channels[0].value===s.contacts.A.qq);
  await revoke("B",p.id);await revoke("A",p.id);await absent("A",p.id,"recipient revoke immediate");await grant("B",reverse.id);await revoke("B",reverse.id);
  p=await create("A","B");await revoke("A",p.id);await revoke("B",p.id);await absent("A",p.id,"sender pending cancel");
  p=await create("A","B");await revoke("B",p.id);await revoke("B",p.id);await absent("A",p.id,"recipient pending revoke");
  p=await create("A","B");await respond("B",p.id,"decline");await absent("A",p.id,"declined no grant");await revoke("A",p.id,409);s.invalid.push(p.id);
  p=await accepted();await revoke("A",p);await absent("A",p,"sender accepted revoke");s.invalid.push(p);
  const parallel=await Promise.all(Array.from({length:8},()=>req("A","POST","/contact-requests",{buddy_id:s.cards.B,channels:["phone","wechat"]},[200,201],"parallel directed create")));
  ok("parallel one ID one201",new Set(parallel.map(r=>r.data.id)).size===1&&parallel.filter(r=>r.status===201).length===1);p=parallel[0].data.id;ok("fixed channel order",parallel[0].data.channels.join(",")==="wechat,phone");await revoke("A",p);
  p=(await create("A","B")).id;let race=await Promise.all([req("B","POST",`/contact-requests/${p}/respond`,{action:"accept"},[200,409],"race accept"),req("B","POST",`/contact-requests/${p}/respond`,{action:"decline"},[200,409],"race decline")]);ok("one pending response wins",race.filter(r=>r.status===200).length===1);if(race.some(r=>r.data?.status==="accepted"))await revoke("A",p);
  p=(await create("A","B")).id;race=await Promise.all([req("B","POST",`/contact-requests/${p}/respond`,{action:"accept"},[200,409],"triple accept"),req("B","POST",`/contact-requests/${p}/respond`,{action:"decline"},[200,409],"triple decline"),revoke("A",p,[204,409],"triple revoke")]);ok("replies never both succeed",race.slice(0,2).filter(r=>r.status===200).length<=1);await absent("A",p,"race terminal unauthorized");
  p=(await create("A","B")).id;s.contacts.B_old=s.contacts.B;s.contacts.B=synth();await put("B",s.contacts.B);await respond("B",p,"accept",409);await absent("A",p,"pending old epoch rejected");s.invalid.push(p);
  p=await accepted();await put("B",s.contacts.B);await grant("A",p);await req("B","DELETE","/contacts/me",undefined,204,"clear");await req("B","DELETE","/contacts/me",undefined,204,"clear idempotent");ok("cleared own {}",Object.keys(await get("B","/contacts/me")).length===0);await absent("A",p,"clear invalidates accepted");await put("B",s.contacts.B);await absent("A",p,"refill no revival");s.invalid.push(p);
  p=await accepted();s.contacts.B_old2=s.contacts.B;s.contacts.B=synth();await put("B",s.contacts.B);await absent("A",p,"change cannot disclose new values");s.invalid.push(p);
  for(const blocker of ["A","B"]) {
   p=await accepted();await block(blocker,blocker==="A"?"B":"A");await absent("A",p,"either direction block");await create("A","B",["wechat"],404,"blocked create hidden");await respond("B",p,"accept",404);await revoke("A",p,404);ok("blocked list omits",!(await list("A")).items.some(x=>x.buddy_id===s.cards.B));await unblock(blocker,blocker==="A"?"B":"A");await absent("A",p,"unblock no revival");s.baseAB=await exchange("A","B");await absent("A",p,"new base no revival");s.invalid.push(p);
  }
  p=await accepted();await req("A","DELETE",`/card-exchanges/${s.baseAB}`,undefined,204,"withdraw bound base");await absent("A",p,"base revoke denies grant");s.baseAB=await exchange("B","A");await absent("A",p,"new reverse base no revival");s.invalid.push(p);
  for(const who of ["A","B"]) {p=await accepted();await card(who,{discoverable:false});await absent("A",p,"private optout");await create("A","B",["wechat"],404,"private create denied");await card(who,{discoverable:true});await absent("A",p,"republic no revival");s.invalid.push(p);}
  p=await accepted();await Promise.all([block("A","B"),grant("A",p,[200,404])]);await absent("A",p,"post block race denies");await unblock("A","B");s.baseAB=await exchange("A","B");
  p=await accepted();await Promise.all([req("B","DELETE","/contacts/me",undefined,204,"clear race"),grant("A",p,[200,404])]);await absent("A",p,"post clear race denies");await put("B",s.contacts.B);
  p=await accepted();const ref=await refs("B"),objectPath=resolve(storageOwner("B"),"objects",ref.objectKey);chmodSync(objectPath,0o644);
  try {await get("B","/contacts/me",503,"private read fault",true);await grant("A",p,503);await put("B",synth(),503);} finally {chmodSync(objectPath,0o600);}
  ok("read fault PUT preserves ref epoch",(await refs("B")).objectKey===ref.objectKey&&(await refs("B")).epoch===ref.epoch);await grant("A",p);await revoke("A",p);
  await req("B","DELETE","/contacts/me",undefined,204,"clear before isolated write fault");const empty=await refs("B");chmodSync(storageOwner("B"),0o755);
  try {await put("B",s.contacts.B,503);} finally {chmodSync(storageOwner("B"),0o700);}
  const after=await refs("B");ok("actual write fault commits no reference epoch",after.objectKey===null&&after.epoch===empty.epoch);await put("B",s.contacts.B);
  p=await accepted("A","B",["phone","qq","wechat"]);let all=await grant("A",p);
  ok("all requested channels exact canonical order",all.channels.map(x=>x.channel).join(",")==="wechat,qq,phone"&&all.channels.every(x=>x.value===s.contacts.B[x.channel]));await revoke("B",p);
  p=await accepted();const privateRef=await refs("B");ok("private mode0600",(statSync(resolve(storageOwner("B"),"objects",privateRef.objectKey)).mode&0o777)===0o600);
  for(const path of ["/files/"+privateRef.objectKey,"/objects/"+privateRef.objectKey,"/share/assets/"+privateRef.objectKey+".svg"]) {
   const r=await fetch(base+path),txt=await r.text();ok("guessed public file route denies bytes",r.status===404&&rawValues().every(v=>!txt.includes(v)));report.checks.push({actor:"none",method:"GET",path:"/public-guessed-object-route",status:r.status,label:"guessed public route denied",passed:true});
  }
  for(const path of ["/client/files/"+privateRef.objectKey,"/admin/files/"+privateRef.objectKey]) {const r=await fetch(new URL(base).origin+"/api"+path),txt=await r.text();ok("anonymous Foundation route denies key",[401,404].includes(r.status)&&rawValues().every(v=>!txt.includes(v)));report.checks.push({actor:"none",method:"GET",path:"/api"+path.split("/").slice(0,-1).join("/")+"/<redacted-key>",status:r.status,label:"anonymous guessed key denied",passed:true});}
  s.valid=p;s.pending=(await create("A","C",["phone"])).id;
  for(const [method,path,body]of [["GET","/contacts/me"],["PUT","/contacts/me",{}],["DELETE","/contacts/me"],["GET","/contact-requests"],["POST","/contact-requests",{buddy_id:s.cards.B,channels:["wechat"]}],["POST",`/contact-requests/${p}/respond`,{action:"accept"}],["DELETE",`/contact-requests/${p}`],["GET",`/contact-requests/${p}/granted`]])await req("none",method,path,body,401,"eight missing guest");
  s.tokens.invalid="x".repeat(64);await get("invalid","/contacts/me",401,"invalid guest");delete s.tokens.invalid;
  for(const [method,path,body]of [["POST","/contact-requests/unknown/respond",{action:"accept"}],["DELETE","/contact-requests/unknown"],["GET","/contact-requests/unknown/granted"]])await req("A",method,path,body,404,"unknown request");
  for(const origin of ["http://127.0.0.1:4155","http://192.168.0.200:4155","http://evil.invalid:4155"]) {const r=await fetch(base+"/contacts/me",{method:"OPTIONS",headers:{Origin:origin,"Access-Control-Request-Method":"PUT","Access-Control-Request-Headers":"x-guest-token,content-type"}});ok("precise CORS",r.status===204&&r.headers.get("access-control-allow-origin")===(origin.includes("evil")?null:origin));report.checks.push({actor:"browser",method:"OPTIONS",path:"/contacts/me",origin,status:r.status,label:"precise CORS",passed:true});}
  const bad=await fetch(base+"/contacts/me",{method:"PUT",headers:{"X-Guest-Token":s.tokens.A,"Content-Type":"application/json"},body:"{bad"});ok("malformed JSON400 no-store",bad.status===400&&bad.headers.get("cache-control")==="no-store");report.checks.push({actor:"A",method:"PUT",path:"/contacts/me",status:bad.status,label:"malformed JSON",passed:true});
  await scan();writeFileSync(statePath,JSON.stringify(s),{mode:0o600});chmodSync(statePath,0o600);
 }
 report.outcome="passed";console.log(`PASS F5 ${phase}: ${report.checks.length} real HTTP, ${report.assertions.length} assertions; contact/log/DB scans passed; raw values suppressed`);
} catch(error) {report.outcome="failed";report.failure_label=error instanceof assert.AssertionError ? error.message.replace(/\n[\s\S]*/,"") : "runtime failure (details suppressed)";console.error(`FAIL F5 ${phase}: sanitized .artifacts evidence; raw contacts suppressed`);process.exitCode=1;}
finally {writeFileSync(resolve(dir,`mbti-f5-${phase}-evidence.json`),JSON.stringify(report,null,2)+"\n",{mode:0o600});await db.end();}
