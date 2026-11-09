"use client";
import { PageHeading } from "@aij/ui";
import type { AiCenterAgent, AiCenterCatalog, AiCenterConfiguration, AiCenterModel, AiCenterProvider, AiCenterSkill } from "@aij/contracts";
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography, Row, Col } from "antd";
import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import { RequestFailure, requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";
import { AI_CENTER_CONFIGURATION_PERMISSION, AI_CENTER_SECRET_PERMISSION } from "./admin-ai-policy";

type Kind = "providers" | "models" | "skills" | "agents";
type Entry = AiCenterProvider | AiCenterModel | AiCenterSkill | AiCenterAgent;
const LABEL: Record<Kind,string> = {providers:"厂商连接",models:"模型",skills:"Skill",agents:"Agent"};
const EMPTY: AiCenterCatalog = {providers:[],models:[],skills:[],agents:[],monthlyBudgetNanos:"10000000000",workspaceMonthlyBudgetNanos:"1000000000"};
const money = (n:string) => {const v=BigInt(n),fraction=(v%BigInt("1000000000")).toString().padStart(9,"0").replace(/0+$/,"");return (v/BigInt("1000000000")).toString()+(fraction?"."+fraction:"");};
const nanos = (v:unknown) => {if(typeof v!=="string"||!/^\d{1,6}(?:\.\d{1,9})?$/.test(v))throw new Error("请输入有效的人民币金额，最多9位小数。");const [a,b=""]=v.split(".");const n=BigInt(a)*BigInt("1000000000")+BigInt(b.padEnd(9,"0"));if(n<=BigInt("0")||n>BigInt("999999999999999"))throw new Error("金额必须大于0且小于100万元。");return n.toString();};
const defaults = (kind:Kind):Record<string,unknown> => kind==="providers"?{vendor:"openai",baseUrl:"https://api.openai.com/v1",enabled:false,liveEnabled:false}:kind==="models"?{capability:"text",enabled:false,contextTokens:16384,maxOutputTokens:1024,tokenParameter:"max_tokens",inputPrice:"1",outputPrice:"2",imagePrice:"0.1",imageSize:"1024x1024",imageQuality:"auto",imageBase64Format:false}:kind==="skills"?{enabled:true}:{enabled:false,published:false,skillCodes:[],inputFields:[],outputFormat:"text",outputFields:[]};
const required = [{required:true,message:"请填写此项"}];
const enabled = (v:boolean) => <Tag color={v?"green":"default"}>{v?"启用":"停用"}</Tag>;

export function AdminAiCenter() {
 const {request,can}=useAdmin();const writable=can(AI_CENTER_CONFIGURATION_PERMISSION)&&can(AI_CENTER_SECRET_PERMISSION);
 const [config,setConfig]=useState<AiCenterConfiguration>({version:0,catalog:EMPTY}),[tab,setTab]=useState<Kind>("providers"),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[editor,setEditor]=useState<{kind:Kind;entry?:Entry}|null>(null),[formError,setFormError]=useState("");
 const [form]=Form.useForm(),[budgetForm]=Form.useForm();const capability=Form.useWatch("capability",form),outputFormat=Form.useWatch("outputFormat",form),providerCode=Form.useWatch("providerCode",form);
 const selectedProvider=config.catalog.providers.find(p=>p.code===providerCode);
 const aliyunText=selectedProvider?.vendor==="aliyun"||selectedProvider?.baseUrl==="https://dashscope.aliyuncs.com/compatible-mode/v1";
 const deepseekText=selectedProvider?.vendor==="deepseek"||selectedProvider?.baseUrl==="https://api.deepseek.com/v1";
 const load=useEffectEvent(async()=>{setLoading(true);try{const next=await request<AiCenterConfiguration>("/admin/ai/center/configuration");setConfig(next);budgetForm.setFieldsValue({monthly:money(next.catalog.monthlyBudgetNanos),workspace:money(next.catalog.workspaceMonthlyBudgetNanos)});setError("");}catch(e){setError(requestMessage(e));}finally{setLoading(false);}});
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[revision]);
 async function persist(catalog:AiCenterCatalog){
  const next=await request<AiCenterConfiguration>("/admin/ai/center/configuration","PUT",{expectedVersion:config.version,catalog});setConfig(next);setNotice("配置已保存。新的调用将使用此版本；已排队任务的相关配置变更后会停止调用。");setError("");
 }
 function open(kind:Kind,entry?:Entry){setFormError("");setEditor({kind,entry});form.resetFields();form.setFieldsValue(entry?{...entry,...(kind==="models"?{inputPrice:money((entry as AiCenterModel).inputNanosPerMillion),outputPrice:money((entry as AiCenterModel).outputNanosPerMillion),imagePrice:money((entry as AiCenterModel).imageNanos)}:{})}:defaults(kind));}
 async function save(){
  try{const values=await form.validateFields();if(!editor)return;setSaving(true);setFormError("");
   const row={...values,revision:editor.entry?.revision??1};
   if(editor.kind==="models"){row.inputNanosPerMillion=nanos(row.inputPrice);row.outputNanosPerMillion=nanos(row.outputPrice);row.imageNanos=nanos(row.imagePrice);delete row.inputPrice;delete row.outputPrice;delete row.imagePrice;}
   if(editor.kind==="agents"){row.skillCodes??=[];row.outputFields=row.outputFormat==="json"?row.outputFields??[]:[];}
   const next=structuredClone(config.catalog);const rows=next[editor.kind] as Entry[];const index=rows.findIndex(x=>x.code===row.code);if(!editor.entry&&index>=0)throw new Error("编号已存在，请使用另一个编号。");if(index>=0)rows[index]=row as Entry;else rows.push(row as Entry);
   await persist(next);setEditor(null);
  }catch(e){if(e instanceof RequestFailure&&e.status===409){setFormError("配置已被其他操作更新。请关闭编辑框，刷新后重新编辑。");}else if(e instanceof RequestFailure&&e.status===400){setFormError("配置校验未通过。请检查密钥引用、模型能力、预算及发布 Agent 的所有依赖是否已启用。");}else if(e instanceof Error){setFormError(e instanceof RequestFailure?requestMessage(e):e.message);} }finally{setSaving(false);}
 }
 async function saveBudget(){try{const v=await budgetForm.validateFields();setSaving(true);await persist({...config.catalog,monthlyBudgetNanos:nanos(v.monthly),workspaceMonthlyBudgetNanos:nanos(v.workspace)});}catch(e){setError(e instanceof RequestFailure?requestMessage(e):e instanceof Error?e.message:"请检查预算金额。");}finally{setSaving(false);}}
 const nameOptions=(kind:Kind)=>config.catalog[kind].map(e=>({value:e.code,label:`${e.name} · ${e.code}${e.enabled?"":"（停用）"}`}));
 const items=(Object.keys(LABEL) as Kind[]).map(kind=>({key:kind,label:`${LABEL[kind]} (${config.catalog[kind].length})`,children:<>
  <div className="admin-table-toolbar"><Typography.Paragraph type="secondary">{kind==="providers"?"先创建密钥引用，再连接厂商。接口地址须在服务端批准列表中。":kind==="models"?"每个模型绑定一个厂商连接；文本按 Token、生图按单张配置内部估价。":kind==="skills"?"Skill 是可复用的提示词指令。编辑后自动递增版本。": "Agent 绑定一个模型，并按选择顺序应用 Skill。发布后才会出现在客户可用列表中。"}</Typography.Paragraph><Button type="primary" disabled={!writable||loading} onClick={()=>open(kind)}>新增{LABEL[kind]}</Button></div>
  <Table<Entry> rowKey="code" loading={loading} dataSource={config.catalog[kind]} pagination={{pageSize:10}} scroll={{x:760}} locale={{emptyText:`暂无${LABEL[kind]}，请先完成上游配置后新增。`}} columns={[
   {title:"名称 / 编号",key:"name",render:(_,r)=><><strong>{r.name}</strong><div><Typography.Text type="secondary">{r.code}</Typography.Text></div></>},
   {title:"绑定 / 能力",key:"bindings",render:(_,r)=>kind==="providers"?<><Tag>{(r as AiCenterProvider).vendor}</Tag><span>{(r as AiCenterProvider).liveEnabled?"连接调用开关已开":"连接调用开关关闭"}</span></>:kind==="models"?<>{(r as AiCenterModel).providerCode}<br/><Tag>{(r as AiCenterModel).capability==="image"?"生图":"文本"}</Tag>{(r as AiCenterModel).upstreamModel}</>:kind==="skills"?<Typography.Text type="secondary">可复用指令</Typography.Text>:<>{(r as AiCenterAgent).modelCode}<div>{(r as AiCenterAgent).skillCodes.length} 个 Skill · {(r as AiCenterAgent).published?"已发布":"草稿"}</div></>},
   {title:"状态",dataIndex:"enabled",render:enabled},{title:"版本",dataIndex:"revision",render:(v:number)=>`v${v}`},
   {title:"操作",key:"action",render:(_,r)=><Button disabled={!writable} onClick={()=>open(kind,r)}>编辑</Button>}
  ]}/>
 </>}));
 return <>
  <PageHeading eyebrow="AI 管理 · 配置" title="AI 中心" description="配置厂商与模型，组合 Skill 并发布 Agent，为不同业务提供文本与图片能力。" actions={<Button onClick={()=>setRevision(v=>v+1)} disabled={saving}>刷新</Button>}/>
  <Space wrap><Tag>配置版本 {config.version}</Tag><Link href="/auth/secrets">管理密钥引用</Link>{can("admin.runtime.read")&&<Link href="/auth/ai/usage">用量与预算</Link>}</Space>
  {error&&<Alert type="error" showIcon title={error} action={<Button onClick={()=>setRevision(v=>v+1)}>重试</Button>}/>}{notice&&<Alert type="success" showIcon title={notice} closable onClose={()=>setNotice("")}/>}
  {!writable&&<Alert type="info" showIcon title="当前为只读。保存配置需要配置管理和密钥管理权限。"/>}
  <Tabs activeKey={tab} onChange={key=>setTab(key as Kind)} items={items}/>
  <section className="admin-overview-section" aria-label="AI 月度预算"><h2>月度预算</h2><Typography.Paragraph type="secondary">按 UTC 自然月统计。入队先预留，成功后按配置价结算估算；未知结果保留预留。内部估价与厂商账单可能不同。</Typography.Paragraph>
   <Form form={budgetForm} layout="vertical" onFinish={()=>void saveBudget()} disabled={!writable||saving||loading}><Row gutter={16}><Col xs={24} md={8}><Form.Item label="项目上限（元）" name="monthly" rules={required}><Input inputMode="decimal"/></Form.Item></Col><Col xs={24} md={8}><Form.Item label="每个 Workspace 上限（元）" name="workspace" rules={required}><Input inputMode="decimal"/></Form.Item></Col></Row><Button htmlType="submit" loading={saving}>保存预算</Button></Form>
  </section>
  <Modal open={!!editor} title={`${editor?.entry?"编辑":"新增"}${editor?LABEL[editor.kind]:""}`} onCancel={()=>{if(!saving)setEditor(null);}} onOk={()=>void save()} confirmLoading={saving} okText="保存配置" cancelText="取消" width={720} maskClosable={!saving} destroyOnHidden>
   {formError&&<Alert type="error" showIcon title={formError}/>}
   <Form form={form} layout="vertical" preserve={false} disabled={saving}>
    <Form.Item label="编号" name="code" rules={[...required,{pattern:/^[a-z][a-z0-9-]{1,62}$/,message:"使用2–63位小写字母、数字或连字符，以字母开头"}]}><Input disabled={!!editor?.entry}/></Form.Item>
    <Form.Item label="名称" name="name" rules={required}><Input maxLength={100}/></Form.Item>
    {editor?.kind==="providers"&&<>
     <Form.Item label="协议 / 厂商" name="vendor" rules={required}><Select options={[{value:"openai",label:"OpenAI"},{value:"deepseek",label:"DeepSeek"},{value:"aliyun",label:"阿里云百炼（中国大陆文本）"},{value:"compatible",label:"OpenAI 兼容接口"}]} onChange={v=>{if(v!=="compatible")form.setFieldValue("baseUrl",v==="openai"?"https://api.openai.com/v1":v==="aliyun"?"https://dashscope.aliyuncs.com/compatible-mode/v1":"https://api.deepseek.com/v1");}}/></Form.Item>
     <Form.Item label="接口基础地址" name="baseUrl" rules={required} extra="兼容厂商需由部署配置批准精确 HTTPS 地址；不自动探测或下载模型。"><Input maxLength={300}/></Form.Item>
     <Form.Item label="密钥引用" name="credentialRef" rules={required} extra="填写已配置的 env:// 或 local:// 引用；不要粘贴真实 API Key。"><Input autoComplete="off"/></Form.Item>
     <Form.Item name="liveEnabled" valuePropName="checked"><Checkbox>开启此连接的调用开关</Checkbox></Form.Item><Typography.Paragraph type="secondary">实际调用还受服务端总开关、插件状态和预算控制。DeepSeek 继续要求上游确认。</Typography.Paragraph>
    </>}
    {editor?.kind==="models"&&<>
     <Form.Item label="厂商连接" name="providerCode" rules={required}><Select options={nameOptions("providers")} onChange={code=>{const p=config.catalog.providers.find(p=>p.code===code);if(p?.vendor==="aliyun"||p?.baseUrl==="https://dashscope.aliyuncs.com/compatible-mode/v1")form.setFieldsValue({capability:"text",upstreamModel:"qwen3.8-max",tokenParameter:"max_completion_tokens"});else if(p?.vendor==="deepseek"||p?.baseUrl==="https://api.deepseek.com/v1")form.setFieldsValue({capability:"text",tokenParameter:"max_tokens"});}}/></Form.Item>
     <Form.Item label="厂商模型 ID" name="upstreamModel" rules={required} extra={aliyunText?"本期支持 qwen3.8-max 的非流式文本与 JSON 最终回答；不启用工具、嵌入或重排。":undefined}><Input maxLength={128} placeholder="填写厂商提供的模型 ID"/></Form.Item>
     <Form.Item label="能力" name="capability" rules={required}><Select options={[{value:"text",label:"文本生成"},{value:"image",label:"图片生成（单张PNG）",disabled:aliyunText||deepseekText}]}/></Form.Item>
     <Form.Item label="上下文 Token 上限" name="contextTokens" rules={required}><InputNumber min={2048} max={2000000}/></Form.Item><Form.Item label="最大输出 Token" name="maxOutputTokens" rules={required}><InputNumber min={1} max={32768}/></Form.Item>
     <Form.Item label="输出限制参数" name="tokenParameter" rules={required}><Select options={[{value:"max_tokens",label:"max_tokens",disabled:aliyunText},{value:"max_completion_tokens",label:"max_completion_tokens",disabled:deepseekText}]}/></Form.Item>
     <Space wrap><Form.Item label="输入元 / 百万Token" name="inputPrice" rules={required}><Input inputMode="decimal"/></Form.Item><Form.Item label="输出元 / 百万Token" name="outputPrice" rules={required}><Input inputMode="decimal"/></Form.Item><Form.Item label="生图元 / 张" name="imagePrice" rules={required}><Input inputMode="decimal"/></Form.Item></Space>
     <div hidden={capability!=="image"}><Form.Item label="图片尺寸" name="imageSize" rules={required}><Select options={["1024x1024","1024x1536","1536x1024"].map(value=>({value,label:value}))}/></Form.Item><Form.Item label="图片质量" name="imageQuality" rules={required}><Select options={["auto","low","medium","high"].map(value=>({value,label:value}))}/></Form.Item><Form.Item name="imageBase64Format" valuePropName="checked"><Checkbox>兼容接口要求显式 response_format=b64_json</Checkbox></Form.Item></div>
    </>}
    {editor?.kind==="skills"&&<Form.Item label="Skill 指令" name="instructions" rules={required} extra="只保存提示词指令，不执行代码或外部工具。"><Input.TextArea rows={7} maxLength={8000} showCount/></Form.Item>}
    {editor?.kind==="agents"&&<>
     <Form.Item label="模型" name="modelCode" rules={required}><Select options={nameOptions("models")}/></Form.Item>
     <Form.Item label="绑定 Skill" name="skillCodes" extra="按选择顺序应用。"><Select mode="multiple" options={nameOptions("skills")}/></Form.Item>
     <Form.Item label="Agent 指令" name="instructions" rules={required}><Input.TextArea rows={5} maxLength={8000} showCount/></Form.Item>
     <Form.Item label="必填输入字段" name="inputFields" rules={required} extra="所有字段值均为字符串；例如 selfType、buddyType。"><Select mode="tags" tokenSeparators={[","]}/></Form.Item>
     <Form.Item label="输出格式" name="outputFormat" rules={required}><Select options={[{value:"text",label:"文本 / 图片"},{value:"json",label:"JSON 字符串字段对象"}]}/></Form.Item>
     {outputFormat==="json"&&<Form.Item label="必填输出字段" name="outputFields" rules={required}><Select mode="tags" tokenSeparators={[","]}/></Form.Item>}
     <Form.Item name="published" valuePropName="checked"><Checkbox>发布到客户可用列表</Checkbox></Form.Item><Typography.Paragraph type="secondary">发布前请启用此 Agent、模型、厂商及所有 Skill。付费权益由业务服务在调用前校验。</Typography.Paragraph>
    </>}
    <Form.Item name="enabled" valuePropName="checked"><Checkbox>启用</Checkbox></Form.Item>
   </Form>
  </Modal>
 </>;
}
