# AF-130 — 打通 base 普通账号只读角色与审计闭环（候选交接）

2026-11-04。状态 `CANDIDATE_READY_FOR_COORDINATOR_VERIFICATION`，不是 CODE_VERIFIED、负责人接收或批次完成。

## 派工、依赖与范围

- Run `run_d4eae5ba3a3b`；Task `task_766e5e9f3411`；Dispatch `ctx_455adcc583b2`；Writer `term_11f81f42-9d1c-456e-a2b0-94a2531c32ab`；总控 `term_bc55f07a-bdd7-4207-8cce-91eb1f03863d`。
- 原目录 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`，`dev@580cba1f8363cf63ab637e070b20d9e8d7ce49e0`；origin 仍为 `git@github.com:weiyang86/aij-foundation.git`。没有创建/切换分支、暂存、提交或推送。
- 以当前 AF-130 派工顶部及总控消息 `msg_cbbf0d94fdf8` 覆盖原不可变 Dispatch 中的旧范围：AF-134 集成 `task_860aa66579d5`、AF-135 集成 `task_640043a5132e` 已完成；负责人授权 UI-1 已验证后的独立持久 Base，本卡不批量接收 B01。
- 开工读过 AF-134/135 候选及正式记录、Base 配置/私有文件/owner 检查、原 Admin/RBAC/Audit/字典 Controller/DTO/Service/Guard、AdminShell。总控消息 `msg_016c0c43b3c3` 已收到写前锁定范围。
- 继承的队列、AF-130 计划、未跟踪执行手册均未写。只写下面五个候选文件，无子 agent。没有触碰 AF-029 的源码、构建、账号、服务或数据库，以及轻企/易修仓库。

## 实际差异与影响

1. `apps/web/app/admin/page.tsx`：只移除通用工作台上的 `aij.bootstrap.admin` 参数。继续经过原 AdminShell 的 session/permissions/my/menus/my 及 401 跳转，展示后端实际菜单与当前身份。字典及其他资源页/API 权限、Guard、导航 owner 全部沿用 AF-134/135；没有给普通账号 bootstrap/manage/super。
2. `scripts/verification/product-readiness/base-admin.mjs`：总控专用 `prepare|verify|--help`，无目标/凭据覆盖、reset、cleanup 或初始化入口。正式执行先调用既有 `basePreflight`，再核对已初始化 owner、空插件、clientAuth关闭、初始管理员凭据私有属性；复用正式 browser-login Cookie，写操作使用对应 session 的 CSRF 与正确 Origin。无 SQL、Docker 命令或进程控制。
3. `base-admin.test.mjs`：真实 HTTP 验证入口，包含严格 Base DB 前置检查，**Worker 未运行**。
4. `base-admin.unit.test.mjs`：纯配置/文件/拒绝检查。
5. 本候选记录。无 Schema/migration、依赖、锁文件、API/审计 owner 或菜单初始化变化；原有 `admin.dict.read/manage` 定义从唯一字典 policy 消费。

`prepare` 首次用正式 API 创建专属普通用户（不附角色），实际检查其 raw/effective 权限与后端菜单为空、字典 GET403，再创建仅 read 的角色、独立执行角色权限 PUT 和用户角色 PATCH，最后创建两个合成分类（一个含单条目，一个为空用于合法 DELETE 拒绝）。账号、角色和字典拥有随机 AF-130 命名与 owner UUID 标记；用户是 `isSuperAdmin=false`。不修改任何既有身份或权限定义。

私有记录仅在被忽略的 `.local-data/base-development/af130-reader.json`，包含 username/password、owner UUID、project/environment、返回的 userId/roleId/字典及条目 ID 和准备阶段。记录每个 API 返回的 ID 后才继续。目录/文件复用既有私有路径检查及 0600 写入；加载检查精确字段、UUID/项目/账号名/角色名/ID，并经正式 GET 交叉核对用户名、角色关联、权限关联、状态和 owner 标记。重复 prepare 不重置密码、不写已有角色授权、不改内容，也不改凭据字节；有效登录会按原 AuthService 更新 lastLoginAt/updatedAt，这两项在账号重复准备比较中明确排除。

同名但无 ID 记录、角色/用户权限漂移、跨 owner 文件、私有文件错误、模糊 HTTP 成功后未保存 ID 均拒绝自动接管。独占 `af130-reader.lock` 防并发准备；中断留下的锁不自动删除，总控先确认 Writer 已停再决定恢复。脚本不提供强制覆盖或自动清理路径。密码、Cookie、CSRF、hash、原始响应不输出、不写证据；CLI 仅输出合成用户名/资源 ID/凭据文件路径。

## Worker 已运行检查

```sh
node --test scripts/verification/product-readiness/base-admin.unit.test.mjs scripts/verification/dictionary-read.test.mjs
pnpm exec eslint apps/web/app/admin/page.tsx scripts/verification/product-readiness/base-admin*.mjs --max-warnings=0
node --check scripts/verification/product-readiness/base-admin.mjs
git diff --check
```

全部 exit0，纯测试 12/12（本卡4、既有字典8），fail/cancel/skip/todo均0。包括严格 CLI/无 live preflight 的帮助、owner/项目/阶段/账号绑定、未知字段与非法凭据拒绝、私有文件只读保留/符号链接/权限拒绝、foreign ID/super/额外角色/授权漂移/未登记成功操作拒绝。临时纯文件只创建在 `.artifacts/orca-b02/AF-130/unit/`，测试结束只删除自身临时目录。

早期定向 lint 发现两个未使用解构变量，改为复制后排除登录时间字段；一个纯测试原先把满足三类字符的 canary 当成非法密码，改用含换行的非法输入。两项已更正并重跑通过，未调整产品密码规则或删除拒绝断言。上述检查是同一 Writer 自查，不冒充独立 Review。

没有运行真实 HTTP、Base preflight、数据库连接、Docker、服务启停、任何构建、完整 lint/typecheck、正式 verify 或浏览器操作。不会把目标测试文件的存在或页面 HTTP200当成已渲染通过。

## 总控剩余门禁与证据契约

总控串行接回后，只按已登记 Base 生命周期隔离重建，保留 AF-029：

```sh
pnpm base:dev stop
pnpm base:dev start --build
node scripts/verification/product-readiness/base-admin.mjs prepare
node --test scripts/verification/product-readiness/base-admin.test.mjs
# 注册正式检查后：
pnpm run verify:task -- AF-130
```

`prepare` 可重复使用，也可直接由目标测试首次准备。读取本机凭据文件用于真实登录，不把密码拷到报告/日志。`verify` 在持有独占锁时调用准备两次，并比较凭据字节、账号非登录字段、角色/授权、后端菜单、合成分类/条目；管理员四入口 API200，普通账号 raw/effective 均仅 read、菜单仅字典、分类/条目 GET200；核对同一 Cookie 的实际 CSRF 后，六类字典写、改本人角色及给自身角色增加 manage 的合法请求全部403，每次后比较数据与身份授权不变；正式 logout 后原 session401，再登录仍只有 read。

审计查询指定操作者、目标资源、模块/动作与本卡 prepare correlation：`admin-users/created` 必含 identity 且无 roles；`admin-users/updated` 含 roleIds；目标角色的 `role_permissions_assigned` 含 permissionIds，before为空、after仅read ID。当前 verify correlation 下还要求本只读用户的六次 manage 拒绝及用户/角色管理拒绝审计。只依赖既有 RBAC permission_denied owner，不声称全部 DTO 拒绝持久审计。

真实运行证据写 `.artifacts/orca-b02/AF-130/base-admin-<UUID>.json`，失败时 completed=false。证据保留身份/资源/审计 ID、请求路径/方法/状态和逐项比较结果，不保留响应正文或秘密。`browserObservation` 永远留 `PENDING_COORDINATOR`，只能由总控另留真实浏览器证据。

当前已登记的持续 Base 地址是 `http://127.0.0.1:3855/login`，API3856、独立PG55434；本候选没有探活或证明新页面已部署。总控需实际验证管理员建号/授权、只读账号登录默认 `/admin` 看见一项后端字典入口、分类/条目读取且写按钮不可用、刷新/退出重登、管理员按目标用户和角色查询上述审计。API准备的专属账号可用于持续验收；若浏览器另做新增/授权操作，使用另一组新合成身份，勿覆盖准备记录的已有账号/角色来演示。

实际启动/停止仍由既有 `pnpm base:dev start|status|stop`，源码变更用 stop 后 start --build；不加额外 `--`。服务应由总控验收后保持运行，并在负责人说明中登记实际 URL、私有凭据文件与点击步骤。全仓 lint/typecheck、隔离 API/Web build、正式 registry/队列/执行记录、差异与精确暂存、本地原标题提交和 SHA 回读均由总控完成；不 push、不启动 AF-131、不自动跨批。

## Writer 交接

本候选实现及允许的纯检查完成，未发现需扩大允许范围的实现依赖。真实 HTTP、浏览器、正式门禁与负责人接收仍待总控执行，不能据此将本卡标记 CODE_VERIFIED。**本 Writer 在发送 worker_done 后明确停止全部写入**，交总控成为唯一串行集成 Writer；若 live 校验失败请回派本 Writer，不并发修补同一范围。
