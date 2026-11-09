"use client";

import type { WorkflowBody, WorkflowGraph, WorkflowNode, PersonalWorkflowAgentBinding, PersonalAgentSummary } from "@aij/sdk";
import { Alert, Tag } from "antd";

const labels: Record<WorkflowNode["type"], string> = { start: "开始", end: "结束", agent: "Agent", condition: "条件", parallel: "并行分支", join: "汇合", loop: "有限循环", "human-approval": "人工审批占位" };
const bounded = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
function agentLabel(agentId: string, agents: PersonalAgentSummary[]) {
  const agent = agents.find(a => a.id === agentId);
  return agent ? `${agent.name} · ${agent.code}` : "已保存的 Agent（当前不可用）";
}
function description(n: WorkflowNode, agents: PersonalAgentSummary[]) {
  if (n.type === "agent") return `${agentLabel(n.agentId, agents)} · 固定 v${n.revision}`;
  if (n.type === "condition") return `${n.predicate.key} ${n.predicate.op}${n.predicate.op === "exists" ? "" : ` ${JSON.stringify(n.predicate.value)}`} → ${n.joinId}`;
  if (n.type === "parallel") return `${n.branches.join(" / ")} → ${n.joinId}`;
  if (n.type === "join") return `匹配分支 ${n.forkId}`;
  if (n.type === "loop") return `上限 ${n.maxIterations} 次（只读结构）`;
  return n.type === "human-approval" ? "不提供授权或自动审批" : "";
}
function BodyPreview({ body, agents, depth = 0 }: { body: WorkflowBody; agents: PersonalAgentSummary[]; depth?: number }) {
  // Topological columns show actual edges and named ports. DOM/SVG IDs never
  // contain user values; no external renderer, markup injection or execution.
  const order: WorkflowNode[] = [], indegree = new Map(body.nodes.map(n => [n.id, body.edges.filter(e => e.to === n.id).length]));
  const queue = body.nodes.filter(n => indegree.get(n.id) === 0);
  while (queue.length) { const n = queue.shift()!; order.push(n); for (const e of body.edges.filter(e => e.from === n.id)) { const count = indegree.get(e.to)! - 1; indegree.set(e.to, count); if (!count) queue.push(body.nodes.find(x => x.id === e.to)!); } }
  const positions = new Map(order.map((n,i) => [n.id, { x: 24 + (i % 4) * 248, y: 24 + Math.floor(i/4) * 180 }]));
  const width = Math.min(4, Math.max(1, order.length)) * 248 + 24, height = Math.ceil(order.length/4)*180 + 24;
  return <div style={bounded}>
    <div tabIndex={0} role="region" aria-label={depth ? "循环体只读拓扑，可滚动" : "流程只读拓扑，可滚动"} style={{ maxWidth: "100%", overflow: "auto", border: "1px solid var(--ant-color-border, #d5dcd1)", borderRadius: 8 }}>
      <svg role="img" aria-label="草稿节点与端口连线；完整内容见下方文本拓扑" width={width} height={height} style={{ display: "block" }}>
        <title>只读流程预览 · 不可执行</title>
        {body.edges.map((e,i) => { const a = positions.get(e.from), b = positions.get(e.to); if (!a || !b) return null; return <g key={i}><path d={`M ${a.x+180} ${a.y+42} L ${b.x} ${b.y+42}`} fill="none" stroke="currentColor" strokeOpacity="0.5" /><text x={(a.x+180+b.x)/2} y={(a.y+b.y)/2+32} fontSize={11} fill="currentColor">{e.port} → {e.input}</text><circle cx={b.x} cy={b.y+42} r={3} fill="currentColor" /></g>; })}
        {order.map(n => { const p = positions.get(n.id)!; const label = Array.from(n.type === "agent" ? agentLabel(n.agentId, agents) : n.label || n.id); return <g key={n.id}><rect x={p.x} y={p.y} width={180} height={84} rx={8} fill="var(--ant-color-bg-container, #fff)" stroke="var(--ant-color-border, #d5dcd1)" /><text x={p.x+12} y={p.y+24} fontSize={14} fill="currentColor">{labels[n.type]}</text><text x={p.x+12} y={p.y+47} fontSize={12} fill="currentColor">{label.length > 12 ? `${label.slice(0,11).join("")}…` : label.join("")}</text><text x={p.x+12} y={p.y+68} fontSize={11} fill="currentColor">{n.type === "agent" ? `固定 v${n.revision}` : n.type === "loop" ? `最多 ${n.maxIterations} 次` : "DRAFT"}</text></g>; })}
      </svg>
    </div>
    <details open><summary>完整文本拓扑与端口</summary><ol>{order.map(n => <li key={n.id} style={{ marginBlock: 12 }}><strong>{labels[n.type]} · {n.id}</strong>{n.label && <span> · {n.label}</span>}<p>{description(n, agents)}</p>
      <ul>{body.edges.filter(e => e.from === n.id).map((e,i) => <li key={i}>{e.from} [{e.port}] → {e.to} [{e.input}]</li>)}</ul>
      {n.type === "loop" && depth < 3 && <details><summary>展开 {n.id} 的循环体</summary><BodyPreview body={n.body} agents={agents} depth={depth+1} /></details>}
    </li>)}</ol></details>
  </div>;
}
export function ClientWorkflowGraphPreview({ graph, bindings, agents }: { graph: WorkflowGraph; bindings: PersonalWorkflowAgentBinding[]; agents: PersonalAgentSummary[] }) {
  return <section aria-label="保存的流程只读预览" style={bounded}><Tag>DRAFT</Tag><Tag>结构有效</Tag><Alert type="info" showIcon title="只读拓扑预览" description="结构校验不代表流程可执行。人工审批仅为占位，不提供授权或自动决策。本页不发布、不运行流程。" />
    <p>输入键：{graph.inputKeys.join("、") || "无"}</p><BodyPreview body={graph} agents={agents} />
    <h4>保存的 Agent 固定绑定</h4>{bindings.length ? <ul>{bindings.map(p => { const a = agents.find(a => a.id === p.agentId); return <li key={p.nodeId} style={bounded}>{p.nodeId} → {agentLabel(p.agentId, agents)} · 固定 v{p.revision}<p>{!a ? "缺失 / 已删除 / 尚未核验，固定绑定保持原值" : !a.enabled ? "当前 Agent 已停用，固定绑定保持原值" : a.revision !== p.revision ? `当前已变更至 v${a.revision}；保存的是历史固定版本，未自动替换` : "当前摘要与固定版本一致；可用性以服务端为准"}</p></li>; })}</ul> : <p>此图没有 Agent 绑定。</p>}
  </section>;
}
