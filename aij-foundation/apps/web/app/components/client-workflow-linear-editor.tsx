"use client";

import { Alert, Button, Space, Tag } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { createLinearDragController } from "./client-workflow-library-state.mjs";
import type { createWorkflowLibrary, WorkflowState } from "./client-workflow-library-state.mjs";

const bounded = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" } as const;
export function ClientWorkflowLinearEditor({ state, store, locked }: { state: WorkflowState; store: ReturnType<typeof createWorkflowLibrary>; locked: boolean }) {
  const list = useRef<HTMLOListElement>(null), [target, setTarget] = useState<number | null>(null);
  const token = state.editorToken, count = state.draft.steps.length;
  const drag = useMemo(() => createLinearDragController({ token, count, reorder: store.reorderStep }), [token, count, store]);
  useEffect(() => { if (locked) drag.cancel(); return () => drag.cancel(); }, [drag, locked]);
  const cancel = () => { drag.cancel(); setTarget(null); };
  const movePointer = (event: PointerEvent<HTMLElement>) => {
    if (locked) { cancel(); return; }
    const bounds = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-linear-card]") ?? []).map(card => card.getBoundingClientRect());
    setTarget(drag.move(event.pointerId, event.clientX, event.clientY, bounds));
  };
  const move = (index: number, delta: number) => {
    store.moveStep(index, delta, token);
    queueMicrotask(() => list.current?.querySelectorAll<HTMLButtonElement>("[data-linear-handle]")[index+delta]?.focus());
  };
  return <section style={bounded} aria-label="线性流程可视化编辑器">
    <p id="linear-drag-help">拖动步骤左侧手柄到目标卡片以调整顺序。手柄聚焦后用 ↑ / ↓，或使用上移、下移按钮；Escape 取消拖动。</p>
    <div role="region" aria-label="线性流程编辑区域，可内部滚动" tabIndex={0} style={{ ...bounded, overflow: "auto", maxHeight: 680, padding: 12, border: "1px solid var(--ant-color-border)", borderRadius: 8 }}>
      <div style={{ textAlign: "center", padding: 12 }}><Tag color="green">开始</Tag><p>声明的输入键 → Agent 步骤</p><span aria-hidden="true">↓</span></div>
      <ol ref={list} aria-label="线性步骤卡片" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {state.draft.steps.map((p,i) => { const a = state.agents.find(a => a.id === p.agentId); return <li key={i} data-linear-card style={{ ...bounded, marginBottom: 12, padding: 12, border: `2px solid ${!locked && target === i ? "var(--ant-color-primary)" : "var(--ant-color-border)"}`, borderRadius: 8, background: "var(--ant-color-bg-container)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
            <Button data-linear-handle aria-label={`拖动步骤 ${i+1}，方向键调整顺序`} aria-describedby="linear-drag-help" disabled={locked} style={{ minWidth: 44, minHeight: 44, touchAction: "none", cursor: locked ? "default" : "grab", flexShrink: 0 }}
              onPointerDown={e => { if (!locked && e.isPrimary && e.button === 0 && drag.start(e.pointerId,i)) { e.currentTarget.setPointerCapture(e.pointerId); setTarget(i); } }}
              onPointerMove={movePointer} onPointerUp={e => { if (!locked) { movePointer(e); drag.end(e.pointerId); } cancel(); }} onPointerCancel={cancel} onLostPointerCapture={cancel}
              onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); cancel(); } else if (["ArrowUp","ArrowDown"].includes(e.key)) { e.preventDefault(); const delta = e.key === "ArrowUp" ? -1 : 1; if (!locked && i+delta >= 0 && i+delta < count) move(i,delta); } }}>↕</Button>
            <div style={{ ...bounded, flex: 1 }}><strong>步骤 {i+1} · {p.name}</strong><p style={{ marginBlock: 8 }}>{p.code || a?.code || "当前不可用"} · <Tag>固定 v{p.revision}</Tag></p><span>{p.kind === "current" ? "明确选择的当前版本" : "保留的历史固定版本"}</span></div>
          </div>
          {(!a?.enabled || p.kind === "current" && a.revision !== p.revision) && <Alert type="warning" title="Agent 缺失、停用或当前版本已变更；请重新读取并明确选择" />}
          <Space wrap style={{ marginTop: 12 }}><Button aria-label={`上移步骤 ${i+1}`} disabled={locked || i === 0} onClick={() => move(i,-1)}>上移</Button><Button aria-label={`下移步骤 ${i+1}`} disabled={locked || i === count-1} onClick={() => move(i,1)}>下移</Button><Button danger aria-label={`移除步骤 ${i+1}`} disabled={locked} onClick={() => store.removeStep(i,token)}>移除</Button></Space>
          <div aria-hidden="true" style={{ textAlign: "center", marginTop: 12 }}>↓</div>
        </li>; })}
      </ol>
      {!count && <Alert type="warning" showIcon title="请明确添加至少一个 Agent 固定版本后再保存" />}
      <div style={{ textAlign: "center", padding: 12 }}><Tag>结束</Tag></div>
    </div>
    <p role="status" aria-live="polite">{!locked && target !== null ? `拖动目标：步骤 ${target+1}；松开手柄调整顺序` : `当前 ${count} 个 Agent 步骤，按上方连线顺序保存。`}</p>
  </section>;
}
