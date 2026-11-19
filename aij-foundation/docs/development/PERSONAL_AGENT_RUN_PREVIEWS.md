# 私有 Agent 运行预检（AF-165 候选）

提供工作台后续运行表单需要的安全只读接口，不新增执行器、报价/预算账本、预留或私有运行 UI。Worker 交付状态是候选，正式集成、注册验收和负责人验收仍由总控完成。

## HTTP 与安全边界

`GET /api/client/ai/personal-agents/:id/run-preview?expectedRevision=N`

- `:id` 必须是实际私有 Agent 的小写 UUID v4；不接受 `personal:` 命名空间或 catalog 的 `p-UUID` code。现有 catalog 的 `p-UUID` 仍按原规则兼容。
- query 只能有一个规范十进制 `expectedRevision`，范围 1..2147483647；禁止数组、重复参数、未知参数、上下文/source/snapshot/model/input 伪造。GET 不接受 body，连 `{}` 也拒绝。
- 使用实际客户端会话及服务端验证的 Workspace，同时要求 `workspace.ai.execute` 与 `workspace.ai.assets.read`。单独的运行结果读取权限不够。只读 GET 无 Origin 要求。
- 成功、认证失败、拒绝与早期 malformed parser 错误都必须为 `Cache-Control: private, no-store`；后者依赖总控的早期 middleware 接线。

响应只有以下字段，示例值来自合成配置：

```json
{
  "personalAgentId": "7ac902e2-d7fa-44f0-82bd-2a4c27f7c009",
  "code": "own-agent",
  "name": "Own Agent",
  "revision": 2,
  "inputFields": ["question"],
  "outputFormat": "json",
  "outputFields": ["answer"],
  "capability": "text",
  "modelCode": "advice-text",
  "modelRevision": 1,
  "catalogVersion": 4,
  "maximumEstimatedCostNanos": "18432000",
  "modelExecutionConfigured": false
}
```

`code` 是作者设置的私有资产 code；身份始终以 `personalAgentId` 为准。响应不含 provider code/base URL/upstream model/credential ref、密钥、snapshot、Agent 指令、Skill 正文、Memory 或完整 catalog。

`maximumEstimatedCostNanos` 直接调用 `AiCenterBudgetService.estimate(model)`，以十进制字符串返回模型执行预算上界。它不是用户成交价、支付承诺或退款承诺，也不检查剩余额度、不占用额度。`modelExecutionConfigured` 仅表示当前执行开关、provider liveEnabled、批准的 HTTPS 主机、vendor 协议和 owned configuredTrusted 引用元数据满足要求；无密钥解析、解密、外部请求或探活。开关关闭或凭据未配置时仍返回有效资产及费用，状态为 false。DeepSeek（含识别到官方主机的 compatible alias）继续使用现有确认、live 与 synthetic-or-deidentified 限制。

无论 true/false，提交都要重新验证当前身份权限、生命周期、配置、输入和预算；GET 不保证准入。Agent 不存在/不可用为 404，版本或模型/catalog/存储内容冲突为安全 409；成员/权限拒绝沿用 401/403，非预期依赖故障为不泄漏原始错误的 503。

## 事务与 owner

一次 ReadCommitted 事务复用当前 project/plugin helpers，锁住 active project/organization/plugin installation；复用 WorkspaceContextService 的 membership advisory lock 与成员/工作区/角色/授权行锁，逐一验证两个权限；精确 FOR SHARE 锁定当前 project 的 `ai.center.catalog` 行后读取并验证 current catalog。再调用唯一的 `AiPersonalAgentSnapshotsService.resolve`，验证本人、当前 active Agent/精确 revision、model/catalog 版本、本人仍未删除的 Skill 和有序不可变 Skill pins。Skill 当前模型没有 enabled 字段，active 对应未删除；不会复制快照编译器。

费用只走既有 estimator；凭据只走 `SecretRefPort.configuredTrusted`。预检不引用 AiCenterRunService/provider executor，不创建或修改 Job/Run/Trace/audit/budget/catalog/private asset 行。实际会话认证的 lastSeenAt/updatedAt 仍归认证 owner，真实验收仅对这两个认证时间字段做规范化，其余表逐行精确哈希。

## SDK

总控导出后：

```ts
const previews = createPersonalAgentRunPreviewsClient(clientApi);
const preview = await previews.preview(workspaceId, personalAgentId, expectedRevision);
```

工厂不保存会话或 Workspace，复用 ClientApi 的 credentials/no-store/typed error。严格数值 revision、私有 UUID 和 Workspace 格式校验在传输前完成，不接受 body/source/snapshot。

## 总控 STOPPED 后接线与验收

1. 在 `ai-runtime.module.ts` 注册 `AiPersonalAgentRunPreviewsController`、`AiPersonalAgentRunPreviewsService`、`PersonalAgentRunPreviewNoStoreGuard`，复用已有 snapshots/configuration/budget/secret/workspace/plugin providers。
2. 在 bootstrap 注册导出的 `personalAgentRunPreviewNoStore`，必须先于 parser/auth。它仅覆盖 `/api/client/ai/personal-agents` 及子路径，包括 malformed id；由真实 malformed JSON/超限 body 用例验证注册顺序。
3. 在 SDK index 添加 `export * from './personal-agent-run-previews.js'`，Worker 没有修改 index/module/bootstrap。
4. 正式注册 AF-165 verify:task、新鲜独立验收租约与适用 fixture/auth 支持。不要复用旧任务身份、旧验收数据库或放宽目标保护；Schema 无新内容。
5. 总控独占数据库/重型构建，执行正式 target gate 和新鲜 API/SDK 构建。离线：`node --test scripts/verification/personal-agent-run-previews.test.mjs`。真实：`AIJ_AF165_ROOT_LIVE=1 node --test scripts/verification/personal-agent-run-previews-live.test.mjs`。

真实用例仅允许在原 dev 主工作区运行（脚本硬性检查路径、dev 和 Git 主工作区）；由实际 plugin lifecycle、真实 Cookie、当前私有资产 API 建夹具。测试覆盖 default-off false/configured true、合成引用无解析/传输、estimator 一致、重复 GET 全表哈希、cross-owner/space/伪造/权限/read flags/过期 revision/禁用依赖、无 Origin、安全类型错误与 no-store、早期 parser、实际 PostgreSQL 成员及 lifecycle 锁等待、packed ESM/CJS SDK 和严格消费类型、关闭后 application pools=0。证据写 `.artifacts/auto-ai-program-20261105/AF-165/<lease>/live.json`。

Worker 已运行实际源码离线测试、目标 API noEmit、lint 和 live 脚本语法检查；真实 DB/API/compiled packed SDK/browser、正式 verify:task 均 **NOT_RUN**，不可把离线 fakes 或脚本准备写成真实 PostgreSQL 验证通过。未启动任何访问地址；人工验收需在总控接线后登录具备两个权限的成员，确认 GET 所需表单/费用/false，开启现有配置后为 true，并验证 401/403/404/409 及无副作用。
