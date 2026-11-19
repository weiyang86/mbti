## 2026-11-05 通用 AI 底座需求基线

本轮多轮需求确认已整理为 [正式需求基线](docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md)、[源码复用与缺口](docs/planning/ai-platform-baseline-20261105/SOURCE_GAP_ANALYSIS.md) 和 [交付阶段与验收](docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md)。目标为独立部署的通用AI平台，含工作台/API、模型/Agent/Skill/知识/编排、插件市场及商业与恢复能力。

40条需求、48个源码锚点和8个建议阶段均可追溯；本轮只形成文档规划，现有代码仍为Alpha，阶段不自动成为已授权开发卡。新目标与历史实现按 [CURRENT_STATE](docs/current/CURRENT_STATE.md) 区分，历史验收记录保持。

---

## 2026-11-04 MBTI 通用 AI 中心

[本批统一 Review](docs/review/MBTI_AI_FOUNDATION_REVIEW_20261104.md) · [AI 配置与 MBTI 接入](docs/development/AI_CENTER_MBTI_INTEGRATION.md)。多厂商/模型、Agent/Skill、文本/生图、用量预算与 AntD 后台已纳入本批 dev 交付。真实商户支付、业务订单/权益及目标模型上线验收仍待完成。

---

## 2026-11-04 架构阶段评估

[全仓架构与阶段分析](docs/review/AIJ_FOUNDATION_ARCHITECTURE_ASSESSMENT_20261104.md) · [优化任务清单](docs/planning/AIJ_FOUNDATION_OPTIMIZATION_BACKLOG_20261104.md)。当前建议定位为模块化单体 Alpha / 可运行参考实现；该评估对应 d8847d2 基线；MBTI 通用 AI 首批优化见上方最新交付，其余提案仍为计划。

---

## 2026-11-04 最新交付入口

AF-116～AF-120 五节点已完成代码验证，按节点提交推送，等待负责人一次性统一 review。[统一汇报材料](docs/review/REMAINING_DELIVERY_REVIEW_20261104.md)包含成果、验证、提交索引和外部待决项。预算门禁、DeepSeek适配、独立评测留存、文本文件导入和集成收尾已实现；真实DeepSeek调用未执行，仍保持先前上游确认及本机配置门禁。下方历史HEAD、未提交记录和估时不代表当前状态。

---

# AIJ Foundation

2026-11-01 NEXT-18A：G18-01/AF-103「支付 Provider contract 与订单/尝试/交易状态 owner 明确」已代码校验通过，按队列标题提交/快进推送后由执行记录回填 SHA。aij-payment 默认无 Provider；本卡只增加离线可测 contract/state policy，不加支付 API、Schema/迁移或商户配置，不执行任何真实支付。业务方继续持有应付身份、价格和币种，aij-payment 是支付 ledger 唯一状态 owner，Provider 不写状态；负责人验收仍待统一执行。下一卡 G18-02 需依赖本卡代码校验和 Git closeout。详见[CURRENT_STATE](docs/current/CURRENT_STATE.md)、[AF-103](docs/execution/AF-103.md)、[Payment Provider contract](docs/development/PAYMENT_PROVIDER_CONTRACT.md)及[队列](docs/planning/CODING_QUEUE.json)。

**历史状态快照（2026-10-31 NEXT-11B）：** AF-075 已真实验证并提交/快进推送（`66c9328`）。负责人已授权本地 private pack/tarball 工作；G13-04 已拆为 AF-077/078/079，父验收 AF-076 保持未完成。AF-077 本地 consumer pack、实际 tarball 安装、ESM/CJS exports 与类型解析已代码校验通过，按标题提交并快进推送至 `c5ae1cebfff08814fb605c679b3550552d3f9597`。G13-04B/AF-078 依赖满足，准备开始但尚未执行；AF-079 等待 AF-078。NEXT-11B 统一负责人验收仍待执行；许可、公开渠道和支持平台仍待负责人决定。详见[AF-076](docs/execution/AF-076.md)、[AF-077](docs/execution/AF-077.md)。

以下 UI-2 交付段落为历史快照，不代表 NEXT-03 的当前卡、服务或进程状态：

2026-10-27 UI-2启动时的进程CWD阻塞已解除：负责人明确允许仅停止核验后的历史Web/API PID，Web收到SIGTERM，API按再次核验后明确批准的SIGKILL停止；未停止数据库/其他项目。见`.artifacts/ui-2/exception-stop-2026-10-28.json`和`exception-kill-2026-10-28.json`。此为恢复历史，不代表批次失败或被回退。

2026-10-27后续流程更新：按负责人指示，后续任务不再要求Trea复核，改为Codex唯一Writer批内连续实现/校验/修复，负责人按批接收；旧Trea记录保留为历史，不反填通过。UI-2已在后续单独批准并完成机器校验；当前等待负责人按批检查，后续批次未授权。执行规则见[批量开发工作流](docs/planning/BATCH_WORKFLOW.md)。

2026-10-27 UI-1本批交付历史：负责人明确批准UI1-01–04，本地映射AF-026–029；原记录中的Trea/人工状态保留，不反填。AF-025-A仍待验；真实登录/退出证据及当时入口见[AF-029](docs/execution/AF-029.md)。当时Web/API地址和PID是UI-1历史快照，不表示当前PID。

AIJ 独立底座产品仓库。目标提供通用后台、身份权限、工程装配、运行时和系统插件；轻企业务由独立的 `qingqi-ai-consultant` 仓库维护。

**2026-10-27重新梳理（历史规划快照）：** [剩余工作量与连续编码计划](docs/current/DELIVERY_PLAN.md)及队列保留当时的工作量规划和UI-2启动模板；后续负责人已单独批准并执行UI-2。下文10月20日PID/准备状态属于历史交付快照。

**历史阶段快照（2026-10-28）：** UI-2四卡（AF-030–033）代码与自动门禁已验证；当时负责人接收、人工服务和端口以各自执行记录为准。当前批次以本文件顶部和[CURRENT_STATE](docs/current/CURRENT_STATE.md)为准。AF-025-A仍待负责人确认，父AF-025尚未完成，AF-025-B未指派。

AF-025-A交付时的历史快照（2026-10-20）：ClientAuthModule复用Prisma提供客户邮箱登录/会话校验；当时的226结构化项和API PID不代表当前进程或本次UI-2验收。父AF-025仍未完成；客户logout/撤销/改密/同意接口是否已由后续任务实现按其各自记录确认。详见[AF-025-A](docs/execution/AF-025-A.md)。

## 从这里检查

| 文档 | 内容 |
| --- | --- |
| [AGENTS](AGENTS.md) | main 稳定 / dev 开发、One Issue / One Writer、负责人 Git 控制与交接 |
| [项目范围](PROJECT_BRIEF.md) | 两产品目标、F00 完成标准、迁出边界 |
| [当前架构与工程边界](docs/current/ARCHITECTURE.md) | 源库实际耦合、目标分层、数据 owner |
| [当前状态](docs/current/CURRENT_STATE.md) | F01 实际修改、两仓库保护证据、验证、未完成与交接 |
| [发行配置与验收边界](docs/current/RELEASE_PROFILES.md) | 三种发行配置、能力状态、许可/渠道/平台待定项与正式底座完成条件 |
| [AF-001 执行记录](docs/execution/AF-001.md) | 本轮实际基线、文档差异、校验、人工步骤和 Writer 交接 |
| [任务校验规范](scripts/verification/README.md) | verify:task 注册表、命令/前置/测试计数、证据和手工准备边界 |
| [AF-002 执行记录](docs/execution/AF-002.md) | 当前基线、自身测试、失败路径、证据与交接 |
| [项目配置契约](docs/development/PROJECT_CONFIGURATION.md) | 项目身份、APP_ENV、端口/origin、issuer/Cookie/存储隔离与条件凭据 |
| [AF-003 执行记录](docs/execution/AF-003.md) | 实际配置/构建/HTTP证据、人工步骤与本轮交接 |
| [数据库目标校验](docs/development/DATABASE_TARGET_CHECK.md) | db:check dev/test、精确白名单、去敏及配置/连接边界 |
| [AF-004 执行记录](docs/execution/AF-004.md) | 实际基线、成功/拒绝路径、命令退出码、证据与交接 |
| [独立数据库实例](docs/development/DATABASE_INSTANCES.md) | 实际地址、凭据位置、up/check/stop/cleanup与人工步骤 |
| [AF-005 执行记录](docs/execution/AF-005.md) | 实例/身份/端口占用/哨兵持久化证据与交接 |
| [RBAC Schema边界](docs/development/RBAC_SCHEMA.md) | 七模型owner、约束/删除策略、Prisma编译命令与未迁范围 |
| [AF-006 执行记录](docs/execution/AF-006.md) | 来源抽取、真实校验、影响与本轮交接 |
| [客户登录与会话认证](docs/development/CLIENT_AUTHENTICATION.md) | 独立客户Cookie/JWT、实际合成账号、人工步骤与AF-025-A边界 |
| [客户身份Schema](docs/development/CLIENT_IDENTITY_SCHEMA.md) | 五模型owner、会话/令牌/同意字段、身份隔离与未实现服务 |
| [AF-007 执行记录](docs/execution/AF-007.md) | 实际基线、44项断言、生成证据与人工交接 |
| [配置/引用/审计Schema](docs/development/CONFIGURATION_SCHEMA.md) | 六模型owner、版本/审计适配、归属与租户授权区别及未实现服务 |
| [AF-008 执行记录](docs/execution/AF-008.md) | 历史基线、68项断言、证据及人工交接 |
| [文件与插件状态Schema](docs/development/FILE_PLUGIN_SCHEMA.md) | 三模型owner、状态/历史关联、来源适配及运行时边界 |
| [AF-009 执行记录](docs/execution/AF-009.md) | 历史基线、85项断言与Schema交接 |
| [Initial Migration](docs/development/INITIAL_MIGRATION.md) | 目标保护、实际空验收库及deploy/status人工步骤 |
| [AF-010执行记录](docs/execution/AF-010.md) | 实际基线、71项校验、迁移证据与本轮交接 |
| [数据库Readiness](docs/development/DATABASE_READINESS.md) | 配置、真实检查/故障边界、人工地址与自有服务停止 |
| [AF-011执行记录](docs/execution/AF-011.md) | 实际基线、104项/HTTP/关闭证据与交接 |
| [最小Seed](docs/development/MINIMAL_SEED.md) | 目标保护、凭据/幂等规则与实际人工数据库入口 |
| [AF-012执行记录](docs/execution/AF-012.md) | 本轮基线、114项断言、影响/证据与交接 |
| [管理员认证](docs/development/ADMIN_AUTHENTICATION.md) | 登录/me、JWT隔离、失败语义与实际人工步骤 |
| [AF-013执行记录](docs/execution/AF-013.md) | 本轮基线、真实校验、影响/证据与交接 |
| [RBAC权限守卫](docs/development/RBAC_AUTHORIZATION.md) | 当前DB权限、只读接口、合成账号与人工步骤 |
| [AF-014执行记录](docs/execution/AF-014.md) | 基线、202项真实校验、影响/证据与交接 |
| [管理员基础管理API](docs/development/ADMIN_USERS_API.md) | 七路由、显式权限、角色/锁定保护、当前合成账号与人工步骤 |
| [AF-015执行记录](docs/execution/AF-015.md) | 实际基线、CRUD与权限拒绝、命令/证据与交接 |
| [角色与权限管理](docs/development/ROLE_PERMISSION_API.md) | 角色/自定义权限CRUD、原子授权、代码owner与人工步骤 |
| [AF-016执行记录](docs/execution/AF-016.md) | 实际基线、成功/拒绝路径、命令/证据与交接 |
| [AF-017执行记录](docs/execution/AF-017.md) | RBAC解析复用、统一默认拒绝、真实HTTP/数据库证据与人工交接 |
| [AF-018执行记录](docs/execution/AF-018.md) | 已有管理员API复用、真实CRUD/审计回滚/并发授权及人工交接 |
| [分层配置与公开上下文](docs/development/CONFIGURATION_API.md) | 优先级、版本/审计、公开过滤、实际启停影响与人工步骤 |
| [AF-022执行记录](docs/execution/AF-022.md) | 现场基线/完整真实校验/保护与交接 |
| [字典分类与条目](docs/development/DICTIONARY_API.md) | 当前字典API、公开过滤、引用策略与人工步骤 |
| [AF-021执行记录](docs/execution/AF-021.md) | 现场基线/Schema增量/真实HTTP数据库与交接 |
| [菜单树与权限过滤](docs/development/MENU_API.md) | 当前API/页面可用性、菜单过滤与人工步骤 |
| [AF-020执行记录](docs/execution/AF-020.md) | 现场基线/真实HTTP与数据库/完整命令/交接 |
| [AF-019执行记录](docs/execution/AF-019.md) | 角色复用、停用拒绝、权限集合审计及真实HTTP/数据库证据 |
| [迁出清单](docs/governance/F00_MIGRATION_INVENTORY.md) | 源文件、能力、依赖、owner、目标、方式、验收 |
| [下一阶段任务](docs/current/ROADMAP.md) | 半天至一天的单任务闭环与依赖顺序 |
| [独立本地环境](docs/development/LOCAL_ENVIRONMENT.md) | 独立数据库、端口、凭据、Cookie 和运行隔离 |
| [代码来源与许可证](docs/governance/SOURCE_PROVENANCE.md) | 源 HEAD、声明、包现状与后续迁入记录规则 |
| [逐文件清单](docs/generated/SOURCE_FILE_INVENTORY.csv) | 定向核对文件、直接依赖、SHA-256、迁出决策 |
| [Prisma owner 清单](docs/generated/PRISMA_MODEL_OWNERSHIP.csv) | 所有源模型及关系类型、目标 owner 和处理方式 |
| [审计快照](docs/generated/F00_AUDIT.json) | 本地 Git 信息、源码完整性、端口预检和清单覆盖 |

## 运行与协作约定

- AF-025-A实际开始dev@092295670115dae1db9acec6ed7f2944f95c1c73、工作区干净；AF-025拆分前记录已在HEAD，本轮差异另计，不回退历史基线、不代做Git节点。
- One Issue / One Writer，交付即停写；负责人控制提交/推送/分支/PR/merge/tag/发布和部署。
- 本轮开始3655/3656空闲、AF-024人工STOPPED；交付保留本轮客户API70954/3656及一条有意保留池，3655未运行。Schema/两迁移/原dev/test及前序凭据保持；旧PID和准备状态仅为历史。
- 启动器解析本库根目录 `.env`（可选）；DATABASE_ENABLED=true时宿主另读所选dev/test本机忽略配置，环境变量优先；test不回退dev。不执行shell环境文件、不读原库.env。数据库默认关闭，3655/3656默认值保留；细节见Readiness指南。
- 本机 ExFAT 使用 `.npmrc` 的 hoisted/copy 布局；依赖由 pnpm 安装到新库，不链接原库 node_modules。锁文件以源 manifest 选定的版本重建，未复制原完整锁文件。

## F01 本地命令

使用 Node 24、pnpm 10，在本库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

`pnpm dev:api` / `pnpm dev:web` 可分别启动。API 使用 Nest CLI 的 TypeScript watch，Web 使用 Next webpack 与 bundled Watchpack，当前保留原生 watcher，没有凭猜测切到 polling。普通保存和原子 rename 保存的实际 HTTP 重载均已验证；历史 ENOENT/EACCES 与本轮诊断边界见 CURRENT_STATE。构建产物可用 `pnpm start:api` / `pnpm start:web` 启动，不能与同端口 dev 并行。

dev 已运行、且当前 Writer 独占时执行 `pnpm verify:dev`：先核对 3655/3656 的 PID、CWD 和 dev 命令，再临时修改两处探针并读取真实 HTTP，最后校验原文件还原。证据写到忽略的 `.artifacts/f01-closeout/dev-reload.json`。此命令会短暂重启 API，不能在只读 Review 或另一 Writer 工作时执行。

端口已占用时启动器失败退出，保留原始错误 cause；其他 socket 错误不误报占用。Ctrl+C/SIGTERM 只停止该启动器创建的进程组（F01 历史实测 API/Web 无残留），不按端口批量杀进程。启动前及手工停止前仍须核对进程归属。

当前Web实现仍为工程入口，预期API serviceId与地址来自项目配置；登录API已由AF-013接入，登录页面和后台壳仍属后续F08。AF-003的构建/HTTP证据保留于其执行记录；AF-004实际执行配置CLI测试、lint/typecheck及原测试回归，未重跑应用构建，结果见CURRENT_STATE第11节。F01历史快照保留在 [LOCAL_ENVIRONMENT](docs/development/LOCAL_ENVIRONMENT.md)。

## 任务校验

```bash
node --test scripts/verification/runner.test.mjs
pnpm run verify:task -- AF-002
pnpm run verify:task -- AF-003
pnpm run verify:task -- AF-004
pnpm run verify:task -- AF-006
pnpm run verify:task -- AF-007
pnpm run verify:task -- AF-008
pnpm run verify:task -- AF-009
pnpm run verify:task -- AF-010
pnpm run verify:task -- AF-011
pnpm run verify:task -- AF-012
pnpm run verify:task -- AF-013
pnpm run verify:task -- AF-015
pnpm run verify:task -- AF-016
pnpm run verify:task -- AF-017
pnpm run verify:task -- AF-018
pnpm run verify:task -- AF-019
pnpm run verify:task -- AF-020
pnpm run verify:task -- AF-021
pnpm run verify:task -- AF-022
pnpm run verify:task -- AF-022 --prepare-manual
pnpm run verify:task -- AF-002 --prepare-manual
```

AF-022继承AF-021实际185项+2宿主，追加16项配置HTTP/DB与5项main生命周期，共206+2。Schema/两迁移保持，仅已声明合成库与忽略产物写入；公开上下文不返回配置全集，敏感高层不退回泄露低层值。未知AF-023与非法manual参数实际exit2。

复跑普通verify前Writer执行`node scripts/verification/configuration-manual.mjs stop`，核对记录PID/PPID/CWD/命令/birth与零池，只停自有API；保留库/卷/凭据，恢复走注册prepare。Trea不运行准备，PREPARED不替人工。

`pnpm run db:up -- both` 创建/复用本库实例；`pnpm run db:check -- dev` 和 `pnpm run db:check -- test` 默认真实认证并核对database/user/sessionUser。`--config-only` 才只返回CONFIG_VALID。停止用 `pnpm run db:stop -- both`，随后可用 `pnpm run db:cleanup -- both` 删除已停止的自有容器/网络，卷与凭据保留。具体环境优先级、归属保护与人工步骤见独立数据库实例文档。

AF-010普通verify会在两个自有实例新建随机空库、应用initial/独立账本并执行回滚的合成约束探针；53 CLI/目标回归+两组各9项=71项，非只读校验，不改源码或启停服务。原dev/test不deploy。入口与实际库名见Initial指南。

只读来源：`/Users/lei/Documents/余总合作/轻启AI/qingqi-ai-consultant`，AF-009核对HEAD仍为 `cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`、工作区干净，Git index及定向Schema hash保持。AF-009历史从FileAsset/Plugin/PluginInstallLog定向抽取并明确适配，未迁业务关系、上传内容或旧插件记录，未连接原数据库；来源与许可见SOURCE_PROVENANCE第9节。

AF-010来源保护：原库HEAD/index/定向Schema hash保持；仅从本库目标Schema生成initial，没有读取或复制旧89份SQL/旧_prisma_migrations，也没有连接原数据库。来源与许可见SOURCE_PROVENANCE第10节。

AF-011只定向复用原Prisma服务/模块的单例与disconnect结构，改为延迟连接以保留故障时liveness；来源及适配见SOURCE_PROVENANCE第11节。当前readiness核对身份/本地迁移名与checksum/完成状态，不替代全Schema漂移、CRUD权限或正式部署验收。

AF-012来源与适配见SOURCE_PROVENANCE第12节。db:seed只初始化，不作为改密/权限修复器；完整用法与当前数据库人工步骤见最小Seed指南，AF-013接入登录/me，AF-015接入管理员基础API，AF-016接入角色和权限CRUD，页面未实现。

AF-013定向适配原auth模块、服务、控制器、DTO及JWT Guard，来源/排除项见SOURCE_PROVENANCE第13节。JWT不带权限快照，登录审计只覆盖本项；不宣称完整RBAC、通用审计或会话撤销。

AF-014来源与适配见SOURCE_PROVENANCE第14节。只读GET /api/admin/permissions/my对有效身份开放，GET /api/admin/permissions绑定现有aij.bootstrap.admin；该限定目录绑定不自动扩大为其他管理路由权限。RBAC不把客户端workspaceId或role.dataScope当成已实现客户租户/行级隔离。

AF-015来源与适配见SOURCE_PROVENANCE第15节。管理员API明确绑定admin.user.manage，Seed需显式--admin-users注册定义，原角色授权不自动扩大或恢复；当前七路由与超级/角色/自操作边界、改密不撤销旧JWT的限制见管理员管理指南。

AF-016来源与适配见SOURCE_PROVENANCE第16节；角色软删清权限关联、权限有引用不硬删；显式--rbac-management只注册定义而不恢复角色授权。当前范围与人工服务以角色权限指南为准。

AF-023当前文档：[密钥引用API](docs/development/SECRET_CENTER_API.md) · [执行记录](docs/execution/AF-023.md)。AF-022及更早条目保留历史，不替代本轮现场。

AF-024当前文档：[审计日志API](docs/development/AUDIT_LOG_API.md) · [执行记录](docs/execution/AF-024.md)。AF-023及更早保留阶段快照，当前人工入口以此为准。
