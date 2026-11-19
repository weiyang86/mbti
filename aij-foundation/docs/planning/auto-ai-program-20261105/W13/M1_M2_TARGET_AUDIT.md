# AF-185 · 复核基础管理与AI知识目标覆盖

候选只读审计；负责人接收 **PENDING**，所有目标验收 **NOT_RUN_BY_THIS_AUDIT**。14条中1条具备排入目标验收的实现与窄范围真实证据（REQ-004），其余13条PARTIAL；不从源码或历史PASS推导CODE_VERIFIED/AC通过。

## 固定边界与身份

- 工作区：`/Users/lei/orca/workspaces/aij-foundation/AIJ-W13-AF185`；Orca ID `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W13-AF185`，instance `e72aa08a-1bec-4900-a6ae-e5dcd3de267f`；注册parent为本仓库root。
- Task `task_7ac33d80ec3e`；Dispatch `ctx_fe4f1b53fe28`；Writer terminal `term_5da60ede-5977-4253-8e31-1c6a00f19b12`；coordinator `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 写前实际branch `weiyang86/AIJ-W13-AF185`；HEAD `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；`git status --short --branch`仅分支行、工作区干净；origin fetch/push均 `git@github.com:weiyang86/aij-foundation.git`；Orca baseRef为`origin/dev`。没有切分支或fetch。
- 当前产品只从`git ls-tree/git show 48e8d26ea1dcd67df65d316a0edfdec4bcb2d502`核验；worker基线旧HEAD不包含当前实现，不能把本候选当产品bootstrap。
- 冻结需求为`AIJ-REQ-20261105-R1`，freeze commit `1f6549fd192b9ababe8c9d911ae19df3abd510ff`；读sourceHead版本的基线、traceability、阶段AC与program。历史未授权文字保留历史，不覆盖连续实施授权。
- root例外只读`docs/planning/auto-ai-program-20261105/W13/audit-inputs.json`和188份精确approved report.json；输入SHA256 `852aa122dcb5eebb527081ccfc5182c41d658c5444f39b025273ce4163baa49b`。所有188份hash/PASS/schema/退出均一致；没有读取其他root源文件、raw日志、浏览器证明文件或凭据。

## 结论与优先顺序

基础管理、租户Membership、Run/Job/Trace、CSV/首次网页导入、私有七牛读取、Webhook受控投递均已有实际实现和有限真实PG/HTTP证据。核心差距仍是产品垂直能力：默认完整AI独立创建、手机OTP/个人空间、云写与组织附件、其他知识格式/刷新版本、语义检索接线、首批厂商能力实测、完整任务中心与全部真实通知渠道。

三项建议按价值排序：先将已有工作台闭合为当前制品真实浏览器+独立SDK前端AC-003；再让问答引用可打开当前授权原文；并行独立文件owner接入七牛私有上传。向量协议已有，不再建议重复协议卡；语义执行/版本化索引/重排回答是REQ-010后续必须关闭的产品子卡。

明确差量：`in_app`状态声称available，但生产registry只注册可选Webhook，不能按配置可用推定送达。此为已定位的运营事实不一致，修复须归通知owner；本审计没有证明新增critical安全/跨租户/数据丢失漏洞。

W12生产审计各severity为0，但仅保留Prisma6当前schema-only配置使用的deepmerge8窄例外，完整安全/发布PENDING。网页导入/来源UI及焦点修正版本记录存在，OS原生文件选取与真正hidden序列仍NOT_PROVEN；阿里云embedding/rerank始终configured=false，无host/SecretRef/admission/Trace预算/catalog/semanticRAG接线。

## 冻结需求与AC原文

以下逐字来自sourceHead的traceability；ID、目标、成功/拒绝场景不随本审计缩小。

| ID / AC | 能力及必须目标 | 成功场景 | 拒绝/保护场景 |
| --- | --- | --- | --- |
| REQ-001 / AC-001 | 独立部署：各产品独立代码消费、数据库、凭据、会话issuer、存储和验收；行业业务由独立插件持有。 | 在仓库外两个空目录独立安装同版制品并启动，业务数据/附件各归项目。 | A有效会话用于B被拒；不允许链接宿主源码、node_modules、上传目录或复用库。 |
| REQ-002 / AC-002 | 装配配置：创建默认完整AI标准版，兼容基础后台和自定义组合；已安装未配置、未启用、缺依赖、未交付区分展示。 | 三种组合生成可运行宿主；标准版提供已实现AI入口及准确待配置状态。 | 未实现能力不能伪装待配置；未知插件、缺依赖或跨项目配置拒绝。 |
| REQ-003 / AC-003 | 工作台与SDK：提供管理员后台、普通用户通用AI工作台及API/SDK，业务前端可只消费API。 | 普通用户从工作台提交/查看同一API任务；独立前端消费SDK获得相同权限结果。 | 匿名/无权限/其他成员访问任务被拒，UI隐藏不能替代API授权。 |
| REQ-004 / AC-004 | 管理员及系统管理：保留管理员、RBAC、后端菜单、字典、配置、密钥引用和脱敏审计唯一owner。 | 通过正式页面/API完成建号、授权、只读查询和目标审计。 | 合法会话正确CSRF写403且数据不变；撤权后下一请求拒绝。 |
| REQ-005 / AC-005 | 客户端身份：客户端支持用户名密码、手机号验证码；复用客户注册、邀请、改密、找回、会话与账号状态基础；具体管理员启用方式待配置。 | 客户用两种已配置方式登录，停用/改密后旧会话失效，身份关联规则明确。 | 错误/过期/重放验证码、撞库、跨产品Token均拒绝，发码受限流。 |
| REQ-006 / AC-006 | 个人与多组织：同一产品内可切换个人及多个组织空间，角色/资产/记忆/任务/额度按归属隔离；ProjectProfile不代替租户Membership。 | 同一成员在两个组织具有不同角色，个人资源及任务保留原归属。 | 客户端自报workspaceId不授予权限；停用成员/角色立即失效。 |
| REQ-008 / AC-008 | 统一附件与七牛：统一文件归属、用途、访问权限、存储位置；保留本地适配并新增七牛；公开与私有策略分别控制。 | 个人/组织通过同一接口上传下载，两种存储实现同一访问策略并校验内容摘要。 | 猜测对象key、跨组织/过期链接和越权公开私有附件被拒。 |
| REQ-009 / AC-009 | 多源知识导入：支持PDF、Word、Excel/CSV、图片、文本，网页导入和后续更新，业务插件经授权接口提供数据；文件上传与内容解析分别验收。 | 每类格式形成可追溯文档/版本；网页更新按版本入库，业务来源记录授权主体。 | 恶意文件、SSRF网址、越权业务API和解析失败不污染已发布知识。 |
| REQ-010 / AC-010 | 检索与引用：从词项检索升级为可配置向量化/重排，引用可追溯至可访问来源，知识权限贯穿入库、检索和回答。 | 基于合成数据检索命中预期来源，回答可打开对应文件或业务记录。 | 跨组织引用为0，无依据明确拒答；更换向量模型不能混用旧向量索引。 |
| REQ-011 / AC-011 | 首批模型能力：接DeepSeek及阿里云模型平台；覆盖文本/推理/代码、图片理解/生成/编辑、向量化/重排；能力逐项声明和实测。 | 按能力矩阵对两家可用模型执行真实小额成功/失败/用量样例。 | 不兼容能力不能只改URL冒充支持；模型不可用状态有明确原因。 |
| REQ-021 / AC-021 | 任务中心与可靠性：统一观察进度、中间结果、错误、用量、取消/重试/可恢复点；修复既有租约、健康及生命周期差量。 | 两个独立执行者竞争同一任务仅有效租约执行；故障可见并恢复，后续M4显示步骤。 | 旧租约/重入/停用期间写入和结果未知重试均拒绝，不能用历史PASS覆盖失败。 |
| REQ-033 / AC-033 | 全部通知渠道：站内信、邮件、短信、公众号/小程序、企业微信/钉钉/飞书、Webhook；模板、触发、定时、重试、记录和投递状态统一。 | 各适配渠道以已批准测试收件人完成发送并展示真实投递/失败状态；M1先打通短信登录所需渠道。 | 枚举和mock不能当投递成功；撤权、错组织、重复事件和未知结果不重复投递。 |
| REQ-039 / AC-039 | 唯一真值与权限复检：AI执行/成本、运行任务、支付交易、通知投递、文件、租户关系各保留唯一owner；上层组合而非复制账本。 | 端到端任务的配置/Run/Trace/Job/交易引用可关联，入口与执行时均按当前权限复检。 | 伪造上下文、旧权限快照、上游成功未知和重复消费者不得制造第二份真值。 |
| REQ-040 / AC-040 | 真实验收与运营状态：功能按实际页面/API/执行/账单/渠道验收；监控区分未配置、未启用、正常、降级、故障，保留失败证据。 | 新鲜候选制品跑成功/拒绝/恢复路径，人工操作能重现，运行状态与依赖实际一致。 | 旧报告、descriptor、配置VALID、页面HTTP200不能替代产品通过；失败不改断言伪绿。 |

## 逐条覆盖与完整关闭路径

证据中的SHA256均是sourceHead完整blob字节摘要；行号为该blob真实短区间。运行报告只引用approvedReports，步骤与其局限一并保留。源码负探针在apps/api/src、apps/web/app、packages文本代码中未找到phone/sms OTP登录、向量索引consumer；AliyunRetrievalProtocol仅类定义一处，生产NotificationProvider实现仅Webhook一处。负探针辅助定位，不能替代所有功能行为验收。

### REQ-001 独立部署 · PARTIAL

API/UI：主宿主Nest/Next可组合，私有@aij/base的materializeProject可解包外部源码；scripts/project/cli.mjs的create只生成配置，run仍借checkout。SDK：packages/sdk可私有打包消费。持久化：ProjectProfile与项目DB/issuer/cookie/storage命名空间独立；行业业务仍留插件owner。最新源码两套外部完整AI部署路径未由获准报告证明。

源码证据：

- `scripts/distribution/aij-base/src/runtime.cjs:19-40`；SHA256 `95d9345a539a219d25ce33bc279bc6c9442a9de3431cdb0897b256085febd2a7`。私有模板归档校验必需文件且拒绝链接/特殊文件。
- `scripts/distribution/aij-base/src/runtime.cjs:61-73`；SHA256 `95d9345a539a219d25ce33bc279bc6c9442a9de3431cdb0897b256085febd2a7`。materializeProject在独立目标解包真实模板，不是descriptor。
- `scripts/project/cli.mjs:297-312`；SHA256 `e22cade10b79effef47162a483bde404c4ffbc5fcf8ce892294cc296798cd867`。生成项目的projectId/namespace/issuer/cookie/storage均有独立配置输出。
- `scripts/project/cli.mjs:316-324`；SHA256 `e22cade10b79effef47162a483bde404c4ffbc5fcf8ce892294cc296798cd867`。开发run仍调用仓库run-app并以repositoryRoot为cwd，不能证明仓库外消费。

获准真实证据及边界：

- `.artifacts/verification/AF-074/run-GJUtqr/report.json`；SHA256 `01a064f39d4f101b78b56ecc205d6c831172d415fa8f437842168945e380deea`。two-project-real-http-db-file-and-auth-isolation: 1组真实双项目/独立PG卷及凭据、双API、独立文件、跨项目Bearer/Cookie拒绝。 **限制：**历史合成项目从checkout运行；不是当前制品两套仓库外完整AI安装。
- `.artifacts/verification/AF-078/run-RADvpK/report.json`；SHA256 `fbca5a13f6df8e0079ab7b94db69cf83a53d8a31acd53bd4de78bf3594727da0`。packed-consumer-host-real-database-http: 8节点：私有tarball外部物化、独立依赖、迁移、API/Web构建、readiness200/断库503/恢复200。 **限制：**单个历史Base consumer，Web HTTP200仅SSR；不证明最新源码双AI宿主或公开分发。

剩余场景/实现阻塞：

- AC-001正向：以当前制品摘要在两个仓库外空目录分别安装依赖、初始化、登录、文件及AI任务；历史单consumer与checkout双项目不能合并推导通过。
- AC-001拒绝：在相同最新制品的A/B上重验有效会话跨产品拒绝，以及源码/node_modules/存储链接和DB复用拒绝。

外部输入：O07影响公开分发许可；内部private制品双consumer验收可继续，不以公开许可阻断内部验证。；执行需要root独占构建/容器/DB窗口；本审计未使用该资源。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 先做独立双consumer当前制品初始化与身份/文件/任务一条纵向验收；失败按生成器或宿主唯一owner拆≤4h修正。
- 再以同一不可变制品关闭AC-001全部成功和拒绝场景，记录摘要与对象/数据库归属；公开发行另过O07。

### REQ-002 装配配置 · PARTIAL

API/UI：已有插件管理生命周期和后台菜单过滤；base开发后台可持久初始化。CLI：aij:project create默认base，ai-standard仅声明aij-ai和前置，run仍借checkout；无custom选择。SDK/持久化：插件安装真值PluginInstallation/PluginOperation，声明与实际安装分离。完整AI默认入口与五类状态缺统一产品表面。

源码证据：

- `scripts/project/editions.mjs:10-23`；SHA256 `a2a57f0e880e6319a6a7350a8b0b6988e590aad2fe175499a5cb112db585f29f`。只有base与ai-standard且默认base，插件列表固定匹配，尚无custom组合。
- `scripts/project/editions.mjs:26-39`；SHA256 `a2a57f0e880e6319a6a7350a8b0b6988e590aad2fe175499a5cb112db585f29f`。ai-standard声明依赖/关闭live gates；声明不是实际安装运行。
- `scripts/project/cli.mjs:206-222`；SHA256 `e22cade10b79effef47162a483bde404c4ffbc5fcf8ce892294cc296798cd867`。create写配置/README，明确不声称已安装或启用持久插件。
- `apps/api/src/menus/menu-availability.service.ts:4-20`；SHA256 `b2e3a2139cdce5a1b8f16e12ddb16b6cdb38f9be40116f41cbe3a925a3c5f571`。菜单可用性按真实路由白名单和enabledPlugins判断，只有布尔available而非完整运营状态。

获准真实证据及边界：

- `.artifacts/verification/AF-127/run-dJc2nm/report.json`；SHA256 `466a31506c408e43469f27bb0faae8c06d9af1bca6be6eda7ed7b600cabcb087`。project-editions-offline: 57个CLI/filesystem配置成功与拒绝，base/ai-standard、allowlist和凭据不继承。 **限制：**无DB/服务；未证明默认完整AI标准版或custom运行。
- `.artifacts/verification/AF-135/run-WDjoeb/report.json`；SHA256 `5556a99af9170a9739716dfa9667badd2a33c3cb6c7a1a09b73bcfccec560785`。persistent-base-real-http-and-reinitialization: 5节点真实持久Base后台四菜单/四页及业务API、重初始化保留数据/会话。 **限制：**Base专用开发宿主；不是三组合当前生成宿主。

剩余场景/实现阻塞：

- AC-002正向：默认ai-standard、base和custom三种真实可运行宿主；标准入口需实际装配和初始化。
- AC-002状态：逐项区分已安装未配置、未启用、缺依赖、未交付，不能将未实现embedding/渠道标为待配置。
- AC-002拒绝：未知插件/缺依赖/跨项目配置，在真实宿主初始化和页面上同时拒绝。

外部输入：无必须等待的外部产品输入；按root资源调度继续可独立完成的工作。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 在现有editions/CLI唯一owner中分为默认AI初始化纵向卡与custom可信组合卡；共享runtime/environment和依赖门root串行接线。
- 把安装/配置/启用/实现/依赖真实事实映射到一套状态API和页面，随后三组合在独立consumer验收AC-002；不以改默认字符串完成整条。

### REQ-003 工作台与SDK · PARTIAL

UI：管理员/auth/*、客户端/client/ai与/client/agents/[id]/run运行页。API：/api/client/ai/agents/:code/runs、runs/:id、run-requests/:key和个人Agent运行入口。SDK：createClientApi/createAiClient/createAiRunRecoveryClient及personal-agent-runs；runtime/persistence复用AiCenterRunService→RuntimeJob/AiAgentRun/Trace。工作台与API已有实际链，最新独立业务前端+原生浏览器同权限闭环仍缺获准报告。

源码证据：

- `apps/web/app/client/ai/page.tsx:1-5`；SHA256 `aa3da6de3da286a4dc75ebfe8a761a44700cc4597247d5df63e3b6d190a7b895`。普通用户AI工作台真实路由。
- `apps/api/src/plugins/aij-ai/ai-center-client.controller.ts:9-38`；SHA256 `41d293c3da57db9546e1f9eececb6e686399eefe1d8de1e24e1881ff0a7a1a15`。工作台任务提交与原key恢复走Workspace Guard/当前权限；提交显式执行开关。
- `packages/sdk/src/index.ts:16-38`；SHA256 `8da3478a810972d8d4f7fbfa27046666749705f35e6e2df3b012905e0873d141`。SDK实际fetch、cookie、workspace header及统一响应消费。
- `packages/sdk/src/index.ts:52-68`；SHA256 `8da3478a810972d8d4f7fbfa27046666749705f35e6e2df3b012905e0873d141`。公开SDK有实际Agent提交/读取/恢复和个人Agent接口。
- `apps/api/prisma/schema.prisma:1337-1369`；SHA256 `d93792ee299fa8dbf02af3104ada3a3fd01b24acd2683c914d6f62c4c01d1ca7`。AiAgentRun按project/workspace/member/idempotency持久化并唯一关联RuntimeJob。

获准真实证据及边界：

- `.artifacts/verification/AF-149/run-PtfoNo/report.json`；SHA256 `7ab03773c09d46fd849bc58194eefba875258b15a8b302364252a98ff3840183`。real-workbench-recovery-http-db: 5节点真实Cookie+SDK+workbench状态、丢失受理回复后同key GET，Job/上游各一次；原AF142八节点另回归。 **限制：**合成上游；状态模块+HTTP不是独立业务前端真实浏览器目标验收。
- `.artifacts/verification/AF-145/run-JJJxO2/report.json`；SHA256 `a28f20b093ac258d951d8ecfa43938b1f1c2b269f94f35811e687353f48829a5`。real-workspace-packed-consumers: 4节点：workspace与实际tarball消费、ESM/CJS runtime及严格types。 **限制：**包兼容性，不等于带会话独立前端权限一致。
- `.artifacts/verification/AF-169/run-MMOLnu/report.json`；SHA256 `aac5feedf0c5982db7477bb638407d7d24d23627082e6a41e4c4246b9eb73f73`。real-personal-run-page-http-pg-job-memory-recovery: 1组真实PG/API/Job/Trace/预算、compiledSDK+state、私有Agent执行与丢回复恢复/跨域拒绝。 **限制：**owned HTTP上游；报告步骤并非原生页面浏览器操作。

剩余场景/实现阻塞：

- AC-003正向：当前制品原生工作台提交/读取，与仓库外独立SDK前端读取同一个runId及相同权限/响应；native浏览器证据必须新鲜。
- AC-003拒绝：匿名、有效低权限、同空间其他成员、跨空间及撤权后读取/执行均由API拒绝且数据不变；验证页面切空间与丢回复只GET不另建Run。

外部输入：无必须等待的外部产品输入；按root资源调度继续可独立完成的工作。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 优先执行建议M12-WORKBENCH-AC（独立前端+真实浏览器+受保护PG纵向关闭AC-003）。
- 若真实页面发现缺陷交回对应Writer修复并重跑受影响成功/拒绝；通过只表示目标验收证据准备齐全，owner仍PENDING。

### REQ-004 管理员及系统管理 · READY_FOR_TARGET_ACCEPTANCE

API：/api/admin/users、RBAC角色/授权、menus、dictionaries、configuration、secrets、audit-logs分别由core唯一service持有。UI：/auth/admin-users、roles、dictionaries、configuration、secrets、audit-logs已有正式页。SDK：管理页使用现有管理API消费层，未发现独立管理SDK目标要求。持久化：SysUser/Role/Permission/Menu、Dictionary、ScopedConfig、SecretReference、AuditLog；执行时ManagementAccess/RBAC事务复检。实现与真实拒绝证据足以排入目标验收，READY只表示可执行AC。

源码证据：

- `apps/api/src/admin/admin-users.controller.ts:9-27`；SHA256 `6564c36fdfdb079ca3dc9ec2b712f77bfa8c1934735a378b1ea90062efcbaf2d`。管理员CRUD真实controller。
- `apps/api/src/rbac/permissions.service.ts:19-28`；SHA256 `2d2080cdc8a306da39e050cf365feea9f96da84317a4be79e60d2524a15bc45c`。权限每次查询当前active用户、角色和permission，字典只读兼容只限该能力。
- `apps/api/src/menus/menus.service.ts:31-39`；SHA256 `5508073ca994b2056195252f2c1a5c48c13e026be2b7f45e4750ce0d8aa6816e`。后端菜单按当前权限和已交付页面过滤。
- `apps/api/src/secret-center/secret-center.service.ts:35-55`；SHA256 `c536175cc425299830412388bc5a78665ee7a618fc0c14205862fc0f35d97844`。SecretRef元数据安全投影与服务端fresh解析，不缓存旧值或越权材料。
- `apps/api/src/audit-log/audit-query.service.ts:24-33`；SHA256 `82521f1c217c4d94f90fd21c94f610900ce1306a6fee22361bd69278d09dfa80`。审计查询统一projectAudit去敏。

获准真实证据及边界：

- `.artifacts/verification/AF-135/run-WDjoeb/report.json`；SHA256 `5556a99af9170a9739716dfa9667badd2a33c3cb6c7a1a09b73bcfccec560785`。dictionary-read-real-http: 7节点：正式API创建read/manage/empty用户，有效Cookie+正确CSRF六写403、逐次数据不变，停用/解绑/撤权下一请求拒绝及去敏审计。 **限制：**覆盖字典真实链；不等于当前整套管理员/角色/配置/SecretRef/审计浏览器AC-004。
- `.artifacts/verification/AF-037/run-6k2W5p/report.json`；SHA256 `c98b99325830573a8cb7a9e9788e4b28aa0579db774235109dfe7d451cc7efac`。secret-reference-management-page: 既有SecretRef管理页面与真实HTTP/PG权限边界验证。 **限制：**历史页面回归，不是本审计新运行或秘密值读取。
- `.artifacts/verification/AF-038/run-wRUGMB/report.json`；SHA256 `0f1d763a7df723a557206751d1349080d64559bff4e0baf54824dec116443f3a`。audit-log-management-page: 既有审计管理页面与真实HTTP/PG安全投影验证。 **限制：**历史证据，不代替当前制品目标验收。

剩余场景/实现阻塞：

- 以当前候选完整执行AC-004建号→授权→各只读页面/API→目标审计；字典一条PASS不能概括全部core owner。
- 对每个写能力使用有效会话和正确CSRF验证403、数据不变；撤销角色/权限后下一请求拒绝。
- 本审计未运行新鲜全量浏览器/PG验收，负责人接收保持PENDING。

外部输入：无必须等待的外部产品输入；按root资源调度继续可独立完成的工作。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 复用已存在ui2-users/roles、dictionary/configuration/secret/audit真实验收fixtures，root注册当前候选AC-004纵向矩阵。
- 只修真实失败的owner，完成页面/API与审计字段对照后交负责人；不重建第二管理体系。

### REQ-005 客户端身份 · PARTIAL

UI：客户login/register/verification/password-reset与会话入口已有；API：/api/client/auth的username/email密码登录、邮箱验证、改密/找回、logout/revoke-all。SDK：通用ClientApi可消费，无phone OTP方法。持久化：MemberUser、ClientSession、ClientAuthOneTimeToken、rate buckets；手机验证码签发/验证/手机绑定唯一身份、真实SMS provider均缺；现有成员增添不是邀请接受token流程。

源码证据：

- `apps/api/src/client-auth/dto.ts:4-31`；SHA256 `5a20e23dec722d6cd253cf76f4fadadc333acd7a776b46a3ba08963c8a8375b4`。用户名或邮箱互斥密码登录，注册仍仅email/nickname/password。
- `apps/api/src/client-auth/client-auth.controller.ts:18-49`；SHA256 `d99fa03f658435ca8cacbbc3ce8cb2edbd995dec77763a364ee6f9bfb98c5dc8`。实际注册、邮箱验证、密码找回和登录入口；没有手机验证码登录路由。
- `apps/api/src/client-auth/client-auth.service.ts:293-317`；SHA256 `2b8352d957154ae1436297cfff953dec754843d59f8e757ee549fc87aed3635b`。重设密码锁成员、消费一次性token并撤销旧会话。

获准真实证据及边界：

- `.artifacts/verification/AF-141/run-SXyCj3/report.json`；SHA256 `27256419d61b4e57ae785665bf9adbdb1c78cdbf04ae74fda124ba63d4f67c2a`。username-real-http-db-cookie-race: 17节点/16真实场景：username/email Cookie/me、歧义拒绝、状态/Origin、限流并发、撤权锁、审计回滚。 **限制：**未实现手机号OTP；username登录不证明username自助设置或邀请闭环。
- `.artifacts/verification/AF-085/run-W2jDGT/report.json`；SHA256 `30c3cafc165b6491c50762411ad61adf02a128688d19d499e06939385cbb5175`。password-reset-http-postgresql: 真实HTTP/PG一次性重设与旧会话撤销回归。 **限制：**邮箱令牌与测试通知不证明真实短信或邮件投递。

剩余场景/实现阻塞：

- AC-005两种方式之一手机号OTP完全缺：发码、绑定/登录、期限、错误/重放、账号/IP限流及隐私防枚举。
- username自助登记/修改与邮箱/手机号身份关联、邀请接受规则需要明确并实现；仅登录查询username不足。
- 在当前制品重验停用/改密失效、跨产品Token/撞库拒绝；真实短信发送/回执不能拿一次性邮箱token替代。

外部输入：O03：SMS供应商/账号/模板/批准测试号码与预算；管理员启用方式/身份关联产品规则。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 先补username唯一设置与身份关联、邀请接受，各自单卡复用MemberUser与session owner。
- 与REQ-033共享同一个真实SMS provider，另卡实现OTP签发/消费+UI；按AC-005重放/过期/并发/会话撤销全链验收，不复制通知账。

### REQ-006 个人与多组织 · PARTIAL

API/UI：/api/client/workspaces、context、roles/members及/client/workspaces可列出/切换多个Membership空间。SDK：通用workspace header由后端核验，personal资产SDK强制workspace。持久化：ClientWorkspace/Membership/Role与部署OrganizationProfile/ProjectProfile分开；个人Agent/Skill/Memory都保留workspace+member，没有真正personal-space种类/自动唯一个人空间或组织共享资产/记忆/额度全链。

源码证据：

- `apps/api/prisma/schema.prisma:328-352`；SHA256 `d93792ee299fa8dbf02af3104ada3a3fd01b24acd2683c914d6f62c4c01d1ca7`。ClientWorkspace具创建者/角色/成员关系，但没有personal/organization类型或个人空间唯一约束。
- `apps/api/prisma/schema.prisma:414-436`；SHA256 `d93792ee299fa8dbf02af3104ada3a3fd01b24acd2683c914d6f62c4c01d1ca7`。Membership按workspace/member唯一，role采用workspace复合FK，独立于ProjectProfile。
- `apps/api/src/client-workspaces/workspace-context.service.ts:26-40`；SHA256 `8acb86c7108fbc7adead9528515f8dc3ebc4e9884785b9b1c6b0ed2861844467`。写事务锁住当前成员/用户/空间/角色/权限，客户端workspaceId不是授权来源。
- `apps/api/src/plugins/aij-ai/ai-personal-agents.service.ts:33-48`；SHA256 `35164b1bc8b992b1ecf83e16002140ebbcb7b506c43abe399a66266cf48a3858`。个人Agent仍以workspace+member为归属并复检当前workspace权限，不能当作个人空间实现。

获准真实证据及边界：

- `.artifacts/verification/AF-058/run-dDaFKo/report.json`；SHA256 `5cad185dd8ab9e7d80a63cc1b09e8abb8bf02a09d8224bf69a40613139d054db`。workspace-browser-http-database: 既有Workspace多账号/跨租户真实HTTP/PG回归。 **限制：**该报告名含browser，但具体命令范围需区分；不推导独立个人空间、团队资产/记忆/额度全部完成。
- `.artifacts/verification/AF-169/run-MMOLnu/report.json`；SHA256 `aac5feedf0c5982db7477bb638407d7d24d23627082e6a41e4c4246b9eb73f73`。real-personal-run-page-http-pg-job-memory-recovery: 真实个人Agent workspace/member归属、旧scope/其他成员/只读拒绝及原任务恢复。 **限制：**个人资产的双归属不等于个人空间及多个组织额度/团队共享模型。

剩余场景/实现阻塞：

- AC-006正向：同一人个人空间+两个组织不同角色，资产/记忆/任务/额度在切换前后归属不漂移；目前多Membership与个人资产只是部分。
- AC-006拒绝：伪造workspaceId、停用成员/角色下次请求及执行时复检，补组织共享资产与额度相同矩阵。

外部输入：无必须等待的外部产品输入；按root资源调度继续可独立完成的工作。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 先定义并迁移唯一个人空间与组织Workspace判别，复用Membership，提供真实选择器与所有资源owner兼容路径；不能以ProjectProfile代替租户。
- 分组织资产/记忆、额度付款归属和运行切空间三条纵向小卡；整条最终用同一成员+两个组织+个人空间跑AC-006。

### REQ-008 统一附件与七牛 · PARTIAL

UI：/auth/files仅管理员列表/下载；sourceHead没有/client/files路由，客户统一附件上传/管理页面尚缺。API：/api/client/files上传/列表/下载/删除，个人本地写删；读取通过FileContentService→StorageReaderRouter→local或受信七牛read profile。SDK：通用API可请求文件，未有公开/组织统一完整文件SDK。持久化：FileAsset唯一owner并校验size/SHA256；七牛private adapter可调用但product upload/delete未接线，组织授权、public/private及过期外链完整策略缺。

源码证据：

- `apps/api/src/files/client-files.service.ts:64-76`；SHA256 `6eabf5008132cc7e396cbee428ce805eef4e4137c754d376ba0c432f66cfea9b`。统一客户端上传写storageType=local/workspaceId=null/owner=user。
- `apps/api/src/files/client-files.service.ts:139-159`；SHA256 `6eabf5008132cc7e396cbee428ce805eef4e4137c754d376ba0c432f66cfea9b`。删除补偿明确local-only，云/未知类型拒绝，不能称云写删已接入。
- `apps/api/src/files/files.module.ts:9-18`；SHA256 `bc5cca11e93311e267c121c6658dad6425f5f1b8e7709de70154e549e4cb2ec8`。模块用唯一local owner、StorageReadProfile和读取路由。
- `apps/web/app/auth/files/page.tsx:1-5`；SHA256 `57278992d435de2e927d4bbc368420a9f85c5daad3a84012e3291d5d1d34d56d`。仅管理员附件页实际路由；客户端统一附件页在当前路由树不存在。
- `apps/api/src/files/qiniu-storage.adapter.ts:74-94`；SHA256 `04dce045abe28acfc3ca252813052917d81742714156bfd74fb4b5b61ed7dd58`。私有七牛完整协议适配器存在但注释和装配明确写入未接入FilesModule。
- `apps/api/prisma/schema.prisma:889-917`；SHA256 `d93792ee299fa8dbf02af3104ada3a3fd01b24acd2683c914d6f62c4c01d1ca7`。FileAsset为统一元数据owner，已有project/workspace/storage/checksum字段。

获准真实证据及边界：

- `.artifacts/verification/AF-153/run-RK5GIk/report.json`；SHA256 `0cbd4ae03fa71caef8790880878876152a03c439ee53256fd2cb705917a4fdd9`。real-profile-secretref-attachment-http-db: 10节点真实PG+FilesModule+SecretCenter+HTTP：七牛签名/摘要/私有读取、成员拒绝、错误/轮换/跨项目ref和不可变metadata。 **限制：**owned synthetic transport；不能证明真实七牛，也没有统一API七牛上传/删除或组织/public策略。
- `.artifacts/verification/AF-147/run-RWlHYj/report.json`；SHA256 `660eee4bfd9bea558a6f115aa00bf04796f3bc8e8e044a3b0fbabf7b2d6290d3`。actual-qiniu-https-and-local-regression: 56节点私有签名/adapter/owned HTTPS边界与本地回归。 **限制：**无真实云厂商；协议适配器write/remove未等于产品可用。
- `.artifacts/verification/AF-143/run-XKUsfb/report.json`；SHA256 `49807275c0da865c374b6c419f8d177679f3afb18d400b3cd2a2b8a2d117adca`。file-view-http-db-filesystem: 11节点真实个人附件HTTP/PG/本地字节校验、401/403/跨项目404/损坏503/删除。 **限制：**本地个人owner范围；不是组织或公开链接验收。

剩余场景/实现阻塞：

- AC-008两存储同一接口上传下载：目前仅local上传，七牛读取已有；云上传/安全失败补偿/未知结果核对仍缺；客户端统一附件上传/管理页面尚缺。
- 组织文件Membership授权与个人同策略、public/private分别配置、猜key/跨组织/过期链接拒绝尚缺全链。
- 真实七牛账号/私有桶上传→下载摘要→受控删除验收未有获准PASS。

外部输入：O01不涉及七牛；云验收另需七牛region/private bucket/domain/合法SecretRef、合成对象配额与预算。；云策略/尺寸/公开用途按O05明确；本审计不读取实际配置或访问对象。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 先执行建议M12-QINIU-UPLOAD，只关闭个人私有七牛统一上传/读取这一纵向切片。
- 后续独立小卡接云删除/未知结果对账，再接组织文件Membership授权与public/private链接策略；最终同一API两种存储跑全AC-008。

### REQ-009 多源知识导入 · PARTIAL

API：/api/client/ai/knowledge/documents/import支持txt/md/csv，import-web及:id/web-source持久化私有来源；PATCH采用expectedUpdatedAt原行编辑/启停。UI：/client/knowledge文件导入、网页确认与来源核对；SDK createKnowledgeWebImportsClient。Runtime：直接有界reader/parser+事务，不新建任务账。持久化：AiKnowledgeDocument正文/文件名/摘要/URL/extractor版本单行，上传与解析不是FileAsset全文档中心；PDF/Word/XLSX/图像OCR、网页刷新历史版本、业务授权数据源端口均缺。

源码证据：

- `apps/api/src/plugins/aij-ai/ai-knowledge.service.ts:141-153`；SHA256 `8413a4f74f65f40e32cf75a5b2b6cb073eaf4e4bf9050c9ad2e92f1412c85fe6`。网页导入经过当前权限检查，抓取解析后复用同一createDocument。
- `apps/api/src/plugins/aij-ai/ai-knowledge.service.ts:186-220`；SHA256 `8413a4f74f65f40e32cf75a5b2b6cb073eaf4e4bf9050c9ad2e92f1412c85fe6`。网页正文/来源原子写入且默认inactive；非不可变历史版本集合。
- `apps/api/src/plugins/aij-ai/ai-knowledge.service.ts:235-245`；SHA256 `8413a4f74f65f40e32cf75a5b2b6cb073eaf4e4bf9050c9ad2e92f1412c85fe6`。仅txt/md/csv文件解析被允许，PDF/Word/XLSX/图片解析明确不在当前入口。
- `apps/api/prisma/schema.prisma:924-948`；SHA256 `d93792ee299fa8dbf02af3104ada3a3fd01b24acd2683c914d6f62c4c01d1ca7`。知识来源URL/正文摘要记录在单Document行，updatedAt并发版本没有历史版本表。
- `docs/execution/AF-182.md:13-19`；SHA256 `d3857c0c3409820c92af57ee043f2ff04806dd1a9fd84a76beaa1df858301940`。W12记录真实浏览器修正与OS picker/hidden序列NOT_PROVEN；明确无网页刷新/向量承诺。

获准真实证据及边界：

- `.artifacts/verification/AF-146/run-AISxB7/report.json`；SHA256 `442e632f11af2c38e73f27fba1ef108717517eb6b92efc6499b67f4bb6179894`。real-csv-multipart-http-db: 31节点真实multipart/PG quotedCSV/txt/md、来源摘要、权限/CSRF/租户、解析失败零domain写入。 **限制：**上传字节解析只覆盖三文本格式，不证明PDF/Word/Excel/图片或原附件留存。
- `.artifacts/verification/AF-182/run-18ksmf/report.json`；SHA256 `09f238e169c6337c308495cd5f2198785ee23fa95173bd2180fcdc69beb24261`。actual-web-ui-backend-protected-pg-tls-sdk: 9节点最新protectedPG/HTTPS reader/default parser/SDK，inactive原子来源、13种IO后撤权及审计回滚。 **限制：**owned TLS；非公开网络；该报告本身不含原生OS选择/真实hidden事件证据。

剩余场景/实现阻塞：

- AC-009正向各格式：PDF、Word、Excel(.xlsx)和图片内容解析缺；CSV不是Excel解析，FileAsset上传不是知识解析。
- 网页后续更新需不可变历史版本/当前发布指针及并发冲突；当前PATCH覆盖行和来源不一致提示不构成版本更新。
- 业务插件需授权主体/来源/字段范围的受控供数接口，当前Connector/Webhook不等于知识来源。
- 恶意/超限/损坏格式解析零污染、网页SSRF/撤权后IO零写、越权业务API必须逐源验；W12 native OS picker与真实hidden生命周期仍NOT_PROVEN。

外部输入：O05：每种文件尺寸/格式子集、OCR/扫描PDF范围和parser依赖许可/资源边界。；业务供数插件的授权范围与合成样本；无需等待真实客户数据。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 保留txt/md/csv/首次网页导入，按PDF文本、Word、Excel、图片OCR分别做可见上传→解析→inactive→显式启用纵向小卡；各有损坏/超限拒绝。
- 网页刷新历史版本与业务授权来源各独立小卡；最终全格式/来源按AC-009矩阵验收，native picker/hidden只在可操作环境补真验。

### REQ-010 检索与引用 · PARTIAL

API/UI：knowledge/query与questions及问答页仍词项检索+excerpt引用；管理者可核对web-source，普通knowledgeQuery引用不可直接打开原文。SDK：网页导入/通用API存在，语义检索SDK/配置不存在。Runtime/persistence：AiKnowledgeDocument/AiKnowledgeQuestion→Job→Trace；AliyunRetrievalProtocol只有独立类，没有import consumer、向量字段/索引版本/模型迁移、重排编排或对账接线。

源码证据：

- `apps/api/src/plugins/aij-ai/ai-knowledge-retrieval.ts:68-91`；SHA256 `352bcbac1c9a6f1b7f8ab6f7cd96bb2234da4ce14590e1d01f5d55812cba8375`。现有算法为词项覆盖阈值/排序/摘要引用，不是embedding或rerank。
- `apps/api/src/plugins/aij-ai/ai-knowledge.service.ts:341-365`；SHA256 `8413a4f74f65f40e32cf75a5b2b6cb073eaf4e4bf9050c9ad2e92f1412c85fe6`。查询当前workspace active文档，以contains词项选候选，再用词项检索函数。
- `apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts:4-15`；SHA256 `8d6bddc9b4e828b816b30b4e6f9a33fd5a1d3bc147d578a23761637070087be0`。阿里云native协议固定模型/region，configured=false。
- `apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts:177-192`；SHA256 `8d6bddc9b4e828b816b30b4e6f9a33fd5a1d3bc147d578a23761637070087be0`。protocol无env/registration/SecretRef/ledger/retry/failover，没有产品接线。
- `apps/web/app/components/client-knowledge-questions-page.tsx:159-162`；SHA256 `427eebc46dc25abb10cc187bcbc63cb46fdd2bf32acdc686de629fd4a132028a`。当前引用仅title/code/excerpt文章，没有点击打开来源链接。

获准真实证据及边界：

- `.artifacts/verification/AF-111/run-Ai70Jh/report.json`；SHA256 `b1496e87e05f0393b64a65fdd08b1896751bcaca6cbe43e78a4f81f6dc071484`。real-http-postgresql-evaluation: 既有20例合成知识问答/跨workspace真实HTTP/PG评测。 **限制：**词项和离线问答；不证明语义召回/向量模型变更隔离。
- `.artifacts/verification/AF-138/run-v2GC3z/report.json`；SHA256 `2399125ced990102fd0921528b7c1642e5e35e757ab798f00b97eb6678deddbf`。knowledge-fences-real-database-http-locks: 23节点当前成员/插件事务锁竞争、真实审计失败回滚及零越权写。 **限制：**写入权限围栏，不等同完整向量索引及回答来源授权。
- `.artifacts/verification/AF-183/run-k8z7Ix/report.json`；SHA256 `84c24a87a9f01e7b6d3e1c5701a273c76d5e62828519d8c8684e0d651757d668`。whole-api-compiled-native-retrieval-protocol: 15节点whole API compiled协议测试。 **限制：**configured=false；缺host/SecretRef/admission/Trace预算/catalog/semanticRAG，绝无paid vendor或索引证据。
- `.artifacts/verification/AF-183/run-k8z7Ix/report.json`；SHA256 `84c24a87a9f01e7b6d3e1c5701a273c76d5e62828519d8c8684e0d651757d668`。actual-original-transport-owned-wire: 9节点真实原fetch transport+owned HTTP编解码/usage/abort/no retry。 **限制：**owned wire不是厂商；gzip缺trailer可被平台接受的已记录边界仍保留，不声称独立CRC完整性。

剩余场景/实现阻塞：

- AC-010正向语义命中：接入有权限的embedding/rerank执行与成本/预算owner、向量索引和配置；不能拿协议PASS当检索成功。
- 引用需可打开当前仍有权的文档版本/文件/业务记录；当前excerpt不是可访问来源入口。
- 负向：跨组织引用为0/撤权实时过滤、无依据拒答；更换模型隔离旧dimension/index并受控重建，必须真实PG/Job路径验证。

外部输入：O01：阿里云region/model准入、SecretRef、合成样本及小额预算，用于paid vendor验收；本地合成向量集/PG权限开发不被此阻断。；O05：chunk/批量/索引规模和延迟/资源上限，先给有限边界。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 先做建议M12-CITATION-OPEN，关闭可打开授权来源这一产品切片。
- 后续分同一aij-ai执行/预算/Trace下的检索host能力、版本化向量索引与重建、检索+重排+回答串联三张有产品结果的小卡；首卡若>4h先缩为一个固定模型/有限batch纵向结果，不再重复协议。
- 最后合成语义评测+两组织/撤权/无依据+模型切换索引隔离，连真实厂商小额usage核对跑全AC-010。

### REQ-011 首批模型能力 · PARTIAL

API/UI：AI中心后台模型/Provider/Agent配置、客户端text/JSON与compatible image.generate执行。SDK：createAiClient支持text/image表面；first-party DeepSeek/阿里云只final文本/JSON profile。Runtime/persistence：AiAgentRun/Job/Trace/预算真实复用；DeepSeek live默认关闭且需上游确认。图片理解/first-party生成与编辑、专项推理/代码能力矩阵、embedding/rerank产品host缺；协议/compatible URL不构成首批厂商能力实测。

源码证据：

- `apps/api/src/plugins/aij-ai/ai-vendor-profiles.ts:6-17`；SHA256 `595d7bb03934ae13ea99b934ff0ae7e9668ff058e6722b63a8e20026e2f493fb`。DeepSeek/阿里云官方固定base的文本/JSON profile，思考显式关闭。
- `apps/api/src/plugins/aij-ai/ai-vendor-profiles.ts:28-42`；SHA256 `595d7bb03934ae13ea99b934ff0ae7e9668ff058e6722b63a8e20026e2f493fb`。厂商profile只接text/JSON，阿里云只允许指定模型；不兼容能力明确拒绝。
- `apps/api/src/plugins/aij-ai/ai-center-provider.ts:45-60`；SHA256 `b2ee1a7532717ab2916c737e82b6c5dcffedf6f4844d2822e3dfa5774049a4e0`。执行开关/DeepSeek上游确认、图像为generations分支，不是理解/编辑。
- `apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts:4-15`；SHA256 `8d6bddc9b4e828b816b30b4e6f9a33fd5a1d3bc147d578a23761637070087be0`。embedding/rerank仅configured=false协议模型声明。

获准真实证据及边界：

- `.artifacts/verification/AF-150/run-gcNILC/report.json`；SHA256 `e8b509bb21303d0b36c69b7f9024296c967bba1f829515d54f3fb6fe31e92f07`。real-vendor-text-http-job-db: 7节点真实配置/SecretRef/Job/Trace/预算、DeepSeek/阿里云TEXT+JSON、429与20歧义unknown/reserved拒绝。 **限制：**官方URL映射到instance-owned synthetic transport；没有paid vendor/账单，reasoning/code专项未实测。
- `.artifacts/verification/AF-183/run-k8z7Ix/report.json`；SHA256 `84c24a87a9f01e7b6d3e1c5701a273c76d5e62828519d8c8684e0d651757d668`。actual-original-transport-owned-wire: 9节点阿里云native embedding/rerank请求响应经原fetch owned wire。 **限制：**无产品host/能力catalog/预算/SecretRef/真正厂商接入；不能据此认定向量或重排可用。

剩余场景/实现阻塞：

- AC-011逐能力两家可用模型的真实小额成功/失败/usage回执及账单核对全部未获准报告证明。
- 当前思考关闭，推理/代码专项边界、图片理解/生成/编辑均需明确provider协议和产物；不能以普通文本返回代码或compatible图片冒充全矩阵。
- embedding/rerank接线与索引参考REQ-010；不可用模型需原因/能力状态并对不兼容配置拒绝。

外部输入：O01：阿里云账号/region/model IDs/计量和DeepSeek真实凭据、批准合成输入/预算；O05各能力限制。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 先用现有TEXT/JSON链做两家真实小额目标验收，复用Trace actual usage并保留unknown，不先做第二执行账。
- 再按推理/代码、视觉理解、生成、编辑能力分别单卡，embedding/rerank与REQ-010共同交付；每项有产品入口、拒绝和厂商receipt。
- 最终按真实支持能力矩阵执行AC-011，缺模型/准入明确阻塞对应单元，不把整矩阵伪标完成。

### REQ-021 任务中心与可靠性 · PARTIAL

API：/api/admin/runtime/readiness/jobs/outbox与jobs/:id/retry|cancel、outbox/:id/retry；客户端可读取Run和原请求恢复。UI：/client/ai、个人Agent运行页显示状态/错误/预算，管理员usage/traces已有；没有统一跨类型步骤级任务页。SDK有read/recovery无通用cancel/retry中心。持久化/执行：RuntimeJob/Outbox/Scheduler/Idempotency唯一任务owner，nonce围栏与健康修复有真PG证据。节点进度/中间结果/可恢复检查点及安全客户端取消仍缺。

源码证据：

- `apps/api/src/async-runtime/runtime-admin.controller.ts:15-35`；SHA256 `f33ea806e0627cd5627504dd1204271ced45f17822322cb5918341297bd11b74`。管理员readiness/jobs/outbox及重试/取消真实API。
- `apps/api/prisma/schema.prisma:1174-1205`；SHA256 `d93792ee299fa8dbf02af3104ada3a3fd01b24acd2683c914d6f62c4c01d1ca7`。唯一RuntimeJob包含leaseNonce/attempt/owner/expiry与结果引用。
- `apps/api/src/async-runtime/runtime-health.service.ts:12-26`；SHA256 `d21dc1a091a2d063de119b11d3ed49f3a33c5eb01a0ca17c68cde1cc33f45fd5`。readiness依赖真实DB、worker/scheduler两新鲜心跳，启动/停用/故障区分。
- `apps/web/app/components/client-ai-workbench.tsx:139-156`；SHA256 `c26caf469515a86c35ca6b53604f64217963730113ce45bd0e78e27e2bb52bcb`。工作台显示终态/预算/到期及刷新，未有步骤/中间产物/客户端取消重试完整中心。

获准真实证据及边界：

- `.artifacts/verification/AF-157/run-3B4GX0/report.json`；SHA256 `060b0d75d6397948675dea38678fa0475f5e7fcb3c95e26434515df20e4767d7`。real-nonce-independent-pg-sessions: 8节点实际两个PG backend：重试新nonce、旧成功/失败/心跳零写、同claim单执行、生命周期门。 **限制：**证明该可靠性差量，不覆盖所有任务类型或完整用户任务中心。
- `.artifacts/verification/AF-137/run-ixzxnS/report.json`；SHA256 `16ad00f1323e7ef2f4c737f099c39197d42518c1bf7cadf2cc82b739dd364f17`。runtime-lease-drain-live-regression: 6节点独立pool SKIP LOCKED/租约到期/调度互斥/优雅drain。 **限制：**历史原worker回归；要与当前任务类型和UI组合新验。
- `.artifacts/verification/AF-139/run-lHPWqf/report.json`；SHA256 `1e5314d6ef0da12f6a2eeea51608ba50dd4d6e4ca011533ec63ffdbb7cb1fb0c`。readiness-real-startup-outage-recovery: 5节点真实启动503→200、断库liveness200/readiness503、两心跳更新后恢复、权限拒绝。 **限制：**无多步骤进度/检查点目标证据。
- `.artifacts/verification/AF-149/run-PtfoNo/report.json`；SHA256 `7ab03773c09d46fd849bc58194eefba875258b15a8b302364252a98ff3840183`。real-workbench-recovery-http-db: 原请求key丢回复恢复一次Job/调用。 **限制：**这是受理状态恢复，不是工作流检查点恢复。

剩余场景/实现阻塞：

- AC-021竞争与旧租约需在最终候选所有新增执行器回归，已有nonce/reentry修复不能替代新consumer验证。
- 任务中心补跨类型进度/错误/usage、用户取消和受控重试；当前admin只取消pending/retry，不应宣称运行中取消。
- 检查点恢复属于M4图引擎，原key找回不等于恢复执行点；未知结果必须保持禁止自动重发。

外部输入：无必须等待的外部产品输入；按root资源调度继续可独立完成的工作。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 复用RuntimeJob为所有任务索引/状态，先做用户只读跨类型任务详情与当前权限过滤纵向卡。
- 再分别做运行中取消传播/安全已知失败重试、步骤进度与持久检查点；跟M4真实执行依赖串行集成。
- 最终两独立worker+故障/恢复+撤权/停用+未知重试拒绝跑AC-021，保留历史失败和新鲜报告。

### REQ-033 全部通知渠道 · PARTIAL

API：/api/admin/notifications/status及channels/:channel配置，生产者调用NotificationDeliveryService写Outbox→RuntimeJob。UI/SDK：无各渠道统一运营投递页/客户端站内收件箱或专门通知SDK。Runtime生产只可选Webhook；凭据仍SecretCenter。渠道配置存在in_app/email/sms/wecom/feishu/webhook类型，但in_app registry为空而status声称available；公众号/小程序/钉钉与其真实provider缺，邮件/SMS/企微/飞书也未装配。

源码证据：

- `apps/api/src/plugins/aij-notification/notification-provider.ts:4-26`；SHA256 `98a62595bda93282fa42c6bbfcf9d5d2766ceea7e1d614a9615c667778765b3d`。渠道枚举只是port；未包含公众号/小程序/钉钉全目标枚举。
- `apps/api/src/plugins/aij-notification/notification-runtime.module.ts:13-25`；SHA256 `ec6c5ae84c7ccdcb1dfa1299eeb647f20372012de7c47a44e8641ec40efa2161`。生产registry仅按policy注册Webhook，否则空；没有in_app/email/sms/wecom/feishu具体实现。
- `apps/api/src/plugins/aij-notification/notification-delivery.service.ts:82-108`；SHA256 `8fc137d381e44f848d3e29d1185590d30accb9cb9cd1e1a3869a681ed175194e`。投递真值复用RuntimeJob，由Outbox幂等生成；Webhook maxAttempts1。
- `apps/api/src/plugins/aij-notification/notification-management.service.ts:51-56`；SHA256 `b8b4b025e676905a49b0840aa0564bf525d24177690e16e3db4102e91b881a79`。in_app元数据报告available/configured但registry无对应provider，属于配置状态不能当真可投递。

获准真实证据及边界：

- `.artifacts/verification/AF-155/run-D0PLoP/report.json`；SHA256 `707b4a87c370779be8a14e019a8162ad90fdb59028c8f7fa7afb723fd18e3106`。real-webhook-lifecycle-outbox-job-tls: 8节点真实生命周期/SecretRef/Outbox→Job→owned TLS HMAC、receipt/replay一次、未知永久围栏及五个停用gate零调用。 **限制：**无真实外部收件人或第三方回执，不能说全部渠道或真实Webhook投递已验收。
- `.artifacts/verification/AF-155/run-D0PLoP/report.json`；SHA256 `707b4a87c370779be8a14e019a8162ad90fdb59028c8f7fa7afb723fd18e3106`。notification-outbox-regression: 6节点原通知Outbox/Job/幂等/重试/停用真实PG回归。 **限制：**测试provider不构成短信、邮件或站内信生产投递实现。

剩余场景/实现阻塞：

- AC-033每渠道都需真实批准收件人发送并展示可核对的送达/失败；当前owned TLS Webhook仅合成接收。
- 首要修复status的available与实际provider缺失不一致；配置VALID不代表投递。
- 按渠道补模板/触发/定时/重试/当前租户撤权与结果未知不重发；组织范围/收件人授权、重复事件和真实receipt要逐项验。

外部输入：O03：各邮件/SMS/微信/企微/钉钉/飞书供应商账号、应用/签名模板、测试收件人、预算与渠道准入；Webhook批准endpoint。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 优先SMS与REQ-005共享一个投递owner；站内收件箱与现有RuntimeJob状态关联，单独交真实产品纵向卡。
- 邮件、公众号、小程序、企微、钉钉、飞书、Webhook各按有限单卡实现/真实小额验收；不会把枚举当adapter。
- 统一投递状态按实际provider/配置/安装/回执区分，补定时与失败/unknown保护矩阵，全部渠道才关闭AC-033。

### REQ-039 唯一真值与权限复检 · PARTIAL

持久化唯一owner：aij-ai的AiAgentRun/AiExecutionTrace与预算，AsyncRuntime的Job/Outbox/Idempotency，aij-payment的Order/Attempt/Transaction/Refund/Reconciliation，通知RuntimeJob投递状态，FileAsset附件，ClientWorkspace/Membership租户。API/UI/SDK上层以这些ID关联；个人Agent/记忆不复制执行账。Run预算估价不等于对客售价/钱包，PaymentOrder是支付轨道单而非行业订单。当前端到端真实收费任务与外部未知对账闭环未证。

源码证据：

- `apps/api/src/plugins/aij-ai/ai-center-run.service.ts:34-42`；SHA256 `b95651504ce5251196703f0e28b216a4f0ef623939ebd6f7c422195bf29bccd6`。Run服务消费现有Job/Trace/预算/SecretRef/workspace owner。
- `apps/api/src/plugins/aij-ai/ai-center-run.service.ts:222-227`；SHA256 `b95651504ce5251196703f0e28b216a4f0ef623939ebd6f7c422195bf29bccd6`。在同一围栏事务复用AiExecutionTraceService，不复制成本实现。
- `apps/api/prisma/schema.prisma:1337-1369`；SHA256 `d93792ee299fa8dbf02af3104ada3a3fd01b24acd2683c914d6f62c4c01d1ca7`。Run唯一jobId、当前member/workspace与文件引用，保存预算状态并不等于现金钱包。
- `apps/api/src/plugins/aij-notification/notification-delivery.service.ts:82-108`；SHA256 `8fc137d381e44f848d3e29d1185590d30accb9cb9cd1e1a3869a681ed175194e`。通知状态以唯一RuntimeJob查询，Outbox幂等关联。
- `apps/api/src/client-workspaces/workspace-context.service.ts:26-40`；SHA256 `8acb86c7108fbc7adead9528515f8dc3ebc4e9884785b9b1c6b0ed2861844467`。当前成员/角色/grant行锁复检，拒绝旧快照扩权。

获准真实证据及边界：

- `.artifacts/verification/AF-169/run-MMOLnu/report.json`；SHA256 `aac5feedf0c5982db7477bb638407d7d24d23627082e6a41e4c4246b9eb73f73`。real-personal-run-page-http-pg-job-memory-recovery: 实际Run/Job/Trace/预算关联、一次调用和撤权拒绝。 **限制：**合成上游；不能证明现金账/真实支付/全部业务跨owner链。
- `.artifacts/verification/AF-155/run-D0PLoP/report.json`；SHA256 `707b4a87c370779be8a14e019a8162ad90fdb59028c8f7fa7afb723fd18e3106`。real-webhook-lifecycle-outbox-job-tls: 实际Outbox→Job→receipt once及永久unknown围栏。 **限制：**owned TLS不证明真实外部通知事实。
- `.artifacts/verification/AF-107/run-R0KPxw/report.json`；SHA256 `6403b059b9f806117bbb86e2600b81843f22105cf55cff2aabe2e70b3b838e32`。payment-reconciliation-http-postgresql: 合成支付轨迹/对账差异队列/人工处理审计，回调不覆盖核实交易。 **限制：**合成provider，不是商户资金/完整对客定价结算或业务订单。

剩余场景/实现阻塞：

- AC-039完整配置/Run/Trace/Job/交易引用与当前权限入口/执行复检，在真正收费任务上还缺对客价格/支付关联纵向场景。
- 跨consumer伪造上下文/旧权限/重复投递/上游成功未知不得产生第二真值，需要对新增知识语义/云写/渠道重复执行矩阵。

外部输入：真实计费/支付场景受O01/O02/O04及小额资金授权输入限制；静态唯一owner和合成并发回归可继续。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 在每张新功能卡中固定引用既有owner与ID，列事务复检/unknown/幂等真实拒绝，不新开总账。
- 与计费/支付任务的正式集成依赖汇合，再在当前候选跑一次跨模块AC-039；不得用工程预算表替代现金/对客价格。

### REQ-040 真实验收与运营状态 · PARTIAL

API/UI：Runtime readiness、插件安装/菜单可用性、AI/通知配置/usage/traces分散展示。SDK及verify:product可绑定HEAD/sourceDigest但catalog不是40目标全矩阵。现有报告真实且窄范围，W12安全all severities0保留Prisma6窄例外；不是target acceptance。状态未统一：通知in_app configured/available却无provider，editions只required声明，阿里云retrieval configured=false。持久化保留Run/Trace/Job/operation/audit失败事实，owner acceptance全待。

源码证据：

- `apps/api/src/async-runtime/runtime-health.service.ts:12-26`；SHA256 `d21dc1a091a2d063de119b11d3ed49f3a33c5eb01a0ca17c68cde1cc33f45fd5`。runtime真实DB/worker/scheduler readiness与状态原因。
- `scripts/verification/product/runner.mjs:33-41`；SHA256 `ec2afa8a7a9b8e49b836ed5d815c69f722f3997692ca44dfec0448c02c57a2fc`。产品验证入口记录HEAD/branch/dirty/sourceDigest。
- `scripts/verification/product/runner.mjs:53-64`；SHA256 `ec2afa8a7a9b8e49b836ed5d815c69f722f3997692ca44dfec0448c02c57a2fc`。门禁校验有node-test且拒绝skip/optional，无空成功占位。
- `apps/api/src/plugins/aij-notification/notification-management.service.ts:51-56`；SHA256 `b8b4b025e676905a49b0840aa0564bf525d24177690e16e3db4102e91b881a79`。配置available仍可与真实provider缺失冲突，当前未统一运营语义。
- `docs/execution/AF-181.md:11-17`；SHA256 `95ee16642c67af88a30b59f1e4b2d182ad82336ba5d67a4ef369679e427de071`。W12全生产审计各级0与浏览器运行记录，仍明确安全发布/负责人PENDING。
- `docs/execution/AF-182.md:13-19`；SHA256 `d3857c0c3409820c92af57ee043f2ff04806dd1a9fd84a76beaa1df858301940`。W12焦点修正已记录，OS picker和真实hidden生命周期仍未证明。

获准真实证据及边界：

- `.artifacts/verification/AF-139/run-lHPWqf/report.json`；SHA256 `1e5314d6ef0da12f6a2eeea51608ba50dd4d6e4ca011533ec63ffdbb7cb1fb0c`。readiness-real-startup-outage-recovery: 当前可靠性真实故障/恢复与401/403，区分liveness/readiness。 **限制：**范围是Runtime/DB健康，不覆盖所有配置/渠道/账单。
- `.artifacts/verification/AF-181/run-iIimMi/report.json`；SHA256 `46b896b554d748ae8e6b230268d0e803d5f66a1eba5abbe4c914166498b7c37d`。actual-all-production-critical-high-zero: 实际全production审计、安装目标/原hash/HEAD时间门及critical+high0；版本化记录报告各severity0。 **限制：**Prisma6 config→deepmerge8仅当前schema-only配置用途兼容例外；非广泛API兼容/完整安全/发布验收。
- `.artifacts/verification/AF-182/run-18ksmf/report.json`；SHA256 `09f238e169c6337c308495cd5f2198785ee23fa95173bd2180fcdc69beb24261`。actual-web-ui-backend-protected-pg-tls-sdk: 最新知识网页导入真实protectedPG/TLS/SDK与撤权/回滚。 **限制：**非paid vendor，native OS picker/true hidden sequence未证明；报告外原生证据未获准读取，不能追加PASS。

剩余场景/实现阻塞：

- AC-040要求当前新鲜制品全产品成功/拒绝/恢复矩阵；188份历史PASS不能合成为40目标通过。
- 实际页面/API/执行/用量账单/真实渠道逐项核对；默认未配置/未启用/正常/降级/故障/未交付必须来自真实实现与依赖。
- 真实OS文件选择/取消及hidden→foreground清理序列尚NOT_PROVEN，不能用CLI upload、visible tab switch或组件测试代替。
- 安全0发现仅当前锁文件与限定Prisma配置兼容，不能扩张为全面安全发布或取消原失败记录。

外部输入：各能力真实厂商/渠道/付款/许可输入与最终Linux环境；仅阻断依赖该输入的场景。；原生OS辅助功能可操作能力是picker真验外部环境条件，本任务不改系统权限。

整条需求关闭计划（以下子项未注册，不冒充Task ID）：

- 将本审计14条与其他分区合并为冻结40目标矩阵，执行当前制品的每一成功/拒绝/恢复路径而非另设十道协议流程。
- 先关闭已可运行的AC-003/004纵向，再随产品小卡补各缺口、状态及真实厂商/渠道；矩阵每格引用限定PASS与未运行项。
- 失败保留并交原Writer，最后root做exact source/report校验与owner review；全部目标证据具备仍由负责人接收。

## 至多三项下一卡建议

这三项均为本地proposal，未注册、未在本审计执行。相互candidate allowPaths不重叠，shared wiring只由root串行接收；所有小时包含root验证/接线/记录，不将整条大型需求塞进一张卡。新增脚本是待实现并登记命令，现有build命令也没有在本worker执行。root正式verify:task须用随后真实分配AF号；没有伪造将来Task ID。

### M12-WORKBENCH-AC · 完成当前工作台与独立SDK前端的任务目标验收

优先级P0，worker2h+root1h；利用已实现纵向链关闭AC-003证据缺口：最新private packed SDK的仓库外独立前端，与真实工作台消费同一Run且授权一致，不新增执行账。仅在实际新鲜成功/拒绝/浏览器全部通过后，才建议REQ-003准备负责人目标验收，owner PENDING。

预算：3.0有效工程小时（含root）。真实已有integration依赖：`task_0649f7dbff73`, `task_634f404155e8`, `task_99d2fef42591`, `task_c488ac264036`；proposal依赖：无。

candidate allowPaths：

- `scripts/verification/workbench-target-acceptance.test.mjs`
- `scripts/verification/workbench-target-browser.mjs`
- `scripts/verification/fixtures/workbench-target-consumer.tsx`
- `docs/execution/M12-WORKBENCH-AC-candidate.md`

root独占共享接线：

- scripts/verification/registry.mjs：root登记真实AF与命令、独占执行current制品build/PG/browser
- scripts/database/managed.mjs、scripts/database/migration.mjs、scripts/database/seed.mjs：仅root登记新卡精确隔离测试库lease；若复用既有fixture须合法注册而非借旧卡名
- docs/planning/CODING_QUEUE.json、docs/planning/auto-ai-program-20261105/program.json：root登记/接收/按正式原标题提交；不由Worker修改

需登记执行的成功/拒绝/compiled/PG/browser验收：

- 待root新卡注册：pnpm --filter @aij/sdk build；pnpm --filter @aij/api build；pnpm --filter @aij/web build；实际安装tarball到独立临时consumer后用其tsc进行strict/NodeNext编译，不借host node_modules或source。
- 待实现并注册：node --test scripts/verification/workbench-target-acceptance.test.mjs；使用受保护新逻辑PG库、实际Cookie/Workspace/API/Job/Trace与owned synthetic上游，返回同一个runId/一次Job/一次调用；匿名401、有效无权/他成员/跨空间403或404与零写、撤权即时拒绝、丢回复同key GET。
- 待实现并注册：node scripts/verification/workbench-target-browser.mjs；仅启动卡片拥有的真实API/生产Web与独立consumer，root原生浏览器登录→选择Agent→确认提交→读取同Run→丢回复恢复→切空间/撤权；脚本留摘要/当前制品/PG后查并停止owned资源，HTTP200/SSR不作完成。
- root正式verify:task在新真实AF号登记后运行；不以这些未来脚本尚不存在为已通过；失败交原Writer修复后定向重验。

完成后整条目标剩余：

- REQ-003负责人接收仍PENDING；若发现功能失败则本卡failed并交回实现Writer。
- 不关闭REQ-001双外部完整部署、REQ-006个人/组织模型、REQ-011真实厂商/计费或REQ-021步骤/取消中心。

### M12-CITATION-OPEN · 提供知识引用的当前授权原文查看入口

优先级P1，worker2.75h+root1.25h；knowledgeQuery用户从回答引用打开当前有权的active知识原文及摘要一致性提示，按documentId限定当前workspace，禁用/撤权立即不可读。只交一个可操作引用纵向结果，不开放管理端私有source URL，不声称向量RAG。

预算：4.0有效工程小时（含root）。真实已有integration依赖：`task_34f986fd3442`, `task_64bbf46af804`, `task_accf9151274c`；proposal依赖：无。

candidate allowPaths：

- `apps/api/src/plugins/aij-ai/ai-knowledge-citation.controller.ts`
- `apps/api/src/plugins/aij-ai/ai-knowledge-citation.service.ts`
- `apps/web/app/components/client-knowledge-citation.tsx`
- `apps/web/app/components/client-knowledge-questions-page.tsx`
- `packages/sdk/src/knowledge-citations.ts`
- `scripts/verification/knowledge-citation-access.test.mjs`
- `scripts/verification/knowledge-citation-access-live.test.mjs`
- `scripts/verification/knowledge-citation-browser.mjs`
- `docs/execution/M12-CITATION-OPEN-candidate.md`

root独占共享接线：

- apps/api/src/plugins/aij-ai/ai-runtime.module.ts：root装配新只读controller/service，复用Workspace/Plugin唯一owner（开卡前核对该真实module）。
- packages/sdk/src/index.ts：root导出真实实现
- scripts/verification/registry.mjs、scripts/database/managed.mjs、scripts/database/migration.mjs、scripts/database/seed.mjs：root注册新卡/隔离lease与串行PG/browser
- docs/planning/CODING_QUEUE.json、docs/planning/auto-ai-program-20261105/program.json：root登记依赖和接收；不改现有词项算法/Schema

需登记执行的成功/拒绝/compiled/PG/browser验收：

- 待实现并注册：node --test scripts/verification/knowledge-citation-access.test.mjs scripts/verification/knowledge-citation-access-live.test.mjs；实际service/controller/SDK、受保护PG/真实Cookie HTTP，引用打开200，匿名401/同空间只读无query403/跨workspace404、文档inactive与删除/成员role revoke立即拒绝。
- pnpm --filter @aij/sdk build；pnpm --filter @aij/api build；pnpm run typecheck；实际packed SDK ESM/CJS+NodeNext消费者编译，未有scratch-only export。
- 待实现并注册：node scripts/verification/knowledge-citation-browser.mjs；root原生浏览器问答→打开引用→核对原文→权限撤销后重新打开拒绝；真实hidden/返回、Escape焦点与private清理单独记录，不能用tab仍visible证明hidden。
- 零provider额外调用、零知识/Run/Job/Trace/预算写入；权限后查和SQL故障不返回陈旧正文；root注册的正式verify:task与原lint/diff。

完成后整条目标剩余：

- 仅关闭REQ-010可打开当前文档来源场景；向量执行/索引版本/重排、引用不可变版本、文件/业务来源打开与模型切换仍分卡。
- REQ-009格式/网页刷新与REQ-011实际embedding/rerank厂商计量未关闭；AC-010整条和owner验收仍PENDING。

### M12-QINIU-UPLOAD · 接入统一个人附件接口的私有七牛上传

优先级P1，worker2.75h+root1.25h；在既有个人/client/files上传接口按服务端受信profile选择local或private Qiniu，实现实际上传→FileAsset→现有read router下载校验。原Qiniu write/remove/SecretRef owner复用；unknown单次投递、保留待核对，绝不自动重写/盲删；预算4h硬界若发现需要新账表则停在候选并拆卡。

预算：4.0有效工程小时（含root）。真实已有integration依赖：`task_57b3d6b46f0e`, `task_940e84b0aa8a`, `task_1aa717db1928`；proposal依赖：无。

candidate allowPaths：

- `apps/api/src/files/storage-writer.port.ts`
- `apps/api/src/files/storage-write-profile.service.ts`
- `apps/api/src/files/storage-write-profiles.ts`
- `apps/api/src/files/client-files.service.ts`
- `scripts/verification/qiniu-upload-source.test.mjs`
- `scripts/verification/qiniu-upload-live.test.mjs`
- `scripts/verification/qiniu-upload-browser.mjs`
- `scripts/verification/fixtures/qiniu-upload-consumer.tsx`
- `docs/execution/M12-QINIU-UPLOAD-candidate.md`

root独占共享接线：

- apps/api/src/files/files.module.ts：root绑定writer到Local/Qiniu唯一适配器；配置通过既有ConfigService与runtime-environment owner传入，不猜新配置owner路径
- scripts/runtime-environment.cjs、scripts/runtime-environment.d.cts：若需新增安全profile仅root登记，客户端不得提交endpoint/credential
- scripts/verification/registry.mjs、scripts/database/managed.mjs、scripts/database/migration.mjs、scripts/database/seed.mjs：root登记新卡lease/真实PG/browser
- docs/planning/CODING_QUEUE.json、docs/planning/auto-ai-program-20261105/program.json：root共享接线；无Worker manifest/lock/Schema改动

需登记执行的成功/拒绝/compiled/PG/browser验收：

- 待实现并注册：node --test scripts/verification/qiniu-upload-source.test.mjs scripts/verification/qiniu-upload-live.test.mjs；wholeAPI compiled Nest+protectedPG+owned TLS，统一multipart上传201→storageType=qiniu→下载相同SHA256，原local回归保留。
- 验证匿名/他成员/跨项目、不可用profile/SecretRef撤销/错误namespace拒绝；beforeIO拒绝zeroDNS/transport；云回复未知与DB/audit失败不伪造成功、不自动重复上传或删除，FileAsset状态/待核对记录可核实。
- pnpm --filter @aij/api build；pnpm run typecheck；待实现并注册node scripts/verification/qiniu-upload-browser.mjs，root通过仓库外文件API consumer真实上传/下载，随后实际/auth/files查同FileAsset并下载，PG checksum对应；当前没有/client/files产品页，不作页面已交付承诺，native picker权限失败必须NOT_PROVEN。
- 真实七牛小额验收另需批准private bucket/region/domain/SecretRef/合成对象预算；批准后同一接口上传→下载摘要，并记录厂商receipt；owned TLS PASS不得代替；root正式verify:task+lint/diff。

完成后整条目标剩余：

- 仅REQ-008个人私有云上传/下载API切片；客户端统一附件页、云delete/unknown核对全流程、组织Membership文件、public/private/过期链接以及真实七牛目标验收仍需剩余子卡。
- 未关闭整条AC-008，owner PENDING；若真实云配置未提供，产品接线可CODE验证但真实厂商场景NOT_RUN。

## 验证、影响与交接

本worker只做Python机读schema/ID集合/完整blob hash/短行号/获准报告scope/真实集成依赖/allowPaths互斥校验以及git diff --check。产品编译、测试、DB/Docker、服务器、浏览器、真实厂商/账单/渠道/容器目标验收均 **NOT_RUN**；产品失败计数不能填写0冒充执行，本次静态校验之外没有产品PASS。无常驻访问地址。

实际diff仅本MD、同名JSON与`docs/execution/AF-185-candidate.md`。数据库、API、页面、权限、日志运行行为影响均为无；只在文档记录已有实现与缺口。没有修改registry/正式队列/manifest/lock/Schema/current state，也没有访问轻企源仓。

人工复查：root从指定sourceHead按每个path/短行重算完整SHA256；只按audit-inputs回读报告核对步骤scope与hash；对照冻结AC逐格确认剩余项；确认三个proposal真实依赖ID与允许路径；然后在root按注册AF-185执行正式verify:task、按原标题精确提交并回读，再完成I。候选提交不代表CODE_VERIFIED或负责人接收。

Writer交接：本worker候选完成后明确 **STOP ALL WRITING**，不自动接续其他任务、不push。自查不是独立review。工时按注册工作区至生成文档的实际连续墙钟保守估计，保守计入最终自查/提交/交接共0.35h（累计≤1.5h），root仍保留总卡3h减该值的审查/集成/验证预算。

限制：

- Owner acceptance PENDING；所有14个targetAcceptance=NOT_RUN_BY_THIS_AUDIT；READY仅排入可执行验收，不是AC PASS、CODE_VERIFIED或正式接收。
- 审计sourceHead=48e8d26ea1dcd67df65d316a0edfdec4bcb2d502；本worktree HEAD=94b0236f775fa40a07944c5e0545ac6ce0e123f3。未审计旧checkout为当前产品、未fetch/checkout/bootstrap/恢复任何产品文件。
- 冻结基线AIJ-REQ-20261105-R1@1f6549fd192b9ababe8c9d911ae19df3abd510ff的ID/目标/AC原文保持；历史PROPOSED_NOT_AUTHORIZED已被当前连续实施授权取代，仅保留其历史语境。
- 只读取root唯一audit-inputs.json及其中188个approvedReports的精确report.json；全部核对SHA256/PASS/verify模式/任务ID/零退出/步骤schema/失败计数。引用步骤无skip/todo，未读raw logs、private fixtures、runtime evidence files或密钥。输入sha256=852aa122dcb5eebb527081ccfc5182c41d658c5444f39b025273ce4163baa49b。
- 报告是各自历史时间/候选范围，不能从188个PASS集合推出当前最终制品40需求全通过；versioned执行叙述仅作来源说明，不当新增runtimeEvidence。
- W12生产审计all severity0仅在当前Prisma6 schema-only config→deepmerge8窄兼容例外下；不是广泛API兼容、安全发布或owner接收。
- W12网页导入/来源UI及焦点修正记录保留；native OS picker/真正hidden→foreground序列NOT_PROVEN，未访问未批准的browser proof JSON。
- Aliyun retrieval configured=false；无host/SecretRef/admission/ledger/catalog/semanticRAG接线。owned HTTP/TLS、compiled/package/static协议不证明paid vendor、账单、公开分发、租户恢复或目标验收。
- 个人资产的workspace+member不等于个人空间；部署OrganizationProfile/ProjectProfile不等于租户Membership；SecretRef产品凭据不等于BYOK；估价预算不等于对客收费；支付轨道不等于业务订单；来源元数据不等于语义检索；prompt Skill不等于脚本包。
- 建议3卡为本地proposal keys，未注册/未授权开工；dependsOnIntegrationTasks仅使用sourceHead program.json真实集成Task ID，root仍需核对实际完成回执；剩余closurePlan子项不伪造Task ID。
- 未运行产品build/test/DB/Docker/服务/browser/paid vendor/network；无常驻访问地址承诺。仅文档schema/hash/范围/diff静态校验在本worker运行。
- 未发现本次限定检查中可证实的新增critical安全/跨租户/数据丢失问题；非全面安全审计。发现的in_app状态误报与引用不可打开为产品差量，不用假想漏洞升级结论。
- Worker只有三份文档写入与ignored审计工具，无产品/队列/registry/依赖/当前状态修改；自查不是独立复核；候选完成STOP ALL WRITING，root精确验证/正式verify:task/按原名提交回读后才可完成I。
