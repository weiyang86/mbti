# 私有 Agent 执行（AF-161 候选）

本切片执行 AF-159 的用户私有 prompt Agent，只支持 TEXT/JSON 和产品模型预算。候选尚未接入生产模块，尚未进行数据库验收；API/Web 未启动，没有可访问地址。不新增表、Schema、成本真值或执行器，不包含工具、脚本、知识库、记忆、多 Agent、fallback、BYOK。

## API 与恢复

`POST /client/ai/personal-agents/:id/runs` 返回 202，JSON 严格限定为：

```json
{"input":{"text":"synthetic input"},"idempotencyKey":"private-request-0001","expectedRevision":2}
```

实际 input keys 必须等于该版本的 inputFields；最多 20 个字段，每值非空且最多 2000 字符，沿用 compileAgent 上下文预算检查及输入/输出脱敏。不能提交模型、provider、snapshot、source、成员、Workspace、脚本或工具参数；query 必须为空。要求客户会话、服务端 Workspace 上下文、`workspace.ai.execute` 和 `workspace.ai.assets.read`、精确同源 Origin、非 cross-site，以及既有 `AI_CENTER_CLIENT_EXECUTION_ENABLED=true`。no-store guard 在 Workspace guard 前运行；全局 AuthExceptionFilter 也覆盖错误响应。

调用 `createPersonalAgentRunsClient(api).submit(workspaceId, agentId, body)`；它只使用既有 ClientApi。读取调用既有 `createAiClient(api).read(workspaceId, runId)`；丢失提交响应时调用既有 `createAiRunRecoveryClient(api).recoverRequest(workspaceId, key)`。恢复不执行 reconciliation、不提交新 Job、不释放预算、不重发请求。普通 run read 的原有 owner reconciliation 和 retention 行为保留。unknown/reserved 是不确定结果，不是可自动重试或退款的证明。

同一原有 project/workspace/member/key 锁和复合唯一键覆盖目录与私有请求。私有 hash 命名空间为 `['personal-agent-v1', id, revision, canonicalInput]`，目录 hash 保持原格式；同 key 不同来源、版本或输入返回 409。精确 replay 返回既有 run，不产生新 Job/reserve/transport。运行与编译快照 code 使用服务端 `personal:<UUIDv4>`，冒号不属于既有目录 code regex，契约的 code 与数据库 agent_code 均为 String；不修改目录 policy 或 Schema。合法的目录 `p-UUID` 继续列出、提交和执行，目录 hash 完全保持原格式；目录快照不带 source，仍走目录校验。

## 可信快照与执行

AiPersonalAgentSnapshotsService 在调用者事务中锁定同 owner/workspace 的未删除 enabled Agent 及其当前 revision 的不可变版本，校验当前行与版本内容相等。只允许完全匹配 catalogVersion/modelRevision 的当前 enabled 产品文本 model/provider，不进行替代选择。绑定按 position 读取不可变 Skill version，并 JOIN 未删除的当前 Skill 行；Skill 后续版本不替换历史 instructions，删除则拒绝。绑定数量、连续 position 和唯一 Skill 校验不允许丢失或重复的依赖。

既有 JSON snapshot 增加可选的服务端 source：personal id/version/revision 以及 ordered Skill id/version/revision。来源永远不从请求接收。没有 source 的既有目录 snapshot 沿用目录验证。AiCenterProviderService/compileAgent、AiCenterBudgetService、AiAgentRun、RuntimeJob、AiExecutionTrace 仍为唯一执行/预算 owner。

同一 admission 事务先取得既有插件 lifecycle 锁、项目/组织/安装行锁、Workspace membership 锁、active 成员/角色/授权行锁、catalog 行锁，再处理 replay/可信依赖/compile/live/credential presence/reserve/enqueue/run。默认 maxAttempts=1，整个 admission 原子完成。

dispatch 在 credential resolve 前重新验证生命周期/成员/授权/当前不可变 Agent 与 Skill pins/产品模型；credential IO 后、transport 前再次验证。DB 锁不跨 credential、HTTP 或文件 IO。Provider 的精确 HTTPS base allowlist、liveEnabled、服务端 live flags 和 SecretRef owner 保持权威；测试没有修改生产地址策略。

运行开始、Trace 创建与 provider 标记、attemptedAt、成功/失败、输出及预算 settlement 均先锁实际 Job，校验 id/type/plugin/scope/Workspace/worker/attempt/UUIDv4 nonce/未到期 lease，再锁 Run，再进入 settlement。Trace 的 start/provider 通过既有 AiExecutionTraceService 的 transaction adapter 执行，未修改通用 Trace/Core 接口。旧 nonce 回调连 failure/refund 也不能写；合法 owner read/retention 走独立的 Job→Run 锁，read 仅对 terminal RuntimeJob 做 reconciliation。attemptedAt 从不清零，不确定上游结果保留 reservation。

## 总控集成清单（Worker STOPPED 后）

1. 依赖真实集成 Task：AF-159 `task_8225f38866ac`、AF-154 `task_623c04531bae`、恢复 AF-145 `task_634f404155e8`、AF-157 `task_062c43c051bb`；bootstrap 不是这些任务的再次集成证明。无需 AF-161 新 Schema 或 SQL。
2. 在 AiRuntimeModule 加入 controller `AiPersonalAgentRunsController`，providers `AiPersonalAgentSnapshotsService`、`AiPersonalAgentRunsService`、`PersonalAgentRunNoStoreGuard`。RunService 对 resolver 为可选注入，未接线时私有执行拒绝，旧目录执行可用；不得再注册第二个 AI_AGENT_JOB handler。
3. SDK index 精确导出 `createPersonalAgentRunsClient, type PersonalAgentRunRequest`，来源 `./personal-agent-runs.js`。构建 SDK 的 ESM/CJS/声明，执行真实 packed consumer；不要以 Worker 的 transpile 测试代替打包证据。
4. 将 **AF-161** 注册到正式 verify:task、数据库 acceptance/seed 白名单与 client-auth-fixture 白名单，勿冒用 AF-123。让 prepareClientFixture 接收并透传 pluginManagement（默认 false）给实际 seedDatabase；live 用该权限运行实际 admin plugin disable/enable API。沿用已核验的隔离测试库保护，root 独占 DB writer/heavybuild，concurrency=1。
5. 根目录串行执行 `AIJ_AF161_ROOT_LIVE=true node --test scripts/verification/personal-agent-runs-live.test.mjs`。该文件默认 skip，Worker 只做了语法/lint 检查；没有任何 DB 通过声明。环境开关不配置真实凭据，测试生成独立 synthetic SecretRef，只把允许的两个 OpenAI endpoint 在测试 transport 中精确转发到本进程 loopback server。
6. 补齐/执行正式 `verify:task AF-161`、适用 legacy catalog text/image/recovery/fencing 门禁、模块重型构建、SDK packed consumers，记录真实成功/拒绝、审计脱敏与关闭 pools=0；按正式流程更新执行/队列并按原任务名提交。此候选不能标为 CODE_VERIFIED/负责人接收。

## 根目录 live 验收内容

新脚本使用实际 session/HTTP、资产 CRUD、PluginLifecycle API、JobService claim/execute、RuntimeRegistry、PostgreSQL、Run/Trace/预算以及自有 synthetic HTTP upstream。覆盖 text/JSON、并发重放一次 run/job/reserve/upstream/trace、响应丢失 key recovery；跨 owner/Workspace/Origin/会话、伪造字段、stale revision、disabled Agent/model/provider、删除 Skill、plugin、成员/组织/项目/角色/grants 和预算拒绝，均检查无新 admission/transport；队列后撤销依赖、后续 Skill 版本不改 pinned instructions；相同 worker 的真实第二次 claim 产生不同 nonce，旧回调不能改新结果或 settle；丢失响应/短测试传输超时保留 unknown/reserved 且不重发；legacy text/image/recovery、retention、Trace/audit 内容排除及 API pools=0。

nonce 场景只在其专属 synthetic Job 上将 maxAttempts 从断言过的默认 1 临时调到 2 并令 lease 过期，以便实际 JobService 再 claim；不删除 admission markers、不重置 attempts、不替换 JobService、不篡改捕获 claim 的 worker。短超时只附加在测试 transport 的 loopback fetch signal，生产超时配置不变。

人工验收：完成上述真实验收后，在受控 synthetic 凭据/预算下创建 Skill v1 和 enabled 私有 Agent，提交一次并用 key 恢复，更新 Skill v2 后执行旧 pin、观察仍使用 v1；删除 Skill 后再次提交应拒绝。检查同成员 run read、异成员 404、预算和 Trace 单一真值，真实 vendor calls 继续关闭至负责人提供凭据及预算。

## Root review 修正（追加候选，仍未接线/运行 live）

首个候选 `67bd29448e66852a1283ea1382db1f756cca222f` 保留历史。root review 后修正了 fixture 的 Skill 路由（实际 `POST /client/ai/skills` 201、`PATCH/DELETE /client/ai/skills/:id` 200），grant 查询从编译后的 `CLIENT_WORKSPACE_PERMISSION` 读取 `P.aiExecute/P.aiAssetsRead`，不改权限目录。

只读核对实际根目录的 personal-skills/personal-agents/ai-center-client/plugin-management controllers、ClientAuthGuard/authenticate、WorkspaceContextGuard/resolve、PluginRuntimeAccessService 以及 schema/policy/contract。personal-agents create 201，update/delete 200，runs submit 202，run/recovery GET 200，实际 plugin enable/disable POST 200；inactive project/org 503、member 401、Workspace/role/membership 403，live assertions 已按源码收紧为精确状态。模块/SDK/五个相关 guards、pluginManagement seed 透传及真实 lifecycle fixture 仍由 root 接线/验收；Worker 没有更改共享文件。

新增 actual-source 回归先在原候选失败（合法 p-UUID 目录 Agent 列表 404），修复后证明其 list/submit/execute 成功、canonical 目录 requestHash 与原 `[code, sortedInput]` SHA256 完全相同、相同输入仅键序不同时精确 replay、私有来源共用 key 时 409 且无额外 Job/reserve。live 脚本也加入 p-UUID 目录场景、私有 personal: code 断言，并调整 synthetic catalog 撤销时的 published 标记以保持现有 catalog policy。以上仍是离线回归与静态检查，不能替代 root 的真实 runtime/DB 证据。
