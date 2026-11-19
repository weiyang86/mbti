# AF-203 root wiring request — candidate only

本文件只说明接线需求。Worker 未改 manager/library/access/SDK index、全局依赖、registry、队列、状态、schema/module；没有数据库、Docker、server、浏览器或 Next 构建验收。候选不等于 CODE_VERIFIED，外部厂商 DEFERRED_NOT_PASSED，真实账号/密钥留空。

## I202 完成后的契约修正（task_95021283b017）

按 root 已完成的 I202 `task_f22906679b97` / AF-202 `run-fZysq0`（PASS 2+12）/ 提交 `2ee9172a30be7694dc2cb097a43fbce1f0a14e65`，本轮只读实际 SDK 与 API service 后修正原 a229 候选的真实契约误配，而非把原错误 fixtures 视为通过证据。

- 真实 DOCX `pageCount=null`；PDF `pageCount` 整数1..100；rendererVersion 固定 `aij-plain-document-v1`。状态验证、声明 `number|null` 与 UI 同步修正，Word不显示“null页”或虚构页数，PDF显示实际页数。
- `ready` 必须 configured=true/canExport=true；`not_configured` 必须 configured=false/canExport=false；`not_permitted` 必须 canExport=false，configured任意布尔。canExport是生成就绪状态，不是独立权限真值。
- 已保存、无草稿、read+export、非busy/非suspended 且已知 capability reason=ready 或 not_configured 才能读取/下载。生成另外要求 configured=true/canExport=true/ready 且无unknown/conflict。not_permitted禁止全部导出操作，不因configured=false而放宽权限。
- 原21组测试意图全部保留，修正旧错误配置/renderer/pages fixtures；补充真实DOCX创建/列表/下载、页数边界/错误renderer拒绝、实际待配置三元组下两格式已有文件可读可下载但不POST。修复前24组18过6失败（exit1），修复后24/24 exit0；纯协作者不是HTTP/browser证据。
- 本轮只读源SHA256：`packages/sdk/src/personal-document-exports.ts` = `3c1a2b78b598812fe0ac6bf431a55c4905b5faeb2cb4f09e7ba54fbe97fe3655`；`apps/api/src/documents/personal-document-exports.service.ts` = `67f6f1771b71058ea2b0324053794ab969bf6e8d8da4b03be489ae5030729342`。未复制或修改root源码。

原声明ESLint parser pairing故障仍由root修复，本轮没有抑制规则或改共享配置。正式真实门禁与预览/native/browser仍由root完成，候选不是CODE_VERIFIED。

## 顺序与实际宿主

总控必须先完成真实 I201，再完成真实 I202，随后集成此候选并执行 I203。只 cherry-pick 候选提交，不集成 source-only bootstrap。导出 UI 注入真实 `createPersonalDocumentExportsClient(guardedClientApi)`，用 AF202 公共 SDK 的严格 shape、响应 header、流上限和 WebCrypto 全字节校验实现；不能用本文件的 structural port 构造假 SDK 作为成功证据。

`ClientDocumentExportPanel` 从 `apps/web/app/components/client-document-export-panel.tsx` 导出，props 固定为：

```tsx
<ClientDocumentExportPanel
  scope={state.scope}
  document={state.detail ? {
    id: state.detail.id, revision: state.detail.revision, name: state.detail.name
  } : null}
  hasUnsavedChanges={!!state.detail && (
    state.name !== state.detail.name || state.body !== state.detail.body
  )}
  api={actualGuardedExportsClient}
  onAccessFailure={handleAccessFailure}
/>
```

放在原 manager 的当前文档详情内，传当前已保存详情的 revision，不传历史 revision 或草稿的推测 revision。未保存新文档必须 document=null；原编号不可编辑，不需要把编号纳入已保存文档 dirty 判断。父级原保存/历史/删除/草稿 owner 不变；root 同时更新原界面“Word、PDF 后续提供”的旧说明以反映实际接入状态。

`DocumentExportsPort / ExportMeta / ExportCapability / ExportDocument / ExportFormat` 从面板重导出，声明文件是 `.d.mts`。capability(workspaceId) 没有 signal 参数，与固定契约一致：此 GET 会被 generation fencing 丢弃，控制器在 30 秒结束等待；无法要求不接收 signal 的 SDK 方法物理取消 transport。create/list/get/download 的 options.signal 都遵守固定契约。新状态机没有另一套 fetch 或凭据策略。

## 当前范围与焦点恢复

必须复用原 createDocumentAccess 的 guarded ClientApi 前后读取当前成员、空间、role/session/permission、项目/组织/aij-ai 生命周期，GET/POST/binary 都经同一个 guard；不直接给 panel 未守卫的 raw api。为原 access 加入 export SDK 的接线归总控，保留原 personal-documents API 的拒绝路径。要使用 AF202 要求的原单一 binary transport 与有界生成 signal，不能另起 fetch。

传 `state.scope`（manager 当前已验证 scope），不要永远传 library 中不随 manager conceal/revalidate 清空的旧 scope。面板监听 blur/pagehide/真实 hidden，立即清 metadata、notice、capability、reconciliation acknowledgement、ObjectURL 并 abort；focus 不自行启用旧 scope，也不 POST。恢复要求父级先发布 null，再在真实验证完成后发布 verified scope；或者原 guard 支持且实际验证了新的 validationKey。原 baseline validationKey 是 role+permissions，并非递增 nonce，不能仅为了恢复 UI 编造 key 破坏 guard 的 same(scope) 校验。重新渲染相同 scope/document/revision 不会解除 suspended。

父级进行“重新验证访问/重读当前文档”时，必须清空传给导出面板的 scope/document，验证与读取成功后重新传入，确保相同 revision 的 BUSY409 也能在明确重读/合并后恢复。409 不改草稿，不由 list 或 unknown ACK 清除冲突锁；revision 实际变化或明确的父级清空→重读周期可解除。不同 revision/document/scope/dirty 状态变化全部使旧返回失效。

未知 POST 的最小 recovery lock 在此 mounted store 内保留，切 scope、dirty、clear、API 实例替换不会默默解锁；新 context 需主动 list 当前版本，再单独 ACK。Panel 保持稳定 mounted identity，不以 revision/scope 给组件加 React key，也不要在 blur、切 scope、权限状态变化时卸载后重建来绕过 unknown 锁；传 null 清数据。正常离开页面会卸载并清 RAM，没有 local/sessionStorage、URL、日志或跨会话持久化恢复账本；返回页面依赖原服务端幂等唯一性并应先主动读取已有导出。若宿主需要跨页面保留未知锁，应由原文档访问 owner 安排稳定宿主，不新增独立执行账本。

## 行为与界限

- 权限必须 read+export；manage 不隐式授权。capability 待配置禁止生成，具备权限仍可读取和下载已有导出。
- 未保存修改禁止生成/读取/下载；capability GET 不导出正文。配置/权限/未保存/unknown/busy 状态皆以中文展示。
- 生成只显式动作；create 120秒、其他有 signal 的读操作30秒。生成超时、网络/5xx、坏 success、失焦中断都 unknown，不重发 POST。SDK 默认8秒不得吞掉 panel 提供的长 signal。
- 401/403/404 清 panel 并调用 onAccessFailure；父级必须真正失效当前访问。400 明确拒绝；409 提示重读合并；其他错误不显示 server message/path/body/stderr。
- list 只接受当前 document/revision、最多两个不同格式。有效读取（包括空列表）后才允许单独 ACK；读取失败或再次 conceal 会使 ACK 失效。
- download 只能选择已读取/生成的当前 meta。SDK 实际校验 HTTP/字节/hash 后，panel 再核对长度/MIME/checksum/安全文件名；不持久保留 filename/bytes。浏览器 Blob 拷贝后在 finally 清零 SDK buffer、移除 link、revoke URL；晚到或超时 binary 也清零。
- 浏览器 host 实际调用 Blob/URL/anchor，只是实现，不是已完成浏览器验收的证据。没有声称 OS 保存对话框通过。

## 质量门禁与工具诊断

原候选21组、本轮修正后24组 Node 纯状态协作者测试通过，涵盖成功/拒绝、unknown read+ack、并发锁、scope迟到、失焦、超时、API更换、URL清理、bytes清零。协作者不是 PG/Docker/browser。

`pnpm exec eslint` 对运行时 panel/state/test 通过。仓库现有组合配置对 Web `.d.mts` 同时应用 typescript-eslint 与 Next TypeScript parser/plugin，默认 lint 声明文件会报 `TypeError: node.params is not iterable`，exit2；尝试将方法声明改为函数属性仍复现。未改全局配置或关闭规则。声明文件经单独匹配的 `typescript-eslint.parser/plugin` 的 no-unused-vars 检查通过，且实际 panel 的 strict tsc（包括该声明）通过。root 请在原 ESLint `scopedTypeScript` 中将 `.mts` 纳入与 `.ts/.tsx` 一致的解析器排除范围，再运行正式 lint；此项原始 exit2 必须保留，不能当作全仓 lint 已通过。

root 必须运行注册 verify:task、适用质量门禁、实际安装实包消费者与生产 Next 构建、真实登录/CSRF/PG/私有二进制、桌面/390px/键盘、撤权/旧scope/blur/hidden/迟到/unknown恢复/URL清理。实际浏览器确认点击下载与文件真实内容；未观察 OS 保存对话框则保持 NOT_RUN。保留完整40、AI章节/图表、AF191原生14与负责人接收边界，不替代验收。
