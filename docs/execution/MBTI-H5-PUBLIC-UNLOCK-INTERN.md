# H5 published 解闸说明（实习生）

2026-11-10。Admin/Foundation 已将 `MBTI_PUBLIC_APPROVED=true`（源码常量，**禁止**用环境变量旁路）。**`web/` 改动归实习生**；本文件只说明契约。

## 路径

`GET /api/v1/config/published?channel=wechat|mp|douyin|xhs`

- 恰好一个 `channel`；重复/额外 query（draft/view/projectId/environment/version）→ 400
- 插件未启用 / 未安装 → 404；项目环境归属不可用 → 503
- `Cache-Control: no-store`

## 投影字段

响应候选：`schema: mbti-config-candidate/v1`，`status: needs_human_review`，`view: published`。

公开类目仅 8 类（**无**系统三类）：

`content` / `channels`（单渠道切片） / `catalog` / `assessment` / `personas` / `imageRecipes` / `retention` / `discovery`

**不会**出现：`aiRuntime`、`payments`、`trade`、SecretRef、商户号、凭据。

## 消费建议

1. 按 `channel` 缓存键使用响应里的 `cacheIdentity`（服务端已算好）。
2. 把 `needs_human_review` 当候选；缺字段不要 invent。
3. 未接通前请保留本地回退；解闸后仍可能因无 published 快照得到空/默认候选。

## 仍阻塞（与 H5 解闸正交）

| 项 | 状态 |
|---|---|
| 真支付商户 SecretRef | **NO** · 等 Pay owner |
| 真 AI 网关 | **NO** · 等 Model owner；admin 保留本机 kit |
| 访客兑换码核销 | ASK |
| 退款到账回写 entitlement | ASK |
