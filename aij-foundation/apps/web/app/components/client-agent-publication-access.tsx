"use client";

import { createPersonalAgentPublicationsClient } from '@aij/sdk';
import { Alert, Spin } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clientApi } from './client-api.mjs';
import { ClientAgentPublication, type AgentPublicationScope } from './client-agent-publication';

type Props = { workspaceId: string; memberId: string; agentId: string; onAccessChanged: () => void; onDebug: () => void };
const same = (a: AgentPublicationScope, b: AgentPublicationScope) => JSON.stringify(a) === JSON.stringify(b);

/** Composition uses real public SDK and freshly verified Cookie/context metadata. */
export function ClientAgentPublicationAccess(props: Props) {
  const { onAccessChanged } = props;
  const api = useMemo(() => createPersonalAgentPublicationsClient(clientApi), []);
  const [scope, setScope] = useState<AgentPublicationScope | null>(null);
  const [failed, setFailed] = useState(false);
  const readScope = useCallback(async (): Promise<AgentPublicationScope> => {
    const p = await clientApi<{ id: string }>('/client/auth/me');
    const c = await clientApi<{ workspaceId: string; roleId: string; permissions: string[]; sessionGeneration: string }>('/client/workspaces/context', { workspaceId: props.workspaceId });
    if (p.id !== props.memberId || c.workspaceId !== props.workspaceId || !/^[A-Za-z0-9_-]{1,128}$/.test(c.roleId) ||
      !/^[a-f0-9]{64}$/.test(c.sessionGeneration) || !Array.isArray(c.permissions) || c.permissions.some(v => typeof v !== 'string')) throw new Error('Access changed');
    const permissions = [...c.permissions].sort();
    return { workspaceId: c.workspaceId, memberId: p.id, roleKey: c.roleId, sessionKey: c.sessionGeneration,
      revalidationKey: JSON.stringify(permissions), permissions };
  }, [props.workspaceId, props.memberId]);
  useEffect(() => {
    let live = true;
    void readScope().then(s => { if (live) setScope(s); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [readScope]);
  const revalidate = useCallback(async () => {
    try {
      const fresh = await readScope();
      if (!scope || !same(scope, fresh)) throw new Error('Access changed');
      return fresh;
    } catch (error) { onAccessChanged(); throw error; }
  }, [scope, readScope, onAccessChanged]);
  if (failed) return <Alert type="warning" showIcon title="发布状态访问已失效，请重新验证访问。" />;
  if (!scope) return <Spin aria-label="正在验证发布状态访问" />;
  return <ClientAgentPublication api={api} scope={scope} agentId={props.agentId} revalidate={revalidate} onDebug={props.onDebug} />;
}
