# AIJ Foundation 协作与工程规则

## 1. 仓库与本次基线

- 本仓库维护 **AIJ 独立底座产品**，主工作区为 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`；负责人批准的并行批次另允许本仓库已注册的 Orca 子 Worktree 独立开发。子工作区必须由本仓库最新已验证的 `origin/dev` 创建，登记实际 Worktree/Task/Dispatch ID 与起始 SHA；旧 barracuda、其他仓库或未注册目录不在授权内。
- `/Users/lei/Documents/余总合作/轻启AI/qingqi-ai-consultant` 是轻企产品仓库。F00 及后续抽取阶段只把它作为只读代码来源，保留其所有文件、分支和未提交修改。
- 两个产品各有独立 Git 历史、环境、数据库、运行进程和验收。不得把新库指向原库的数据库、源码目录、node_modules 或上传目录；不得用符号链接伪装迁出。
- “迁出”指复制后定向抽取和适配，不意味着从原库删除能力。原产品改用底座包是将来的独立任务，本次未授权。
- F00 是文档和审计基线，不包含可运行底座、应用迁移、数据库创建或包发布。当前状态以 [CURRENT_STATE](docs/current/CURRENT_STATE.md) 为准。

## 2. 分支与 One Issue / One Writer

1. `main` = 已通过负责人验收的稳定版本；`dev` = 日常开发与集成分支。
2. 每次写入前核对目标 Issue、`git status --short --branch`、分支、HEAD 和 remote。默认在 `dev` 开发。
3. F00 开始时新库只有 `main`。本次按负责人指定的当前目录留下未提交初始化文档，不创建或切换分支，不把工作区文档视为 main 已发布版本。负责人在检查后决定如何建立 `dev` 和接收 F00；下一代码任务开始前必须具备 `dev`。
4. **One Issue / One Writer**：同一 Issue 同一时刻只有一个写入者；Codex、Trea、人工不得并发写入同一范围。只读 Review 可进行；任何修正须在原 Writer 停止并明确交接后开始。
5. 负责人可一次批准明确卡片、顺序和预算的有限批次。每卡只有一个 Writer；批准的 Orca 并行批次允许不同卡在已注册子 Worktree 中分别开发，原 `dev` 仅由总控串行集成。Worker 只写派工范围并交回候选提交，不改正式队列、registry、全局依赖或 `dev`；共享文件、数据库验收和重型构建由总控独占调度。批内实现、真实校验、修复和记录；满足已批准的 CODE_VERIFIED 依赖后直接继续，不逐卡等待确认。单卡预计超过 4 有效工程小时先保留成果并拆卡；默认每批最多 4 卡/12 有效工程小时，当前指派有明确上限时以指派为准。未批准批次不自动接续，不跨卡混写或隐藏失败。
6. 已有修改必须原样保留；发生同范围修改冲突或 Writer 冲突时停止写入并说明交接需要。禁止 reset、clean、覆盖用户文件或隐藏其工作。
7. 负责人控制分支、push、PR、merge、tag、版本、部署与发布，不创建或修改远端 Issue/PR、不发布包。对于已明确授权的正式任务卡，除非负责人对该卡明确要求不提交，Codex 必须在注册的 `verify:task` 与适用质量门禁全部通过、执行记录和队列状态更新后，作一次本地卡片提交。提交标题必须逐字采用队列中的任务名称；AF 编号可写在提交正文中，不替代标题。提交只包含本卡新增且可安全分离的差异，以及本卡执行记录/队列更新；禁止把继承或其他任务差异一并暂存。若无法安全隔离本卡差异，不做宽泛暂存或提交，记录阻塞并交负责人处理。失败、阻塞或验收未运行的卡不得提交为已验证。代码提交不代表负责人验收或接收；不自动 push；负责人已明确授权逐卡推送的批次（如 ORCA-B01），总控须在正式验证与本卡提交后快进推送 `dev` 并回读远端 SHA，禁止强推。
8. Orca 候选 Task 完成仅表示候选交付；总控接收 Writer 明确停止写入的交接，精确集成、执行 `verify:task` 与适用门禁、更新记录、按原名提交推送并回读远端 SHA 后，才可完成 `I-*` 集成 Task。下游代码依赖必须引用集成 Task 的真实 ID。失败交回原 Writer，未知存活或超时不视为交接。子工作区不复制凭据、不共享 node_modules/上传目录；未通过工作区数据库目标保护前，数据库验收只在原 dev 的已核验隔离测试库串行执行。详见 [编排约束](docs/planning/orca-optimization-20261104/coordination-policy.md)。
9. 按负责人指示，后续流程不再要求或等待 Trea 复核。Codex 在同一 Writer 内完成实现、适用质量门禁、真实成功/拒绝路径和改动自查；自查不冒充独立复核。批次出口状态为 OWNER_CHECK_PENDING，由负责人按批确认结果；自动通过和本地提交都不等于正式接收。批次完成、达到预算或硬阻塞时停止写入并暂停续跑；负责人决定后续指派以及本地卡片提交之外的 Git/发布节点。历史 Trea 报告和当时待验记录保留，不反填通过。

## 3. 产品与数据边界

- 核心：工程装配、认证、RBAC、菜单、管理员、会员基础身份、字典、配置、密钥引用、文件、审计、插件生命周期、异步运行时、集成。
- 通用组织：项目归属 `OrganizationProfile/ProjectProfile` 与客户租户 Workspace/Membership 是两种模型，不能相互替代。只抽取通用组织能力，轻企企业档案、IP、诊断和权益保持业务 owner。
- 系统插件：aij-ai、aij-notification、aij-payment，独立声明、权限和生命周期。AI 执行与成本真值、通知投递真值、支付轨道真值各归原 owner 类型，不复制成多套账本。
- 轻企保留：qingqi-app 的企业上下文、顾问、行动、FDE、知识、情报、建站/CMS、IP Automation、Company Ops、Finance Accounts，以及业务订单、权益、线索。
- 当前源文件位置不代表能力归属。AdminService、AiService、Seed、AppShell、Schema 是混合文件，必须逐能力拆分。不得全量复制 apps/api、apps/web、Schema、Seed、历史 migrations 或 .github。
- 不照搬旧 AGENTS 中“原库是唯一底座仓库”的要求；本次两独立产品仓库要求优先。源库现有规则仍由其负责人维护，本次不改写。
- 具体 owner 和禁止迁入范围见 [ARCHITECTURE](docs/current/ARCHITECTURE.md) 与 [F00 清单](docs/governance/F00_MIGRATION_INVENTORY.md)。

## 4. 实现与质量

- 保持经核验的 pnpm / NestJS / Next.js / React / Ant Design / Refine / Prisma / PostgreSQL 技术方向；版本以实际迁入的 manifest 和锁文件为准。迁出任务不顺带升级栈或重做 UI。
- Controller 负责入口，Service 负责能力，DTO 负责校验，Guard 负责认证与权限；统一响应、关联 ID、错误处理和审计。前端菜单取后端权限结果，按钮与 API 权限一致。
- 认证拒绝跨产品 Token；通用租户上下文须由服务端验证会话、成员关系、状态和权限，不能信任客户端自报 workspaceId。
- 新库只连接独立开发/测试数据库。任何 migrate/seed 先核对连接目标；本次禁止数据库节点。未来独立本地空库可执行审定迁移，共享/正式数据库操作另由负责人控制，禁止 reset 或复制真实库兜底。
- 本地端口约定：Web `3655`，API `3656`，PostgreSQL 开发 `55432`，测试 `55433`。启动前复检占用；不得停止其他项目进程。Cookie、JWT issuer/secret、存储目录也须隔离，详见 [本地环境](docs/development/LOCAL_ENVIRONMENT.md)。
- 只保存安全的 `.env.example`。真实 `.env*`、密钥、证书、数据库 dump、上传文件、运行日志、客户数据、构建产物禁止迁入。
- 保留代码来源、源提交和原许可证声明；缺少声明不能推定为 MIT 或可公开分发。[SOURCE_PROVENANCE](docs/governance/SOURCE_PROVENANCE.md) 是来源记录，不是发布授权。
- 实包必须导出并使用实际实现，不能把 descriptor、打印成功的 starter 或 mock 作为独立启动证据。同一能力在新库只有一个实现 owner，应用只是组合宿主。

## 5. 文档与交付

核心文档为本文件、README、PROJECT_BRIEF、`docs/current/{ARCHITECTURE,CURRENT_STATE,ROADMAP}.md`、`docs/governance/{F00_MIGRATION_INVENTORY,SOURCE_PROVENANCE}.md` 和 `docs/development/LOCAL_ENVIRONMENT.md`。`docs/generated/` 保存定向源码审计结果，不承载“已经迁入”的产品承诺。

交付必须写明实际 diff、数据库/接口/页面/权限/日志影响、验证命令与结果、未实现与阻塞、访问地址是否真的已运行、人工验收步骤、下一任务依赖和 Writer 交接。没有 package.json 的 F00 不伪造 lint/build/test 通过；后续按实际 scripts 运行目标测试与适用门禁。

指令优先级：负责人当前指令 → 本文件 → 当前架构与状态 → 本次源码证据 → 历史文档。新结论需保留来源和阶段，不能把未来设计表述为当前实现。
