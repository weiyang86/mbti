# 客户登录与会话生命周期（AF-025-A、AF-039–AF-041、AF-083–AF-085）

本文件前半保留 AF-025-A（2026-10-20）的登录/会话认证交付快照；它当时没有 logout、改密、撤销或同意 API。后续 NEXT-03 的 AF-039、AF-040、AF-041 已分别补入这些客户生命周期能力。负责人已接收 AF-039 代码；三卡人工验收与批次接收统一待负责人操作，AF-025-A 本身仍待验收，未被标记为已接收。

## 后续生命周期接口（当前代码契约）

| 接口 | 当前契约 | owner / 执行记录 |
| --- | --- | --- |
| `POST /api/client/auth/logout` | 认证当前项目会话后撤销当前 session、清除本项目 Cookie；其他 session 保持有效。 | ClientAuth + ClientAuthSession；[AF-039](../execution/AF-039.md) |
| `POST /api/client/auth/sessions/revoke-all` | 仅撤销当前 project/environment namespace 下的客户会话，跨项目会话不受影响。 | ClientAuth + ClientAuthSession；[AF-039](../execution/AF-039.md) |
| `PATCH /api/client/auth/password` | 要求当前密码重认证；成功更新账号级密码与 tokenVersion，撤销该会员所有旧项目会话、清 Cookie，并按哈希键限流。 | ClientAuth + MemberUser + ClientAuthRateBucket；[AF-040](../execution/AF-040.md) |
| `GET /api/client/auth/consents` | 只返回当前客户和当前服务端 namespace 的每类最新同意记录；匿名请求拒绝。 | ClientAuth + ClientConsentRecord；[AF-041](../execution/AF-041.md) |
| `PATCH /api/client/auth/consents` | 当前客户同源写入。相同状态/版本/digest 幂等；新版本与撤回追加历史，source 和时间由服务端产生。 | ClientAuth + ClientConsentRecord + AuditLog；[AF-041](../execution/AF-041.md) |
| `POST /api/client/auth/email/verification/request` | 匿名邮箱验证请求；未知账号、已验证账号和无法投递时均返回相同 `202 { accepted: true }`。只有显式配置可用通知适配器时才签发随机令牌。 | ClientAuth + ClientAuthOneTimeToken + ClientAuthRateBucket + AuditLog；[AF-084](../execution/AF-084.md) |
| `POST /api/client/auth/email/verification/confirm` | 匿名确认；令牌绑定当前项目/环境用途，30 分钟过期、一次消费；无效/过期/撤销/重放返回通用 `400`，限流返回 `429`。成功设置 `emailVerifiedAt` 并激活待验证账号。 | ClientAuth + MemberUser + ClientAuthOneTimeToken + ClientAuthRateBucket + AuditLog；[AF-084](../execution/AF-084.md) |
| `POST /api/client/auth/password/reset/request` | 匿名申请；邮箱规范化，已知与未知账号均返回 `202 { accepted: true }`。只对 active、已验证客户签发当前 namespace 的 30 分钟令牌；通知默认关闭，只有非生产内存 test adapter 可接收明文令牌。 | ClientAuth + ClientAuthOneTimeToken + ClientAuthRateBucket + AuditLog；[AF-085](../execution/AF-085.md) |
| `POST /api/client/auth/password/reset/confirm` | 匿名持单次令牌重设。令牌用途绑定 project/environment namespace，数据库仅存 HMAC 摘要；确认事务原子消费令牌、更新 bcrypt 密码与 `tokenVersion`、撤销同一账号所有项目会话及竞争重设令牌。成功返回 `{ reset: true }` 并清除当前客户 Cookie；无效、过期、撤销或重放返回通用 `400`，限流 `429`。 | ClientAuth + MemberUser + ClientAuthSession + ClientAuthOneTimeToken + ClientAuthRateBucket + AuditLog；[AF-085](../execution/AF-085.md) |

AF-084 与 AF-085 复用既有 `ClientAuthOneTimeToken`，数据库只保存独立服务端 `CLIENT_AUTH_TOKEN_SECRET` 生成的 HMAC-SHA256 摘要；审计和 HTTP 响应不包含明文令牌。该密钥在 `CLIENT_AUTH_ENABLED=true` 时必填，需与客户 JWT 和限流密钥独立。通知适配器默认关闭；目前只有显式 `CLIENT_AUTH_NOTIFICATION_ADAPTER=test` 的内存验收适配器，生产环境拒绝该模式。真实邮件/短信适配器仍未接入，所以公开请求虽会统一应答，生产中不会实际投递密码重设链接；外部投递、链接页面和浏览器人工流程仍待后续 owner 决策与接入。

同意接口当前只校验并记录客户端呈交的版本号与 digest，未匹配服务端权威文案目录。因此它记录版本化同意状态，但不能独立证明客户端展示了哪个具体文案或声称满足法律合规。业务项目在真实收集同意前必须提供已批准文案目录并由 UI 使用对应版本/digest。客户账号注销、身份导出和 Workspace 租户 API 仍未实现。

需要已登录会话的客户写路由由 `ClientAuthGuard` 认证，并对 Cookie 写请求执行同源校验；邮箱验证和密码重设申请/确认是匿名路由，依靠严格 DTO、项目用途绑定的单次令牌及限流，不接受客户端自报身份。所有响应设置 `no-store`。HTTP/DB 真实验证和拒绝路径见各卡记录。自动验证已通过，人工统一验收尚未执行。

## AF-025-A 登录与会话认证原始交付快照

日期2026-10-20。该卡仅交付客户登录与会话认证前置；其原始 Trea/人工状态保留在 [AF-025-A执行记录](../execution/AF-025-A.md)。不要把下面 AF-025-A 当时的功能边界误读为 AF-039–041 的当前 API 清单。

## 1. 当前契约与owner

| 项 | 实际实现 |
| --- | --- |
| 组合宿主 | `CLIENT_AUTH_ENABLED=true`独立装配唯一ClientAuthModule，默认false；与`AUTH_ENABLED`无依赖，启用必须有目标保护DB及已应用本库迁移 |
| Controller / DTO | `POST /api/client/auth/login`收email/password，规范化邮箱、严格拒绝额外字段；bcrypt最多72字节；必须带与WEB_URL完全相同的Origin，Sec-Fetch-Site=cross-site拒绝。CORS不是此写请求检查 |
| 登录Service | bcrypt验证当前MemberUser；事务重查passwordHash/tokenVersion/active/未删除，再创建ClientAuthSession、lastLoginAt、签JWT与AuditLog，失败整体回滚；无通用默认密码 |
| 客户Guard | `GET /api/client/auth/me`只接收本项目唯一合法Cookie；强制签名/HS256/issuer/audience/client用途/项目/环境/iat/exp/必填sessionId/tokenVersion；每次查DB成员和会话归属、状态、未撤销/未删除、签发/过期时间，返回当前安全member字段 |
| Cookie | `COOKIE_PREFIX + _client_session`；host-only、不设Domain，HttpOnly、SameSite=Strict、Path=/api/client、Max-Age=604800；NODE_ENV=production增加Secure。JSON不返回Token，拒绝重复Cookie/旧产品Cookie/Bearer/query Token；没有localStorage消费 |
| issuer / audience | 客户issuer=`JWT_ISSUER + :client`；audience=`urn:aij:<projectId>:<APP_ENV>:client`；与管理员issuer/audience分开，Token还绑定projectId/environment。没有默认/原产品issuer |
| 凭据 | 独立服务端CLIENT_JWT_SECRET、CLIENT_AUTH_RATE_LIMIT_SECRET和CLIENT_AUTH_TOKEN_SECRET；客户认证启用时三者均须32+字符、非模板且互不复用，不得放进NEXT_PUBLIC。 |
| 持久化 | 复用本库唯一Prisma与AF-007五模型，不改Schema/两迁移；会话只存ID、归属、状态和时间，JWT不存数据库/日志。IP/设备保存namespace HMAC与固定摘要，不保存原始UA/IP；email只在Member和本人安全响应中使用 |
| 登录限流 | 既有ClientAuthRateBucket，事务advisory lock预留次数；同identity每15分钟5次、同直连socket IP每15分钟30次，第6/31次429；成功仅清identity计数，IP总量仍限制。Bucket只存HMAC；代理/IP策略留部署任务 |
| 审计 / 错误 | 既有AuditLog保存client-auth/login、login_failed、login_rate_limited、成员资源ID和关联ID，不存邮箱/凭据/完整Token。现有管理员审计投影只识别这些固定元数据，关联ID仍隐藏；安全错误与管理员共用唯一AuthErrorsModule，400/401/403/429/503及no-store不回显原错误 |

数据owner仍AIJ identity；审计存储/查询分别沿用既有core owner，无客户Workspace依赖、无SysUser身份转换、无业务Prompt或插件默认启用。设备摘要不是客户端设备绑定；Cookie是Bearer会话，过期和数据库状态仍由后端核验。生产Secure只是实际HTTP头序列化测试，不表示TLS、浏览器存储或生产部署已验收。

## 2. 校验与准备

在本库根目录使用Node24/pnpm10：

```bash
pnpm run verify:task -- AF-025-A
pnpm run lint && pnpm run typecheck
pnpm run verify:task -- AF-025-A --prepare-manual
```

普通verify要求3656空闲。已PREPARED时，先交回指定Writer运行下述精确stop，再verify/prepare；Trea只运行普通验证，不运行prepare。注册实际校验配置/执行器、Prisma编译/API构建、管理员HTTP/RBAC/审计回归、客户HTTP/DB与真实main；testDatabase=true、uniqueWriter=false。约束失败探针只在新自有合成库添加并finally移除，不修改源码或共享库。

父`AF-025`、未指派`AF-025-B`和未知任务仍非零，不用A的成功覆盖B。旧AF-013人工库是旧Schema快照，保护明确拒绝复用；本项不会改旧lease/密码或代迁移。管理员main控制在AF-025-A当前Schema新库实测，见[执行记录](../execution/AF-025-A.md)。

## 3. 实际人工入口与步骤

当前API PID70954、PPID1、birth `Tue Oct 20 08:30:25 2026`；本机Node执行本库`apps/api/dist/main.js`，CWD本库apps/api，只监听127.0.0.1:3656。Web3655未启动，没有客户登录页面。

- 登录：`http://localhost:3656/api/client/auth/login`；本人：`http://localhost:3656/api/client/auth/me`。
- 每次登录需要HTTP Header `Origin: http://localhost:3655`与`Content-Type: application/json`；全程使用同一localhost API主机及HTTP客户端Cookie jar。
- 两个合成客户邮箱：`af025a-member@example.test`、`af025a-other@example.test`；username分别af025a-member/af025a-other，角色仅customer，没有管理员授权。
- 初始密码只在本机忽略文件`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/auth/test/aij_foundation_af025a_test_62703f682bf3baf0/client-accounts.json`，按email取对应password，由负责人在本机客户端填写。不要把文件、密码、完整Cookie/JWT或key发进报告/截图；已改密码时使用当前值，不用准备脚本重置。
- 本库合成验收库`aij_foundation_af025a_test_62703f682bf3baf0`，127.0.0.1:55433、24个public表（含迁移账本）。合成client keys在同目录client-keys.json；这些是本机验收材料，真实部署凭据由负责人安全配置，不复用。

步骤及预期（全部仍**人工待验**）：

1. GET health与ready：`/api/health`、`/api/ready`均200。没有Cookie的GET me应401/no-store，不能因提供memberId/workspaceId/permission变成授权成功。
2. POST login，JSON只有实际合成email/password。正确返回200与本人id/email/nickname；检查Set-Cookie的项目前缀、HttpOnly、SameSite=Strict、Path=/api/client/host-only；本地test不设Secure，响应JSON无accessToken/hash。
3. 同Cookie jar GET me应200并仅为该客户；另一独立Cookie jar登录另一客户，应得到另一id。不要把两个同名Cookie拼接发出；重复Cookie预期401。
4. 使用错误密码或不存在邮箱预期相同401/无Set-Cookie；错误/缺Origin或cross-site登录403，畸形DTO/多余字段400。每identity累计5次尝试后429，等待15分钟或用正常已有会话观察；不清库/重置限流规避验收。
5. 在本机工具中将有效Cookie的名字换成其他项目或旧产品名，GET me应401；只用Authorization Bearer或query Token也应401。错误audience/issuer/项目/时效/篡改由真实自动校验覆盖，不把生产key或完整JWT复制出本机。
6. 如需人工看审计，用控制管理员aij-admin经`/api/auth/login`取得管理员Bearer，再GET `/api/admin/logs?module=client-auth`；只看到固定客户动作/安全资源元数据，邮箱、原Cookie/凭据/原始关联ID不出现。管理员初始密码在本机忽略`.local-data/seed/test/aij_foundation_af025a_test_62703f682bf3baf0/initial-admin.json`；客户Cookie不能当管理员授权。

自动观察已验证login/me200、匿名/跨Cookie401、缺Origin403、管理员安全审计200和重复准备PID/凭据文件保持；它不是负责人人工结果。改密、同意、logout、撤销本项没有操作步骤或可用接口，等待AF-025-B指派。

## 4. 停止与保留

```bash
node scripts/verification/client-auth-manual.mjs stop
```

只由指定Writer运行。共享生命周期核对记录的PID、PPID（原父或init接管）、CWD、完整命令和birth，再向该PID发送SIGTERM，确认进程退出及该库应用池为0；不按端口kill，不启停DB容器，不删除数据库/卷/账号/凭据，不reset/drop/down -v。再次准备走已注册prepare，保留原账号和文件，不静默重置。真实地址/进程可能在后续交接后变化，以本机`.artifacts/af-025-a/manual.json`和实际归属为准。
