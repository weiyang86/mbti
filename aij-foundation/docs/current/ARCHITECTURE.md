> **上游历史快照：** 本文随 `8ba3d302` 源码导入 MBTI，记录的是独立底座仓库；其中状态、计划、地址、授权和验收不代表本仓。MBTI 当前接入范围见 [MBTI_INTEGRATION.md](../../MBTI_INTEGRATION.md)。

## 2026-11-05 新目标与复用约束

[当前需求基线](../planning/ai-platform-baseline-20261105/REQUIREMENTS_BASELINE.md)确认独立部署的通用AI平台；[源码差距](../planning/ai-platform-baseline-20261105/SOURCE_GAP_ANALYSIS.md)固定b8eb9c2的实际实现边界。下方按日期保留的“未迁入/当前”仅代表对应历史阶段，不能覆盖本次源码对照。

继续采用现有模块化单体、宿主组合及唯一owner：Auth/RBAC/Workspace/SecretRef/FileAsset、AsyncRuntime、aij-ai执行与Trace、aij-payment支付真值、aij-notification投递真值。图引擎、沙箱、厂商和存储适配通过这些owner扩展；个人/组织AI资产、自定义工具与对客计量需设计边界，不能复制第二队列、成本或支付账本。OrganizationProfile/ProjectProfile仍是项目归属，客户租户使用ClientWorkspace/Membership；行业订单、门店、论文规则等留业务插件。

[阶段与验收](../planning/ai-platform-baseline-20261105/DELIVERY_AND_ACCEPTANCE.md)为提案，不代表新模块/包已经实现；不顺带升级技术栈、不改原轻企业务、不推定公开许可或发布授权。

---

# 当前架构与工程边界

2026-10-29 NEXT-05 / AF-049–AF-052 当前增量：唯一异步运行时 owner 为 `apps/api/src/async-runtime`，Job/Outbox/调度锁/幂等账本有本库迁移；服务只在认证、数据库已装配且显式启用时启动。实际 readiness/监控投影与受控重试/取消入口由管理 RBAC 保护，队列载荷、幂等键和原始错误不返回；真实 PostgreSQL lease、退避、幂等、副作用、HTTP 拒绝/恢复和关闭池校验已通过。外部 exactly-once、provider 接入和人工统一验收没有被本批证明。接口与配置边界见[异步运行时指南](../development/ASYNC_RUNTIME.md)及[AF-049–AF-052](../execution/AF-052.md)。以下旧状态按各自历史时间保留。

2026-10-27 UI-1本批交付：负责人明确批准UI1-01–04，本地映射AF-026–029；四卡代码与自动门禁通过，**Trea待复核、人工待验**。AF-025-A保留待验，UI-2及AF-025-B未授权、未接续。管理员持久会话/失效、Cookie/CSRF和真实Web登录/退出已接入；当前入口与合成凭据获取见[浏览器指南](../development/ADMIN_BROWSER_AUTHENTICATION.md)，实际基线/差异/逐命令/服务见[AF-029](../execution/AF-029.md)。每30分钟续跑首卡后启用，批次结束已暂停。下文旧范围、无监听、未实现及PID均按日期保留历史。 管理员会话数据owner仍为core/auth；客户ClientAuthSession独立，唯一Prisma未复制。24模型/三条本库迁移，未引入Workspace/AI或插件实现。

2026-10-20 AF-025-A当前增量：唯一ClientAuthModule按F00 M09抽取邮箱登录/持久会话/Guard；复用Prisma，独立客户JWT service/issuer/audience/host-only HttpOnly Cookie、严格Origin与DTO、当前DB身份/version/会话重验。登录及去敏AuditLog同事务；仅扩展已有安全查询投影的已知客户元数据。CLIENT_AUTH_ENABLED默认false，与管理员认证独立；没有客户logout/撤销/改密/同意/注册/找回/Workspace。Schema/迁移/依赖/Web保持，226+2及门禁通过；当前现场见[AF-025-A](../execution/AF-025-A.md)，下方增量均为历史。

2026-10-20 AF-024当前增量：唯一AuditQueryModule按F00 M03的分页/filter与M06文本脱敏机制定向适配，公开QueryService供Auth宿主消费。复用AuditLog及既有写入owner，不迁全局重复审计Interceptor。GET /admin/logs及/:id要求admin.log.read，事务内复查权限和一致快照；core范围workspaceId=null。列表/详情同一白名单投影，原before/after/未知深层载荷和自由文本隐藏，记录本身不重写。246+2与当前人工入口见CURRENT_STATE第32节和[审计指南](../development/AUDIT_LOG_API.md)；Schema/两迁移/依赖/Web保持。以下阶段说明按历史保留。

2026-10-19 AF-023当前增量：SecretCenterModule按F00 M06定向适配，公开SecretRefPort useExisting唯一Service，ConfigurationModule消费；env只解析runtime项目环境命名空间，本地文件强制AES-256-GCM+namespace AAD、专用服务端key及路径/owner/报告权限检查。ExFAT下不将chmod当作独立保护证据。六管理入口JWT/RBAC；配置敏感写另需密钥权限；登记/轮换/清除/检查和配置重绑版本/审计在同一既有写锁事务内。每请求重读，缺值闭合，无公开值入口/真实外部调用；Schema/两迁移/依赖/Web保持。227+2、人工入口及限制见CURRENT_STATE第31节和[密钥指南](../development/SECRET_CENTER_API.md)。以下阶段记录保留历史。

日期：2026-10-12。本文件把“当前源实现”“F01 新库现状”“目标设计”分开记录。

2026-10-18 AF-003增量：scripts/runtime-environment.cjs仍是唯一配置owner，现支持host默认3655/3656与project显式身份/环境/端口/origin/issuer/Cookie/存储契约，API/Web实际消费。配置测试、两应用构建与真实宿主/合成API HTTP已完成；Auth/DB/文件/实际插件仍未迁入，生产公网监听与项目生成/安装留后续。以下F00/F01记录保留为当时证据，当前边界见 [PROJECT_CONFIGURATION](../development/PROJECT_CONFIGURATION.md) 与CURRENT_STATE第10节。

## 1. 当前实际状态

2026-10-19 AF-022：ConfigurationModule按F00 M05定向适配源同名模块，公开Service/Controller/DTO/schema policy，由Auth启用宿主组合。复用既有配置Schema/版本/FK、Prisma/JWT/RBAC及共享审计；ManagementAccessService.audit返回已有创建行ID以让ConfigurationChange原子链接，不新增第二账本owner。运行时项目身份+真实组织确定三scope，project优先，私有高层遮蔽下层公开值；固定key/schema，敏感引用只验证元数据不读env。公开project/context仅品牌/实际能力白名单，项目停用403/受控恢复，context开关不启动插件或执行环境脚本。23模型/两迁移/依赖/Web保持；206+2与人工入口见CURRENT_STATE第30节及[配置指南](../development/CONFIGURATION_API.md)。以下阶段记录按历史保留。

2026-10-19 AF-021：SysDict/SysDictItem按F00 M02/M18定向迁入，新增isPublic/private默认与保留pluginCode owner及RESTRICT关系；独立第二迁移，不改initial/旧验收快照。DictionariesModule公开Controller/Service/DTO，在Auth启用宿主消费，复用唯一Prisma/JWT/RBAC/ManagementAccessService。八管理路由显式admin.dict.manage；匿名读取独立/dictionaries命名空间仅明确公开active安全投影，不放开admin例外。code/value稳定不可重命名，软删保留引用与唯一占位；插件归属core不可改，业务分类不迁。新任务库185+2真实校验、无Web/实际插件安装，当前见CURRENT_STATE第29节与[字典指南](../development/DICTIONARY_API.md)。以下记录按历史保留。

2026-10-19 AF-020：新MenusModule公开Controller/DTO/Service/MenuAvailabilityService，AppModule仅AUTH_ENABLED启用时组合；数据owner为既有SysMenu/SysPermission/AuditLog core。PermissionsService既有解析公开为resolveInTransaction，本人树在同一RepeatableRead复用，不复制角色解析。写入复用ManagementAccessService数据库锁/事务内授权与安全审计。menu需真实active权限码+精确已实现页面+运行时插件可用；目录只提供无href的获准祖先，空权限/不可用父链失败闭合。菜单不替代API Guard；只注册现有工程根页/，插件安装/未实现后台页面不装配。Schema/initial/依赖/Web保持，312+2及当前人工入口见CURRENT_STATE第28节与[菜单指南](../development/MENU_API.md)。以下前序记录按历史保留。

2026-10-19 AF-019：复用RbacManagementService/Controller/DTO、Prisma、统一JWT/RBAC和共享ManagementAccessService；只扩展既有权限替换的事务内active角色检查和成功审计可选ID前后集合（permissionIdsBefore/After），不复制能力或新增API/Schema。停用角色分配/撤销409；后端目录ID必须active、非法选择400；非DB超级不能赋权。角色软删清权限、保留用户与历史关联，Guard即时去权；真实锁等待状态重查及审计失败整笔回滚已测。当前294项+2宿主、人工入口见CURRENT_STATE第27节。

2026-10-19 AF-018：本项所需管理员API已在AF-015/017完成并公开给现有宿主；Controller/Service/DTO/Prisma/JWT/RBAC/ManagementAccessService及core数据owner不改，不复制实现。本项仅登记复用和新任务校验/安全人工准备，真实验证分页/密码/停用/自我与最后超级保护、审计失败事务回滚及锁等待期间撤权重查。仅新验收库的合成失败trigger/function在测试后移除，应用Schema/initial未变；无AI或页面耦合。当前284项+2宿主及人工地址见CURRENT_STATE第26节。

2026-10-19 AF-017：复用既有PermissionsService/Guard/JWT/Prisma，RbacModule导出AdminAuthorizationGuard并APP_GUARD/useExisting装配admin命名空间，替代各管理Controller重复局部Guard，缺权限声明默认拒绝；仅/my明确身份例外，与权限声明冲突拒绝。本人权限快照采用RepeatableRead；无授权缓存，每请求查有效身份/角色/权限，提交后的撤权/停用下一请求生效。非admin入口保持原授权owner；没有客户租户/行级授权、页面或会话安全实现。真实276项+2宿主/人工入口与当前边界见CURRENT_STATE第25节及[RBAC指南](../development/RBAC_AUTHORIZATION.md)。

2026-10-19 AF-016：RbacModule新增RolesController/PermissionManagementController、RbacManagementService/DTO，导出并由既有宿主消费；Prisma/JWT/判权唯一owner保持。AF-015写事务/去敏/最小成功审计抽到ManagementAccessService供两管理Service共享，同一数据库写锁后重查操作者。13入口含角色CRUD/状态/权限替换、custom权限CRUD；旧/my与bootstrap只读目录契约保持。普通账号限空且未分配角色，权限绑定仅DB超级；代码owner不可改，自定义权限引用保护，角色软删事务清权限保留用户关联。显式Seed --rbac-management只注册两定义不修复授权；Schema/initial/manifest/锁保持。菜单/页面、客户租户/行级授权、插件权限挂载与完整审计未迁。当前见[角色权限指南](../development/ROLE_PERMISSION_API.md)和CURRENT_STATE第23节，以下为历史。

2026-10-19 AF-015：唯一AdminUsersModule/Controller/Service/DTO通过AuthModule/RbacModule复用JWT/PermissionsGuard/Prisma。七路由显式admin.user.manage；受保护Seed的--admin-users只注册定义，不扩大bootstrap授权或修复撤销。写事务取得数据库局部锁后复用PermissionsService.authorizeInTransaction重查操作者，同事务验证角色/自操作/最后超级管理员、写用户与最小审计；普通账号不能绑定角色或变更超级账号。共享scripts/admin-policy.cjs为Seed/API密码策略owner，bcrypt12；列表/详情只select安全字段、软删保留唯一占位。Schema/initial/manifest/锁及JWT核心保持；改密不撤销既有JWT。239+2及门禁通过；角色CRUD、菜单/页面、客户租户权限及通用审计未实现。当前见[管理员管理指南](../development/ADMIN_USERS_API.md)及CURRENT_STATE第22节；以下历史保留。

2026-10-19 AF-014：RbacModule公开导出唯一PermissionsService/PermissionsGuard，宿主按AUTH_ENABLED组合并通过其imports复用AuthModule与唯一Prisma。Permissions声明类/方法AND且无隐式开放；Guard只接受JWT建立的id，Service在RepeatableRead事务中重查active用户/未软删active角色/active权限及关联。真正DB超级管理员也不能绕过未注册/停用权限定义，角色名与Token角色声明无特权。GET /admin/permissions/my提供当前自身上下文；GET /admin/permissions绑定已有aij.bootstrap.admin只读目录，不迁管理CRUD或菜单。拒绝审计仅核心rbac固定状态/必需code/关联ID，认证与RBAC共用既有错误去敏owner。Schema/initial/Prisma/JWT实现和manifest/锁保持；202+2、真实DB/HTTP和门禁通过。当前地址/范围见[RBAC指南](../development/RBAC_AUTHORIZATION.md)与CURRENT_STATE第21节，以下保留历史。

2026-10-19 AF-013：唯一auth owner为apps/api/src/auth，Controller处理登录/me、LoginDto限制字符串及bcrypt字节长度，AuthService复用唯一PrismaService与Seed hash，JwtAuthGuard严格验证签名/项目/环境/issuer/audience/admin/时间并重查当前active且未软删身份。JwtModule公开导出，AppModule按AUTH_ENABLED组合；无包/宿主双份实现。请求关联前移到middleware以覆盖Guard/JSON错误，认证错误固定去敏。最小登录成功/失败审计写现有AuditLog，不迁通用审计服务。Schema/initial保持；177注册用例+2原宿主、质量门禁通过，人工API3656保留，Web未运行。RBAC/菜单授权、客户认证、刷新/注销撤销与文件插件仍未实现；详见[管理员认证](../development/ADMIN_AUTHENTICATION.md)及CURRENT_STATE第20节。以下AF-012及更早为历史。

2026-10-19 AF-012：唯一Seed实现scripts/database/seed.mjs、薄根入口db:seed；复用connection的受保护pg工具及migrate status身份/资源/账本链，不新增ORM服务或HTTP。仅AIJ configuration组织/项目和core管理员/RBAC合成初始数据，权限为data标识无路由/菜单，项目不替代Workspace授权。已有密码/状态/角色/授权和项目资料只保留，Seed不做权限恢复。bcryptjs沿源3.0.3、hash cost12；Schema/initial与唯一Prisma服务不变。114项及质量门禁通过；当前无Web/API监听，人工验收为新AF-012逻辑库。详细规则见[最小Seed](../development/MINIMAL_SEED.md)和CURRENT_STATE第19节，下方均为历史阶段。

2026-10-19 AF-011：apps/api/src/prisma是唯一运行时Prisma owner（F00 M04 AIJ database），PrismaModule公开导出单例、AppModule消费；复用bootstrap已有shutdown hooks。延迟连接使数据库故障不阻止进程存活；HealthController只报告进程，ReadyController调用Service真实核对database/current_user/session_user/内部端口及本地迁移名/checksum/完成状态，失败503且只给固定reason。共享目标/本机配置策略移至runtime-environment，工具connection重导出消费，不复制验证器。无入参公共探针无需DTO/Guard，不提供管理授权；21模型的数据owner、Schema/initial保持。104项、真实HTTP/逻辑新测试库断连恢复/关闭池与main SIGTERM通过，人工API保留3656；详见[Readiness指南](../development/DATABASE_READINESS.md)及CURRENT_STATE第18节。下方AF-010及更早段落均为历史阶段。

2026-10-19 AF-010：21模型/4枚举Schema不变，独立initial从本库empty生成；scripts/database/migration.mjs是迁移owner，薄CLI仅deploy/status。connection复用原URL/真实身份保护，验收ID限定本机/环境/实例匹配的新库。两新空库首次/二次deploy、status、21表/243列/4枚举/74索引（含账本主键）/13FK及零漂移通过；原dev/test表/哨兵保持。API未接Prisma，无Seed/产品账号/服务启停/业务数据迁入；当前见[CURRENT_STATE](CURRENT_STATE.md)第17节及[Initial指南](../development/INITIAL_MIGRATION.md)，以下历史保留。

2026-10-19 AF-009增量：同一Schema新增FileAsset、PluginInstallation、PluginOperation及两状态枚举，数据owner均AIJ core。FileAsset去掉四建站反向关系及bizType/bizId，保留20通用标量；源Plugin/PluginInstallLog适配为项目插件安装及操作历史，版本/owner必需、失败原因可空、默认未安装/pending，历史FK显式Restrict/Cascade。原18模型/2枚举不变，当前21模型/4枚举，85断言/生成类型及根质量门禁通过。没有文件字节/插件记录或任务/支付/AI表迁入，没有存储驱动/生命周期执行器/Controller/Service/DTO/Guard、迁移或Seed；状态定义不是安装启停/升级恢复证据。当前以CURRENT_STATE第16节及[文件插件Schema](../development/FILE_PLUGIN_SCHEMA.md)为准，下方阶段快照保留。

2026-10-19 AF-008增量：同一Schema新增OrganizationProfile、ProjectProfile、ScopedConfig、ConfigurationChange、SecretReference、AuditLog，分别归AIJ configuration/secret-center/core。原12模型/2枚举定义不变，当前18模型；来源缺显式版本/审计外键，本项仅补version、历史configVersion及稳定config/audit链接。项目组织没有客户成员/权限关系，AuditLog.workspaceId只是可空快照上下文。真实validate/generate、68项断言和类型门禁通过，未迁配置/密钥/审计Service或产品数据。String/JSON的内容脱敏、事务版本更新、授权及租户隔离执行仍未实现；当前以CURRENT_STATE第15节和[配置Schema](../development/CONFIGURATION_SCHEMA.md)为准，以下保留阶段记录。

2026-10-19 AF-007增量：在同一Schema追加MemberUser、ClientAuthSession、ClientAuthOneTimeToken、ClientConsentRecord、ClientAuthRateBucket，数据owner为AIJ identity，和7个AIJ core管理模型无跨组关系。保留来源字段/约束/8索引，去掉MemberUser的54条组织/业务/lifecycle反向关系；本库不依赖轻企Workspace或企业资料启动。Prisma6.19 validate/generate、21身份+23核心断言与生成公开类型检查通过，未建表/迁移/Seed或装配认证服务。账号导出/注销未实现；当前事实见CURRENT_STATE第14节及[客户身份Schema](../development/CLIENT_IDENTITY_SCHEMA.md)，下方保留此前阶段记录。

2026-10-18 AF-006增量：apps/api/prisma/schema.prisma是本库管理员/RBAC模型的唯一实现，按F00清单抽取SysUser、SysRole、SysPermission、SysMenu和三张显式关联表及UserStatus/ResourceType；移除SysUser的23条轻企业务反向关系，六条必需外键显式Restrict/Cascade。Prisma与client均固定6.19.0，配置及离线validate/generate已实际执行，生成客户端和公开类型已验证；没有迁移、产品表/数据或API数据库Service。模型owner与未实现的Controller/Service/DTO/Guard边界见 [RBAC_SCHEMA](../development/RBAC_SCHEMA.md)，当前现场以CURRENT_STATE第13节为准；下方AF-005及更早段落保留各自阶段事实。

2026-10-18 AF-005增量：本库ops两份Compose和scripts/database单一工具owner已创建两套独立PostgreSQL，默认db:check进行真实连接/身份SQL，运行/重启/重建持久化已测；runtime-environment继续独占URL策略。数据库账户、命名卷与af005_verification.sentinel仅属本库本地合成验收，未迁入产品Prisma Schema/历史迁移/客户数据。API尚未接Prisma或DB，API health不代表这些工具连接；实际地址/凭据位置与边界见 [实例指南](../development/DATABASE_INSTANCES.md) 和CURRENT_STATE第12节。

2026-10-18 AF-004增量：数据库配置仍归scripts/runtime-environment.cjs，独立公开resolveDatabaseEnvironment并由db-check.mjs薄CLI消费，不复制一套Service/DTO/Guard。宿主dev/test精确目标白名单与连接前拒绝已实测，生成项目保留独立配置。没有Prisma/数据库driver/SQL、Schema或数据owner迁入；当前现场以CURRENT_STATE第11节及 [数据库校验契约](../development/DATABASE_TARGET_CHECK.md) 为准。

新库起点只有 README 和 .gitignore；F00 建立治理与审计，F01 建立自己的 pnpm workspace/锁文件、`apps/api` 和 `apps/web`。新库已安装并构建 NestJS 11.1.19、Next.js 16.2.6、React 19.2.6；本机运行 Node 24.21.0、pnpm 10.0.0。Prisma 6.19.0、Ant Design/Refine 是来源技术方向，F01 未安装或装配这些尚不需要的能力；后续按实际任务迁入，不做栈升级。

F01 阶段组合（历史）：

```text
scripts/runtime-environment.cjs  唯一环境解析/端口与 loopback URL 校验
             │
scripts/run-app.mjs              只启动新库应用；占用端口时拒绝启动
             ├─ apps/web        Next.js 工程入口，实时读取新 API health
             └─ apps/api        NestJS Config + 空 PluginRuntime + Health
                                /api、CORS、ValidationPipe、关联 ID、统一成功响应
```

API health 的 scope 为 `process`、database 为 `not-configured`、enabledPlugins 为 `[]`；编译白名单当前确实没有插件 Module，非空配置或未知 code 失败退出。没有 Prisma/数据库连接、Auth、Admin、AsyncRuntime、业务插件 import 或 package 实现。Web 不是 F08 的完整后台壳，也没有业务产品页。

根 `.env` 由 Node 的 `parseEnv` 解析为数据，优先级为进程环境 → 新库根 .env → 3655/3656 默认值；工作目录不同不会改变环境文件来源。只消费 F01 所需配置；数据库、Secret、Cookie 等后续能力不以占位实现接入。本机 ExFAT 用 pnpm hoisted + copy，不以原库目录符号链接获得独立运行。

F01 收尾补充：启动器区分 EADDRINUSE 与其他 socket 错误，保留原始 cause/堆栈；API 启动失败记录原始堆栈。Unix 下每次启动创建自己的进程组，停止信号只传给该组，包含 Nest watch 编译后生成的 API 子进程。本轮 SIGINT/SIGTERM 无残留已实测。API 的 watcher 是 Nest CLI → TypeScript watch → fs.watch（含 watchFile fallback）；Web 为 Next webpack / bundled Watchpack → fs.watch。没有因历史错误未复现就修改 watcher 或放宽权限。

现有安全范围只有 loopback/端口/URL/proxy 校验、固定 CORS 来源、空插件装配拒绝和关联 ID。health 公开响应，CORS 不是身份认证；登录、JWT、RBAC、管理员页面与业务审计均未实现。浏览器工具的 admin-enforced policy 属于工具环境，不能当作本库管理员安全功能。

以下表格继续记录来源仓库的实际耦合，不代表这些模块已迁入新库：

源库定向核对结果：

| 核对面 | 源文件与实际事实 | 对迁出的影响 |
| --- | --- | --- |
| 后端装配 | `apps/api/src/app.module.ts` 在 ENABLED_PLUGINS 之外硬编码 aij 与 qingqi 插件；`plugin-runtime/*.ts` 静态 import 业务 Module/Manifest | 只清空环境变量不能获得独立底座；必须重新建立编译白名单与装配 |
| 管理服务 | `admin/admin.module.ts` 注入 AI Cost/Binding/Capability/Execution、ModelService、Secret、Storage；`admin.service.ts` 同时访问 Sys/Member、Ai 和 CompanyOps 表；controller 含 Company Ops 路由 | 按核心管理、系统插件管理、业务三类拆分，不能整体视为通用 CRUD |
| AI | `ai/ai.module.ts` 导入 AdminModule；`ai.service.ts` 调用 AdminService 的 Company Ops 工具；Model/Cost/Trace/Capability 有实际服务 | 保留通用执行 owner，业务工具通过注册端口提供；消除 AI 对业务管理实现的依赖 |
| 身份 | `auth/` 是 SysUser 管理端；`client-auth/` 使用 MemberUser、Session、OneTimeToken、Consent、RateBucket；通知 adapter 只有 disabled/test | 可抽取认证机制；不能宣称已有正式邮件投递。账号生命周期表有定义，未在 client-auth 目录发现其服务，暂不迁入该表 |
| 组织 | `OrganizationProfile/ProjectProfile` 是配置项目归属；`plugins/qingqi-app/` 另含 Workspace/Membership/Role/Invitation、CompanyProfile、IP Profile、插件启用检查 | 通用租户能力与轻企企业上下文分拆；不能把项目组织误当成客户 Workspace |
| 前端 | 实际路由在 `apps/web/app/`，不是 `src/app/`；AppShell 带 Company Ops 分支和 AiSidecar，Next config 带轻企 redirects/rewrites；页面有局部 3556/3101 默认值 | 仅挑选后台系统页面，重建入口与导航、统一 API 配置；产品前台不迁入 |
| 数据 | `schema.prisma` 有 224 个 model、89 份 migration.sql；SysUser、MemberUser、RuntimeJob、FileAsset 含业务反向 relation | 正向选表并重建新库 initial migration，保留核心内部关系、删掉新库不拥有的 relation，不能照搬历史迁移 |
| Seed | `seed.ts` 的 main 调用 `registerAllowlistedPlugins`，后者注册轻企、Company Ops、IP 和系统插件，并写业务 AI 默认资产 | 新写分层、幂等、无业务数据 seed；原 seed 不能执行在新库 |
| 包与 starter | foundation 包入口为常量/少量函数，system-plugin 包为 descriptor；build-package 只复制 src 到 dist；starter task 只打印 contract passed | 包存在不等于真实运行能力可用；独立宿主必须消费实包并通过真实测试 |

直接 import 与关系的逐文件证据在 `docs/generated/`。静态依赖清单不等同于 Nest DI 和运行时依赖闭环；后续仍须模块加载、Schema Validate 和实际启动测试。

## 2. 目标分层（F01 只完成组合根与进程入口）

```text
apps/web：AIJ 后台宿主；登录、权限菜单、系统页面、系统插件路由
    │ 只调用新库 API
apps/api：AIJ 组合根；健康检查、配置装配、插件白名单
    ├─ core：Auth / RBAC / Menu / Member identity / Config / File / Audit
    ├─ organization：通用 Workspace / Membership / Role / Invitation
    ├─ runtime：Outbox / Job / Scheduler / Idempotency / Integration
    └─ system plugins：aij-ai / aij-notification / aij-payment
    │
Prisma：本产品独立 Schema + Initial Migration + 幂等安全 Seed
    │
PostgreSQL：aij_foundation_dev（独立实例/账户/卷）；测试另库/另卷

packages：@aij/core / @aij/contracts / @aij/sdk / Runtime / Shared UI / System plugins
          G12-01..03 建立了实际 owner 与 API/Web consumer；其余仍待后续授权
```

迁出初期保留 `apps/api/src/` 和 `apps/web/app/` 的熟悉结构降低变更面。实包阶段将已验收能力迁到包的单一 owner；宿主只保留装配或薄 adapter，禁止在 app/package 各保留一份同名实际服务。工作区包使用本地依赖；新应用建议 `@aij/api`、`@aij/web` 且 private，公共 registry scope 和发布版本不在 F00 决定。

## 3. 数据所有权

“代码归属 AIJ”不等于“原轻企记录迁给 AIJ”。原库所有运行数据继续归原产品；新库只有自己的新建合成数据。产品仓库也不自动意味着共享中央身份数据库。

| 能力 | 源库当前数据 owner | 新库目标 owner / 处理 |
| --- | --- | --- |
| 管理员、角色、权限、菜单、字典、审计、文件、插件 | platform/core | AIJ core；只复制模型定义/实现，记录和文件字节不复制 |
| MemberUser 与客户 Auth | 当前 canonical 文档归 qingqi-app/Client Auth；实现位于 client-auth | AIJ 通用身份；新建自己的 Member、会话、同意记录，拒绝原产品 Token |
| OrganizationProfile / ProjectProfile / ScopedConfig / SecretReference | foundation 配置与密钥引用 | AIJ 配置域；不复制项目品牌、环境绑定或 secret 内容 |
| RuntimeOutbox / Job / SchedulerLock / Idempotency | platform/runtime | AIJ runtime；业务 handler 由宿主注册，不带原库队列、任务、锁 |
| Integration* | foundation/integration | AIJ integration；不带生产 API Key、Webhook、上传数据或模板中的真实内容 |
| Workspace / Membership / Role / Invitation | qingqi-app | 抽取通用机制到 AIJ organization；新库模型拟用 Workspace 等名称，与项目组织区分 |
| QingqiCompanyProfile / QingqiIpProfile / Enterprise Context | qingqi-app | 留在轻企；新通用 Workspace 不以这些模型为启动前提 |
| Ai* 执行、路由、成本、Trace、评测 | aij-ai | AIJ aij-ai；同一成本/执行 owner；业务 capability/agent/skill/Prompt 资产留原业务，模型与成本日志不复制 |
| Notification* | aij-notification | AIJ notification；只迁投递机制，不带收件人/消息/业务模板 |
| Payment* | aij-payment | AIJ payment；只迁支付轨道实现，不带商户凭据和交易 |
| 商业订单/权益、诊断/方案、行动、知识、情报、FDE、CMS/站点、IP、CompanyOps、Finance | 相应轻企业务插件 | 原库保留；PublicSearchCache 归情报，不能因名称通用就迁入 |
| ClientAccountLifecycleRequest | 表已定义、当前服务闭环未证实 | 暂留原库；另做能力与 owner 核对，不把定义当成已实现导出/注销 |

G18-01/AF-103 与 G18-02/AF-104 补充支付边界：业务插件持有 payable 的身份、价格、币种与资格；aij-payment 的 PaymentService 是 PaymentOrder/PaymentAttempt、请求幂等和 scoped read 的唯一 owner；Provider 只能返回规范化观察结果，不能直接写账本。客户端只提供 payable reference 与幂等键，服务端生成金额、币种、项目/成员身份及 Provider 幂等值。生产 payable/SecretRef/Provider 适配器未配置时失败闭合；本地 test fixture 不代表 live 收单。PaymentTransaction、回调与对账仍属于后续 G18 卡。合同与状态跃迁见 [Payment Provider contract](../development/PAYMENT_PROVIDER_CONTRACT.md)。

224 模型逐项处理见 [Prisma owner 清单](../generated/PRISMA_MODEL_OWNERSHIP.csv)，包括各字段引用的模型类型和跨 owner 关系。

## 4. 必须守住的工程边界

1. 新库不 import `../qingqi-ai-consultant`，不使用原库链接、构建产物、共享 .env 或数据库连接，不对原应用装配做反向修改。
2. 插件只依赖核心契约和注册端口。未注册/未启用的插件路由、菜单、权限和 handler 不出现；不能用 ENABLED_PLUGINS 覆盖静态业务 import 问题。
3. 业务能力不得塞进底座 AdminService、AiService、Seed 或 UI 壳；业务工具注册只由所属业务提供。
4. 管理身份、客户身份、Workspace 成员角色三者区分；FDE 仍是原产品 SysUser 平台人员，不新增通用 WorkspaceRole.FDE。
5. 原轻企继续持有八类 Enterprise Context、唯一顾问诊断引擎、Canonical Lead、业务订单与权益；支付仍经 aij-payment。抽取不重写这些业务规则。
6. 数据迁出只涉及定义。新库空库 initial migration，不能引用原 `_prisma_migrations` 或基于真实记录“校验成功”。所有业务 relation、enum、约束、索引、JSON 语义逐一审核。
7. 独立端口不足以隔离身份：localhost Cookie 不按端口隔离。新库 Cookie 名、JWT issuer/key、认证链接和数据目录都需独立；原库值不改。
8. 历史发布、自动 merge、Docker 生产部署、starter 演示和源码包声明不作为本次独立启动证据。F00 不迁入自动发布/自动晋级工作流。

## NEXT-10 G11-01: 插件 manifest 校验

AF-067 将 `apps/api/src/plugin-runtime/plugin-manifest.ts` 设为插件 manifest v2 与声明元数据校验 owner；现有 `PluginRuntimeModule` 仍是唯一宿主装配点。仅允许编译期静态注册的 Nest module class，拒绝 manifest 提供任意 import 路径；当前注册表为空，因此不默认启动插件。依赖图解析、持久化安装/启停状态、生命周期事务与管理 API 属于后续 G11 卡。源 `plugin-sdk` 的 All Rights Reserved 声明已保留，本地适配不表示获准发行。见[manifest契约](../development/PLUGIN_MANIFEST.md)、[AF-067](../execution/AF-067.md)与[来源记录](../governance/SOURCE_PROVENANCE.md#15-next-10-g11-01-manifest-adaptation-af-067)。

## NEXT-08 current package implementation (2026-10-30)

G12-01 audited `@aij/core`, `@aij/contracts`, and `@aij/sdk` against actual API/Web source owners and consumers. G12-02 now implements only `@aij/core`: correlation ID parsing/propagation is owned by `packages/core/src/index.ts`; API consumes the package through its Nest adapter and real built HTTP host. `@aij/contracts` and `@aij/sdk` are still pending G12-03; runtime/UI packages are outside NEXT-08. All packages remain private and unpublished pending rights review. See [package boundary map](../development/PACKAGE_BOUNDARIES.md), [AF-059](../execution/AF-059.md), and [AF-060](../execution/AF-060.md).
