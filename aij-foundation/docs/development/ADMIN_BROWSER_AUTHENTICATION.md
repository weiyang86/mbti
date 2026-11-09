# UI-1 管理员浏览器登录与人工检查

范围：UI1-01–04 / AF-026–029。复用本库管理员Auth、Prisma、Seed和RBAC；AF-025-A客户认证仍待验，客户logout/改密/同意和UI-2工作台不在本批。

## 接口与隔离

| 接口 | 用途与要求 |
| --- | --- |
| POST /api/auth/login | 已有CLI Bearer登录；900秒、持久会话，响应含Token，仅服务端/CLI使用 |
| POST /api/auth/browser-login | 浏览器用户名/密码，严格DTO；精确WEB_URL Origin + X-AIJ-Client:web，返回安全用户与有效期，Token仅写Cookie |
| GET /api/auth/session | 只接受管理员Cookie；返回安全用户+绑定会话的CSRF值，不返回认证Token |
| GET /api/auth/me | 已有安全用户信息，当前数据库会话/账号有效才成功 |
| POST /api/auth/logout | 只撤销当前会话；Cookie用途需Origin+X-AIJ-CSRF，成功清Cookie并原子审计 |
| POST /api/auth/password | currentPassword/newPassword严格DTO及当前凭据验证；成功更新bcrypt12、版本递增、撤销本人全部会话并清Cookie；本批无改密页面 |

Cookie名称由项目环境前缀生成，当前测试为`aij_foundation_test_admin_session`，host-only、Path=/api、HttpOnly、SameSite=Strict、Max-Age=900；production策略追加Secure。Cookie不隔离端口，隔离还依赖issuer/audience/secret、namespace和独立数据库。Bearer与Cookie用途同时写入JWT和会话记录，不能互换/混用。客户Cookie不会成为管理员身份。所有管理员Cookie写请求统一Guard校验Origin/CSRF；CORS不代替认证/RBAC。

每请求查询当前会话与账号。退出、停用、软删、受控重置/本人改密后，旧会话下一次认证即拒绝；重新启用账号不复活旧会话。RBAC仍用当前DB权限。已进入业务事务的请求不承诺分布式取消。迁移新增SysUser.tokenVersion和AdminAuthSession；旧无会话claims的JWT须重新登录。无自动refresh、延长会话或客户生命周期新增。

## 本机人工入口

最终运行快照、真实PID/库/忽略密码文件见[AF-029执行记录](../execution/AF-029.md)及本机`.artifacts/af-029/web.json`；PREPARED只表示准备成功，负责人仍需人工验收。

1. 打开`http://localhost:3655/login`，请使用localhost，不换成127.0.0.1（Cookie和Origin不同）。账号`aij-admin`，初始密码由负责人打开快照中的`initialPasswordFile`获取；密码不在文档/终端回显。重复准备不重置已有密码。
2. 空表单应提示必填；错误密码应显示“用户名或密码不正确”；使用本机合成密码登录应进入`/admin`，显示账号和安全身份，无hash/JWT。
3. 刷新`/admin`应保持登录；点击退出应回到登录页，再直接打开`/admin`应跳回登录页。页面只消费API结果，敏感权限以API为准。
4. 可选过期观察：登录后执行下方专用`expire`，只过期本任务合成管理员Cookie会话；刷新后应跳回登录，重新登录仍可使用原密码。当前可见页每15秒及获得焦点重新查会话，最终是否过期由API裁定。
5. 本批只开放登录与退出，没有用户/角色管理页面；管理员改密/重置/停用的真实HTTP/DB拒绝与回滚证据在注册测试中。不要以登录页完成推定UI-2已实现。

## 重复校验、停止和恢复

在仓库根目录执行。校验需要3655/3656空闲；不得停止不属于本任务的监听。停止脚本先核验PID/PPID/CWD/命令/birth和验收库lease，再发SIGTERM，失败不会强杀。若端口被他人占用应报告并保留现场。

```bash
node scripts/verification/ui1-manual.mjs stop --task AF-029
pnpm run verify:task -- AF-029
pnpm run lint && pnpm run typecheck
pnpm run verify:task -- AF-029 --prepare-manual
```

已有本任务服务运行时直接幂等检查/恢复（注册prepare的前置要求端口空闲）：

```bash
node scripts/verification/ui1-manual.mjs prepare --task AF-029
node scripts/verification/ui1-manual.mjs expire --task AF-029
```

准备使用真实生产Next build与API dist；首次或源码变更后须先运行注册校验完成构建。准备只新建本任务受保护验收库或复用自身同Schema快照；不迁移旧快照、不改原dev/test、无重置/删库/清卷。停止保留合成数据和本机凭据，人工检查完仅停止本任务服务；数据库容器为本库既有实例，不按端口批量kill或全局down -v。

## 证据边界

verify运行真实命令、HTTP、DB和Web资源/服务生命周期；Chrome/CUA交互另存`.artifacts/ui-1/browser/`，附源文件SHA与实际服务runId。浏览器记录不是每次verify都自动重演，源码变化需重做对应观察。生产Secure为真实HTTP头策略测试，未进行TLS部署/生产访问。Trea复核、负责人人工验收与Git发布节点仍由负责人控制。
