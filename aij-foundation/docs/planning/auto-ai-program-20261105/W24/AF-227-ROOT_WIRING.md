# AF-227 root 接线说明（候选，未接线）

本候选仅新增纯 selector/ref/source helper、18 项离线单元和 DDL 建议。事务源门、DI、正式 Prisma schema/migration、运行时和真实数据库验收均由 root 完成；本候选不是 CODE_VERIFIED。依据为完整 W24 CONTRACT 与 `165338eb41eca99d3b779964a7e9f73f402a0d23` 的冻结源码；没有读取 root live 源码或真实环境。

## 已交付的纯函数

`apps/api/src/documents/personal-document-run-source.ts` 导出：

```ts
parseDocumentSectionSelector(raw: unknown): DocumentSectionSelector
parseDocumentSectionRef(raw: unknown): DocumentSectionRef
buildPersonalDocumentRunSource(raw: unknown, rawSelector: unknown):
  Readonly<{ ref: DocumentSectionRef; text: string }>
```

builder 的第一个参数精确为 `{id,revision,body}`，不要传含 code/name/timestamp 的整个数据库行。它直接复用 W23 `buildPersonalDocumentSectionIndex` 和原 `documentObject/documentId/documentRevision`，没有另写解析器；返回完整原始 slice，包括标题、空白和换行，不 trim、不 Unicode 归一化、不截断。ref 与外层返回值均为新的冻结对象；解析 ref 只证明结构，不能替代从已授权当前原文重算。合法 selector 与当前 documentId/revision/bodyhash/section 不同为 409，空/blank/超过 2000 UTF16 的所选 slice 为 400；不存在、外属和删除须由原 owner 先返回 404。

## 原文档 owner 内的接线

只在原 `PersonalDocumentsService` 做内部重构。保留原 `scope` 对外 CRUD 的事务包装和错误映射，抽取可接收调用者 `Prisma.TransactionClient` 的 `scopeInTransaction`，复用其原 project/plugin/成员/角色/有效 grant SQL、文档命名空间锁和 `owned` 行锁。不要复制一套授权查询或先调用 `get` 再开事务；`withCurrentDocument` 会额外要求 documents.export，不能拿来承载此源门。

按冻结契约提供内部方法：

```ts
resolveGenerationSourceInTransaction(
  tx, scope: {projectId: string; workspaceId: string; memberId: string},
  selector, purpose: 'read' | 'execute', authorize: (tx) => Promise<void>
): Promise<{projectId: string; ref: DocumentSectionRef; text: string}>

inspectGenerationSourceInTransaction(
  tx, scope: {projectId: string; workspaceId: string; memberId: string},
  selector, authorize: (tx) => Promise<void>
): Promise<{projectId: string; documentCurrent: boolean}>
```

scope 只由服务端当前上下文构造，projectId 必须与原 project resolver 在同 tx 的结果一致。purpose 除 read/execute 外拒绝，authorize 必需且必须在同一个 tx 实际执行，不能有空回调或缺省成功。

锁与校验次序：原 project/plugin/current membership/permission → `personal-documents:<workspace>:<member>` 命名空间锁 → 当前 owned 文档 `FOR UPDATE` → `await authorize(tx)` → 原 Memory/Agent → 原预算。已持有运行锁时保持原 Job → Run 先行；后续不得再按 Agent → Document 倒序锁。

所有新读须当前 documents.read、ai.read、ai.assets.read；execute 再要求 documents.manage、ai.execute。read/inspect 不要求 documents.export 或 documents.manage；原 Agent/model/Skill/Memory 的当前权限与发布检查仍在原 owner。authorize 应调用 `ClientAuthService.assertSessionInTransaction(tx, claims)`，沿原 namespace、member.token_version、session 状态与真实 `clock_timestamp()` 锁后复检；提交执行用原提交 claims，新读/查回用本次请求的新 claims。

resolve 在上述当前源门及 session 通过后，调用 builder，返回原 projectId 与 ref/text。inspect 也先做当前 read 权限、owned 非删除文档锁和新 session，然后比较 selector 的文档/revision/当前 body UTF8 hash：变更仅返回 false，不输出正文，不拿旧 selector 去对已变化的新 body 跑 builder（例如新 body 有超长章节或无效标题，也不能把旧来源变更误报为 400）。完整仍匹配时才验证当前 index/section 的可用性；不吞掉失权、无会话、外属或删除拒绝。

`PersonalDocumentsModule` 只向原 AI 组合导出该 service，不依赖 AI 模块。AF228 的薄 adapter 将其 resolve/inspect 分别绑定冻结 `DocumentSourceRuntimePort.resolveInTransaction/inspectInTransaction`；session port 使用原 ClientAuthService 的 useExisting。此候选没有 AF228/AF229 文件依赖。

## 持久来源与真实 schema 映射

`AF-227-ORIGIN_SCHEMA.sql` 是未执行的建议，root 审查后登记一个 additive migration 及 `AiPersonalDocumentRunOrigin`；不能直接把建议文件当已落库证据。映射已对照冻结 `schema.prisma` 与原 workflow-origin/document migrations：

| 原模型 / 实表 | 引用键与实际类型 |
| --- | --- |
| AiAgentRun / ai_agent_run | `(id,project_id,workspace_id,member_id)`，均 text；已有 ai_run_origin_scope_uq |
| PersonalDocument / personal_document | `(id,workspace_id,member_id)`；id uuid，其余 text；已有 personal_document_scope_key |
| PersonalDocumentVersion / personal_document_version | `(document_id,revision)`；uuid + int；已有 personal_document_version_revision_key |
| AiPersonalAgentVersion / ai_personal_agent_version | `(id,agent_id,workspace_id,member_id,revision)`；text + int；已有 ai_personal_agent_version_publication_key |
| ClientAuthSession / client_auth_session | `(id,member_id)`，text；已有 client_session_origin_member_uq；token_version 实际位于 member_user |

DocVersion 的 scope 由同一全局 document_id 的文档复合 FK 和原不可变版本 FK 约束闭合，不虚构 document_version.project_id 或尚不存在的复合 UNIQUE。所有新 FK 均 RESTRICT；不重建已有唯一键。ref 的 JSON 身份字段用精确键集合和 `IS TRUE` CHECK，避免缺键/JSON null 以 SQL UNKNOWN 通过。原 Run.snapshot.source.documentOrigin 必须与完整 GenerationRef 相等，personal Agent provenance/Run/catalog/model 身份与已存恰好两字段的 redacted input digest 一致，workflow marker 或 workflow durable relation 混入拒绝。

inputSha256 的 PG 表达式按固定 instruction/source 顺序构造无空格的 JSON pair-array，再以 UTF8 SHA256 计算；不能用 `jsonb::text` 替代 JS JSON.stringify。SQL 使用原项目已采用的内置 sha256，不引入 pgcrypto。root 必须实际验证引号、反斜线、CRLF、emoji、组合字符、控制转义及服务端 UTF8 编码的 JS/PG 一致性。instructionSha256 是 raw instruction 的 hash，不能从 redacted input 反推；整个 ref 的当前来源和费用仍在原 admission tx 重算。

更新/删除/截断按原 workflow origin 模式以 55000 拒绝。insert trigger 只查看已存在原 Run，不倒序重新获取 Document/Agent/session；真正当前授权仍由同 tx 原源门提供。建议 DDL 还新增一个原 workflow-origin 表的配套插入 guard（不替换原函数）：两种来源插入先对同一原 Run 行取 FOR UPDATE，再检查另一关系，避免先文档后 workflow 或两连接并发产生混合关系；这项跨 owner 的 additive DDL 同样须 root 审查并真实验证。关系不另存正文、raw instruction、输出、费用执行账本、provider 状态或 session 真值。原七天 purge 清理 Run.input/output/snapshot 后保留该关系；generic run/key/image 必须按 marker **或** durable relation 拒绝回退 legacy。

## root 必须补齐的真实证据

1. 在受保护 55433 新逻辑验收库串行登记/执行 additive migration，核对全部复合 FK、跨 scope/orphan/错 revision/错 AgentVersion/错 session 拒绝，以及 update/delete/truncate 的 55000；逐项记录真实 SQLSTATE 和 rollback。
2. 原调用者 TX 中 resolve/inspect 无嵌套事务，authorize 收到同一 tx，故障抛出后原写入整体 rollback；权限/会话失败不得返回正文。包括并发 project/plugin/成员/role/grant/revision/删除/撤销，验证锁等待后的当前拒绝。
3. read 有 documents.read/ai.read/ai.assets.read 且没有 export/manage 时成功，execute 缺 manage 或 ai.execute 时拒绝；旧 CRUD/history/export 按原行为回归。
4. 真实来源含标题/CRLF/emoji 恰好 2000 UTF16 成功，2001 和空/blank 拒绝且无截断；body 其他节变化也使旧 selector 冲突。inspect 用新会话，仅来源变化返回 false，不返回 text。
5. Run snapshot marker、ref、Agent/model/catalog/费用、inputSha256 任意不一致及混合 workflow 均拒绝；purge 后关系保留，不能误认 legacy。此项涉及 AF228 原运行时接线，不能用此纯单元声明 Runtime 通过。
6. 运行本卡注册的 verify:task 与适用质量门禁，记录真实命令、exit、失败和 NOT_RUN；正式通过后 root 按中文原标题提交并回读 SHA，才可完成 I227。下游引用真实 I227 Task ID；候选 Task 不能替代。

本候选未启动 HTTP/Web/DB/provider，访问地址为无。人工验收入口与地址由 root 在实际接线运行后给出；页面生成预览/确认写回在后批，不属本次候选。
