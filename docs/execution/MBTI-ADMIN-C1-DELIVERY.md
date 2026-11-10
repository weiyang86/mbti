# MBTI Admin C1：mbti-config 插件候选交付

日期：2026-11-10。Run `run_801f9322af2e`，Task `task_bff98a616368`，Dispatch `ctx_f9ddd2e982fd`，worker `term_f54a9864-e348-4b1e-a72b-644955f41780`。工作树 `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti`，直接在 `dev` 单 Writer 实施，起点 `577654af86ffeb8f15a7824f3078496e66f269aa`（B5）。候选 SHA 以本文件所属 C1 提交和 worker_done 完整 SHA 为准。

**结论：C1 代码候选可继续交给 C2；真实数据库/角色/浏览器验收 BLOCKED / NOT_RUN，不能认定整张 C1 验收已通过。** 未切分支、未新建工作树、未 push/deploy、未修改 H5、F1–F6 业务实现或根 API OpenAPI。原测试 owner 未恢复，没有猜数据库配置、重建 owner、迁移/重置/Seed 数据库或更改公共账号/角色。

## 来源、归属和映射决策

已读根及 Foundation AGENTS、C1 卡、RUNBOOK、输入原型、Foundation README / MBTI_INTEGRATION / UPSTREAM_IMPORT、现有插件 manifest/catalog/lifecycle/runtime/launch tests、ScopedConfig / ConfigurationChange / SecretReference / PermissionsService / ManagementAccessService / AuditQueryService，以及 B3 `config-contract-v1.ts` 和 B5 `b5-contract.ts`。UPSTREAM_IMPORT 来源仍为 `weiyang86/aij-foundation@8ba3d30271db8862798665fd81480cc6f573e696`，1811 条来源文件哈希保留，独立上游仓未访问或修改。上游 docs/current 和 AF 验收不是 MBTI 当前授权或通过记录。

输入原型 SHA-256 `fb7607763dbc41472bccda10fc24f9241ec4d306d3b745eaabdb7be4a94248a6`。候选字段取自根 admin 的 `config-model.ts`、`config-fixture.json`、`b4-model.ts`、`b4-image.ts`、`b5-model.ts`，而非推断业务 API 字段。映射为 content→content、channels→channels、shop/styles→catalog、quiz→assessment、personas→personas、B4 recipe→imageRecipes、retention→retention、social→discovery、ai-settings→aiRuntime、payment-settings→payments、trade-settings→trade；release 仅表示版本/审计生命周期。

这些映射是 `mbti-config-candidate/v1` 内部候选，响应持续返回 `status: needs_human_review` 与 `unknowns`。没有改写 B3/B5 consumer、宣称其已接 HTTP 或定稿根 API。Remy 尚须决定正式字段/固定业务 ID、每类读写与发布角色、MBTI 权限码、商户凭据族、公开字段、C2 不透明 revision adapter、业务快照/题库/价格的消费映射。C1 的整数 expectedVersion/expectedDraftVersion 不直接替换 consumer 的 unknown revision。

## 可信加载与生命周期

- 静态注册：`apps/api/src/plugins/mbti-config/mbti-config.plugin.ts`，manifest v2，版本 `0.1.0`，owner `@aij/api`，核心范围 `^0.1.0`。注册限定 `projectIds: [mbti-foundation]`；新限制只作用于显式声明它的注册，其他插件不变。
- `trusted-plugins.ts` 显式 import `MbtiConfigModule` 的 registration。共享 `scripts/plugin-launch-codes.cjs` 被 `plugin-launch-policy.mjs` 和 API 同时消费；API 装配时比较整个静态 registry 与 launch 集合，漏项、多项或重复都失败。实际可信集合为 aij-ai、aij-notification、aij-payment、mbti-config。运行时仍必须显式设置 ENABLED_PLUGINS；没有自动启用默认项。
- `assertRuntimeCapabilities` 拒绝 mbti-config 在其他 project 或未开启管理员认证/数据库能力的运行配置中启动。每次配置操作还通过真实 `PluginRuntimeAccessService` 从 code=`<projectId>-<environment>` 且 environment 与运行环境完全相同的 active ProjectProfile 取数据库 project ID，再锁定并核对本项目安装状态。客户端不能提交 scopeId/projectId/environment。
- 安装、启用、停用复用 `POST /api/admin/plugins/mbti-config/{install|enable|disable}`，install body 仅 `{version:"0.1.0"}`，以及 `GET /api/admin/plugins`。权限仍为 `admin.plugin.manage`。使用现有 PluginInstallation 的 projectId+pluginCode 唯一键、operation/audit 与事务锁；没有第二套生命周期。
- 重复 install（installed 时）、enable（enabled 时）、disable（installed 时）不重复写 operation/audit。enabled 时直接 reinstall 仍按原 owner 返回 409，须先 disable。没有初始化/生命周期 hook、没有创建菜单、权限、grant、角色、账号或默认配置；重复装配不写数据库。manifest 的 menus/permissions 为空，frontendRoutes 声明 `/plugins/mbti-config/settings`。manifest.configSchema 为空是因为平台声明仅支持原子标量，11 类聚合由插件严格 schema 验证，不能经通用任意 key API 写入。
- 超管入口在既有 AdminOverview 的 `admin.plugin.manage` 平台超管条件下出现，页面为 `/plugins/mbti-config/settings`；复用 AdminShell、会话/CSRF request、PageHeading、Ant Design 和错误状态。页面提供可信目录、安装/启停、版本/草稿/11类配置状态，日常编辑留给 C2。未创建 sys_menu 行，因而没有重复菜单/历史授权副作用。
- 关闭启动加载时路由不存在；加载但未安装/停用时 `PluginRoute` 和服务内同事务 gate 都拒绝 404。原 Foundation 没有 uninstall API；不补造另一条删除生命周期，缺失安装行同样 404。停用不会删除配置、草稿或历史。

## 11 类的精确候选 shape

唯一词表为 `mbti-config.categories.ts` 的 `MBTI_CATEGORIES`，schema、投影、diff、审计字段白名单和测试共用它。snapshot 必须恰好含下列 11 个 key；每类起初为 null，表示 UNCONFIGURED，无自动原型 Seed 或 fallback 业务值。保存某类必须提供下表完整对象，不能提交 null 或额外字段。所有普通文本须非空、长度不超限，不含 HTML 符号/英文引号、控制字符、SecretRef URI 或既有 redactText 能识别的凭据形态；错误不回显输入。

| 类别 | 完整 shape 与校验 |
| --- | --- |
| content | `{headline,accent,sub,cta,moments,avatar,meet,caption}` 全为 string；长度分别 26/28/80/20/100/100/100/100 |
| channels | 恰好 wechat/mp/douyin/xhs；每项 `{name:string≤30,landing,badge:string≤26}`；landing 仅 home/pricing/test-intro/discover/history |
| catalog | `{shop,styles}`；shop 恰好 2 项 `{id:string≤64,title:string≤24,cents:int[1,999999],desc:string≤100,on:boolean}`，id 唯一、至少一项 on、第二档价格不低于第一档；styles 恰好 3 项 `{id,title:string≤16,art,on:boolean,order:int[1,3]}`，id/art 仅 editorial/illustration/game，id 与 order 各唯一，至少一项 on |
| assessment | `{question_bank_version:string≤96,questions}`；恰好12题，每维 EI/SN/TF/JP 各3题。题为 `{id:string≤64,index:int[1,12],dimension,prompt:string≤100,options,reverse:boolean}`；id/index 唯一；options 恰好2项 `{id,label:string≤70}`，id 只能是该维的两个小写字母且不重复，label 去边空白后互不相同。只验证候选，不创建业务 session/result 或重算历史 |
| personas | 恰好16个四字母 MBTI key；每项 `{title,quote,recharge,communication,care}` string，长度 18/48/90/90/90 |
| imageRecipes | `{recipe}`；recipe 仅 portrait/balanced/style，来源 B4 本地配方选择；不接受图片、文件名、Base64、自由提示词或猜测的资产字段 |
| retention | `{tags:string[],days:number[]}`；tags 1–10个、各≤12字且去重；days 1–3个、不同整数[1,365]；不包含 cohort/提醒服务 |
| discovery | `{order,daily,radar,radius,minimum}`；order same/recommend；daily int[1,30]；radar boolean；radius 500/1000/3000；minimum int[10,200]；不接 GPS、聚合或联系方式授权 |
| aiRuntime | `{mode:"UNCONFIGURED",size,timeout,credentialRef?}`；size 960*1280/1024*1024/720*1280，timeout int[20,180]。credentialRef 仅复用 Foundation 既有同名 SecretRef 语法及 owned namespace，必须有 active SecretReference 元数据；不读取值/探测供应商。正式 provider/model/gateway/prompt 映射未知，均不接受 |
| payments | 恰好 wechat/mp/douyin/xhs；每项 `{enabled:false,mode:"UNCONFIGURED",merchantLabel}`；展示名仅 MBTI搭子体验店/品牌展示样例。真实商户标识、回调和各族凭据字段尚未获批，一律拒绝，不能用原型演练配置启用收款 |
| trade | `{ttl:int[1,120],redeem:boolean,selfRefund:"self"或"support",refundDays:int[1,30]}`；尚未接业务订单执行，不追溯改变已有成交规则 |

渠道 name、ID 等容器约束为候选校验边界，不代表 Remy 已作正式业务字段决策。snapshot 的 null、运行模式 UNCONFIGURED 与待审核标记各有不同含义；不会把已有商户、模型、价格或未提供的运行配置推定为可用。

## 权限、路由与响应

生产 controller 使用既有 `JwtAuthGuard` + `PermissionsGuard` + `PluginRoute('mbti-config')`。由于插件命名空间不是 `/admin`，这里显式声明两个管理员 guards，不能依赖只识别 admin 前缀的全局 guard。所有请求均 `Cache-Control: no-store`；标准 Foundation success envelope 和异常过滤机制继续适用。

所有配置 read/save 都需当前 DB 有效 `admin.config.manage`，服务内再次授权。普通该权限仅能读/改前8类；aiRuntime/payments/trade 从 categories、diff、历史内容及变更类别投影中移除。系统类读/改及全部 publish/rollback 额外要求当前平台 `isSuperAdmin` 和有效 `admin.secret.manage`。发布服务也通过 ManagementAccess 在同事务内检查两项既有权限。不拿客户端角色、capabilities 或 B1 的 mbti:ops 名称充当平台授权；正式运营角色映射待人审。

以下路径均加 `/api/plugins/mbti-config` 前缀，且受安装启用 gate 保护：

| 方法/后缀 | 严格输入 / 返回 |
| --- | --- |
| GET `/draft`、`/published` | 返回 schema、state（published/UNCONFIGURED）、status（needs_human_review）、unknowns、expectedVersion、expectedDraftVersion、view、可信 source（scope/projectId/environment/pluginCode）、受限 categories 和类别名数组 diff |
| PATCH `/draft/:category` | body 恰好 `{value,expectedDraftVersion}`；返回新 draft 投影。一个全局草稿修订号，跨类别并发也要重读 |
| POST `/publish` | body 恰好 `{expectedVersion,expectedDraftVersion}`；成功 200 `{version,auditLogId,diff}`；管理员只能发布自己刚核对的草稿修订 |
| GET `/versions` | 最近100条发布/回滚记录，按 version 倒序；只有 version/event/auditLogId/createdAt/受限 categories |
| GET `/versions/:version` | 既有发布版本受限内容；不存在404，不读取活动草稿 |
| POST `/versions/:version/rollback` | body 恰好 `{expectedVersion}`；目标为正十进制、同作用域 recorded 且未删除的更早发布版本；成功返回新 version/auditLogId/diff |
| GET `/audit` | 最近100条同项目/插件 ConfigurationChange 的脱敏事件索引：id/event/version/auditLogId/createdAt/受限 categories；不返回 changeMetadata、snapshotKey 或配置值 |

expectedVersion / expectedDraftVersion 为 JSON 整数[0,2147483645]，0表示尚无该记录；不把字符串强制转换为修订号。category 只允许唯一11类；release/额外请求字段/非法 shape 返回400。无会话401，缺权限403，未安装/禁用404，过期版本/草稿、空差异或不合格回滚409；未知底层故障由既有 ManagementAccess 安全映射为503。

## ScopedConfig、事务/CAS 与回滚

没有新增模型或迁移。现有 ScopedConfig 的 `(scope,scopeId,pluginCode,configKey)` 唯一键足够；scope 固定 project，scopeId 为可信当前环境 ProjectProfile.id，pluginCode 固定 mbti-config。三个内部 key 空间为 `release.draft`（完整候选 JSON及独立修订）、`release.active`（唯一快照 key 指针及生效版本）、`release.version.<uuid>`（只创建不更新的发布快照，version 对应发布序号）。全部 sensitive=true/isPublic=false/valueType=string；聚合里只含获批形态的引用，不含密钥值。通用 ConfigurationService 不承认这些 key，不能通过通用 upsert 改写快照。

published read 不读取草稿，其 expectedDraftVersion 固定0、diff为空；保存草稿不会改变整个 published 投影或因坏草稿导致生效读取失败。草稿 read 不初始化、不写表；save 仅更新 draft，并在既有 ConfigurationChange + AuditLog 记录类别名，不改变 active 或历史。draft CAS 依赖修订号及带 version 条件的 update，首次 create 受唯一键和共享事务锁保护。没有空草稿写入。

publish 通过既有 ManagementAccess.write 事务及其数据库本地管理员写锁，与同项目 lifecycle 锁组合；重新检查当前权限、启用、expectedDraftVersion、expectedVersion 和非空语义差异。事务先 create 新快照，再对 active 执行带当前 version 的 updateMany CAS（必须 count=1），首次发布则唯一 create active；同事务写 AuditLog 和指向 active+version 的 ConfigurationChange。后者现有 `(configId,configVersion)` 唯一约束防重复历史。发生 CAS/审计/历史写入失败，快照、指针和审计均回滚，不自动重试。两个会话持同一旧版本仅一个成功，另一个409；这里已有替身/隔离HTTP证据，**尚无真实 PostgreSQL 并发证据**。

ConfigurationChange 仅存 snapshotKey/previousVersion/rollbackOf/类别数组；不是第二套审计或版本表。新版本快照只允许通过插件发布创建，不提供更新/删除快照的路由。snapshot、active 与审计可按版本互相核对。

rollback 从同作用域可用历史快照复制内容，作为新的发布序号，走同一 commit/CAS/audit 流程；不重用旧版本号、不修改旧快照。它不触碰 draft 行，保留回滚前更新的未发布草稿及修订；后续 draft/live diff 继续反映差异。回滚到相同内容也409。没有读写 MBTI 结果、订单、权益、成交规则或旧投影；C2 后续消费不能从本次候选推断历史兼容已验。

## SecretRef 与审计脱敏

引用只复用 parseSecretRef/assertOwnedRef 与 SecretReference 元数据（active、未删除），namespace 受 mbti-foundation/当前环境限制；没有注入或调用 resolveTrusted、configuredTrusted、provider、商户或 webhook 客户端，没有读取真实环境密钥。元数据存在不代表真实模型已配置，mode 仍 UNCONFIGURED。

即使平台超管读取草稿/当前/历史，credentialRef 也从响应移除；保存投影中可见的 AI 参数但省略 credentialRef 时保留既有绑定，避免无意清除。正式清除/商户族映射未新增，继续待 owner 决策。未在 UI 提供凭据或引用输入。没有原图/文件名/私有答案/订单数据 fixture。

所有审计写入复用 ManagementAccess.audit；只写已知类别名，不记录 before/after、自由说明、JSON或引用。现有 audit-redaction owner 增加 mbti_draft_saved/mbti_published/mbti_rollback 三个已知 action，并共用唯一类别常量允许字段名；correlation/私有数据仍按原规则脱敏。插件的变更索引不暴露原始审计 payload，平台完整日志继续由原 AuditQueryService 和 admin.log.read 管理。

## 实际验证命令与结果

环境 Node `v24.21.0`、pnpm `10.0.0`。命令 cwd 为 aij-foundation（另注 admin）。依赖均安装在本仓，没有链接原 owner 或上游 node_modules。Prisma generate 的既有安全脚本使用 port1 编译占位且不读 env/不连库，不是迁移或数据库验收。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit0；锁文件未改，依赖脚本按现有策略忽略 |
| `pnpm --filter @aij/api prisma:generate` | exit0；只生成当前 schema 的客户端，无数据库连接 |
| `pnpm --filter './packages/**' build` | exit0；补齐 workspace dist，随后进行 typecheck/test |
| `pnpm lint` | exit0 |
| `pnpm typecheck` | exit0，API src/test 与 Foundation web 均检查 |
| `pnpm test` | exit0；97个 scripts/test + 93个 API 测试通过，其中 C1 10个 |
| `(cd apps/api && node --test -r ts-node/register test/mbti-config.test.ts)` | exit0，C1 10/10；测试使用实际 owner + 事务替身和本机 ephemeral HTTP |
| `node --test scripts/verification/plugin-manifest.test.mjs` | exit0，15/15 |
| `pnpm build` | exit0；workspace packages、Nest API、Next web，含 `/plugins/mbti-config/settings` |
| `cd ../admin && pnpm lint && pnpm typecheck && pnpm test && pnpm build` | exit0，57/57既有运营UI测试，生产构建通过；consumer 仍 unavailable |
| `node --test scripts/verification/plugin-manifest.test.mjs scripts/verification/configuration-schema.test.mjs` | exit1，38/39；唯一失败为导入遗留配置关系白名单未列 ClientAuthSession.personalScriptRuns→AiPersonalScriptRun；不是 C1 schema 变更 |
| `git diff --check` | exit0 |

初次在 workspace 包尚未 build 时 typecheck/定向test 报缺 dist；补齐依赖产物后修复。开发中定向测试暴露过 fixture 路径、题目 index 和 Nest fixture 认证注入问题，均在最终通过前修正。build 会重建 dist，因此最终验证不与依赖这些输出的测试并发执行。

遗留 schema 断言的当前 schema 与 `HEAD` B5 基线 git blob 完全相同：`8fd18089c4d6e11ac8a395f1b76859ab29b92398`（`git rev-parse HEAD:aij-foundation/apps/api/prisma/schema.prisma` 与 `git hash-object` 一致）。没有为了变绿放宽上游历史测试或改 schema。optional 原数据库集成 `plugin-lifecycle-core`、`configuration`、`remaining-delivery.integration` 等需要旧 AF owner，均 NOT_RUN；仅将后者原有硬编码三插件断言更新为当前 whitelist 长度，未运行其中模型/数据库流程。

C1 的测试替身只实现 ScopedConfig / ConfigurationChange / AuditLog / PluginInstallation / PluginOperation、项目与权限/SecretReference 元数据访问，没有业务模型、系统菜单或角色授权写 owner。ManagementAccess、PermissionsService、PluginRuntimeAccessService、PluginLifecycleService 均用真实实现。事务替身串行提交、异常丢弃整份 pending state；它可证明业务事务调用边界，不能证明 PostgreSQL 的锁、回滚或跨进程持久化实现。

10个测试分别覆盖：可信装配/拒绝及 launch capabilities、幂等生命周期/项目环境隔离、11类实际原型字段/拒绝、草稿隔离/空差异/旧草稿、并发单胜者、CAS/审计/历史失败整笔回滚、回滚新版本/草稿与历史不变、权限投影/引用元数据和响应审计脱敏、未安装/停用所有服务拒绝、真实 Nest 路由401/403/400/200/404及重复初始化无副作用。HTTP fixture 仅替换认证 transport，不声称真实 Cookie/JWT/CSRF 登录通过。

## 待办、阻塞及停写交接

- **运行验收阻塞**：指定 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation` 原 test55437 owner 尚未恢复。没有接触其他库或已有账号/配置。需总控取得真实原 owner、marker、数据库归属、当前会话/角色及端口证据后，再补真实 DB install/enable/disable、跨会话 CAS、audit 原子性、重启持久化、Cookie/CSRF、两个浏览器与直接越权操作验收。
- **人审 unknowns**：Remy 确认候选字段/ID/角色、plugin 权限、商户/模型字段和 SecretRef 投影后，C2 才能定稿 adapter；本次未添加任何猜测 MBTI 权限或 grants。发布说明自由文本、商户凭据族、provider/model/gateway、公开用户投影均未定义。
- **C2/业务兼容未测**：根 admin/H5 尚未连接该配置源；旧业务默认/快照不改，不从服务候选证明新订单/测评采用新配置。B1/B2 blockers、真实图像/模型、收款/webhook、位置、指标和消息未解决。没有对外地址或真实验收账号可交付。
- **历史静态验证问题**：上述配置关系白名单1项失败保留，需原 owner 另行维护；C1 没有修改既有 Prisma schema 或迁移。
- 初始工作树除输入包外有大量 AppleDouble `._*` 未跟踪文件，Git 报 `._pack-…idx` 的 non-monotonic index 警告；未清理/修复 Git 元数据或把这些文件纳入提交。

精确路径提交只包含 mbti-config、必要 registry/lifecycle/launch/runtime/audit 适配、最小 Foundation web 入口、关联测试与本文/coverage。提交后停止写入，交由总控决定 C2 续派及真实 owner 恢复；worker 回执按未完成运行验收报告失败/阻塞，不把可编译候选当作整张验收通过。
