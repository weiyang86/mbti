# 管理员登录与JWT认证（AF-013）

2026-10-27 UI-1增量：管理员现有Auth/JWT已加入持久会话、退出/改密/受控重置/停用失效、浏览器Cookie/CSRF及登录页。当前契约和人工入口见[管理员浏览器指南](ADMIN_BROWSER_AUTHENTICATION.md)，下文旧无状态JWT/未撤销/PID说明保留为各卡历史，不适用于新会话。原用户/角色API与后端RBAC owner保持。

AF-016已接收前序并接入角色/权限管理API，当前人工API3656/合成账号/忽略密码文件/停止命令以[角色权限指南](ROLE_PERMISSION_API.md)为准。本页旧任务范围/PID按历史阅读，不沿用旧PID；Schema/initial及既有接口契约保持。

当前AF-015已接收前序并接入管理员基础管理API，当前3656/三账号/忽略密码路径与操作以[管理员管理指南](ADMIN_USERS_API.md)为准。以下保留本任务历史范围/PID，旧人工API已在后续核验中停止，不能沿用。

AF-013已由负责人接收。以下保留其交付时地址/PID和范围；AF-014已接入核心权限Guard/只读接口，当前三组合成账号与运行状态以[RBAC指南](RBAC_AUTHORIZATION.md)为准。本页旧人工API已在后续校验中停止，不沿用旧PID。

复用已接收AF-012合成管理员的bcrypt12 hash与AF-011唯一Prisma服务。唯一认证owner是apps/api/src/auth，Guard在common/guards；本项没有Web登录页、管理员CRUD、RBAC授权/菜单、客户认证、刷新/注销撤销、改密或找回服务。项目组织不作为Workspace租户权限边界。

## 1. 接口与失败语义

| 实际接口 | 输入/输出 | 失败 |
| --- | --- | --- |
| POST /api/auth/login | JSON username/password；200统一响应data含accessToken、tokenType=Bearer、expiresIn=900及安全user | DTO/非法JSON/超过bcrypt72 UTF-8字节400；不存在/坏密码/停用/软删统一401；DB不可用/身份或迁移不匹配503 |
| GET /api/auth/me | 严格Authorization: Bearer JWT；200返回当前DB的id/username/realName/isSuperAdmin | 缺Token、签名/用途/issuer/audience/项目/环境/时间非法、过期或当前账号失效401；DB不可用503 |
| GET /api/health、/api/ready | 保留进程存活和真实DB/迁移readiness语义 | ready失败503；数据库故障不会合成认证成功或阻断health |

Controller负责入口，LoginDto限制username1–64字符/password1–72字符，Service额外检查72字节上限；AuthService执行bcrypt compare、当前身份查询、lastLoginAt与最小登录审计。JwtAuthGuard验证Token并把当前DB身份写request.user，不信任Token角色/超级管理员声明。SysUser/RBAC/AuditLog归AIJ core，PrismaService仍唯一数据库运行时owner。

JWT HS256，固定900秒，issuer来自受校验JWT_ISSUER，audience为urn:aij:<projectId>:<APP_ENV>:admin；claims只含sub/admin tokenKind/projectId/environment/iat/exp/iss/aud/jti，无权限快照或密码/hash。拒绝Cookie/query里的Token，不设置Cookie，不写浏览器storage。已有Token在账号停用/软删除后立即拒绝；单独改密码不撤销已签Token，最多存活15分钟，后续撤销能力需独立指派。当前未接入登录限流/MFA/刷新或撤销，不作为生产安全交付。

登录成功事务更新lastLoginAt并记录AuditLog，坏凭据记录统一login_failed；审计只存固定路径/方法/状态、已知userId和校验过的correlationId，不存原始请求/密码/hash/JWT。DTO/非法Token失败不宣称全部都有持久审计。请求关联在middleware建立，覆盖Guard/解析错误，认证错误只给固定去敏消息。不是完整通用AuditLogService迁入。

## 2. 启用契约

AUTH_ENABLED默认false，关闭时登录/me路由404；该404只表示此配置不装配Auth。显式启用需要DATABASE_ENABLED=true、正确独立DB URL和已应用的本库initial；JWT_SECRET必须专用强随机32字符以上且非模板，无开发默认或跨环境fallback。未迁入的三个CLIENT_*保留字段空值不强索取，显式提供时仍验证强度与不复用；未启用插件不索取凭据。

AppModule.forRoot按每次应用的有效配置组合AuthModule，JwtModule公开导出供Guard消费，不复制JWT或ORM实现。来源@Module/Controller/Service/DTO/Guard定向适配见SOURCE_PROVENANCE第13节。来源7d、旧issuer、默认secret、Token角色快照及仅审计的logout均未沿用。

## 3. 当前实际人工入口

Web3655未启动，无登录网页。仅API监听127.0.0.1:3656，下面URLs已经自动真实访问；人工验收仍待负责人执行，不冒称浏览器已通过。

- 登录：`http://localhost:3656/api/auth/login`（POST）；身份：`http://localhost:3656/api/auth/me`（GET Bearer）。
- 存活/就绪：`http://localhost:3656/api/health`、`http://localhost:3656/api/ready`，当前均200。
- 合成用户名：`aij-admin`；初始密码仅在本机忽略文件 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af013_test_ddbb45eab3d32a33/initial-admin.json`。由负责人在本机安全查看，勿复制到报告/聊天/命令行参数。
- JWT key文件：`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/auth/test/aij_foundation_af013_test_ddbb45eab3d32a33/keys.json`，只由服务本机读取，不需要交给HTTP客户端。
- 数据库：`postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af013_test_ddbb45eab3d32a33`；这是DB角色，不是产品管理员。DB密码单独位于.local-data/postgres/test/postgres-password。
- API PID 73603；实际PID/PPID/CWD/完整命令/启动时间、日志和池在.artifacts/af-013/manual.json。原dev/test和旧AF-012人工账号保留，不改密或复用旧账号。

逐步操作：

1. Trea先读registry.mjs的AF-013真实files/testFiles/前置/effects及断言，不运行--prepare-manual。负责人可先在浏览器或HTTP客户端打开health/ready，预期200、AIJ测试身份、空插件。
2. 负责人本机运行下面脚本，密码和完整Token仅在内存，终端只输出状态/安全身份。预期login200、me200且aij-admin；bad401、missing401。不要打印login完整响应或Token。

```bash
node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
const state=JSON.parse(readFileSync('.artifacts/af-013/manual.json'));
const {password}=JSON.parse(readFileSync(state.initialPasswordFile));
const send=value=>fetch(state.loginUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:state.username,password:value})});
const login=await send(password);
if(login.status!==200)throw new Error('Login did not succeed: '+login.status);
const {data}=await login.json();
const me=await fetch(state.meUrl,{headers:{authorization:'Bearer '+data.accessToken}});
const identity=await me.json();
console.log({login:login.status,me:me.status,user:identity.data});
console.log({bad:(await send('invalid-synthetic-value')).status,missing:(await fetch(state.meUrl)).status});
JS
```

3. 在DB客户端仅查询不含password_hash的sys_user身份/last_login_at及audit_log的module/action/status/request_summary，预期登录时间更新、成功与失败记录有关联ID，无密码/Token/hash。自动化中的停用/软删/断库恢复探针仅对自身新合成库执行，证据可复核；本人工脚本不关闭DB实例。
4. 复跑 `pnpm run verify:task -- AF-013` 前先执行 `node scripts/verification/auth-manual.mjs stop`，它先核对记录的PID/PPID/CWD/完整命令/启动时间，再SIGTERM确切自有进程并检查零池；不按端口kill。普通verify顺序占用3656，预期177有效项+2宿主用例且退出0。
5. 仅负责人安排的Writer可执行已注册 `pnpm run verify:task -- AF-013 --prepare-manual` 恢复观察环境。它只跑前置和安全钩子，结果PREPARED；当前已有账号/密码/JWT文件不重置，不自动迁下一项。停止后保留库/卷/凭据/证据，不执行reset/drop/down -v。

**Trea待复核、人工待验**。原库只读、未连接原数据库；Git/发行/实际部署节点由负责人控制。真实命令/退出码、基线与影响见[AF-013执行记录](../execution/AF-013.md)。
