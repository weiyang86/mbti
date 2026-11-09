# 角色与权限分配API（AF-019当前）

2026-10-27 UI-1增量：管理员现有Auth/JWT已加入持久会话、退出/改密/受控重置/停用失效、浏览器Cookie/CSRF及登录页。当前契约和人工入口见[管理员浏览器指南](ADMIN_BROWSER_AUTHENTICATION.md)，下文旧无状态JWT/未撤销/PID说明保留为各卡历史，不适用于新会话。原用户/角色API与后端RBAC owner保持。

当前AF-020人工API/账号/忽略密码路径与核验后停止见[菜单指南](MENU_API.md)第3–4节；前序AF-019已接收并提交，以下旧PID/准备记录按历史保留，不作为当前3656进程归属依据。

AF-018负责人已接收；本轮仅AF-019，dev@c178e72干净开始。分页/编辑/目录/状态/权限替换复用唯一owner，新增停用目标权限变更409和同事务ID集合前后审计；294项+2宿主及门禁通过。**Trea待复核、人工待验**。下方第1/2节是现有接口契约，第3/4节保留AF-016历史环境；当前操作以第0节为准，不使用旧PID/停止命令。

## 0. 当前人工API、账号与操作

API实际127.0.0.1:3656，PID42904、Mon Oct 19 19:31:57 2026，CWD本库apps/api、本机Node执行本库dist/main.js；归属及完整命令见.artifacts/af-019/manual.json。Web3655未运行，无角色权限页面。本次未调用浏览器，不宣称人工或浏览器策略通过。

| 地址 | 当前实际状态 |
| --- | --- |
| http://localhost:3656/api/health | 200，process liveness |
| http://localhost:3656/api/ready | 200，实际DB/迁移 |
| POST http://localhost:3656/api/auth/login | 本机合成账号登录 |
| GET http://localhost:3656/api/admin/roles | 无Bearer401；三账号200/200/403 |
| GET http://localhost:3656/api/admin/permissions/manage | 后端目录，含ID/code/status；三账号200/200/403 |

合成库postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af019_test_0318b78584e54a98，只在本库test实例；原dev/test不deploy/seed。产品账号与DB角色不同：

| 用户名 | 角色/权限边界 | 角色/后端目录 |
| --- | --- | --- |
| aij-admin | 当前DB超级标志true；仍须active定义与Service边界 | 200/200，可给非保留active角色分配权限 |
| af019-manager | admin.role.manage与admin.permission.manage；普通管理者，可改未分配且无授权角色，不能赋权/自提权 | 200/200，PUT权限始终403 |
| af019-reader | 仅bootstrap目录权限，无角色/管理目录权限 | 403/403 |

密码只在本机忽略文件，由负责人安全读取，不在聊天/报告/命令参数回显：

- 管理员：/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af019_test_0318b78584e54a98/initial-admin.json。
- manager/reader按username取对应记录：/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af019_test_0318b78584e54a98/rbac-management-accounts.json。
- DB密码另在本机忽略.local-data/postgres/test/postgres-password；JWT key在忽略auth目录，HTTP客户端无需读取。

已有账号/角色/密码重复准备不重置，初始文件不保证人工改密后仍是当前密码；ExFAT不作为POSIX权限隔离证明。重复准备PID/库/凭据保持，实际停止再恢复的密码/JWT文件hash保持；PREPARED不替人工。

负责人在本仓库根目录按序执行：

1. health/ready各200，无Bearer角色列表401。CORS或前端按钮不是授权，3655没有验收页面。
2. 本机运行以下登录/列表脚本，密码/Token只在内存，不打印完整登录响应。预期三者login/me/my200，roles/definitions依次200/200/403；身份超级标志由服务器读取。

```bash
node --input-type=module <<'LOCAL'
import {readFileSync} from 'node:fs';
const s=JSON.parse(readFileSync('.artifacts/af-019/manual.json'));
const admin=JSON.parse(readFileSync(s.initialPasswordFile));
const {accounts}=JSON.parse(readFileSync(s.accounts[0].initialPasswordFile));
for(const a of [admin,...accounts]) {
  const r=await fetch(s.loginUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:a.username,password:a.password})});
  if(r.status!==200)throw new Error('Login failed: '+r.status);
  const token=(await r.json()).data.accessToken,headers={authorization:'Bearer '+token};
  const me=await fetch(s.meUrl,{headers}),my=await fetch(s.myPermissionsUrl,{headers});
  const own=(await my.json()).data;
  const roles=await fetch(s.rolesUrl+'?page=1&pageSize=1',{headers});
  const definitions=await fetch(s.permissionDefinitionsUrl+'?page=1&pageSize=100',{headers});
  console.log({username:a.username,login:r.status,me:me.status,my:my.status,roles:roles.status,definitions:definitions.status,isSuperAdmin:own?.isSuperAdmin});
}
LOCAL
```

3. 用root从GET /api/admin/permissions/manage?pageSize=100取active的admin.user.manage记录ID；本地选择必须消费服务器目录，不把permissionCode/通配当ID。创建唯一合成角色（roleCode例如af019_human_时间戳、roleName非空）POST /admin/roles预期201/id；GET角色分页/q及详情200，PATCH roleName/remark后重读匹配。不要改三个人工观察账号或保留aij_*角色。
4. 准备独立合成受测用户的随机密码到忽略文件，只打印用户名/位置；负责人在本机安全客户端读取值，不回显密码。以下不覆盖任何既有账号：

```bash
node --input-type=module <<'LOCAL'
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const s=JSON.parse(readFileSync('.artifacts/af-019/manual.json'));
const id=randomUUID(),file=join(dirname(s.initialPasswordFile),'human-'+id+'.json');
execFileSync('git',['--no-optional-locks','check-ignore','--quiet',file]);
const data={username:'af019-human-'+id.slice(0,8),realName:'AF019 human',password:'C9-'+randomBytes(24).toString('hex')};
writeFileSync(file,JSON.stringify(data,null,2)+'
',{flag:'wx',mode:0o600});
console.log({username:data.username,credentialFile:file});
LOCAL
```

5. root使用既有POST /api/admin/users创建该用户，JSON为本机username/realName/password并加roleIds:[上一步角色ID]；角色需active，预期201。该用户登录拿JWT留本机内存；赋权前直接GET /api/admin/users预期403。root PUT /api/admin/roles/:id/permissions，body={permissionIds:[目录中admin.user.manage的ID]}预期200/id；该用户同一JWT再访问用户列表200。root PUT {permissionIds:[]}预期200，同JWT再访问403。没有Token权限快照/缓存等待。
6. 普通manager不论给自己还是他人PUT permissionIds均403；无Bearer401、reader403。root提交permissionCodes字段、权限码冒充ID、通配/未知/重复ID或停用定义均400，原集合/成功审计不变。客户端workspaceId/permission/自报超级字段不能越权，不直接改数据库制造真实超级标志。
7. root授active目录权限后，PATCH /roles/:id/status {enabled:false}预期200，受测用户同JWT受保护接口403；此时PUT分配或[]撤销均409，绑定该停用角色到用户400。重新启用后旧grant可恢复；再撤权[]使Guard403。停用保留grant，不在停用状态静默改授权。
8. root删除被引用的测试角色（DELETE /roles/:id）预期软删200；GET详情404/角色代码再用409；DB角色disabled/deletedAt、grant0，原用户及user-role历史关联保持，用户身份/auth/me200但该角色不再授予访问权。不会级联删除用户。不要用DROP/reset清库。
9. DB客户端仅在上面的独立库只读核对audit_log module=rbac-management/action=role_permissions_assigned，操作者user_id、目标resource_id、关联ID及request_summary.permissionIdsBefore/After与实际授撤权一致；集合只有安全ID，无密码/hash/业务提交值。历史审计不回填。锁等待后目标停用及审计失败回滚已有真实自动证据，人工不需停DB容器或安装失败trigger。
10. Trea先审registry/files/testFiles/effects与实际断言；普通verify前由指定Writer运行 `node scripts/verification/rbac-management-manual.mjs stop --task AF-019`，核验PID/PPID/CWD/完整命令/birth、仅SIGTERM确切自有API并等零池，释放3656；保留库/卷/凭据。再 `pnpm run verify:task -- AF-019` 预期294项+2宿主、退出0。Trea不运行prepare；恢复仅指定Writer执行 `pnpm run verify:task -- AF-019 --prepare-manual`。不带--task的直接CLI仍是历史AF-016，当前必须明确AF-019；无按端口kill/全局down -v。

当前证据.artifacts/verification/AF-019/run-IV47sU/report.json、.artifacts/af-019/manual-observation.json、restart-check.json；完整命令/退出码/影响和保护状态见[AF-019执行记录](../execution/AF-019.md)。本项无菜单/页面/客户租户/永久会话撤销或真实外部接入，历史AF-016范围裁定与报告保留，不代负责人勾验。

唯一实现为apps/api/src/rbac/management.{controller,dto,service}.ts，RbacModule导出并由现有宿主消费。JWT/PermissionsGuard/PermissionsService/Prisma复用；AF-015写事务、去敏错误和成功审计抽到同模块ManagementAccessService，管理员与RBAC写操作取得同一数据库局部事务锁，锁后重查操作者。模型、initial、认证核心和依赖版本不变。

## 1. 实际入口

角色入口均要求active `admin.role.manage`，权限管理入口均要求active `admin.permission.manage`，先JWT再RBAC。无身份401、无权限403、输入错误400、重复/受保护或引用冲突409、目标缺失/角色已软删404、数据库或迁移异常503。统一响应data及no-store，错误不回显输入或SQL。

| 方法/地址 | 输入和行为 |
| --- | --- |
| GET /api/admin/roles | page默认1、上限10000；pageSize默认20、上限100；q至多64字符匹配code/name；status仅active/disabled。200分页items/total/page/pageSize，排除软删 |
| GET /api/admin/roles/:id | 200安全角色资料及permissionIds；dataScope仅现有元数据，不提供租户或行级授权 |
| POST /api/admin/roles | roleCode为3–64小写字母开头的字母/数字/_；roleName为1–64非全空白字符，可选remark（最多256，可null）。201/id，创建active空角色，不自动绑定用户/权限 |
| PATCH /api/admin/roles/:id | roleName/remark至少一项，remark可null；200/id，不能改code、dataScope、状态或授权 |
| PATCH /api/admin/roles/:id/status | enabled必须JSON boolean；200/id；停用后现有JWT的该角色授权立即失效 |
| PUT /api/admin/roles/:id/permissions | 完整替换permissionIds（唯一有效ID，至多100项，全部必须active），[]清空；仅当前DB超级管理员，且目标角色必须active，停用角色替换/清空均409。200/id；校验/清旧/建新/audit在同一事务，不跳过坏ID后部分成功 |
| DELETE /api/admin/roles/:id | 软删：disabled/deletedAt，并在同一事务解除该角色的权限关联；保留角色/用户名关联/代码唯一占位，历史菜单关联保持但不宣称菜单运行时。200/id/deleted=true |
| GET /api/admin/permissions/manage | 管理列表，含id/status及停用项；同角色有界分页、q匹配code/name、status筛选 |
| GET /api/admin/permissions/:id | 200权限定义安全字段 |
| POST /api/admin/permissions | permissionCode仅custom.*（最多128，小写字母/数字及._-分段）、permissionName非空最多64、resourceType仅menu/button/api/data、action小写字母开头最多64；apiPath可null或最多256的/api路径，不接受外部URL/query。module由服务端固定custom，201/id |
| PATCH /api/admin/permissions/:id | permissionName/apiPath至少一项；apiPath可null。code/module/action/resourceType不可改，200/id |
| PATCH /api/admin/permissions/:id/status | enabled boolean；200/id。停用自定义定义会立即从有效权限中移除 |
| DELETE /api/admin/permissions/:id | 仅自定义且没有任何角色关联、菜单permissionCode字符串引用时硬删除；200/id/deleted=true，再读404。有引用409，不级联清空他人角色/菜单 |

既有GET /api/admin/permissions保留aij.bootstrap.admin限定只读目录和原数组契约，GET /api/admin/permissions/my保留JWT身份自查。管理列表单列/manage，不能用旧bootstrap标识写管理接口；apiPath只是元数据，不会为同名路由自动授权。静态/my、/manage在动态/:id前注册，实测不被吞掉。

普通获权账号只能修改未分配且无权限关联的角色，已分配/有授权角色即403；不能通过改角色给自己或他人提权。只有当前DB isSuperAdmin才可绑定权限或修改这类角色，Token/header/query/名为super_admin的角色不提供该标志。aij_*及super_admin为保留角色，API禁止创建/修改/停用/删除（400/409）；非custom或module非custom的代码owner权限不能改名/停用/删除（409），含既有bootstrap与三个管理定义。真正超级管理员自身安全仍由AF-015保护，不照搬源角色名旁路。

所有成功写入与最小rbac-management audit同事务，记录固定action、操作者/目标ID、关联ID和字段名；权限替换新增同事务permissionIdsBefore/After安全ID集合（旧关联与服务端校验后的新集合，排序，历史不回填），不记录提交的名字/备注/路径/密码/hash/JWT。Guard拒绝沿用RBAC最小审计；DTO/无身份/DB故障/事务内晚期拒绝不宣称全量持久审计。没有菜单/按钮/页面、插件权限挂载、客户Workspace或行级授权、通用审计及JWT刷新/撤销；改密仍不撤销既有15分钟JWT。

## 2. 显式Seed与隔离

```bash
pnpm run db:seed -- test --acceptance ID --rbac-management
# 新目标如需管理员管理定义/首次随机凭据，再显式加 --admin-users / --generate-credentials
```

ID必须来自本机已记录的允许任务验收库；普通dev/test未deploy，上例不是已向它们写入的证据。每次先验证目标/资源/身份/迁移checksum；只注册admin.role.manage与admin.permission.manage的api/core定义，不加角色授权或修复撤销；已有status/资料/密码/角色保留，元数据冲突整笔回滚。默认Seed仍七行；只带rbac标志首次九行，另带admin-users为十行。没有默认开启插件或迁业务权限。AF-016只在自身新逻辑测试库建立合成fixture，另运行显式已注册前序回归，不触碰原产品库。

## 3. AF-016历史人工观察（旧PID/库勿沿用）

Codex实际准备状态见.artifacts/af-016/manual.json，PID 73178、库 `aij_foundation_af016_test_d17029a1b81aa94d`，API仅loopback3656。Web3655未启动，没有角色/权限页面。

| 入口/账号 | 实际用途/预期 |
| --- | --- |
| http://localhost:3656/api/health、/api/ready | 进程/真实DB及迁移各200 |
| POST http://localhost:3656/api/auth/login | JSON username/password，成功Bearer仅留本机安全客户端/内存 |
| http://localhost:3656/api/admin/roles | 角色列表，root/manager/reader分别200/200/403，无Bearer401 |
| http://localhost:3656/api/admin/permissions/manage | 权限管理列表，同样200/200/403 |
| aij-admin | DB超级管理员；初始密码在.local-data/seed/test/aij_foundation_af016_test_d17029a1b81aa94d/initial-admin.json |
| af016-manager | 两个管理权限；初始密码在.local-data/seed/test/aij_foundation_af016_test_d17029a1b81aa94d/rbac-management-accounts.json对应username |
| af016-reader | 仅bootstrap只读目录，管理403；同一rbac-management-accounts.json对应username |

绝对仓库根 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`。DB无密码地址 `postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af016_test_d17029a1b81aa94d`，DB密码单独在.local-data/postgres/test/postgres-password。负责人只在本机读初始密码/安全客户端输入，不放命令参数、聊天或报告；JWT key在忽略auth目录，客户端无需读取。已有账号/密码不重置，初始文件不是人工改密后当前密码保证；ExFAT不作为POSIX权限隔离证明。

1. Trea已提供独立复核门禁结果，原报告保留；负责人继续人工观察health/ready200，无Bearer管理401，再用三账号登录；角色与管理定义列表200/200/403。旧只读目录root/manager/reader分别200/403/200，/my三者均200。
2. 用manager创建唯一合成roleCode（如af016_human_时间戳），读详情、分页查到；PATCH名字/清空remark，再停用/启用后重读状态匹配。重复code409、未知字段dataScope/permissionIds/非法status400，修改自身已分配manager角色403。
3. 用manager创建唯一custom.af016human.*定义，读/改名/清空apiPath、停用/启用；创建core代码或伪造module400，修改/停用/删除core定义409；元数据apiPath不授予管理员API访问权。
4. manager PUT角色权限403；root用上一步真实ID绑定成功，非法/重复/停用ID400且原关联不变。用root通过AF-015创建独立合成账号并绑定该角色，给角色加入现有admin.user.manage后该账号可管理管理员；同JWT清空授权或停用角色后403，恢复后200。只修改新建合成角色/账号，不修改三观察账号。
5. 有关联权限DELETE409；root删除新角色后详情404、角色码仍占位409、用户关联保留而权限关联清除。权限现在无其他引用可DELETE200，再读404；检查最小audit含对应固定action/关联ID而无提交值/秘密。
6. 自动测试已做并发重复、第二Seed定义冲突回滚、真断自身逻辑库/恢复和关闭零池；人工无需停PostgreSQL或连接原15435。观察不是全量管理面或客户租户验收。

自动三账号脚本与PREPARED不替负责人操作；本轮未调用浏览器，不宣称工具策略或页面通过。CORS不是管理员授权。

## 4. AF-016历史停止与复跑

```bash
node scripts/verification/rbac-management-manual.mjs stop
# 仅指定Writer，且3656已释放：
pnpm run verify:task -- AF-016
pnpm run verify:task -- AF-016 --prepare-manual
```

stop核对任务/库、PID/PPID/CWD/完整命令/birth后只SIGTERM记录的自有API，等真实零池；不按端口kill。复用唯一生命周期，已有密码/角色不静默重置。保留库/卷/凭据，不reset/drop/down -v。完整命令/退出码与保护记录见[AF-016执行记录](../execution/AF-016.md)。**负责人已接收角色权限交付，人工待验。**
