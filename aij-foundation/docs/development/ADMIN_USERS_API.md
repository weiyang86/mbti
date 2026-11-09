# 管理员用户管理API（AF-018当前）

2026-10-27 UI-1增量：管理员现有Auth/JWT已加入持久会话、退出/改密/受控重置/停用失效、浏览器Cookie/CSRF及登录页。当前契约和人工入口见[管理员浏览器指南](ADMIN_BROWSER_AUTHENTICATION.md)，下文旧无状态JWT/未撤销/PID说明保留为各卡历史，不适用于新会话。原用户/角色API与后端RBAC owner保持。

当前AF-020人工API/账号/忽略密码路径与核验后停止见[菜单指南](MENU_API.md)第3–4节；前序AF-019已接收并提交，以下旧PID/准备记录按历史保留，不作为当前3656进程归属依据。

AF-019当前交接：前序人工API已STOPPED；本页旧PID/库/停止命令按所属阶段历史阅读。当前AF-019人工环境与账号、角色授撤权步骤及停止命令以[角色权限指南](ROLE_PERMISSION_API.md)第0节为准，已有管理员/RBAC契约仍复用。

AF-017已由负责人接收；本轮仅AF-018，dev@37372b9干净开始。分页/创建/修改/停用/受控重置和安全保护已由前序唯一模块实现并被宿主消费，本次核验复用、补真实验收，不新增应用实现。284项+2宿主及门禁通过，**Trea待复核、人工待验**。第1/2节接口契约仍实际复用；第3/4节保留AF-015历史环境，当前操作以第0节为准。

## 0. 当前人工API与逐步操作

API实际监听127.0.0.1:3656，PID17027，Mon Oct 19 18:17:37 2026，CWD本库apps/api、运行本库dist/main.js；完整归属和停止命令见.artifacts/af-018/manual.json。Web3655没有运行，无用户管理页面；浏览器本轮未调用，不声称人工/页面验收完成。

- 健康：http://localhost:3656/api/health（200，process liveness）；就绪：http://localhost:3656/api/ready（实际DB/迁移，当前200）。
- 登录：POST http://localhost:3656/api/auth/login；本人：GET /api/auth/me；本人权限：GET /api/admin/permissions/my。
- 用户列表/创建：http://localhost:3656/api/admin/users；详情/修改及status/reset-password见第1节。无Bearer列表401，无管理权限普通角色直接写403。

当前隔离库为postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af018_test_92418c915d6847d8，只有合成core数据；原dev/test未deploy/seed。产品账号与DB角色不同，三个账号均login/me/my200，列表预期如下：

| 用户名 | 角色/边界 | 用户列表 |
| --- | --- | --- |
| aij-admin | 当前DB超级标志true，仍需active权限定义与Service安全边界 | 200 |
| af018-manager | 仅显式admin.user.manage，可管理非超级用户，不能分配角色/改超级用户 | 200 |
| af018-reader | 仅bootstrap只读目录权限，无用户管理授权 | 403 |

初始密码只在本机忽略文件，负责人安全读取，不在聊天/报告/命令行参数打印。绝对位置：

- 管理员：/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af018_test_92418c915d6847d8/initial-admin.json。
- manager/reader按username取对应记录：/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af018_test_92418c915d6847d8/admin-accounts.json。
- DB密码另在本机忽略.local-data/postgres/test/postgres-password；JWT key在忽略auth目录，HTTP客户端无需读取。

已有账号/角色/密码重复准备不静默重置，初始文件不保证人工改密后的当前密码；ExFAT不作为POSIX权限隔离证明。自动观察重复PID/库/凭据保持，实际停止再恢复密码/JWT文件hash保持。PREPARED只表示服务准备，不替负责人操作。

负责人在本仓库根目录按以下步骤操作：

1. 访问health/ready各200；直接无Bearer GET用户列表预期401。CORS或前端按钮不作为授权，3655没有验收页面。
2. 本机运行下列只打印安全结果的登录/分页脚本，密码/Token只在内存；三者列表200/200/403，权限标志来自服务器。HTTP客户端也可完成同样操作，不能将完整登录响应贴到聊天。

```bash
node --input-type=module <<'LOCAL'
import {readFileSync} from 'node:fs';
const state=JSON.parse(readFileSync('.artifacts/af-018/manual.json'));
const admin=JSON.parse(readFileSync(state.initialPasswordFile));
const {accounts}=JSON.parse(readFileSync(state.accounts[0].initialPasswordFile));
for(const a of [admin,...accounts]) {
  const login=await fetch(state.loginUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:a.username,password:a.password})});
  if(login.status!==200)throw new Error('Login failed: '+login.status);
  const token=(await login.json()).data.accessToken,headers={authorization:'Bearer '+token};
  const me=await fetch(state.meUrl,{headers}),my=await fetch(state.myPermissionsUrl,{headers});
  const list=await fetch(state.adminUsersUrl+'?page=1&pageSize=1',{headers});
  const data=(await list.json()).data;
  console.log({username:a.username,login:login.status,me:me.status,my:my.status,list:list.status,total:data?.total,items:data?.items});
}
LOCAL
```

3. 准备唯一合成新用户的两份随机凭据，写本机忽略文件，不覆盖既有账号；以下命令只打印用户名和文件位置。负责人在本机安全客户端取值，不回显密码。

```bash
node --input-type=module <<'LOCAL'
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const s=JSON.parse(readFileSync('.artifacts/af-018/manual.json'));
const id=randomUUID(),file=join(dirname(s.initialPasswordFile),'human-'+id+'.json');
execFileSync('git',['--no-optional-locks','check-ignore','--quiet',file]);
const data={username:'af018-human-'+id.slice(0,8),realName:'AF018 human',password:'C9-'+randomBytes(24).toString('hex'),resetPassword:'N8-'+randomBytes(24).toString('hex')};
writeFileSync(file,JSON.stringify(data,null,2)+'
',{flag:'wx',mode:0o600});
console.log({username:data.username,credentialFile:file});
LOCAL
```

4. 用manager的Bearer直接POST用户入口，只提交上述username/realName/password（不要提交resetPassword字段），预期201/id；GET详情与q=该username&page=1&pageSize=1预期200/total1、字段无passwordHash。PATCH该id提交realName/email，重新GET核对；重复用户名409，额外isSuperAdmin字段400，弱/模板密码400。reader直接POST/PATCH/status/reset-password均403且数据不变，不能以自报workspaceId/permission提权。
5. 该新用户先登录拿旧JWT（只留本机内存），manager对reset-password提交本地resetPassword，预期200，旧密码登录401/新密码200；此时旧JWT仍可用至既有15分钟到期，不宣称撤销。manager PATCH status {enabled:false}后，该用户登录及旧JWT访问/auth/me均401；{enabled:true}后有效身份恢复，未过期旧JWT可恢复。不要重置三个人工观察账号。
6. manager不能PATCH roleIds或修改aij-admin（403）；aij-admin和manager各自PATCH自身status {enabled:false}均409。数据库只读核对active且未软删超级数至少1、目标用户安全资料与audit_log module=admin-users的created/updated/password_reset/disabled/enabled、关联ID及字段名，不查询/打印password_hash。真实并发最后超级保护、审计失败整笔回滚和锁等待撤权已有自动证据，人工不需停DB实例或连接原库。
7. 普通verify必须3656空闲。指定Writer先运行 `node scripts/verification/admin-users-manual.mjs stop --task AF-018`，它核验PID/PPID/CWD/完整命令/birth后仅SIGTERM自有PID、等待零池；保留库/卷/凭据，不按端口kill。然后 `pnpm run verify:task -- AF-018` 预期284项+2宿主/退出0。Trea先审registry/files/testFiles/effects和实际断言，只跑普通模式，不运行准备。
8. 恢复由指定Writer执行 `pnpm run verify:task -- AF-018 --prepare-manual`，只调用实际前置与注册安全钩子，复用原库/密码/角色，返回PREPARED，不当成人工通过。不带--task的直接manual CLI仍是历史AF-015，当前必须明确AF-018；无reset/drop DATABASE/全局down -v。

自动证据.artifacts/verification/AF-018/run-ChPInT/report.json、.artifacts/af-018/manual-observation.json和restart-check.json；完整命令/退出码与数据保护见[AF-018执行记录](../execution/AF-018.md)。本项无永久会话撤销、页面、客户租户或AI依赖；只在新任务库运行并清理合成审计失败trigger/function，不把它作为产品迁移。

唯一实现为apps/api/src/admin的Controller/Service/DTO/Module。宿主在AUTH_ENABLED=true时消费该模块，通过AuthModule/RbacModule复用既有JWT、PermissionsGuard与唯一PrismaService。SysUser/角色关联/AuditLog归AIJ core；项目组织不是客户Workspace权限边界。Schema/initial、manifest/锁文件及JWT认证策略保持。

## 1. 接口与权限

全部入口先JWT认证，再要求当前数据库中active的 `admin.user.manage`。身份无效401、权限不足403、输入错误400、重复用户名/保护冲突409、目标不存在或已软删404、数据库/迁移异常503。成功统一响应data；读取与错误no-store，不返回passwordHash。

| 方法/地址 | 输入及成功结果 |
| --- | --- |
| GET /api/admin/users | page默认1、最大10000；pageSize默认20、最大100；q至多64字符匹配username/realName；status仅active/disabled。200返回items/total/page/pageSize，不列软删账号 |
| GET /api/admin/users/:id | 200返回安全资料、roleIds/roleCodes、状态/时间/DB超级标志；角色列表是关联信息，判权另过滤角色/权限状态 |
| POST /api/admin/users | username（ASCII字母数字开头、3–64字符，允许._-）、realName（1–64非全空白）、password；可选email/phone/roleIds。201仅返回id，创建active、isSuperAdmin=false |
| PATCH /api/admin/users/:id | 至少一个realName/email/phone/roleIds；email/phone可显式null清空，realName不接受null。200返回id |
| PATCH /api/admin/users/:id/status | enabled必须JSON boolean；200返回id |
| PATCH /api/admin/users/:id/reset-password | password；200返回id，仅重置他人密码，不提供自助改密 |
| DELETE /api/admin/users/:id | 软删除：disabled与deletedAt，保留用户名唯一占位及原关联。200返回id/deleted=true；再次删除404 |

DTO拒绝未知字段，不能通过isSuperAdmin/passwordHash/status/username等超额字段修改资料；id为1–128字符字母/数字/_/-，roleIds唯一、至多20个，必须全部对应active且未软删角色。username不可修改，角色CRUD不在本项。

普通管理账号可管理非超级账号；只有当前DB超级管理员可分配/清空角色或修改超级账号。客户端JWT/header/query的角色/权限/超级标志不授权，名为super_admin的角色也不提权。所有写事务先取得本数据库管理员写锁，再复用PermissionsService在同一事务重查操作者，避免两个管理员并发互停后无可用超级账号。禁止停用/删除自己，禁止重置自己；最后一个active且未软删超级管理员不能停用/删除。API没有晋升超级管理员字段。

密码策略唯一owner为scripts/admin-policy.cjs，Seed/API共用：20字符以上、至多72 UTF-8字节、至少三类字符、无空白/控制或模板值，bcrypt12+随机salt；没有通用默认密码。密码/hash/完整JWT不写响应、日志或报告。**重置密码只改变后续登录密码，已有JWT仍可到原15分钟期限；没有refresh/注销/会话版本撤销。** 停用/软删则被既有Guard立即拒绝。

每个成功写入与最小audit在同一事务提交；module=admin-users，固定action为created/updated/enabled/disabled/password_reset/deleted。只记录操作者/目标ID、关联ID和变更字段名，不记录字段值/密码/hash/JWT。权限Guard拒绝沿用RBAC最小拒绝审计；DTO拒绝、无身份、DB故障或事务内晚期拒绝不宣称全量持久审计。通用审计服务仍未迁入。

## 2. 显式注册管理权限

不把aij.bootstrap.admin只读目录标识自动扩张为管理员写权限。负责人对已迁移且受目标保护的本库目标显式执行：

```bash
pnpm run db:seed -- test --acceptance ID --admin-users
# 全新目标如需生成初始管理员文件，再显式加 --generate-credentials
```

ID必须来自本机允许的验收归属记录，不能照抄占位符。普通dev/test当前未deploy，不能把上例当作已执行证据。注册 `admin.user.manage`（resourceType=api、module=core、action=manage-admin-users、apiPath=/api/admin/users）；已有定义元数据不匹配则事务回滚。已有status/角色授权不更改，不给bootstrap角色自动加管理授权，不修复撤销关联。默认Seed仍为七行；新目标带该标志首次是八行（加一个权限定义，无新增授权关联）。缺定义/停用定义时真正超级管理员也403。

AF-015验收fixture另在自身新逻辑库显式生成manager/reader及对应角色授权，均为合成数据，不是普通Seed的隐式行为。已有账号/角色/密码不静默重置；初始文件不保证人工改密后的密码。

## 3. AF-015历史人工观察（当时快照，勿沿用旧PID）

本轮Codex已实际准备API，状态在 `.artifacts/af-015/manual.json`，PID 17999，库 `aij_foundation_af015_test_c4c34b82b92ca9fe`。Web3655没有启动，没有管理员页面。实际health/ready：

- http://localhost:3656/api/health
- http://localhost:3656/api/ready
- 登录POST http://localhost:3656/api/auth/login
- 管理入口 http://localhost:3656/api/admin/users

DB无密码地址 `postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af015_test_c4c34b82b92ca9fe`；DB密码在本库忽略 `.local-data/postgres/test/postgres-password`。产品初始凭据仅在本机文件：

| 账号 | 角色与预期 | 初始密码文件（仓库绝对根下） |
| --- | --- | --- |
| aij-admin | DB超级管理员，管理200、目录200 | .local-data/seed/test/aij_foundation_af015_test_c4c34b82b92ca9fe/initial-admin.json |
| af015-manager | admin.user.manage，管理200、只读目录403；不能分配角色或修改超级账号 | .local-data/seed/test/aij_foundation_af015_test_c4c34b82b92ca9fe/admin-accounts.json 对应username |
| af015-reader | aij.bootstrap.admin，管理403、目录200 | 同一admin-accounts.json对应username |

绝对根为 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`。负责人只在本机安全HTTP客户端读密码，Token仅保存在本机内存/安全客户端，不放命令历史、聊天或报告；JWT key在忽略auth目录，客户端无需读取。ExFAT不作为POSIX权限隔离证明。

1. Trea先只读审查注册表、admin-users.test.mjs实际断言与报告，不执行prepare-manual。负责人观察health/ready各200；无Bearer访问管理入口应401。
2. 三个账号分别用本机密码POST登录（JSON username/password），得到Bearer；GET /auth/me及/admin/permissions/my各200；GET管理员列表分别200/200/403，安全字段没有hash。
3. 用manager创建唯一合成账号（如af015-human-时间戳，密码由负责人本机随机生成并安全保存），POST返回201/id；GET详情/分页查到该id；用PATCH更改realName、清空email后重读匹配。弱密码、重复用户名、越额isSuperAdmin字段分别400/409/400。
4. 用manager给该账号PATCH roleIds或修改aij-admin应403且原数据不变；root可绑定现有af015_manager角色，账号同一JWT立即获管理权限，清空角色后403。不要改变三个人工观察账号以免影响后续检查。
5. 对新合成账号禁用后登录/既有JWT401，启用后恢复；重置其密码后旧密码401、新密码200（旧JWT仍至到期）。DELETE后详情404、登录/既有JWT401、重复用户名仍409；数据库保留tombstone和成功操作最小审计，不含明文值。
6. 自停用/自删除/自重置应409；检查成功变更和拒绝的HTTP状态及关联ID。自动测试已做并发/真实断库恢复；人工无需停止共享实例或连接原库。

自动三账号观察和准备结果不替代负责人人工验收；浏览器本轮未调用，未声称页面/工具策略通过，CORS不作为管理员授权。

## 4. AF-015历史停止与复跑

```bash
node scripts/verification/admin-users-manual.mjs stop
# 仅指定Writer在3656已释放后运行：
pnpm run verify:task -- AF-015
pnpm run verify:task -- AF-015 --prepare-manual
```

stop先核对记录任务、库、PID/PPID/CWD/完整命令/birth，仅SIGTERM自己的main并确认真实零池；不按端口kill。准备复用唯一生命周期和已有合成库/账号，不重置密码/角色；PREPARED不等于PASS或人工通过。保留合成库/卷/凭据，不提供reset/drop/down -v清理命令。真实普通/准备结果、失败修正和保护状态见[AF-015执行记录](../execution/AF-015.md)。**Trea待复核、人工待验。**
