---
verification_status: pending
needs_human_review: true
source_ref: UIhtml/mbti-buddy-product-sop-v0.4.html
---

# API 变更日志（Draft）

> **draft / pending Remy 定稿** — 以下条目不代表已发布契约。

## [v0.1-draft] — 2026-11-04 (Asia/Shanghai)

- 新增实习生友好接口文档：`接口文档-实习生版.md`（固定「接口 / 请求参数 / 返回示例」三段式；按测 → 结果 → 晒预览 → 阶段记录排序；含通用约定与总览表）  
- `README.md`：将实习生版列为首选阅读  
- **不改** OpenAPI 业务语义与 mock 代码；yaml ↔ mock 差异见对应 PR 描述  
- 首版 OpenAPI 草案：`openapi-v0.1-draft.yaml`  
- 覆盖带教闭环：健康检查、题库版本、测验会话、结果快照、16 型元数据、分享预览 stub、结果对比  
- 定义错误包络 `{ code, message, details? }`  
- 标注 OUT OF SCOPE：支付、真实微信登录、雷达、照片 SKU  
- 人类可读补充：`resources.md`  
- **待 Remy：** 计分规则细节、微信登录、分享图任务 SLA、删除策略等（见 `resources.md` unknowns）
