# AF-228 root 接线交接

本候选只提供可注入来源服务、纯 helper 与 27 项离线单元；**Candidate，非 CODE_VERIFIED，未真正接入 runtime**。依据 root 只读 W24/CONTRACT.md；源码依据冻结提交 `165338eb41eca99d3b779964a7e9f73f402a0d23`。root 集成顺序 I227 → I228 → I229，不能引用其他候选未集成文件或据离线 collaborator 宣称 PG/session/provider 真通过。

## 1. 组合与端口

新增文件 `apps/api/src/plugins/aij-ai/ai-personal-document-run-origin.service.ts` 独立声明三个 abstract DI token：

- `DocumentSourceRuntimePort`：root 薄 adapter 把 `resolveInTransaction(tx,scope,selector,purpose,authorize)` 转发到 I227 原 PersonalDocumentsService 的 `resolveGenerationSourceInTransaction`；把 `inspectInTransaction(tx,scope,selector,authorize)` 转发到原 `inspectGenerationSourceInTransaction`。不得另开事务、GET 再开 TX、复制权限 SQL、使用含 documents.export 的旧 withCurrentDocument。adapter 返回精确普通数据对象，不夹带原文档行额外字段。
- `DocumentGenerationSessionPort`：`{ provide: DocumentGenerationSessionPort, useExisting: ClientAuthService }`，调用原 `assertSessionInTransaction` 的真时钟与锁，不能替换为缓存/session claims 自证。
- `PersonalDocumentRunOriginPort`：`{ provide: PersonalDocumentRunOriginPort, useExisting: AiPersonalDocumentRunOriginService }`，注册实际 service。端口方法/结构见候选源；不要复制实现到原 Run owner。

原 PersonalAgentProvenance 加 `documentOrigin?: DocumentGenerationRef`（type-only import）；原 AiCenterRunService constructor **在末尾**追加可选 port，保留旧构造参数位置。只删 `documentOrigin` 的 helper 为 `withoutDocumentGenerationMarker(snapshot, verifiedRef)`，保留 memoryRefs/其他未知 source 与顶层字段供原 owner 逐项 deep comparison；该 helper 本身不代替当前来源授权。

服务 `resolveSource` 要求 source adapter 在原文档锁后、返回之前实际 await 必需 authorize，回调传入的 TX 必须与外层相同，且恰好调用一次。漏调/异 TX/重复/未完成或缺 port 均 fail closed，缺 port 503；session 拒绝继续向上抛出。返回引用重新创建并 freeze，source 原文仅短 TX 内存。

## 2. admission 与幂等

四个原 owner 新方法签名统一为 `(memberId:string,workspaceId:string,bodyOrId:unknown,claims:ClientClaims,correlationId?:string)`：`previewDocumentGeneration`、`submitDocumentGeneration`、`readDocumentGeneration`、`recoverDocumentGeneration`。API/SDK 的 driver 由 root useExisting 原 AiCenterRunService，不能创建第二执行器。

1. scope 只由服务器原 project/plugin/membership/permissions 得到。新读统一 documents.read + ai.read + ai.assets.read；新执行再要求 documents.manage + ai.execute。保留原 Agent/Skill/Memory/模型发布与权限检查，read 不能因复用旧 helper 而附带 documents.export/manage。
2. 同 TX 顺序：project/plugin/current membership/permissions → 原文档命名空间锁 → 原文档行 FOR UPDATE → 原 ClientAuthSession callback → 原 Memory → Agent/Skill/model/catalog → 原 budget。preview 用 read 源门，无 Run/Job/reserve/Trace/provider 写。不要调用一个先锁 Agent 再取文档的旧 preview 包装。
3. submit 在原 `submitSource` admission TX 内 `resolveSource(...,'execute')`，原 Memory/snapshot owner 解析当前发布 Agent，原 budget.estimate 得最大费用，再 `makeDocumentGenerationOrigin(resolved,snapshot,rawInstruction,estimate.toString(),catalogVersion)`。与客户端 body.origin **完整全等**（包括费用）后才能继续；preview ref 不是授权凭证。
4. 新请求 hash 为 `documentGenerationRequestHash(ref,rawInstruction)`，不使用 redacted instruction 或旧 personal/workflow key 域。完整 ref 与 document 均固定键顺序；相同脱敏值、不同 raw 指令仍冲突。幂等锁和唯一域仍为原项目/工作区/成员/key。
5. 原 submit 一次 redaction 保存恰好 `{source,instruction}`；helper 返回 raw 两字段，不能再次保存 raw 指令/原章节副本。新 snapshot 加合法 source.documentOrigin；原 Run/Job/reserve 各创建一次，再同 TX `recordOrigin(tx,run,ref,claims)`。本服务仅 INSERT 新来源关系与小 audit，不自己创建 Run/Job/成本状态。
6. record 还要求本 service 实例已对**同 TX、scope、原文档 ref、session**成功调用 execute 源门；只调用 read 源门、换 TX 或换 claims 不足以入关系。WeakMap 只保存源门证据与脱敏 source 的哈希，不是执行账本。不要把 `recordOrigin` 搬到外层另一个事务。
7. 已有 key 重试仍核验本次 fresh session/当前 doc/ref/Agent/Memory/model，并检查来源 row+marker/requestHash；只返回原 Run，不再次 reserve/enqueue。插关系/audit 任一步失败须让原 TX 全回滚，不吞错、不补偿建第二次 Run。

## 3. dispatch、IO 前后与读

- 原 `validateSnapshot` 在 Memory/Agent 当前检查**之前**调用 `assertOriginCurrent(tx,run)`。它按 run ID 先查持久关系，随后检查 scope、身份、ref、marker、redacted input digest；双缺 legacy noop、单缺拒绝。不会锁 Agent。
- 调度、真实 IO 前和 IO 后都必须经过原 Job → Run → Doc → session → Memory/Agent 顺序，并保留原 nonce/lease/凭据检查；执行使用 row.session_id/token_version。源正文重新由原 owner 解析，ref 的 raw slice SHA/UTF16 长度与 redacted source 均需一致；stored instruction 只校验 redacted digest，不能反推 raw instruction。
- `withoutDocumentGenerationMarker` 只在来源已验证后删除此已知扩展；原 memoryRefs 仍由原 Memory owner 重验/删除，其他未知扩展继续使原 snapshot deep comparison 失败。
- 未尝试 upstream 的拒绝走原 failed/release；已尝试后 source/session/nonce 改变走原 unknown/reserved 并拒绝结果，禁止 provider 重放或自动 HTTP retry。
- 新 full read 在原 internal read/reconcile 的前后分别于当前授权 TX 调 `assertOriginCurrent(tx,run,freshClaims)`，使用此次请求 session 和 read 源门；并核对原 Agent/Memory/catalog/model 当前状态。原 terminal succeeded 不能跳过。失权/来源变化不返回原文、output 或私有 snapshot。
- `inspectOrigin(tx,run,freshClaims)` 用原 inspect 源门和 fresh session，只返回 `{origin,documentCurrent}`。它不返回 source/model result，也不 reconcile、reserve、enqueue。documentCurrent=false 只说明当前源不再匹配，不能解释为允许读结果；read 权限或 session 失败仍拒绝。
- full read contentPurgedAt 非空/expired 410。metadata recover 仅按原 key 查原请求，允许真实有限 Date 的 contentPurgedAt + snapshot===null + input===null 时由持久 row 提供来源。清理半套、空 timestamp、剩余不一致 marker、跨 scope/Agent/catalog 身份均拒绝；不自动重新提交。

## 4. legacy 与 cleanup 必须同时接线

原 generic run/key/image 接口在输出/内部 read 之前，按 `marker OR durable row` 拒绝 document 来源。**不能只检查 marker，也不能因 port 缺失忽略 durable row**；root 在原 Prisma 查询持久关系存在性即可，不依赖新可选 port 正常注册。purge 后 marker 消失仍要拒绝。

原七天 cleanup 仍唯一 owner，清 input/output/snapshot、保留来源关系；不要 cascade 删除此新表、删除原 Run 或引入本服务的独立 retention 调度。

## 5. root 独写 DDL 建议与真实验证

候选 SQL 只依赖 `public.ai_personal_document_run_origin`，列：run_id text PK，project_id/workspace_id/member_id text，document_id uuid，document_revision int 1..200，agent_id/agent_version_id text，agent_revision int，ref jsonb 完整 GenerationRef，session_id text，token_version int>=0，created_at timestamptz 默认当前时间。

真实 FK 均 RESTRICT：Run `(id,project_id,workspace_id,member_id)`；Doc `(id,workspace_id,member_id)`；DocVersion `(document_id,revision)`；AgentVersion `(id,agent_id,workspace_id,member_id,revision)`；ClientAuthSession `(id,member_id)`。冻结 schema 已有这些被引用唯一键，root 需按真实 schema 核对。CHECK 保证 JSON 类型/format/各列与 ref 身份一致；INSERT trigger 验证已存在原 Run 的 source.documentOrigin、personal Agent provenance、run Agent/catalog 列及 redacted 两字段 input digest 精确一致，workflow 混合拒绝。UPDATE/DELETE/TRUNCATE 用 55000 拒绝。digest 输入必须与 JS `JSON.stringify([['instruction',redactedInstruction],['source',redactedSource]])` 的 UTF8 字节一致，不能拿带空格或重排键的 jsonb::text 充当相同 digest。

root 受保护 55433 逻辑测试库串行验证：

- FK 跨 scope/orphan、immutable/55000、来源行与 Run trigger、保留期 row 保持；真实 TX fault rollback，不能据离线 fake SQL 说已验证。
- 两连接/实例同 key 只一 Run/Job/reserve；本地可计数 loopback 原 provider 的唯一 Trace/cost/response。
- 排队来源/session 撤销无 upstream 且 release；IO 后来源/session/nonce 改变 unknown/reserved、拒绝结果；不发生重试调用。
- fresh session full read/recover、read 无 export/manage、legacy marker/row 单缺或 purge 后仍拒绝；未知 provenance 保留并由原 deep comparison 拒绝。
- 原 workflow/Agent/text/image/runtime 和文档 CRUD/history/export 回归，正式 verify:task 与适用质量门禁。

未启动 API/Web、DB、Docker/native 或付费 provider；没有可访问的新页面/服务 URL。原 3955/3956/55435 环境与既有数据未触碰，root 维护仍按 CONTRACT 的原 CLI/核验/保留规则执行。root 完成 I228 正式验证后才可给 I229 原 runtime driver；候选交付不改变 W23 OWNER_CHECK_PENDING 或人工接收状态。
