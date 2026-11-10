# MBTI Ops 候选契约包（Admin 接续开发前置）

2026-11-10。`status: needs_human_review`。**不是**根 `docs/api/` 权威定稿；未批前不得解禁 admin 写按钮、不得宣称净实收/渠道可得。

对照：[看板](MBTI-ADMIN-FOUNDATION-BACKLOG.md)、[Remy unknowns](MBTI-REMY-UNKNOWNS.md)、[coverage](MBTI-ADMIN-COVERAGE.md)、AF-106 支付人工退款申请。

批注格式（每条）：`批准 / 改写 / 延后` + 一句话。**批准**后才开 foundation+admin 实现卡。

---

## 0. 总原则（候选默认）

| 原则 | 默认 |
|---|---|
| 不 invent 渠道列 | 订单表无渠道字段；growth 导出保持 UI_CONTRACT |
| 毛额 ≠ 净实收 | `netCollectedFen` 在退款事实接通前恒 null |
| 不把 guest 社交当运营源 | 工单必须独立管理投影 |
| 不把 `unlocked` 当素材交付 | 任务队列另表 |
| H5 published | 仍由 `MBTI_PUBLIC_APPROVED` 硬闸；禁止 env 旁路 |
| 真支付 / 真模型 | 另需 Pay/Model owner；B5/B4 演练 ≠ 生产 |

---

## 1. 退款（#5 / D2）— 优先复用 AF-106

### 已有事实

- `MbtiOrder.paymentOrderId?` → `PaymentOrder`
- AF-106：`POST /api/admin/payments/orders/:id/refund-requests` 仅创建 `pending_manual_review`，**不是** provider 打款指令
- 权限：`admin.payment.read` / `admin.payment.refund.request`

### 候选接线（待批）

| 项 | 候选 |
|---|---|
| 路径 | `POST /api/admin/mbti/orders/:orderId/refund-requests` |
| 语义 | 解析 MBTI 单 → `paymentOrderId`；无支付单则 409；再委托既有 PaymentAdmin 写申请 |
| Body | `{ reason: string(1..500), idempotency_key: string(16..128), amount_fen?: number }`；缺省金额 = 订单全额 |
| 权限候选 A | 复用 `admin.payment.refund.request` + `mbti:orders:read` |
| 权限候选 B | 新码 `mbti:orders:refund:request`（需 seed；Remy 选） |
| 响应投影 | `{ request_id, status: "pending_manual_review", payment_order_id, amount_fen, currency, created_at }`；不含 provider/SecretRef |
| 权益 | **本阶段不自动吊销** `MbtiEntitlement`（unknown：人工通过后退款事实如何回写 MBTI status） |
| admin | 订单详情「退款」解禁为「提交人工退款申请」；成功仅提示已入审，不显示到账 |

### Remy 批注（2026-11-10）

1. 权限：**A**（`mbti:orders:read` + `admin.payment.refund.request`）— 已实现  
2. 通过后权益/状态回写：**本阶段不自动吊销** — 已实现；回写事实仍 ASK  
3. reason：**自由文本 1–500** — 已实现  

路径已交付：`POST /api/admin/mbti/orders/:id/refund-requests`。

---

## 2. 体验兑换码（#6 / D3）

| 项 | 候选 |
|---|---|
| 新表（建议） | `MbtiRedeemCode`：`id, codeHash, productCode, maxRedemptions, redeemedCount, status(active\|disabled), createdBy, createdAt, disabledAt?` |
| 禁止 | 存明文码超过创建响应一次；禁止用原型 localStorage；禁止 guest 自助写运营账本 |
| API | `GET/POST /api/admin/mbti/redeem-codes`；`POST .../:id/disable` |
| POST body | `{ product_code, count: 1..50, max_redemptions: 1 }` → 响应一次性明文列表 + 审计只记 hash |
| 权限 | 读 `mbti:orders:read`；写 `mbti:ops:redeem:write`（新码，待批） |
| admin | 「体验兑换码」标签：列表/生成/停用；生成结果仅当次展示 |

### Remy 必选

权益种类是否仅 `MBTI_PRODUCTS`？客服补偿码与种子码是否同表？

---

## 3. 生成任务队列（#7 / E1）

| 项 | 候选 |
|---|---|
| 模型 | `MbtiGenerationJob`：`id, orderId, recipe, status(queued\|running\|succeeded\|failed), attempt, lastErrorClass, createdAt, updatedAt` |
| 与订单 | 1 订单可多 job；`unlocked` **不等于** succeeded |
| API | `GET /api/admin/mbti/generation-jobs?status=&order_id=`；`POST .../:id/retry`（幂等键） |
| 权限 | 读 `mbti:orders:read`；重试 `mbti:ops:generation:retry` |
| admin | 「生成任务」标签接列表；异常筛选；重试按钮 |

### Remy 必选

job 谁创建（支付成功回调 / 显式 enqueue）？失败重试是否占新模型额度？

---

## 4. 匿名治理工单（#8 / E2）

| 项 | 候选 |
|---|---|
| 原则 | **禁用** guest 社交列表当运营枚举；独立 `MbtiModerationCase` |
| 字段白名单（候选） | `id, kind(report\|block_appeal), subjectType(card\|user), subjectRef(opaque), reasonCode, status(open\|closed), createdAt`；**无**联系方式/位置/作答明文 |
| API | `GET /api/admin/mbti/moderation/cases`；`POST .../:id/dispose` `{ decision, note }` |
| 权限 | 读 `mbti:ops:moderation:read`（新）；写已有 `mbti:ops:moderation:write` |
| admin | `#/moderation` 解禁列表与处置抽屉 |

### Remy 必选

reasonCode 枚举；dispose 状态机；是否允许 support 只读。

---

## 5. 净实收 / 趋势（#9 / D4）

| 项 | 候选 |
|---|---|
| summary 扩展 | 仅当存在 **已入账退款交易事实**（PaymentTransaction kind=refund）时计算；否则保持 `netCollectedFen: null`, `refundsUnavailable: true` |
| 禁止 | 用毛额冒充净额；把 — 写成 0 |
| 按日趋势 | 另要日桶事件；无表则 overview 趋势保持 UI_CONTRACT |

### Remy 必选

归属日用 `paidAt` 还是退款 `occurredAt`？多币种是否永远分币种展示、禁止合计？

---

## 6. 渠道增长报表（#10 / E3）

| 项 | 候选 |
|---|---|
| 前置 | 新建访问/预览/分享事件表（含 `channel`）；**禁止**用支付 provider 冒充获客渠道 |
| 未建表前 | growth 页与渠道 CSV **保持禁用** |
| 有表后 | `GET /api/admin/mbti/growth/summary` + `export.csv`；权限 `mbti:ops:export` |

---

## 7. 成熟队列 / 复测率（#11 / E4）

| 项 | 候选 |
|---|---|
| 口径（已在 UI 呈现） | 首测满 45 日入分母；当日重测不计；52 日观察窗 |
| API | 有 cohort 定义批注后才建 `GET /api/admin/mbti/retention/cohorts` |
| 未批前 | retention 指标保持 — |

---

## 8. H5 published 解闸（#13 / C*）

| 项 | 候选 |
|---|---|
| 开关 | 仅改代码常量 `MBTI_PUBLIC_APPROVED=true`（Remy 显式 PR）；禁止环境变量 |
| 投影 | 维持 8 类非系统 + 单渠道 `channels` 切片 |
| Intern | 另发契约说明；**不代改 web/** |

---

## 9. 真支付商户 / 真 AI（#14 / #15）

| 项 | 候选动作 |
|---|---|
| 支付 | Pay 提供获批 SecretRef 后，payments 才允许非 UNCONFIGURED；admin 不存明文 |
| AI | Model 定供应方与费用后另开 health/generate；保留本机 kit |

---

## 10. 建议实现顺序（批准后）

1. **退款申请接线**（复用 AF-106，写路径最短）  
2. **兑换码账本**（运营可演示、无资金）  
3. **生成任务读路径**（先 list，再 retry）  
4. **治理工单**（隐私敏感，字段必须先批）  
5. 净实收 / 渠道 / 成熟队列（依赖事实表）  
6. H5 解闸 / 真商户 / 真模型（各 owner）

---

## 11. Agent 在本文件批准前可做 / 不可做

| 可做 | 不可做 |
|---|---|
| 维护本候选包与 Remy unknowns | 解禁退款/兑换/工单/渠道导出写按钮 |
| #1 真实验收探针（有 owner） | 把候选写入根 OpenAPI 权威 |
| 配置矩阵测试、订单读路径加固 | 宣称净实收/渠道已接通 |

`needs_human_review`：全文。
