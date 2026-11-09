# AI 执行 Trace 与成本真值契约

## Owner 与边界

`apps/api/src/plugins/aij-ai/**` 是 AI 执行 Trace 与 Provider 成本回执的唯一 owner。`apps/api/src/async-runtime/**` 和 Prisma `RuntimeJob/RuntimeIdempotency` 继续拥有 durable job、attempt、排队和重试状态。本契约没有新增第二个队列、日志账本或估算账本。

每个 `(RuntimeJob, attempt)` 最多一条 `AiExecutionTrace`。Trace 关联服务端解析出的 `ProjectProfile`、RuntimeJob、correlation ID 与能力码。ProjectProfile 是项目归属，不代表客户 Workspace/租户授权边界。

## 敏感值处理

Trace 只保存输入和输出的粗略形状：类型、分桶长度或字段数量、深度上限。不会保存输入输出值、对象键、邮件地址、SecretRef 明文或 Provider 原始错误。运行时任务保留既有 owner 所需的内部 payload；AF-093 的去敏承诺只覆盖 Trace 投影、受控错误投影和成本记录，不声称 RuntimeJob payload 本身为匿名数据。

API/任务结果只保留 `executionId`、`traceId` 与 `outputStored: false` 引用，不将模型输出写入 durable job 结果。

## 状态、失败与幂等

Trace 状态为 `running`、`succeeded` 或 `failed`。失败原因使用固定分类：配置、能力、预算、凭据、Provider 可用性、无效 Provider 回执、Provider 错误、超时或执行错误。原始异常不会写入 Trace；RuntimeJob 使用现有受控错误代码。

同一 `(jobId, attempt)` 重试必须保持项目、correlation ID、能力码和脱敏输入形状一致，否则拒绝。相同完成回执可幂等重放；不同输出形状、Token 用量或成本回执不能覆盖既有成功事实。

## 成本真值

Token 用量与成本分别保存。只有 Provider 返回完整且通过校验的回执时，才写入纳秒整数成本、ISO 风格三字母币种与 `provider_reported` 来源。只有 Token 用量而无 Provider 成本时，成本保持为空，来源为 `unreported`；不从 Token 数、日志或模型价格表推算账单真值。

## 验证与限制

AF-093 的真实 PostgreSQL/Nest HTTP 验收使用本地隔离测试库和离线合成 Provider 协议，覆盖关联、脱敏、固定失败分类、回执幂等、冲突拒绝和未报价状态。它证明内部协议与持久化行为，不证明任何真实付费 Provider 接入、账单结算或对外 Trace 查询 API。当前无新增公开查询 API、管理页面或权限码。

执行证据见 [AF-093](../execution/AF-093.md)。
