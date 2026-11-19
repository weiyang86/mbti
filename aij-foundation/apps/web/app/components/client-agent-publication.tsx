"use client";

import type { PersonalAgentPublication, PersonalAgentPublicationsClient } from '../../../../packages/sdk/src/personal-agent-publications';
import { Alert, Button, Descriptions, Modal, Space, Tag } from 'antd';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type AgentPublicationScope = Readonly<{ workspaceId: string; memberId: string; sessionKey: string; roleKey: string;
  revalidationKey: string; permissions: readonly string[] }>;
export type AgentPublicationProps = Readonly<{ api: PersonalAgentPublicationsClient; agentId: string; scope: AgentPublicationScope;
  revalidate: () => Promise<AgentPublicationScope>; onDebug: () => void }>;
type Intent = 'publish' | 'unpublish';
type State = Readonly<{ metadata: PersonalAgentPublication | null; busy: boolean; confirmation: Intent | null;
  intent: Intent | null; issue: string | null; uncertain: boolean; readBack: boolean }>;
const readPermission = 'workspace.ai.assets.read', managePermission = 'workspace.ai.assets.manage';
const scopeKey = (s: AgentPublicationScope) => JSON.stringify([s.workspaceId, s.memberId, s.sessionKey, s.roleKey, s.revalidationKey, [...s.permissions].sort()]);
const status = (e: unknown): number | undefined => e && typeof e === 'object' && 'status' in e && typeof e.status === 'number' ? e.status : undefined;

/** RAM-only controller. Ports are injected by root using the PUBLIC SDK composition. */
export function createAgentPublicationState(initialProps: AgentPublicationProps) {
  let props = initialProps;
  let state: State = { metadata: null, busy: false, confirmation: null, intent: null, issue: null, uncertain: false, readBack: false };
  let generation = 0, active = true;
  const listeners = new Set<() => void>(), originalKey = scopeKey(props.scope);
  const emit = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const fn of listeners) fn(); };
  const current = (g: number) => active && g === generation;
  const allowed = (permission: string) => props.scope.permissions.includes(permission);
  const validate = async (g: number, permission: string) => {
    const fresh = await props.revalidate();
    if (!current(g)) return false;
    if (scopeKey(fresh) !== originalKey || !fresh.permissions.includes(permission)) {
      generation++; emit({ metadata: null, busy: false, confirmation: null, intent: null, issue: '访问已变化，请重新验证身份和空间。', readBack: false });
      return false;
    }
    return true;
  };
  const clear = () => { generation++; emit({ metadata: null, confirmation: null, intent: null, busy: false, issue: null, readBack: false }); };
  const read = async () => {
    if (!active || state.busy || !allowed(readPermission)) return;
    const g = ++generation; emit({ metadata: null, busy: true, confirmation: null, issue: null, readBack: false });
    try {
      if (!await validate(g, readPermission)) return;
      const metadata = await props.api.get(props.scope.workspaceId, props.agentId);
      if (current(g) && await validate(g, readPermission)) emit({ metadata, readBack: true });
    } catch { if (current(g)) emit({ metadata: null, issue: '发布状态读取失败，请重新验证并读取。' }); }
    finally { if (current(g)) emit({ busy: false }); }
  };
  const request = async (intent: Intent) => {
    if (!active || state.busy || state.uncertain || !allowed(readPermission) || !allowed(managePermission)) return;
    const g = generation + 1; emit({ intent }); await read();
    if (current(g) && state.metadata && !state.busy && !state.uncertain && state.intent === intent) emit({ confirmation: intent });
  };
  const confirm = async () => {
    const before = state.metadata, intent = state.confirmation;
    if (!active || state.busy || state.uncertain || !before || !intent || !allowed(managePermission)) return;
    const g = ++generation; emit({ busy: true, confirmation: null, issue: null, readBack: false });
    let sent = false;
    try {
      if (!await validate(g, managePermission)) return;
      const latest = await props.api.get(props.scope.workspaceId, props.agentId);
      if (!current(g) || !await validate(g, managePermission)) return;
      if (latest.revision !== before.revision || latest.publicationVersion !== before.publicationVersion) {
        emit({ metadata: latest, issue: '版本已变化；已保留操作意图，请核对后重新确认。' }); return;
      }
      sent = true; emit({ uncertain: true });
      const metadata = await props.api[intent](props.scope.workspaceId, props.agentId,
        { expectedAgentRevision: before.revision, expectedPublicationVersion: before.publicationVersion });
      if (current(g) && await validate(g, managePermission)) emit({ metadata, uncertain: false, intent: null });
    } catch (e) {
      if (current(g)) {
        const knownRefusal = [400, 401, 403, 404, 409].includes(status(e) ?? 0);
        emit({ metadata: null, uncertain: sent && !knownRefusal, issue: status(e) === 409
          ? '版本冲突；已保留操作意图，请重新读取后明确确认。'
          : sent && !knownRefusal ? '写入结果尚未确认。请先读取当前状态并明确确认，不能自动重试。' : '操作被拒绝，请重新验证访问或依赖状态。' });
      }
    } finally { if (current(g)) emit({ busy: false }); }
  };
  return {
    updatePorts(next: AgentPublicationProps) {
      if (scopeKey(next.scope) !== originalKey || next.agentId !== props.agentId) { active = false; clear(); return; }
      props = next;
    },
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, getSnapshot: () => state,
    read, request, confirm, cancel: () => { generation++; emit({ confirmation: null, intent: null, busy: false }); return generation; }, clear,
    canRestoreFocus: (ticket: number) => active && ticket === generation,
    acknowledge() { if (state.uncertain && state.readBack && state.metadata && !state.busy) emit({ uncertain: false, intent: null, issue: null }); },
    async debug() {
      if (state.busy || state.uncertain || !allowed('workspace.ai.execute') || !allowed(readPermission)) return;
      const g = generation + 1; await read();
      if (current(g) && state.metadata?.published && state.metadata.dependencyReadiness.ready && state.readBack && !state.busy) props.onDebug();
    },
    resume() { active = true; clear(); return read(); },
    dispose() { active = false; clear(); }
  };
}

/** Embedded in existing Agent details; existing preview/run page remains the debugging consumer. */
export function ClientAgentPublication(props: AgentPublicationProps) {
  // Keyed inner instance clears all visible state synchronously when identity/role/revalidation changes.
  return <PublicationPanel key={scopeKey(props.scope) + ':' + props.agentId} {...props} />;
}
function PublicationPanel(props: AgentPublicationProps) {
  const [store] = useState(() => createAgentPublicationState(props));
  const publishTrigger = useRef<HTMLButtonElement>(null), unpublishTrigger = useRef<HTMLButtonElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ ticket: number; intent: Intent } | null>(null);
  const handledFocus = useRef<typeof focusRequest>(null);
  useEffect(() => { store.updatePorts(props); }, [store, props]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest) return;
    handledFocus.current = focusRequest;
    if (state.confirmation || !store.canRestoreFocus(focusRequest.ticket)) return;
    const target = focusRequest.intent === 'publish' ? publishTrigger.current : unpublishTrigger.current;
    if (target?.isConnected && !target.matches(':disabled,[aria-disabled=true]')) target.focus({ preventScroll: true });
  }, [focusRequest, state.confirmation, store]);
  useEffect(() => {
    void store.resume();
    const leave = () => store.dispose();
    const resume = () => { if (document.visibilityState === 'visible') void store.resume(); else leave(); };
    const restore = () => resume();
    window.addEventListener('blur', leave); window.addEventListener('focus', resume); window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', restore); document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('blur', leave); window.removeEventListener('focus', resume); window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', restore); document.removeEventListener('visibilitychange', resume); store.dispose(); };
  }, [store]);
  const metadata = state.metadata, canRead = props.scope.permissions.includes(readPermission), canManage = canRead && props.scope.permissions.includes(managePermission);
  return <section aria-label="个人 Agent 发布与版本调试" aria-busy={state.busy} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h3>发布与版本调试</h3>
    <p>发布使当前版本具备执行资格；执行时仍会检查权限、依赖和模型配置。发布不会向其他人分享。</p>
    {state.issue && <Alert role="alert" showIcon type="warning" title={state.issue} />}
    {!canRead && <Alert type="info" title="当前角色没有发布状态读取权限" />}
    {metadata && <><Tag color={metadata.published ? 'success' : 'default'}>{metadata.published ? '已发布' : '未发布'}</Tag>
      <Descriptions column={1} size="small" items={[
        { key: 'revision', label: '当前配置版本', children: `v${metadata.revision}` },
        { key: 'published', label: '已发布版本', children: metadata.publishedRevision === null ? '无' : `v${metadata.publishedRevision}` },
        { key: 'epoch', label: '发布状态版本', children: metadata.publicationVersion },
        { key: 'dependencies', label: '当前依赖', children: metadata.dependencyReadiness.ready ? '可用（执行前重新校验）' : metadata.dependencyReadiness.reason === 'disabled' ? 'Agent 配置未启用' : '当前不可发布，请核对模型和固定 Skill 版本' }
      ]} /></>}
    {state.intent && <p role="status">待核对意图：{state.intent === 'publish' ? '发布当前版本' : '撤销发布'}。不会自动重试。</p>}
    {state.uncertain && <Alert type="warning" showIcon title="前次写入结果尚未确认" description="先重新读取当前状态，再明确确认已核对，之后才能开始新的操作。" />}
    <Space wrap><Button disabled={state.busy || !canRead} loading={state.busy} onClick={() => void store.read()}>重新验证并读取发布状态</Button>
      {state.uncertain && <Button disabled={state.busy || !state.readBack || !metadata} onClick={() => store.acknowledge()}>已核对当前状态</Button>}
      {canManage && <><Button ref={publishTrigger} type="primary" disabled={state.busy || state.uncertain || !metadata || metadata.published || !metadata.dependencyReadiness.ready} onClick={() => void store.request('publish')}>发布当前版本</Button>
        <Button ref={unpublishTrigger} danger disabled={state.busy || state.uncertain || !metadata?.published} onClick={() => void store.request('unpublish')}>撤销发布</Button></>}
      {props.scope.permissions.includes('workspace.ai.execute') && <Button disabled={state.busy || state.uncertain || !metadata?.published || !metadata.dependencyReadiness.ready} onClick={() => void store.debug()}>刷新并进入运行调试</Button>}
    </Space>
    {!canManage && canRead && <p>当前角色只读，发布和撤销发布需要资产管理权限。</p>}
    {state.confirmation && <Modal open title={state.confirmation === 'publish' ? '确认发布当前版本' : '确认撤销发布'} okText="确认此操作" cancelText="返回检查" destroyOnHidden focusTriggerAfterClose={false}
      onCancel={() => { const intent = state.confirmation; if (intent) setFocusRequest({ ticket: store.cancel(), intent }); }} onOk={() => void store.confirm()}>
      <p>当前配置 v{metadata?.revision} · 发布状态版本 {metadata?.publicationVersion}。</p>
      <p>{state.confirmation === 'publish' ? '服务端将重新核对当前版本和依赖；不保证模型执行配置已完成。' : '撤销后旧排队快照不能继续准入；不自动重试已完成或结果未知的任务。'}</p>
    </Modal>}
  </section>;
}
