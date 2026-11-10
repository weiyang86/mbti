# Remy unknowns 议题包（Admin + Foundation）

2026-11-10。供 Remy 批注；**不定稿根 OpenAPI、不猜字段、不解闸 H5**。候选现状见 [C1](MBTI-ADMIN-C1-DELIVERY.md) / [C2](MBTI-ADMIN-C2-DELIVERY.md) / [看板](MBTI-ADMIN-FOUNDATION-BACKLOG.md)。响应继续带 `status: needs_human_review` 与 `unknowns`。

请在每条下写：`批准 / 改写 / 延后` + 一句话口径。未批前 Agent 只守候选与硬闸。

---

## A. mbti-config 正式字段与 ID

| # | 议题 | 候选现状 | 需要拍板 |
|---|---|---|---|
| A1 | 11 类词表是否定稿 | `content/channels/catalog/assessment/personas/imageRecipes/retention/discovery/aiRuntime/payments/trade` | 增删改类名？是否拆 `catalog.shop` / `catalog.styles`？ |
| A2 | 原型控件 → 存储字段 | B3 fixture 映射进 candidate shape | 哪些控件进正式 schema；哪些永远本机演练 |
| A3 | 业务 ID 稳定性 | 价格/题号/人格码多为文案容器 | 正式商品 ID、题库版本、人格码是否另表；是否允许改码 |
| A4 | 空值语义 | `null` / `UNCONFIGURED` / `needs_human_review` 三分 | 是否允许「已发布但仍 UNCONFIGURED」对 H5 可见 |

---

## B. 角色与权限映射

| # | 议题 | 候选现状 | 需要拍板 |
|---|---|---|---|
| B1 | 平台权限复用 | 读/存：`admin.config.manage`；系统类+发布/历史/审计：超管 + `admin.secret.manage` | 是否引入 `mbti:config:*` 细码；四角色（owner/editor/support/reader）如何映射 |
| B2 | 系统三类 | `aiRuntime` / `payments` / `trade` 仅 system 可读可写 | editor 是否只读投影；support 是否完全不可见 |
| B3 | 发布权 | `canPublish` ≡ system（超管∧secret） | publisher 角色是否单独存在；是否允许「有 CONFIG+SECRET 但非超管」发布 |
| B4 | B1 ops 能力 | `mbti:ops:access/export/moderation:write/draft:write` 与配置权限正交 | 一张角色矩阵表（页面显隐 ≠ 服务端授权） |

---

## C. H5 匿名 published 投影（#13）

| # | 议题 | 候选现状 | 需要拍板 |
|---|---|---|---|
| C1 | 解闸开关 | `MBTI_PUBLIC_APPROVED = false`；有效渠道 404 | 批准公开字段集与渠道后由 Remy 显式改码；禁止 env 旁路 |
| C2 | 公开类目 | 仅 8 类非系统；`channels` 按单渠道切片 | 是否再砍字段（价格、题干、雷达半径等） |
| C3 | Intern 消费 | web 未接；永远回退 | 解闸时契约说明路径/字段/缓存键；**web 改动归实习生** |
| C4 | revision adapter | C1 整数 version ≠ consumer opaque revision | C2 adapter 定稿时机与破坏性 |

---

## D. 支付 / 退款 / 兑换（牵连 #5/#6/#14）

| # | 议题 | 候选现状 | 需要拍板 |
|---|---|---|---|
| D1 | 商户 SecretRef 族 | payments 恒 `enabled:false` + `UNCONFIGURED` | 获批商户/证书/沙箱；凭据投影白名单 |
| D2 | 退款写路径 | 订单详情退款按钮禁用 | 可退条件、到账事实源、人工 vs 回调、权限码 |
| D3 | 体验兑换码 | 无隔离账本 | 制码身份、次数、权益种类、停用语义 |
| D4 | 净实收 | overview 恒 null；毛额 ≠ 净额 | 退款归属日、币种隔离、是否进 summary |

---

## E. 运营治理与报表（牵连 #7–#11）

| # | 议题 | 候选现状 | 需要拍板 |
|---|---|---|---|
| E1 | 生成任务队列 | 不把 `unlocked` 当交付 | 任务持久化模型、与订单关系、重试幂等 |
| E2 | 匿名治理工单 | 禁用 guest 社交当运营源 | 匿名字段白名单；只读 vs `moderation:write` |
| E3 | 渠道经营报表 | MBTI 订单表无渠道字段 | 访问/分享事件表是否建；禁止用支付 provider 冒充渠道 |
| E4 | 复测/成熟队列 | retention 页口径呈现 only | cohort 定义与渠道时间归属 |

---

## F. 模型与 AI（牵连 #15）

| # | 议题 | 候选现状 | 需要拍板 |
|---|---|---|---|
| F1 | 真网关 | 本机 image-kit；aiRuntime 无 live mode | 供应方、费用、上传所有权、health/generate 契约 |
| F2 | credentialRef | 仅元数据；响应/审计剥离 | 正式绑定流程与轮换 |

---

## 批注后默认动作

1. Remy 在本文件批注或另开签发记录。  
2. Agent 只对 **批准** 项开 foundation+admin 卡；**改写** 先改候选 schema/测试再接线。  
3. **#13 解闸** 时同步 Intern 契约说明，不代改 `web/`。  
4. 未批项保持 UI_CONTRACT / 硬闸；不进根 `docs/api/` 权威定稿。

`needs_human_review`：本页全部议题在 Remy 签字前均属 unknowns。
