---
verification_status: pending
needs_human_review: true
source_ref: UIhtml/mbti-buddy-product-sop-v0.4.html
---

# 资源说明（Draft）

> **draft / pending Remy 定稿** — 与 `openapi-v0.1-draft.yaml` 配套；冲突时以 Remy 定稿 OpenAPI 为准。

## 通用约定

- **Base URL：** `{host}/api/v1`（前端通过 `VITE_API_BASE_URL` 配置，见 `web/.env.example`）  
- **Content-Type：** `application/json; charset=utf-8`  
- **认证（stub）：**  
  - `Authorization: Bearer <access_token>`，或  
  - `X-Guest-Token: <guest_token>`（游客联调）  
  - 微信登录：**TODO** — Remy 定稿后补充 `POST /auth/wechat` 等  
- **错误包络：**

```json
{
  "code": "string_machine_code",
  "message": "human readable",
  "details": {}
}
```

| HTTP | 典型 `code` | 说明 |
|------|-------------|------|
| 400 | `invalid_request` | 参数校验失败 |
| 401 | `unauthorized` | 缺少或无效 token |
| 404 | `not_found` | 资源不存在 |
| 409 | `conflict` | 状态冲突（如重复 submit） |
| 422 | `unprocessable` | 语义错误（如对比版本不一致） |
| 500 | `internal_error` | 服务端错误 |

## 资源一览

### Health

- `GET /health` — 存活探针，无鉴权要求（草案）。

### Quiz — 题库与会话

**`GET /quiz/versions/current`**

- 返回当前生效 `question_bank_version` 与 12 道 `Question`。  
- 每题含 `dimension`（E/I、S/N、T/F、J/P 之一侧记为 `EI|SN|TF|JP`）、`options`（固定选项，无自由文本）。  
- 产品规则：4 维度 × 3 题；答题指引回顾 **最近 4 周**（文案层，非 API 校验字段）。

**`POST /quiz/sessions`**

- 创建测验会话，绑定当前 `question_bank_version`。  
- 返回 `QuizSession`（`status`: `in_progress`）。

**`PUT /quiz/sessions/{session_id}/answers`**

- 批量或增量更新答案；会话未完成前可修改。  
- Body：`answers[]`（`question_id` + `option_id`）。

**`POST /quiz/sessions/{session_id}/submit`**

- **幂等：** 同一 `session_id` 仅允许成功 submit **一次**；重复请求 → `409 conflict`。  
- 服务端计分（规则 **待 Remy 定稿**），生成 `ResultSnapshot`：`source=quiz`，含 `type_code`、各 `dimension_counts`、`question_bank_version`。  
- 可选背景字段（仅存储，不参与计分）：`life_stage`、`recent_status`。

### Results — 阶段快照

**`GET /results`**

- 当前用户的快照列表（**默认私有**，不暴露给他人）。  
- 按 `submitted_at` 降序；不含原始答案明细（列表层仅摘要）。

**`GET /results/{id}`**

- 单条快照详情；quiz 来源可含 `dimension_counts`；**分享场景不应返回**可用于还原答题的敏感组合（草案：详情接口仍含 counts，不含 option 级明细 unless Remy 定稿）。

**`DELETE /results/{id}`**

- 用户删除自己的快照（软删/硬删 **待 Remy 定稿**）。

**`GET /results/compare?baseline_id=&target_id=`**

- 对比两次快照的四维计数与类型变化。  
- **约束：** `baseline` 与 `target` 的 `question_bank_version` **必须相同**；否则 `422 unprocessable`。  
- 相同答案/计数可标记为 stable（响应字段见 `CompareResult`）。

**`POST /results`**（自选类型路径）

- Body：`type_code`（16 型之一）、`source=self_select`（必填且必须为 `self_select`）。  
- 可选：`life_stage`、`recent_status`。  
- 生成无答题明细的快照，供「我已经知道 MBTI」入口使用。

### Types — 16 型元数据

**`GET /types`**

- 返回 16 型 `TypeMeta`（代码、展示名、短描述等），供自选与结果页展示。  
- **非**临床/官方认证文案。

### Share — 晒图预览（stub）

**`POST /share/preview`**

- 请求生成分享预览（服务端可 stub）。  
- 响应：`preview_url` **或** 异步 `job_id`（二选一或同时返回 **待 Remy 定稿**）。  
- **禁止**在预览 payload 中携带原始答题选项；客户端本地渲染时亦不得绘制 raw answers。

## 版本与计分（草案规则）

| 规则 | 说明 |
|------|------|
| `question_bank_version` | 题库变更时递增；历史快照保留提交时的版本 |
| 确定性 | 相同版本 + 相同 12 选项 → 相同 `type_code` 与 counts |
| 快照不可变 | submit 后该快照不随新测验改变 |
| 复测 | 新 submit → **新** snapshot id |
| 对比 | 仅 `question_bank_version` 相同的两条 |

计分映射表（选项 → 维度计数 → 类型字母）**未**在本草案中固化，标记为 Remy unknown。

## 幂等与并发

- `submit`：按 `session_id` 一次；客户端应用 409 作为已完成信号。  
- `PUT answers`：可多次直到 submit。  
- 自选 `POST /results`：每次创建新快照（是否去重 **待 Remy 定稿**）。

## Unknowns / 待 Remy 定稿

1. 各题 `option_id` → 维度计分的权威映射表存放位置与格式  
2. `type_code` 平局或边界时的 tie-break 规则  
3. 微信登录与 user id 绑定、guest token 升级策略  
4. `GET /results/{id}` 是否对 quiz 快照返回 per-question 摘要（教学是否需要）  
5. 分享 `job_id` 轮询 endpoint、CDN URL 有效期  
6. 删除快照后的对比/分享引用处理  
7. 分页：`GET /results` cursor vs offset  
8. 速率限制与 abuse 策略  
9. 服务端是否校验「最近四周」答题声明（或纯 UX 文案）  
10. self_select 快照是否允许后续被 quiz 快照「覆盖」展示（产品倾向：并存，不覆盖）

---

**draft / pending Remy 定稿**
