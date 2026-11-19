# AF-225 root 接线请求

候选不是 CODE_VERIFIED。只提交注入式 state、声明、Panel、离线测试与本文档；未修改父 manager/library/access、公开 SDK index、registry 或正式队列。正式顺序 I223 → I224 → I225，引用真实 I Task ID；当前候选不满足正式依赖。

## 组件与端口

- `createDocumentSectionsEditor({request, sectionsApi, composeDraft, onDraftReady, onScopeRejected, isActive?})` 返回 `getSnapshot/subscribe/setScope/setCallbacks/load/select/draft/preview/requestConfirmation/cancelConfirmation/confirmDraft/suspend/dispose`。
- `ClientDocumentSectionsPanel` 接收同名 props、`scope`，以及可选 `controller`。无 controller 时只用初始化 props 创建一个实例；有 controller 时使用 root 的唯一永久实例，勿在后续 render 替换实例或用 key 重建。scope=null 保持挂载但隐藏私有内容，scope layout effect 会清 RAM；render 已先遮蔽旧 scope。
- root 在 I224 完成公开导出后提供 `sectionsApi = createPersonalDocumentSectionsClient(guardedRequest)` 及 `composeDraft = composePersonalDocumentSectionDraft`；此候选只 import 当前已有的 public `createPersonalDocumentsClient`。不从未公开源码导入新 SDK 方法。
- `sectionsApi.get(workspaceId, documentId, expectedRevision, signal?)` 和异步 `composeDraft({document,index,sectionId,replacement})` 严格遵循 W23 frozen CONTRACT，port 必须是已解码的 AF224 实现。候选额外钉住 wire/range/UTF16/source hash，未实现另一份 parser 或实际 SDK composer。
- props/端口保持稳定；`setCallbacks` 在 request 或端口引用变化时立即清 RAM。`isActive` 使用 `!document.hidden && document.hasFocus()`，root 自建 controller 也必须传该检测，并将 invalidation 同步转发至 `suspend/setScope(null)`。

## saved-only scope 与父唯一保存 owner

root 仅在原已保存 view、无编辑/未保存草稿/忙/历史/删除确认/冲突/未知写入/恢复确认或恢复锁时提供 `{memberId,workspaceId,documentId,revision}`，其余为 null；保持原恢复 controller 实例与未知结果锁。父 scope 选择必须在 manager 每次 publish 时同步应用到该唯一 sections controller，避免只等 React effect 才阻断正在返回的回调。Panel 内监听 blur、真 hidden、pagehide、卸载；root 还需同步清父和兄弟 owner，不能仅遮蔽 DOM。

`onDraftReady(proposal): boolean` 必须同步调用 root 新增的 `manager.applySectionDraft(proposal)`，不调用网络、不 await、不自动保存。候选 proposal 精确包含：

```ts
{
  documentId, expectedRevision, sourceSha256, sectionId, body, changed,
  memberId, workspaceId, roleId, roleCode, sessionGeneration,
  permissions // 去重验证后排序的只读数组
}
```

这是 AF225 的本地回调类型，非新 wire DTO。根接线应同时验证：

1. 当前 parent scope、保存视图和 `canMutate()` 仍允许应用，没有已有草稿、恢复锁或未知结果。
2. proposal member/workspace/document/revision 与父当前保存 detail 和 scope 精确相同；sessionGeneration 等于父 `sessionKey`，roleId、排序 permissions 等于父已验证上下文（roleCode 由原完整 context 钉住；不要把角色名称当权限）。
3. 回调当刻该唯一 controller 的 head/index 仍存在，其 scopeKey、head id/revision/body、index sourceSha256 与父当前 detail/proposal 一致；不能接受外来或过期 controller 的 proposal。
4. 接受只把 `body` 放入原全文草稿并进入 editing，保留原 detail/name/code/revision；随后原明确保存沿原 PATCH/expectedRevision 和唯一 unknown-result owner。返回 true；任一条件不符返回 false，不覆盖父草稿。

父 publish 进入 editing 应同步使 child scope=null；回调之后候选会检查旧 epoch，绝不在 null scope 上回填通知或正文。因成功后 Panel 可能隐藏，parent 应显示“已应用到全文草稿，尚未保存，请在全文编辑器明确保存。”。`onScopeRejected()` 在当前 401/403/404 时先清 child 后同步调用，root 须清父和兄弟 controller/访问范围；local parse/compose 400 不触发撤权。所有候选动作零 PATCH，取消/noop 不调用父 callback，没有第二份 mutation recovery 锁。

## 正式验证留给 root

- 使用真实 I223/I224 端口和原 production 页面，通过 desktop/390px 与 native 操作读→选→编辑完整章节→预览→确认到全文草稿→原明确保存，并证明仅生成一版。
- 验证既有草稿不能覆盖，改修订/撤权/删除/跨成员/角色与 session 变化，真实窗口 blur/真 hidden/pagehide/卸载与 late callbacks，父子同步清除。
- 验证取消/noop 零 PATCH；原 save 丢回复仍恰好一次 PATCH，经原显式读/ACK 恢复；旧历史/导出引用和 restore lock 不变。无章节写 API、schema 或新审计 owner。
- 原文档/恢复/导出回归、适用完整 types/build/lint 与治理、注册 `verify:task`、真实 I 依赖和任务原名精确提交均由 root 执行。

当前仅离线 AntD SSR + 合成 lifecycle listener 接线测试，未声称布局实际量测或 native 通过。Panel 复用原 adminTheme、AntD、section/h3/h4、换行 pre 与 auto-fit minmax；原父 PageHeading 保留，未重新设计或新增字体/依赖。
