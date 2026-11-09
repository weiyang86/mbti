# AF-187 · 复核文档插件交易与灾备目标覆盖

候选：READ_ONLY_TARGET_AUDIT；源码点 `48e8d26ea1dcd67df65d316a0edfdec4bcb2d502`；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人验收 PENDING。自查不等于独立Review。

17条：8 PARTIAL、9 MISSING、0 READY_FOR_TARGET_ACCEPTANCE、0 UNPROVEN。已读源码与批准报告足以区分可复用基础和缺口，不足以签任何整条AC通过。建议先交个人Agent历史恢复、个人文档编辑、插件影响预览三条产品切片，总11h含根；交易与灾备依下列完整关闭计划推进，不用协议通过替代目标完成。

## 登记与授权

| 字段 | 实际值 |
| --- | --- |
| recordedAt | 2026-11-06T06:40:50.121037 |
| worktreeId | ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W13-AF187 |
| taskId | task_d0b50985c3c5 |
| dispatchId | ctx_be1a739f75f5 |
| terminal | term_62c8ce96-fcc2-411f-91b1-2b6924a1fb6e |
| branch | weiyang86/AIJ-W13-AF187 |
| head | 94b0236f775fa40a07944c5e0545ac6ce0e123f3 |
| originDev | 94b0236f775fa40a07944c5e0545ac6ce0e123f3 |
| sourceHead（唯一产品证据点） | 48e8d26ea1dcd67df65d316a0edfdec4bcb2d502 |
| 写前状态 | 干净；git status --short --branch仅分支行 |
| remote | origin git@github.com:weiyang86/aij-foundation.git（fetch/push，仅核对；无网络） |

候选只写本MD、同名JSON和docs/execution/AF-187-candidate.md；自身审计索引位于忽略目录.artifacts/AF-187-audit。已核验Orca父子登记与起始SHA。候选允许按派工精确原标题本地提交；正式verify:task及root接收需由总控执行，非本卡自签。

## 冻结需求与逐条关闭计划

以下目标原文/正反场景来自固定提交的正式基线和traceability，文字不裁剪。JSON中sourceEvidence的hash为完整blob SHA256，行号为该提交的真实短范围；冻结规格证据明确标注为规格。缺失能力只引用目标/相邻owner边界，绝不编造实现。

### REQ-014 · 计量与对客结算 · PARTIAL

阶段 M7；AC-014；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 上游成本与对客售价分别记录，预占额度后按价格版本结算并释放差额；平台分配与套餐/充值/任务付费并存。

**冻结正向：** 10元预占、3元可计费时实扣3释放7；关联唯一任务/调用/来源与价格。

**冻结拒绝：** usage缺失保持待核对而非零成本；重放和并发不重复扣费或双花。

**当前API/UI/SDK/runtime/persistence：** API：/client/ai/agents/:code/runs 与个人Agent运行、只读预检；UI：AI工作台/个人Agent预检显示估算上限；SDK：Agent提交/预检。Runtime：Job→Run→Trace→AiCenterBudgetService；PG：AiEvaluationBudgetRun/Reservation、AiAgentRun。仅内部模型预算，不是客户现金/赠额/售价版本账；无套餐、充值、任务商品或余额结算页面/API/SDK。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:72-72`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:87-87`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/src/plugins/aij-ai/ai-center-budget.service.ts:17-29`；SHA256 `b5b91157e12ecc88fe82f06e4568e8b2d6df455c885bdf761d9d8640b6d78746`：内部预算reserve使用项目锁和预留记录，非用户钱包。
- `apps/api/src/plugins/aij-ai/ai-center-budget.service.ts:32-44`；SHA256 `b5b91157e12ecc88fe82f06e4568e8b2d6df455c885bdf761d9d8640b6d78746`：同一预留settle幂等并释放差额，未记录对客价格版本。
- `apps/api/src/plugins/aij-ai/ai-center-run.service.ts:167-173`；SHA256 `b95651504ce5251196703f0e28b216a4f0ef623939ebd6f7c422195bf29bccd6`：未尝试失败释放内部预留；已尝试未知保留预留。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-123/run-3Zt9FO/report.json`；SHA256 `14c442f9a040e6e34f278173305d58440eb4101c75df68b675f7be23a675cad7`。agent-runtime 11/11、evaluation-budget 6/6：真实隔离PG、HTTP与自有loopback上游验证并发上限、持久预留/幂等结算/未知保留。 限制：历史合成执行与内部预算；不是客户10元现金预占→3元价格版本实扣/7元释放，不证明厂商账单。
- `.artifacts/verification/AF-165/run-Gh05eu/report.json`；SHA256 `9e7a86735e3f42e2d1614d0e42db4f8f96651ff755c84c5752f3e8c61f283940`。real-preview-readonly-http-pg-packed 9/9：只读预检安全投影、估算、零凭据解析/调用/账本变动及编译SDK。 限制：费用上限是模型执行预算，未实现用户售价、钱包或付费准入。

**尚需情景/实现阻塞：**

- AC-014 冻结正向：10元预占、3元可计费时实扣3释放7；关联唯一任务/调用/来源与价格。
- AC-014 冻结拒绝：usage缺失保持待核对而非零成本；重放和并发不重复扣费或双花。
- 产品实现阻塞：唯一对客计量owner、价格版本、现金/赠额/平台配额分账及待核对状态不存在；不能把估算当成本回执。

**外部输入（只阻塞真正依赖项）：**

- O04：价格/税费/套餐与退款条款；真实usage及厂商账单须获准账号/预算，内部合成账本可先做。

**整条关闭计划：**

1. 先做唯一对客计量owner与Trace/Run引用、价格快照、并发幂等预占/结算/释放，实际PG验证10/3/7、缺usage待核对和双花拒绝。
2. 后续分别交付平台分配、套餐/充值、任务付费与余额查询UI/SDK；商品订单owner经PaymentPayableSource交支付，不复制上游成本。
3. 接入实际usage/账单对账，覆盖退款/取消/迟到回执后以AC-014与AC-032联合目标验收，负责人PENDING。

### REQ-022 · 在线文档与导出 · MISSING

阶段 M5；AC-022；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 网页预览和正文编辑、章节局部重生成、历史版本恢复，首批导出Word/PDF；论文规则由业务插件组合。

**冻结正向：** 编辑正文后重生成指定章节，显示差异并导出可打开且排版可读的Word/PDF。

**冻结拒绝：** 并发编辑与AI重生成不得静默覆盖用户修改；导出越权资源被拒。

**当前API/UI/SDK/runtime/persistence：** 无在线创作文档owner、编辑/章节再生成/历史恢复/Word或PDF导出API、UI、SDK、任务执行器或持久模型。现有AiKnowledgeDocument是知识源正文，不是输出文档编辑器；知识网页导入与来源核对不补足本目标。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:95-95`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:95-95`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/prisma/schema.prisma:929-948`；SHA256 `d93792ee299fa8dbf02af3104ada3a3fd01b24acd2683c914d6f62c4c01d1ca7`：仅知识源正文/status/归属模型，无创作文档章节/输出版本或导出记录。

**实际PASS证据及边界：**

无匹配目标功能的批准运行报告；邻近模块或包构建不计作本目标通过。

**尚需情景/实现阻塞：**

- AC-022 冻结正向：编辑正文后重生成指定章节，显示差异并导出可打开且排版可读的Word/PDF。
- AC-022 冻结拒绝：并发编辑与AI重生成不得静默覆盖用户修改；导出越权资源被拒。
- 正文编辑/章节差异、局部生成并发冲突、历史恢复与两类可打开导出全缺；上传PDF不等于导出PDF。

**外部输入（只阻塞真正依赖项）：**

- O08：公式/引用/样式与编辑冲突支持范围；可先交纯文本编辑版本切片，不依赖外部厂商。

**整条关闭计划：**

1. 建议D1先交个人纯文本文档可编辑/历史/CAS闭环。
2. 再交章节模型与受控AI局部再生成：复用Job/Trace、源版本对比、显式应用差异，人工并发编辑返回冲突并保留现状。
3. 分别交付DOCX和PDF导出、权限/引用/恶意输入拒绝、实际阅读器渲染与浏览器历史恢复；业务论文规则仍由插件组合，完成AC-022后等待负责人。

### REQ-023 · 图表编辑与生成 · MISSING

阶段 M5；AC-023；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 数据图表与示意图均支持；PNG/SVG、数据/配置/生成脚本保留，网页可改数据、颜色、坐标轴和图例。

**冻结正向：** 以已知数据生成图表、网页改数据重绘并导出PNG/SVG，统计值与来源一致。

**冻结拒绝：** 示意图片不能冒充数据计算图，未授权数据/脚本及恶意SVG不可执行或外泄。

**当前API/UI/SDK/runtime/persistence：** 无数据图表/示意图资产owner、数据/配置/生成脚本持久化、网页图表编辑或PNG/SVG导出API/UI/SDK。已有image模型/图片附件属于图像生成及存储，不证明数据统计或可编辑图表。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:96-96`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:96-96`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。

**实际PASS证据及边界：**

无匹配目标功能的批准运行报告；邻近模块或包构建不计作本目标通过。

**尚需情景/实现阻塞：**

- AC-023 冻结正向：以已知数据生成图表、网页改数据重绘并导出PNG/SVG，统计值与来源一致。
- AC-023 冻结拒绝：示意图片不能冒充数据计算图，未授权数据/脚本及恶意SVG不可执行或外泄。
- 全部AC-023：已知数据校验、四类网页编辑、PNG/SVG真实字节、源数据/配置/脚本保留及恶意SVG/越权脚本拒绝均未证实。

**外部输入（只阻塞真正依赖项）：**

- O05：受控图表脚本依赖/资源上限；示意图样例与O08输出范围。

**整条关闭计划：**

1. 先交独立图表owner的个人已知数据柱/折线图垂直切片：表格编辑→受控配置→重绘→PNG/SVG及数据/配置快照。
2. 再补示意图与生成脚本的隔离执行/来源/版本，脚本不在API进程执行；明确统计图与示意图类型。
3. 浏览器核对数据/颜色/坐标/图例和导出，拒绝跨成员源数据及脚本/SVG执行；全AC-023目标验收后负责人确认。

### REQ-024 · 完整插件开发 · PARTIAL

阶段 M6；AC-024；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 面向内部和第三方，提供规范/SDK/模板/调试/兼容检查/打包审核；插件可扩展页面/API/权限/数据/任务/AI工具。

**冻结正向：** 独立插件目录开发最小完整业务模块，安装到兼容消费者，无内核业务改动。

**冻结拒绝：** 未签验/未知包/不兼容依赖或非法命名空间拒绝，不把manifest声明当真实页面/API。

**当前API/UI/SDK/runtime/persistence：** API：管理员/plugins目录/安装等；运行宿主静态导入AI/通知/支付三插件；manifest含权限/页面路由/迁移/jobs声明。packages/sdk是真实客户端SDK，private pack有实消费。缺独立完整业务插件模板/开发调试/审核签验入口、第三方包安装器及其页面/API/数据/任务/AI工具扩展闭环；市场UI不存在。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:102-102`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:97-97`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/src/plugin-runtime/plugin-manifest.ts:30-50`；SHA256 `2e8a246c80313ac4c55b3b403cff27b5f0c386d5c97e827f767a333f5e311b8e`：manifest声明页面/权限/迁移/任务等扩展形状，不执行其实现。
- `apps/api/src/plugin-runtime/plugin-manifest.ts:78-89`；SHA256 `2e8a246c80313ac4c55b3b403cff27b5f0c386d5c97e827f767a333f5e311b8e`：校验器只校验声明，不导入或执行生命周期代码。
- `apps/api/src/plugin-runtime/trusted-plugins.ts:1-9`；SHA256 `7918211614cd378d0d21eaeb77bc2aecf3e2e81406a6c6d85529e32e7021fc2b`：运行实现是三插件静态受信注册。
- `packages/core/package.json:2-6`；SHA256 `c3f50648f77e9a2d8279c5eac5e88b0048a7edb1618df217e653abf61acb75a7`：实包private/UNLICENSED，对外许可未获授予。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-067/run-FhnZh2/report.json`；SHA256 `85b24e3fc4990b1cc1b6f832ae964cc88a92afc7cc6f07d47276307273160a36`。manifest测试12/12及实际API build：SemVer、命名空间、路由遍历、敏感默认值、兼容与静态allowlist拒绝。 限制：声明/静态装配检查，不是独立第三方插件安装成功。
- `.artifacts/verification/AF-076/run-Ryh30Y/report.json`；SHA256 `af7912d919c822a830dd934d79714738016b9d4ae042cbba5c30d08301f8f47c`。单一私有tarball consumer真实离线物化/构建并启动API，迁移与恢复后readiness与Web SSR通过。 限制：是完整底座私有消费，不是从独立插件目录打包安装最小完整业务插件；不证明公共分发或许可。

**尚需情景/实现阻塞：**

- AC-024 冻结正向：独立插件目录开发最小完整业务模块，安装到兼容消费者，无内核业务改动。
- AC-024 冻结拒绝：未签验/未知包/不兼容依赖或非法命名空间拒绝，不把manifest声明当真实页面/API。
- 产品阻塞：可信制品身份/审核、兼容包加载及迁移机制、SDK/模板/调试宿主未闭环；不能通过manifest路径执行任意包。

**外部输入（只阻塞真正依赖项）：**

- O07：SDK/插件来源、许可证和公开分发条款；内部受信完整样例可先做。

**整条关闭计划：**

1. 先提供独立目录的内部受信业务样例，实际页面/API/权限/表/Job/AI工具各有可运行实现；经受控编译装配而非内核散改业务。
2. 补齐模板/开发命令/兼容检查与包摘要签验/审核导入；拒绝未知、未验签、不兼容及非法命名空间包。
3. 对最终制品执行独立consumer安装、真实API/PG/浏览器与SDK编译；O07解决后另核对分发门禁，AC-024等待负责人。

### REQ-025 · 生命周期与局部升级 · PARTIAL

阶段 M6；AC-025；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 提供安装、配置、启停、升级、影响预览及恢复；被升级插件可维护或重启，其他插件/业务继续使用；保留已有数据。

**冻结正向：** 插件A升级中停用，插件B业务读写/任务继续，A恢复后数据及授权可核对。

**冻结拒绝：** 失败升级不污染B；停用A后导航移除且直接API拒绝；未知恢复能力不承诺任意回滚。

**当前API/UI/SDK/runtime/persistence：** API：/admin/plugins 安装/启停/升级/操作/显式重试，权限plugin管理；PG PluginInstallation/Operation、旧版本/重试链；Runtime每请求/Job及凭据访问有启用围栏。升级仅更新可信目录版本元数据、须先停用；无升级影响预览产品页/统一制品迁移执行器，未证实A实际升级期间B连续业务读写和在途任务。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:103-103`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:98-98`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/src/plugin-runtime/plugin-management.controller.ts:10-28`；SHA256 `1e6ba56f3680f8b1d9ba0d8d733f66541d578ce14c4dd866b12e3275046ce8b2`：受权限保护的实际生命周期API。
- `apps/api/src/plugin-runtime/plugin-lifecycle.service.ts:234-247`；SHA256 `10ac9b6495b0ad3bea298535f63686150bc1a1dcda10ff9af4698338cb1a9072`：升级要求已停用和更新可信版本，仅写安装状态；启停独立。
- `apps/api/src/plugin-runtime/plugin-lifecycle.service.ts:151-163`；SHA256 `10ac9b6495b0ad3bea298535f63686150bc1a1dcda10ff9af4698338cb1a9072`：失败回退安装版本元数据与审计，不等于逆转任意数据迁移。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-070/run-LLbGND/report.json`；SHA256 `4c20a4232adacda623aab2f700bfa8f71636360e0002de8f63e5bc9fa79dcbff`。真实HTTP/PG 4/4覆盖管理授权、插件停用后路由/worker/凭据拒绝。 限制：历史生命周期围栏，不含完整包升级期间浏览器B业务连续成功。
- `.artifacts/verification/AF-072/run-YaZ0D6/report.json`；SHA256 `5924b42a3ab08b9cd3ccb7dd8def03cc17a01ed0c0e98bf4ad4182363cad9a5a`。真实PG 4/4：触发器令升级操作插入失败时事务回滚、版本元数据恢复、显式重试幂等、配置保留及无关插件enabled状态不变。 限制：无关插件enabled状态不变不等于B业务读写/任务持续成功；不证明插件数据迁移逆转。

**尚需情景/实现阻塞：**

- AC-025 冻结正向：插件A升级中停用，插件B业务读写/任务继续，A恢复后数据及授权可核对。
- AC-025 冻结拒绝：失败升级不污染B；停用A后导航移除且直接API拒绝；未知恢复能力不承诺任意回滚。
- 缺影响预览、受控制品升级和迁移恢复范围；现有恢复只允许已知元数据/兼容情形，不能承诺任意回滚。

**外部输入（只阻塞真正依赖项）：**

- 具体发布制品与可恢复迁移规则需在内部插件样例上落实；不依赖支付商户。

**整条关闭计划：**

1. 建议P1先交升级影响预览与实际A停用/B持续API读写和Job证据。
2. 依REQ-024补实际可信制品升级/迁移及备份恢复范围：A可维护/重启，其他独立B继续；失败与并发启停要实际注入。
3. 最终浏览器导航+直接API拒绝、A数据授权/版本核对、B持续读写/在途任务并用当前制品跑AC-025；负责人PENDING。

### REQ-026 · 两层市场 · MISSING

阶段 M7；AC-026；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** AIJ跨产品能力市场和产品内部内容/交易市场并存；运行数据仍归独立产品，安装/审批与个人AI资产使用权限分开。

**冻结正向：** 市场发布版本经审核后授权安装到指定产品或组织，个人可购买获准AI资产。

**冻结拒绝：** 用户购买不能获得后台代码安装权限；市场不可读取消费者业务库/密钥。

**当前API/UI/SDK/runtime/persistence：** 无AIJ跨产品能力市场、产品内部内容交易市场的目录发布/审核/购买/安装API、UI、SDK或持久owner；仅本机静态插件目录与个人私有资产库。产品数据库独立原则存在，不是市场隔离验收。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:104-104`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:99-99`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。

**实际PASS证据及边界：**

无匹配目标功能的批准运行报告；邻近模块或包构建不计作本目标通过。

**尚需情景/实现阻塞：**

- AC-026 冻结正向：市场发布版本经审核后授权安装到指定产品或组织，个人可购买获准AI资产。
- AC-026 冻结拒绝：用户购买不能获得后台代码安装权限；市场不可读取消费者业务库/密钥。
- 发布版本/审核/指定产品或组织安装、个人购买AI资产、安装权与使用权分离全部缺；不能以个人库或插件allowlist代替两层市场。

**外部输入（只阻塞真正依赖项）：**

- O04商品/价格；O07分发/许可条款；市场版本引用将依赖商业授权与可信插件制品。

**整条关闭计划：**

1. 建立两层市场各自唯一目录/版本/审核owner，消费者仅交换包/元数据/授权，不接触业务库或密钥。
2. 复用商业授权/支付核实交易，分开后台安装审批与个人资产使用；跨产品授权实例身份校验。
3. 安装/购买/使用UI、API/SDK与拒绝路径贯通后跑AC-026；REQ-024/027/028是实现依赖，不是虚构Orca Task。

### REQ-027 · 商业授权 · MISSING

阶段 M7；AC-027；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 支持实例、组织、个人、按调用授权；版本、期限、购买及使用记录关联，授权到期与历史成果处置规则明确。

**冻结正向：** 同一商品按所选授权范围开通并计次/到期，使用与退款可追溯。

**冻结拒绝：** 复制许可证到其他实例/组织、重放回调和伪造次数均不能扩权。

**当前API/UI/SDK/runtime/persistence：** 无实例/组织/个人/按调用商业许可证、购买授权与使用次数owner、到期/历史成果处置API/UI/SDK或持久模型；RBAC/Member/PluginInstallation只是访问/运行权限，不是商业授权。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:105-105`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:100-100`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。

**实际PASS证据及边界：**

无匹配目标功能的批准运行报告；邻近模块或包构建不计作本目标通过。

**尚需情景/实现阻塞：**

- AC-027 冻结正向：同一商品按所选授权范围开通并计次/到期，使用与退款可追溯。
- AC-027 冻结拒绝：复制许可证到其他实例/组织、重放回调和伪造次数均不能扩权。
- 四种范围开通/到期/计次、许可证跨实例复制拒绝、回调重放不增权、使用退款追溯全缺。

**外部输入（只阻塞真正依赖项）：**

- O04授权/到期/退款条款；O07许可证签发与分发权利。

**整条关闭计划：**

1. 建立不可复制扩权的授权owner，绑定实例identity/范围/版本/期限/购买交易，计次使用需并发幂等。
2. 续期/退款后依据核实交易追加授权变更，不覆盖历史；UI展示到期、可用范围和历史成果处置。
3. 每范围成功/拒绝、时钟到期、复制/重放/并发耗次均真实PG/SDK验收，完成AC-027后等负责人。

### REQ-028 · 真实支付渠道 · PARTIAL

阶段 M7；AC-028；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 微信、支付宝、抖音接入；保留支付单/尝试/回调/交易/退款/对账唯一owner，行业订单与权益仍归业务或市场owner。

**冻结正向：** 按商户能力完成小额下单、回调、查询、退款与对账，权益基于核实交易。

**冻结拒绝：** 伪造签名、金额/币种/商户/应付对象不一致与重复回调拒绝或幂等。

**当前API/UI/SDK/runtime/persistence：** API：client payment request/status、provider callback、admin支付查询/人工退款申请/对账；UI /auth/payments仅后台查询/申请。SDK无三渠道真实收款集成；PG PaymentOrder/Attempt/CallbackReceipt/Transaction/RefundRequest/Reconciliation owners。非测试运行provider registry空，payable/credential resolver unavailable；唯一运行adapter为synthetic测试。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:111-111`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:101-101`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/src/plugins/aij-payment/payment-runtime.module.ts:24-43`；SHA256 `d3c5ed87ca4dbdb2c6f08fd06df04cc145abfdffb6c591c867326bca0c55ba79`：非测试payable/credential不可用，provider注册为空，测试才注入synthetic。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-104/run-blwpJr/report.json`；SHA256 `20d1a95b68ae4368d639ad9c79fe2efc2926a07fe385e7d7f0bdd7382494e542`。真实HTTP/PG 7/7：服务端金额币种、幂等并发单次dispatch、跨空间/权限/CSRF拒绝、timeout未知。 限制：合成payable/provider，未收真实款。
- `.artifacts/verification/AF-105/run-kEmT0v/report.json`；SHA256 `157da6e1240bc9cc11cc641d559a7d761bf91dbaceb3af84581d03145a81afe4`。callback HTTP/PG 8/8：签名/过期/项目/金额币种状态拒绝、重复回调幂等及唯一交易。 限制：合成HMAC协议，不是微信/支付宝/抖音官方渠道验签。
- `.artifacts/verification/AF-107/run-R0KPxw/report.json`；SHA256 `6403b059b9f806117bbb86e2600b81843f22105cf55cff2aabe2e70b3b838e32`。reconciliation HTTP/PG 6/6：差异队列/审阅、幂等隔离审计且支付事实不改。 限制：仅合成轨迹对账，不是渠道查询/账单或真实退款。

**尚需情景/实现阻塞：**

- AC-028 冻结正向：按商户能力完成小额下单、回调、查询、退款与对账，权益基于核实交易。
- AC-028 冻结拒绝：伪造签名、金额/币种/商户/应付对象不一致与重复回调拒绝或幂等。
- 产品阻塞：三渠道真实adapter/商户配置/应付对象owner/查询退款及对账未接；行业订单权益仍交原owner。

**外部输入（只阻塞真正依赖项）：**

- O02抖音具体交易类型/类目/准入；三商户测试资格、凭据安全注入、回调可达地址、小额预算；O04商品与规则。

**整条关闭计划：**

1. 按渠道各一实际适配垂直卡，复用支付唯一轨道/SecretRef/商品应付快照；先落实测试商户准入，不阻塞离线协议实现。
2. 逐渠道实际小额下单→官方回调/主动查询核实→退款核实→账单对账；超时保持未知、重试前核实。
3. 三渠道官方签名/金额/币种/商户/对象/重放拒绝及权益只据核实交易全部覆盖AC-028，负责人PENDING。

### REQ-029 · 订阅续费 · MISSING

阶段 M7；AC-029；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 提供独立续费授权、到期提醒和关闭入口，保留各支付渠道能力差异。

**冻结正向：** 授权后续费，到期前提醒；关闭后不再发起后续扣款，账期权益可查。

**冻结拒绝：** 无有效授权/不支持渠道不得伪造自动续费；超时不重复扣款。

**当前API/UI/SDK/runtime/persistence：** 无订阅协议/独立续费授权、账期、到期提醒、关闭续费API/UI/SDK、调度handler或持久模型；通用Schedule和通知不能当已实现订阅。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:112-112`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:102-102`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。

**实际PASS证据及边界：**

无匹配目标功能的批准运行报告；邻近模块或包构建不计作本目标通过。

**尚需情景/实现阻塞：**

- AC-029 冻结正向：授权后续费，到期前提醒；关闭后不再发起后续扣款，账期权益可查。
- AC-029 冻结拒绝：无有效授权/不支持渠道不得伪造自动续费；超时不重复扣款。
- 授权后续费/提醒/关闭不再扣款；不支持渠道/无授权拒绝及超时不重扣全缺。

**外部输入（只阻塞真正依赖项）：**

- O04续费协议/账期退款条款；逐渠道自动续费能力及商户准入；通知实际收件渠道。

**整条关闭计划：**

1. 建立订阅owner绑定独立授权、账期与关闭状态，使用现有Schedule/Outbox与Payment owner；UI可查账期并关闭。
2. 仅渠道已核定支持时发起扣款，任务执行前复检授权；未知结果查询不重扣。
3. 可控时钟、关闭与在途任务竞争、无授权拒绝及真实能力渠道验证AC-029；不支持渠道明确不可用。

### REQ-030 · 优惠券 · MISSING

阶段 M7；AC-030；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 提供可复用优惠规则/券和核销能力，价格真值由商品/订单owner确定后交支付。

**冻结正向：** 符合规则的订单锁券、核销或失败释放，与退款规则关联。

**冻结拒绝：** 并发重复核销、跨商家券和篡改客户端价格被拒。

**当前API/UI/SDK/runtime/persistence：** 无优惠规则/券发放、锁券/核销/释放/退款关联API/UI/SDK或PG模型；PaymentPayableSource只接受服务端应付快照，不计算券或商品价。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:113-113`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:103-103`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。

**实际PASS证据及边界：**

无匹配目标功能的批准运行报告；邻近模块或包构建不计作本目标通过。

**尚需情景/实现阻塞：**

- AC-030 冻结正向：符合规则的订单锁券、核销或失败释放，与退款规则关联。
- AC-030 冻结拒绝：并发重复核销、跨商家券和篡改客户端价格被拒。
- 并发重复核销/跨商家/客户端改价拒绝；成功核销、失败释放与退款规则全部未实现。

**外部输入（只阻塞真正依赖项）：**

- O04券规则/适用商品/退款返券规则；商品订单唯一价格owner尚缺，是实现依赖而非仅外部账号。

**整条关闭计划：**

1. 先落实商品订单价格owner，再建立独立优惠规则/券/锁券核销流水，订单先定价后交PaymentPayableSource。
2. 网页展示规则和核销结果；支付失败/取消释放、退款按已公示规则追加记录。
3. 真实PG竞争核销/重放/跨商家/篡价和成功全链路AC-030，不能把客户端优惠价交支付。

### REQ-031 · 分账与结算 · MISSING

阶段 M7；AC-031；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 按核实交易、退款和渠道可用能力处理分账/结算，保留失败/撤销/重试与审计。

**冻结正向：** 合成/获准真实小额交易完成分账结算并核对金额来源。

**冻结拒绝：** 未支付/已全退/超可分账金额不执行，不承诺所有渠道同等能力。

**当前API/UI/SDK/runtime/persistence：** 无分账/结算计划、接收方、渠道能力映射、撤销/重试/审计执行API/UI/SDK/Job或PG模型。PaymentReconciliation是对账与人工审阅，不是分账或商户结算执行。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:114-114`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:104-104`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/src/plugins/aij-payment/payment-reconciliation.service.ts:1-16`；SHA256 `2b4c444c43e7ecbc3c47e91caf6e2ebf951a6d59e1c714e9686241e9d30c3a03`：现有文件为支付对账owner导入，不能当分账执行证明。

**实际PASS证据及边界：**

无匹配目标功能的批准运行报告；邻近模块或包构建不计作本目标通过。

**尚需情景/实现阻塞：**

- AC-031 冻结正向：合成/获准真实小额交易完成分账结算并核对金额来源。
- AC-031 冻结拒绝：未支付/已全退/超可分账金额不执行，不承诺所有渠道同等能力。
- 未支付/全退/超可分金额拒绝与分账后退款/撤销、失败重试、核对来源均未运行。

**外部输入（只阻塞真正依赖项）：**

- O04比例/费用/接收方和结算周期；各渠道分账/结算准入与能力，不承诺等价。

**整条关闭计划：**

1. 基于核实PaymentTransaction建立唯一分账/结算owner，冻结金额来源及接收方规则；预留可分金额并发幂等。
2. 接受退款/撤销事件，受控重试前核实渠道状态，追加执行审计；UI显示待核对和失败。
3. 先合成交易完整成功/拒绝PG验收，再获准渠道小额执行及对账跑AC-031；不扩张payment轨道为业务订单。

### REQ-032 · 任务退款与余额 · PARTIAL

阶段 M7；AC-032；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 未执行取消释放预占；平台故障未交付可用成果退对应费用；中途取消按公示规则结算；BYOK上游费用不由平台伪造退款。

**冻结正向：** 核对平台故障、中途取消、现金余额和赠额分开处理，原路退款状态可核实。

**冻结拒绝：** 补偿/退款重复请求不重复退；退款未核实不能记成功，旧流水不覆盖。

**当前API/UI/SDK/runtime/persistence：** 内部预算可在未尝试失败时释放、已尝试未知保留；管理员退款API/UI仅创建pending_manual_review申请并预留可退上限，PG真实记录且不发资金。无任务对客收费/现金赠额账、平台故障退款政策执行、原路退款提交/查询/核实或客户端余额入口。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:115-115`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:105-105`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/src/plugins/aij-ai/ai-center-run.service.ts:167-173`；SHA256 `b95651504ce5251196703f0e28b216a4f0ef623939ebd6f7c422195bf29bccd6`：未尝试失败释放的是内部AI预算；已尝试未知不得推定退款。
- `apps/api/src/plugins/aij-payment/payment-admin.service.ts:121-134`；SHA256 `32394524899f5a42e11e38babbb7f2e5a7711e9956c1ee5696de64b28025319b`：仅在已核实charge上预留额度并新建pending_manual_review，未执行原路退款。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-106/run-OkmHy4/report.json`；SHA256 `27a9cfcdc74f6bf66bde000a5b0470f3823b83f3d0a391e416d8ba00034bfd85`。payment-admin HTTP/PG 6/6：并发可退上限、幂等/冲突/隔离、权限/插件拒绝；仅pending_manual_review，provider调用0且无refund/reversal交易。 限制：明确只证明退款申请，不证明资金退回、客户余额或任务故障退款。
- `.artifacts/verification/AF-123/run-3Zt9FO/report.json`；SHA256 `14c442f9a040e6e34f278173305d58440eb4101c75df68b675f7be23a675cad7`。真实PG内部预算/执行用量和未知保留通过。 限制：内部预算不是现金钱包，不证明故障未交付的对客退费。

**尚需情景/实现阻塞：**

- AC-032 冻结正向：核对平台故障、中途取消、现金余额和赠额分开处理，原路退款状态可核实。
- AC-032 冻结拒绝：补偿/退款重复请求不重复退；退款未核实不能记成功，旧流水不覆盖。
- 未执行取消、平台故障、中途取消、现金与赠额、充值实付可退余额、原路退款未核实不成功及BYOK不伪退须联合实现。

**外部输入（只阻塞真正依赖项）：**

- O04公示按量/按成果/服务费及退款规则；真实支付渠道退款资格与测试预算；BYOK上游由用户结算。

**整条关闭计划：**

1. 依REQ-014补唯一客户计费/余额owner与退款补偿规则：未执行全释放、平台故障无可用成果退对应费、中途取消按公示规则。
2. 复用PaymentRefundRequest与轨道追加退款提交/处理中/成功/失败核实记录，重放/并发不重复退款；现金/赠额/实付来源分离。
3. 真实失败/取消/迟到回执/原路退款/查账及BYOK上游不伪退跑AC-032；保留旧流水与厂商成本真值。

### REQ-034 · Linux私有化与升级 · PARTIAL

阶段 M8；AC-034；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 首批Linux单机；后台与CLI使用同一受控升级机制，展示版本/兼容/备份/结果/恢复范围。

**冻结正向：** 干净Linux主机按文档安装，UI与CLI生成同一升级计划、校验和及回执。

**冻结拒绝：** 不可用制品、越权/任意命令、错误数据库或无法恢复的变更被阻止。

**当前API/UI/SDK/runtime/persistence：** CLI aij-base仅install物化私有源码消费者，project CLI create/show/validate生成配置；无后台升级UI、共用UpgradePlan/API/receipt owner或Linux生产升级执行器。迁移脚本有实际ledger校验，私有consumer构建/启动已有历史成功；不是当前Linux完整安装/升级验收。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:122-122`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:107-107`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `scripts/distribution/aij-base/bin/aij-base.cjs:6-20`；SHA256 `22f9599dd272b1b1e54d9d2f3cb19f52645b0b34b459c046045a097d87a38bed`：CLI只支持install --dir，未有升级计划/执行入口。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-076/run-Ryh30Y/report.json`；SHA256 `af7912d919c822a830dd934d79714738016b9d4ae042cbba5c30d08301f8f47c`。真实私有tarball离线消费、PG/文件恢复后API health/readiness、DB outage恢复及Web SSR成功。 限制：当时合成consumer、旧schema和本机环境，不是干净Linux单机当前产品；HTTP200不等于功能验收。
- `.artifacts/verification/AF-079/run-cTE2Ty/report.json`；SHA256 `34ee93f252eb768370d5adb68cb78d284399c7e41666b697f4e778ff6a11edaf`。PG真实恢复/第8迁移、checksum/未完成迁移ledger拒绝。 限制：不是UI/CLI同一受控升级产品，也未验当前全部迁移。

**尚需情景/实现阻塞：**

- AC-034 冻结正向：干净Linux主机按文档安装，UI与CLI生成同一升级计划、校验和及回执。
- AC-034 冻结拒绝：不可用制品、越权/任意命令、错误数据库或无法恢复的变更被阻止。
- 干净Linux安装与当前制品、UI/CLI同一计划/摘要/回执、备份/恢复阻断及任意命令拒绝均缺。

**外部输入（只阻塞真正依赖项）：**

- 可用干净Linux验证主机/受控制品；O06容量与恢复时间。内部计划器开发不等该主机。

**整条关闭计划：**

1. 先建立唯一受控升级计划/状态owner，固定制品摘要/兼容/迁移/备份依赖，执行器白名单步骤，禁止任意shell。
2. UI和CLI消费同一计划/权限/回执，版本/失败/恢复范围透明，依REQ-035可恢复点阻断危险变更。
3. 用全新Linux单机及独立数据实际安装/升级/拒绝/恢复，比较UI/CLI计划摘要回执跑AC-034；仍不等于部署发布授权。

### REQ-035 · 整实例灾备 · PARTIAL

阶段 M8；AC-035；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 数据库、附件、配置及授权关系形成一致备份清单；恢复后校验版本/摘要并对外部事实对账。

**冻结正向：** 在新隔离目标实际恢复全部数据/文件/授权，比较摘要并恢复服务。

**冻结拒绝：** 只有备份文件没有恢复不算通过；缺对象/错版本/损坏归档明确失败。

**当前API/UI/SDK/runtime/persistence：** 无正式备份/恢复服务API/UI/SDK或可供用户操作CLI；已有verification脚本真实pg_dump+tar、隔离空目标恢复及文件摘要核对。其manifest.syntheticOnly=true，仅旧7→8迁移和PluginOperation/FileAsset，不覆盖当前资产/成员授权/配置、七牛对象/外部事实。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:123-123`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:108-108`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `scripts/verification/packed-consumer-upgrade.test.mjs:501-518`；SHA256 `632f96093734c7e9b5e44dbea22bb7b5e01086852db79a53602d88659ce7c105`：实际合成dump/文件清单及空隔离DB恢复，清单明确syntheticOnly。
- `scripts/verification/packed-consumer-upgrade.test.mjs:521-535`；SHA256 `632f96093734c7e9b5e44dbea22bb7b5e01086852db79a53602d88659ce7c105`：核对有限FileAsset字段/文件与PluginOperation，并非当前全产品数据恢复。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-079/run-cTE2Ty/report.json`；SHA256 `34ee93f252eb768370d5adb68cb78d284399c7e41666b697f4e778ff6a11edaf`。真实两个独立PG卷、旧7迁移合成库dump/tar恢复到新目标，核对PluginOperation/FileAsset及文件；恢复库真实升级第8迁移，7/7通过。 限制：未验证当前完整schema/配置/授权/七牛对象一致点，不是全实例灾备；不证明外部支付/通知对账。
- `.artifacts/verification/AF-076/run-Ryh30Y/report.json`；SHA256 `af7912d919c822a830dd934d79714738016b9d4ae042cbba5c30d08301f8f47c`。同一有限恢复库启动packed API、readiness及Web，实际DB停启恢复。 限制：对有限合成恢复的服务可用性，不覆盖当前全部数据/权限或目标Linux。

**尚需情景/实现阻塞：**

- AC-035 冻结正向：在新隔离目标实际恢复全部数据/文件/授权，比较摘要并恢复服务。
- AC-035 冻结拒绝：只有备份文件没有恢复不算通过；缺对象/错版本/损坏归档明确失败。
- 一致快照/可选恢复点、当前全资源清单和摘要、配置/授权关系、撤销/删除标记、支付/通知/消费事实对账和恢复后禁止自动重放全部未证实。

**外部输入（只阻塞真正依赖项）：**

- O06数据量、恢复耗时/容量、财务审计期；七牛测试桶与恢复对账账号在相应真实验收时提供。

**整条关闭计划：**

1. 复用已有隔离target保护和dump/tar技术，交付运维唯一备份清单/执行owner，冻结数据库与本地/七牛对象、配置引用和授权一致点；未共同验证不显示。
2. 实际在全新目标恢复当前schema/完整合成数据，校验版本/清单摘要/缺对象/损坏/错目标拒绝；重新施加撤权/删除标记而非复活旧凭据。
3. 暂停外部写动作直到支付/退款/结算/通知核对完成，禁止恢复自动重放；恢复服务及权限/文件实测AC-035再等负责人。

### REQ-036 · 组织恢复与冲突 · MISSING

阶段 M8；AC-036；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 先隔离重建并提取组织数据，检查依赖及差异；默认副本/新版本，覆盖需预览冲突，应用时仅暂停目标组织相关写入。

**冻结正向：** A组织恢复到已验证点，B保持业务读写；A数据、文件和依赖完整。

**冻结拒绝：** 跨组织引用、恢复点后的新修改和全局记录覆盖不自动合并，保留现状/副本/逐项选择。

**当前API/UI/SDK/runtime/persistence：** 无组织隔离重建/提取、依赖差异预览/选择应用API/UI/SDK、恢复Job/PG计划owner或组织级写围栏。Workspace membership权限已存在，ProjectProfile不是租户；整库合成恢复不能充当组织恢复。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:124-124`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:109-109`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。

**实际PASS证据及边界：**

无匹配目标功能的批准运行报告；邻近模块或包构建不计作本目标通过。

**尚需情景/实现阻塞：**

- AC-036 冻结正向：A组织恢复到已验证点，B保持业务读写；A数据、文件和依赖完整。
- AC-036 冻结拒绝：跨组织引用、恢复点后的新修改和全局记录覆盖不自动合并，保留现状/副本/逐项选择。
- A恢复/B持续读写任务、跨组织依赖拒绝、恢复点后新修改冲突及保留/副本/逐项替换全部未证实。

**外部输入（只阻塞真正依赖项）：**

- O06组织数据规模/恢复时间；先依REQ-035建已验证一致恢复点和资源依赖模型，不需要真实客户库。

**整条关闭计划：**

1. 从已验证整实例点恢复到隔离目标，按Workspace/Membership提取A及文件/版本依赖；跨组织/全局事实仅引用不覆盖。
2. 实现只暂停A相关写入/任务的围栏和差异预览，默认副本/新版本；当前成员授权复检并保留删除撤权标记。
3. 并发B业务读写/在途任务真实PG+HTTP+浏览器持续成功，A冲突三选择与不自动重放/不复活凭据跑AC-036。

### REQ-037 · 资源版本恢复 · PARTIAL

阶段 M8；AC-037；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 文件、知识、Agent、Skill、流程、文档/图表恢复成新版本，保留当前内容和运行引用。

**冻结正向：** 指定资源恢复历史版本并形成新版本，运行仍能引用原冻结版本。

**冻结拒绝：** 不复活已撤销会话、密钥、权限和被删除记忆，不自动重放通知/扣款/任务。

**当前API/UI/SDK/runtime/persistence：** 个人Agent/Skill/Workflow已有不可变历史和固定版本引用、UI只读历史与SDK versions/update；AiKnowledgeDocument仅当前正文、FileAsset单对象。没有资源恢复API/SDK/UI动作，历史只读预览明确不会恢复；文档/图表本身未实现。任务结果查回不是资源历史恢复。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:125-125`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:110-110`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/src/plugins/aij-ai/ai-personal-agents.service.ts:167-178`；SHA256 `35164b1bc8b992b1ecf83e16002140ebbcb7b506c43abe399a66266cf48a3858`：个人Agent历史版本分页读取。
- `apps/api/src/plugins/aij-ai/ai-personal-agents.service.ts:181-197`；SHA256 `35164b1bc8b992b1ecf83e16002140ebbcb7b506c43abe399a66266cf48a3858`：当前权限和依赖校验、expectedRevision CAS、追加快照，可供恢复成新版本复用。
- `apps/web/app/components/client-agent-library.tsx:114-115`；SHA256 `a0c7787c63cef15bacbe133459ebe5629e10f081c8229cd4ef755647d281bc5d`：页面历史只读，明确不恢复或覆盖当前配置。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-159/run-zNjJOa/report.json`；SHA256 `25b2f20afd711cd45be19914e60355aa009962152c1b2c29cf6eeeb66a708751`。personal-agent-cookie-concurrency-history-pins 12/12：真实PG不可变历史、CAS、固定Skill、撤权围栏/审计原子性和编译SDK。 限制：版本创建/读取与当前编辑，不是一键历史恢复；不能宣称所有资源可恢复。

**尚需情景/实现阻塞：**

- AC-037 冻结正向：指定资源恢复历史版本并形成新版本，运行仍能引用原冻结版本。
- AC-037 冻结拒绝：不复活已撤销会话、密钥、权限和被删除记忆，不自动重放通知/扣款/任务。
- 文件/知识/Agent/Skill/流程/文档/图表逐类恢复成新版本；原运行冻结引用保持、当前修改冲突、撤权/删除记忆不复活和零副作用重放仍未完整覆盖。

**外部输入（只阻塞真正依赖项）：**

- O08文档/图表范围；恢复默认保留期限按D15；具体资源样例内部合成即可。

**整条关闭计划：**

1. 建议R1先把个人Agent历史经差异预览恢复为待确认草稿，再调用现有CAS update形成新版本；不复活tombstone或直接启用历史授权。
2. 将同一规则分卡推广到Skill/Workflow；文件/知识增加版本owner与新版本引用，文档/图表在其owner实现后接入。
3. 对每种资源核对当前内容/原运行冻结引用、撤权/删除记忆/凭据、通知支付任务0新增；全矩阵AC-037通过后才交负责人。

### REQ-038 · 保留周期 · MISSING

阶段 M8；AC-038；目标验收 NOT_RUN_BY_THIS_AUDIT；负责人 PENDING。

**冻结需求：** 7天恢复点目标间隔≤15分钟、日备份30天、月备份12个月、自动草稿30天、手工版本90天、回收站30天；发布版本有效引用期间保留，下架后至少180天。

**冻结正向：** 按可控时钟验证到期清理、引用固定、有效恢复点显示及删除标记的恢复处理。

**冻结拒绝：** 数据库/附件未共同验证的点不可选；清理不删除有效购买/安装/任务引用版本；财务审计不套草稿期限。

**当前API/UI/SDK/runtime/persistence：** 无7天/15分钟一致恢复点调度与目录、30天日/12个月月备份、30/90天草稿版本、30天回收站、下架180天及引用固定清理owner/API/UI/SDK。现有知识问答/Run 7天正文清理是独立类别；internal.retentionDays配置项无证明这些目标的执行机制。

**源码证据（仅静态）：**

- `docs/planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md:126-126`；SHA256 `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`：冻结需求原文；这是目标规格，不是实现或验收证据。
- `docs/planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md:111-111`；SHA256 `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`：冻结正向与拒绝场景；本次均不执行目标验收。
- `apps/api/src/plugins/aij-ai/ai-knowledge.service.ts:77-89`；SHA256 `8413a4f74f65f40e32cf75a5b2b6cb073eaf4e4bf9050c9ad2e92f1412c85fe6`：知识问答过期清空query/answer/citations，属于问答正文期，不是备份或草稿。
- `apps/api/src/plugins/aij-ai/ai-center-run.service.ts:26-29`；SHA256 `b95651504ce5251196703f0e28b216a4f0ef623939ebd6f7c422195bf29bccd6`：Run正文7天TTL独立于需求的恢复点窗口/草稿保留。

**实际PASS证据及边界：**

- `.artifacts/verification/AF-124/run-Iz7Mfi/report.json`；SHA256 `a50fc73d916d9e58c3eb27d316944c89d36048ae4db7e076e86088876d75ffba`。g19-question-retention-http-db 6/6：历史真实HTTP/PG问答正文清理/过期拒绝回归。 限制：只支持独立问答清理类别，目标7天恢复窗口、15分钟间隔及30/90/180天/12个月完全未获证明。

**尚需情景/实现阻塞：**

- AC-038 冻结正向：按可控时钟验证到期清理、引用固定、有效恢复点显示及删除标记的恢复处理。
- AC-038 冻结拒绝：数据库/附件未共同验证的点不可选；清理不删除有效购买/安装/任务引用版本；财务审计不套草稿期限。
- 全部既定期限的边界/有效引用固定/删除撤权标记/不完整点不可选；财务审计不得套草稿期。

**外部输入（只阻塞真正依赖项）：**

- O06容量/成本/恢复耗时、问答/运行原文期与财务审计保留细节；D15默认期限已明确，无需重问。

**整条关闭计划：**

1. 依REQ-035/036的完整点校验建立备份调度和可用点目录，7天窗口目标≤15分钟只是待容量实测目标，不声明SLA。
2. 按独立类别实现日30天/月12个月、草稿30天/手工90天、回收站30天、下架≥180天；有效安装/购买/任务引用固定，删除撤权标记跨恢复保留。
3. 使用可控时钟逐边界测试，实际缺DB/对象点不可选、引用资源不清理、问答原文/财务审计独立；跑AC-038并记录实际RPO/恢复耗时等待负责人。

## 三张下一步建议（未登记，不是正式Task）

候选写域互不重叠，所有共享装配、权限、Schema/迁移、测试目标与重型门禁由根串行。预算含实现、真实PG/API/SDK/浏览器验收与根记录；如超4h先保留并拆卡，不拿静态PASS兑付。closesRequirements为空表示切片，不能提升整条AC。优先级按直接用户价值及依赖排序；商户/定价输入只阻断真实资金，不使所有内部产品工作停摆。

### R1 · 将个人Agent历史恢复为待确认的新版本

P1；3h=Worker2.25+root0.75。使用既有history/update API及编译SDK，把历史内容变成显式差异预览/草稿，保留当前expectedRevision；确认后新增版本，默认disabled并重新确认当前可用模型/Skill，旧依赖不可用则拒绝。无需新Schema/执行账本/凭据复制，最快交付真实可用恢复切片。

**候选allowPaths：**

- `apps/web/app/components/client-agent-library-state.mjs`
- `apps/web/app/components/client-agent-library-state.d.mts`
- `apps/web/app/components/client-agent-library.tsx`
- `scripts/verification/client-agent-restore.test.mjs`
- `scripts/verification/client-agent-restore-acceptance.test.mjs`
- `docs/execution/proposed-R1-candidate.md`

**根共享接线（候选不得写）：**

- scripts/verification/registry.mjs：分配正式AF号与真实Orca Task后注册R1命令；不得复用旧报告
- scripts/verification/web-build-isolated.mjs：根独占增加该正式卡的隔离构建profile
- scripts/verification/client-auth-fixture.mjs、scripts/verification/auth-support.mjs、scripts/runtime-environment.cjs：仅根注册新隔离测试目标；不改正式运行权限
- docs/planning/CODING_QUEUE.json、docs/planning/auto-ai-program-20261105/program.json：仅根登记正式卡/依赖/执行记录；本审计不写

**真实集成依赖：** task_8225f38866ac, task_5731129d1d35, task_51b45b290b1a, task_f52c621165c7。本地建议依赖：无。

**须注册并实际运行的验收：**

- 拟注册，全部本次NOT_RUN：node --test scripts/verification/client-agent-restore.test.mjs（真实页面状态、丢回复不重发、退出/换空间清空、禁用默认与差异）
- 拟注册：pnpm --filter @aij/sdk build；pnpm --filter @aij/api build；pnpm run typecheck；node --test scripts/verification/package-consumer-matrix.test.mjs
- 拟注册：node --test scripts/verification/client-agent-restore-acceptance.test.mjs；根专属新PG库/真实Cookie/HTTP/编译SDK，v1→v3追加、原v1/v2与已冻结Run引用不变、CAS409/越成员403或404/撤权403/删Skill或停用模型409、Job/Trace/预算/支付/通知0新增
- 根串行注册该正式卡的web-build-isolated命令与pnpm verify:task，再在真实生产Web+PG浏览器完成预览/取消/确认/竞争编辑/权限撤销/窄屏；原生隐藏序列只有实际观察hidden才记PASS

**整条剩余与后续子卡：**

- 只关闭REQ-037个人Agent恢复切片；Skill/流程/文件/知识/文档/图表与组织恢复仍需后续子卡。
- 历史启用/授权不直接复活；缺模型/Skill须当前重新选择并经原API校验。全AC-037及负责人验收PENDING。

### D1 · 交付个人纯文本文档编辑与不可变历史

P1；4h=Worker2.75+root1.25。限个人归属、title+纯文本body（建议UTF-8≤64KiB、每人≤100篇），浏览器创建/列表/读取/编辑并追加不可变版本、CAS冲突保留当前内容与用户草稿；不引入富文本/AI/导出。新owner与既有知识源分开，形成M5第一个真实产品闭环；若估时超限先拆只读历史页，不削减权限/PG验收。

**候选allowPaths：**

- `apps/api/src/documents/personal-document-drafts.module.ts`
- `apps/api/src/documents/personal-document-drafts.controller.ts`
- `apps/api/src/documents/personal-document-drafts.dto.ts`
- `apps/api/src/documents/personal-document-drafts.service.ts`
- `packages/sdk/src/personal-document-drafts.ts`
- `apps/web/app/client/documents/page.tsx`
- `apps/web/app/components/client-document-drafts.tsx`
- `scripts/verification/personal-document-drafts.test.mjs`
- `scripts/verification/personal-document-drafts-acceptance.test.mjs`
- `docs/execution/proposed-D1-candidate.md`

**根共享接线（候选不得写）：**

- apps/api/prisma/schema.prisma、apps/api/prisma/migrations/20261106030000_personal_document_drafts/migration.sql：根独占建立DocumentDraft/DocumentDraftVersion及归属/版本约束；迁移编号正式派工前排冲突
- apps/api/src/app.module.ts、apps/api/src/client-workspaces/client-workspace-permissions.ts、scripts/database/migration.mjs、scripts/database/seed.mjs：根独占装配模块、最小新权限、受保护目标；不借知识源表存创作文档
- packages/sdk/src/index.ts：根独占导出新factory；apps/web/app/components/client-ai-workbench.tsx：根核对现有导航结构后增加真实路由入口
- scripts/verification/registry.mjs、scripts/verification/web-build-isolated.mjs、scripts/verification/client-auth-fixture.mjs、scripts/verification/auth-support.mjs、scripts/runtime-environment.cjs：根串行注册真实AF/新测试DB与构建profile
- docs/planning/CODING_QUEUE.json、docs/planning/auto-ai-program-20261105/program.json：仅根正式登记与执行记录

**真实集成依赖：** task_f52c621165c7。本地建议依赖：无。

**须注册并实际运行的验收：**

- 拟注册，全部本次NOT_RUN：node --test scripts/verification/personal-document-drafts.test.mjs；pnpm --filter @aij/api prisma:validate；pnpm --filter @aij/api prisma:generate；pnpm --filter @aij/api build；pnpm --filter @aij/sdk build；pnpm run typecheck
- 拟注册：node --test scripts/verification/personal-document-drafts-acceptance.test.mjs，在根新受保护PG库真实migration/Cookie/HTTP/编译SDK创建→读取→并发CAS编辑→不可变历史；401/403/404、伪workspace/跨成员、CSRF/超字节/配额/审计回滚拒绝且不写Job/Trace
- 拟注册：node --test scripts/verification/package-consumer-matrix.test.mjs；根按正式AF注册独立Web构建/verify:task并实际浏览器新建、编辑、查看历史、两窗口冲突草稿保留、退出清空与390px操作

**整条剩余与后续子卡：**

- REQ-022仍缺章节局部AI再生成/差异应用、历史恢复及DOCX/PDF导出，不能报完整AC-022。
- 后续子卡：章节再生成和并发差异、DOCX导出、PDF导出及真实阅读器/历史恢复；REQ-023独立图表owner仍缺。

### P1 · 提供插件升级影响预览并验证无关业务持续运行

P2；4h=Worker3+root1。实际管理员页面消费只读影响预览：现/目标可信版本、依赖/被依赖、阻断项、需停用范围和可证明恢复范围。真实fixture编译两个受信插件版本，A停用/版本事务/失败恢复时B独立HTTP写读与Job心跳连续成功；不把static descriptor当插件运行，也不新建任意包加载器。

**候选allowPaths：**

- `apps/api/src/plugin-runtime/plugin-upgrade-preview.service.ts`
- `apps/api/src/plugin-runtime/plugin-upgrade-preview.controller.ts`
- `apps/api/src/plugin-runtime/plugin-upgrade-preview.dto.ts`
- `apps/web/app/auth/plugins/page.tsx`
- `apps/web/app/components/admin-plugin-upgrade-preview.tsx`
- `scripts/verification/plugin-upgrade-preview.test.mjs`
- `scripts/verification/plugin-upgrade-preview-acceptance.test.mjs`
- `docs/execution/proposed-P1-candidate.md`

**根共享接线（候选不得写）：**

- apps/api/src/plugin-runtime/plugin-management.module.ts：根独占注册预览controller/service，使用现有PluginCatalog及管理权限，只读预览不执行升级
- scripts/verification/registry.mjs、scripts/verification/web-build-isolated.mjs、scripts/verification/auth-support.mjs、scripts/runtime-environment.cjs：根独占正式Task/新保护DB/构建profile与门禁
- scripts/database/seed.mjs、apps/api/src/menus/menu-availability.service.ts：根核对真实管理菜单注册，仅按既有plugin权限接导航
- docs/planning/CODING_QUEUE.json、docs/planning/auto-ai-program-20261105/program.json：根独占记录；不改变可信catalog/全局依赖/Schema

**真实集成依赖：** task_f52c621165c7。本地建议依赖：无。

**须注册并实际运行的验收：**

- 拟注册，全部本次NOT_RUN：node --test scripts/verification/plugin-upgrade-preview.test.mjs；pnpm --filter @aij/api build；pnpm run typecheck
- 拟注册：node --test scripts/verification/plugin-upgrade-preview-acceptance.test.mjs，在新保护PG/编译宿主/真实HTTP运行；预览全表hash不变，401/403/未知包404/目标不兼容409，A停用API拒绝且B业务写读和在途Job持续成功、失败事务注入不污染B、A数据/授权可核对
- 回归命令待根新注册目标复用原实现：node --test scripts/verification/plugin-upgrade-recovery.test.mjs scripts/verification/plugin-management.test.mjs；不直接挪用旧Task或保护库
- 根为正式AF登记独立Web构建与verify:task，真实浏览器核对影响列表/阻断原因和停用A后导航/API拒绝；测试只证明受信fixture运行，不宣称实际第三方制品升级

**整条剩余与后续子卡：**

- 关闭REQ-025影响预览及B连续业务证据切片；实际包升级/迁移执行和恢复范围依REQ-024可信制品工作。
- REQ-024完整第三方开发/模板/审核、REQ-025最终AC和REQ-034统一UI/CLI运维仍未关闭。

## 证据核验与限制

- READ_ONLY_TARGET_AUDIT / 候选非CODE_VERIFIED；17条targetAcceptance均NOT_RUN_BY_THIS_AUDIT，owner acceptance PENDING；不能从源码、历史PASS、自查或候选提交推导AC PASS。
- 工作区固定origin/dev@94b0236f775fa40a07944c5e0545ac6ce0e123f3；仅git ls-tree/git show读取sourceHead@48e8d26ea1dcd67df65d316a0edfdec4bcb2d502，未checkout/restore/fetch任何产品文件。
- 正式冻结AIJ-REQ-20261105-R1：baseline/traceability的历史b8eb来源、PROPOSED_NOT_AUTHORIZED字样原样保留；当前派工和program.json连续实施授权优先，未反写历史或ownerAcceptanceRecords。
- 唯一root读例外：audit-inputs.json SHA256=852aa122dcb5eebb527081ccfc5182c41d658c5444f39b025273ce4163baa49b与其188个approvedReports精确report.json；188/188摘要匹配，所引用报告逐步exit0/失败0和mode=verify检查。报告没有运行制品SHA字段；不能证明sourceHead当前整套回归，只引用其明确的历史测试范围。
- 负向发现基于sourceHead 772个允许路径列表及其中安全文本.ts/.tsx/.mjs/.cjs/.prisma/.json（排除fixtures目录）的模型/路由/关键词扫描，再核对指定owner；无命中只是范围内静态缺口，不是运行拒绝证明；缺功能不伪造对应源码。
- 未读root工作源码、原始日志/fixtures/凭据、qingqi、真实.env*/key/cert/upload/runtime/node_modules；未用网络/厂商/付费服务、DB/Docker/服务器/浏览器，未install/build/app tests、未改产品/Schema/队列/registry/current state/依赖。
- W12窄例外保留：AF-181版本化执行记录载critical/high/moderate/low/info/total均0及Prisma6配置限定例外；本审计只核准批准AF-181 report命令与PASS范围，原始生产审计子报告不在approvedReports，未越权读取，完整安全/发布/负责人验收仍PENDING。
- W12网页导入和来源页及焦点修正有版本化记录；AF-182批准报告证明自动/PG/TLS/SDK范围，原生OS picker和真实hidden/回前台focus序列保留NOT_PROVEN，未读取未获准browser proof。
- W12阿里云embedding/rerank仅编译与自有合成wire协议证据，configured=false，无host/secret/admission/ledger/catalog/semanticRAG付费厂商接线；不计作语义检索或计费完成。
- 严格分离个人/组织/ProjectProfile、产品统一密钥/BYOK、内部预算/上游成本/对客售价、支付轨道/商品订单、知识源/语义检索、prompt Skill/脚本Skill；本卡未验证组织商业资产或脚本运行能力。
- 未发现本范围源码审计中已证实的critical跨租户/数据丢失漏洞；组织恢复、资金与制品缺口是未实现/未证明，不可据此推定安全。真实critical若被发现须立即升级总控；未做独立安全Review。
- 三张建议仅本地proposal key，不是已派工AF或Task；预算均含root，总11h，候选allowPaths互不重叠，rootWiring由根串行。dependsOnIntegrationTasks仅引用sourceHead program.json真实集成Task；任何新建议正式编号/门禁/测试目标须根先登记。
- 建议切片closesRequirements均为空：不伪称整条目标关闭；每条closurePlan保留整体验收与外部输入，相关remainingAfterCard说明后续子卡。未选入前三张不代表取消财务/市场/灾备目标。

## 本次验证、影响与交接

本次只执行Git/JSON/哈希/行号/模式静态核验和git diff --check；无产品测试。候选Schema精确字段/枚举、17 ID唯一与顺序、source blob完整SHA与短行、approvedReports集合/hash/schema/步骤范围、冻结原文、建议≤3/≤4h与真实依赖、三路径隔离由自有静态校验脚本复核。总控应复核固定源点与批准报告，注册并运行正式AF-187 verify:task，再精确集成/记录/原标题提交与readback，之后才能完成I任务。

DB、API、页面、权限、日志定义无改动；仅审计文档新增，无服务或访问地址启动。产品build/lint/typecheck/PG/浏览器/container/vendor/目标AC全部NOT_RUN_BY_THIS_AUDIT，不能把未运行记为失败或PASS。已知历史失败和W12限制保留。

人工复核：对照17条冻结规格逐行核查；用git show固定源点重算sourceEvidence；只读批准报告核对所引step/计数；检查三建议的根写域和预算，分派正式卡后在隔离目标真实执行相应成功/拒绝/恢复矩阵。下一步依赖均为sourceHead内真实集成Task或本地proposal，未建立任何新Orca Task。

Worker有效工程约0.3h；本卡上限3h（含root），给root约2.7h余量，其中Worker上限1.5h未耗尽。交付后STOP ALL WRITING，不push、不续跑、不改队列；由总控保留最终接收与负责人PENDING状态。
