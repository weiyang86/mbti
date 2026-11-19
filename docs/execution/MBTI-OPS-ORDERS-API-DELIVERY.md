# MBTI Ops — 订单列表 / 导出 / 汇总交付

2026-11-10。接续 Codex 中断任务 `task_bf7548788e8e` / `run_59cdaeb18427`，基线 `706ba769a58f20152d4d1db0836faa70389d990b`。本记录覆盖运营端订单集合读取，不展开退款、生成任务、体验码或渠道经营报表。

## 变更路径

| 路径 | 用途 |
|---|---|
| `aij-foundation/apps/api/src/mbti/mbti-ops-orders.query.ts` | 严格筛选、UTC 日期窗、游标指纹、CSV 转义 |
| `aij-foundation/apps/api/src/mbti/mbti-ops-orders.service.ts` | list / export.csv / summary；导出审计 |
| `aij-foundation/apps/api/src/mbti/mbti-orders.controller.ts` | 管理端集合路由；保留按号 `:id` |
| `aij-foundation/apps/api/src/mbti/mbti.module.ts` | 注册 `MbtiOpsOrdersService` |
| `aij-foundation/apps/api/src/audit-log/audit-redaction.ts` | `orders_exported` 仅投影 count/filterCategories |
| `aij-foundation/apps/api/test/mbti-ops-orders.test.ts` | 查询/导出/汇总/审计隔离测试 |
| `admin/src/ops-orders-collection.ts` | 列表与汇总投影 |
| `admin/src/ops-api.ts` | list / export / summary 客户端 |
| `admin/src/orders-list.vue` | 筛选、游标分页、导出 |
| `admin/src/orders.vue` / `orders.css` / `ops.vue` | 接入列表与权限 |
| `admin/src/workspace.vue` / `ops-workspace.ts` | overview 仅接订单 summary KPI |
| `admin/scripts/orders.test.mjs` / `workspace.test.mjs` | 客户端与组件测试 |
| `docs/execution/MBTI-ADMIN-COVERAGE.md` | 精确更新 UI-01 / UI-03.1 |
| `docs/execution/MBTI-OPS-ORDERS-API-DELIVERY.md` | 本文 |

## 接口形状（candidate，非根权威契约）

前缀 `/api/admin/mbti/orders`；`MBTI_RAW` 原始 JSON/CSV；`Cache-Control: no-store`；Foundation JWT + `PermissionsGuard`。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/` | `mbti:orders:read` | `q`（订单号或结果号精确匹配）、`status`、`product_code`、`from`/`to`（成对 UTC 自然日，最多 366 天）、`limit` 1–100、`cursor`；按 `createdAt,id` 降序；白名单订单字段 |
| GET | `/export.csv` | `mbti:ops:access` **且** `mbti:ops:export` | 与列表同一解析器；最多 5000 行，超限 422 不返回部分 CSV；BOM + CRLF；公式转义；审计成功后才返回 |
| GET | `/summary` | `mbti:orders:read` | 必填 `from`/`to`，可选 `channel`；返回 pending/paid/failed、paidOrderCount、grossPaidAmountFen；`netCollectedFen: null` + `refundsUnavailable`；非 `all` 渠道时 `metrics: null` |
| GET | `/:id` | `mbti:orders:read` | 既有按号详情，含支付读取修复；集合查询不触发 repair |

游标为 base64url(`[1, filterFingerprint, createdAtISO, id]`)，筛选或 `limit` 变化后不可复用。金额单位始终为分；不返回 guest/ownerId、支付凭据或联系方式。

导出审计：`module=mbti-orders`，`action=orders_exported`，`resourceType=mbti_order_collection`，`requestSummary={ count, filterCategories }`；读取投影剥离检索词、URL、行 ID 与 CSV。

## 验证

合成/隔离测试，不等于真实 DB、JWT Cookie 或公网四角色验收。

| 命令 | 预期 |
|---|---|
| `cd admin && pnpm test && pnpm lint && pnpm typecheck && pnpm build` | 通过 |
| `cd aij-foundation/apps/api && pnpm test -- test/mbti-ops-orders.test.ts`（及既有 suite） | 通过 |
| `git diff --check` | 无空白错误 |

## 未完成 / blockers

| 项 | 状态 |
|---|---|
| 真实 reader 导出 403、授权账号 list/export/summary 200、无会话 401 | `NOT_RUN / BLOCKED`；原 test55437 owner 缺失 |
| 公网同库 H5 订单与运营列表对账 | `NOT_RUN`；总控协调 |
| 退款、生成重试、体验码、渠道净实收/访问 KPI | 仍 `UI_CONTRACT`；缺 schema/owner |
| 根 `docs/api/` 权威 OpenAPI | 未改；本交付为 candidate |

提交后停写；不 push、不部署、不改数据库或账号。
