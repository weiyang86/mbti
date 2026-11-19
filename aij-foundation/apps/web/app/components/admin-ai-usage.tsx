"use client";
import { PageHeading } from "@aij/ui";
import { Alert, Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import { requestMessage } from "./admin-api";
import { useAdmin } from "./admin-shell";
import { AI_CENTER_CONFIGURATION_PERMISSION } from "./admin-ai-policy";

type Usage={month:string;currency:string;costKind:string;monthlyLimitNanos:string;workspaceMonthlyLimitNanos:string;usedAndReservedNanos:string;agents:{agentCode:string;status:string;count:number;estimatedCostNanos:string}[];models:{providerCode:string;modelCode:string;status:string;count:number;promptTokens:number;completionTokens:number;cachedTokens:number;imageCount:number}[];recent:{id:string;agentCode:string;agentRevision:number;catalogVersion:number;status:string;budgetStatus:string;estimatedCostNanos:string;failureCode:string|null;createdAt:string;completedAt:string|null}[]};
const yuan=(v:string)=>Number(BigInt(v))/1e9;
const STATUS:Record<string,string>={queued:"排队中",running:"执行中",succeeded:"成功",failed:"失败",unknown:"结果不确定",reserved:"保留预留",settled:"已结算估算",released:"已释放"};
export function AdminAiUsage(){
 const {request,can}=useAdmin();const [data,setData]=useState<Usage|null>(null),[error,setError]=useState(""),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
 const load=useEffectEvent(async()=>{setLoading(true);try{setData(await request<Usage>("/admin/ai/center/usage"));setError("");}catch(e){setError(requestMessage(e));}finally{setLoading(false);}});useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[revision]);
 const totals=data?.models.reduce((a,m)=>({input:a.input+m.promptTokens,output:a.output+m.completionTokens,images:a.images+m.imageCount}),{input:0,output:0,images:0});
 return <>
  <PageHeading eyebrow="AI 管理 · 用量" title="用量与预算" description="按 UTC 自然月查看调用、Token、图片和内部预算预留。" actions={<Button loading={loading} onClick={()=>setRevision(v=>v+1)}>刷新</Button>}/>
  <Space wrap>{can(AI_CENTER_CONFIGURATION_PERMISSION)&&<Link href="/auth/ai/center">AI 中心配置</Link>}<Link href="/auth/ai/traces">查看执行 Trace</Link>{data&&<Tag>{data.month} · CNY</Tag>}</Space>
  {error&&<Alert type="error" showIcon title={error} action={<Button onClick={()=>setRevision(v=>v+1)}>重试</Button>}/>}
  <Alert type="info" showIcon title="金额为内部估算，包含未确定结果的预留，并非厂商实际账单。" description="Token 价格由管理员维护；图片按配置的单张价格估算。不确定结果不会自动重试，预留也不会自动视为零费用。"/>
  <Row gutter={[16,16]}><Col xs={24} md={8}><Card loading={loading}><Statistic title="已用与预留（元）" value={data?yuan(data.usedAndReservedNanos):0} precision={4}/><Typography.Text type="secondary">项目月上限 {data?yuan(data.monthlyLimitNanos):"—"} 元；每个 Workspace {data?yuan(data.workspaceMonthlyLimitNanos):"—"} 元</Typography.Text></Card></Col><Col xs={24} md={8}><Card loading={loading}><Statistic title="输入 / 输出 Token" value={`${totals?.input??0} / ${totals?.output??0}`}/></Card></Col><Col xs={24} md={8}><Card loading={loading}><Statistic title="生成图片（张）" value={totals?.images??0}/></Card></Col></Row>
  <section className="admin-overview-section"><h2>厂商与模型</h2><Table locale={{emptyText:"暂无调用记录"}} rowKey={r=>`${r.providerCode}:${r.modelCode}:${r.status}`} loading={loading} dataSource={data?.models??[]} pagination={false} scroll={{x:800}} columns={[{title:"厂商连接",dataIndex:"providerCode"},{title:"模型",dataIndex:"modelCode"},{title:"状态",dataIndex:"status",render:v=><Tag>{STATUS[v]??v}</Tag>},{title:"调用",dataIndex:"count"},{title:"输入 Token",dataIndex:"promptTokens"},{title:"输出 Token",dataIndex:"completionTokens"},{title:"缓存 Token",dataIndex:"cachedTokens"},{title:"图片",dataIndex:"imageCount"}]}/></section>
  <section className="admin-overview-section"><h2>Agent 汇总</h2><Table locale={{emptyText:"暂无调用记录"}} rowKey={r=>`${r.agentCode}:${r.status}`} loading={loading} dataSource={data?.agents??[]} pagination={false} scroll={{x:650}} columns={[{title:"Agent",dataIndex:"agentCode"},{title:"状态",dataIndex:"status",render:v=><Tag>{STATUS[v]??v}</Tag>},{title:"运行次数",dataIndex:"count"},{title:"估算 / 预留（元）",dataIndex:"estimatedCostNanos",render:v=>yuan(v).toFixed(6)}]}/></section>
  <section className="admin-overview-section"><h2>最近 50 次运行</h2><Table locale={{emptyText:"暂无调用记录"}} rowKey="id" loading={loading} dataSource={data?.recent??[]} pagination={{pageSize:10}} scroll={{x:1000}} columns={[{title:"运行编号",dataIndex:"id",ellipsis:true},{title:"Agent / 版本",key:"agent",render:(_,r)=>`${r.agentCode} · v${r.agentRevision}`},{title:"状态",dataIndex:"status",render:v=><Tag color={v==="unknown"?"orange":v==="succeeded"?"green":"default"}>{STATUS[v]??v}</Tag>},{title:"预算",dataIndex:"budgetStatus",render:v=>STATUS[v]??v},{title:"估算 / 预留（元）",dataIndex:"estimatedCostNanos",render:v=>yuan(v).toFixed(6)},{title:"失败原因",dataIndex:"failureCode",render:v=>v??"—"},{title:"创建时间",dataIndex:"createdAt",render:v=>new Date(v).toLocaleString()}]}/></section>
 </>;
}
