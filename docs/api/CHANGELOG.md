---
verification_status: pending
needs_human_review: true
source_ref: UIhtml/mbti-buddy-product-sop-v0.4.html
---

# API 变更日志（Draft）

> **draft / pending Remy 定稿** — 以下条目不代表已发布契约。

## [v0.1-draft] — 2026-11-04 (Asia/Shanghai)

- 首版 OpenAPI 草案：`openapi-v0.1-draft.yaml`  
- 覆盖带教闭环：健康检查、题库版本、测验会话、结果快照、16 型元数据、分享预览 stub、结果对比  
- 定义错误包络 `{ code, message, details? }`  
- 标注 OUT OF SCOPE：支付、真实微信登录、雷达、照片 SKU  
- 人类可读补充：`resources.md`  
- **待 Remy：** 计分规则细节、微信登录、分享图任务 SLA、删除策略等（见 `resources.md` unknowns）

## [docs] — 2026-11-06 (Asia/Shanghai)

- 公网 P0 **内存 stub** 已可用于联调：`https://mbti-dev.bestshizhongyu.com/api/v1`（health 无鉴权；其余需 `X-Guest-Token: guest_dev_001`）
- 新增 [`联调教程.md`](./联调教程.md)：Base URL、Mock vs 真实、`VITE_*`、curl 闭环、常见失败、Git 分支规则
- 新增 [`接口文档-实习生版.md`](./接口文档-实习生版.md)：对齐 live stub 的 readable 接口说明（仍为 draft）
- 更新 [`README.md`](./README.md)：标注 stub LIVE、链接教程；**正式契约与持久化后端仍 pending Remy**
- 弃用文档中的 sslip / ganzijiantou 公网入口表述
