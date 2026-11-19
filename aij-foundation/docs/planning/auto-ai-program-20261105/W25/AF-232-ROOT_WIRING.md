# AF-232 总控接线说明

这是纯控制器候选的接线说明，不是正式 registry/队列或真实集成完成证据。契约以 root `W25/CONTRACT.md` 为准；没有依赖未来 sibling 文件。

## 实例与类型

从 `client-document-generation-state.mjs` 引入 `createDocumentGenerationController`，唯一 composition 中创建一次，直接把 controller 作为 `GenerationPanelView` 传给面板。参数精确为 `{scope, assets, api, journal, timeoutMs?, now?}`；额外方法为 `setContext(contextKey)`、`setBindings({scope,assets,api,journal})`、`dispose()`。完整结构在同名 `.d.mts`，沿 SDK 的原 ref/preview/run/recovery，不增加协议字段。

接口引用稳定，普通 render 不重建 controller/journal 或以 key/remount 清锁。`setBindings` 如任一端口引用改变，会同步清私有 state、取消旧 epoch 和旧 journal 订阅；root 随后必须明确 `setContext`。同 bindings 不清理。同 contextKey 且完整 auth/source 不变也不清理。getSnapshot/subscribe/setContext 只处理 RAM，不自动 `load`、list、inspect、preview、recover 或 read。

## scope

`peekAuth()` 给完整 `{memberId, workspaceId, roleId, roleCode, sessionGeneration, permissions, validationKey}`，sessionGeneration 映射原 DocumentScope.sessionKey；权限会排序比较但完整保留 validationKey。`peekSaved()` 返回 `{pin, document, index}` 或 null，pin 加 documentId/revision/bodySha256/sectionId/start/end/sectionSha256。contextKey 由 root 按完整 auth 和可用 source pin 或 null 构造；它只是同步失效标识，不能授权。

peekSaved 只认可原已保存完整章节；exclude 编辑/unsaved/忙/未知保存/conflict/history/delete、restore busy/confirmation/locked、export busy/unknown/conflict、sections 手工 replacement/comparison/confirmation。**generation 自己 busy 不能使自己的 source pin 失效**；它应屏蔽冲突的其他 mutation，而非让 verifySource 看见来源丢失。generation 不能改旧 save/restore/export 未知锁。

`verifySource(expected, mode, signal)` 通过原 guarded request 对真实 me/context/doc/index 前后验证，返回匹配的已解码 VerifiedSource。mode preview/read 要求 documents.read + ai.read + ai.assets.read，execute 加 documents.manage + ai.execute。controller 另核对完整快照、连续索引、正文 UTF8 SHA、slice SHA 和范围；source/instruction 上限按 UTF16。不要引入 SDK composeDraft 或客户端正文替代服务端 source。

`verifyRecovery(owner, signal)` 不要求旧 document revision/旧 session，返回**本次当前 auth**。允许没有 saved source、source 已变和执行配置关闭时显式恢复原 key 元数据，但不自动授权读正文。每次动作仍 pin 当前 auth/source/active，动作中变化即取消。

`onScopeRejected(status)` 在当前 ticket 的 401/403/404 才调用，status 原值，接原 handleAccessFailure；此回调必须同步清父和所有子 store（含 generation.setContext(null)/suspend）。controller 在回调前检查 ticket，回调后仅在同 epoch/bindings 时兜底清子，绝不覆盖回调创建的新 scope；旧 ticket 拒绝无回调、无状态更新。null context 无 issue/notice/Modal 泄漏。

原 blur（真实 hasFocus=false，hidden=false）、hidden、pagehide、卸载、storage event、source/role/session/permissions/context 变化要同步 `suspend()`；其清 RAM 并调用 journal.suspend，持久 entry 不删除。恢复可见/聚焦/挂载不自动请求。过期在 getSnapshot 和每个方法入口复检；若 root 加到期 timer，只能清 RAM，不轮询。

## assets 与 api

assets 精确签名：`list(owner, afterId|null, signal) -> {items: AgentChoice[], nextCursor:null|string}`；root 用原个人 Agent list，每次 limit=50，以 id 严格升序，nextCursor 为该页最后 id。controller 每次仅一页、显式 next、最多 20 页，拒绝重复/逆序/超量。list 不逐项 inspect，不 N+1。`inspect(owner,id,signal)` 仅由选择或明确预览/确认/提交调用，root 实查原 get/publications.get/runPreviews.preview，验证自有 enabled、已发布、dependencies ready、text/text、恰 source/instruction 输入；返回 `{agent:{id,revision,name},availability}`。

api 注入原公开 `createPersonalDocumentGenerationClient` 实例，经 guarded ClientApi 传播每次 signal，SDK 不支持 signal 的 asset API 用该次 ClientApi 闭包传播并在 root 校验 epoch。四个 generation 方法原签名均显式使用：preview(workspaceId, body, signal)、submit(workspaceId, body, signal)、recover(workspaceId, originalKey, signal)、read(workspaceId, originalRunId, signal)。控制器不 fetch、不建存储。

一次完整预览→确认→提交有三次独立 preview POST，各为原来源/原 Agent/revision/raw instruction 全 ref 核价；一次 generation submit POST 仅由 journal send 发出。报价任何版本/发布 epoch/catalog/model/input/source/费用变化清 quote 并要求重新明确预览，不采纳新值。预览不执行、不预留。成本 `maximumEstimatedCostNanos` 保留原字符串，仅内部估算，不是报价/扣费。

## journal 与结果

journal 必须是 AF231 提取后唯一原日志 owner 的同 bucket 实例；controller 只用契约 JournalPort，不 import 或复制 sibling。getSnapshot/subscribe 只读 RAM。submitOnce 原锁内先持久化 attempted 并读回，再至多调一次 send；成功在原 owner 内绑定 run id/status。controller 还检查返回和同 entry 一致，屏蔽 submit 输出，主动 read 才显示结果。两个 controller 并发仍由原持久 journal/Web Lock 保证唯一，不以本候选内存测试冒充真实锁验收。

recover 显式 load 后，verifyRecovery → SDK.recover 原 key → verifyRecovery → journal.bind 精确 entry；只取 metadata。origin/run 不匹配、404/410 不删 entry，documentCurrent=false 永远禁正文读。read 要当前 saved source 与 origin 一致、verifySource(read) 前后匹配；仅未到期 succeeded/settled 能显示 string <=64000。unknown/reserved 只允许原 key recover，read 按钮禁用。

ACK 只经 journal.acknowledgeTerminal，verify 回调中重新当前 verifyRecovery/SDK.recover/verifyRecovery，controller 拒绝非 succeeded/settled 或 failed/released。原日志 owner 仍须做完整 CAS/真实安全终态核验，其他 family/空间不得丢。未知、异常、失配或 404/410 不得靠“知道了”解锁；过期内容禁读，元数据安全终态仍按原契约判断。成功 ACK 清私有 quote/result，不写入文档。

## root 必须完成的证据

本候选已跑 76 个离线行为测试、定向 eslint、声明 isolated tsc，contracts/sdk 小包 build；实际 guarded API/Auth/PG/runtime/native/Next/页面均 NOT_RUN。root 在 I231 接收后引用其真实 ID，精确集成本卡五个文件（不集成 source-only bootstrap 整段），注册 verify:task 和适用门禁。

需要真实单次 Run/Job/reserve/Trace、preview 零执行/预留/上游、真正落库后丢响应只 GET 原 key、当前 read、source/Agent/session/权限拒绝、原文档零新版本，默认执行仍关闭。实际 journal/Web Locks 的双实例竞争/失败读写/CAS 由原 owner 验收。面板 desktop/390x844、真实 blur/hidden/链接卸载、held response、原 save/restore/export 未知锁和历史/导出字节回归由 root 执行。未做真实受保护刷新前不得称 3955 新 UI 已运行；预算不足保留 NOT_RUN 拆卡。
