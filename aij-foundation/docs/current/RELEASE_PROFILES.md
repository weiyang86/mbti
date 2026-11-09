## 2026-11-05 新需求下的装配目标

[正式需求基线](../planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md)将未来新项目默认值定为完整AI标准版，创建时还可选择基础后台或自定义组合。标准版应提供基础管理、用户、附件、模型、Agent、Skill、知识、编排和插件入口；待配置仅表示实现已交付而配置缺失，未实现不能伪装待配置。

实际b8eb9c2仍由project/editions默认base、仅两种固定组合，create只生成四个配置文件，普通seed受host限制。上述新默认、自定义组合及完整AI产品均待实现与实测；本轮没有改运行配置或放开插件白名单。私有pack/合成升级恢复应复用，公开SDK/第三方市场的许可与发布仍须单独核定。

完整源码边界及最终发行矩阵见 [源码差距](../planning/ai-platform-baseline-20261105/SOURCE_GAP_ANALYSIS.md) 和 [阶段验收](../planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md)。以下旧表按原阶段保留；各历史卡CODE_VERIFIED与负责人接收状态不改。

---

# 正式底座发行配置与验收边界

2026-10-31 G13-01 至 G13-04A 进展：AF-073 本地项目模板 CLI、AF-074 两合成项目的真实数据库/文件/API 隔离、AF-075 前一版 Schema 升级与失败事务回滚均 `CODE_VERIFIED`；AF-075 已提交并推送。AF-077 已代码验证本地 private `@aij/base` pack/tarball 安装、导入和类型入口，按标题提交并快进推送至 `c5ae1cebfff08814fb605c679b3550552d3f9597`。完整 host build/start/readiness 由下一个已授权、依赖满足的 AF-078 执行；升级及数据库/文件恢复仍待 AF-079 和 AF-076 原端到端验收。AF-076 尚未完成。许可、公开分发渠道、支持平台仍待负责人决定；负责人统一验收待执行。详见 [AF-076](../execution/AF-076.md)、[AF-077](../execution/AF-077.md) 和队列。

2026-10-27 UI-1本批交付：负责人明确批准UI1-01–04，本地映射AF-026–029；四卡代码与自动门禁通过，**Trea待复核、人工待验**。AF-025-A保留待验，UI-2及AF-025-B未授权、未接续。管理员持久会话/失效、Cookie/CSRF和真实Web登录/退出已接入；当前入口与合成凭据获取见[浏览器指南](../development/ADMIN_BROWSER_AUTHENTICATION.md)，实际基线/差异/逐命令/服务见[AF-029](../execution/AF-029.md)。每30分钟续跑首卡后启用，批次结束已暂停。下文旧范围、无监听、未实现及PID均按日期保留历史。 此次不是aij-base正式完成；新项目安装、插件生命周期、升级恢复和许可/发布门禁不变。

2026-10-20当前增量：AF-025-A客户登录与数据库会话认证已实现，独立Cookie/issuer/audience、226+2与适用门禁exit0，Trea待复核、人工待验；AF-025父任务未完成、B未指派。未实现客户完整生命周期/同意/注册找回，不扩大发行/部署/安装/升级/许可承诺。见[AF-025-A](../execution/AF-025-A.md)，下方增量保留历史。

2026-10-20当前增量：AF-023已接收；AF-024 core审计分页/详情/筛选、强制授权与安全投影已实现，246+2及门禁exit0，Trea待复核、人工待验，见[AF-024](../execution/AF-024.md)。未实现日志Web/导出/保留清理或客户租户查询，不改变正式底座安装/隔离/生命周期/升级恢复及许可/平台/发布渠道门禁。以下增量保留历史。

2026-10-19当前增量：AF-022已接收；AF-023已有唯一SecretRef/env/加密本地SecretStore与受控引用登记/轮换/清除，227+2及门禁exit0；Trea待复核、人工待验，见[AF-023](../execution/AF-023.md)。本地协议fixture不是外部服务live，生产密钥托管/插件生命周期/配置Web/正式发行仍未实现。

日期：2026-10-19。本文由AF-001建立，AF-022更新分层配置/公开上下文与启停边界；三个配置仍无发行器/安装模板/实包/发布产物。负责人已按角色权限范围接收AF-016，Trea报告该交付物门禁PASS，范围冲突已裁定、人工待验；管理员会话撤销/浏览器凭据保护另行编号且未实现；原正式门禁保留。

## 1. 三种发行配置

| 字段 | aij-base | aij-ai-standard | 按需插件 |
| --- | --- | --- | --- |
| 定位 | 可被新项目独立安装和升级的通用底座 | aij-base 加通用 AI 执行与管理的标准组合 | 在已验收底座上显式选择的单个插件或组合 |
| 必备范围 | 工程装配、管理员与会员基础身份、RBAC/菜单/字典、项目配置/密钥引用、文件/审计、通用 Workspace、异步运行时、插件契约与生命周期、实际 SDK/Contracts/Core/Runtime/Shared UI、安装与升级恢复 | 全部 aij-base 门禁，加 aij-ai 的 Model/Provider/Route、Trace/Price/Cost 与最小管理面；按当前 F18A→F17A 依赖纳入 aij-notification | aij-notification、aij-payment、aij-integration；AI 高级路由、评测、Agent/Skill、Workflow/MCP/Tool 按独立能力另行验收 |
| 目标默认启用集合 | `[]`；系统插件均不自动启动 | 显式集合 `aij-ai`、`aij-notification`；通知仅提供声明的运行依赖，外部投递默认关闭；不启用 payment/integration | 只启用安装者明确选择且依赖已满足的插件；未选择项不启动 |
| 依赖规则 | 核心提供集成注册端口；API Key/Webhook/Transfer 的实际实现归 aij-integration，不在 core 再复制 | 通知依赖依据现有路线，不代表已核验真实 manifest；实现时须核定依赖、版本及启用要求，变更集合需同步本文并重验 | 每项明确 manifest、兼容版本、权限、配置、数据 owner 和恢复策略；缺依赖/未知项失败闭合，禁止静默加全套插件 |
| 当前可运行组合 | 工程骨架、可选数据库Prisma/readiness、空插件；尚不是 aij-base 成品 | 未实现，不能把非空插件配置传给当前骨架并宣称可运行 | 均未迁入；当前非空插件配置会被拒绝 |

通用文件存储归 base；Key/Webhook/Transfer 归 integration 插件，底层端口与插件实现只有一个 owner。项目归属 OrganizationProfile/ProjectProfile 与客户 Workspace/Membership 分开。aij-ai 的执行/成本、notification 的投递、payment 的轨道各保留唯一真值；业务订单、权益、企业档案、IP、顾问、行动、FDE、知识、情报、CMS/建站、Company Ops/Finance 等留在轻企。

AF-017仅补统一admin默认拒绝和本人权限一致快照，复用既有无缓存解析，276项+2宿主及门禁通过；Trea待复核、人工待验。当前人工入口以RBAC指南为准；不改变发行配置/插件默认集合或会话安全未实现状态。

AF-018当前：管理员分页/创建/修改/停用/受控重置与最后超级/自我保护复用已验收唯一实现，284项+2宿主及门禁通过；Trea待复核、人工待验。当前人工入口以管理员指南为准；不扩大插件默认集合、Schema或正式发行范围。

AF-019历史：角色分页/编辑/权限分配和状态复用唯一服务，新增停用权限变更拒绝和同事务前后ID审计，294项+2宿主与门禁通过；Trea待复核、人工待验。该阶段人工入口见角色权限指南，当前以AF-020菜单指南为准，不改变发行范围/默认插件集合。

## 2. 能力状态与 owner

“已有”仅指本库实际实现，不等于正式发行门禁通过；“未迁入”不因源库有文件或 descriptor 而改变。base/AI 两列表示目标纳入范围，按需项不计入 base 的默认启动集合。

| 能力 | aij-base | aij-ai-standard | 当前状态与证据 | 唯一目标 owner / 原路线 |
| --- | --- | --- | --- | --- |
| 独立 workspace、API/Web 组合根、端口/环境隔离 | 必备 | 继承 | F01 已有且负责人已接收；根及两个应用 package.json、AppModule、runtime-environment/run-app | 宿主工程装配；M01/F01 |
| process health、成功响应、关联 ID | 必备 | 继承 | HealthController/interceptor保留；AF-011新增ReadyController，DB故障health仍200、ready503/恢复200；不代表全错误统一处理或业务审计 | core HTTP / 宿主入口；M03/M04 |
| 独立 DB/Schema/migration/幂等 Seed 与连接保护 | 必备 | 继承 | AF-004/005保护/实例，AF-006至AF-009部分21模型/4枚举，AF-010 initial，AF-011 Prisma/readiness；AF-012最小Seed/安全初始凭据及真实幂等/不覆盖通过。原dev/test未deploy/seed，完整Seed/其余Schema/最小权限应用角色/生产部署未完成 | AIJ database/seed及各模型owner；F02/F03 |
| 管理员认证、RBAC/权限菜单、字典与管理面 | 必备 | 继承 | AF-006核心Schema、AF-012新验收库合成管理员/角色/单个bootstrap data权限及关联；AF-013真实登录/me及JWT Guard/登录审计已通过，身份从当前DB复核；AF-014已接入当前DB权限Guard及只读自查/目录；AF-015七个管理员CRUD入口受显式管理权限保护，角色绑定/超级账号修改受DB超级标志限制；AF-016已有角色/自定义权限CRUD与DB超级限定权限替换；AF-020已有菜单API与权限/真实页面过滤，AF-021已有字典分类/条目API与公开过滤，仍无按钮UI授权装配、管理页面、客户租户/行级授权或刷新/注销撤销，不把部分Guard当完整后台 | AIJ core/seed；F03/F04/F08/F09/F16C |
| 会员基础身份与会话安全 | 必备 | 继承 | AF-007五模型保留；AF-025-A已实现登录、会话签发/校验、独立Cookie/JWT及数据库限流；客户注册/找回/改密/logout/实际撤销/单次消费/同意、账号导出/注销及正式邮件未实现，AF-025-B未指派 | AIJ identity；M09/F07 |
| 项目组织、scoped config、SecretRef | 必备 | 继承 | AF-008 Schema/版本审计链接，AF-012仅合成组织/项目归属；AF-022已有三scope优先级/乐观版本事务/引用元数据校验与公开敏感过滤；AF-023补服务端env/加密本地adapter与受控引用/轮换/清除；无客户租户权限/外部live接入 | AIJ configuration/secret-center；F05/F06/F16D |
| 通用 Workspace/Membership/Role/Invitation | 必备 | 继承 | 未迁入；不依赖 CompanyProfile/IP，不新增业务 FDE 角色 | 通用 organization；F13–F15 |
| 文件、审计、统一错误处理 | 必备 | 继承 | AF-008已有AuditLog定义及变更关联，AF-009已有FileAsset元数据；AF-013登录/AF-014权限拒绝/AF-015管理员/AF-016角色权限成功变更的最小审计及限定错误去敏已实现；AF-024新增core审计分页/详情/筛选与脱敏投影；实际文件存储/上传、审计Web/导出/保留清理与全错误统一处理仍未实现 | core 文件/审计；F04/F12A/F16D |
| Outbox/Job/worker/scheduler/idempotency | 必备 | 继承 | 未迁入；无队列/任务持久化证据 | foundation-runtime；F11/F16B |
| 空装配拒绝未知 code | 必备 | 继承 | F01 已有空 REGISTERED_MODULES；仅有拒绝和空组合能力 | 插件组合根；M11/F01 |
| 安装/启停/依赖/升级/恢复/卸载生命周期 | 必备 | 继承 | AF-009仅有PluginInstallation/PluginOperation定义、状态/版本/owner/失败原因；安装启停/依赖/升级恢复/卸载服务未实现，空白名单不是生命周期闭环 | SDK/Contracts 与唯一插件生命周期实现；M11/M21，需后续拆项 |
| SDK/Contracts/Core/Runtime/Shared UI 实包及宿主公开导出消费 | 必备 | 继承 | 未迁入；本库无 packages 实现，三个 manifest 均 private | 各包单一 owner；F16A–F16E |
| aij-ai 最小执行、成本与管理 | 不含 | 必备 | 未迁入；无 Provider/Trace/Cost/AI 页面或 Module | aij-ai；F18A/F18B |
| aij-notification | 按需 | 当前依赖组合纳入 | 未迁入；不宣称真实短信/邮件接入 | aij-notification；F17A |
| aij-payment | 按需 | 按需 | 未迁入；不含轻企业务订单/权益 | aij-payment；F17B/F17C |
| API Key/Webhook/Transfer | 按需 | 按需 | 未迁入；只由 integration 实包提供实际能力 | aij-integration；F12B/F12C/F19 |
| AI 高级路由/评测/Agent/Skill/Workflow/MCP/Tool | 不含 | 按需扩展 | 未迁入；不把“AI 标准版”写成全量高级功能承诺 | aij-ai 通用子能力；F18C–F18F |
| 新项目安装、版本兼容、升级恢复交付 | 必备 | 继承且验证插件组合 | AF-073 已有本地项目配置生成器；仍未实现独立包安装/升级恢复，历史 pnpm 安装不等于下游新项目安装 | 分发/新项目装配与各迁移 owner；M23/F20，需补独立任务 |

HealthController负责 `/api/health`，ReadyController负责 `/api/ready`，唯一PrismaService执行真实数据库探针和关闭；AppModule消费PrismaModule导出。公共无入参探针没有DTO/Guard，不提供管理权限。后续入口归Controller、能力归Service、校验归DTO、认证授权归Guard；模型按[ARCHITECTURE](ARCHITECTURE.md)和[owner清单](../governance/F00_MIGRATION_INVENTORY.md)定向迁入，不能因混合文件位置而整体归core。包内已有实现时只补公开导出/宿主消费，禁止镜像复制。

## 3. aij-base 正式完成门禁（均待实现与验收）

以下为将来必须留下实际运行证据的成功与失败路径，本轮没有执行或打勾。

| 门禁 | 成功路径必须证明 | 失败路径必须证明 | 必需证据 |
| --- | --- | --- | --- |
| B1 新项目安装 | 在仓库外新目录，用自身配置/锁文件安装真实包；空验收库迁移、两次 Seed、API/Web 与授权管理操作实际可用 | 缺必需配置、包版本不兼容、非法目录/数据库目标拒绝；错误可定位，无假成功 starter | 安装命令/退出码、包导出与宿主消费、PID/CWD、真实 HTTP/浏览器、迁移/Seed 结果；不依赖本仓库或原库源码/node_modules/dist/上传目录 |
| B2 数据与身份隔离 | 新项目自身实例/库/账号/卷、存储、Cookie/issuer/secret；合成数据读写；新库 dev/test 为55432/55433 | 测试误连 dev/原库、跨产品 Token、跨身份/跨租户、伪造 workspaceId、越权/路径穿越均拒绝；不泄露凭据 | 脱敏目标校验、真实 DB/文件/HTTP、会话及成员关系断言、原库保护；生成项目使用自己的端口和隔离配置 |
| B3 核心管理与安全 | 管理员与普通角色完成授权操作，菜单/按钮/API 一致；配置/文件/审计、基础会员与通用组织闭环 | 坏密码/Token、停用身份、缺权限、无效 DTO、敏感信息读取/日志泄露被拒 | 真实 API/页面、持久化与关联 ID/错误/审计；会员通知离线状态如实展示 |
| B4 插件生命周期 | base 空集合独立启动；用明确标识的合成契约插件及后续实际选定插件验证注册/安装/启用/禁用/升级/恢复/卸载，权限/菜单/API/handler 随状态一致 | 未知/未装/缺依赖/版本不兼容拒绝；禁用后路由和后台任务不可继续使用，失败不残留半启用状态；卸载保留或受控处理数据 | 真实宿主与持久化状态、权限/任务断言、生命周期审计；合成插件只能证明契约，不能证明真实 AI/通知/支付接入 |
| B5 异步与集成端口 | 真实 Outbox/Job、锁/重试/幂等与合成 handler；文件和插件注册端口由实包唯一实现提供 | 重复任务/未知 handler/失败重试正确；可选插件缺失不拖入业务依赖 | 新测试库/文件/队列实际运行记录，按需集成协议另验 |
| B6 升级与恢复 | 从已验版本装到新版本，验证 Schema/配置/包兼容；事前合成备份，失败后按审定恢复或回退方案在隔离验收库恢复并重验 | 包/插件版本不兼容、迁移中断或升级失败被识别；禁止盲目反向执行不可逆 migration，不能以 reset/drop 清库兜底 | 前后版本与数据校验、实际恢复命令/退出码、服务/权限/任务重验；方案未实测不得标可恢复 |
| B7 交付与复核 | 来源与许可证记录、真实 scripts 目标检查、能力表、人工步骤、支持矩阵和升级说明齐全 | descriptor/mock/打印成功、旧产品运行结果、process health 均不能代替实包/DB/生命周期验收 | Trea Review、负责人验收及适用门禁由各责任人完成；提交/发布节点另由负责人操作 |

aij-ai-standard 还须在上述门禁上实际通过合成 Provider→执行→Trace→价格/Cost 的唯一账本、无价格/Secret/预算失败闭合、权限管理面及 AI/通知组合启停；按需插件各自验证声明依赖、协议、权限/菜单/API/handler、幂等/重试、迁移与升级恢复。通知、支付、Provider 的离线 fixture 仅证明协议；不当作真实外部接入。本轮不发真实短信、不付款退款、不调用真实付费模型；对应人工步骤留给负责人亲自触发。

## 4. 许可、发布渠道与支持平台

| 决策字段 | 当前记录 | 确认责任与发行前要求 |
| --- | --- | --- |
| 产品许可与分发权 | 待定；源九个包为 All rights reserved，源 apps/根声明缺项，不能推定 MIT/公开分发授权 | 负责人核定许可/授权与保留声明；依据 [SOURCE_PROVENANCE](../governance/SOURCE_PROVENANCE.md) 第6节AF-006模型来源，本地抽取不扩大为公开分发授权 |
| registry scope、包名/版本、发布渠道与访问控制 | 待定；现有 root/@aij/api/@aij/web 都 private、version 0.1.0，仅本地工程值 | 负责人决定私有/公开 registry 或其他交付渠道、权限与版本策略；未 pack/publish/tag/部署 |
| 运行支持平台 | 待定；F01 历史仅在本机 macOS/ExFAT + Node24.21.0/pnpm10.0.0 验证所用能力 | Linux、Windows、CPU 架构、容器/部署支持矩阵及 Node/pnpm/PostgreSQL 版本须另核验；Windows 进程停止仅直接 child，未验收 |
| 浏览器支持与长期运行 | 待定；F01 历史 HTTP/保存重载证据存在，浏览器工具当时受策略限制，外置盘历史故障根因未确认 | 负责人确定浏览器/设备范围和观察时长；不能用 F01 接收推定跨平台或全天稳定 |

待定决策与未迁能力阻止宣称“正式底座已完成/可发行”，不阻止单项任务交付。AF-001历史边界见其执行记录；当前执行事实、保护状态与人工复核入口见[CURRENT_STATE](CURRENT_STATE.md)第21节和[AF-014执行记录](../execution/AF-014.md)。本文不授权接续新任务，后续由负责人逐项指派。
