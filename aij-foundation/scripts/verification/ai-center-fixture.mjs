import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export function syntheticAiCatalog(ref) {
 const model={code:'advice-text',name:'Synthetic advice model',providerCode:'text-provider',upstreamModel:'synthetic-text-v1',capability:'text',enabled:true,contextTokens:16384,maxOutputTokens:1024,tokenParameter:'max_tokens',inputNanosPerMillion:'1000000000',outputNanosPerMillion:'2000000000',imageNanos:'100000000',imageSize:'1024x1024',imageQuality:'low',imageBase64Format:false,revision:1};
 return {monthlyBudgetNanos:'10000000000',workspaceMonthlyBudgetNanos:'1000000000',providers:[{code:'text-provider',name:'Text Provider',vendor:'openai',baseUrl:'https://api.openai.com/v1',credentialRef:ref,enabled:true,liveEnabled:false,revision:1},{code:'image-provider',name:'Image Provider',vendor:'compatible',baseUrl:'https://api.openai.com/v1',credentialRef:ref,enabled:true,liveEnabled:false,revision:1}],models:[model,{...model,code:'avatar-image',name:'Synthetic image model',providerCode:'image-provider',upstreamModel:'synthetic-image-v1',capability:'image'}],skills:[{code:'social-boundaries',name:'Social advice boundaries',instructions:'Provide respectful social suggestions. MBTI is not a clinical diagnosis. Do not infer sensitive traits.',enabled:true,revision:1}],agents:[{code:'buddy-advice',name:'MBTI buddy advice',modelCode:model.code,skillCodes:['social-boundaries'],instructions:'Give three practical conversation suggestions for these personality types.',inputFields:['selfType','buddyType'],outputFormat:'text',outputFields:[],enabled:true,published:true,revision:1},{code:'avatar-maker',name:'MBTI avatar',modelCode:'avatar-image',skillCodes:[],instructions:'Create a friendly abstract illustrated avatar. No diagnosis or sensitive inference.',inputFields:['mbtiType','style'],outputFormat:'text',outputFields:[],enabled:true,published:true,revision:1}]};
}
export async function prepareAiCenter(f) {
 const key='AIJ_SECRET_AIJ_FOUNDATION_TEST_AI_CENTER_KEY';const credential='synthetic-'+randomBytes(24).toString('hex');process.env[key]=credential;const ref='env://'+key;
 await f.prisma.secretReference.create({data:{ref,provider:'env'}});
 const auth=JSON.parse(await readFile(f.seed.credentials.file,'utf8'));
 const token=(await f.request('POST','auth/login',{body:{username:auth.username,password:auth.password}})).data.accessToken;
 const catalog=syntheticAiCatalog(ref);
 return {ref,credential,token,catalog,save:async(c=catalog,version=0,status=200)=>f.request('PUT','admin/ai/center/configuration',{token,body:{catalog:c,expectedVersion:version},status})};
}
