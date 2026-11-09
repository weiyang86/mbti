# 个人工作流草稿 API（AF-170）

此交付是候选源码。总控接线、迁移和真实验收前没有运行地址；Worker 未启动 API 或连接数据库。保存成功只表示私有草稿的结构有效，返回 `status: "DRAFT"`、`structuralValidity: "VALID"`。不发布、执行、触发工作流，不创建 RuntimeJob、Run、Trace、预算、工具调用、授权、Memory 或通知。后续画布和执行器必须另行接入 Runtime owner 并重新检查运行授权；这里的有效性不能证明可运行。

## 接口与隐私

路径前缀 `/api/client/ai/personal-workflows`，沿用实际 Client Session Cookie 和 `x-aij-workspace-id`。服务器重新验证 session、active Member/Workspace/Membership/Role/Permission、组织/项目与 aij-ai 安装生命周期。读使用 `workspace.ai.assets.read`，写使用 `workspace.ai.assets.manage`；写必须严格匹配配置 `webUrl` 的 Origin，拒绝 cross-site。另一 OWNER 仍无法访问此成员的资产。所有响应，包括鉴权、语法、超限失败，必须 `Cache-Control: private, no-store`。

| 方法与后缀 | 输入 | 返回 |
| --- | --- | --- |
| GET `/` | `limit` 1..20（默认20），可选 `afterId` | 安全摘要 `items`、`nextCursor`；不含 graph、条件、Agent pins |
| POST `/` | `{code,name,graph}` | 当前草稿、graph、服务端解析的 Agent bindings |
| GET `/:id` | 空 query/body | 当前完整草稿 |
| PATCH `/:id` | 完整 `{expectedRevision,name,graph}` | CAS 后当前草稿；相同规范内容保持 revision/audit 不变 |
| DELETE `/:id` | `{expectedRevision}` | `{id,revision,deleted:true}`；重复删除也检查 CAS |
| GET `/:id/versions` | `limit` 1..20，可选正整数 `beforeRevision` | 倒序版本摘要，不含 graph；`nextCursor` 为 revision |
| GET `/:id/versions/:revision` | 正整数 revision，空 query/body | 精确不可变 graph 与 Agent bindings |

拒绝所有未知字段、body/query 中伪造 owner/workspace/version IDs、重复 query 值和不合法游标；code 为 2..63 位小写短横线标识、创建后不可变；name/label 为修剪后的1..100 UTF-16长度文本，拒绝控制符和孤立代理字符。code 在墓碑后永不复用。相同 code 的初始规范请求 digest 重放返回当前草稿（即使已编辑），不生成版本/审计；不同初始请求冲突，墓碑始终冲突。删除后本人历史也不可通过 API 读取，数据库保留不可变历史供既有资产保留策略使用。

每个成员/空间最多100个活动草稿，以事务 advisory lock 和 SQL 触发器序列化；current、version、pin 和审计处于同一事务。审计仅含 workflowId/revision/action 与合法 correlationId，不记录 name、graph、条件、标签、Agent/Skill 指令或 Memory。领域拒绝不写入资产、版本、绑定或审计；认证层按既有策略更新 session lastSeenAt。

## Graph v1 的完整形状

根对象仅 `{schemaVersion:1,inputKeys,nodes,edges}`；loop body 仅 `{nodes,edges}`，复用根的输入声明。规范 JSON UTF-8 最多65536字节；数据库还约束其 JSONB 文本最多65536字节。所有子图累计最多64节点/128边，根深度为1，最多4层。根输入键最多20个，不重复。节点 ID 在整棵图中唯一。

节点/端口/输入键为 `^[A-Za-z][A-Za-z0-9_-]{0,47}$`，拒绝 constructor/prototype/__proto__。每个节点通用 `{id,type,label?}`，额外允许字段见下表，其他全部拒绝：

| type | 必需字段 | 输出端口 | 输入规则 |
| --- | --- | --- | --- |
| start | 无 | next | 无入边；每张图恰好一个 |
| end | 无 | 无 | 唯一 in；每张图恰好一个 |
| agent | agentId、revision | next | 唯一 in |
| human-approval | 无（纯占位） | next | 唯一 in；无受理人、grant、自动审批 |
| condition | predicate、joinId | true、false 各一条 | 唯一 in；必须有配对 join |
| parallel | branches（2..8个唯一安全端口）、joinId | 各 branch 恰好一条 | 唯一 in；必须有配对 join |
| join | forkId | next | condition 的 true/false 或 parallel 每个 branch 对应的输入各一条 |
| loop | maxIterations（整数1..20）、body | next | 唯一 in；body 自身满足完整 DAG 规则 |

每条边仅 `{from,port,to,input}`。普通目标使用 `input:"in"`；join 的 input 必须精确为对应 fork 的分支名。允许空分支直接接到自己的 join，但仍必须使用匹配端口。条件也要求显式成对 join，因此不允许隐式 fan-in。分支 token 栈检查所有分支的进入/退出边界，拒绝分支串线、跨层 join、错配 join 和嵌套区域逃逸。每个节点必须从 start 可达并最终到 end；所有原始环、重复边、悬空端点、不完整端口、不支持的类型或字段均拒绝。循环重复由有界声明表示，禁止 raw backedge。

predicate 仅以下两种形式；它是比较声明，不是表达式。eq/neq 按 valueType 比较且不做隐式类型转换，后续执行器需要遵循该约定；本卡不计算条件或选择分支。

```json
{"key":"question","op":"exists"}
{"key":"question","op":"eq","valueType":"string","value":"yes"}
```

op 为 eq/neq 时 valueType 为 string/number/boolean/null 且 value 类型必须匹配。字符串最多200字符且无控制符，数字有限且绝对值≤1e12，key 必须在 inputKeys 中声明。exists 不能有 value/valueType。无 JS、eval、表达式、script、source、network/tool URL 或隐式执行字段。

agent 节点仅提交本人活动 Agent 的 `agentId` 和不可变 `revision`。服务端按 Agent ID 排序加行共享锁，再读取相同成员/空间的不可变版本，存入独立 pin 表；不把指令、Skill 或 Memory 复制进 graph。disabled Agent 配置允许作为草稿引用，deleted Agent 或不存在的版本拒绝新保存（包括 PATCH noop）；已经保存的历史 pin 仍保持原值。初始请求 replay 只是读取既有 current，不重新创建或校验新 pin。

`validateWorkflowGraph(raw)` 是后端可调用的确定性结构校验函数，返回规范 graph/canonical、SHA256 digest、统计、引用、DRAFT/VALID；无效时仅抛通用错误。inputKeys、nodes、edges、parallel branches 的排列不影响规范 digest；标签、条件和版本引用属于内容，改动会改变 digest。校验不修复错误拓扑。`parseWorkflowJson(raw)` 在解析前检查重复 JSON key（含转义等价 key），不能用普通 JSON.parse 后再检查代替。

## SDK

总控在公共 index 加 `export * from "./personal-workflows.js"` 后，导出 `createPersonalWorkflowsClient(api)`、图/请求/响应类型和纯浏览器可调用 `validatePersonalWorkflowDraft(raw)`。浏览器校验返回规范 JSON/graph 与结构结果；SHA256真值由服务端生成。工厂复用现有 ClientApi 的 Cookie/no-store/空间 header，不保留租户或 token，不提供运行方法。

```ts
import {createClientApi, createPersonalWorkflowsClient, validatePersonalWorkflowDraft} from '@aij/sdk';
const client = createPersonalWorkflowsClient(createClientApi(() => apiBase));
const graph = validatePersonalWorkflowDraft({schemaVersion:1,inputKeys:[],
  nodes:[{id:'start',type:'start'},{id:'end',type:'end'}],
  edges:[{from:'start',port:'next',to:'end',input:'in'}]}).graph;
const saved = await client.create(workspaceId, {code:'my-draft',name:'草稿',graph});
await client.getVersion(workspaceId, saved.id, saved.revision);
```

## 总控接线与验收

仅接收候选提交；bootstrap 提交不得重放到 dev。实际 Schema/migration/module/SDK index/五处数据库与 fixture allowlist/runner 由总控独占。把 `AiPersonalWorkflowsController` 加入 ai-runtime.module controllers，Service/PersonalWorkflowNoStoreGuard 加入 providers；既有 Workspace 与 PluginRuntime 模块继续提供实际服务。按 `docs/execution/AF-170-schema.prisma` 加三模型及三条回关系，原 Runtime/Agent/Memory 字段保持字节不变；SQL 提案中的所有 CHECK、composite FK、immutable、quota 与 deferred completeness 触发器必须保留。

在 JSON middleware **之前**安装 `personalWorkflowPrivateMiddleware`，JSON parser 为本前缀组合 `personalWorkflowJsonVerify`（保留既有 rawBody/其他 route verify），将原始 body 限制到98304字节；两函数兼容大小写路径。早期 no-store 必须覆盖真实413和 malformed JSON。使用总控已验证的 AuthExceptionFilter 私有缓存/413逻辑，Worker 未改该共享文件。

五处正式 task allowlist：`scripts/database/migration.mjs`、`scripts/runtime-environment.cjs`、`scripts/database/seed.mjs`、`scripts/verification/auth-support.mjs`、`scripts/verification/client-auth-fixture.mjs`，以及 runner/正式队列记录按总控流程注册。不能借用旧任务数据库。

总控先生成/构建并准备独立安装的真实 packed SDK consumer。consumer 内提供 af170-consumer.mts 和 af170-consumer.cts，两份均包含：

```ts
import { createPersonalWorkflowsClient, validatePersonalWorkflowDraft } from '@aij/sdk';
import type { WorkflowGraph, PersonalWorkflow, UpdatePersonalWorkflow } from '@aij/sdk';
const graph: WorkflowGraph = {schemaVersion:1,inputKeys:[],nodes:[{id:'s',type:'start'},{id:'e',type:'end'}],edges:[{from:'s',port:'next',to:'e',input:'in'}]};
const validated = validatePersonalWorkflowDraft(graph);
const edit: UpdatePersonalWorkflow = {name:'Edited',graph:validated.graph,expectedRevision:1};
void createPersonalWorkflowsClient; void edit;
const read = (asset: PersonalWorkflow) => asset.agentBindings[0]?.agentVersionId;
void read;
```

串行运行 `AIJ_AF170_ROOT_LIVE=1 AIJ_AF170_PACKED_CONSUMER=<独立消费者目录> node --test scripts/verification/personal-workflows-live.test.mjs`。脚本强制原 dev 主目录/新 AF-170 acceptance，创建两个实际 API host（各自 Prisma connection_limit=1）；锁/查询通过独立受保护 PG Client，不用同池制造阻塞。检查 Cookie、signed cross-product/过期/撤销会话、read-only、另一OWNER/空间/未知版本、Origin/CSRF、严格图、重复key/413、current历史/pins/noop/CAS/replay、SQL不可变/完整性/审计故障回滚、锁围栏、100配额竞争、墓碑、实际 packed ESM/CJS/types、无执行/Memory/预算变更或上游，以及关闭后 pools0。Worker 对此脚本仅做语法/lint，不宣称真实验收已通过。正式 verify:task、源码/SQL自查、适用门禁、执行/队列、精确标题提交和负责人验收由总控完成；后续卡必须依赖真实 I-* 集成 Task。
