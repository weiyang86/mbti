> **上游历史快照：** 本文随 `8ba3d302` 源码导入 MBTI，记录的是独立底座仓库；其中状态、计划、地址、授权和验收不代表本仓。MBTI 当前接入范围见 [MBTI_INTEGRATION.md](../../MBTI_INTEGRATION.md)。

## 2026-11-05 通用 AI 升级路线

当前升级依据为 [正式需求基线](../planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md)，复用边界见 [源码差距](../planning/ai-platform-baseline-20261105/SOURCE_GAP_ANALYSIS.md)。建议阶段：M1可靠性及独立项目骨架→M2真实AI/知识/文件闭环→M3自服务Agent/隔离Skill/记忆→M4编排与多Agent→M5文档图表→M6独立插件开发升级→M7交易授权和市场→M8分层恢复与最终验收。真实依赖和可并行工作流以 [阶段计划](../planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md) 为准。

阶段全为PROPOSED_NOT_AUTHORIZED，不分配正式AF、不接收旧卡。后续按获准小卡/唯一Writer实施，每卡≤4有效工程小时、必要时拆卡；先关闭AF-126真实差量并核对独立消费相关接收门禁，不重建已有owner或拿旧PASS冒充新目标。下方历史路线保留来源，不作为本轮自动执行入口。

---

# 下一阶段任务拆分

2026-10-27 UI-1本批交付：负责人明确批准UI1-01–04，本地映射AF-026–029；四卡代码与自动门禁通过，**Trea待复核、人工待验**。AF-025-A保留待验，UI-2及AF-025-B未授权、未接续。管理员持久会话/失效、Cookie/CSRF和真实Web登录/退出已接入；当前入口与合成凭据获取见[浏览器指南](../development/ADMIN_BROWSER_AUTHENTICATION.md)，实际基线/差异/逐命令/服务见[AF-029](../execution/AF-029.md)。每30分钟续跑首卡后启用，批次结束已暂停。下文旧范围、无监听、未实现及PID均按日期保留历史。

2026-10-27重新排序与估算见[DELIVERY_PLAN](DELIVERY_PLAN.md)，有限批次定义见[CODING_QUEUE](../planning/CODING_QUEUE.json)。优先把已存在API接成可操作后台，再补正式base及选定插件；原F/AF编号范围、owner和正式门禁不变。启动前规划队列DRAFT、未批准，不能据本规划自动接续功能；下文为原路线与10月20日实现记录。

日期：2026-10-20。负责人同意AF-025拆分，本轮仅AF-025-A客户登录与会话认证前置；实际dev@0922956干净开始，226项+2宿主及适用门禁exit0，Trea待复核、人工待验。AF-025父任务仍未完成，AF-025-B未指派；交付即停，不自动接续。

F00 阶段要求先由 Trea 和负责人检查，再准备 `dev` 与下一 Writer；本轮实际已经在 dev，但 Git 与验收状态分别记录在 CURRENT_STATE。source HEAD/hash、许可证核定、独立数据库连接、One Issue / One Writer 是后续迁入的共同前置条件。

历史执行状态（2026-10-12）：F01 收尾从 dev@8476541 开始；lint/typecheck、11 tests、API/Web build 与保存重载已实测，历史访问错误根因未确认，当时浏览器人工检查与负责人接收待完成。该记录的旧 HEAD、未提交和待接收状态已由下方 AF-001 现场更新，历史证据保留在 CURRENT_STATE 第 7 节。

## 0. AF执行路线：P0隔离与P1数据库门禁

| ID | 本轮范围 | 前置与实际状态 | 交付与待执行项 |
| --- | --- | --- | --- |
| AF-001 接收 F01 并确定正式底座验收边界（必做） | F01 收口／新增正式交付范围；文档基线 | 本轮负责人确认接收；已在8f6ba1a提交中；旧7cbaf80为当时现场 | 三种发行配置、能力表与执行记录已存在；历史待复核状态保留，不推定其 Review 细节 |
| AF-002 建立真实任务校验入口与证据记录（必做） | 新增校验规范 | 本轮负责人确认接收；已在876fc40中；保留旧交付快照 | 注册/执行器/48测试与证据真实存在，不反填历史Review |
| AF-003 参数化项目命名空间与隔离配置（必做） | P0；F01配置延伸／新项目复用前置 | 本轮负责人确认接收，已在b050d34；保留旧执行记录 | 显式项目配置、条件凭据、38配置+2 HTTP与两应用构建已记录，不反填历史Review |
| AF-004 数据库目标保护与安全检查命令（必做） | P1；F02子任务 | 本轮负责人确认接收，已在5f818b8；保留旧记录 | 独立URL/白名单/去敏已实现；AF-005中默认db:check升级真实连接，仅配置模式显式指定 |
| AF-005 创建独立开发与测试PostgreSQL实例（必做） | P1；F02子任务 | 本轮负责人确认接收，已在fc5d3d2；保留旧执行记录 | 两实例/账户/卷、真实身份与合成持久化已实现；历史Trea/人工待验不反填勾选 |
| AF-006 迁入管理员与RBAC核心Schema（必做） | P1；F02／M18 | 本轮负责人确认接收，已在dd62610；保留旧执行记录 | 七核心模型/两枚举已实现；不反填历史Trea/人工复核勾选 |
| AF-007 迁入通用客户身份Schema（必做） | P1；F02／F07数据前置 | 本轮负责人确认接收，已在e00ce7a；保留旧执行记录 | 5身份模型及44断言已存在，不反填历史Trea/人工勾选 |
| AF-008 迁入配置与审计Schema（必做） | P1；F02／F05/F06数据前置 | 本轮负责人确认接收，已在b0d3b36；保留旧执行记录 | 6模型及最小版本/审计关联已存在；68断言为前序证据，不反填历史Review |
| AF-009 文件与插件状态最小Schema（必做） | P1；F02数据前置 | 本轮确认接收，已在dbf4c97；保留旧记录 | 3模型/2枚举与85断言已存在，不反填历史Review |
| AF-010 独立Initial Migration（必做） | P1；F02子任务 | 本轮负责人确认接收，已在613bc1f；保留旧执行记录 | initial/保护入口与71项真实证据存在，不反填历史Review |
| AF-011 Prisma服务与真实数据库Readiness（必做） | P1；F02子任务 | 本轮负责人确认接收，已在2c9b36f；保留旧执行记录 | 唯一Prisma/关闭与真实Readiness及104项证据存在，不反填历史Review |
| AF-012 幂等最小Seed与初始管理员凭据（必做） | P1；F03 Seed部分 | 负责人确认接收，已在5b224da；保留旧执行记录 | 幂等Seed/安全初始凭据及114项真实证据存在，不反填历史Review |
| AF-013 管理员登录与JWT认证（必做） | P1；F03认证部分 | 负责人确认接收，已在6d3f444；保留旧执行记录 | 登录/JWT/最小登录审计及177+2证据存在，不反填历史Review |
| AF-014 RBAC权限守卫（必做） | P1；F03核心Guard／F04前置 | 负责人确认接收，已在ff6887d；保留旧执行记录 | 当前DB Guard/只读权限及202+2证据存在，不反填历史Review |
| AF-015 管理员基础管理API（必做） | P1；F03管理员部分 | 负责人确认接收，已在a2305fe；保留旧执行记录 | 七入口/239+2与保护证据存在，不反填历史Review |
| AF-016 角色与权限管理API（必做） | P1；F04角色/权限部分 | 负责人裁定沿用本聊天范围并接收，已在4c2f905提交 | Trea独立263项+2宿主及门禁PASS，原范围冲突已裁定；人工API已恢复，人工待验；会话安全另行编号、尚未实现 |
| AF-017 RBAC解析与后端强制授权（必做） | P2；F03/F04权限部分 | 负责人已确认接收，已在37372b9提交；保留原快照 | 唯一解析/Guard复用、统一admin默认拒绝、每次查库即时失效；276项+2宿主与门禁退出0；Trea待复核、人工待验 |
| AF-018 管理员用户管理API（必做） | P2；F04用户部分 | 负责人已确认接收，已在c178e72提交；保留原快照 | 复用唯一已实现用户API，284项+2宿主及门禁exit0；审计失败回滚/锁等待撤权真实验证，Trea待复核、人工待验 |
| AF-019 角色与权限分配API（必做） | P2；F04角色部分 | 负责人已接收，已在24055bb提交；保留原交付快照 | 唯一角色服务复用，停用权限变更409、真实授撤权/前后ID审计/非级联用户；294项+2宿主，Trea待复核、人工待验 |
| AF-020 菜单树与权限过滤API（必做） | P2；F04菜单部分 | 负责人已接收，已在b343329提交；保留原交付快照 | 唯一菜单API/默认拒绝过滤/循环及页面可用性检查/事务审计；312+2退出0，Trea待复核、人工待验 |
| AF-021 字典分类与条目管理API（必做） | P2；F04字典部分 | 负责人已接收，已在e961144提交；保留原快照 | 两core模型/独立迁移、分页/公开过滤/软删引用/事务审计；185+2通过，Trea待复核、人工待验 |
| AF-022 项目分层配置与公开上下文API（必做） | P2；F05 | 负责人已接收并提交b39984a；保留原快照 | 206+2通过；历史Review/人工状态不反填 |
| AF-023 密钥引用解析与受控后台配置（必做） | P2；F06 | 负责人已接收并提交208a155；保留原快照 | 227+2通过，历史Review/人工状态不反填 |
| AF-024 审计日志查询与脱敏API（必做） | P2；core审计 | 负责人已确认接收，已在3f1b5c5提交；保留原交付快照 | 同一AuditLog查询/权限/安全投影；历史246+2通过，历史Review/人工状态不反填 |
| AF-025 客户会话、改密与同意记录（必做） | P2；F07子任务 | 拆分前缺客户认证；现A已实现待复核，B未指派 | 拆分前阻塞记录已在0922956；负责人同意拆分并指派A，父任务仍未完成，B未指派；历史Unknown task退出2记录保留 |
| AF-025-A 客户登录与会话认证前置（必做） | P2；F07前置子卡 | 唯一Writer Codex，仅本子卡；dev@0922956干净开始 | 登录/会话签发查库/独立Cookie与JWT、226+2及门禁exit0；Trea待复核、人工待验，不接续B |

[RELEASE_PROFILES](RELEASE_PROFILES.md) 为正式产品完成条件，不能用 F01 或仅后台启动替代。`aij-base` 必含新项目安装、数据隔离、插件生命周期、升级恢复；`aij-ai-standard` 与按需插件按已声明依赖组合，不默认全部启用。当前已有工程骨架、本地数据库工具及部分RBAC Schema，尚无完整底座运行能力；许可、渠道、支持平台待定。

原F01–F20未完整拆出新项目安装、插件生命周期和升级恢复，仍为正式验收必需项。AF-004/005为DB保护/实例，AF-006至AF-009为部分Schema，AF-010为新空库initial，AF-011为Prisma/readiness，AF-012为最小Seed；AF-013接入管理员登录/JWT，AF-014接入核心RBAC守卫与两只读权限入口；AF-015接入管理员基础管理七路由；AF-016接入角色/权限CRUD；AF-020接入菜单API与实际页面过滤；AF-021接入字典Schema/管理和公开过滤；AF-022接入分层配置与公开上下文；AF-023接入密钥adapter/受控引用管理；AF-024接入core审计查询/脱敏。按钮及Web页面仍未实现。AF-025-A现已接入客户登录/会话认证、独立Cookie/issuer/audience与真实校验；客户端注册/找回/改密/logout/撤销/同意接口仍未实现，不宣称完整F07或正式底座完成。父AF-025和未指派AF-025-B仍无功能注册、实际非零；原验收项与拆分历史见[AF-025记录](../execution/AF-025.md)，本子卡实际结果见[AF-025-A记录](../execution/AF-025-A.md)。

UI-1（2026-10-27批准）本地编号映射：

| 卡/编号 | 实际范围 | 当前状态 |
| --- | --- | --- |
| UI1-01 / AF-026 | 管理员持久会话与失效 | CODE_VERIFIED，Trea/人工待执行 |
| UI1-02 / AF-027 | 独立Cookie与CSRF强制验证 | CODE_VERIFIED，Trea/人工待执行 |
| UI1-03 / AF-028 | Web登录与安全会话消费 | CODE_VERIFIED，真实Chrome观察已记录 |
| UI1-04 / AF-029 | 集成、服务交接与有限批次停写 | CODE_VERIFIED；批次REVIEW_PENDING，续跑PAUSED |

仅本批已获授权，UI-2/客户B仍待负责人指派。完整现场见[AF-029](../execution/AF-029.md)。

## 1. M1：核心后台真实独立启动

| ID | 时长 | 单任务闭环与迁出清单 | 依赖 | 可检查验收 |
| --- | --- | --- | --- | --- |
| F01 后端装配与工程骨架 | 半天（历史） | 新 pnpm workspace、private API/Web manifest、必要 TS/Nest/Next/lint 配置；只装配核心骨架、空插件白名单与 process health；统一环境加载与端口（M01/M04/M11） | F00 检查完成；dev 已具备 | 负责人已在 AF-001 指派中确认完成并接收；F01 历史 lint/typecheck、11 tests、build/HTTP/保存重载通过。数据库/Auth/实际插件未迁入；历史访问错误根因未确认，不据接收扩大发行范围 |
| F02 核心数据库基线 | 一天 | 新独立开发/测试 Compose、Schema 核心 Sys/Auth/Member/Config/File/Plugin 定义与必需 enum/关系，initial migration、Prisma adapter/连接保护（M04/M18/M20） | F01；新本地凭据 | 55432/55433 新实例/库/账户/卷；validate/generate；空库 migrate deploy/status；拒绝原库/开发库作为测试目标；真实 DB readiness；无业务表 |
| F03 最小 Seed 与管理员认证 | 半天 | 分层幂等 seed、合成项目组织、最小角色权限菜单、环境初始密码；Auth/JWT 与核心 Guard（M03/M19） | F02 | Seed 两次无重复；登录/me；坏密码/Token/错误 issuer 拒绝；密码/hash 不出响应与日志；新库不带业务菜单/默认资产 |
| F04 通用管理服务拆分 | 一天 | 从 Admin 混合文件抽取用户/角色/菜单/权限/字典/会员基础管理与审计；AI/CompanyOps 方法不装配（M02/M03） | F03 | 真实 CRUD、普通角色拒绝路径、菜单过滤、写入审计通过；不要求 AI 插件；无 CompanyOps Prisma 调用 |
| F05 通用配置 | 半天 | Project/Organization/ScopedConfig/ConfigurationChange 与后台 API；最小公开项目上下文（M05） | F04 | scope 优先级、项目状态、权限、敏感过滤与审计目标测试；只有 AIJ 合成项目 |
| F06 密钥引用服务 | 半天 | SecretRef/env adapter/redaction 与权限 API（M06） | F05 | 只存引用、未配置失败闭合、错误/日志脱敏；不复制旧 key；不连真实 Provider |
| F07 通用客户身份 | 一天 | ClientAuth 注册/登录/会话/换密、单次找回/验证 token、同意与限流；独立 cookie/issuer/key/link（M09） | F03/F06 | 合成用户生命周期目标测试、跨身份/跨产品拒绝；disabled/test 通知状态真实；不宣称正式邮件已接通；不含账号导出/注销功能 |
| F08 后台壳与前端装配 | 半天 | 新 root/login/provider/AppShell/API 配置、动态权限菜单、新 Token key，去 Company Ops rewrite/sidecar 业务事件（M15） | F04/F05；可消费 F07 认证契约 | Web 3655；所有请求 3656；登录退出与受限菜单可用；没有产品壳/业务导航或硬编码旧 API fallback |
| F09 核心系统页面 | 一天 | 管理员/角色/菜单/字典/配置/会员/日志现有页面定向适配；当前只挂已完成 API 的菜单（M16） | F04/F05/F08 | 分页/筛选/编辑/停用与错误态；角色按钮/API 一致；关键写操作审计；未迁文件/运行时/集成/通知页不提前挂载 |
| F10 M1 独立启动验收 | 半天 | 从新环境安装→空库迁移→两次 seed→API/Web 启动→后台权限操作→审计，写真实运行记录（M01–M06/M09/M15/M16/M18–M20/M24） | F02–F09 | build/lint/typecheck 与目标 tests 通过；health + DB readiness + 浏览器操作；新端口/PID/CWD/网络请求证据；新库不依赖原目录/库/包产物；原库 hash/status 保留 |

M1 不包含完整系统插件、租户组织后台、异步/集成或实包发布。首个独立启动通过后再扩展，不能把全量迁出塞进 F10。

## 2. M2：通用运行时、集成与组织

| ID | 时长 | 单任务闭环 | 依赖 | 可检查验收 |
| --- | --- | --- | --- | --- |
| F11 异步运行时 | 一天 | Outbox/Job/Registry/worker/scheduler/idempotency、对应新增 migration、合成 handler 与运行状态 API（M07） | F10 | 事务→真实 handler、retry/锁/去重/未知 handler 拒绝；测试只用新测试库；无轻企 handler；运行状态页最小读取 |
| F12A 附件与独立存储 | 半天 | StorageAdapter/FileAsset、管理上传/下载/删除、最小附件页（M08/M02/M16） | F10 | 存储根在新库；合成文件字节校验、越权/路径穿越拒绝、软删与审计；旧 uploads 不读不写 |
| F12B API Key 与 Webhook | 一天 | Key/RateBucket、Webhook subscription/delivery/安全校验，最小管理页与新增 migration（M08） | F06/F11/F12A | 合成 Key scope/限流、验签、重试/SSRF 拒绝；不向真实外部地址投递；无原绑定或凭据 |
| F12C 通用 Transfer | 半天 | import/export 模板与任务/错误机制、最小状态页（M08） | F11/F12A | 合成数据可导入/导出、错误定位和权限校验；业务模板由业务注册，不拷客户数据 |
| F13 通用组织 Schema/契约 | 半天 | 7 个 Workspace 通用模型抽取/重命名，组织契约与最小 seed；移除 CompanyProfile/IP/业务关系（M10/M18/M19） | F07/F10 | enum/关系/复合约束 validate/generate/migrate；项目组织与客户组织分开；空库无 qingqi_company_profile 也成立 |
| F14 通用组织服务 | 一天 | Workspace 创建/选择、membership/role/invitation、可信上下文/session/guard，替代 Suite/CompanyProfile 依赖（M10） | F13 | 创建幂等、邀请/角色变更、停用成员、session version/跨租户拒绝；不创建企业/IP；审计记录；无 WorkspaceRole.FDE |
| F15 通用组织最小后台 | 半天 | 新写组织/成员/角色读取与最小管理界面，接 F14；源产品 Workspace UI 只参考 | F08/F14 | 管理权限、成员上下文、分页/错误态、API 越权拒绝；页面不引入轻企产品壳与企业业务字段 |

每项需要的新增表/迁移在本项闭环内完成；F02 不预先迁入所有 96 个候选模型。范围膨胀时优先拆分操作面，不能借迁 Schema 提前复制业务域。

## 3. M3：系统能力与实际包

| ID | 时长 | 单任务闭环 | 依赖 | 可检查验收 |
| --- | --- | --- | --- | --- |
| F16A SDK / Contracts 本地包 | 半天 | manifest 校验 SDK、版本化底座/组织契约、LICENSE/来源保留、公开导出/类型和 workspace 消费（M21） | F13/F14；负责人核定迁入权利范围 | 宿主使用公开导出；不静默改旧 `foundation.qingqi.ai/v1` 契约语义；真实 SDK tests；不发布 |
| F16B Runtime 实包 | 一天 | F11 的实际唯一实现迁到 foundation-runtime，API 留装配；公开注册/运行导出（M21/M07） | F11/F16A | 宿主从包加载真实 runtime；Outbox/Job 目标测试通过；无 app/package 实现副本；不能仅复制旧常量入口 |
| F16C Core 实包：身份/RBAC | 一天 | 将已验收管理认证、RBAC/菜单机制抽取到 foundation-core；保留薄应用 adapter | F04/F16A/F16B | 普通角色授权/越权/日志测试在包消费宿主通过；无深层 app import；无 AI/业务依赖 |
| F16D Core 实包：配置/文件端口 | 一天 | 配置/secret-reference/文件与集成端口公开导出、实际实现 owner 归包；宿主 adapter 接运行环境 | F05/F06/F12A/F16C | scope、secret 脱敏、独立文件访问在包消费宿主通过；owner 唯一；不把描述性组合函数当完工 |
| F16E Shared UI 实包 | 半天 | 提取真实壳/权限菜单或共享组件与路由契约，保留应用页面装配 | F09/F15/F16A | 宿主实际渲染组件、权限菜单与错误态；类型/构建与浏览器验收；不只导出 slots 常量 |
| F17A 通知实现与本地包 | 一天 | 独立 Notification 模型/seed、真实 intent/attempt/inbox、最小管理页、descriptor→adapter 消费（M13/M17/M22） | F07/F11/F16B–F16D | 合成 intent/去重/retry/inbox 权限，包注册/禁用通过；不发送真实邮件/短信，不复制业务模板；额外模板/渠道管理 UI 若未完成另立半天任务 |
| F17B 支付实现与本地包 | 一天 | Payment 轨道模型、合成 adapter、验签/去重/退款/对账入口、descriptor→adapter（M14/M22） | F06/F11/F16B–F16D | 本地合成交易闭环、测试/启停；无商业订单表/真实支付；完整管理页另拆 F17C |
| F17C 支付后台页 | 半天 | channels/orders/refunds/webhooks/reconciliation 按已完成 API 适配（M17） | F17B/F16E | 权限/状态/错误展示与合成操作正确；不声明生产商户接入 |
| F18A AI 执行与成本基础 | 一天 | ModelService/Provider/Model/Route、Execution Trace、Price/Cost 的最小统一调用闭环与选定 Schema（M12） | F06/F11/F17A | 合成 provider attempt→Trace→Cost；缺价格/Secret/预算失败闭合；不引入 Company Ops 工具或真实 Key |
| F18B AI 管理与本地包入口 | 一天 | 从 Admin 提取 F18A 管理面与最小页面，descriptor→真实 Module/adapter（M02/M12/M17/M22） | F18A/F16C–F16E | 包消费宿主可配置合成 Provider/Route/Price 并一次执行；owner 唯一；关插件撤菜单/API；无 Company Ops |
| F18C AI 高级路由 | 一天 | Capability/Profile/Node/Policy/Binding 迁出；业务默认资产留原库 | F18B | 合成候选/隐私/健康/预算/fallback 拒绝与成功路径；trace/cost 仍唯一；不默认连接真实推理节点 |
| F18D AI 评测 | 一天 | Evaluation Dataset/Case/Run/Result 与去敏合成 fixture、最小评测入口；不自动修改生产路由 | F18C | 去敏校验、不可变版本快照、权限、Trace/Cost 事实与候选状态通过；缺少真实人工评分如实标明 |
| F18E 通用 Agent/Skill | 一天 | 通用版本/绑定/运行机制与注册端口；不复制轻企 Prompt、Agent 默认资产或 Company Ops 工具执行器 | F18C/F16A | 合成 Agent/Skill 解析与执行、权限/版本/Trace 测试；调用者通过 contract 注册，未接业务工具如实说明 |
| F18F Workflow/MCP/Tool 最小闭环 | 一天 | 挑选通用定义/注册/运行与日志机制；本项只打通一个合成工作流和工具，其他适配逐项拆分 | F18E | 合成 handler allowlist、调用权限、日志脱敏、执行结果；无业务写执行器和真实外部 MCP 凭据 |
| F19 集成本地包 | 半天 | 已验收 F12A–C 通过 system-plugin-aij-integration 的真实注册入口消费 | F12C/F16D | Key/Webhook/Transfer/Storage 目标测试在包消费宿主通过；descriptor 与真实依赖一致 |
| F20 实包独立启动终验 | 一天 | 新目录自身锁文件安装、包实际构建/导出、全新库迁移/seed、宿主 boot、浏览器与 owner/边界扫描（M21–M24） | 全部选定能力闭环；未选择功能不标为已迁入 | 不依赖旧目录/node_modules/dist/旧 DB；启动与页面真实；包实际使用；无业务依赖与运行数据；权限/日志/启停通过；记录原库保留证据；交负责人，不 publish |

M3 的每项只做自己的本地可运行闭环；完整原 AI 高级能力若超出单日，需要按 Model/Cost、Policy、Binding、Evaluation、Workflow/MCP/Tool 等另拆，未迁部分列入未实现，不占用“已迁出”状态。F17/F18/F19 的系统包与 F16 Core/Runtime 各有唯一实现，不在 app 和 packages 双写。

公共包 registry scope、版本 bump、pack/release/publish、生产迁移/部署、原轻企改为消费底座包都不在本路线的本地任务授权内，由负责人另立任务控制。

负责人范围裁定：AF-016保持角色与权限管理API；会话撤销/浏览器凭据保护另行编号，具体ID未指派，AF-017现由负责人明确指定为RBAC解析与后端强制授权，不代表会话安全实现。裁定与服务恢复见[AF-016第7节](../execution/AF-016.md)。
