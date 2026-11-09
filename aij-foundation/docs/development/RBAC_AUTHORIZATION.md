# RBAC解析与后端强制授权（AF-017当前）

当前AF-020人工API/账号/忽略密码路径与核验后停止见[菜单指南](MENU_API.md)第3–4节；前序AF-019已接收并提交，以下旧PID/准备记录按历史保留，不作为当前3656进程归属依据。

AF-019当前交接：前序人工API已STOPPED；本页旧PID/库/停止命令按所属阶段历史阅读。当前AF-019人工环境与账号、角色授撤权步骤及停止命令以[角色权限指南](ROLE_PERMISSION_API.md)第0节为准，已有管理员/RBAC契约仍复用。

AF-018已接收前置；本页AF-017人工环境按历史快照阅读，开始现场已STOPPED。当前AF-018人工API、账号/用户管理权限及停止命令以[管理员指南](ADMIN_USERS_API.md)第0节为准，原RBAC判权契约仍复用。

前置AF-016已接收；本轮仅AF-017，实际dev@4c2f905干净开始。当前人工API/账号以本节为准；后面的AF-014内容保留历史快照，不使用旧PID或旧库。本项276项结构化有效用例+2宿主、lint/typecheck/API构建实际退出0，**Trea待复核、人工待验**。

## 0. 当前契约与人工步骤

唯一解析owner仍为PermissionsService，数据owner仍为core的SysUser/Role/Permission和关联；Controller声明入口权限，DTO校验业务输入，JWT Guard验证身份，PermissionsGuard解析AND权限，管理写Service通过ManagementAccessService在写事务内重查。没有新增生产Controller/DTO或镜像认证实现。

- AUTH_ENABLED=true宿主通过已导出的RbacModule装配AdminAuthorizationGuard（APP_GUARD/useExisting）。服务端Controller+handler的admin路径元数据决定受保护范围，含根Controller、路径数组/大小写；保守保护含admin别名的整个处理入口。先JWT、后既有PermissionsGuard，即使管理Controller没写局部UseGuards也受保护。缺声明/空/损坏/未知定义均拒绝，类和方法声明为AND；不把apiPath自动挂成路由权限。
- 既有GET /api/admin/permissions/my用方法级AuthenticatedAdmin明确表示本人身份查询，仍须真实JWT；忽略类级身份例外，方法例外与任何权限声明冲突则403。接口仍返回{id,isSuperAdmin,roles,permissions}，permissions为当前显式有效关联，不是超级管理员通配符或完整可调用路由表；DB超级标志单独返回。
- 每个请求读取当前有效身份/角色/权限，没有授权缓存、版本表或JWT权限快照。/my与判权采用RepeatableRead一致性事务；角色停用/软删、用户解绑/权限撤销在提交后的下一请求生效，不等待JWT到期。在途事务按原快照完成，不能撤回已完成操作。
- 超级权限只来自当前有效SysUser.isSuperAdmin；角色名super_admin、客户端permission/workspaceId/header/Token附加声明不提供权限。超级管理员可越过角色关联，仍不能绕过缺失/停用的权限定义、缺声明或各管理Service的保留代码/最后超级管理员保护。
- 非admin入口保持原owner：health是公开liveness，ready真实检查DB，auth/login与me保持原认证契约；导出Guard不等于全部未来API自动受保护。客户Workspace/行级隔离、菜单按钮页面、缓存和管理员会话撤销/Cookie/CSRF均未实现。CORS/前端按钮不承担授权。

实际API为 `http://localhost:3656`，绑定127.0.0.1；PID88349，启动时间2026-10-19 16:19:43，CWD本库apps/api，完整归属记录在.artifacts/af-017/manual.json。Web3655未运行，无权限管理页面。自动观察health/ready=200、无Bearer目录=401；这是自动证据，不替负责人操作。

数据库为 `postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af017_test_08e00de15740bc1a`，仅本库合成数据。三个产品账号如下（均与DB角色不同）：

| 用户名 | 角色/DB超级标志 | /my | 权限目录 |
| --- | --- | --- | --- |
| aij-admin | aij_bootstrap_admin / true | 200 | 200 |
| af017-reader | af017_reader / false，显式bootstrap授权 | 200 | 200 |
| af017-no-access | super_admin仅普通角色名 / false，无授权 | 200、permissions=[] | 403 |

本轮人工库只初始化bootstrap定义，未注册admin.user.manage/admin.role.manage/admin.permission.manage；因此管理CRUD入口即使真正超级管理员也403，不能把缺定义视为隐式放行。完整CRUD回归在verify各自隔离任务库执行，保留前序人工库不变。

初始密码只在以下本机忽略文件，负责人本机读取；不在聊天/报告/命令参数回显。文件不保证人工改密后的当前密码，已有账号重复准备不重置；ExFAT不作为POSIX权限隔离证明。

- 管理员：`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af017_test_08e00de15740bc1a/initial-admin.json`。
- reader/no-access按username取值：同一目录的 `rbac-enforcement-accounts.json`。
- DB密码另在本机忽略 `.local-data/postgres/test/postgres-password`；JWT key在.local-data/auth/test/<库名>/keys.json，HTTP客户端无需读取。

负责人在本仓库根目录逐步执行：

1. 访问 `http://localhost:3656/api/health`、`http://localhost:3656/api/ready`，预期200；无Bearer访问 `http://localhost:3656/api/admin/permissions` 预期401。未启动Web，不使用3655作为验收页面。
2. 本机执行以下脚本；密码和JWT只在内存。预期三个登录/my均200，目录依次200/200/403，no-access的角色名不赋予超级标志。

```bash
node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
const state=JSON.parse(readFileSync('.artifacts/af-017/manual.json'));
const admin=JSON.parse(readFileSync(state.initialPasswordFile));
const {accounts}=JSON.parse(readFileSync(state.accounts[0].initialPasswordFile));
for(const a of [admin,...accounts]) {
  const r=await fetch(state.loginUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:a.username,password:a.password})});
  if(r.status!==200)throw new Error('Login failed: '+r.status);
  const token=(await r.json()).data.accessToken,headers={authorization:'Bearer '+token};
  const my=await fetch(state.myPermissionsUrl,{headers}),own=(await my.json()).data;
  const catalog=await fetch(state.permissionsUrl,{headers});
  console.log({username:a.username,login:r.status,my:my.status,catalog:catalog.status,...own});
}
JS
```

3. 用af017-no-access本机登录得到的Bearer，通过HTTP客户端直接GET权限目录，添加x-permissions:aij.bootstrap.admin和x-workspace-id:other，仍预期403；/my仍为空权限。不要把Token贴入聊天或日志。前端修改按钮不改变后端结果。自动测试还实测同JWT撤权/停用→403、恢复→200；负责人可在专用验收库逐项复核，不能改原dev/test或轻企库。
4. Trea复跑前先审registry参数数组/路径/前置/effects及真实断言。普通verify要求3656空闲，指定Writer先运行 `node scripts/verification/rbac-enforcement-manual.mjs stop` 核验PID/PPID/CWD/完整命令/birth并SIGTERM确切自有PID、检查零池，再 `pnpm run verify:task -- AF-017`，预期276项+2宿主/退出0；不按端口kill，不清库。
5. 需要恢复人工API时仅指定Writer运行 `pnpm run verify:task -- AF-017 --prepare-manual`，只跑实际前置及安全钩子，复用已有库/账号/密码，不执行普通tests或静默重置，返回PREPARED；Trea不运行准备。停止/清理只停止记录API，保留库/卷/凭据，无reset/drop/down -v。

当前自动证据：.artifacts/verification/AF-017/run-jplFX8/report.json、run-1646oW/report.json、.artifacts/af-017/manual-observation.json。缺声明或元数据错误的默认拒绝不保证写审计；真实权限不足沿用最小rbac拒绝审计，无请求体/密码/hash/JWT。未调用浏览器，不声明人工或浏览器策略通过。

## AF-014历史指南（以下为历史快照）

AF-016已接收前序并接入角色/权限管理API，当前人工API3656/合成账号/忽略密码文件/停止命令以[角色权限指南](ROLE_PERMISSION_API.md)为准。本页旧任务范围/PID按历史阅读，不沿用旧PID；Schema/initial及既有接口契约保持。

当前AF-015已接收前序并接入管理员基础管理API，当前3656/三账号/忽略密码路径与操作以[管理员管理指南](ADMIN_USERS_API.md)为准。以下保留本任务历史范围/PID，旧人工API已在后续核验中停止，不能沿用。

唯一owner为apps/api/src/rbac的PermissionsService/Module及common/guards/PermissionsGuard、common/decorators/Permissions。复用已接收AF-013的JWT/AuthModule与唯一PrismaService，Schema/initial不变。RbacModule导出Guard/Service，宿主在AUTH_ENABLED=true时组合；没有包/宿主镜像实现，也没有新增管理员CRUD、菜单/按钮、客户租户/行级授权或插件生命周期。

## 1. 运行规则与接口

| 规则/接口 | 实际行为 |
| --- | --- |
| Permissions(...codes) | 非空明确code；禁止空/通配/非法值，类与方法声明合并AND而非相互覆盖，重复去重 |
| PermissionsGuard | 必须先有JwtAuthGuard建立的身份；无/非法元数据403，不默认放行。Guard只传服务器声明及真实id到唯一Service，不信任客户端角色或权限 |
| 普通身份 | 当前active且未软删SysUser→当前关联→active且未软删SysRole→当前关联→active SysPermission；全部必需code均在有效授权内才放行 |
| DB超级管理员 | 仅当前SysUser.isSuperAdmin=true可越过角色关联授权；仍需有效身份、合法声明、全部权限定义存在且active。名为super_admin的角色没有特殊意义 |
| GET /api/admin/permissions/my | JWT身份有效即可200，返回id/isSuperAdmin及当前显式roles/permissions；没有角色或权限时是空列表，不伪造超级权限通配符 |
| GET /api/admin/permissions | JWT后执行PermissionsGuard，明确要求aij.bootstrap.admin，成功200仅列active权限的code/name/resourceType/module/action；无权403，无有效身份401，DB/迁移失败503 |

现有Seed的aij.bootstrap.admin仍是data类型、apiPath=null；本项首次将其显式绑定到限定的只读权限目录，未添加Seed项/菜单或自动给其他路由授权。apiPath不作为隐式路由授权表。未来业务API须明确声明并实际使用Guard，不能据已导出Guard宣称所有接口已受RBAC保护。

Service判权在RepeatableRead事务中读取身份/授权和必需权限定义；每次请求重查，无JWT角色/权限快照或授权缓存。撤销user-role/role-permission、停用/软删角色、停用权限、变更超级标志对原JWT生效。权限模型没有deletedAt，只测试status；role.dataScope字符串及Project/Organization/workspaceId都不提供客户租户或数据行授权。

授权不足写最小AuditLog：rbac/permission_denied/failed、已知userId、静态requiredPermissions与关联ID；不保存URL/query/请求体/密码/hash/完整JWT。无JWT/非法元数据和DB故障不宣称每次都有持久审计；成功读取不新增业务审计。认证和这两条RBAC路径复用既有错误filter固定去敏/no-store，其他API/health/ready原契约保持。

## 2. 当前实际人工环境

Web3655未启动，无RBAC管理网页。API绑定127.0.0.1:3656，health/ready已经实际200；认证及RBAC自动观察通过，人工验收仍待执行。

| 合成账号 | 角色/标志 | 目录预期 | 初始密码本机忽略文件 |
| --- | --- | --- | --- |
| aij-admin | aij_bootstrap_admin；DB超级标志true | 200 | /Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af014_test_86ef4556d5d6dd16/initial-admin.json |
| af014-reader | af014_reader；超级标志false，已授aij.bootstrap.admin | 200 | /Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af014_test_86ef4556d5d6dd16/rbac-accounts.json |
| af014-no-access | super_admin仅是普通角色名；超级标志false，无权限 | 403 | 同上rbac-accounts.json，按username取对应记录 |

DB角色aij_foundation_test与产品账号不同，DB密码另在.local-data/postgres/test/postgres-password；无密码DB地址为 `postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af014_test_86ef4556d5d6dd16`。JWT key仅在.local-data/auth/test/<该库>/keys.json，HTTP客户端无需读取。实际PID86736、PID/PPID/CWD/完整命令/birth、URL、日志和文件路径保存在.artifacts/af-014/manual.json。账号/文件重复准备不覆盖，初始文件不保证人工改密后仍为当前密码；ExFAT不作为POSIX权限隔离证据。

## 3. 操作与预期

在本仓库根目录操作，Trea先审registry的真实前置/参数数组/files/testFiles/effects与断言，不运行准备模式。

1. 负责人用浏览器或HTTP客户端访问 `http://localhost:3656/api/health`、`http://localhost:3656/api/ready`，预期200、AIJ测试身份和空插件；直接无Bearer访问 `http://localhost:3656/api/admin/permissions` 预期401。
2. 负责人本机运行以下脚本。密码和Token仅在内存，不打印登录完整响应，不把凭据复制到报告/聊天/命令行参数。预期三个login/my均200，catalog为200/200/403，当前身份/权限与上表一致。

```bash
node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
const state=JSON.parse(readFileSync('.artifacts/af-014/manual.json'));
const admin=JSON.parse(readFileSync(state.initialPasswordFile));
const {accounts}=JSON.parse(readFileSync(state.accounts[0].initialPasswordFile));
for(const account of [admin,...accounts]) {
  const login=await fetch(state.loginUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:account.username,password:account.password})});
  if(login.status!==200)throw new Error('Login failed: '+login.status);
  const {data}=await login.json();
  const headers={authorization:'Bearer '+data.accessToken};
  const current=await fetch(state.myPermissionsUrl,{headers});
  const own=await current.json();
  const catalog=await fetch(state.permissionsUrl,{headers});
  console.log({username:account.username,login:login.status,my:current.status,catalog:catalog.status,isSuperAdmin:own.data?.isSuperAdmin,roles:own.data?.roles,permissions:own.data?.permissions});
}
JS
```

3. DB客户端仅查询不含password_hash的sys_user状态、sys_role/status/deleted_at、两关联和sys_permission/status，以及audit_log的module/action/status/request_summary；预期无权限账号的拒绝有rbac关联ID/权限code，无密码/hash/Token。自动化已对自身新库真实撤销/停用并恢复、断库并恢复；本人工脚本不关闭实例或改授权。
4. 复跑普通 `pnpm run verify:task -- AF-014` 前执行 `node scripts/verification/rbac-manual.mjs stop`。它核对PID/PPID/CWD/完整命令/启动时间及验收库归属，再SIGTERM确切自有PID并等零池，释放3656；不按端口批量kill。预期普通校验202有效项+2既有宿主用例、退出0，证据写新run目录；这是实际有合成DB/文件/服务写入的校验，Trea按负责人安排执行。
5. 仅被指定Writer执行 `pnpm run verify:task -- AF-014 --prepare-manual` 恢复观察环境；只跑真实前置与注册钩子，不跑普通steps、不认证PASS，结果PREPARED。错任务记录在复用前拒绝；已有密码/角色不重置。保留库/卷/凭据，不执行reset/drop/down -v。

**Trea待复核、人工待验**。本项未调用浏览器，不声明人工或浏览器工具策略已通过；CORS不作为管理员授权。完整实际命令/退出码、影响与保护状态见[AF-014记录](../execution/AF-014.md)。
