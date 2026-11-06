---
verification_status: pending
needs_human_review: true
source_ref: UIhtml/mbti-buddy-product-sop-v0.4.html
---

# MBTI搭子 API 契约索引（Draft）

> **状态：draft / pending Remy 定稿**  
> 本目录下所有文件均为起草稿，**非权威契约**。Owner：**Remy**。  
> 实习生与 Agent **仅可在 Remy 发布定稿后**按正式版本消费；在此之前只可阅读草案辅助实现，**不得**将草案字段当作已定稿业务规则。

## 公网联调 Stub（LIVE — 2026-11-06）

带教周 P0 接口已在公网提供 **内存 stub**，供 H5/前端联调（**不是**生产、**不是** aij-foundation 正式后端）：

| 项 | 值 |
|----|-----|
| H5 | https://mbti-dev.bestshizhongyu.com/ |
| API Base | https://mbti-dev.bestshizhongyu.com/api/v1 |
| 健康检查 | `GET /api/v1/health` → `200` `{"status":"ok","version":"0.1-draft"}`（无鉴权） |
| 鉴权 | 其余路由：`X-Guest-Token: guest_dev_001` 或 Bearer 等价 |

**限制（必读）：** 数据在内存中，**进程/容器重启即丢失**；计分与若干语义仍为 draft；`/admin/` **502 仍为预期**。旧域名 sslip / ganzijiantou 已弃用。

**实习生从这里开始：** [`联调教程.md`](./联调教程.md)（步骤、env、curl 闭环、排障、Git 规则）  
**接口阅读：** [`接口文档-实习生版.md`](./接口文档-实习生版.md)

正式契约定稿与持久化后端 **仍 pending Remy**；stub 上线只表示「可以开始真实 HTTP 联调」，不表示契约已发布。

## 产品来源

- 产品：**MBTI搭子 V0.4** — TEST / CREATE / CONNECT  
- 产品稿：`UIhtml/mbti-buddy-product-sop-v0.4.html`（`source_ref` 同上）

## 本周带教 API 覆盖范围（必须能支撑）

教学闭环：**测 → 结果 → 晒预览 → 阶段记录**

| 环节 | 契约要点 |
|------|----------|
| 测 | 固定 12 道选择题，4 维度 × 3 题；回顾窗口 = 最近 4 周；无自由文本 |
| 结果 | 类型字母（如 INFP）、各维度计数、`question_bank_version`；相同输入 → 相同结果 |
| 来源 | 测试路径 vs 自选类型，字段 `source` = `quiz` \| `self_select` |
| 阶段记录 | 提交时生成不可变快照；复测新增快照不覆盖；对比仅限相同 `question_bank_version` |
| 晒预览 | 客户端可本地渲染；服务端可 stub 图片任务 |
| 隐私 | 历史默认私有；分享图**不得**包含原始答案 |

**声明：** 本产品为趣味倾向体验，**不宣称**标准 MBTI 量表效度或临床诊断效力；API 文档亦不做医学/心理学效度承诺。

## 如何消费（定稿前）

1. 联调实操：[`联调教程.md`](./联调教程.md)。  
2. 阅读 [`resources.md`](./resources.md) 了解资源语义与待定项。  
3. 人类可读接口：[`接口文档-实习生版.md`](./接口文档-实习生版.md)。  
4. 机器可读草案：[`openapi-v0.1-draft.yaml`](./openapi-v0.1-draft.yaml)（OpenAPI 3.0.3，`/api/v1` 前缀）。  
5. 前端/联调：以 OpenAPI 路径为准；缺字段或歧义写入 Issue / 联调笔记，**不要**直接改本目录权威字段。  
6. 变更记录：[`CHANGELOG.md`](./CHANGELOG.md)。

## 文档清单

| 文件 | 说明 |
|------|------|
| `联调教程.md` | 公网 stub 联调步骤（实习生首选实操） |
| `接口文档-实习生版.md` | 带教可读接口说明与 curl 示例 |
| `openapi-v0.1-draft.yaml` | REST 路径、Schema、错误包络 |
| `resources.md` | 人类可读说明、状态码、幂等、版本规则、Remy unknowns |
| `CHANGELOG.md` | 版本沿革 |

## 明确 OUT OF SCOPE（本草案不包含）

以下能力在 V0.4 带教周**不**作为契约交付范围（可在 Remy 定稿后另开版本）：

- 真实支付、订单、退款、兑换码核销  
- 真实微信登录 / 开放平台 session（文档中仅 TODO）  
- 雷达 / LBS 聚合发现  
- 本人照片头像 SKU、AI 形象生成流水线  
- 双向名片交换、联系方式授权状态机（CONNECT 深链路）

定价（如 ¥9.9）仅出现在产品 SOP，**本 API 草案不定义**支付类 endpoint。

## 认证（草案）

- `Authorization: Bearer <token>` 或 `X-Guest-Token: <guest_token>`（联调 stub 常用 `guest_dev_001`）。  
- 微信 `code2session` 等待 Remy 定稿后补充。

---

**再次提醒：draft / pending Remy 定稿 — 勿对外宣称为已发布契约。**
