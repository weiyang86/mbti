/* Shared by the private hosted trial and the loopback integration kit. */
const CONTRACT='mbti-image/v1',MODEL='wan2.6-image',LIMIT=8*1024*1024,MS=60_000;
const enc=new TextEncoder(),dec=new TextDecoder();
const respond=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const err=(st)=>Object.assign(new Error('IMAGE_GATEWAY'),{st});
async function limited(stream,limit){const r=stream?.getReader();if(!r)throw err(422);const chunks=[];let n=0;try{for(;;){const {value,done}=await r.read();if(done)break;n+=value.byteLength;if(n>limit){await r.cancel();throw err(413)}chunks.push(value)}}finally{r.releaseLock()}let a=new Uint8Array(n),at=0;for(const x of chunks){a.set(x,at);at+=x.length}return a}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)}
const magic=(a)=>a[0]===255&&a[1]===216&&a[2]===255?'jpeg':a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71?'png':a[0]===82&&a[1]===73&&a[2]===70&&a[3]===70&&a[8]===87&&a[9]===69&&a[10]===66&&a[11]===80?'webp':'';
function imageData(v){if(typeof v!=='string'||v.length<50||v.length>LIMIT*4/3+32)return false;const head=/^data:image\/(jpeg|png|webp);base64,/.exec(v);if(!head)return false;let raw=v.slice(head[0].length);if(!raw||raw.length%4!==0||/[^A-Za-z0-9+/=]/.test(raw))return false;try{const prefix=Uint8Array.from(atob(raw.slice(0,24)),c=>c.charCodeAt(0));return magic(prefix)===head[1]}catch{return false}}
function resultHost(u){const host=u.hostname.toLowerCase();return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&(/\.oss(?:-[a-z0-9-]+)?\.aliyuncs\.com$/.test(host)||host==='cdn.wanx.aliyuncs.com'||host==='dashscope-result-bj.aliyuncs.com')}
function vendorUrl(env){const v=(env.DASHSCOPE_WORKSPACE_ID||'').trim();if(v&&!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,80}$/.test(v))return '';return 'https://'+(v?v+'.cn-beijing.maas.aliyuncs.com':'dashscope.aliyuncs.com')+'/api/v1/services/aigc/multimodal-generation/generation'}
function payload(j){if(j?.contract!==CONTRACT||j.n!==1||j.model!==MODEL||j.adapter!=='wan'||!['960*1280','1024*1024','720*1280'].includes(j.size)||typeof j.prompt!=='string'||!j.prompt.trim()||j.prompt.length>1800||!/^[a-zA-Z0-9_-]{12,80}$/.test(j.requestId||''))throw err(422);if(j.consent!==true)throw err(403);if(!Array.isArray(j.images)||j.images.length!==2||j.images[0]?.role!=='portrait'||j.images[1]?.role!=='style'||!j.images.every(x=>imageData(x.data)))throw err(422);return {model:MODEL,input:{messages:[{role:'user',content:[{text:j.prompt},{image:j.images[0].data},{image:j.images[1].data}]}]},parameters:{n:1,enable_interleave:false,size:j.size,watermark:true}}}
export function makeGateway({upstream=fetch,now=()=>Date.now()}={}){
 const seen=new Map();let calls=[],busy=0;
 return async function(request,env={},mode='hosted'){
  const url=new URL(request.url),key=env.DASHSCOPE_API_KEY,hosted=mode==='hosted',tester=String(env.MBTI_IMAGE_TESTER_EMAIL||'').trim().toLowerCase(),visitor=(request.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase(),eligible=!hosted||!!(tester&&visitor&&visitor===tester&&request.headers.get('oai-authenticated-user-id')),ready=!!(key&&vendorUrl(env)&&eligible);
  if(!url.pathname.startsWith('/api/mbti-image/'))return respond({error:'not_found'},404);
  if(url.pathname==='/api/mbti-image/health'&&request.method==='GET'){return respond({contract:CONTRACT,adapter:'wan',model:MODEL,ready,reason:!vendorUrl(env)?'workspace':!key?'key':!eligible?'tester':'ok'})}
  if(url.pathname!=='/api/mbti-image/generate')return respond({error:'not_found'},404);
  if(request.method!=='POST')return respond({error:'method'},405);
  if(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return respond({error:'origin_or_content'},403);
  if(!ready)return respond({error:'not_ready'},eligible?503:403);
  if(Number(request.headers.get('Content-Length')||0)>18*1024*1024)return respond({error:'too_large'},413);
  try{
    const body=await limited(request.body,18*1024*1024);let j;try{j=JSON.parse(dec.decode(body))}catch{throw err(422)}const data=payload(j),id=j.requestId,t=now();
    for(const [k,ts]of seen)if(t-ts>24*60*MS)seen.delete(k);if(seen.has(id))throw err(409);
    calls=calls.filter(n=>t-n<60*MS);const cap=Math.max(1,Math.min(30,+(env.IMAGE_MAX_PER_HOUR||6)||6));if(busy>=2||calls.length>=cap)throw err(429);seen.set(id,t);calls.push(t);busy++;
    try{
      const signal=AbortSignal.timeout(175_000),p=await upstream(vendorUrl(env),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(data),redirect:'error',signal});
      if(!p.ok)throw err(({400:422,401:401,403:403,429:429})[p.status]||502);
      let j2;try{j2=JSON.parse(dec.decode(await limited(p.body,512*1024)))}catch{throw err(502)}
      const link=j2?.output?.choices?.[0]?.message?.content?.find(m=>m.type==='image'&&m.image)?.image;if(!link)throw err(502);
      let media;try{media=new URL(link)}catch{throw err(502)}if(!resultHost(media))throw err(502);
      const out=await upstream(media.href,{method:'GET',redirect:'error',signal});if(!out.ok)throw err(502);const pixels=await limited(out.body,12*1024*1024),fmt=magic(pixels);if(!fmt)throw err(502);
      return respond({contract:CONTRACT,requestId:id,image:'data:image/'+fmt+';base64,'+base64(pixels)})
    }finally{busy--}
  }catch(e){const st=e.st||(['TimeoutError','AbortError'].includes(e?.name)?504:502);return respond({error:'image_request_failed',status:st},st)}
 }
}
