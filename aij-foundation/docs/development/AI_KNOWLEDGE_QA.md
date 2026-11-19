# AIJ 企业知识问答能力契约（合成数据阶段）

## Owner 与信任边界

- `apps/api/src/plugins/aij-ai` 是知识文档、检索、问答结果及后续 AI 执行的唯一 owner。
- `apps/api/src/client-workspaces` 继续验证客户会话、Workspace 成员关系、Workspace 状态和角色权限；服务端从认证会话及 `x-aij-workspace-id` 解析上下文，不信任请求体或答案自报的租户标识。
- `apps/api/src/async-runtime` 继续拥有持久任务、尝试和重试；`SecretRefPort`/SecretCenter 继续拥有凭据解析；`AiExecutionTraceService` 继续拥有 AI trace/cost 真值。此契约不引入并行队列、SecretStore 或成本账本。
- 自动验证仅可使用本库合成知识、隔离测试数据库及离线 Provider。不得提交真实客户内容、调用真实 DeepSeek 或产生付费请求。

## AF-108 已建立的 API

- `POST /api/client/ai/knowledge/documents`：必须有有效客户会话、活动 Workspace 成员身份、`workspace.knowledge.manage` 权限和同源写入请求。服务端从认证上下文取得成员与 Workspace。
- `GET /api/client/ai/knowledge/documents`：按 `workspace.knowledge.manage` 授权，支持 `page`、`pageSize` 和 `status=active|inactive|all`（默认 active）。这是受管理权限保护的管理 API，返回该 Workspace 的文档正文以供编辑；普通知识查询权限不包含此读取能力。
- `PATCH /api/client/ai/knowledge/documents/:id`：按 `workspace.knowledge.manage` 授权，允许更新标题/正文、将状态切换为 `inactive` 停用或 `active` 恢复；请求必须携带服务端上一版本返回的 `expectedUpdatedAt`。版本不匹配返回统一的 409 冲突，不覆盖新版本；正文或标题不能单独用于枚举其他 Workspace 资源。
- 更新成功和状态变化与 AuditLog 同事务落库。审计记录只包含 Workspace、操作者、文档 ID、状态和更新时间版本，不含标题、正文、密码、Token 或 SecretRef。
- 检索与问答只查询 `status=active` 且未删除的文档；停用后新检索不再返回其引用，证据不足的后续问题拒答。恢复后可重新检索。历史已完成问答及其快照不被本卡回写。
- 文档码在同一 Workspace 唯一；跨 Workspace 使用相同文档码相互独立。数据库外键对 Workspace 和作者均使用 `RESTRICT`。
- 创建审计只记录合成请求关联信息、文档 ID 和状态，不记录正文、密码或令牌。
- 请求正文不能自报 `workspaceId`；额外字段由 DTO 白名单拒绝。匿名、非授权角色、无成员关系和跨 Workspace 请求均拒绝。

## 后续卡的边界

- AF-109 提供 `POST /api/client/ai/knowledge/query` 的确定性检索结果，不调用 Provider 生成答案。只检索经 Workspace Guard 验证的当前活动 Workspace 文档；请求体不能自报 Workspace。检索候选严格限定 `workspaceId`、`status=active`、`deletedAt=null`，成员须有 `workspace.knowledge.query`。
- 离线检索以 NFKC 小写词项匹配：汉字连续串拆相邻双字词项，其他文字按 Unicode 字母/数字词项。单份文档必须命中至少 2 个不同词项且覆盖问题词项至少 50%，否则结果为 `REFUSED / INSUFFICIENT_EVIDENCE` 且无引用。最多检索 500 个候选、返回最多 5 个引用；引用只含命中文档 ID/代码/标题和最多 400 字符的原文片段，不拼接模型答案。该阈值是本地合成评测的透明启发式，不代表 90% G19 端到端答案评分已经完成。
- AF-109 不保存问题/查询历史，不写成本或模型 Trace。AsyncRuntime、SecretRef 和 AiExecutionTraceService 在本卡不触发；后续执行卡仍须复用各自唯一 owner。
- AF-110 提供 `POST /api/client/ai/knowledge/questions` 与 `GET /api/client/ai/knowledge/questions/:id`。请求与轮询都要求当前认证成员的 `workspace.knowledge.query` 权限；Workspace 只从服务端守卫上下文取得，跨 Workspace 轮询返回不可用。提交使用 workspace 范围的幂等键，冲突查询返回 409。
- 证据不足时，问答记录以 `refused / INSUFFICIENT_EVIDENCE` 持久化，不创建 AsyncRuntime 任务或 AI Trace。证据充分时，先验证现有插件、能力、配置、预算和 SecretRef，再以 question ID 为唯一任务 payload 交给 AsyncRuntime；工作进程重新读取该 Workspace 的活动知识并复核成员关系。答案仅保存在 aij-ai 问答记录，引用由服务端检索生成；Runtime 结果只存问答引用，Trace 继续使用既有形状化、去敏输入和成本来源。
- 仅在 `NODE_ENV=test`、`APP_ENV=test` 且显式 `AIJ_TEST_AI_PROVIDER_MODE=offline-knowledge` 同时满足时注册合成离线 Provider 与零外部费用 admission。其余环境没有该 Provider，当前真实 DeepSeek Provider、许可、凭据和付费调用仍未接入/未授权。自动验证不得发送真实客户数据、调用真实 DeepSeek 或产生付费请求。
- AF-111 使用 20 个合成样例执行阈值回归。G19-00 的阈值为回答评分至少 90%、无依据问题拒答 100%、跨 Workspace 隔离 100%。
- AF-111 的当前离线回归采用 18 个有答案标记/唯一来源的可回答样例和 2 个仅存在于另一 Workspace 的不可回答问题。每个样例都经实际客户端认证、知识 API、AsyncRuntime 与独立 test PostgreSQL；答案计分要求同时匹配预设答案标记和预期服务端引用。测试同时断言匿名 401、跨 Workspace 写入 403、正文伪造 workspace 400、跨 Workspace 轮询 404。实际结果为 18/18 回答通过（100%）、2/2 无依据拒答（100%）、20 例引用无跨 Workspace 泄露，20 条问答/18 条完成任务/18 条离线 Trace 持久化；离线 Trace 不产生费用记录。该结果只证明本地合成 Provider 契约与 workspace 边界，不证明 DeepSeek 已接入。
- 真实客户字段清单、未来外部 Provider 可发送字段及其脱敏、外部数据处理授权与生产成本周期仍需负责人决策；不得由本契约推断。下文的 7 天期限仅为 AiKnowledgeQuestion 决策，不推导其他记录的保留期。

## AF-115 问答正文保留与清理

- 每条 `AiKnowledgeQuestion` 的 `query`、`answer`、`citations` 均按 `createdAt + 7 days` 到期，包括本卡之前已存在的记录；在到期时刻（`now >= createdAt + 7 days`）问答读取及相同幂等键重放返回通用 HTTP 410，不返回问答正文。Workspace 鉴权先于记录读取，匿名访问仍返回 401，其他 Workspace 仍无法枚举问答。
- aij-ai 读取时独立按 `createdAt` 判定时限；AsyncRuntime 每小时调度清理任务。清理将 query 置为空字符串、answer/citations 清空，并写 `contentPurgedAt`；question 状态、workspace/member、幂等哈希、traceId、runtimeJob 关联及创建时间保留。createdAt 索引供历史记录扫描，任务可安全重试。
- 定时器/清理任务不可用或失败不会延长可读取期限；读取层不依赖清理成功。已经过期但尚未清理的历史记录照样返回 410。仅本卡隔离测试库使用合成数据及本机 HTTP，清理验证不配置任何 Provider，不调用 DeepSeek 或其他外部服务。
- 本策略只约束 AiKnowledgeQuestion 的问答正文，不修改单独 owner 管理的知识文档、审计、RuntimeJob 或 AiExecutionTrace 保留期。

## 客户 Web 页面（AF-113 / AF-114）

- AF-113 的 `/client/knowledge` 通过唯一的 `client-knowledge-api.ts` 消费现有文档管理 API，提供纯文本新增、分页、编辑、停用和恢复；没有文件导入。管理入口按 `workspace.knowledge.manage` 显示，但后端仍负责每次请求的认证、成员关系和权限校验。
- AF-114 的 `/client/knowledge/questions` 通过唯一问答适配层提交问题并轮询既有异步问答端点。页面展示等待/运行、答案和服务端引用、依据不足拒答及通用失败提示；不显示内部 failure code，不把 `workspaceId` 放进请求体。Workspace 选择仅来自该客户账号的成员列表，服务端仍以认证会话、成员关系和 `workspace.knowledge.query` 重验请求上下文。
- AF-114 的自动验证只使用 test PostgreSQL、合成 Workspace/文档和仅在 test 环境启用的 `offline-knowledge` Provider；不调用真实 DeepSeek、不发送客户数据、不产生付费请求。浏览器人工验收不由 Web 构建或 API consumer 测试替代。

## 独立评测记录（AF-118）

管理权限可 POST `/api/client/ai/knowledge/evaluations`，参数仅 `questionId/runKey/caseKey`；服务端从当前 Workspace 的真实终态问答生成脱敏快照，禁止客户端声明答案/成绩。GET `/evaluations/:id` 需同空间知识管理权限。七天起点沿用源问题 createdAt；清理失败仍返回通用410。`aij-ai.evaluation-expiry-cleanup` 每小时经既有 AsyncRuntime 清理正文并保留元数据；不改变 Trace/Provider Cost 的留存。

## 文件导入（AF-119）

知识库页面可导入 UTF-8 `.txt/.md`，最大50KB。multipart `/documents/import` 只接受 file/documentCode/title，Workspace 从认证上下文取值。原文件不落盘，保存为 Workspace 知识快照及来源显示名/SHA256；不改变成员私有 FileAsset。快照通过既有编辑、停用/恢复管理；停用排除新检索，恢复重新参与，源文件没有服务端删除联动。PDF/DOCX/OCR 不在首期支持范围。
