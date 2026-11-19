# 个人工作流发布与执行 API / SDK

当前范围：个人私有的 `开始 → 一个已发布 Agent → 结束`，输入字段集合须与 Agent 一致。复杂流程仍可保存为草稿，当前发布会拒绝，不能自动删节点。多 Agent、条件/并行/循环/人工审批、脚本、定时/事件/Webhook 和执行界面尚未由本模块完成。

客户端使用原客户 Cookie 登录及当前 Workspace 权限。所有者身份和会话由原 Guard 验证，服务端派生 project/member/workspace；禁止在 body 中填 actor、claims、session、snapshot 或工具配置。API 前缀为 `/api/client/workflow-executions`，下面的 SDK 自动补 `/client/workflow-executions`，`createClientApi` 的 base 应包含 `/api`。浏览器继续使用原 `credentials:include` 和配置的 Origin/CORS；其他前端须先接原认证与服务端允许的 Origin，不能以传 workspaceId 代替授权。

```ts
import {createClientApi, createPersonalWorkflowExecutionClient} from '@aij/sdk';
const client = createPersonalWorkflowExecutionClient(createClientApi(() => '/api'));
const current = await client.publication(workspaceId, workflowId);
const published = await client.publish(workspaceId, {
  workflowId, expectedRevision: current.revision,
  expectedPublicationEpoch: current.publicationEpoch,
});
const capability = await client.preview(workspaceId, published.publication!.id);
// configured=false 表示待配置；true 也只是预览，不是余额或执行准入承诺。
const key = crypto.randomUUID(); // 调用方保留自己此次请求的 key。
const queued = await client.submit(workspaceId, {
  publicationId: published.publication!.id,
  input: {text: '任务输入'}, idempotencyKey: key,
});
const result = await client.read(workspaceId, queued.run.id);
// 网络断开或成功响应无法确认时，显式 GET 原 key，SDK 不自动重发 POST。
const original = await client.recover(workspaceId, key);
void capability; void result; void original;
```

七个方法为 `publication / publish / unpublish / preview / submit / recover / read`，可传 `{signal}`，没有 caller-selected read/fallback 模式。发布和撤销须用当前 revision 与 publicationEpoch CAS；发布 no-op 复用引用，不重复审计；撤销后再次发布产生新 epoch 和引用。改草稿、撤销/重发 Agent、禁用模型或 Skill 会使旧来源不可执行，不自动换 pin。

| HTTP 方法与路径 | 权限 | 成功 |
|---|---|---|
| GET publications/:workflowId | workspace.ai.assets.read | 200 |
| POST publications | workspace.ai.assets.manage + workspace.ai.workflows.publish | 201 |
| POST publications/:workflowId/unpublish | 同发布 | 200 |
| GET capability?publicationId=UUID | workspace.ai.assets.read + workspace.ai.execute + workspace.ai.workflows.execute | 200 |
| POST runs | 同执行预览 | 201 |
| GET requests/:key；GET runs/:id | workspace.ai.assets.read + workspace.ai.read + workspace.ai.workflows.execute | 200 |

POST 只接受 UTF-8 `application/json`，拒绝重复 key、非法 UTF-8/数字、未知字段和表单解析绕过。JSON wire 上限98304 bytes；每次输入最多20字段，每字段最多2000字符，key须符合原字段规则。GET拒绝 body、额外或重复 query。所有响应及解析/认证/权限错误使用 `private, no-store` 与 `nosniff`。

Run/Job/Trace/预占/结算始终属于原运行时。workflow只保留不可变来源。读取可以用同 owner 的新合法会话；执行仍验证原启动会话，三阶段撤权/租约失效不会被新查询会话绕过。未知上游结果保留原 unknown/预占，不当作免费失败或自动重试；RuntimeJob完成和Run成功是两个状态。过期正文读取410，恢复接口仍可返回不含正文的原请求状态。

此处没有真实厂商、商户或通知渠道通过声明。真实账号密钥保持空，外部验收DEFERRED_NOT_PASSED。示例不代表当前部署已运行；负责人验收与完整需求目标状态独立。正式证据见AF205/206/207执行记录。

旧 `/client/ai/runs/:id`、`run-requests/:key` 和图片入口对工作流来源一律404，包括内容保留期清除snapshot后的不可变来源记录。工作流必须使用本页受当前权限、发布和查询会话前后复检的接口。原catalog与个人Agent接口保持原行为，内部共享driver不作来源拒绝。
