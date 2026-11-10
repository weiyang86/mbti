# Admin + Foundation 未完成看板

2026-11-10。范围仅 **`admin/`（/ops）** 与 **`aij-foundation/`**。`web/` 由实习生主责，本看板只标「影响他们联调的契约/解闸」，不派 H5 实现卡。

依据：[原型42组覆盖](MBTI-ADMIN-COVERAGE.md)、[V1 对账](MBTI-OPS-V1-DELIVERY.md)、[订单集合交付](MBTI-OPS-ORDERS-API-DELIVERY.md)、Orca `plan.json`（B1–C2/V1）。HEAD 参考：`32dd7af`（订单 list/export/summary）之上的 `dev`。

## 图例

| 可开工 | 含义 |
|---|---|
| **YES** | 现有 schema/权限边界内，agent 可直接写 API+admin（不 invent 字段） |
| **ASK** | 先要 Remy/支付/隐私/模型 owner 定口径或授权，再开工 |
| **ENV** | 代码候选可能已有；缺同库身份/四角色/公网，只能验收不能瞎补环境 |
| **NO** | 外部通道未配或产品未批；保持 UI_CONTRACT / 硬闸 |

Owner 缩写：`Agent`=本会话工程；`Remy`=契约/字段；`Coord`=总控/环境；`Pay`/`Model`/`Privacy`=对应业务 owner；`Intern`=web 联调消费方（不改其页面除非契约变更）。

---

## 1. 立刻可推进（YES）

按「对齐原型运营台」收益排序；每项默认含 foundation API（若缺）+ admin 接线 + 隔离测试 + coverage 行更新。

| # | 项 | 原型/路由 | 缺什么 | Owner | 备注 |
|---:|---|---|---|---|---|
| 1 | 订单集合真实验收脚本（不造账号） | UI-03.1 | 在 *已有* owner 上跑 list/export/summary/403 证据包 | Agent + Coord | ENV 若无 owner 则降为文档探针；不 provision |
| 4 | （已并入本次）覆盖表与看板同步 | — | — | Agent | 见 §5 / coverage UI-01.4、UI-03.1 |

---

## 2. 需 Remy/业务拍板后开工（ASK）

| # | 项 | 原型/路由 | 阻塞点 | Owner | 拍板后动作 |
|---:|---|---|---|---|---|
| 5 | 退款原因与确认 | UI-03.3 | ~~人工申请已接 AF-106~~；到账事实/权益吊销仍缺 | Remy + Pay | 申请路径已交付；回写 MbtiOrder/entitlement 另批 |
| 6 | 体验兑换码账本 | UI-03.4 | 制码/核销身份、次数、权益种类 | Remy | 隔离账本 API + admin 标签页 |
| 7 | 生成任务队列/重试 | UI-03.2 / UI-01.3 | 任务持久化、与 unlocked 分离、幂等审计 | Remy + Model | admin 任务标签 + API |
| 8 | 匿名治理工单 | UI-04.1–04.2 | 匿名字段白名单、只读 vs write 权限码 | Remy + Privacy | 管理端列表/处置；**禁用 guest 社交当运营源** |
| 9 | 净实收 / 按日趋势 | UI-01.1–01.2 | 退款事实、归属日、币种隔离 | Remy + Pay | summary 扩展或独立 metrics |
| 10 | 渠道经营/传播报表 | UI-02.* / UI-01.4 growth | MBTI 表无渠道字段；访问/分享事件源 | Remy | 有事件表才能接；否则永不可用 |
| 11 | 成熟队列/复测对比率 | UI-09.2 | cohort 定义、渠道时间归属 | Remy | 聚合 API + retention 页 |
| 12 | mbti-config 正式字段/角色映射 | C1 unknowns | prototype→storage、每类读写/发布角色、商户凭据族 | Remy | 议题包：[MBTI-REMY-UNKNOWNS.md](MBTI-REMY-UNKNOWNS.md)；定稿前保持 candidate + needs_human_review |
| 13 | H5 匿名 published 投影解闸 | C2 硬闸 | 公开字段集、渠道、与实习生消费映射 | Remy → Intern 消费 | foundation 解闸；**web 改动归实习生** |
| 14 | 支付商户 SecretRef 真接 | UI-12.* | 获批商户/证书/沙箱 | Pay + Remy | 替换 UNCONFIGURED；B5 演练≠真实验签 |
| 15 | AI 真网关 health/generate | UI-05/11 | 供应方、费用、上传所有权 | Model + Remy | 保留本机 kit；另开真实通道 |

---

## 3. 环境阻塞（ENV）— 不重造账号

| # | 项 | 状态 | Owner | Agent 可做 |
|---:|---|---|---|---|
| 16 | 四角色登录/刷新/CSRF/注销 | BLOCKED（test55437 owner 缺失） | Coord | 准备验收清单与命令；不 seed |
| 17 | 同公网 H5 单 ↔ 运营 list/详情 | BLOCKED | Coord + Intern（出单） | 对账清单；不复制旧 LAN 单冒充 |
| 18 | 双浏览器 draft→publish→rollback | BLOCKED + H5 PENDING | Coord + Remy | 步骤剧本；不解闸 |
| 19 | 进程/DB 重启后会话与配置持久 | NOT_RUN | Coord | 检查项列表 |

---

## 4. 明确先不做 / 保持禁用（NO）

| 项 | 原因 |
|---|---|
| 把 guest 社交/订单 API 当运营枚举源 | 权限与投影错误 |
| 用支付 provider 冒充获客渠道 | 无渠道字段 |
| 把毛额标成净实收、把 — 标成 0 | 误导经营 |
| 根 `docs/api/` 权威定稿 | 未经 Remy |
| 合 main / 生产部署 / 真扣款 / 小程序提审 | 另授权 |
| 主动改 `web/` 页面 | 实习生主责；契约变更另通知 |

---

## 5. 已接通（勿重复开工）

| 能力 | 证据口径 |
|---|---|
| B1 `/ops` 壳、会话客户端 | LOCAL；真角色 ENV |
| 订单按号 + 列表/筛选/游标/CSV/summary | API_CONSUMER + 隔离测试；真 HTTP ENV |
| overview 订单 KPI（pending/paid/failed/毛额） | 同上；净实收仍不可得 |
| overview 订单派生报表 CSV（#2） | 复用 orders/export.csv；渠道/净实收不发明；growth 仍 UI_CONTRACT |
| mbti-config 类目×角色矩阵测试（#3） | Nest 替身；H5 `MBTI_PUBLIC_APPROVED=false` 仍硬闸 |
| Remy unknowns 议题包（#12 文档） | [MBTI-REMY-UNKNOWNS.md](MBTI-REMY-UNKNOWNS.md)；待批注 |
| 订单人工退款申请（#5 部分） | `POST .../orders/:id/refund-requests` → AF-106；admin 详情可提交；不打款/不吊销 |
| B3–B5 配置上方面板 ↔ mbti-config | 本地替身 API_CONSUMER；H5 硬闸 |
| B4 本机双图 kit | LOCAL；真模型 NO |
| C1 插件候选 / C2 consumer | 候选；正式字段 ASK |

---

## 6. 建议下一迭代切片（给总控/本会话）

在 **不恢复 DB** 前提下，默认顺序：

1. ~~**#2** overview CSV~~、~~**#3** 权限矩阵测试~~、~~**#12 议题包**~~ 已交付文档/测试  
2. **候选契约包**：[MBTI-OPS-CANDIDATE-CONTRACTS.md](MBTI-OPS-CANDIDATE-CONTRACTS.md)（退款优先复用 AF-106）— 待 Remy 批注  
3. **#1** 真实验收探针（有 owner 才跑；否则文档化阻塞）  
4. 任一 **ASK** 项获批后，立刻开对应 foundation+admin 卡；建议顺序：退款申请 → 兑换码 → 任务读路径 → 工单 → 报表/解闸  

V1 全绿仍依赖 **§3 ENV**；看板完成 ≠ V1 通过。

---

## 7. 与实习生的分界

| 他们 | 我们 |
|---|---|
| `web/` 页面、联调笔记、H5 演示 | `admin/`、`aij-foundation/` API/插件 |
| 消费已发布/候选契约 | 写/守契约候选；缺字段列 unknowns |
| 提供同环境订单号做对账（Coord 协调） | 运营侧读路径与权限证据 |

契约变更时在交付文档写清：路径、字段、权限、破坏性；由 Coord 转 Intern。
