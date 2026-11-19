"use client";

import { Alert, Button, Checkbox, Form, Input, Modal, Spin } from "antd";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { ImportKnowledgeWeb } from "@aij/sdk";
import { validKnowledgeWebUrl } from "./client-knowledge-web-import-state.mjs";
import type { KnowledgeWebImportState } from "./client-knowledge-web-import-state.mjs";

type Props = { controller: KnowledgeWebImportState; refresh: VoidFunction; disabled?: boolean; sourceTrigger?: RefObject<HTMLElement | null> };
const privateTextStyle = { overflowWrap: "anywhere", whiteSpace: "pre-wrap", maxWidth: "100%" } as const;
export function KnowledgeWebSourceDetails({ source }: { source: NonNullable<ReturnType<KnowledgeWebImportState["getSnapshot"]>["source"]> }) {
  return <div style={{ minWidth: 0, maxWidth: "100%", overflowX: "auto" }}>
    <Alert type={source.contentMatchesSource ? "info" : "warning"} showIcon title={source.contentMatchesSource ? "当前正文与导入时提取的文本一致" : "当前正文与导入时提取的文本不同"} />
    <p>手动编辑正文后可能与原始来源不同。以下是导入时的来源记录，不是当前实时网页内容，也不表示允许分享。URL 查询文字可能包含私密信息，请谨慎复制。</p>
    <dl>{[["原始 URL", source.sourceUrl], ["最终 URL", source.sourceFinalUrl], ["原始内容校验和（SHA-256）", source.sourceChecksum], ["提取文本校验和（SHA-256）", source.sourceTextChecksum], ["提取版本", source.sourceExtractionVersion]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ ...privateTextStyle, marginInlineStart: 0 }}>{value}</dd></div>)}</dl>
  </div>;
}
export function ClientKnowledgeWebImport({ controller, refresh, disabled = false, sourceTrigger }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [form] = Form.useForm<ImportKnowledgeWeb>();
  const [acknowledged, setAcknowledged] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ revision: number; source: boolean } | null>(null);
  const handledFocus = useRef<typeof focusRequest>(null);
  const importing = state.stage === "importing";
  const open = ["form", "confirm", "importing", "source-loading", "source"].includes(state.stage);
  const close = () => {
    if (controller.getSnapshot().revision !== state.revision) return;
    controller.dismiss(state.revision);
    form.resetFields(); setAcknowledged(false);
    // Keep only a scope-version ticket, never the private draft/source or old DOM.
    setFocusRequest({ revision: controller.getSnapshot().revision, source: state.stage.startsWith("source") });
  };
  useEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest) return;
    handledFocus.current = focusRequest;
    // Passive effects run after the conditional portal has been removed and its
    // focus lock released. Immediate focus in onCancel is captured by that lock.
    if (open || disabled || !controller.canRestoreFocus(focusRequest.revision)) return;
    const target = focusRequest.source ? sourceTrigger?.current : trigger.current;
    if (target?.isConnected && !target.matches(":disabled, [aria-disabled='true']")) target.focus({ preventScroll: true });
  }, [controller, disabled, focusRequest, open, sourceTrigger]);
  return <div style={{ minWidth: 0, maxWidth: "100%" }}>
    <Button ref={trigger} disabled={disabled || state.locked || importing} onClick={() => { form.resetFields(); controller.open(state.revision); }}>导入网页</Button>
    {(state.message || state.locked) && <Alert role="status" type={state.stage === "success" ? "success" : "warning"} showIcon title={state.message || "导入结果未知，可能已保存。请先重新读取列表，按原编号核对结果，切勿重复提交。"} style={{ marginTop: 12 }} />}
    {(state.locked || state.stage === "success") && <Button onClick={refresh} disabled={disabled}>重新读取列表核对</Button>}
    {state.locked && state.checked && <div><Checkbox checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}>已按原编号核对结果，理解已有文档不会被覆盖</Checkbox><Button disabled={!acknowledged} onClick={() => { controller.acknowledgeRead(state.revision); setAcknowledged(false); }}>完成核对，允许新导入</Button></div>}
    {open && <Modal title={state.stage.startsWith("source") ? "核对网页来源" : "导入知识网页"} open onCancel={close} footer={null} destroyOnHidden focusTriggerAfterClose={false} width={560} styles={{ body: { minWidth: 0, overflowWrap: "anywhere" } }}>
      {state.stage === "form" && <Form form={form} layout="vertical" preserve={false} requiredMark={false} onFinish={values => { controller.prepare(values, state.revision); form.resetFields(); }}>
        <p>仅首次导入 HTTPS 网页。文档保持停用；不会自动加入检索，也不会刷新或覆盖同编号文档。服务端仍会校验 DNS、TLS、权限和地址安全。</p>
        <Form.Item name="documentCode" label="文档编号" rules={[{ required: true, pattern: /^[a-z0-9][a-z0-9._-]{1,79}$/, message: "使用 2–80 位小写字母、数字、点、短横线或下划线" }]}><Input maxLength={80} autoComplete="off" /></Form.Item>
        <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, max: 160, message: "请填写不超过 160 字且无控制字符的标题" }]}><Input maxLength={160} autoComplete="off" /></Form.Item>
        <Form.Item name="url" label="HTTPS 网页地址" rules={[{ validator: async (_, value) => { if (!validKnowledgeWebUrl(value)) throw new Error("请输入无账号密码、片段或空白的完整 HTTPS 地址"); } }]}><Input maxLength={2048} autoComplete="off" spellCheck={false} /></Form.Item>
        <Button onClick={close}>取消</Button> <Button type="primary" htmlType="submit">核对导入内容</Button>
      </Form>}
      {state.stage === "confirm" && state.draft && <div>
        <p>确认仅发起一次导入请求，保存后保持停用。地址可能包含私密查询文字，仅在本弹窗核对。</p>
        <dl>{[["文档编号", state.draft.documentCode], ["标题", state.draft.title], ["HTTPS 网页地址", state.draft.url]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ ...privateTextStyle, marginInlineStart: 0 }}>{value}</dd></div>)}</dl>
        <Button onClick={close}>取消</Button> <Button type="primary" onClick={() => void controller.confirm(state.revision)}>确认导入并保持停用</Button>
      </div>}
      {(importing || state.stage === "source-loading") && <div role="status"><Spin /> {importing ? "正在导入；关闭或离开后请先核对列表，切勿重复提交。" : "正在读取当前文档来源…"}</div>}
      {state.stage === "source" && state.source && <KnowledgeWebSourceDetails source={state.source} />}
    </Modal>}
  </div>;
}
