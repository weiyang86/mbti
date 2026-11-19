# AIJ 剩余任务队列与执行 Prompt

更新时间：2026-10-29。本文是剩余任务范围与可复制启动指令的规划底稿；写入本文不代表批准或启动任何下一批。机器可读状态见 [CODING_QUEUE.json](CODING_QUEUE.json)，批内执行规则见 [BATCH_WORKFLOW.md](BATCH_WORKFLOW.md)。


## 当前入口状态（2026-11-02）

NEXT-19A 与 NEXT-19B 已完成代码校验；NEXT-19B 的工作区汇总快照及状态对账已推送。NEXT-19C/G19-08/AF-115 现已完成代码校验，负责人统一验收/接收仍待执行；NEXT-19A/B 的待验状态未改变。当前没有获批的下一张 G19 实现卡；本文件下方批次 Prompt 是历史规划，不能直接启动。最新剩余事项与候选建议见 [AIJ 剩余工作状态总览](AIJ_REMAINING_WORK_STATUS.md) 和 [AIJ 剩余工作卡索引](AIJ_REMAINING_WORK_INDEX.md)。

## 当前交接状态

- UI-2（AF-030–AF-033）已由负责人确认接收；提交在 `dev`，HEAD 为 `91b7d3dfe8942ed4f4bb81b5fa90147d3f4ddf9f`。人工验收仍待负责人操作，30 分钟续跑保持暂停。
- UI-1（AF-026–AF-029）及 AF-025-A 仍待负责人接收。UI-2 的接收不自动接收它们。
- 后续不使用 Trea 复核。每批由 Codex 单 Writer 完成实际实现、校验、修复和记录，再交负责人验收。
- 负责人已分别单卡批准 G6-01/AF-035、G6-02/AF-036、G6-03/AF-037、G6-04/AF-038，并单批批准 NEXT-03/G4-01至G4-03。G6-01/AF-035、G6-02/AF-036、G6-03/AF-037 均于2026-10-29完成真实校验；AF-037本轮5/5真实HTTP/PostgreSQL/Next测试、lint/typecheck通过，负责人统一人工验收待执行。G6-04/AF-038已完成真实 HTTP/PostgreSQL/生产 Next 校验（4/4用例）、lint/typecheck通过；统一人工验收待执行。G7-01/AF-042已通过真实 PostgreSQL 校验（73/73策略回归、5/5数据库断言、lint/typecheck通过）。NEXT-01的G6-01至G6-04均为CODE_VERIFIED，但整批状态仍为`PROPOSED_NOT_AUTHORIZED`且统一负责人验收待执行。负责人于2026-10-29明确授权NEXT-02剩余G7-02/AF-043、G7-03/AF-044；两卡现已完成代码校验，NEXT-02为`CODE_VERIFIED_OWNER_CHECK_PENDING`，等待一次统一人工验收/负责人接收，不自动继续其他批次。AF-043通过API/Web构建、54项执行器回归、6项真实HTTP/数据库用例及lint/typecheck；人工准备钩子为PREPARED，但本机shell HTTP连通性未验证，浏览器交互待负责人观察。AF-044通过6项真实HTTP/PostgreSQL Readiness/恢复断言、Prisma validate、API build、lint/typecheck。详细过程和限制见[AF-043](../execution/AF-043.md)、[AF-044](../execution/AF-044.md)。NEXT-03明确允许AF-025-A待验状态叠加但不接收；AF-039已由负责人确认代码交付，AF-040和AF-041均通过真实 HTTP/PostgreSQL 及适用质量门禁。NEXT-03三卡统一人工验收与批次接收待负责人处理；模块优化是验收后的阶段，周期自动化保持暂停。AF-025-A仍待负责人确认；其他批次按队列状态管理，不自动启动。
- 起始快照及四份规划文档 hash 见忽略目录 `.artifacts/remaining-plan-2026-10-28/baseline.json`。规划期间不启服务、不连接数据库、不访问或写入轻企源库。

## 全批通用 Prompt 约束

下面每个批次代码块都可单独复制。它们依赖本节公共约束和该批次列出的卡片范围：

1. 写入前读取根 `AGENTS.md`、`CURRENT_STATE.md`、本队列、实际 package/verify 注册和相关执行记录；核对 branch、HEAD、status、diff；保留所有继承差异并保存本批基线。
2. 本库唯一 Writer；轻企仓库只读；只定向看需要的源码。先确认前置能力与数据 owner 真实存在，缺依赖就记阻塞或在 4 小时内拆卡，不假造功能。
3. 逐卡实现，复用现有 Controller/Service/DTO/Guard/Prisma owner。为本批正式任务注册真实 `verify:task`；覆盖成功、拒绝和必要恢复路径。真实数据库/HTTP/文件/队列必须实际运行；离线 fixture 只能证明协议。
4. 代码任务执行已有 lint/typecheck；Schema 执行 validate/generate 和受保护的新验收库迁移；Web/包改动构建实际受影响目标。保存实际命令参数、各退出码、用例和断言证据，不用输出文本冒充成功。
5. 仅使用本库隔离开发/测试配置和合成数据；目标保护先于写库；不 reset/drop/清空共享卷，不停其他项目进程，不打印真实凭据。真实短信、付费模型、支付、生产接入由负责人手动触发。
6. 更新每卡执行记录、队列状态和必要的 `CURRENT_STATE.md`。批末停止并交付，状态 `OWNER_CHECK_PENDING`；不自动接下一批，不做 Trea 复核，不把自动通过写成负责人验收。
7. Git add/commit/push、分支、PR、merge、tag、发行、部署仍由负责人控制；除非负责人在该批指令中再次明确授权，不执行这些节点。

## 剩余工作包与先决条件

估时沿用当前单 Writer 规划，包含实现、目标校验和普通修复；不是模型运行时间承诺。每个批次不超过 4 卡/12 小时，卡片预计超过 4 小时就拆分。目标发布渠道、许可、支持平台仍待负责人裁定；本地打包验证不等于获准发行。

| 工作包 | 规划范围 | 估时 | 关键依赖 / 状态 |
| --- | --- | ---: | --- |
| G0–G3 | UI-1/UI-2 前置、管理员浏览器、后台页与闭环 | 已有交付；UI-2 已接收 | UI-1、AF-025-A 仍待接收；不重复编码 |
| G4 | 客户退出、会话撤销、改密、同意记录 | 7–9h | AF-025-A 先由负责人接收，或负责人对具体批次显式批准叠加 |
| G5 | 客户注册、身份验证、凭据找回 | 8–10h | G4；通知通道合同/配置；真实发送需人工凭据 |
| G6 | 剩余管理面与客户基础管理 | 16–20h | 复用现有 API；客户管理卡在 G4/G5 后 |
| G7 | 核心后台独立运行回归 | 4–5h | UI-2；本库独立测试目标可用 |
| G8 | 文件服务与页面 | 10–12h | 现有 FileAsset/schema 核验；本地隔离存储根 |
| G9 | 异步运行时 | 12h | 独立测试 DB；任务/Outbox owner 核验 |
| G10 | 通用 Workspace 闭环 | 16–20h | G9 前后端隔离测试；服务端成员/权限校验 |
| G11 | 插件生命周期 | 16–20h | G12 插件契约；不能默认启用所有插件 |
| G12 | Core/SDK/Runtime/Contracts/UI 实包 | 20–28h | 来源、许可和包 owner 审核；不先发布 |
| G13 | 新项目安装、升级、恢复、base 本地终验 | 16h | G8–G12；许可/渠道未定时只做本地 pack/install |
| G14 | 通知最小插件 | 8–10h | G9 队列、G11 生命周期；fixture 不等于真实投递 |
| G15 | AI 执行、Trace、Cost | 12–16h | G9/G11/G12；不调用真实付费模型 |
| G16 | AI 管理与组合验收 | 10–12h | G15；权限和审计按真实结果接入 |
| G17 | Integration | 12–16h | G9/G11/G12；签名、幂等、重试和密钥引用 |
| G18 | Payment 轨道与页面 | 14–20h | G9/G11/G12；不发起真实扣款/退款 |
| G19 | 高级 AI 场景决策 1–2h；实现暂估 28–44h | 实现估算须在决策后重估 | **阻塞于负责人选定场景、模型/Provider、预算、验收集和数据边界**；先执行决策卡，不预写业务实现 |

## 建议批次顺序、卡片与启动 Prompt

### NEXT-01：系统管理页面

**范围：G6 管理面第一段；4 卡，估时 8–10h。** 只接后端实际已存在的字典、配置、SecretRef、审计 API；先从路由注册和 DTO 核对端点，不猜路径。

- `G6-01` 字典分类与条目页面：分页/排序/状态、重复 code 错误、停用项行为；验证写权限与审计。
- `G6-02` 项目/组织配置页面：展示 scope 和版本；并发版本冲突清晰提示；公开上下文不泄密。
- `G6-03` SecretRef 页面：只展示引用和 configured 状态；设置/轮换/清除；任何响应、错误和日志都不能回显 secret。AF-037 已完成真实 HTTP/PostgreSQL/生产 Next 校验（5/5用例）、lint/typecheck；负责人统一人工验收待执行，详见执行记录。
- `G6-04` 审计查询页面：分页过滤、敏感字段去敏、无权读取拒绝；不把页面权限代替 API Guard。**G6-04/AF-038已代码校验通过**，统一人工验收待负责人处理，见执行记录。

**历史启动 Prompt（本批已完成，不构成下一次授权）：**

```text
批准启动 NEXT-01，仅执行 REMAINING_TASK_PROMPTS.md 中 NEXT-01 / G6-01 至 G6-04；Codex 为唯一 Writer，不做 Trea 复核。按通用约束先存基线，核验现有 API 后实现四个管理页面，逐卡接真实接口并覆盖权限拒绝、并发冲突、去敏和失败态。批内真实校验/修复/记录；不改下一批、不启动服务以外的外部接入；完成或硬阻塞后停止，交 OWNER_CHECK_PENDING。Git 节点按负责人控制规则执行。
```

### NEXT-02：核心后台独立回归与客户管理只读视图

**范围：G7 全部；3 卡，估时 4–5h。** 客户管理页放在 NEXT-14，避免在 G4 会话/同意接口之前绑定不完整契约。当前 NEXT-02 由负责人授权只继续 G7-02、G7-03；G7-01 已先行代码校验。

- `G7-01/AF-042` 新建/确认隔离验收 DB，验证迁移、status 和幂等 Seed；不得清理旧 lease。**G7-01/AF-042 已代码校验通过**（真实数据库5/5、策略回归73/73、lint/typecheck通过）；统一人工验收待负责人执行，见执行记录。
- `G7-02/AF-043` 管理员/普通角色真实 HTTP 与浏览器回归：登录、菜单、直调 401/403、授权后成功。**代码校验已完成**，API/Web build、54项执行器回归、6项真实HTTP/数据库用例、lint/typecheck通过，见执行记录；人工浏览器交互仍待统一验收。
- `G7-03/AF-044` 真实服务重启/DB 不可用与恢复测试；readiness、连接释放和去敏错误一致。**代码校验已完成**，6项真实HTTP/PostgreSQL断连恢复、Prisma validate、API build、lint/typecheck通过，见执行记录。

**可复制 Prompt：**

```text
NEXT-02 已完成，不要重复执行以上历史启动指令。当前队列状态为两卡 `CODE_VERIFIED`、统一负责人验收待执行；本批没有提交或推送，也没有授权下一批。负责人统一验收后再单独决定后续卡片。
```

### NEXT-03：AF-025-B 客户会话与同意记录（G4）

**范围：G4；3 卡，估时 7–9h。前置门：AF-025-A 负责人接收，或负责人明确允许本批保留其待验状态继续。**

- `G4-01` 客户登出/单会话及全会话撤销；严格按 project/issuer/audience 隔离。
- `G4-02` 改密/重新认证；按策略撤销旧会话，限制重复尝试，审计去敏。
- `G4-03` 同意版本、时间、来源和撤回记录；幂等写入；不宣称账号注销/导出已实现。

**可复制 Prompt：**

```text
批准启动 NEXT-03，仅执行 REMAINING_TASK_PROMPTS.md 中 G4-01 至 G4-03（AF-025-B 范围）。启动前必须确认 AF-025-A 已接收；若仍待验，只有本次指令明确允许叠加才继续。复用客户 Auth/Prisma owner，管理员会话不可受影响。真实 DB/HTTP 覆盖登出、改密、跨项目撤销、重放/过期拒绝和同意审计。不得复制轻企客户数据；不得把账号导出/注销列为完成。唯一 Writer、无 Trea；批末交付并停止。
```

### NEXT-04：安全文件能力（G8）

**4 卡，估时 10–12h。** 仅本地隔离存储适配；不接云存储凭据。

- `G8-01` FileAsset owner/关联规则和存储 adapter，按项目存储根隔离。
- `G8-02` 上传 API：类型/大小限制、路径净化、写入后元数据一致性。
- `G8-03` 下载、删除、访问控制与失败回滚；不能靠不可猜 URL 授权。
- `G8-04` 后台/客户上传查看入口与真实文件测试；验收跨项目拒绝、损坏/缺失文件和清理。

**可复制 Prompt：**

```text
批准启动 NEXT-04，仅执行 REMAINING_TASK_PROMPTS.md 中 G8-01 至 G8-04。先核对已有 FileAsset schema 和 owner，再实现本库本地隔离存储，禁止扫描或复用轻企上传目录。测试真实文件写入/读取/删除、路径穿越、越权、体积/类型拒绝和 DB/文件失败回滚；保留本批合成测试文件于任务忽略目录并记录清理命令。代码门禁、真实 API/文件校验和执行记录完成后停止，状态待负责人验收。
```

### NEXT-05：持久化异步运行时（G9）

**4 卡，估时 12h；如果现有基础不存在，停下拆分，不以内存队列代替持久化。**

- `G9-01` Outbox/Job 最小字段、owner、唯一幂等键与事务性提交。
- `G9-02` Worker lease/claim、并发执行保护、超时与优雅关闭。
- `G9-03` 有界重试、退避、死信/最终失败状态、重复消息不重复副作用。
- `G9-04` readiness/监控查询和恢复测试；敏感 payload 不写日志。

**可复制 Prompt：**

```text
批准启动 NEXT-05，仅执行 REMAINING_TASK_PROMPTS.md 中 G9-01 至 G9-04。定向核查已有 Job/Outbox schema、Prisma owner 和运行时；没有持久化基础就先提出子卡。不得加入“测试通过但内存实现”的替代。使用本库独立测试库实际验证事务、并发 claim、重试/死信、进程退出恢复和幂等；测试目标先执行 db:check。注册真实 verify 项、跑 lint/typecheck 与 API build，记录命令和证据，批末停写待验。
```

### NEXT-06：Workspace 成员与服务端上下文（G10 数据段）

**4 卡，估时 10–12h；Workspace 是客户租户，不能拿 Project/OrganizationProfile 替代。**

- `G10-01` 核实现有 Workspace/Membership；必要时新增最小 schema/migration，不迁业务企业资料。
- `G10-02` 服务端 workspace context resolver/guard，逐请求验证会话、成员、状态和权限。
- `G10-03` Workspace/Membership CRUD 与角色绑定；并发离开/停用状态有一致语义。
- `G10-04` DB/HTTP 成功和跨租户拒绝；伪造 workspaceId、管理员与客户身份混淆均拒绝。

**可复制 Prompt：**

```text
批准启动 NEXT-06，仅执行 REMAINING_TASK_PROMPTS.md 中 G10-01 至 G10-04。Workspace 必须与 Project/OrganizationProfile 分离；服务端不可信任请求自报 workspaceId。先核对 schema 与 F00 owner 清单，再做必要迁移。用真实 DB/HTTP 测合法成员、非成员、停用成员、跨 workspace ID 篡改与权限变更；不迁企业档案、IP、订单或真实用户。批末记录验证后停止，不进入插件批次。
```

### NEXT-07：Workspace Web 与集成验收（G10 UI 段）

**2 卡，估时 6–8h；依赖 NEXT-06。**

- `G10-05` Workspace 切换/成员管理页，仅呈现服务端授权的 workspace 与可用操作。
- `G10-06` 浏览器多账号/跨租户回归、退出和失效体验；切换不得只改本地 ID。

**可复制 Prompt：**

```text
批准启动 NEXT-07，仅执行 REMAINING_TASK_PROMPTS.md 中 G10-05 至 G10-06。依赖 G10 服务端 context/API 已 CODE_VERIFIED；页面不能自行决定 tenant。用真实浏览器和合成账号验证成员范围、无权限空态、篡改 workspaceId、账号切换/退出；跑受影响 Web build 与测试。缺真实 API 就阻塞，不构造假菜单/数据。完成执行记录后停止。
```

### NEXT-08：可消费的 AIJ 包边界（G12 第一段）

**4 卡，估时 10–12h。** 只拆 owner 清晰且当前应用确实消费的模块，保留来源与许可证证据；不发布。

- `G12-01` 包边界/导出清单与来源、许可证和依赖审计。
- `G12-02` `@aij/core` 的真实共享基础能力和 API 宿主消费。
- `G12-03` `@aij/contracts` / SDK 最小 API 与实际 consumer 编译契约。
- `G12-04` package exports/types/ESM-CJS 与单 owner 回归；拒绝空 descriptor 包。

**可复制 Prompt：**

```text
批准启动 NEXT-08，仅执行 REMAINING_TASK_PROMPTS.md 中 G12-01 至 G12-04。先从当前真实代码/manifest/锁文件核验 owner 和来源，复用已有实现；新增包必须有应用消费者和打包测试，不为凑架构造空包。保留来源许可声明；未知授权标记待裁定，不作发布。跑每包测试、API/Web build 和 pnpm pack 的本地 smoke（不 publish），记录兼容结果和后续边界后停止。
```

### NEXT-09：Runtime/UI 包与宿主组合（G12 第二段）

**3 卡，估时 8–12h；依赖 NEXT-08。**

- `G12-05` Runtime/存储/队列 contracts 的真实 package 导出和原宿主消费。
- `G12-06` UI 公共组件与实际 Web 宿主消费，保留已有 UI 依赖方向。
- `G12-07` workspace link 与 packed tarball 两种安装方式 smoke；验证没有重复 Service owner。

**可复制 Prompt：**

```text
批准启动 NEXT-09，仅执行 REMAINING_TASK_PROMPTS.md 中 G12-05 至 G12-07，依赖 NEXT-08 完成。只提取本库现有实现，宿主切到公开导出；用本地 pack/tarball 临时 consumer 实测 exports/types/install/build。检查 workspace 依赖与 tarball 依赖一致，不连接源库、不 publish。通过后保存 consumer 测试证据，批末停止。
```

### NEXT-09B：跨包消费与版本兼容矩阵（G12）

**已完成：G12-08/AF-066 `CODE_VERIFIED`，本地提交与快进推送由本卡授权执行；统一负责人验收仍待执行。依赖 NEXT-09。**

- `G12-08` 两个隔离 consumer 分别从 workspace 与本地 pack 安装，核验公开 API、版本范围、依赖树和类型声明一致；记录未决许可，不发布。

**可复制 Prompt：**

```text
批准启动 NEXT-09B，仅执行 REMAINING_TASK_PROMPTS.md 中 G12-08，依赖 NEXT-09 CODE_VERIFIED。建立两个隔离的合成 consumer，分别使用 workspace package 和本地 tarball；实际安装、编译、启动最小宿主并核验版本/导出/类型兼容。不得 publish，不复制真实环境。若 package 只在 workspace 内可用，明确报告并修复后重跑。批末停止。
```

### NEXT-10：插件声明与安全生命周期（G11，已完成代码校验；负责人统一验收待执行）

**4 卡，估时 12h；依赖 G12 契约。** G11-01/AF-067 至 G11-04/AF-070 均已 `CODE_VERIFIED`；AF-068—AF-070 已按任务名本地提交，未推送。NEXT-10 负责人统一验收待执行；NEXT-10B 尚未授权。下面启动指令仅作历史记录，不可复用作新授权。不默认启动全部插件。

- `G11-01` 插件 manifest/schema、版本兼容、权限声明与 allowlist 验证。
- `G11-02` 安装/升级/启用/停用状态机和受控事务；非法插件/版本拒绝。
- `G11-03` PluginOperation 记录、失败原因去敏、重试/恢复策略和权限门。
- `G11-04` 插件管理 API 与生命周期测试；禁用后路由/worker/凭据访问按契约停止。

**可复制 Prompt：**

```text
历史启动指令：负责人于 2026-10-30 曾授权 G11-02/AF-068 → G11-03/AF-069 → G11-04/AF-070；该批已完成代码校验。本提示不授权 NEXT-10B。AF-066/AF-067 及 NEXT-10 负责人验收状态按队列保留。
```

### NEXT-10B：插件兼容检查与升级回滚（G11）

**2 卡，估时 4–8h；依赖 NEXT-10。**

- `G11-05` 插件依赖图/版本兼容检查和缺依赖拒绝；不自动安装未声明依赖。
- `G11-06` 升级失败回滚、重试幂等和停用后恢复；验证业务数据与全局服务不被误删。

**可复制 Prompt：**

```text
批准启动 NEXT-10B，仅执行 REMAINING_TASK_PROMPTS.md 中 G11-05、G11-06，依赖 NEXT-10 CODE_VERIFIED。插件依赖和版本不兼容必须在执行前拒绝；升级失败只回滚本次迁移/配置，不删除插件数据或影响其他插件。真实测试 DB 验证失败注入、重试、恢复和状态审计；不得用全局 down -v。结束记录限制并停止。
```

### NEXT-11A：新项目生成与项目隔离（G13 / aij-base）

**2 卡，估时 8h；依赖 G8/G9/G10/G11/G12。** 只做本地生成，不发布。

- `G13-01` 创建项目模板/CLI：强制 projectId、唯一端口/origin/issuer/cookie prefix/storage root。
- `G13-02` 两个合成项目并行运行与文件/凭据/DB namespace 隔离验证。

**可复制 Prompt：**

```text
批准启动 NEXT-11A，仅执行 REMAINING_TASK_PROMPTS.md 中 G13-01、G13-02。需生成两个独立合成项目，禁止共用固定端口、Cookie 前缀、issuer、storage root 或数据库目标；分别真实安装/启动并验证身份、文件、凭据和 DB namespace 隔离。许可、渠道和支持平台字段保持待负责人裁定，不发行、不部署。记录生成项目入口和仅本批拥有资源的清理方法，再停止。
```

### NEXT-11B：新项目升级、备份恢复与 base 验收（G13）

**2 卡，估时 8h；依赖 NEXT-11A 与 G8–G12。** 用合成备份，不执行 reset/drop。

- `G13-03` 从前一版迁移到当前 schema，验证 migration status、兼容性和失败回滚策略。
- `G13-04` 新 consumer 安装、启动、readiness、升级和恢复端到端验收；支持平台/发行授权缺失继续标记待定。

**可复制 Prompt：**

```text
批准启动 NEXT-11B，仅执行 REMAINING_TASK_PROMPTS.md 中 G13-03、G13-04，依赖 NEXT-11A CODE_VERIFIED。用新建合成目标执行实际升级和备份恢复，验证迁移状态、Schema/数据一致性、readiness、文件引用和启动；禁止清空已有卷或连共享/正式库。失败升级须保留可诊断证据，不以 reset 修复。许可/渠道/平台字段未决时只交本地结果，不发布。批末停止待验。
```

### NEXT-12：通知插件与受控投递（G14）

**3 卡，估时 8–10h；依赖 G9/G11/G12。** 自动校验只用协议 fixture，不发真实短信/邮件。

- `G14-01` Provider contract、SecretRef 解析、模板变量校验和缺凭据 fail-closed。
- `G14-02` Outbox 通知消费、幂等、重试/退避与 delivery status owner。
- `G14-03` 通知配置/状态 API 或管理入口、离线协议测试和负责人 live 手动步骤。

**可复制 Prompt：**

```text
批准启动 NEXT-12，仅执行 REMAINING_TASK_PROMPTS.md 中 G14-01 至 G14-03。真实 provider 凭据只能由负责人配置；自动化不得发短信、发客户邮件或调用付费渠道。验证 fixture 只证明 adapter 协议；错误/日志不得泄密；Outbox/通知状态只有一个 truth owner。没有本地有效合成配置时拒绝发送，报告 live 仍待人工。完成契约测试、真实 DB/队列测试和受影响构建后停止。
```

### NEXT-13：客户注册、验证、找回（G5）

**4 卡，估时 8–10h；依赖 G4、NEXT-12。**

- `G5-01` 注册 API/DTO、身份去重和账号状态；匿名请求不能指定角色/项目管理员身份。
- `G5-02` 一次性验证 token：用途/哈希/有效期/限流，响应不泄露账号枚举。
- `G5-03` 忘记密码/重设：单次令牌、重新认证边界、旧会话撤销、审计去敏。
- `G5-04` 真实 DB/HTTP/浏览器注册→验证→登录→找回闭环；外发 live 仅负责人触发。

**可复制 Prompt：**

```text
批准启动 NEXT-13，仅执行 REMAINING_TASK_PROMPTS.md 中 G5-01 至 G5-04。前置 G4 和通知 contract 均须 CODE_VERIFIED；匿名注册不授予管理员/租户权限，不回显账号是否存在，不记录明文 token。真实 DB/HTTP 覆盖重复身份、过期/重放/错误用途、限流、验证后启用、找回后旧会话拒绝。Provider fixture 不当 live 送达证据；保留负责人手动测试步骤。注册真实 verify、lint/typecheck/build 后批末停止。
```

### NEXT-14：客户基础管理页（G6 第二段）

**4 卡，估时 8–10h；依赖 G4/G5。**

- `G6-05` 客户列表、状态、会话/同意只读页面；分页权限由服务端控制；不提供未实现的注销/数据导出操作。
- `G6-06` 客户详情/状态管理，只消费已有客户管理 API。
- `G6-07` 会话与同意查询、受控撤销、敏感操作再认证和审计。
- `G6-08` 权限矩阵、客户角色浏览器验收和信息去敏。

**可复制 Prompt：**

```text
批准启动 NEXT-14，仅执行 REMAINING_TASK_PROMPTS.md 中 G6-05 至 G6-08，依赖 G4/G5 完成。用普通/高权限管理员实际登录；无权路径须 API 403，UI 隐藏不能代替 Guard。检查客户信息去敏、会话撤销只影响本项目、同意记录可追溯；不实现未批准的全量导出/账号删除。完成真实浏览器和数据库记录后交负责人验收。
```

### NEXT-15A：AI Provider 合同与异步执行（G15）

**2 卡，估时 6–8h；依赖 G9/G11/G12；绝不使用真实付费模型。**

- `G15-01` AI provider/模型 contract、SecretRef、能力开关与预算校验。
- `G15-02` 异步执行请求、幂等/取消/超时与状态机。

**可复制 Prompt：**

```text
批准启动 NEXT-15A，仅执行 REMAINING_TASK_PROMPTS.md 中 G15-01、G15-02。Provider fixture 仅验证协议；不配置、不调用真实付费模型。定义 SecretRef/能力开关/预算 fail-closed，异步执行有幂等、取消、超时状态。用真实 DB/队列验证合法执行、重复请求、取消、超时和拒绝；本批不造 Cost/Trace 实现，完成证据后停止。
```

### NEXT-15B：AI Trace、Cost 真值与失败回归（G15）

**2 卡，估时 6–8h；依赖 NEXT-15A。**

- `G15-03` Trace 关联、输入输出脱敏、失败分类和成本真值 owner。
- `G15-04` 离线 fixture 完整执行/失败/重试/预算拒绝与持久化回归。

**可复制 Prompt：**

```text
批准启动 NEXT-15B，仅执行 REMAINING_TASK_PROMPTS.md 中 G15-03、G15-04，依赖 NEXT-15A CODE_VERIFIED。成本账本明确唯一 owner 和幂等约束，不由日志估算冒充 cost。输入输出遵循敏感字段策略。用离线协议 fixture 加真实 DB/队列验证 Trace 关联、失败分类、重试、预算拒绝和 cost 幂等；不调用真实付费模型。记录 live Provider 未接入并停止。
```

### NEXT-16：AI 管理与组合门禁（G16）

**4 卡，估时 10–12h；依赖 NEXT-15B。**

- `G16-01` 模型/Provider 配置与权限页面，仅显示 SecretRef 状态。
- `G16-02` Trace/Cost 查询页面、分页/脱敏/审计。
- `G16-03` 角色拒绝、预算限制、插件关停和端到端组合回归。
- `G16-04` 组合异常与恢复：Provider 缺失、超预算、队列失败、角色撤权后的 fail-closed。

**可复制 Prompt：**

```text
批准启动 NEXT-16，仅执行 REMAINING_TASK_PROMPTS.md 中 G16-01 至 G16-04，依赖 NEXT-15B CODE_VERIFIED。管理页不能回显密钥或模型 payload；API 端强制权限和预算，停用插件后请求失败闭合。用合成 Trace/Cost 真实 DB 测分页、过滤、普通用户拒绝、审计去敏、失效和恢复。无真实模型调用。批末提交报告并停止。
```

### NEXT-17：Integration（G17）

**3 卡，估时 10–12h；依赖 G9/G11/G12。**

- `G17-01` connector manifest、scope/secretRef 配置和 allowlist。
- `G17-02` webhook 签名验证、时间窗、防重放和幂等入站记录。
- `G17-03` 失败重试/操作查询/权限页面及真实 HTTP/DB 测试。

**可复制 Prompt：**

```text
批准启动 NEXT-17，仅执行 REMAINING_TASK_PROMPTS.md 中 G17-01 至 G17-03。只实现通用 Integration contract，不塞入特定客户业务。签名、时间窗、replay 和幂等由服务端校验，密钥只经 SecretRef；测试错误签名/过期/重复/合法回调和拒绝权限。外部 live URL/凭据由负责人提供，自动测试不联系第三方。适用 DB/HTTP/质量门禁通过后停止。
```

### NEXT-17B：凭据轮换与停用影响（G17）

**1 卡，估时 2–4h；依赖 NEXT-17。**

- `G17-04` 凭据引用轮换、connector 停用/恢复和 in-flight 事件处理；拒绝使用过期引用，事件记录不含密钥。

**可复制 Prompt：**

```text
批准启动 NEXT-17B，仅执行 REMAINING_TASK_PROMPTS.md 中 G17-04，依赖 NEXT-17 CODE_VERIFIED。只测试合成 SecretRef，轮换后下一次处理读取新引用，历史明文不得持久化或打印；停用 connector 对新请求 fail-closed，并明确 in-flight 事件处理。真实 DB/HTTP 校验后停止，不连接第三方。
```

### NEXT-18A：支付合同与订单创建（G18）

**2 卡，估时 6–8h；依赖 G9/G11/G12；任何自动测试不得真实扣款/退款。**

- `G18-01` 支付 Provider contract 与订单/尝试/交易状态 owner 明确。
- `G18-02` 创建支付请求/查询状态及幂等键；金额和币种由服务端决定。

**可复制 Prompt：**

```text
批准启动 NEXT-18A，仅执行 REMAINING_TASK_PROMPTS.md 中 G18-01、G18-02。禁止真实付款或联系生产 Provider。明确订单、支付尝试、交易的唯一 owner；金额/币种由服务端决定。真实测试 DB 验证合法创建、非法金额/身份拒绝、幂等重复请求；fixture 不证明真实收单。完成记录后停止。
```

### NEXT-18B：支付回调、查询页与人工退款入口（G18）

**2 卡，估时 6–8h；依赖 NEXT-18A。**

- `G18-03` 回调验签、重放拒绝、状态机和对账审计。
- `G18-04` 管理查询/人工退款申请界面与离线协议 fixture；真实资金操作不自动执行。

**可复制 Prompt：**

```text
批准启动 NEXT-18B，仅执行 REMAINING_TASK_PROMPTS.md 中 G18-03、G18-04，依赖 NEXT-18A CODE_VERIFIED。禁止真实付款、退款或联系生产 Provider。验证签名、时间窗、重复回调、状态跃迁和审计去敏；退款入口只创建授权后的人工申请，不自动触发。管理员查询经过 RBAC，真实 DB/HTTP 覆盖合法和拒绝路径。fixture 不得标记为 live 接入。完成记录后停止。
```

### NEXT-18C：支付对账与差异处理（G18）

**1 卡，估时 2–4h；依赖 NEXT-18B。**

- `G18-05` 合成支付轨迹对账、差异队列/人工处理审计；不能通过回调覆盖已核实的交易真值。

**可复制 Prompt：**

```text
批准启动 NEXT-18C，仅执行 REMAINING_TASK_PROMPTS.md 中 G18-05，依赖 NEXT-18B CODE_VERIFIED。只用合成 Provider 记录验证匹配、缺失、重复和金额状态不一致；对账结果有唯一 owner，差异需授权人工处理并留审计，不自动扣款/退款。测试真实 DB 写入和越权拒绝后停止；真实资金 live 仍待负责人。
```

### G19 当前状态：NEXT-19A/B 代码完成，后续实现待负责人输入

`G19-00` 决策见 [执行记录](../execution/G19-00.md)。NEXT-19A 的 G19-01…04/AF-108…111、NEXT-19B 的 G19-05…07/AF-112…114 均已 `CODE_VERIFIED`；NEXT-19B 代码工作区汇总提交及规划状态对账已推送，详见 [G19 后续实现规划](G19_REMAINING_IMPLEMENTATION.md) 和各执行记录。NEXT-19A 与 NEXT-19B 统一负责人验收/接收仍待执行。

当前队列 `nextCardCandidate` 和 `recommendedNextBatch` 均为空；没有 NEXT-20 或 G19-08 注册，也没有后续实现授权。不得复用下方历史 Prompt、猜测卡片范围或分配正式 AF 编号来启动编码。

待负责人决定的后续边界：
- DeepSeek live：输入/输出 allowlist、个人/敏感数据范围、脱敏与 Trace 规则、保留期、数据处理授权、SecretRef 配置、10 元预算周期/超额动作及 live 调用授权。
- Workspace 文件导入：FileAsset/Workspace/知识文档唯一 owner、权限继承、删除/恢复语义、格式与大小限制。
- 发行：许可、分发渠道、支持平台、公开分发或部署授权。

在这些输入明确前，只能使用既有合成数据和离线 Provider；它不证明真实 DeepSeek 接入。以上条目是决策门，不是已登记的 AF 实现卡。

## 发行前决策，不是编码默认值

AF-001 留下的许可、发行渠道和支持平台字段仍需负责人确认。G12/G13 可执行本地 package/生成项目/升级恢复验证；不得据此 publish、宣布支持平台、接受许可证或默认启用 aij-ai-standard、通知、支付插件。每个下一批开始前重读该决策状态。

## Prompt 生成状态

- 已给 G4–G18 拟定逐卡验收范围和 25 组可复制批次 Prompt（G10、G12、G13、G15、G17、G18按依赖/预算拆批），另有 G19-00 决策 Prompt；它们是规划指令，不是当前批准。
- G19-00 决策与 NEXT-19A/B 的 G19-01…07/AF-108…114 均已代码校验；两批负责人统一验收仍待执行。没有下一批授权；G19 live Provider、Workspace 文件导入和发行范围等待负责人输入。
- 正式 AF 号须先经冲突扫描再登记；候选卡编号登记不代表批次获准实现，别名 `Gx-xx` 本身不占用 AF 编号。
- 机器队列仍明确 `executorInstalled=false`。Prompt 与 JSON 是给 Writer/自动化聊天读取的计划，不是能自行改代码的后台执行器，也不会自动恢复 30 分钟续跑。
