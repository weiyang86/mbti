# F00 迁出清单

日期：2026-10-12。源：`qingqi-ai-consultant` 的 `dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`。所有源路径相对此只读仓库；所有目标路径相对 `aij-foundation`。**以下均为迁出决策，尚未执行应用代码复制。** 迁出不删除或重构原库。

## 1. 清单读法与覆盖

- 本表按能力拆项；同一混合源文件可只有部分方法/声明迁入。不能依据目录名作 owner 判断。
- [逐文件 CSV](../generated/SOURCE_FILE_INVENTORY.csv) 对本表 M01–M25 展开 834 个实际受跟踪工程文件：源文件、能力、字面量直接依赖（相对路径已解析）、实际 Prisma 访问、数据 owner、目标、方式、验收、源 HEAD、SHA-256。
- [模型 CSV](../generated/PRISMA_MODEL_OWNERSHIP.csv) 覆盖全部 224 个 model；96 个候选，128 个留原库/待核对。候选不是承诺照搬：每个 relation、enum、JSON 业务语义、索引和约束仍要审定。数据库运行记录一律不迁。
- 来源总计 1,014 个受跟踪文件；834 份是定向工程目录与工具/测试/声明，不包含原历史文档全量。89 份 migration.sql 全部记录为只读参考；migration_lock 另计。
- “实际依赖”来自源文件 import、package manifest、Prisma 成员访问和模型关系，不能代替运行时 DI、handler 注册或数据库测试。source CSV 无缺失字面量相对 import 结果，只说明这些源路径存在。
- 没有本次证据的能力不能视为已实现；特别是正式客户安全邮件投递、账号导出/注销闭环、独立实包与 starter 启动。

## 2. 后端与通用能力

| ID / 能力归属 | 源文件 | 实际依赖 / 数据 owner | 目标路径 | 迁出方式 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| M01 工程与组合根 | 根 `package.json`、pnpm workspace/lock、eslint；`apps/api/{package.json,tsconfig.json,nest-cli.json}`、`src/{app.module.ts,main.ts}`；Web package/config；docker-compose | pnpm workspace、Nest Config/Prisma/Auth/Admin/Runtime/Integration/ClientAuth、PluginRuntime；源装配包含轻企 Module，默认 3555/3556；Compose 默认 PG 15435 | 根工程文件；`apps/api/src/{app.module.ts,main.ts}`；`apps/web/next.config.mjs`；新 Compose | 按选定代码重写 manifest/scripts/锁；重建白名单、env 路径与端口；不迁旧 production compose/容器名 | 在新目录安装/编译/health；ENABLED_PLUGINS 为空时无业务 import；新 env 校验通过；无发布脚本自动触发 |
| M02 核心管理 + 系统插件管理；Company Ops 保留 | `apps/api/src/admin/{admin.module.ts,admin.controller.ts,admin.service.ts,dto.ts}` | 注入 ModelService、AiBinding、AiNodeHealth、Secret、Storage、Audit、Prisma；直接使用 Sys*/Member/File/Plugin/Ai*/CompanyOps* | `apps/api/src/admin/`（只通用）；AI 管理分拆到 `apps/api/src/ai/admin/` | 按方法/路由/DTO 拆分；Company Ops 全留原库，原文件不变；通用 core 不要求 AI 已启用 | 用户/角色/菜单/字典/配置/会员/附件/日志按阶段可用；普通角色 API 与按钮越权被拒；修改有审计；无 CompanyOps 表调用 |
| M03 管理认证、权限、日志 | `apps/api/src/auth/**`、`common/{guards,decorators,interceptors}/**`、`audit-log/**` | SysUser→UserRole→Role→Permission/Menu；JWT/bcrypt；PluginEnabledGuard 查询插件状态；Correlation/Transform 与 Audit | 同名新库目录 | 复制机制，改 issuer/凭据/产品标识，剥离业务权限常量；按模块保留 DTO/Guard/Interceptor | admin/client Token 不互通；跨产品 Token 拒绝；普通角色授权与日志去敏；响应与关联 ID 保持一致 |
| M04 ORM/健康 | `apps/api/src/prisma/{prisma.module.ts,prisma.service.ts}`、`health.controller.ts` | PrismaClient；源 health 只报 process/runtime 快照，不能证明数据库可用 | 同名新库路径；必要时另加 readiness | 适配独立连接、服务标识；不把源 health 的 ok 当 DB 验收 | health 标识为新应用；连接白名单有效；独立库读取另有真实证据 |
| M05 项目配置 | `apps/api/src/configuration/**` | OrganizationProfile/ProjectProfile、ScopedConfig、ConfigurationChange、SysConfig；Auth/Audit；SecretRef 校验 | `apps/api/src/configuration/**` | 复制后抽取，保留 scoped resolution；AIJ 合成默认项目，去轻企品牌与环境绑定 | 项目/组织归属正确；scope 解析与权限、公开字段过滤、修改审计通过 |
| M06 密钥中心 | `apps/api/src/secret-center/**` | SecretReference、ConfigurationChange；env reference adapter、Auth/Audit、redaction | `apps/api/src/secret-center/**` | 复制引用机制与脱敏规则；不复制 .env 或任何 secret value | 只登记引用；未配置失败闭合；读写权限、错误/审计脱敏通过 |
| M07 异步运行时 | `apps/api/src/async-runtime/**` | RuntimeOutbox/Job/SchedulerLock/Idempotency；Registry、EventBus、worker、维护 schedule、Auth/Audit/Redaction | 先 `apps/api/src/async-runtime/**`；实包阶段唯一实现进入 `packages/foundation-runtime/src/` | 复制通用机制；业务 handler 由 contract 注册，不迁原队列；宿主后续只薄装配 | 真实 DB 事务 Outbox→handler、retry、重复任务幂等、锁、健康通过；未知 handler 拒绝 |
| M08 文件/集成 | `apps/api/src/integration-center/**`；M02 文件入口 | FileAsset、IntegrationTransfer*、ApiKey/RateBucket、Webhook*、Project、Secret、SysUser；AsyncRuntime/StorageAdapter、DNS/网络安全 | `apps/api/src/integration-center/**`；新库 `.local-data/storage` | 复制通用服务，调整存储根与项目身份；旧业务 transfer/template 按 owner 审核 | 合成文件上传/权限下载/删除；Key scope/限流、Webhook 验签/重试/SSRF、transfer 错误通过；不接外部真实服务 |

## 3. 通用身份与组织

| ID / 能力归属 | 源文件 | 实际依赖 / 数据 owner | 目标路径 | 迁出方式 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| M09 通用客户身份 | `apps/api/src/client-auth/**`，Schema 中 MemberUser/ClientAuthSession/OneTimeToken/Consent/RateBucket | Config/Jwt/bcrypt/crypto、Prisma、Audit、ChallengeAdapter；NotificationAdapter 仅 disabled/test，无 qingqi Module import；当前 canonical owner qingqi-app/Client Auth | `apps/api/src/client-auth/**`，独立身份模型 | 复制认证机制，独立 issuer/key/cookie/link；去原产品文案/同意版本配置；不复制客户或会话 | 合成用户注册/登录/me、会话撤销、换密、找回/验证 token 单次消费、限流与同意记录通过；跨产品 Token 拒绝；未配置邮件如实显示 |
| M10 通用 Workspace；企业档案/IP 留轻企 | `plugins/qingqi-app/contracts.ts` 的组织类型/模板；`src/plugins/qingqi-app/qingqi-workspace*.ts`、`qingqi-app-context.{service,guard}.ts`、`qingqi-app.module.ts` | Member、Workspace、Membership、Role/Permission/Invitation/History；context 依赖 Suite 插件开关/导航/CompanyProfile；create 实际嵌套创建 CompanyProfile；session 使用 CLIENT_JWT_SERVICE 与旧 cookie | `apps/api/src/identity-organization/{workspace*,organization-context*,identity-organization.module.ts}`；`packages/foundation-contracts/src/organization.ts` | 抽取/重写；去 Suite 开关、产品导航、CompanyProfile 创建与 include、IP service 注入；按模型 CSV 重命名；业务上下文原样留原库 | 无 CompanyProfile/IP 表也能创建/选择组织；邀请/角色/停用权限生效；上下文重验 membership/version；跨租户/过期 cookie 拒绝；平台角色不混入客户角色 |

OrganizationProfile 是运营项目组织，不等于 Workspace。新库客户与组织记录由新产品持有；原轻企客户记录与八类企业上下文继续归原库。本次不把两个独立库变成中央共享身份服务。

## 4. 插件与前端

| ID / 能力归属 | 源文件 | 实际依赖 / 数据 owner | 目标路径 | 迁出方式 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| M11 插件装配 | `apps/api/src/plugin-runtime/{plugin-runtime.module.ts,plugin-registry.ts}`，`plugins/aij-*/plugin.manifest.ts` | @qingqi/plugin-sdk、编译 Module/Manifest allowlist、LifecycleRegistry；源白名单静态包含业务 Module | 同名新库运行时；仅允许已迁入系统插件 manifest | 重写 allowlist/组合注册；插件未知或未迁入不得装配；不把原业务 import 留在“禁用”分支 | 空组合能启动；未知 code 拒绝；禁用插件菜单/权限/API/handler 不可用；生命周期审计通过 |
| M12 AI 系统插件 | `apps/api/src/ai/**`、`plugins/aij-ai/{plugin.manifest.ts,media-capability-contract.ts}`；M02 中 AI 管理方法 | Secret、Prisma、Cost、Trace、Capability/Policy/Node/Binding/Evaluation、Notification；AiService→AdminService→Company Ops 工具；39 个 Ai 模型 | `apps/api/src/ai/**`、`plugins/aij-ai/**`；实际包任务再抽取唯一实现 | 拆通用 Model/执行/成本与业务工具；业务 Agent/Skill/Prompt/Capability 默认资产不迁；注册端口替代 Company Ops 调用 | Model→Trace→Cost/价格真值一致；候选/预算/隐私 fail closed；仅合成 adapter 测试；无真实 Provider Key；高级功能逐任务验证 |
| M13 通知 | `apps/api/src/plugins/aij-notification/**`、`plugins/aij-notification/plugin.manifest.ts` | AsyncRuntime/Outbox/Job/Registry、Auth/ClientAuth/Audit、redaction、Notification 六模型 | 同名新库系统插件目录 | 复制投递能力与适配器；不迁业务 template/recipient/message；安全邮件 adapter 另验收 | intent→message→recipient→attempt/inbox、去重/重试/读取权限；disabled/test 状态如实标记；不发送真实消息 |
| M14 支付 | `apps/api/src/plugins/aij-payment/**`、`plugins/aij-payment/plugin.manifest.ts` | AsyncRuntime、SecretCenter、Auth/Audit、Payment 七模型、rawBody 验签 | 同名新库系统插件目录 | 复制 rail；business order 只引用/contract，不搬轻企商业表、商户或回调绑定 | 合成下单/回调验签/幂等、退款、对账；业务不直连支付渠道；无真实付款/生产凭据 |
| M15 后台入口/壳 | `apps/web/app/{layout.tsx,providers.tsx,globals.css}`、`components/{app-shell,ai-sidecar}.tsx`、`lib/*`、Next config | React/Antd/Refine、后端菜单/权限/插件状态；旧壳有 Company Ops 路径、sidecar 事件、accessToken 与 API fallback | `apps/web/app/`、`components/app-shell.tsx`、`lib/`；新 root page 重建 | 重建后台 root（不拷 `(product)`）；保留 UI 基础，去业务导航/重写/事件，API config 单一来源；sidecar 随 AI 阶段接入 | `/` 进入 AIJ 后台/登录；授权动态菜单；独立 token key；无 3556/3101 请求或轻企产品导航；基础响应式/错误态人工验收 |
| M16 系统页面 | `apps/web/app/auth/**`、`login/page.tsx`；`admin/assets/members/system/notifications` 的现有页面/别名 | admin API、权限、AppShell；配置/运行时/文件等页还依赖 M05–M08；别名不能当成新的独立功能 | 保持 canonical `/auth/{admin-users,roles,menus,dictionaries,system-config,files,members,logs,plugins,runtime,integrations}`；登录 `/login` | 挑选页面逐页适配；旧重复入口仅按需要 redirect；通知页随 M13，不提前伪装完成 | 登录/列表/分页/搜索/编辑/禁用、按钮/API 权限、错误提示、审计；受限角色见正确菜单；页面依赖未迁入时不挂菜单 |
| M17 系统插件页面 | `apps/web/app/plugins/aij-{ai,notification,payment}/**` | 对应 plugin API、价格解析工具、AppShell、插件启用/菜单权限 | 同名新库 aij 插件路由 | 按已验收 backend 逐插件挑选；不复制 qingqi 前台或业务插件页面 | 插件启停与导航/API 一致；关键页面操作真实可用；无业务写操作/真实支付或通知 |

没有发现独立的源 `/auth/workspaces` 或 `/plugins/qingqi-app` 后台组织页面。通用组织的后台 UI 需新写最小界面，客户 `components/product/product-workspace.tsx` 仅作只读参考，不能把产品壳迁入新库。

## 5. 数据、包与工程资产

| ID / 能力归属 | 源文件 | 实际依赖 / 数据 owner | 目标路径 | 迁出方式 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| M18 Schema | `apps/api/prisma/schema.prisma` | 224 model；SysUser/MemberUser/FileAsset/RuntimeJob/Workspace 的业务 relation；各模型 owner 见 CSV | `apps/api/prisma/schema.prisma`，按核心/组织/插件任务逐步增加 | 正向白名单，不按前缀盲删；移除业务 inverse relation，并核对引用 enum/约束/索引；ClientAccountLifecycleRequest 暂留原库 | Prisma validate/generate、空库 migration、漂移检查通过；无业务表/悬空关系；模型与实际服务闭合 |
| M19 Seed | `apps/api/prisma/seed.ts`；业务 `qingqi-site-*.ts` 等 seed 辅助文件仅保留 | root main→registerAllowlistedPlugins→轻企/Company Ops/IP/系统插件/业务 AI 资产；管理员依赖 INITIAL_ADMIN_PASSWORD | `apps/api/prisma/seed.ts`，可拆 `seed/{core,configuration,system-plugins}.ts` | 重写最小/幂等/分层 seed，不从原库执行；只种 AIJ 合成数据与选定系统能力 | 独立库执行两次无重复；无轻企菜单/诊断/品牌/订单/业务模板；首次密码来自新环境且不输出 |
| M20 migrations | `apps/api/prisma/migrations/**`（89 份 SQL 与 lock） | 核心与业务增量混合、跨域 FK/索引；源 _prisma_migrations 属旧产品 | `apps/api/prisma/migrations/<new-initial>/migration.sql` 等新目标迁移 | 只读参考，不能复制历史链或旧迁移账本；从目标空 Schema 生成自己的 initial，再按后续任务增量 | migrate deploy/status/drift 对独立库可重复验证；全新空库可构建；原库 migrations 内容/库状态不动 |
| M21 SDK/Contracts/Core/Runtime/SharedUI | `packages/{plugin-sdk,foundation-contracts,foundation-core,foundation-runtime,foundation-shared-ui}/**`、实际 app 实现（M03/M05–M08/M15） | SDK 有 TS manifest 校验/测试；Contracts→Runtime→Core；UI peer React/Antd；入口常量/少量函数；build 脚本在 scripts/distribution | 同名新库 packages；本地 workspace 依赖，宿主改为公开导出消费 | 先保留版本化契约/声明与 LICENSE，再分包抽取实际能力；单一实现 owner；未发布身份不冒充已获 registry scope | 包导出及类型真实可用；宿主无深层相对 import/app 副本；包模块加载、真实 runtime/组件测试与独立启动通过 |
| M22 系统 descriptor 包 | `packages/system-plugin-aij-{ai,integration,notification,payment}/**` | foundation-contracts dependency、core/SDK peer；入口 distribution/implementation=foundation-monorepo，没有实现 Module | 同名新库 packages；对应 M08/M12–M14 实现 | descriptor 仅是声明，分步补实际实现/adapter；保留声明与来源；F00 不 pack/publish | 本地包导出实际注册入口/Module 或明确 adapter；启用/禁用及宿主消费实测，不以 version 常量代替功能 |
| M23 分发与 starter | `scripts/distribution/**`、`distribution/**` | src→dist 复制脚本；project/migration/compat 工具；starter 依赖 @weiyang86，task.mjs 仅 console.log contract passed | 精选 `scripts/distribution/`；starter 重建放到后续独立任务 | 本地 build/compat 可定向重写；旧业务 project 与演示 starter 不当 runnable template；publish/release 不迁本阶段 | 校验对实际 target manifest/Schema/包有效；无假成功；不调用发布 API/自动 bump/远端 registry |
| M24 目标测试与隔离 harness | `apps/api/test/{health,plugin-runtime,configuration-policy,secret-center,async-runtime,integration-center,client-auth,model-adapter,payment-center,notification-center,...}`、test/support 与 web test | Node test/ts-node/Prisma、isolated PostgreSQL；源 generic test 仍可能引用旧 Schema/registry/业务 fixture | 新库 `apps/{api,web}/test/` 与独立 test/support | 按迁入能力选择；重写 fixture/导入/Schema 及连接断言；原完整 unit/integration 脚本不照搬 | 只打 TEST_DATABASE_URL；拒绝旧库/开发库误连接；有拒绝路径与 owner 断言；目标 tests、lint/typecheck/build 按真实 scripts 执行 |
| M25 轻企业务/旧生产工作流 | `src/plugins/qingqi-*` 的业务部分、ip-automation、finance；plugins 业务 manifest；`apps/web/app/(product)/**`、client、业务插件、components/product、features/product-shell；qingqi-site-runtime；`.github/workflows/*` | 各轻企业务模型/品牌/订单/权益/诊断/行动/CMS/FDE/知识/情报；旧 CI、auto-merge、release/通知/部署依赖原环境 | 原库保留，不迁入新库 | 原样保留；组织及认证可复用机制仅按 M09/M10 定向抽取；历史生产工作流不复制 | 新库无轻企业务静态依赖、业务表、产品页或自动发布/晋级；原库全部文件/修改保留 |

## 6. 禁止迁入与共同验收

真实 `.env*`、证书/私钥/secret、生产 Provider/商户配置、API Key/Webhook 绑定、客户/会员/企业记录、数据库 dump、上传字节、运行日志/Outbox/Job、node_modules、dist/.next、.git、旧 Compose 外部卷、macOS `._*` 均禁止迁入。安全 `.env.example` 必须重新编写；迁移 SQL 定义允许，但真实数据库导出不允许。

每项完成时必须同时具备：源 HEAD/hash 与来源声明、目标 diff 与能力 owner、真实直接依赖、必要权限/菜单/日志、独立环境连接验证、适用目标测试与人工验收、未完成事项。不得以“包已 build”“health 是 ok”“原库能运行”“starter 打印成功”替代新库运行事实。任务顺序与最小验收闭环见 [ROADMAP](../current/ROADMAP.md)。
