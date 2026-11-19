# Payment Provider、请求 API 与状态所有权（G18-01/G18-02）

## 单一 owner

| 数据/行为 | 唯一 owner | 边界 |
| --- | --- | --- |
| 业务订单、应付对象、价格、币种及付款资格 | 创建该 payable 的业务插件 | 支付端不得接受客户端传入的金额、币种或业务身份作为真值；支付只接收业务授权后的快照与不透明引用。 |
| 支付订单与支付尝试状态 | `apps/api/src/plugins/aij-payment` 的 `PaymentService` | Provider 仅返回规范化观察结果，不写数据库、不直接推进状态。创建/查询请求从服务端会话、workspace 和当前项目构造。 |
| Provider 交易事实 | 同一 aij-payment ledger owner（G18-03 后续实现） | 每条交易是追加事实；冲正/退款写成新事实，不回写或删除既有交易。交易记录本卡尚未创建。 |
| 密钥解析 | 现有 SecretCenter | 只传入服务端解析出的运行凭据；请求/响应类型、审计、错误和持久化均不得包含密钥值。Provider registry 只接受编译期宿主实例，不接受动态路径。 |

## 合同

`payment-provider.ts` 定义 create/query Provider port、静态 `PaymentProviderRegistry`、服务端订单快照的结构校验和规范化结果校验。请求使用整数最小货币单位的十进制字符串、ISO 4217 大写三字母币种代码及 exponent；拒绝非正数、越界、额外凭据/原始 payload 字段及畸形身份。响应只允许 provider reference、pending/succeeded/failed 规范状态和观察时间，不接受 Provider 重写金额/币种或把原始响应带入内部域。

默认 registry 为空；没有显式静态适配器时查询失败闭合。Provider adapter 是可信宿主代码，不能由 API 参数、数据库内容或环境脚本选择。Provider 错误的去敏映射由后续 PaymentLedgerService 负责，不能透传上游异常。

G18-02 暴露客户 workspace 下单 `POST /api/client/payments/orders` 和本人订单查询 `GET /api/client/payments/orders/:orderId`。创建 DTO 仅含 `payableReference` 与 `idempotencyKey`。服务端从 `PaymentPayableSource` 解析可信快照，再由 PaymentService 生成 project/workspace/member 身份、金额/币种、订单号和 Provider 稳定幂等值。客户端附加金额、币种、Provider、workspace、member 或 project 字段会被 DTO 严格拒绝。读路径同时限定当前 project、workspace 和 member，写路径要求同源且插件真实启用。

请求幂等键仅以 SHA-256 摘要持久化，并按 project/workspace/member 作用域建立唯一索引；相同 key 重放相同 payable 返回原订单且不重复调用 Provider，改变 payable 快照则返回冲突。Provider timeout/无效响应保存为 unknown attempt 和 pending order，不推定扣款失败、不自动再次扣款；回调、状态查询/对账及交易事实留给 G18-03。审计只写资源 ID、服务器订单号和金额快照，不记录原始幂等键、credential 或 Provider 错误细节。

## 状态真值

`payment-state.ts` 是状态跃迁策略 owner：

- PaymentOrder：`created -> pending|closed`；`pending -> succeeded|failed|closed`；终态不可重开。重试由独立 Attempt 表达，不能把终态订单重新置为 pending。
- PaymentAttempt：`created -> submitting|cancelled`；`submitting -> pending|succeeded|failed|unknown|cancelled`；`pending -> succeeded|failed|unknown|cancelled`；`unknown` 只能由服务端查询/对账结果恢复为已知状态或取消。Provider 超时不等于失败，避免自动重试造成重复扣款。
- PaymentTransaction：不可变追加事实，类型为 charge/refund/reversal；退款或冲正新增事实，不编辑先前金额或状态。唯一 writer 在 aij-payment ledger service，后续 DB schema/唯一约束随 G18-02/18-03 落地。

Provider `succeeded` 不能单独成为业务订单的付款凭据。G18-02 即使收到此观察也将 attempt 保留为 `unknown`、订单保留为 `pending`，等待后续服务端核验。客户端提供的 `projectId`、business ID、价格或 provider code 不具备授权效力。

## G18-01 / G18-02 范围界限

G18-01 建立 Provider/state contract；G18-02 新增 PaymentOrder/PaymentAttempt Schema 与迁移、workspace API、幂等和服务器价格边界。G18-02 不新增 PaymentTransaction、回调/对账、退款、商户或渠道管理 UI；G18-03/后续卡再明确这些 owner。生产 payable source、SecretRef credential resolver 与 Provider registry 仍未接线并失败闭合。没有 live Provider、付款、退款、商户凭据或外部网络调用；测试只使用本库固定合成 payable 和离线 Provider。

许可证、发布渠道和支持平台仍以负责人决定为准；本地代码验证不等于 Provider 生产接入或发行授权。

## G18-03 / AF-105 回调与交易事实

`POST /api/payments/callbacks/:projectCode/:providerCode` 是服务端 Provider 回调入口，不依赖客户 Cookie；只有静态注册 Provider、当前项目下已存在且项目/订单/尝试/Provider 引用匹配的支付尝试可继续验签。请求必须是 JSON 且不超过 64 KiB。服务使用 Nest raw body 做 HMAC-SHA256，签名覆盖 `v1\n{projectCode}\n{providerCode}\n{timestamp}\n{eventId}\n` 和原始请求字节；时间戳窗口为 5 分钟，重复/多值头、格式错误、过期时间、无效签名和跨项目订单统一拒绝。支付 owner 复用 IntegrationCenter 已核验的纯 HMAC/timing-safe 原语，但不复用其 connector installation、入站账本或服务。

原始 body 只在内存中解析；payload 限于 `eventId/orderNo/providerReference/status/amountMinor/currency/occurredAt`，状态仅 pending/succeeded/failed，额外字段拒绝。event ID 与项目/Provider 组成数据库唯一键；有效签名的事件在单个 PostgreSQL 事务内取得 advisory lock、写入摘要收据、校验服务器保存的订单金额/币种、推进 Order/Attempt、写入审计；成功回调只追加 `PaymentTransaction(kind=charge)`。金额不符或状态冲突会留下 `rejected` 收据与去敏审计但不改变订单状态；相同事件重放返回 409 并审计拒绝，不重复交易。原始请求、签名、SecretRef 和解析后的凭据不进入日志、响应或交易事实。

`PaymentAttempt.credentialRef` 只存服务端 payable source 给出的 SecretRef，回调每次由 SecretCenter 适配口重新解析；真实 resolver/Provider 未配置时失败闭合。当前 test 环境只使用本库合成 fixture 的无外部调用协议验证。交易事实唯一 owner 仍是 aij-payment；本卡只由可信成功回调追加 charge，退款/冲正交易类型为后续受控流程预留，不自动发生资金操作。真实收单/结算和生产 Provider 验签仍待负责人配置与人工验收。

## G18-04 / AF-106 管理查询与人工退款申请

`PaymentAdminService` 仍由 `aij-payment` 唯一持有支付订单查询和退款申请记录；Admin JWT/RBAC 在服务端检查 `admin.payment.read` 与独立的 `admin.payment.refund.request`。查询按当前项目过滤，返回分页、支付单详情、规范化交易/回调状态，不返回 Provider reference、SecretRef、原始回调 payload 或签名。菜单 `/auth/payments` 仅在 `aij-payment` 启用时提供，并要求读权限。

退款申请只写 `PaymentRefundRequest(status=pending_manual_review)`。服务端锁定订单并依据唯一 charge、既有退款/冲正事实和待审申请计算剩余额度；幂等键仅保存哈希，审计记录保留操作者和必要金额/原因。相同 key/fingerprint 重放返回原申请，不同请求复用 key、超过余额、非成功订单或跨项目查询均拒绝。申请不会追加 `PaymentTransaction(kind=refund|reversal)`，不会调用 `PaymentProviderRegistry`、SecretCenter 或外部服务。真正退款及其资金事实需要后续授权流程与人工操作。


## G18-05 / AF-107 合成轨迹对账与差异处置

`PaymentReconciliationService` 是 aij-payment 内对账证据和人工处置状态的唯一 owner。管理员可通过 `POST /api/admin/payments/reconciliations` 提交经过严格 DTO 校验的规范化轨迹，使用分页列表/详情读取差异队列，并对单条差异执行一次性 `acknowledged` 或 `escalated` 人工处置。读取、创建、处置分别要求 `admin.payment.reconciliation.read`、`admin.payment.reconciliation.run`、`admin.payment.reconciliation.review`；服务端还按当前项目过滤查询和写入。

输入窗口采用左闭右开 `[windowStart, windowEnd)`，每条记录的观察时间必须位于窗口内。匹配条件为项目、Provider code、Provider reference、订单号、最小货币单位、币种及规范状态；返回并持久化 missing-local、missing-provider、duplicate-provider、order/amount/currency/status mismatch。幂等键及规范化请求只存 SHA-256 摘要；Provider reference 仅作服务端比对，持久化前散列，响应及审计不返回原值或内部摘要。完整原始 Provider payload 不保存。

对账和人工处置只新增 `PaymentReconciliationRun`、`PaymentReconciliationDiscrepancy` 证据及去敏审计，不更新 PaymentOrder、PaymentAttempt、PaymentCallbackEvent 或不可变 PaymentTransaction。成功回调仍由 AF-105 的 PaymentCallbackService 按验签状态机写入；对账结果不能回调或覆盖支付真值，也不调用 Provider、SecretCenter、扣款、退款或冲正操作。当前 AF-107 测试使用本库合成轨迹与隔离 PostgreSQL，未构成真实 Provider 对账接入证据。
