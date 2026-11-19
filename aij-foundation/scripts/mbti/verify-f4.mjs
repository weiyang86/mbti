// Real HTTP only against the owned test API. SQL is auxiliary, credentials stay in ignored 0600 files.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { root, testContext } from "./test-context.mjs";
const phase = process.argv[2] || "prepare";
assert.ok(["prepare", "restart"].includes(phase));
const base = process.env.MBTI_F4_BASE || "http://192.168.0.200:4156/api/v1";
assert.ok(["http://192.168.0.200:4156/api/v1", "http://127.0.0.1:4156/api/v1"].includes(base), "Only owned test4156 allowed");
const { db } = await testContext();
const dir = resolve(root, ".artifacts"); mkdirSync(dir, { recursive: true, mode: 0o700 });
const statePath = resolve(dir, "mbti-f4-http-state.json");
let s = { tokens: {}, cards: {}, owners: {}, results: [], canaries: ["F4_PRIVATE_STAGE_CANARY", "F4_PRIVATE_STATUS_CANARY"] };
if (phase === "restart") s = JSON.parse(readFileSync(statePath, "utf8"));
const report = { phase, base, revision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), started_at: new Date().toISOString(), checks: [], assertions: [] };
function ok(label, value) { assert.ok(value, label); report.assertions.push(label); }
function safe(data) {
  const raw = JSON.stringify(data);
  for (const value of [...s.canaries, ...s.results, ...Object.values(s.owners)]) assert.ok(!raw.includes(value), "Hidden canary/result/internal owner absent");
  const walk = value => { if (!value || typeof value !== "object") return; for (const [k, v] of Object.entries(value)) {
    assert.ok(!/^(ownerId|owner_id|senderId|sender_id|recipientId|recipient_id|tokenHash|guest_token|contacts|wechat|qq|phone|latest_result_id|visibility|dimension_counts|life_stage|recent_status|session_id|has_visual_set)$/.test(k), "No private/internal response key"); walk(v);
  } }; walk(data);
}
async function req(a, method, path, body, expected = 200, label = path, pub = false) {
  const r = await fetch(base + path, { method, headers: { ...(s.tokens[a] ? { "X-Guest-Token": s.tokens[a] } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const raw = await r.text(), data = raw ? JSON.parse(raw) : null;
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(r.status), `${label}: ${a} ${method} ${path}: actual=${r.status} expected=${expected}; ${r.status >= 400 ? JSON.stringify(data) : ""}`);
  if (/^\/(cards|buddies|card-exchanges)(\/|\?|$)/.test(path)) assert.equal(r.headers.get("cache-control"), "no-store");
  if (pub && r.status < 300) safe(data);
  report.checks.push({ label, actor: a, method, path, status: r.status, ...(body !== undefined ? { request: body } : {}), response: path === "/auth/guest" ? { guest_token: "[omitted]", expires_at: data.expires_at } : data, no_store: r.headers.get("cache-control") === "no-store" });
  return { status: r.status, data };
}
const get = async (a,p,code=200,label=p,pub=false)=>(await req(a,"GET",p,undefined,code,label,pub)).data;
const put = async (a,b,code=200,label="PUT my card")=>(await req(a,"PUT","/cards/me",b,code,label)).data;
const create = async(a,b,code=201,label="create exchange")=>{ const r=await req(a,"POST","/card-exchanges",{buddy_id:s.cards[b].id},code,label,true); if(r.status<300) ok("current active summary on create",r.data.buddy.exchange_status==="pending"); return r.data; };
const respond = (a,id,action,code=200,label="respond")=>req(a,"POST",`/card-exchanges/${id}/respond`,{action},code,label,true);
const revoke = (a,id,code=204,label="revoke")=>req(a,"DELETE",`/card-exchanges/${id}`,undefined,code,label);
const block = (a,b)=>req(a,"POST",`/buddies/${s.cards[b].id}/block`,undefined,200,`block ${a}->${b}`);
const unblock = (a,b)=>req(a,"DELETE",`/buddies/${s.cards[b].id}/block`,undefined,204,`unblock ${a}->${b}`);
const list = a=>get(a,"/card-exchanges",200,"exchange list "+a,true);
async function hidden(a,b) {
 const c=await get(a,"/cards/"+s.cards[b].id,200,`hidden public ${a}->${b}`,true);
 ok("hidden public fields and omitted manual",c.nickname===""&&c.declaration===""&&c.interests.length===0&&!Object.hasOwn(c,"manual"));
 const d=await get(a,"/buddies/"+s.cards[b].id,200,`hidden buddy ${a}->${b}`,true);
 ok("safe derived buddy fields",d.nickname===""&&d.interests.length===0&&d.shared_interests.length===0&&d.avatar_text===d.type_code.slice(0,2)&&!d.is_demo);
 await get(a,"/buddies?limit=100",200,"discovery hidden scan",true);await list(a);
}
try {
 if(phase==="restart") {
  for(const a of ["A","B","C"]) {const c=await get(a,"/cards/me",200,"restart same guest "+a);ok("same persisted card "+a,c.id===s.cards[a].id&&c.nickname===s.cards[a].nickname&&c.type_code===s.cards[a].type_code);}
  await get("A","/cards/"+s.cards.B.id,404,"restart old blocked card");await get("B","/buddies/"+s.cards.A.id,404,"restart reverse block");
  ok("restart safe block persists",(await get("A","/buddies/blocked",200,"restart management",true)).items.some(x=>x.id===s.cards.B.id&&x.type_code===""));
  const ac=(await list("A")).items.find(x=>x.id===s.acceptedAC);ok("restart accepted relation persists",ac?.status==="accepted"&&ac.direction==="outgoing"&&ac.buddy_id===s.cards.C.id);
  await respond("C",s.acceptedAC,"decline",409,"restart terminal replay");await unblock("A","B");
  ok("unblock retains revoked",(await list("B")).items.find(x=>x.id===s.revokedAB)?.status==="revoked");
  await respond("B",s.revokedAB,"accept",409,"restart revoked never revives");await revoke("A",s.revokedAB);await hidden("B","A");await block("A","B");
 } else {
  for(const a of ["A","B","C","D"]) {
   const g=await req("none","POST","/auth/guest",undefined,201,"fresh guest "+a);s.tokens[a]=g.data.guest_token;
   s.owners[a]=(await db.query('SELECT id FROM "MbtiGuest" WHERE "tokenHash"=$1',[createHash("sha256").update(s.tokens[a]).digest("hex")])).rows[0].id;
   if(a!=="D") {const r=await req(a,"POST","/results",{source:"self_select",type_code:a==="B"?"INFP":"ESTJ",life_stage:s.canaries[0],recent_status:s.canaries[1]},201,"own latest result "+a);s.results.push(r.data.id);}
   const c=await get(a,"/cards/me",200,"lazy private defaults "+a);s.cards[a]=c;
   ok("independent public ID "+a,/^card_[A-Za-z0-9_-]{32}$/.test(c.id)&&c.id!==s.owners[a]);
   ok("private defaults "+a,!c.discoverable&&!c.has_visual_set&&c.nickname===""&&c.declaration===""&&c.interests.length===0&&Object.values(c.visibility).every(v=>!v)&&c.style==="illustration");
   ok("latest type initialized once "+a,c.type_code===(a==="D"?"":a==="B"?"INFP":"ESTJ"));
  }
  await get("D","/buddies?mode=same",422,"same missing actual type");await put("D",{discoverable:true},422,"cannot opt in without type");
  for(const a of ["A","B","C"])await get(a,"/cards/"+s.cards.A.id,404,"private public route incl self");
  await get("A","/cards/card_me",404,"no demo alias");
  for(const a of ["A","B","C"]) {
   const n=`F4_HIDDEN_NAME_${a}`,d=`F4_HIDDEN_DECLARATION_${a}`,i=`F4_HIDDEN_INTEREST_${a}`;s.canaries.push(n,d,i);
   s.cards[a]=await put(a,{nickname:" "+n+" ",declaration:d,interests:[i," "+i+" ",""],discoverable:true},200,"explicit discovery opt-in "+a);
   ok("trim/dedupe "+a,s.cards[a].nickname===n&&s.cards[a].interests.length===1);
  }
  await hidden("B","A");await hidden("C","A");
  await put("A",null,400,"existing strict JSON parser rejects primitive null");
  for(const body of [[],{ownerId:"forged"},{type_name:"fake"},{has_visual_set:true},{latest_result_id:"fake"},{contacts:{phone:"fake"}},{nickname:1},{nickname:"x".repeat(41)},{declaration:"x".repeat(161)},{interests:["x".repeat(25)]},{interests:Array(11).fill("x")},{interests:[false]},{type_code:"infp"},{type_code:"XXXX"},{type_code:""},{style:"photo"},{visibility:null},{visibility:{name:1}},{visibility:{phone:true}},{discoverable:"true"}]) await put("A",body,422,"strict whitelist/type/limits");
  await put("A",{nickname:"😀".repeat(40)},200,"40 unicode codepoints");await put("A",{nickname:"😀".repeat(41)},422,"41 unicode codepoints");await put("A",{nickname:s.cards.A.nickname});
  await Promise.all([put("A",{visibility:{name:true}}),put("A",{visibility:{manual:true}})]);
  let me=await get("A","/cards/me");ok("parallel visibility partial merge",me.visibility.name&&me.visibility.manual&&!me.visibility.interests);
  const exposed=await get("C","/cards/"+s.cards.A.id,200,"only explicit name/manual visible");ok("explicit projected fields",exposed.nickname===s.cards.A.nickname&&!!exposed.manual&&exposed.declaration===""&&exposed.interests.length===0);
  await put("A",{visibility:{interests:true,declaration:true}});
  const fields=await get("C","/cards/"+s.cards.A.id,200,"all explicitly allowed fields visible");
  ok("visible interests/declaration only when opted in",fields.declaration===s.cards.A.declaration&&fields.interests[0]===s.cards.A.interests[0]);
  const visibleBuddy=await get("C","/buddies/"+s.cards.A.id,200,"visible buddy fields");
  ok("tagline never derives private declaration",visibleBuddy.interests[0]===s.cards.A.interests[0]&&visibleBuddy.tagline!==s.cards.A.declaration);
  await put("A",{visibility:{name:false,manual:false,interests:false,declaration:false}});await hidden("C","A");
  const newr=await req("A","POST","/results",{source:"self_select",type_code:"INTJ"},201,"new result not overwrite card");s.results.push(newr.data.id);
  me=await get("A","/cards/me");ok("new result no silent type update",me.type_code==="ESTJ"&&!Object.hasOwn(me,"latest_result_id"));
  await put("A",{type_code:"INFP"});me=await get("A","/cards/me");ok("no source reverse inference",me.type_code==="INFP"&&!Object.hasOwn(me,"latest_result_id"));
  await put("A",{type_code:"INTJ"});me=await get("A","/cards/me");ok("matching latest source only",me.latest_result_id===newr.data.id);
  await req("A","DELETE","/results/"+newr.data.id,undefined,204,"F2 delete still works");me=await get("A","/cards/me");ok("deletion does not retag",me.type_code==="INTJ"&&!Object.hasOwn(me,"latest_result_id"));
  await put("A",{type_code:"ESTJ"});ok("original history immutable",(await get("A","/results/"+s.results[0])).type_code==="ESTJ");
  const same=await get("A","/buddies?mode=same&type_code=ESTJ&limit=100",200,"server same type",true);ok("same type excludes self",same.items.some(x=>x.id===s.cards.C.id)&&same.items.every(x=>x.id!==s.cards.A.id&&x.type_code==="ESTJ"));
  for(const q of ["mode=x","mode=same&type_code=INFP","type_code=XXXX","limit=0","limit=101","limit=1.2","limit=-1","limit=1&limit=2","ownerId=x"])await get("A","/buddies?"+q,422,"bad discovery query");
  const filtered=await get("A","/buddies?type_code=INFP&limit=100",200,"recommend public type filter",true);ok("public type filter",filtered.items.some(x=>x.id===s.cards.B.id)&&filtered.items.every(x=>x.type_code==="INFP"));
  await create("A","A",422,"self exchange denied");await req("A","POST","/card-exchanges",{buddy_id:s.cards.B.id,senderId:"forged"},422,"forged sender denied");
  let p=await create("A","B");ok("outgoing observer projection",p.direction==="outgoing"&&p.buddy_id===s.cards.B.id&&!p.simulated);
  const incoming=(await list("B")).items.find(x=>x.id===p.id);ok("incoming observer projection",incoming.direction==="incoming"&&incoming.buddy_id===s.cards.A.id);
  ok("third party cannot list",!(await list("C")).items.some(x=>x.id===p.id));
  await respond("C",p.id,"accept",404,"third party response");await revoke("C",p.id,404,"third party revoke");await respond("A",p.id,"accept",409,"sender cannot respond");await revoke("B",p.id,409,"recipient cannot revoke");
  await respond("B",p.id,"nonsense",422,"bad action");await req("C","POST",`/card-exchanges/${p.id}/respond`,{action:"bad",ownerId:"forged"},404,"ownership before role/input");
  ok("same pending retry reuses ID",(await create("A","B",200,"pending retry")).id===p.id);await create("B","A",409,"reverse pending conflict");
  await respond("B",p.id,"accept");await respond("B",p.id,"accept",409,"accepted replay conflict");await create("A","B",409,"accepted duplicate conflict");await create("B","A",409,"reverse accepted conflict");await hidden("B","A");
  await revoke("A",p.id);await revoke("A",p.id);await respond("B",p.id,"decline",409,"revoked terminal");
  const d=await create("A","B");ok("new ID after revoked",d.id!==p.id);await respond("B",d.id,"decline");await revoke("A",d.id,409,"declined cannot revoke");await respond("B",d.id,"decline",409,"decline replay");
  const parallel=await Promise.all(Array.from({length:8},()=>create("A","B",[200,201],"parallel same create")));ok("parallel same one ID",new Set(parallel.map(x=>x.id)).size===1);ok("one parallel 201",report.checks.filter(x=>x.label==="parallel same create"&&x.status===201).length===1);await revoke("A",parallel[0].id);
  const rev=await Promise.all([req("A","POST","/card-exchanges",{buddy_id:s.cards.B.id},[201,409],"reverse race A",true),req("B","POST","/card-exchanges",{buddy_id:s.cards.A.id},[201,409],"reverse race B",true)]);
  ok("reverse race one winner/conflict",rev.filter(x=>x.status===201).length===1&&rev.filter(x=>x.status===409).length===1);await revoke(rev[0].status===201?"A":"B",rev.find(x=>x.status===201).data.id);
  p=await create("A","B");const race=await Promise.all([respond("B",p.id,"accept",[200,409],"accept race"),respond("B",p.id,"decline",[200,409],"decline race")]);ok("one pending response terminal wins",race.filter(x=>x.status===200).length===1);if((await list("A")).items.find(x=>x.id===p.id).status==="accepted")await revoke("A",p.id);
  p=await create("A","B");const triple=await Promise.all([respond("B",p.id,"accept",[200,409],"triple accept"),respond("B",p.id,"decline",[200,409],"triple decline"),revoke("A",p.id,[204,409],"triple revoke")]);ok("competing responses never both win",triple.slice(0,2).filter(x=>x.status===200).length<=1);ok("triple terminal final",["revoked","declined"].includes((await list("A")).items.find(x=>x.id===p.id).status));
  p=await create("A","B");await Promise.all([block("A","B"),respond("B",p.id,"accept",[200,404],"block respond race")]);
  await get("A","/cards/"+s.cards.B.id,404,"blocked old public ID");await get("B","/cards/"+s.cards.A.id,404,"reverse blocked old public ID");await get("B","/buddies/"+s.cards.A.id,404,"reverse blocked detail");
  await create("A","B",404,"blocked new exchange");await create("B","A",404,"reverse blocked new exchange");await respond("B",p.id,"accept",404,"blocked old response");await revoke("A",p.id,404,"blocked old revoke");
  ok("block hides embedded buddies both directions",!(await list("A")).items.some(x=>x.buddy_id===s.cards.B.id)&&!(await list("B")).items.some(x=>x.buddy_id===s.cards.A.id));await block("A","B");
  const managed=await get("A","/buddies/blocked",200,"static blocked safe management",true);ok("anonymous management projection",managed.items.some(x=>x.id===s.cards.B.id&&x.nickname==="匿名搭子"&&x.type_code===""&&x.interests.length===0));ok("own initiated blocks only",!(await get("B","/buddies/blocked",200,"reverse block not disclosed",true)).items.some(x=>x.id===s.cards.A.id));
  await block("B","A");await unblock("A","B");await unblock("A","B");await get("A","/cards/"+s.cards.B.id,404,"one unblock cannot remove reverse");await unblock("B","A");
  ok("unblock never revives old exchange",(await list("B")).items.find(x=>x.id===p.id).status==="revoked");await respond("B",p.id,"accept",409,"old revoked after unblock");await hidden("B","A");
  await put("B",{discoverable:false});await get("A","/buddies/"+s.cards.B.id,404,"opt-out old detail");await create("A","B",404,"opt-out new exchange");ok("opt-out removes exchange embed",!(await list("A")).items.some(x=>x.buddy_id===s.cards.B.id));await get("B","/cards/"+s.cards.B.id,404,"self opt-out public denied");await put("B",{discoverable:true});
  await block("A","B");const limited=await get("A","/buddies?limit=1",200,"block before limit",true);ok("filter precedes pagination",limited.items.length===1&&limited.items[0].id!==s.cards.B.id&&limited.items[0].id!==s.cards.A.id);await unblock("A","B");
  await Promise.all([block("A","B"),req("A","POST","/card-exchanges",{buddy_id:s.cards.B.id},[201,404],"block create race",true)]);await create("B","A",404,"post-race block enforced");await unblock("A","B");ok("post-block no live exchange",!(await list("A")).items.some(x=>x.buddy_id===s.cards.B.id&&["pending","accepted"].includes(x.status)));
  const ab=await create("A","B");await respond("B",ab.id,"accept");await block("A","B");s.revokedAB=ab.id;
  const ac=await create("A","C");await respond("C",ac.id,"accept");s.acceptedAC=ac.id;await hidden("C","A");
  const routes=[["GET","/cards/me"],["PUT","/cards/me",{}],["GET","/cards/"+s.cards.A.id],["GET","/buddies"],["GET","/buddies/blocked"],["GET","/buddies/"+s.cards.A.id],["POST","/buddies/"+s.cards.A.id+"/block"],["DELETE","/buddies/"+s.cards.A.id+"/block"],["GET","/card-exchanges"],["POST","/card-exchanges",{buddy_id:s.cards.A.id}],["POST",`/card-exchanges/${ac.id}/respond`,{action:"accept"}],["DELETE",`/card-exchanges/${ac.id}`]];
  for(const [m,p,b]of routes)await req("none",m,p,b,401,"12-operation missing guest");
  for(const p of ["/cards/unknown","/buddies/unknown"])await get("A",p,404,"unknown public resource");
  await req("A","POST","/buddies/unknown/block",undefined,404,"unknown block");await req("A","DELETE","/buddies/unknown/block",undefined,404,"unknown unblock");await respond("A","unknown","accept",404,"unknown exchange response");await revoke("A","unknown",404,"unknown exchange revoke");
  s.tokens.invalid="x".repeat(64);await get("invalid","/cards/me",401,"invalid random credential");delete s.tokens.invalid;
  await req("A","POST","/buddies/"+s.cards.A.id+"/block",undefined,422,"self block denied");
  await req("A","DELETE","/buddies/"+s.cards.A.id+"/block",undefined,422,"self unblock denied");
  for(const origin of ["http://127.0.0.1:4155","http://192.168.0.200:4155","http://evil.invalid:4155"]) {
    const r=await fetch(base+"/cards/me",{method:"OPTIONS",headers:{Origin:origin,"Access-Control-Request-Method":"PUT","Access-Control-Request-Headers":"x-guest-token,content-type"}});
    assert.equal(r.status,204);assert.equal(r.headers.get("access-control-allow-origin"),origin.includes("evil")?null:origin);
    report.checks.push({label:"exact CORS allowlist",actor:"browser",method:"OPTIONS",path:"/cards/me",origin,status:r.status,allow_origin:r.headers.get("access-control-allow-origin"),allow_headers:r.headers.get("access-control-allow-headers")});
  }
  const malformed=await fetch(base+"/cards/me",{method:"PUT",headers:{"X-Guest-Token":s.tokens.A,"Content-Type":"application/json"},body:"{broken"});
  assert.equal(malformed.status,400);report.checks.push({label:"malformed JSON stays existing 400",actor:"A",method:"PUT",path:"/cards/me",status:malformed.status,response:await malformed.json()});
  const pairs=[[s.owners.A,s.owners.B].sort().join(":"),[s.owners.A,s.owners.C].sort().join(":")];
  const counts=await db.query('SELECT count(*)::int n FROM "MbtiCardExchange" WHERE "pairKey" IN ($1,$2) AND status IN (\'pending\',\'accepted\') GROUP BY "pairKey"',pairs);ok("auxiliary SQL unique active pair",counts.rows.every(x=>x.n<=1));
  for(const a of ["A","B","C"])s.cards[a]=await get(a,"/cards/me",200,"persist prepared original card "+a);
  writeFileSync(statePath,JSON.stringify(s),{mode:0o600});chmodSync(statePath,0o600);
 }
 report.outcome="passed";report.finished_at=new Date().toISOString();console.log(`PASS F4 ${phase}: ${report.checks.length} real HTTP responses, ${report.assertions.length} semantic/privacy assertions; private state stays ignored 0600`);
} catch(error) {report.outcome="failed";report.error=error.message;throw error;}
finally {writeFileSync(resolve(dir,`mbti-f4-${phase}-evidence.json`),JSON.stringify(report,null,2)+"\n",{mode:0o600});await db.end();}
