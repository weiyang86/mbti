# AF-022 分层配置与公开上下文API

AF-036 当前增量：新增后台页`/auth/configuration`，消费下列现有接口显示项目/组织状态、配置层级/版本、后端解析结果、审计关联和匿名公开上下文预览。页面只提供当前固定schema中的非secret配置项选择器；后端DTO/schema、RBAC、scope、expectedVersion仍为权威，页面目录不扩展API能力。公开预览只渲染projectCode、brand白名单、capabilities白名单和enabledPlugins；secretRef与非公开字段不渲染。409明确提示版本冲突并刷新数据。API、Schema和敏感配置owner不变，状态以[AF-036执行记录](../execution/AF-036.md)为准。

AF-023当前增量：已接收AF-022；SecretRefPort及env/加密本地SecretStore已接入。敏感配置写额外要求admin.secret.manage，--configuration显式登记该权限依赖但不修复grant；local://引用可绑定，轮换时原子重绑/version+1，清除后消费拒绝。原阶段描述按历史保留，当前协议/实际地址与凭据路径见[密钥引用指南](SECRET_CENTER_API.md)。

唯一实现为configuration模块，定向适配来源同名模块的scopeIdFor/chooseConfigCandidate、可信项目上下文、读写/投影机制。复用既有Prisma、全局JWT/RBAC、ManagementAccessService写锁/审计。Schema与两份迁移不变；不迁SysConfig旧fallback、原品牌/客户/默认Prompt或环境绑定。项目组织是运营归属，不是客户Workspace权限边界。

## 1. 接口与可信上下文

前缀`/api`，统一响应/安全错误/关联ID，`Cache-Control: no-store`。ConfigurationModule仅在AUTH_ENABLED时装配；公开路径明确在admin之外，不新增admin认证例外。

| 方法/路径 | 要求与结果 |
| --- | --- |
| GET `/project/context` | 匿名；固定公开投影，无任意配置字典 |
| GET `/admin/project-profile` | active admin.config.manage；仅ID/code/status/updatedAt和组织ID/status，停用时供恢复 |
| PATCH `/admin/project-profile` | 同上且真正DB超级；status+expectedUpdatedAt，乐观校验后返回新时间戳 |
| GET `/admin/scoped-configs` | 同一管理权限；可选scope/scopeId，当前可信项目的三层配置列表，敏感值隐藏 |
| PUT `/admin/scoped-configs/:key` | 同上；创建expectedVersion=0、更新须匹配当前版本；global写另需DB超级 |
| GET `/admin/scoped-configs/:key/resolved` | 同上；返回当前有效来源/版本/安全值或默认值，敏感引用始终隐藏 |
| GET `/admin/configuration-changes` | 同上；最近100条安全关联元数据，含configVersion/auditLogId，不含配置值 |

管理路径匿名401、无grant403；权限来自当前DB，不信任前端按钮/Token附加角色/客户端workspaceId。普通已授权配置管理者可写当前项目/归属组织，不能写global或停启项目。写锁后同事务复查权限/项目状态；无权限缓存。

运行时`projectId`与`environment`确定项目code=`<projectId>-<environment>`，例如宿主test对应Seed的aij-foundation-test，development对应aij-foundation-development。数据库项目environment必须一致，组织/项目均不得软删。缺项目404、不自动创建；停用项目或组织时公开上下文、配置读/解析/写/变更列表403。仍允许有权限的profile读取，DB超级按最新时间戳恢复项目；组织状态无本项CRUD。health/ready、JWT和其他管理API不因项目配置状态停用而被宣称停机或撤销。

## 2. 固定配置schema与解析

| key | valueType与值 | 可公开/默认 |
| --- | --- | --- |
| brand.displayName | string，1–64字符非空单行，拒绝凭据标记/HTML | 可；默认AIJ |
| brand.primaryColor | string，`#RRGGBB` | 可；默认#2563EB |
| brand.logoPath | string，规范本地路径，允许svg/png/jpg/webp后缀，不允许外部地址/点段/查询 | 可；默认/；不下载或确认图片资源已存在 |
| capabilities.publicContextEnabled | boolean，configValue严格为字符串true/false | 可；默认true |
| internal.retentionDays | number，configValue为1–365的规范整数字符串 | 不可；默认30，仅提供配置值，不执行数据清理 |
| private.integrationRef | secretRef，仅`env://AIJ_...`规范引用，须已有active SecretReference元数据 | 不可；无默认；不解析环境值/连接Provider |

PUT必需scope、configValue、valueType、isPublic、status、expectedVersion；scope仅global/organization/project，scopeId可选。global的ID固定global，organization来自真实项目FK，project来自当前项目ID；自报不匹配403，plugin/workspace等范围或多余字段400。插件配置/任意JSON/环境脚本键未注册即拒绝，不能通过body扩展schema。

未知key、错误类型/值、敏感isPublic=true、明文密钥/未知引用、负数版本/超字段400；缺grant403；旧版本/并发竞争409。敏感性由服务端定义决定，客户端不能用sensitive=false降级。没有SecretReference注册/环境adapter，本项只校验既有元数据并保存引用，引用值即使管理员也不通过API返回；metadata的referenceConfigured不证明实际外部凭据已配置。

三层优先级project > organization > global > 固定默认；只考虑active未删且pluginCode为空、scopeId精确匹配可信上下文的记录。disabled条目回退下层；无删除/移动/硬删/历史值恢复API。先选最高层，再做公开过滤，私有/敏感高层会隐藏该公开字段，绝不因为被过滤而暴露较低公开值。未知旧key即使isPublic=true也不进入公开上下文；管理列表仅给其安全元数据。源SysConfig/旧环境fallback未迁入。

公开结果仅projectCode、brand(displayName/primaryColor/logoPath)、capabilities、enabledPlugins。没有legalEntity、原始profile.brand、组织meta/名称、私有配置/密钥引用/客户资料。auth/database/storage与enabledPlugins来自实际启动配置；不以数据库中的PluginInstallation状态伪造运行能力。

capabilities.publicContextEnabled=false的有效配置使`/project/context`返回403，true恢复；将该条目status=disabled会按下层/默认解析。其他品牌/公开标志改动在提交后下一请求生效；在途RepeatableRead按其快照结束。它不重启进程、不安装插件、不改变env/issuer/端口/DB配置、不执行任意脚本。未来新配置键必须由owner显式注册类型与消费者，不能把当前开关当完整插件生命周期。

## 3. 版本、审计与校验

既有ScopedConfig.version初始1，每次匹配expectedVersion后+1，包括停用/重新启用/同值更新。创建只能expectedVersion=0；并发相同版本仅一个成功，其他409且零成功审计/变更。configId+configVersion唯一约束保留，历史版本不随当前version修改。

写入、共享成功审计与ConfigurationChange在同一数据库写锁/事务中提交。审计保存操作者、资源ID、关联ID、改变字段名；变更保存configId/configVersion/auditLogId、scope/key及previousVersion/类型/敏感标志，不记录值/密钥/名称/PII。项目状态事件按project.profile关联auditLogId，configId/version为空。历史记录用于追溯版本/操作者/关联，不是完整旧值快照或自动恢复器。任何审计或变更插入失败503全回滚，无孤立审计。

```bash
pnpm run verify:task -- AF-022
pnpm run lint
pnpm run typecheck
```

注册复用AF-021实际回归并追加本项真实HTTP/DB、真实main生命周期；准确数量/命令与退出码见执行记录。只写声明的合成验收库和忽略产物，不改源码探针、不启停DB容器；真实audit/change失败trigger/function仅自身新库创建并移除。Schema/两迁移保持，实际Prisma validate/generate/API构建运行，不冒用未运行的Web构建。

显式Seed --configuration只经目标/迁移保护注册admin.config.manage，不给已有角色补grant/恢复停用定义、不初始化配置值/品牌或执行脚本，默认七行Seed不变。准备钩子`pnpm run verify:task -- AF-022 --prepare-manual`只恢复本任务合成三账号/库/API，既有密码/角色不重置；Trea不运行prepare，PREPARED不替人工通过。

## 4. 人工步骤（负责人待执行）

1. 读取`.artifacts/af-022/manual.json`当前地址/PID；aij-admin密码从initialPasswordFile读，af022-manager/af022-reader从accounts[0].initialPasswordFile按username取。密码仅本机内存配置，不回显、不把Token贴报告；手动改密后文件只代表首次值，prepare不恢复密码。
2. 三账号POST /auth/login均200。root/manager GET /admin/scoped-configs为200，reader403，无Bearer401。匿名GET /project/context默认brand=AIJ/#2563EB/本地路径/，插件空集合；没有客户或私有字段。
3. root PUT /admin/scoped-configs/brand.displayName，body为`{scope:"global",configValue:"AIJ 合成全局",valueType:"string",isPublic:true,status:"active",expectedVersion:0}`。返回version1，公开值来自global；manager写global403。用organization、project同样创建值，最后project覆盖组织、组织覆盖全局；scopeId取受控profile.organization.id/profile.id，伪造ID403。
4. 更新已有条目必须用最新version；重复用旧版本409，无数据/审计部分写。停用project条目需完整PUT并status=disabled，回退组织；高层active且isPublic=false应隐藏字段，不显示较低公开值。返回的configValue为解析类型；提交仍按schema发送字符串值。
5. reader直调管理解析/写/变更API403；未知key/错误类型/脚本环境键400。敏感引用没有本项注册接口，不为了演示填真实Key；只核对自动合成引用测试的redacted证据，不用metadata成功冒充外部接入。
6. root GET /admin/project-profile，按updatedAt PATCH `{status:"disabled",expectedUpdatedAt:<时间戳>}`。公开/配置入口403，profile GET仍200；用旧时间戳恢复409，用最新时间戳恢复200。health/ready200，既有JWT不因此永久失效。
7. PUT capabilities.publicContextEnabled，valueType=boolean、configValue="false"，其余字段完整、版本正确→public context403；改"true"恢复。进程/端口/env/插件集合保持。GET /admin/configuration-changes核对版本及auditLogId；用当前库安全连接只读核对audit_log关联，报告不含密码/hash/Token/配置敏感值。
8. 复跑普通verify前由Writer运行`node scripts/verification/configuration-manual.mjs stop`，核验确切PID/PPID/CWD/命令/birth后仅停自有API并确认零池；保留库/卷/凭据。恢复走注册prepare；运行时整套prepare的端口空闲前置会拒绝，不跳过它，内部重复prepare保持原PID/凭据。无reset/drop/down -v，不按端口批量kill。

安全Node示例（只输出业务响应，不输出登录响应或Token）：

```js
const fs=await import('node:fs');
const s=JSON.parse(fs.readFileSync('.artifacts/af-022/manual.json'));
const a=JSON.parse(fs.readFileSync(s.initialPasswordFile));
const r=await fetch(s.loginUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:a.username,password:a.password})});
if(r.status!==200)throw Error('Login failed; no reset');
const token=(await r.json()).data.accessToken;
const configs=await fetch('http://127.0.0.1:3656/api/admin/scoped-configs',{headers:{authorization:'Bearer '+token}});
console.log(configs.status,await configs.json());
```

## 5. 本轮实际入口

以AF-022执行记录和本机manual.json为准；初始配置列表为空、公开值来自安全默认。人工验收仍待负责人执行。

当前普通verify报告`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.artifacts/verification/AF-022/run-yvLLG7/report.json`：206+2，exit0/PASS。人工API **PID 5626**，启动Mon Oct 19 23:03:23 2026，CWD=`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/apps/api`，本机Node运行本库dist/main.js，仅127.0.0.1:3656，一条有意保留池，Web3655未启动。

- 公开URL：`http://localhost:3656/api/project/context`；管理URL：`http://localhost:3656/api/admin/scoped-configs`、`/api/admin/project-profile`。当前公开安全默认200，管理无Bearer401，health/ready200。
- 合成库`aij_foundation_af022_test_cdfa68db16b50950`，127.0.0.1:55433，用户`aij_foundation_test`。root/manager/reader实际login/me/本人权限200，配置列表200/200/403；初始scope配置为空，默认AIJ，非原产品品牌。
- aij-admin初始密码仅`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af022_test_cdfa68db16b50950/initial-admin.json`；af022-manager/af022-reader按username读`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af022_test_cdfa68db16b50950/rbac-management-accounts.json`。DB密码仅`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/postgres/test/postgres-password`；均本机Git忽略，不回显密码/hash/完整Token/Key。
- 停止：`node scripts/verification/configuration-manual.mjs stop`，核验记录PID/PPID/CWD/命令/birth后只停自身API并确认零池；保留库/卷/凭据。恢复：`pnpm run verify:task -- AF-022 --prepare-manual`。

**Trea待复核、人工待验**，自动观察不替代负责人操作；未commit/push/发行/部署。
