# AF-021 字典分类与条目API

AF-022当前服务/优先级/版本/公开过滤与实际人工API见[配置指南](CONFIGURATION_API.md)；本文原阶段模型数、旧PID与未实现状态按历史保留，不作当前进程归属或完整功能结论。

仅定向迁入通用SysDict/SysDictItem和原AdminService字典方法。唯一实现为DictionariesModule/Controller/Service/DTO；宿主只在AUTH_ENABLED时装配。复用Prisma、JWT、统一admin RBAC与ManagementAccessService的同一数据库写锁/事务内判权/安全审计；不依赖AI或业务模块。

## 1. 接口

路径前缀`/api`，统一`{success,data,message}`、关联ID和`Cache-Control: no-store`；全部管理接口要求当前有效`admin.dict.manage`（DB超级也不能绕过不存在/停用定义）。匿名401、无grant403；写事务锁后重新判权。公开接口明确在admin命名空间之外，不扩大admin认证例外。

| 方法/路径 | 参数及结果 |
| --- | --- |
| GET `/admin/dicts` | page/pageSize/q/status；分页分类 |
| POST `/admin/dicts` | dictCode/dictName必需；创建201 `{id}` |
| PATCH `/admin/dicts/:id` | dictName/description/sortOrder/status/isPublic；200 `{id}` |
| DELETE `/admin/dicts/:id` | 有未软删条目409；否则软删200 `{id,deleted:true}` |
| GET `/admin/dicts/:id/items` | page/pageSize/q/status；分页条目 |
| POST `/admin/dicts/:id/items` | itemValue/itemLabel必需；父分类须active；201 `{id}` |
| PATCH `/admin/dict-items/:id` | itemLabel/description/sortOrder/status；200 `{id}` |
| DELETE `/admin/dict-items/:id` | 软删200 `{id,deleted:true}` |
| GET `/dictionaries/:dictCode/items` | 明确匿名公开；仅page/pageSize；安全投影分页 |

## 1.1 管理页面（AF-035 / G6-01）

后台页面位于`/auth/dictionaries`，由`AdminShell`要求`admin.dict.manage`；后端菜单可用页面目录仅在路由实际交付后登记此路径。页面复用本节API，不新增第二套字典服务或数据模型。分类和条目使用服务端分页、筛选及稳定的`sortOrder,id`顺序；表格列可对当前页排序。编码创建后不可修改，重复分类编码/条目值显示服务端409；分类/条目停用、软删除与公开过滤继续由API执行。插件归属分类只读，页面操作权限不替代API Guard。

分页返回`{items,total,page,pageSize}`；page=[1,10000]、pageSize=[1,100]，默认1/20，越界/非整数/多余参数400。管理q≤64字符，status为active/disabled；sortOrder为[-10000,10000]整数。同层/分类条目均sortOrder升序、id升序，分页与total在同一RepeatableRead快照中计算。

创建分类只允许`custom.`前缀的规范小写code（8–96字符）；条目itemValue为1–64字符小写标识（字母开头，允许分隔`.`/`_`/`-`）；分类名/标签为1–64字符非空白文字。description可null或≤256字符。默认status=active、sortOrder=0、isPublic=false；不使用通用凭据、业务数据或业务Prompt。

分类dictCode全局唯一；条目itemValue在dictId内唯一、不同分类可同值。两者创建后不可改名或移动，DTO超字段/空修改/非法null/类型均400，重复含并发/软删占位409。不把ES2022 DTO中undefined字段写回默认值。

## 2. 公开、安全与引用策略

- 匿名接口仅返回`isPublic=true`且active、未删分类下active未删条目，字段仅itemLabel/itemValue/sortOrder。未知/私有/停用/已删分类返回相同空分页，不泄露私有元数据。携带Token不会扩大公开范围；不能用status=disabled或客户端pluginCode/workspaceId覆盖过滤。
- 分类停用立刻隐藏全部后代，不重写其状态；重启用只恢复原本active条目。停用分类不能创建新条目或重新启用条目。条目停用/软删立即从公开结果消失。
- 分类/条目均软删，稳定ID/code/value及唯一占位永久保留，本项不提供硬删/改code/移动/恢复API。分类有任意未软删条目（包括disabled）则删除409；条目全部软删后分类可软删，但历史行仍保留。
- 本库Schema的item→dict为ON DELETE RESTRICT、ON UPDATE CASCADE；没有业务FK/客户数据。测试在自己新库的`af021_verification.reference`保存一个合成实际FK引用，证明软删后仍可按相同ID/value追溯，直接硬删因FK失败；该合成fixture保留供复核，未DROP/清现有表。
- 外部业务owner应引用稳定ID/值，并在新业务输入时检查当前有效状态；本项不修改未来消费者或宣称通用引用发现器已实现。软删/停用不删除历史引用，也不表示该值仍可用于新交易。
- pluginCode为预留owner字段，不可由管理DTO自报/接管。插件归属分类在core API中不可写，公开读取还要求运行时插件启用；当前迁入插件白名单为空，实际业务插件注册/生命周期未实现，后续须由所属插件定向注册其数据。本项不迁原业务分类、不创建假的已安装插件。管理API只管理custom命名空间。
- 成功审计module=dictionaries，action=dict_created/updated/deleted、dict_item_created/updated/deleted；同事务只写操作者/资源ID/关联ID/字段名，不保存名称/描述/密码/hash/Token。审计失败整笔写回滚503，权限拒绝审计仍由既有RBAC owner负责；不是通用审计查询API。

## 3. Schema、迁移与校验

迁入两个core模型（来源SysDict/SysDictItem，F00 M02/M18），新增isPublic默认false、pluginCode预留owner及显式RESTRICT。新增迁移`20261019010000_dictionaries`由accepted Schema→本库目标Schema的Prisma diff生成，只建两表/索引/FK；原`20261019000000_initial`字节保持。Prisma方向仍6.19，无依赖升级。

AF-021只在自身新空验收库deploy完整两迁移；第二次deploy及status账本一致。原dev/test和旧验收库不迁移、不seed。旧验收记录绑定旧Schema hash，不通过改归属文件绕过；其普通任务测试不能用作新Schema通过证据。

```bash
pnpm run verify:task -- AF-021
pnpm run lint
pnpm run typecheck
```

注册复用无持久化的配置/目标/执行器/metadata/宿主检查，再在新AF-021库执行字典及当前JWT/RBAC/菜单/用户读拒绝/迁移/readiness回归、真实main生命周期。未继承需复用旧Schema验收库的Seed/人工服务测试，不宣称前序312项在新Schema全量通过。数量与逐条命令见执行记录。

显式Seed `--dictionaries`仅经目标/迁移核验注册admin.dict.manage定义，不修复已有状态/grant、不创建默认分类/条目；默认七行Seed保持。测试/人工fixture都是新合成账号/角色，无原业务分类。不能直接对旧dev/test运行本次deploy/seed来试验。

Writer可运行已注册`pnpm run verify:task -- AF-021 --prepare-manual`，仅准备本任务合成库/三账号/API；已有账号/密码/角色不重置，初始字典为空。Trea不运行prepare；PREPARED不替人工通过。

## 4. 人工步骤（负责人待执行）

1. 按`.artifacts/af-021/manual.json`取当前API/PID和账号文件。aij-admin初始密码从initialPasswordFile读，af021-manager/af021-reader从accounts[0].initialPasswordFile按username读。只在本机内存配置密码；手工改密后文件仅为首次值，prepare不重置。不要读取/分享JWT key来登录。
2. 三账号POST `/api/auth/login`应200；仅在内存保留返回Token。aij-admin和af021-manager GET `/api/admin/dicts`200，af021-reader403，不带Token401。匿名GET `/api/dictionaries/custom.af021.manual/items`应200空分页；Web字典页面未实现。
3. 管理账号POST dicts：`{dictCode:"custom.af021.manual",dictName:"合成通用状态",isPublic:false}`→201。相同code再建→409。POST dicts/:id/items建`{itemValue:"enabled",itemLabel:"合成启用",sortOrder:2}`和`{itemValue:"disabled",itemLabel:"合成停用",sortOrder:1}`→201。管理分页pageSize=1按顺序返回，无重复；page=3空；page=0/pageSize=101→400。
4. 分类默认私有，匿名结果为空；PATCH分类`{isPublic:true}`后公开只返回标签/值/顺序，不含description/id/owner。停用条目后公开不返回该项；停用分类后公开全部空，重启用只恢复有效项。给公开查询附status=disabled→400。
5. reader直调写接口403；管理账号改dictCode/itemValue、传pluginCode/workspaceId或类型错误400。分类有条目删除409；先软删条目后可软删分类，历史ID和值仍保留，相同code/value不可复用409。若重复观察，不重新建已占位code；按现场已有记录继续，或用新的custom.af021.manual命名空间后缀，不清库。
6. 用记录中的角色/密码文件在本机安全配置DB客户端，只连127.0.0.1:55433/当前任务合成库，核对system_dict/system_dict_item历史与audit_log中dictionaries模块的6种action/关联ID/操作者。不要把密码/hash/Token或业务输入复制到报告。自动测试的引用probe在其独立测试库证据目录，不等于当前人工库有业务引用。
7. 需复跑普通verify时交回Writer执行`node scripts/verification/dictionaries-manual.mjs stop`，核验PID/PPID/CWD/命令/birth且零池后停止记录的自有API；保留库/卷/凭据。不按端口kill、不reset/drop/down -v。恢复由Writer执行注册prepare；当前API运行时整套prepare的空闲端口前置会拒绝，内部重复准备保持PID/凭据不变。

安全Node调用例（不输出登录响应、密码或Token）：

```js
const fs = await import('node:fs');
const state = JSON.parse(fs.readFileSync('.artifacts/af-021/manual.json'));
const account = JSON.parse(fs.readFileSync(state.initialPasswordFile));
const login = await fetch(state.loginUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:account.username,password:account.password})});
if(login.status!==200) throw Error('Login failed; no credential reset');
const token=(await login.json()).data.accessToken;
const response=await fetch('http://127.0.0.1:3656/api/admin/dicts',{headers:{authorization:'Bearer '+token}});
console.log(response.status,await response.json());
```

## 5. 本轮实际入口

实际PID/数据库/密码文件路径在AF-021执行记录和本机manual.json。只有API正在运行才可按第4节操作；人工结果仍待负责人填写。

本轮普通verify报告`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.artifacts/verification/AF-021/run-9ULbxQ/report.json`，185项+2宿主、exit0/PASS；当前人工API **PID 91468**，启动Mon Oct 19 21:47:39 2026，CWD=`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/apps/api`，本机Node运行本库dist/main.js，仅127.0.0.1:3656、一条有意保留池。Web3655未启动。

- 管理：`http://localhost:3656/api/admin/dicts`；公开：`http://localhost:3656/api/dictionaries/custom.af021.manual/items`。health/ready200，无Bearer管理401，初始公开空分页200。
- 库：`aij_foundation_af021_test_09a01ced9d0e8c1d`，127.0.0.1:55433，角色`aij_foundation_test`。初始分类/条目为空。aij-admin为DB超级、af021-manager有字典/角色/权限管理、af021-reader仅bootstrap；三账号真实登录/me/本人权限200、分类列表200/200/403。
- aij-admin密码仅`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af021_test_09a01ced9d0e8c1d/initial-admin.json`；另两账号按username取`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af021_test_09a01ced9d0e8c1d/rbac-management-accounts.json`。DB密码仅`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/postgres/test/postgres-password`；本机Git忽略，不回显密码/hash/完整Token/Key。
- 停止：`node scripts/verification/dictionaries-manual.mjs stop`，核验记录PID/PPID/CWD/命令/birth后只停自有API并确认零池；保留库/卷/凭据。恢复：`pnpm run verify:task -- AF-021 --prepare-manual`。

**Trea待复核、人工待验**。自动观察不代替负责人操作；未提交/推送/发行/部署。
