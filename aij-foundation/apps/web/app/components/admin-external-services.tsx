"use client";
import { Alert, Button, Form, Input, Select, Space, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { createExternalServicesState, type Api, type State } from "./admin-external-services-state.mjs";
const CATEGORY_LABEL: Record<string, string> = { model: "AI 模型", storage: "对象存储", payment: "支付", notification: "通知" };

export function AdminExternalServices({ api, identityKey, canManageSecrets }: { api: Api; identityKey: string; canManageSecrets: boolean }) {
  // A new keyed inner tree prevents rendering another identity's draft before effects run.
  return <ExternalServicesEditor key={`${identityKey}:${canManageSecrets}`} api={api} canManageSecrets={canManageSecrets} />;
}
function ExternalServicesEditor({ api, canManageSecrets }: { api: Api; canManageSecrets: boolean }) {
  const [state, setState] = useState<State>({ providers: [], view: null, fields: {}, refs: {}, error: '', busy: false, blocked: false, latest: null, catalogFailed: false });
  const model = useMemo(() => createExternalServicesState(api, setState), [api]);
  useEffect(() => {
    let active = !document.hidden;
    if (active) void model.start();
    const clear = () => { active = false; model.dispose(); setState({ providers: [], view: null, fields: {}, refs: {}, error: '', busy: false, blocked: false, latest: null, catalogFailed: false }); };
    const show = () => { if (!document.hidden && !active) { active = true; void model.start(); } };
    const visibility = () => { if (document.hidden) clear(); else show(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', clear); window.addEventListener('focus', show);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', clear); window.removeEventListener('focus', show); model.dispose(); };
  }, [model]);
  const provider = state.providers.find(p => p.code === state.view?.providerCode);
  return <section className="admin-table-panel" aria-label="外部服务配置">
    <h2>外部服务配置</h2><p className="admin-help">仅保存配置草稿与 SecretRef 引用；真实渠道尚未验证，运行功能未启用。请勿输入密钥明文。</p>
    {state.error && <Alert className="admin-feedback" type="warning" showIcon title={state.error} />}
    {state.catalogFailed && <Button onClick={() => void model.start()} disabled={state.busy}>重试读取服务目录</Button>}
    <Select aria-label="选择外部服务" placeholder="选择服务" value={state.view?.providerCode} loading={state.busy} disabled={state.busy} style={{ width: '100%', maxWidth: 360 }} options={state.providers.map(p => ({ value: p.code, label: `${p.label} · ${CATEGORY_LABEL[p.category] ?? "外部服务"}` }))} onChange={code => void model.open(code)} />
    {provider && state.view && <>
      <p><Tag>{({ not_configured: '待配置', draft: '草稿', credentials_ready: '引用已就绪' })[state.view.configurationStatus]}</Tag>版本 {state.view.version} · 外部验证未运行</p>
      <p className="admin-help">缺项：{state.view.missingFields.map(k => provider.fields.find(f => f.key === k)?.label ?? provider.credentials.find(c => c.key === k)?.label ?? k).join('、') || '无'}</p>
      <Form layout="vertical" onFinish={() => void model.save()}>
        {provider.fields.map(f => <Form.Item key={f.key} label={`${f.label}${f.required ? '（完整配置需要）' : ''}`}>
          {f.kind === 'select' ? <Select aria-label={f.label} disabled={state.busy} allowClear value={state.fields[f.key] || undefined} options={f.options} onChange={v => model.field(f.key, v ?? '')} /> : <Input aria-label={f.label} disabled={state.busy} type={f.kind === 'url' ? 'url' : 'text'} inputMode={f.kind === 'number' ? 'decimal' : undefined} maxLength={f.maxLength} value={state.fields[f.key] ?? ''} onChange={e => model.field(f.key, e.target.value)} />}
        </Form.Item>)}
        {provider.credentials.map(c => <Form.Item key={c.key} label={`${c.label} · ${state.view!.credentialStates[c.key] ? '已配置' : '未配置'}`} extra="空白保留原引用；只接受已有 SecretRef。">
          <Space.Compact style={{ width: '100%' }}><Input.Password aria-label={`${c.label} SecretRef`} autoComplete="off" disabled={!canManageSecrets || state.busy} value={state.refs[c.key] ?? ''} onChange={e => model.ref(c.key, e.target.value)} /><Button disabled={!canManageSecrets || state.busy} onClick={() => model.ref(c.key, null)}>明确清除</Button></Space.Compact>
          {state.refs[c.key] === null && <span role="status">保存时将清除引用；输入新引用或清空输入可撤销。</span>}
        </Form.Item>)}
        <Space wrap><Button type="primary" htmlType="submit" loading={state.busy} disabled={state.blocked}>按版本保存草稿</Button>{state.blocked && <Button onClick={() => void model.reload()} disabled={state.busy}>读取最新版本</Button>}</Space>
      </Form>
      {state.latest && <Alert className="admin-feedback" type="warning" title={`最新版本 ${state.latest.version}，缺项：${state.latest.missingFields.join('、') || '无'}`} description={<><p>当前草稿和引用修改仍保留。核对后确认使用最新版本号，再手动保存。</p><dl>{provider.fields.map(f => <div key={f.key}><dt>{f.label}</dt><dd>最新：{state.latest!.fields[f.key] || "（空）"}；草稿：{state.fields[f.key] || "（空）"}</dd></div>)}{provider.credentials.map(c => <div key={c.key}><dt>{c.label}</dt><dd>最新：{state.latest!.credentialStates[c.key] ? "已配置" : "未配置"}</dd></div>)}</dl><Button disabled={state.busy} onClick={() => model.confirm()}>确认使用最新版本</Button></>} />}
    </>}
  </section>;
}
