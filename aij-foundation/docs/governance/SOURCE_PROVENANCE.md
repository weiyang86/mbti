# 代码来源与许可证记录

F00/F01 日期：2026-10-12。F00 保存来源审计；F01 按归属定向重写/适配工程装配和两个通用 interceptor，已有应用骨架，未迁任何底座包实现。下方 F00 证据保留，F01 实际迁入见第 5 节。本文件记录本地事实，不对权利归属或发布许可作推定。

## 1. 来源基线

| 项目 | 记录 |
| --- | --- |
| 只读目录 | `/Users/lei/Documents/余总合作/轻启AI/qingqi-ai-consultant` |
| 源分支 / HEAD | `dev` / `cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb` |
| origin | `git@github.com:weiyang86/qingqi-ai-consultant.git` |
| upstream | `git@github.com:weiyang86/qingqi-ai.git`；只记录本地 remote，不推定每个文件来自 upstream 哪个提交 |
| 本地 main | `87aef08`，Git 显示相对本地 origin/main 落后 62；本次未使用 main 作为来源 |
| 网络状态 | 未 fetch/pull，remote 跟踪引用只是本地快照，未验证 GitHub 当前最新状态 |
| 工作区 | 核对时干净；本次前后完整性校验见 F00_AUDIT.json |
| 逐文件证据 | SOURCE_FILE_INVENTORY.csv 记录源相对路径、源提交、SHA-256、直接依赖、处理决定 |

既有其他分支/worktree 仅作 Git 状态记录，本次未写入、切换或整理。F00 没有读取真实环境文件内容，没有复制 Git objects、客户记录或运行目录。

## 2. 项目自己的声明

以下九个包的 `LICENSE` 内容均为：`Copyright (c) weiyang86. All rights reserved.`，package.json 的 license 字段未设置。

| 源路径 | 核对结果与后续规则 |
| --- | --- |
| `packages/plugin-sdk/LICENSE` | 保留原声明；随迁入 SDK 同步记录 |
| `packages/foundation-contracts/LICENSE` | 保留原声明与现有契约版本 |
| `packages/foundation-core/LICENSE` | 保留原声明；入口目前只有组合契约，不代表全量实现 |
| `packages/foundation-runtime/LICENSE` | 保留原声明；入口目前为运行时能力列表/handler 断言 |
| `packages/foundation-shared-ui/LICENSE` | 保留原声明；入口目前为菜单槽与路由契约 |
| `packages/system-plugin-aij-ai/LICENSE` | 保留原声明；当前为 descriptor |
| `packages/system-plugin-aij-notification/LICENSE` | 同上 |
| `packages/system-plugin-aij-payment/LICENSE` | 同上 |
| `packages/system-plugin-aij-integration/LICENSE` | 同上 |

源仓库根目录未发现 LICENSE/COPYING/NOTICE；apps/api、apps/web 与根 plugins 的授权范围不能仅由上述包文件推定。`packages/qingqi-site-runtime` 没有同目录 LICENSE，且是轻企业务保留项。用户已授权 F00 本地核对与新库文档，但后续迁入者仍需由负责人核定权利范围并保留声明；缺项不能自行改成 MIT/Apache 或写“已获开源授权”。F00 不添加根开源 LICENSE、不发布包。

## 3. 第三方依赖证据

本表版本与 license 来自 F00 核对时源库已安装依赖的 package.json；只核对直接关键依赖，不代表完整 SBOM 或传递依赖审计。F01 仅按自己的 manifest 安装所需 Nest/Next/React/验证/构建依赖；本表其余依赖不能视为已在新库安装或装配。

| 依赖 | 源版本 | 本地声明 | 初步能力归属 |
| --- | --- | --- | --- |
| @nestjs/common | 11.1.19 | MIT | 核心装配 |
| @prisma/client | 6.19.0 | Apache-2.0 | ORM |
| bcryptjs | 3.0.3 | BSD-3-Clause | 身份认证 |
| class-validator | 0.15.1 | MIT | DTO |
| class-transformer | 0.5.1 | MIT | DTO |
| next | 16.2.6 | MIT | 后台 Web |
| react | 19.2.6 | MIT | 后台 Web |
| antd | 6.3.7 | MIT | 系统页面 |
| @refinedev/core | 5.0.12 | MIT | 后台 provider |
| @refinedev/antd | 6.0.3 | MIT | 后台组件 |
| docx | 9.7.1 | MIT | 主要为顾问输出，首个底座闭环不默认引入 |
| sharp | 0.34.5 | Apache-2.0 | 按文件/媒体实际 import 决定，不整包照搬 |
| jszip | manifest 为 3.10.1 | 本次未找到安装元数据，未验证 license | 按需核对；不能视为已迁入依赖 |

F01 以选定源码的实际 import 和构建需求构建新 manifest/锁文件，不复制 node_modules；实包任务补齐真实直接与传递依赖及相应 NOTICE。公共 registry scope、版本和发布流水线另由负责人决定。

## 4. 后续每次迁入的追溯要求

每次在新库实现某项时，在本文件追加记录：任务 ID、源仓库/相对文件/源 HEAD/复制前 SHA-256、目标文件、迁入方式（原样复制/抽取/重写）、删掉的业务片段、实际依赖与 owner、许可证原路径与保留位置、测试/验收、负责人核定状态。实际新库提交号只在负责人提交后补，不能预填。

源 HEAD 或文件 hash 变化时，先说明与 F00 清单的差异再定向读取；不能把新旧源码拼接却仍标注同一来源。只搬代码定义和去敏合成 fixture，不复制客户数据、环境绑定、支付凭据、日志或真实 Provider 配置。

## 5. F01 实际来源与适配

首次实现 Writer：Codex；用户明确授权实际迁出。来源仍为 dev@`cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`，以下 15 个定向文件的 SHA-256 与 F00 CSV 一致；未全库扫描。首次交付时没有提交；本轮收尾读取到新库 HEAD `847654135b1b501ddf7140ef7f0ccdcfa6c7f52c`（包含 F00 文档与 F01 工程），与 Trea 可见 Git 报告一致。该 Git 事实不证明人工验收；本轮收尾修改未暂存、未提交。

| 源文件 / SHA-256 | 目标 | 迁入方式与删减 |
| --- | --- | --- |
| `package.json` / `e3a43219d3b5df94b8aebf96cc4fef88b77feab8eb985f1ae3d4613170fa39cc` | 根 package.json | 按实际 import 重写；只保留必要版本/engine 与真实本地 scripts；去 SDK、业务 QA、发布/迁移/生产脚本 |
| `pnpm-workspace.yaml` / `08d75840c97ab0e72d1d9b5b84a17e47a2e06cb159a5fbec5ee0a6a56682dad7` | 同名根文件 | 保留 apps/packages workspace 结构；锁文件独立解析，未复制原完整 lock |
| `eslint.config.mjs` / `df6541e3748c5ea6506ad95bbb3c5c9eef855ac6b4280e52fd8d9770e98c82c0` | 同名根文件 | 定向重写与 scoping；无业务 QA/distribution 特例；补 ExFAT 元数据忽略与 CommonJS helper 规则 |
| `apps/api/package.json` / `2cd47ca4cc9954ebe7721e5ed863ffc418360325a990a1fbf3d196083ea23d71` | 同名目标 | private @aij/api；去 Prisma/JWT/bcrypt/SDK/docx/jszip/sharp 与业务 test 列表；只留装配所需依赖 |
| `apps/api/tsconfig.json` / `62135f2db80b167d221db891b5edac6de760bd6687391d20b276b3a076a0461c` | 同名目标 + tsconfig.test.json | 依据装饰器/编译要求重写为 strict 配置，固定 src→dist；独立测试类型检查 |
| `apps/api/nest-cli.json` / `70b6f2777ba2f7123c2f5497cc111ab13270037dda13844ed90da9ba3890f311` | 同名目标 | 适配 entryFile=main，不沿用源特殊 dist/apps/api/src 路径 |
| `apps/api/src/main.ts` / `94c489ce6990e88fab54a5110b6e7f4cdbcc85f549ae87d400fd0dedb04ee93a` | src/main.ts + bootstrap.ts | 保留真实 Nest 启动、rawBody/CORS/prefix/ValidationPipe；分离测试 factory；端口/环境单一来源与 loopback |
| `apps/api/src/app.module.ts` / `f43fe6d32b434495bd864525f3dee26fe57c33d0b47f57f3b5f2af490278a844` | 同名目标 | 重写组合根，删 Prisma/Auth/Admin/ClientAuth/Runtime/Integration 与所有 aij/qingqi 硬编码插件；只装配本项实际模块 |
| `apps/api/src/health.controller.ts` / `a7ee0a2e5780ec40ceb17802f1d55788dda9bd0b18cb2e9adcce454ad43ad07f` | 同名目标 | 改 AIJ 标识；去未迁 RuntimeHealth 注入；明确 process scope、无数据库和插件 |
| `apps/api/src/common/interceptors/transform.interceptor.ts` / `7ad39b5c3af6cb0472d4d9e278d760c1d0aed6f2f6d9c0070752bbb99d1b8b4a` | 同名目标 | 保留统一成功响应机制，适配 strict 类型与 lint；没有将其当作审计迁入 |
| `apps/api/src/common/interceptors/correlation.interceptor.ts` / `70aa1194fa6f5142619f22bef7ed01ec7ecf41f7ea9607e5c89dc7ab9565527b` | 同名目标 | 保留 UUID/合法关联 ID 与响应头机制，补请求/响应类型 |
| `apps/api/src/plugin-runtime/plugin-runtime.module.ts` / `d178b3963d920afcab41fa3fb22777c51cc1034416a87882a6e7a5b142510797` | 同名目标 | 只保留 DynamicModule 装配形式与拒绝未知模块；白名单为空，无业务/SDK import；不声称生命周期已迁入 |
| `apps/web/package.json` / `e756f778ad0dc627b177167cef1adac5fa4dab573162fe40c597d927c4f62be1` | 同名目标 | private @aij/web；Next/React/TS 保持源版本；Antd/Refine/icons 留给 F08 实际需求，不引入产品组件 |
| `apps/web/tsconfig.json` / `fc667bb79ffd49fd38ccd3e3ea9ba1f4a617fb6157a545bcf89600efdb2ac8eb` | 同名目标 | 按源 Next TS 要求重写，排除 AppleDouble 旁文件；不迁旧 tsbuildinfo |
| `apps/web/next.config.mjs` / `ef38926602ae807d773baa278f085c6bf14e9a32b2a144148adfcbd05b179cd2` | 同名目标 | 保留新库 tracing/root 与 API 环境；去 Company Ops rewrite、所有产品 redirects、未用 Refine transpile 和图像配置 |

scripts/runtime-environment.{cjs,d.cts}、run-app、目标测试、Web layout/page/CSS 和 .npmrc 为本次新写。环境默认、端口校验、空 allowlist 与 Web 实时 health 都使用真实执行，不复制 starter 占位任务。数据 owner：本次没有模型、Seed 或运行记录；只有组合宿主和通用 HTTP 机制。

上述源 apps/根工程文件未发现独立 LICENSE，源码没有被擅自改标成 MIT/Apache；F00 的包版权声明保持在原记录中，9 个包本次均未迁入。新 manifest 全部 private，没有 publish/pack/release；负责人在对外分发或后续实包任务前核定许可范围。本记录不把本地迁出授权扩大为公开分发授权。

首次验证：独立 frozen-lockfile 安装、lint/typecheck、9 tests、API/Web 实际 build、构建产物启动与 HTTP 200、来源 hash/index/status 保留。首次 dev 后续出现读盘 ENOENT/EACCES 并退出；本轮重新诊断与保存重载结果见 CURRENT_STATE 第 7 节，不能把历史错误写成已确认修复。

F01 验收收尾没有新增源库代码迁入：`scripts/port-availability.mjs`、端口错误测试、`verify-dev-reload.mjs` 为新库新写；现有 run-app 的自身进程组停止和 main.ts 堆栈修复、真实 HTTP 测试扩充均在既有目标实现中完成。新增依赖为零，未迁模型、Seed、环境文件或运行数据；许可证限制保持上述记录。本轮 lint/typecheck、11 tests、build 与 HTTP 保存重载实测通过；浏览器工具策略核验仍不可用，人工验收与负责人接收待完成。

## 6. AF-006 管理员与RBAC核心Schema定向抽取

日期2026-10-18，唯一Writer Codex，负责人明确授权本项本地抽取，AF-005已接收。目标开始基线dev@`fc5d3d27445c901954451f4944e850dcbb77f79f`且工作区干净；本项未提交，不能预填目标提交号。来源仍为dev@`cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`，两文件SHA-256与F00清单一致，没有重扫全库或读旧.env/数据。

| 来源 / 复制前SHA-256 | 目标与方式 | 删减、owner与依赖 |
| --- | --- | --- |
| apps/api/prisma/schema.prisma / `018f3cf984c1589059a4fc8a539d59b039b0888626cd4b7c876bf7cc6d1016ef` | apps/api/prisma/schema.prisma；仅抽取SysUser、SysRole、SysPermission、SysMenu、SysUserRole、SysRolePermission、SysRoleMenu及UserStatus/ResourceType、generator/datasource | 七模型全属F00 AIJ core；删除SysUser的23条业务反向关系；其余模型/枚举/记录/历史migrations不迁；保留原名、映射、字段、默认、唯一键、索引，六外键默认动作显式写出Restrict/Cascade |
| apps/api/package.json / `2cd47ca4cc9954ebe7721e5ed863ffc418360325a990a1fbf3d196083ea23d71` | 仅核定版本，不复制脚本或manifest | 来源prisma/@prisma/client均6.19.0，目标独立安装精确同版本；不沿用shell source环境或校验和忽略开关 |

Prisma配置、编译包装器、目标Schema/CLI测试、公开类型fixture为本库新写，注册复用AF-002执行器。没有另建数据Service实现，也没有迁Controller/DTO/Guard。`.artifacts/af-006/source-extraction.json`逐模型比对保留字段/约束/核心关系并列出移除关系；`.artifacts/af-006/dependency-audit.json`证明锁文件原有package版本/integrity保持，仅新增32个依赖条目及相应peer解析，未整体升级栈。CLI/client本机package声明均Apache-2.0，这是第三方依赖许可，不是源应用或产品发布授权。

源根目录及apps/api未有可适用于本Schema的独立LICENSE/COPYING/NOTICE，源码片段也没有文件版权头；F00九包的All rights reserved声明按原记录保留，不能擅自套用其他范围的LICENSE或改为MIT/Apache。目标Schema保留来源提交/记录指针，公开分发权仍由负责人核定，现有manifest均private；本次授权本地抽取不等于授权公开发行。

实际Prisma validate/generate、23目标断言、生成类型/API构建、lint/typecheck通过；所有关系在本库闭合，没有CompanyProfile/诊断/订单/业务反向关系。只生成忽略的本库客户端，没有建表、迁移、Seed、真实DB查询或旧库连接。Trea待复核、人工待验；完整退出码、证据及保护状态见 [AF-006执行记录](../execution/AF-006.md)。

## 7. AF-007 通用客户身份Schema定向抽取

日期2026-10-19，唯一Writer Codex；负责人指派仅AF-007并确认AF-006接收。目标开始基线dev@`dd6261085de2fece7105b9da605769c7cf289f90`，工作区干净；该HEAD为负责人已提交的AF-006，本项目标提交尚无。来源仍为dev@`cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`，仅定向读`apps/api/prisma/schema.prisma`五模型段，文件SHA-256仍为`018f3cf984c1589059a4fc8a539d59b039b0888626cd4b7c876bf7cc6d1016ef`，与F00一致。

| 来源段 / F00目标owner | 目标与处理 |
| --- | --- |
| MemberUser / AIJ identity | 同名目标Schema；保留全部标量、唯一键、默认与索引，仅保留authSessions/authTokens/consentRecords关系，去掉54条组织/业务/lifecycle反向关系 |
| ClientAuthSession、ClientAuthOneTimeToken、ClientConsentRecord / AIJ identity | 同名目标Schema；原字段/映射/约束/索引保留，三条必需member外键默认动作显式写Restrict/Cascade，不新增跨管理身份关系 |
| ClientAuthRateBucket / AIJ identity | 同名目标Schema；保留scope/keyHash复合唯一、时间窗口/封禁字段及两个索引，不引入业务或租户依赖 |

没有其他模型/枚举、历史migration、Seed、真实会员/会话/Token/同意记录或源.env/依赖目录迁入。原7模型/2枚举定义保持不变，当前共12模型/2枚举。`.artifacts/af-007/source-extraction.json`逐模型列出删减，最终归一化比对和core不变证明在handoff.json。Member关系三行按Prisma生成副本格式对齐，未改变定义语义。

沿用本库已核定Prisma/client6.19.0及AF-006编译入口；manifest/锁文件、依赖版本无新增或升级。目标身份测试与公开类型fixture为本库新写，复用原执行器和核心测试；未迁任何Controller/Service/DTO/Guard。验证是实际validate/generate、44项Schema/CLI断言（21身份+23核心）和API/Web类型门禁，非注册/撤销/单次消费/同意采集运行时证明。

源应用声明缺项及F00版权边界继续适用；不擅自改标MIT/Apache，不把Prisma第三方许可当产品公开分发授权，不发布包。ClientAccountLifecycleRequest按F00留原库，账号导出/注销不宣称实现。原库Git/index/定向文件与容器元数据前后保护见[AF-007执行记录](../execution/AF-007.md)，**Trea待复核、人工待验**。

## 8. AF-008 配置与审计Schema定向抽取及最小适配

日期2026-10-19，唯一Writer Codex；负责人确认AF-007接收，仅指派本项。目标开始dev@`e00ce7a112b30747820ac5d9e1a4e4fa39905317`且工作区干净，该HEAD为负责人已提交AF-007，本轮未提交。来源仍dev@`cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`；定向Schema文件SHA-256 `018f3cf984c1589059a4fc8a539d59b039b0888626cd4b7c876bf7cc6d1016ef`与F00相同，没有扫描迁入整库。

| 定向来源段 | F00 owner / 目标及适配 |
| --- | --- |
| OrganizationProfile、ProjectProfile | AIJ configuration；同名目标Schema；保留归属/品牌容器/通用环境默认，必需组织外键动作显式Restrict/Cascade；无成员/权限关系 |
| ScopedConfig、ConfigurationChange | AIJ configuration；保留源标量、映射、四元层级唯一和索引；补当前version、历史configId/configVersion、auditLogId与正反向关联，增加版本复合唯一和auditLogId索引 |
| SecretReference | AIJ secret-center；原引用元数据模型，未添加密钥值/商户字段或默认环境绑定 |
| AuditLog | AIJ core；保留源快照字段/索引，workspaceId仅可空标量，补configurationChanges反向关联 |

版本/审计字段是本次为当前验收要求补足的Schema设计，不冒充源实现：共4标量、4关系字段、1复合唯一和1普通索引新增。两条可空变更外键明确Restrict/Cascade；历史版本只存捕获值，不引用可变当前version。通用项目/密钥变更仍可不关联具体配置；成对/正数/版本递增/事务审计及脱敏执行留给后续服务与迁移。原13索引保留、新增1索引；没有迁SysConfig/历史migrations/Seed/品牌载荷/商户凭据/用户记录/默认业务Prompt或真实密钥。

为核对通用事件语义和合成引用格式，仅只读以下服务片段/解析器，没有迁入其实现或复制混合依赖：configuration/configuration.service.ts（SHA-256 `33e5d4ded0f5855b9386bc56729233b6a07cbd0bae89bfe2bf6b1498e046d083`）、secret-center/secret-center.service.ts（`54fe07ad5f41d4ae9838119fb3413f9d2009ad6f5539c4fd12ed70bff4b07282`）、secret-center/secret-ref.ts（`329254ac3e146c38089bead4211602056a67ec8089434ddcea192a36b0b9cbbf`），均在源apps/api/src/下。仅Schema定义按表中方式抽取，Prisma配置/版本/包装器及manifest/锁文件不变；没有Controller/Service/DTO/Guard迁入。

公开类型fixture和配置Schema测试为本库新写，复用原验证执行器及44项身份/核心断言，新增24项后共68项，实际validate/generate与类型门禁通过。原12模型和2枚举逐块字节不变证明、源字段保留及明确新增差异在.artifacts/af-008/{source-extraction,handoff}.json。目标使用生成副本规范对齐空格，不改变字段值或原12模型定义。

源应用许可证声明缺项和既有版权边界保持；本地定向抽取不等于公开分发授权，不擅自改标MIT/Apache、不发布包。项目组织不替代客户Workspace授权，引用模型不等于密钥校验/存储策略或审计脱敏已实现。保护与完整实际结果见[AF-008执行记录](../execution/AF-008.md)，**Trea待复核、人工待验**。

## 9. AF-009 文件与插件状态Schema定向抽取

日期2026-10-19，唯一Writer Codex；负责人接收AF-008，仅指派AF-009。开始dev@`b0d3b36078d40ff32cbb0712ae642ef3aafb1c7c`、工作区干净；该HEAD为已提交前序，不计本项新增差异。来源仍dev@`cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`、status干净；Schema SHA-256 `018f3cf984c1589059a4fc8a539d59b039b0888626cd4b7c876bf7cc6d1016ef`与F00一致。仅定向读apps/api/prisma/schema.prisma的FileAsset（604行起）、Plugin（5098起）、PluginInstallLog（5160起）及邻接关系模型定义，核对F00 M08/M11/M18与owner三行；未重扫整库或读取源环境/客户数据。

| 来源定义 → 唯一目标 | F00 owner | 实际保留与适配 |
| --- | --- | --- |
| FileAsset → FileAsset | platform/core → AIJ core | 22来源标量保留20，删除bizType/bizId；移除siteMediaLinks/siteMediaCandidates/siteMediaDerivatives/siteDeploymentEvidence四业务反向关系；其余字段/映射/默认、2类唯一键及5索引保留 |
| Plugin → PluginInstallation | platform/core → AIJ core | 保留id/version/installedAt/enabledAt/disabledAt/createdAt/updatedAt；code→pluginCode、logs→operations；删除name/description/deletedAt和menus/permissions；增加projectId/owner/uninstalledAt/failureReason，改项目+插件唯一、表映射与枚举默认未安装 |
| PluginInstallLog → PluginOperation | platform/core → AIJ core | 保留id/action/operatorId/createdAt；plugin关系改必需installationId→稳定安装id，显式Restrict/Cascade；message→failureReason；移除pluginCode/operatorName，新增version/owner/开始结束时间、状态枚举默认pending及两个时间查询索引 |

源插件模型status均为String，不含本项的两个枚举或同名PluginInstallation/PluginOperation；以上属于明确记录的最小设计适配。新状态可表达未安装/已安装/启用/失败及操作pending/running/succeeded/failed，但不实现状态迁移。默认不安装/启用任何插件；owner为实现标识，不是客户权限，项目归属与客户Workspace仍分开。没有迁PluginMenu/PluginPermission、任务/支付/AI模型、原插件日志、上传文件、历史migration/Seed或原库路径/业务FK。

沿用已有Prisma/client6.19.0、唯一Schema/离线编译包装器/验证执行器；manifest/锁文件及Prisma配置不变，原18模型/2枚举逐块字节不变。新增17项真实生成DMMF/CLI断言及6条公开类型反向断言，原68项按owner回归且全局业务禁入保留，完整21模型/4枚举由AF-009检查；validate/generate、85项及根lint/typecheck均通过。不存在镜像Service或包实现，文件/插件Controller/Service/DTO/Guard未迁。

来源字段保留/适配记录、目标Schema SHA-256、原模型保护在.artifacts/af-009/{source-extraction,handoff}.json；原库Git/index/定向Schema hash及三容器元数据保持，未连接数据库。源应用许可声明缺项保持，不推定MIT/Apache或公开分发授权，不发布包。详细限制、命令/退出码、证据及人工验收见[AF-009执行记录](../execution/AF-009.md)；**Trea待复核、人工待验**。

## 10. AF-010 独立Initial Migration与目标保护

日期2026-10-19。唯一Writer Codex；负责人已接收AF-009，仅指派AF-010。目标开始dev@`dbf4c97b43b7abf228225bfc63e8930baf5afebe`，工作区干净；已接收Schema SHA-256 `5600d196f46ed7734df66ece9364b80ded5328a629e71d4f5961832e262efd8a`逐字节保持。新20261019000000_initial SQL由本库Prisma6.19.0从empty→目标Schema实际生成，SHA-256 `d0b7ffa427f66fdff9e4b917ed94805b9b893b4fff2977b7d9e62ce3fef8de44`，命令/输出在.artifacts/af-010/generation.json；未读取/复制源89份SQL、lock、旧迁移账本或任何原库数据。

21模型的数据owner沿用AF-006至AF-009/F00，新增本库迁移没有改变归属。scripts/database/migration.mjs和薄db-migrate入口为本库新实现，复用既有runtime URL策略、connection真实身份、managed Docker归属和Prisma CLI版本/受控环境，不复制源迁移执行器或服务。显式验收ID仅派生到本机记录、模式/实例匹配的新空库，普通dev/test白名单保持；未添加Controller/Service/DTO/Guard或应用数据库装配。

本轮在两自有实例分别新建空验收库，独立ledger首次/二次deploy、status、21表/243列/4枚举/74索引（含账本主键）/13FK、零漂移与真实合成约束通过，合成事务回滚。原dev/test数据库表/哨兵/凭据保持，没有对其deploy，也没有reset/drop/删卷或服务启停。真实命令/退出码、完整影响、保护范围和人工地址见[AF-010](../execution/AF-010.md)。

原库仍只读dev@cd8d006，status/index和定向Schema hash保持；本项没有重扫源库或读取源环境/客户数据，没有连接原数据库。目标Schema已有来源/许可限制持续适用；生成SQL不是公开分发授权，不推定MIT/Apache，不发布包/发行/部署。**Trea待复核、人工待验**。

## 11. AF-011 Prisma单例/关闭结构定向复用

日期2026-10-19，唯一Writer Codex；前置AF-010负责人已接收，目标开始dev@`613bc1f9b478472a5c8fd8577adb526b588c8829`且干净。本项仅定向读取原apps/api/src/prisma/prisma.service.ts与prisma.module.ts，来源仍dev@`cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`；F00文件清单/迁出M04 owner为AIJ database，源文件hash分别如下，与F00一致：

- service：`553523635d0d35540e2f9885ffd3dec2925f5fa74cb53975d8247b003f97a762`
- module：`62f63530e639921389743bc0ec74090cae2e8a1c6dec3bd19f4b623d58a1a73b`

复用extends PrismaClient、Nest单例@Injectable、@Global模块provider/export和OnModuleDestroy/$disconnect结构；目标唯一实现为本库apps/api/src/prisma。为故障时仍能提供进程存活，去掉源onModuleInit主动连接，改延迟连接；新增本库受保护URL、有限池/超时、真实身份/迁移账本readiness、并发探针与关闭等待。AppModule只消费导出，不存在app/package双份实现。source结构本来不含本项readiness，新增行为不冒充源实现。

ReadyController和HTTP/生命周期测试为本库新实现；既有bootstrap.enableShutdownHooks复用不变。工具connection中的本机路径/验收记录/配置策略移至唯一runtime-environment，再由工具和API共用；目标owner未改变。managed preflight支持显式所选环境、migration只扩展AF-011受记录验收库，不放宽普通dev/test/原库保护。Schema、initial、manifest/锁文件和Prisma版本保持，没有迁源历史SQL/Seed/客户记录、业务Service或环境文件。

源Git/index、定向Schema和两个Prisma文件hash保护证据见.artifacts/af-011/{baseline,handoff}.json；原15435只inspect安全运行元数据、未连接数据库。源应用许可缺项及All rights reserved边界继续适用，不推定MIT/公开分发授权，不发布包。真实结果、限制及人工入口见[AF-011](../execution/AF-011.md)，**Trea待复核、人工待验**。

## 12. AF-012 最小Seed定向适配

日期2026-10-19。唯一Writer Codex；AF-011负责人已接收，目标开始dev@2c9b36f且干净。来源仍dev@`cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`。只定向核对seed.ts的imports/权限结构/upsertSuperAdmin/默认项目/main片段，以及auth.service.ts的bcrypt.compare；源完整文件仅求hash作保护，没有迁其执行入口或扫描全库。F00 M19明确要求重写最小/幂等Seed，M03/manifest确认bcryptjs3.0.3方向。

源seed.ts SHA-256 `d1d62eea34319a9cf2a3db4d01bccf8f497ae32090d85df03a615bb8977c59fb`、auth.service.ts `fe1d324fb7c1b23380bdbe47f7289049a49d3330ea4ee2db24d5f1f179f24f33`，均匹配F00；两者未复制到目标。沿用bcrypt.hash/compare及唯一键初始化机制；原Seed默认密码、重新启用管理员/恢复角色、全量菜单/插件/业务资产均排除。

目标唯一owner改为scripts/database/seed.mjs，根db:seed薄入口；复用既有connection的受保护pg连接/参数数组、migrate status的真实身份/资源/迁移链和数据库事务，不另写PrismaService或自动Seed hook。仅AIJ configuration组织/项目与core管理员/RBAC7行，UUID只作为String id，无Schema改变；改用DO NOTHING/已有管理员不协调任何权限，补advisory lock、初始文件归属/模板策略、bcrypt cost12（源为10）。这些是本次明确适配，不冒称原实现已有同等保护。

API manifest新增精确bcryptjs3.0.3、锁文件仅增加此包；实际安装/build/114项及质量门禁通过。Schema/initial、Prisma6.19、Nest/Next/React等其余版本不变；无源.env/node_modules/历史迁移/客户数据/上传/商户/业务Prompt或权限菜单复制。源应用许可缺项与原版权边界继续适用，不推定MIT/公开分发授权，不发布包。两仓库/容器保护、真实命令与限制见[AF-012](../execution/AF-012.md)和.artifacts/af-012/handoff.json；**Trea待复核、人工待验**。

## 13. AF-013 管理员认证定向适配

日期2026-10-19，Codex唯一Writer，AF-012负责人已接收。目标dev@5b224daf958b8277b8758cf582e2cdcd629ab313开始干净；源仍dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb。F00 M03 owner为AIJ core/auth；仅定向读取以下五文件、其manifest版本和auth/common路径列表，不重扫源库，不迁源混合Admin、AuditLogService或Seed。

| 源相对路径 | SHA-256 |
| --- | --- |
| apps/api/src/auth/auth.module.ts | fa80b8c8884dd7e0ade675c511656654b1917e2b8b91b8847c2f4f2147026761 |
| apps/api/src/auth/auth.service.ts | fe1d324fb7c1b23380bdbe47f7289049a49d3330ea4ee2db24d5f1f179f24f33 |
| apps/api/src/auth/auth.controller.ts | 2f26438b4253d2a02f25993902c36a47207524c33cb3ab6eb3d8102a354b505a |
| apps/api/src/auth/dto/login.dto.ts | bd794a317762a1ec16837dac4a924f1741b2d1c5e53afc0cddbd38f2b9bc57fd |
| apps/api/src/common/guards/jwt-auth.guard.ts | 8e6dc84335f1f73cb9c8b3fcdbe3a12e45f184568540124056eac3004645f4eb |

复用Nest模块/Controller入口、DTO校验、bcrypt compare/active且未软删SysUser、签JWT/lastLoginAt/登录审计及Bearer Guard结构；沿用来源@nestjs/jwt11.0.2和已验收bcryptjs3.0.3，非全栈升级。目标唯一auth owner位于apps/api/src/auth及common/guards/jwt-auth.guard.ts，复用AF-011唯一Prisma；无包/宿主两份实现。AuditLog仅本项登录记录，不宣称一般审计服务已迁。

明确适配：移除源开发secret fallback/7d/旧qingqi-api与admin audience，改本项目/环境issuer、专用audience/用途、HS256/15分钟和强随机本机key；不带roles/permissions快照，Guard重查当前身份，认证与DB故障401/503分开；加DTO字节边界/未知用户dummy bcrypt、去敏错误与前置关联ID。源logout只写审计不撤销，本项不迁该入口；客户认证、RBAC授权/菜单、刷新/撤销均不宣称已实现。

Schema/initial/Prisma实现、源环境/历史迁移/会员和业务数据不迁。仅扩展显式AF-013验收库白名单，原dev/test不放宽；合成Seed、登录/HTTP、真实自身逻辑DB断连恢复/关闭池和人工main生命周期已验证。源码来源版权/许可缺项与All rights reserved边界持续适用，不能推定MIT或公开分发授权，不发布包。详细结果与保护证据见[AF-013](../execution/AF-013.md)、.artifacts/af-013/{baseline,handoff}.json；Trea待复核、人工待验。

## 14. AF-014 RBAC权限守卫定向适配

日期2026-10-19，唯一Writer Codex；AF-013已由负责人接收。目标开始dev@6d3f444b4893d98411d9643bd202d7c5147ab5c3且干净，源仍dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb。按F00 M03（认证/权限/日志）与M18现有核心模型owner定向读取两个权限文件，以及admin.controller前17行/权限装饰使用位置作消费上下文，不复制Admin混合Controller/Service、业务权限常量或插件实现，不重扫原库。

| 源路径 | SHA-256 |
| --- | --- |
| apps/api/src/common/guards/permissions.guard.ts | 888e91d28ad8fb49b35098e654b2578d285de9b601c39fd5062279a0965aa32b |
| apps/api/src/common/decorators/permissions.decorator.ts | 148c58a2d84600f4639aebacb14f9be68c27e9c5fbd2fbcbc59eb51cb231a679 |

沿用SetMetadata/Reflector、用户→角色→权限关系的当前DB查询、全部必需权限AND及Nest Guard机制；规则抽到唯一PermissionsService供守卫与只读自查共用。明确适配：不迁依赖未实现pluginPermission/plugin的检查，不把它当插件生命周期已迁；类/方法合并AND，缺/空/非法声明失败关闭；过滤用户/角色/权限状态与角色软删，去掉super_admin角色名旁路，仅DB isSuperAdmin且全部权限定义active时允许越过角色关联授权；判权读取用RepeatableRead事务、DB失败503固定去敏。不是全量复制原guard。

本项只读Controller、最小拒绝审计、错误filter范围扩展和安全合成fixture/校验为本库适配；RbacModule公开导出，宿主消费现有AuthModule/Prisma/JWT，无镜像实现。Schema/initial及模型owner保持；root/API manifest和锁文件无新增依赖或版本变更。现有aij.bootstrap.admin仅绑定限定只读目录，未迁业务权限/菜单/旧用户/真实数据。账号、随机初始密码和JWT key只在本机忽略文件，原env/node_modules/历史迁移/客户数据/上传不复制，原15435不连接。

源Git/index/Schema与两个源文件hash保持；版权/许可缺项及All rights reserved边界继续有效，不推定MIT或公开分发授权，不发布包。真实202+2、命令/退出码、人工环境与限制见[AF-014](../execution/AF-014.md)和.artifacts/af-014/{baseline,handoff}.json；Trea待复核、人工待验。

## 15. AF-015 管理员基础管理定向抽取

日期2026-10-19，Codex唯一Writer；AF-014负责人已接收。目标开始dev@ff6887d0f4df1494560404b5b392bf7fa9d74847且干净，源仍dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb。依据F00 M02/M03/M18与既有SysUser/RBAC owner，只读取混合源AdminService导入1–18及管理员片段144–246、Controller前25行、DTO前28行，并定向定位相关方法名；未复制或重扫混合模块/业务权限/Schema/Seed。

| 源路径 | SHA-256 |
| --- | --- |
| apps/api/src/admin/admin.service.ts | 1603d49eef61c148819f52db4a23aa5cce9b9b84c08ba0761edaace23497590e |
| apps/api/src/admin/admin.controller.ts | ba5cc2018aad8d041b18699972857184e915f730461029893c90a0be6edafa86 |
| apps/api/src/admin/dto.ts | 84bde7685d9a60aa341cb7e9c6aeecca606a005cad0d3d6243a05a2a2d1dc7fa |

定向复用listAdmins/createAdmin/updateAdmin/setAdminStatus/resetPassword的核心SysUser资料、bcrypt、角色关联及admin.user.manage权限命名，移除AI/诊断/订单/企业/插件依赖。目标owner为唯一AdminUsersModule/Service/Controller/DTO，复用现有JWT、PermissionsGuard/Service和Prisma；不复制另一套Auth/RBAC/DB服务。

明确适配：安全字段select及分页/查询DTO、严格拒绝超字段；密码改为已接收Seed的同一强度策略与bcrypt12（源管理员片段为cost10），公共纯策略抽到scripts/admin-policy.cjs；创建不允许设置超级标志，角色绑定/修改超级账号仅DB超级管理员；验证角色/更新/关联/最小审计原子事务，数据库局部锁后复用同一判权方法重查操作者，保护自停用/自删除和并发最后超级管理员。源片段没有软删除入口，目标仅使用既有deletedAt加disabled建立软删、详情及no-store/固定去敏边界；用户名不回收。既有JWT改密后有效至原期限，不宣称撤销已实现。

受保护Seed仅显式--admin-users注册新的API权限定义，不扩张原bootstrap目录权限、不补授权；默认七行/密码/角色幂等语义保持。Schema/initial/manifest/锁/JWT核心不变，源码、真实环境、历史migration/ledger、客户数据/上传不迁，原15435不连接。239+2与真实CRUD/失败/并发/恢复证据见[AF-015](../execution/AF-015.md)和.artifacts/af-015/{baseline,handoff}.json。源Git/index与三文件及Schema hash保持；既有许可缺项和All rights reserved边界适用，不推定MIT或公开分发授权，不发布。Trea待复核、人工待验。

## 16. AF-016 角色与权限管理定向适配

日期2026-10-19，Codex唯一Writer；AF-015由负责人接收。目标dev@a2305febd84eacf8925cfc9dc052fe08e3a35c44开始干净，源仍dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb。按F00 M02/M03/M18/M19，定向定位AdminService角色/权限方法，读取232–265（角色CRUD）及285–328（权限选择/替换），Controller25–33（角色入口）；前期上下文读取230–333/25–70中菜单边界仅用于排除，不迁菜单/插件实现。DTO前28行无角色权限DTO可复用，目标按现有校验机制适配，未重扫原库。

| 源路径 | SHA-256 |
| --- | --- |
| apps/api/src/admin/admin.service.ts | 1603d49eef61c148819f52db4a23aa5cce9b9b84c08ba0761edaace23497590e |
| apps/api/src/admin/admin.controller.ts | ba5cc2018aad8d041b18699972857184e915f730461029893c90a0be6edafa86 |
| apps/api/src/admin/dto.ts | 84bde7685d9a60aa341cb7e9c6aeecca606a005cad0d3d6243a05a2a2d1dc7fa |

复用listRoles/createRole/updateRole/setRoleStatus/removeRole及rolePermissions/setRolePermissions的核心Sys*关系和admin.role.manage命名。剥离pluginPermission/plugin状态查询、混合Admin注入、业务权限常量/菜单；源无本项自定义权限定义CRUD服务，目标围绕已接收SysPermission和既有Prisma/JWT/RBAC建立最小实现，不虚称已迁源服务。

明确适配：有界列表/详情/严格DTO，角色代码不可改、保留代码不可创建或变更；基于真实DB超级标志而非super_admin角色名，普通管理者限未分配且无授权角色，权限替换仅DB超级。权限仅custom.*且服务端module=custom可创建/修改/启停/无引用硬删；非custom为代码owner、API不可改，元数据apiPath不挂载路由。角色软删同事务清权限关联、保留用户关联/代码占位；权限删除显式检查角色FK及菜单字符串引用，不级联他人授权。坏权限集合全拒绝，不照搬源逐项跳过或事务外先清后建。

AF-015的数据库可用性/去敏/同一数据库写锁/事务重查身份/最小成功审计抽到唯一ManagementAccessService；管理员与RbacManagementService复用，PermissionsService/JWT/Prisma不复制。RbacModule公开导出并由现有宿主消费，新Controller/Service/DTO与core数据owner明确。Seed显式--rbac-management只注册两条代码owner定义，不授予角色、不修复撤销/状态；默认七行及既有--admin-users语义保留。元数据冲突整笔回滚。

Schema/initial、认证/Guard核心、manifest/锁与两个实例保持；源env/node_modules/历史SQL/ledger、客户/商户/Prompt/上传不迁，原15435不连接。只在自身新逻辑库写合成数据，菜单引用探针创建后精确清除，不宣称菜单服务已迁。源码Git/index/三文件及Schema hash保持；许可缺项及All rights reserved边界持续有效，不推定MIT/公开分发授权、不发布。实际命令/退出码/证据与限制见[AF-016](../execution/AF-016.md)及.artifacts/af-016/{baseline,handoff}.json；Trea待复核、人工待验。

## 17. AF-017 已验收RBAC的本库复用与装配

日期2026-10-19；前置AF-016已接收，实际目标dev@4c2f905干净开始。本轮没有新增源库抽取，不重扫原库；直接复用AF-014/016已核验的PermissionsService、PermissionsGuard、JwtAuthGuard、PrismaService和ManagementAccessService。来源仍为第14/16节、F00 M03核心权限owner，不复制包/宿主镜像服务。

新增AdminAuthorizationGuard只编排既有JWT/权限Guard，以APP_GUARD/useExisting在RbacModule公开并由现有宿主消费；保留服务器权限声明，替换重复局部挂载，漏声明默认拒绝、本人/my显式身份例外。当前权限结果改为同一RepeatableRead快照，无缓存/权限版本表；提交后的角色变更下个请求查库生效。新HTTP测试使用本库实际实现，附加Controller只在测试进程，不写生产源码或增加可访问探针。

Schema/initial/依赖/源许可证保持；无来源.env、历史迁移/ledger、客户数据、上传文件迁入，不连源数据库。源Git/index/Schema及原两Guard/decorator定向hash前后保持；证据.artifacts/af-017/{baseline,handoff}.json。原许可缺项及All rights reserved边界保持，不推定公开分发授权。本项Trea待复核、人工待验，未发布。

## 18. AF-018 管理员API本库复用与验收

2026-10-19，目标dev@37372b91021ecefa851a34dc8ed01ec9cfe461cf开始干净，AF-017已接收。本项复用第15–17节已核验的AdminUsersModule/Controller/Service/DTO、共享密码策略、ManagementAccessService事务审计及Prisma/JWT/统一RBAC；都已公开导出并由宿主消费，不新增应用实现或镜像服务。F00 M02/M03管理员能力及SysUser/AuditLog core owner不变。

没有新增源库抽取；只复核源Git/index及Schema/混合AdminService/Controller/DTO定向hash，未重扫原库/复制业务依赖或读取.env/历史迁移/客户/上传。本轮新增测试是真实HTTP+数据库；审计失败trigger/function只在新AF-018库临时安装并移除，锁等待撤权探针只改自己合成授权；不修改生产源码、不依赖AI。Schema/initial/manifest/锁和全部应用文件hash保持；来源许可/All rights reserved缺项仍适用，不推定公开分发授权、不发布。

证据.artifacts/af-018/{baseline,handoff}.json和[AF-018执行记录](../execution/AF-018.md)。Trea待复核、人工待验；本轮未触碰源库或连接源数据库。

## 19. AF-019 角色分配复用与事务边界增量

2026-10-19，目标dev@c178e729d3ded164b1b44e15491558e167eec130开始干净，AF-018已接收。复用第16–18节已核验角色Controller/DTO/Service及唯一Prisma/JWT/RBAC/共享事务审计；F00 M02/M03/M18的core角色/权限/用户关联与审计owner保持。没有新增源库抽取，不复制包/宿主镜像实现，也没有新增权限定义/菜单/页面能力。

两份应用文件增量：RbacManagementService在原写锁与事务内拒绝非active角色权限替换（含[]）；ManagementAccessService既有审计增加可选的已验证权限ID前/后集合，角色分配传入，其他管理审计不变。集合来自实际旧关联和服务端active目录校验，新审计与授权变更同事务；不记录业务输入值/密码/hash/JWT、不回填历史。新HTTP/DB测试含真正锁等待后停用、合成audit失败整笔回滚、引用软删保留用户；失败trigger/function只在自己新库创建后移除，不改生产Schema。

源Git/index/Schema/混合AdminService/Controller/DTO定向hash及原15435容器元数据保持，不读.env/历史迁移/客户/上传、不连接源库。目标Schema/initial/manifest/锁保持；许可缺项及All rights reserved边界延续，不推定公开分发授权，不发布。证据.artifacts/af-019/{baseline,handoff}.json与[AF-019记录](../execution/AF-019.md)，Trea待复核、人工待验。

## 20. AF-020 菜单API定向抽取与适配

2026-10-19目标dev@24055bbebee27bf9d2003b8b3857a6c1390a0db0开始干净，前置AF-019负责人接收。源HEAD=cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb，源工作区Git/index/定向Schema、AdminService/Controller/DTO hash见.artifacts/af-020/baseline.json。只定向阅读admin.service.ts的83–160与332–472行菜单方法，以及admin.controller.ts相关菜单入口；没有全库扫描/全量复制/移动或删除原文件。F00 M02/M03/M18 core owner为SysMenu/SysRoleMenu/SysPermission和AuditLog，不迁源记录或任何业务反向依赖。

复用原byParent分组/递归树、sortOrder与parentId结构、CRUD/软删及可见性/状态/权限码字段；迁入唯一menus模块。原实现宽松any输入、角色菜单授权与非原子成功审计不能直接用于当前边界，改用严格DTO、现有权限解析同事务快照、已有写锁与审计owner，并补循环/真实页面/插件可用性检查。没有复制原混合AdminService、Plugin/AI/CompanyOps服务或产品导航；历史SysRoleMenu关联不作为API权限grant。不存在的后台路由只允许停用草稿，不从零重写页面或假装插件安装。

来源定向hash：AdminService=1603d49eef61c148819f52db4a23aa5cce9b9b84c08ba0761edaace23497590e，Controller=ba5cc2018aad8d041b18699972857184e915f730461029893c90a0be6edafa86；其余证据留baseline/handoff。源Git/index/定向hash保持、未读取.env/历史迁移/客户数据/上传或连接原数据库。目标Schema/initial/manifest/锁保持，许可缺项与All rights reserved限制沿用，不推定可公开分发，不发布。完整验证与交接见[AF-020记录](../execution/AF-020.md)。

## 21. AF-021 字典Schema与服务定向迁入

2026-10-19目标dev@b34332902f78116324810b74c70c0a3d40addbbd开始干净，AF-020已接收。源HEAD=cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb，只定向读Schema 567–603的SysDict/SysDictItem、AdminService 535–698字典方法及Controller相关入口，owner见F00 M02/M18和PRISMA_MODEL_OWNERSHIP.csv 26/27行。源完整Schema/AdminService定向文件SHA与Git/index快照见.artifacts/af-021/baseline.json；没有迁源记录、业务分类或旧迁移/账本。

保留分类code/名/说明/顺序/状态/软删、条目label/value/所属关系/唯一键和有序读取机制；新增安全默认isPublic=false、插件owner预留与显式RESTRICT。原any输入/非原子审计/可改code及级联式分类停用不照搬，改严格DTO、稳定引用、分类含未删项删除409、现有写锁/事务审计/认证权限owner。新的DictionariesModule为唯一实现，宿主公开消费，不复制原混合服务或创建镜像。公开字段最小化，无业务外键；业务字典未来由插件owner注册，当前不伪装插件安装。

两表迁移由本库accepted→目标Schema的Prisma6.19 diff实际生成，原initial不改，未读取旧89SQL或原_prisma_migrations。源Git/index/Schema/AdminService/Controller/DTO hash保持，未读取.env/客户/上传或连接源数据库。现有许可缺项及All rights reserved边界沿用，不推定公开分发授权；无发布。证据.artifacts/af-021/{baseline,handoff}.json和[AF-021执行记录](../execution/AF-021.md)。

## 22. AF-022 配置解析与公开上下文定向适配

2026-10-19目标dev@e961144cf9198f2c1adf19a42dc87fbc44420230开始干净，AF-021接收。源HEAD=cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb，定向读取apps/api/src/configuration五个文件（policy63、service235、controller53、dto24、module13行），全部定向hash补充核对源mtime早于开始快照，保存.artifacts/af-022/baseline.json，不重扫整库或接原DB。F00 M05与OrganizationProfile/ProjectProfile/ScopedConfig/ConfigurationChange owner保持，复用AF-008已在本库的定义/版本/审计关联。

保留scopeIdFor/chooseConfigCandidate的可信归属、三层解析、configValue类型/公开投影和变更机制。移除源default-org/default-project常量、SysConfig旧fallback、plugin scope与原审计模块依赖，按当前runtime.projectId/environment定位合成项目；固定六key/schema、真正状态校验、乐观版本和同事务审计/变更。原公开投影先过滤再解析会暴露低层，改先解析再过滤；档案brand/meta/legalEntity不透传。引用仅格式/已有元数据检查，不复制Secret adapter或读取env；不迁源品牌/配置载荷/客户/业务Prompt。

ConfigurationModule唯一实现公开宿主消费；复用管理写锁/JWT/RBAC/Prisma，ManagementAccessService.audit只返回创建行供FK链接。Schema、两SQL、manifest/锁/旧业务实现保持。源Git/index/Schema/Admin/定向configuration文件hash保持，不移动/删除/改源文件，不读原.env/历史迁移/上传/真实数据或连接源15435。许可证缺项及All rights reserved边界沿用，不推定公开分发授权；无发布。证据.artifacts/af-022/{baseline,handoff}.json及[AF-022记录](../execution/AF-022.md)。

## 23. AF-023 密钥引用端口与受控后台定向适配

目标dev@b39984a4f12baefb4303529fc444524f9b644992干净开始，前置AF-022已接收。源HEAD仍为cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb；仅定向读apps/api/src/secret-center七个文件，源Git/index/Schema/Admin定向hash和这七文件SHA保存.artifacts/af-023/baseline.json。F00 M06与SecretReference owner为AIJ secret-center，ScopedConfig/ConfigurationChange为configuration，AuditLog仍为core。

保留原parseSecretRef、env adapter、resolveTrusted、元数据/检查/后台入口形态；移除legacy裸变量回退、任意env名、description自由文本和旧Audit/Auth依赖，改严格命名空间/DTO、既有JWT/RBAC/写锁/审计owner及原子版本事件。没有整拷源模块或引入原secret/环境/数据。新增的AES-256-GCM本地只读适配器与显式SecretRefPort为本任务实现；源只有env，不能把加密本地能力伪称已迁实现。原redaction文件定向阅读但不复制成第二日志owner，现有全局安全错误和无值审计负责去敏。

ConfigurationModule公开消费唯一端口，Secret轮换与已绑定配置引用/版本/变更审计同事务；无Schema/迁移/依赖/Web变更。真实文件/HTTP/DB及合成下游协议测试，不连接真实Provider。源Git/index/定向hash和原15435容器元数据保持，未读原.env/客户/上传/历史迁移或连接原DB。许可证缺项和All rights reserved边界仍有效，不推定公开分发授权、不发布；详见[AF-023](../execution/AF-023.md)。

## 24. AF-024 审计查询与脱敏定向适配

2026-10-20，目标dev@208a1558b9c06f2328d2c361fd20bab8158442fd干净开始，AF-023接收。源HEAD仍cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb；仅定向读audit-log三文件、secret-center/redaction.ts，以及AdminService.listOperationLogs和对应/admin/logs入口（实际读取源服务475–534与Controller70–81），源Git/index/Schema/Admin与新增四文件hash见.artifacts/af-024/baseline.json。AuditLog owner仍AIJ core，F00 M03/M06；没有读取原日志记录、.env/客户/上传/历史迁移或连接源DB。

复用/admin/logs、admin.log.read、where/page/offset+count机制及redactText的Bearer/Key/赋值/PEM规则。源宽松query/完整row返回、错误operatorName字段、非稳定同时间排序不照搬，改严格DTO、实际userId、timezone边界、事务快照、正向安全投影。原审计Interceptor含业务分支且当前本库登录/管理/权限拒绝已经有唯一事务写入，不迁该Interceptor或新增写入Service，不制造第二套审计/重复记录。新detail与未知载荷隐藏是本库适配，不假称原实现已安全。

不修改原记录/原产品文件，不迁业务日志或关联。Schema/两迁移/manifests/锁/Web/现有Audit写入代码保持；来源许可缺项与All rights reserved限制延续，不推定公开分发授权、不发布。真实查询/拒绝/敏感载荷/DB故障与原历史不变校验见[AF-024](../execution/AF-024.md)，Trea待复核、人工待验。

## 25. AF-025-A 客户登录与会话认证定向适配

2026-10-20，目标dev@092295670115dae1db9acec6ed7f2944f95c1c73干净开始，负责人同意AF-025拆分且仅指派A。来源仍dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb；只定向读apps/api/src/client-auth中的client-auth.service.ts（login/createSession/sign/rate机制）、client-auth.guard.ts、client-auth.controller.ts（login/me）、client-auth.security.ts、client-auth.module.ts与dto.ts。六文件原SHA在.artifacts/af-025-a/source.json，源Git/index/Schema/Admin定向保护见baseline.json；不重扫原库或迁入其模块全量接口。

保留bcrypt邮箱登录、MemberUser/ClientAuthSession/tokenVersion持久化与Guard、独立JWT服务、HttpOnly Cookie、namespace HMAC和advisory lock rate桶机制，复用本库Prisma与AuditLog。移除原产品Cookie/issuer/开发fallback、旧AuditService/Notification/Challenge依赖、原始邮箱/IP/UA审计与多余JWT身份资料；仅迁login/me和ClientLoginDto，不复制register/forgot/reset/logout/revoke/consent/lifecycle/Workspace。新库改必填sessionId、当前DB状态、严格多Cookie/claims/Origin/DTO、原子签发/会话/审计回滚和并发凭据重验；这些为安全适配，不把源可选sessionId或回退密钥当作验收实现。

唯一ClientAuthModule公开Service/Guard并由宿主按CLIENT_AUTH_ENABLED消费，AuthErrorsModule只共享现有错误owner；管理员认证代码和客户身份分开。现有审计正向投影仅追加已实现客户三动作/member_auth/固定login路径，不开放任意字段。Schema/两迁移/manifest/锁/Web均不变，无第二Prisma/镜像实现，不移动/删除/写源文件，不读原.env/真实凭据/客户/上传/历史迁移或连接源15435。源Git/index/定向SHA保持，许可证缺项及All rights reserved边界延续，不推定MIT或公开分发授权、不发布。真实HTTP/DB/错误/并发/回滚/本机main证据与人工步骤见[AF-025-A记录](../execution/AF-025-A.md)。

## 26. UI-1 / AF-026–AF-029 管理员浏览器登录链

2026-10-27负责人明确批准4卡批次，保留AF-025-A待验叠加开发。源HEAD cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb；只读上述来源与原manifest，定向证据`.artifacts/ui-1/source.json`。M03管理员与M09客户身份保持分开；管理员复用本库Auth/Prisma/Seed/RBAC/审计，参考源ClientAuth的持久会话、版本撤销与现有凭据复核机制，适配为独立AdminAuthSession owner，不把原管理员仅记审计的logout算作撤销实现。

源Web `apps/web/app/login/page.tsx` 的Form/Input/Button与manifest Antd6.3.7作为定向复用起点；目标`apps/web/app/components/admin-auth.tsx`采用Cookie/CSRF，去掉原默认密码/localStorage Token/业务品牌与旧端口。未迁Refine后台壳或未用依赖；API/Next/React/Prisma版本保持，新增Antd精确版本及其解析依赖，不复制node_modules。

| 定向来源 | SHA-256 |
| --- | --- |
| apps/api/src/auth/auth.service.ts | fe1d324fb7c1b23380bdbe47f7289049a49d3330ea4ee2db24d5f1f179f24f33 |
| apps/api/src/client-auth/client-auth.service.ts | 13d4119ef9eda3bfdff46ec17827760d8ace5bae91f60989d81d7be94e12a4d7 |
| apps/api/src/client-auth/client-auth.security.ts | 6c0a0852fd6be307a5dfa8208ef1301aad963e01fad3e680aaccc0a5806c0b9e |
| apps/web/app/login/page.tsx | 01993655bb79bf9f3db32150eeb8718bb6acb7c48b84335990b73051d08539ef |
| apps/web/package.json | e756f778ad0dc627b177167cef1adac5fa4dab573162fe40c597d927c4f62be1 |

管理员会话模型/新迁移、浏览器Origin/CSRF/严格传输用途、任务服务管理及回归为本库适配增量，不冒充源有同等安全保证。原.env/历史migration/客户数据/上传目录未读取或复制，原库未连接；保留原许可证缺项和All rights reserved边界，不推定MIT或发布授权。

## NEXT-06 / AF-053 G10-01 Customer Workspace Schema

2026-10-29，目标基线 `dev@ec9eedc1f271ebc735a2947293b090b494f1932b`；只读源基线 `dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`。只定向核对 F00 M10、源 Prisma 的 `QingqiWorkspace`、`QingqiWorkspaceRole`、`QingqiWorkspaceRolePermission`、`QingqiWorkspaceMembership`、`QingqiPermission` 定义及 `qingqi-workspace.service.ts` 创建关系；没有读业务数据或连接原库。

目标仅定义空的 `ClientWorkspace*` 客户租户表与 additive migration `20261029030000_client_workspace`，不迁任何来源行。名字、成员和角色分别归客户 identity-organization owner，不使用 `ProjectProfile` 或管理员 `SysRole`。源 Workspace 对企业档案/产品域的反向关系被排除；创建时自动建立 CompanyProfile 的行为不迁。角色、成员、权限目录及其关联采用本库显式唯一键、同 Workspace 复合角色外键和 Restrict 删除策略。`QingqiWorkspaceInvitation` 与 `QingqiWorkspaceRoleHistory` 继续保留为未迁候选，不在 NEXT-06 的授权卡中提前实现。

来源与目标的当前归属状态更新见 [PRISMA_MODEL_OWNERSHIP.csv](../generated/PRISMA_MODEL_OWNERSHIP.csv) 与 [AF-053 执行记录](../execution/AF-053.md)。源仓库、index、文件与数据库只读；许可证/分发限制没有因本地抽取变化，也没有发布。
# NEXT-08 package audit (2026-10-30)

Target start baseline: `dev@41561c1f6f5d74cb9152f8246b705701dd30d091`; target worktree was clean. Read-only source baseline: `dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`, clean. Only package manifests, entry sources and LICENSE files listed below were read; no source files were changed.

| Read-only source path | SHA-256 | Finding and disposition |
| --- | --- | --- |
| `packages/foundation-core/package.json` | `da3cff8d20fb13be72804d8fceb637b52dc3322753972d0d369ba5f2da43ca98` | Local descriptor starter; not copied |
| `packages/foundation-core/src/index.js` | `8f7c63797f8b97478d5166e0fd6648c43746f9c51cb6cb299eeb9166e5c81eec` | Capability list/composition descriptor, not the API correlation implementation; not copied |
| `packages/foundation-core/LICENSE` | `85368c5dfbcb900ac1dd770883a82873865ee1bc02de1070dbf6ff03d079fb28` | `Copyright (c) weiyang86. All rights reserved.`; preserved as evidence, not copied into new target package |
| `packages/foundation-contracts/package.json` | `3993b310dd6d320c56e2ff02e598b44343ed06d6b25ff5536d78afb3a527383c` | Contract starter; not copied |
| `packages/foundation-contracts/src/index.js` | `4e1e1c25555f57336cd103da0135c9aa6babe7577f003e375eeab8d01c47091b` | Descriptor constants/function; not the actual API response contract; not copied |
| `packages/foundation-contracts/LICENSE` | `85368c5dfbcb900ac1dd770883a82873865ee1bc02de1070dbf6ff03d079fb28` | `Copyright (c) weiyang86. All rights reserved.` |
| `packages/plugin-sdk/package.json` | `1df05bda2b8d8b70f7f23a6ff0551f4107854b52cd9745bae53c56092caeee75` | Plugin package has no consumer in the current NEXT-08 scope; defer, do not create an unused SDK facade |
| `packages/plugin-sdk/src/index.ts` | `2721d0d3e75aba90e303c5bbeb80e8a1fecc0a02b5f84a6c9dc867b4b0d781b2` | Real manifest validator, reviewed only; defer to a plugin lifecycle card |
| `packages/plugin-sdk/LICENSE` | `85368c5dfbcb900ac1dd770883a82873865ee1bc02de1070dbf6ff03d079fb28` | `Copyright (c) weiyang86. All rights reserved.` |

The source root has no LICENSE/COPYING/NOTICE, so it does not establish the authorization scope for apps or permit package redistribution. The inspected source packages are not imported into this target. The target's current correlation helper is `apps/api/src/common/interceptors/correlation.interceptor.ts` (`0f129ff0a6f31fbb17037758afac17c5394f96f13ab2e94d769982dced426c11` at batch start). The actual Web helper and consumer are `apps/web/app/components/client-api.mjs` (`8eac07129751006eb516d1c912f12308925d0ca9b7cd3af4ab07c0e420ad2b4d`), `client-api.d.mts` (`79a4bb0fcc43e2b517299edb50942713999a835f73ae29082821daf472ed2dee`) and `client-workspaces.tsx` (`22a6a1ef755a256d2289468ce92d779b32116bab505258a92f111925caa5167c`). API response envelope source is `apps/api/src/common/interceptors/transform.interceptor.ts` (`554b1222d57db72d60402724963bba5c360bf5b6e7325178616b9ffcaf5b3c32`). These target files are internal migration candidates, not a statement of public licensing.

Any `@aij/*` package created in NEXT-08 is private and local-only (`license: UNLICENSED`). No original package's license is inferred or replaced, and no package is published.

## NEXT-08 G12-03 target package implementation

- `@aij/contracts` and `@aij/sdk` are new private target workspace packages (`UNLICENSED`, not publishable from this work). They were extracted from the target repository's already-audited API transform and Web client helper, not copied from the read-only source package prototypes.
- The API success-envelope projection is now owned by `packages/contracts/src/index.ts`; the browser request client/error mapper is now owned by `packages/sdk/src/index.ts`. The API interceptor and Web `client-api.mjs` are consumers/adapters, not parallel implementations.
- The source repository snapshot and its all-rights-reserved package declarations remain unchanged. No redistribution, publication, or open-source rights are inferred. See [AF-061](../execution/AF-061.md) for target files and verification.

## NEXT-08 / AF-060 `@aij/core` implementation

`@aij/core` is adapted from the already-migrated target implementation whose batch-start SHA is recorded above; no source-repository package file was copied. The shared correlation pattern, UUID fallback, request property and response header behavior now have one owner at `packages/core/src/index.ts`. The API's former pure functions were removed from `apps/api/src/common/interceptors/correlation.interceptor.ts`; that file imports/re-exports the package behavior and retains only Nest wiring. `apps/api/package.json` consumes it as `workspace:*` and the root lock records the local workspace link. API build plus an actual built Nest HTTP request proved the package is resolved at runtime. The package is private/UNLICENSED, with no third-party framework dependency and no publish authorization. Rights review remains pending before distribution.

## 15. NEXT-10 / G11-01 manifest adaptation (AF-067)

Date: 2026-10-30. The source checkout remains read-only at `dev@cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb`; its worktree was clean when checked. Source hashes match the earlier audit:

| Source path | SHA-256 | Use in this card |
| --- | --- | --- |
| `packages/plugin-sdk/src/index.ts` | `2721d0d3e75aba90e303c5bbeb80e8a1fecc0a02b5f84a6c9dc867b4b0d781b2` | Adapt manifest v2 declarations/validation concepts and SemVer compatibility into the existing API plugin-runtime owner; do not copy the plugin package or its lifecycle graph executor |
| `packages/plugin-sdk/LICENSE` | `85368c5dfbcb900ac1dd770883a82873865ee1bc02de1070dbf6ff03d079fb28` | Exact notice retained at `apps/api/src/plugin-runtime/PLUGIN_SDK_LICENSE.txt` |

The source states `Copyright (c) weiyang86. All rights reserved.` The target adaptation is private in-repository work with preserved attribution; it does not infer permission to publish, redistribute or release a package. No plugin package was created because the existing API runtime is the real consumer and remains the single implementation owner. The adaptation validates declaration shape, supported SemVer ranges, plugin-scoped permission metadata, path/config/lifecycle/migration declarations, and a static Nest module allowlist. It deliberately does not resolve dependency graphs (G11-05), persist lifecycle state, execute migrations or hooks, expose management routes, or start a plugin. See [PLUGIN_MANIFEST](../development/PLUGIN_MANIFEST.md) and [AF-067](../execution/AF-067.md).


## AF-174 新增网页正文提取运行时依赖（2026-11-06）

本卡源码由本库注册Worker编写，未复制轻企源码、网页站点正文或第三方parser源码。根在明确STOPPED后唯一新增API runtime依赖htmlparser2精确10.1.0并由pnpm生成integrity锁；原全部importers/包版本/snapshots不变，仅该依赖及7个新锁包。不是整体技术栈升级，也不改变本库UNLICENSED/原来源权利或公开发布授权。

官方来源：[htmlparser2 v10.1.0 package](https://raw.githubusercontent.com/fb55/htmlparser2/v10.1.0/package.json)、[release](https://github.com/fb55/htmlparser2/releases/tag/v10.1.0)。实际installed package的CJS/ESM exports和LICENSE文件已回读；选此精确版兼容现有CommonJS API，Worker scratch证据与正式runtime编译验收分别记录。MIT/BSD声明仅适用于对应依赖，实际安装原LICENSE保留在其包内，无vendor或改写声明。

| 实际运行时包 | package声明许可 | 原许可证文件与哈希 |
| --- | --- | --- |
| htmlparser2@10.1.0 | MIT | LICENSE SHA256 204cfa747341660e4da64cd23e8c876c6b20279d247f48564993d3fc4a2eab47 |
| domelementtype@2.3.0 | BSD-2-Clause | LICENSE SHA256 cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164 |
| domhandler@5.0.3 | BSD-2-Clause | LICENSE SHA256 cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164 |
| domutils@3.2.2 | BSD-2-Clause | LICENSE SHA256 cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164 |
| dom-serializer@2.0.0 | MIT | LICENSE SHA256 94cfe87de9b178e8fee313a19178e625129e2ce559db32e772e7bd95114ee6ff |
| entities@4.5.0 | BSD-2-Clause | LICENSE SHA256 cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164 |
| entities@7.0.1 | BSD-2-Clause | LICENSE SHA256 cb992345949ccd6e8394b2cd6c465f7b897c864f845937dbf64e8997f389e164 |

7个新锁package包含两条entities版本：Parser自身7.0.1，dom-serializer传递4.5.0；没有用旧版覆盖或隐去实际依赖链。完整integrity见pnpm-lock.yaml，安装许可证据在本卡ignored runtime-dependencies.json。首次许可枚举误读dist/commonjs/package.json模块类型stub，无name，被发现后改为向上查找真实有name的package再哈希；初次结果单独保留，不作许可证证据。

本卡执行pnpm audit --prod --json的exit1报告37条（critical5/high18/moderate12/low2），均涉及本次保持原锁版本的其他依赖；新增7包对应advisory0。不能宣称整个产品安全扫描通过，已有依赖风险需独立安全修复卡核验处理，正式发布安全验收仍待完成；未在本卡顺带升级栈、忽略或抹除发现。报告和具体advisory链接保留于ignored production-audit.json及执行记录。


## AF-175 专用Python镜像验收来源（2026-11-06）

源代码是本库注册Worker实现，无轻企/第三方源码拷贝或新npm依赖。根现有Dockerdaemon从官方docker.io/library/python:3.13-slim-bookworm拉取，仅固定OCIindex sha256:a5a7017efc5969e00ae2b91c8eb0631049a569652aa4ffc4501769049ae45c72用于实际linux/arm64验收，image identity/RepoDigests/descriptor回读于本卡ignored image-receipt.json；生产配置默认关闭，不能由用户选择镜像/挂载/参数。参考[官方Dockerfile](https://github.com/docker-library/python/blob/master/3.13/slim-bookworm/Dockerfile)与[Docker隔离/权限说明](https://docs.docker.com/engine/containers/run/)。镜像包含Python及基础发行版各自组件，未以“官方镜像”推定统一许可或本库再分发权，正式分发仍须单独清单与授权核验；本次仅本机测试、未发布镜像。12专用容器完成后确认全部删除，固定镜像缓存保留，其他项目资源未动。


## AF-177 配对安全依赖升级（2026-11-06）

只更新Next/eslint-config-next16.2.6→16.4.1及其实际传递闭包，无第三方源码vendor/轻企复制。官方[Next发布](https://github.com/vercel/next.js/releases/tag/v16.4.1)、[Next registry](https://registry.npmjs.org/next/16.4.1)、[配置registry](https://registry.npmjs.org/eslint-config-next/16.4.1)的tarball/SRI、engine/peer已回读。54新锁包/2importer变化均属配对闭包，原共有包integrity未变；23个本机实际安装，31个不适用平台仅锁定，未冒充Linux目标实测。第一次枚举误按isolated布局得到0，已按本库hoisted实际路径递归读取package定位，最终证据runtime-dependencies.json；不把首次枚举当许可证明。

下列哈希来自实际安装原许可证文件，未修改/另行复制许可证声明。5个包未附独立LICENSE文件，只有package声明（Next原主包license.md存在）；不虚构许可证文件或以MIT统一覆盖依赖。libvips明确LGPL-3.0-or-later且包含基础库，其组件/再分发义务仍需正式发布前清单与许可核验，不能以本次本机测试代替。本库UNLICENSED和原代码来源限制不变、无包/镜像/制品发布。

| 实际安装包 | package许可声明 | 原文件证据 |
| --- | --- | --- |
| @eslint-community/eslint-utils@4.9.1 | MIT | LICENSE SHA256 fcf6eabf68ca96988a6b506b4fdc6cc32535d80eb2e11c79724af5ac6f50262b |
| @img/sharp-darwin-arm64@0.35.5 | Apache-2.0 | LICENSE SHA256 73ba74dfaa520b49a401b5d21459a8523a146f3b7518a833eea5efa85130bf68 |
| @img/sharp-libvips-darwin-arm64@1.3.4 | LGPL-3.0-or-later | 未附独立许可证文件，仅记录package声明 |
| @next/env@16.4.1 | MIT | 未附独立许可证文件，仅记录package声明 |
| @next/eslint-plugin-next@16.4.1 | MIT | 未附独立许可证文件，仅记录package声明 |
| @next/swc-darwin-arm64@16.4.1 | MIT | 未附独立许可证文件，仅记录package声明 |
| @swc/helpers@0.5.23 | Apache-2.0 | LICENSE SHA256 d96eba1f1881334d50ffc144276dfa98e147a415e7c591ecdfcb81680361dc91 |
| @typescript-eslint/eslint-plugin@8.72.1 | MIT | LICENSE SHA256 2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0 |
| @typescript-eslint/parser@8.72.1 | MIT | LICENSE SHA256 2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0 |
| @typescript-eslint/project-service@8.72.1 | MIT | LICENSE SHA256 053a75a14b7508a897466b65e12797201a06b0e9b5066d1223da72cac99601b5 |
| @typescript-eslint/scope-manager@8.72.1 | MIT | LICENSE SHA256 2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0 |
| @typescript-eslint/tsconfig-utils@8.72.1 | MIT | LICENSE SHA256 053a75a14b7508a897466b65e12797201a06b0e9b5066d1223da72cac99601b5 |
| @typescript-eslint/type-utils@8.72.1 | MIT | LICENSE SHA256 f3c51ace7f159b21566d72535e84ff354505ae7ffdca835dac81fcdafbf9e879 |
| @typescript-eslint/types@8.72.1 | MIT | LICENSE SHA256 2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0 |
| @typescript-eslint/typescript-estree@8.72.1 | MIT | LICENSE SHA256 2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0 |
| @typescript-eslint/utils@8.72.1 | MIT | LICENSE SHA256 2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0 |
| @typescript-eslint/visitor-keys@8.72.1 | MIT | LICENSE SHA256 2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0 |
| eslint-config-next@16.4.1 | MIT | 未附独立许可证文件，仅记录package声明 |
| eslint-visitor-keys@5.0.1 | Apache-2.0 | LICENSE SHA256 d8bf34ff6d190640a01e7704ad78253fc181bc128949d71273fbbaa12f33c0b4 |
| next@16.4.1 | MIT | license.md SHA256 ee765244e2d59f5234d474f62e0766fa0c8b99af967fdd4c0cb8dcb0c76ea224 |
| postcss@8.5.23 | MIT | LICENSE SHA256 5be1f3465bba68a626777f984878814aaf35e7ef8e9fd314d469bcf887050fb8 |
| sharp@0.35.5 | Apache-2.0 | LICENSE SHA256 73ba74dfaa520b49a401b5d21459a8523a146f3b7518a833eea5efa85130bf68 |
| typescript-eslint@8.72.1 | MIT | LICENSE SHA256 2eb5c7a0bba9deb77a98c81bf6b9d3fb1c67118eebf968b6b1a787b3f8928ee0 |

最终真实audit critical0而仍有10项非critical，完整产品安全与发布验收仍待完成；AF174历史37项不删改。实际构建/API/SDK/PG/native浏览器和清理见AF177执行记录。


## AF-179 来源元数据与网页导入接线（2026-11-06）

同仓库注册Worker源码及root能力组合，无轻企/第三方源码复制、无新依赖、AF177安全锁保持字节相同。复用AF171 reader与AF174 parser，不把自有合成HTML fixture当外站授权文本；TLS证书为临时自签名仅测试并已删除。SDK本地tarball/四消费者是私有验收，不是包发布授权。四nullable字段/SQL与auth-owner只读会话复检为本库新实现，旧Owner来源记录保持。无网页自动更新/发布/第三方制品分发承诺；真实公网/厂商及分发许可/剩余依赖安全仍待验。


## AF-181 生产高危依赖修复来源（2026-11-06）

注册 Worker 候选 2e719c38f2c822ac78d5e00d2e19b77a4862e852 的六文件定向差异由总控集成，不包含只读 bootstrap；未复制轻企源码。根工作区保留 Prisma 6，仅 CLI/client 成对升级 6.19.3，两个限定依赖边覆盖 deepmerge-ts 8.0.0 和 multer 2.5.0；Express 现有范围内更新 body-parser/qs。13 个实际新增锁包均从官方 registry 重取元数据、下载 tarball 核对 SHA512/SRI，并核对实际安装版本、许可证声明和独立 LICENSE 文件 SHA256，全部通过，记录见 [AF-181 依赖来源收据](../execution/AF-181-dependency-provenance.json)。没有新增包缺少独立 LICENSE 文件。原有未变更包的许可证和发布限制仍按历史记录处理。

Prisma 官方 6.19.3 闭包中的内部 @prisma/engines-version 版本为 7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7，未伪称所有内部包都是 6.19.3；API/client/CLI 保持 6.19.3，实际生成 client 的 engine hash 另与该官方依赖核对。deepmerge 8 的 Map/循环行为变化保留在条件方案中，只在本库现有 schema-only Prisma 配置边界完成兼容验证；增加配置输入或更换 config/c12 时须重新检查。许可证声明与下载校验不是公开发布、再分发或负责人接收授权。原失败记录和 AF-177 剩余高危历史均保留，最终实测以 AF-181 执行记录为准。


## AF-182 网页导入与来源页面（2026-11-06）

本仓库注册Worker九路径候选及七路径同卡修正，source-only bootstrap未作为产品差异集成；没有轻企代码或第三方源码迁入、没有新依赖/锁变化。公共SDK复用AF179当前实包，界面保留现有AntD主题。组件验证使用实际已安装ReactDOM/rc焦点锁和本卡自有最小DOM host，明确不是完整浏览器。真实合成HTTPS临时密钥/证书在root验收结束已删除；合成URL和导入正文是自有fixture，未访问公共付费厂商。来源/许可证和安全发布历史仍保留，CODE_VERIFIED不是分发授权。


## AF-183 原生检索协议（2026-11-06）

同仓库注册Orca Worker五个新路径，无bootstrap或轻企源码复制。只使用Node内建类型/stream/fetch原传输，无新依赖、锁变化、网络owner或制品发布；协议模型/端点依据候选记录中的阿里云官方原生API文档。Root真实HTTP仅自有合成loopback，不是官方厂商成功调用。保留Node/Undici压缩尾部宽容的真实保证边界，不提供独立CRC证明；本库后续更换原传输须重验。


## AF-197 文档生成依赖与中文字体来源（2026-11-07）

本仓库注册Orca Worker的有界纯文本文档生成器、CLI与依赖闭包工具，由root接收843源码bootstrap之后的6文件总候选，不迁入bootstrap或其他产品源码。root仅新增docx9.15.2、pdfkit0.20.2及开发types0.17.7；21个新锁节点的官方registry元数据、tarball SHA512/SRI与实际安装package.json字节已逐一核对，既有792个锁包节点未改动，详见[依赖来源收据](../execution/AF-197-dependency-provenance.json)。这不是栈整体升级，实际运行仍Node24。

独立许可证文件的原始hash记录在收据中；brotli、dfa、fontkit的官方npm包没有独立LICENSE文件，仅有发布者package.json的MIT声明和保留的源码/README，不能把它写成已核实完整独立许可证文本或公开分发授权。生成闭包保留包内原始文件与声明。原产品来源、许可证不明及发布限制继续保留，不因新增依赖推定本仓库为MIT。

NotoSansCJKsc-Regular.otf（16437364字节，SHA256 2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b）及完整SIL Open Font License1.1文本（SHA256 6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2）来自notofonts/noto-cjk固定commit f8d157532fbfaeda587e826d4cd5b21a49186f7c的Sans/OTF/SimplifiedChinese与Sans/LICENSE，存放assets/document-fonts并随闭包保留许可。精确原始URL见W16/RENDERER_DEPENDENCY_PLAN。没有改字库内容或推定其他字体许可；真实字体覆盖、文件格式与Linux阅读器表现由本卡实际门禁另外验证。
