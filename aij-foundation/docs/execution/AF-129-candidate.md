# AF-129 — 核验 AI 菜单来源并给出基础版入口（候选交付）

状态：CANDIDATE_VERIFIED，待总控注册与正式验证；不代表负责人接收。唯一 Writer：Codex；Task `task_6b3272e480a9`，Dispatch `ctx_d912b233f878`。本次仅依据已读派工与总控消息执行有限审计，附件正文未获得，不声称已读；ORCA-B01/AF-125..128 的负责人待验状态不变。

基线：原工作区 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`，分支 `dev`，HEAD `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，origin `git@github.com:weiyang86/aij-foundation.git`。继承的 `CODING_QUEUE.json`、B02 规划文档和 `orca-product-goal-20261104/` 是总控差异，Worker 未改写、暂存或提交。

## 实际结论

当前两个 AI 菜单源于 **AF-124 合成验收 fixture 中仅有两条 `sys_menu` 记录**。本次实读：一个 active 超级管理员、一个 `aij_bootstrap_admin` 角色、21 个 active 权限定义；管理员、角色、审计所需权限已定义且在 `effectivePermissions` 中。`/admin/menus/my` 与 `/admin/menus` 返回相同的 `/auth/ai/center`、`/auth/ai/usage`，与数据库两条记录一致，没有发现本次两个菜单以外的现有记录被权限或插件过滤。不能由这份证据断言任意其他库或截图账号的权限状况，也不追溯断言这 21 个定义分别由哪次历史操作写入。

| 因素 | 本次证据及边界 |
| --- | --- |
| 版本/端口 | `runtime.json` 启动记录 SHA 与当前 HEAD 一致；PID 47202 的实际命令为 `node .artifacts/product-check-20261104/runtime.mjs`，cwd 为本工作区，Orca 端口扫描确认其监听 13655 和 3656。SHA 是启动记录归属证据，不是对进程内存的独立构建证明。 |
| 旧 3655 | PID 70694，自 2026-10-29 运行 `ui1-web-host.mjs`；lsof 返回 cwd 信息不可解析，构建 SHA 为 **unknown**。未访问它、未把它视为同版或 base，也未停止进程。 |
| 菜单初始化 | `sys_menu` 只有上述两条 active/visible AI 记录；没有 `/admin`、管理员、角色或审计的菜单记录。页面目录存在不等于已经插入菜单。 |
| 权限过滤 | 两条 AI 菜单所需 `admin.config.manage`、`admin.runtime.read` 有效；当前超级管理员也有基础页面的有效权限。超级管理员不会生成缺少的菜单，仍要求有效权限定义。 |
| 插件状态 | 当前项目 `aij-foundation-test` 的 `aij-ai@0.1.0` 安装状态为 enabled；菜单 pages 返回 AI 路由 available=true，与运行配置包含 AI 的过滤结果一致。插件目录真实 GET 返回 available/installation 状态；本卡未 install/enable/disable。 |

## 源码定位

- `scripts/database/seed.mjs:150` 起：管理员、RBAC、菜单管理、审计等开关登记 permission 定义；不据此自动插入基础菜单。`:166` 起的 `aiCenter` 分支才执行唯一的 `INSERT INTO public.sys_menu`，仅列出 AI 中心和用量预算，且注明不协调 grants、不开启插件。
- `apps/api/src/menus/menus.service.ts:31`：先解析真实用户/角色权限、active 权限定义、当前项目 enabled 安装记录，再读取非删除菜单；同时检查 active、visible、运行配置插件、安装状态、有效 permission、用户授权/超级管理员和真实页面目录。目录还受父子树与空目录过滤。
- `apps/api/src/menus/menu-availability.service.ts:6`：基础与插件页面目录；`:16` 检查运行配置的 enabledPlugins。`pages` 只报告页面可用性，不生成数据库菜单。
- `apps/api/src/rbac/permissions.service.ts:30`：超级管理员的展示用 effectivePermissions 来自 active 定义；API Guard 仍独立授权。
- `apps/web/app/components/admin-shell.tsx:26`：读取 session、permissions/my、menus/my；`:58` 起用服务端菜单渲染导航，`/admin` 汇总同一份菜单，不硬编码补齐。
- `apps/web/app/components/admin-auth.tsx:25`、`:34`：已有会话与登录成功均转到 `/admin`。`apps/api/src/app.module.ts:37` 起按 auth/database 能力装配模块，`rbac/rbac.module.ts` 关联 Auth、角色与权限入口。
- 本地 `runtime.mjs` 使用 `createRemainingClientFixture('AF-124', { aiCenter:true, ... })`，并配置 AI 安装记录、合成内容与已知来源代理，不能将这个场景改称独立 base。机器证据保存运行脚本 SHA256，以及上述已提交源文件的 SHA/哈希/锚点行号；没有执行 fixture 构造函数。

## 基础版入口和必要装配

基础版的逻辑入口是 `/login` → `/admin`。现有路由与权限如下，本次均通过 13655 **AI fixture 主机**取得 HTTP 200 页面外壳，未声称完成登录后页面功能验收。

| 路由 | 权限 | 当前 fixture 的定义/有效授权 | 当前 fixture 的菜单 |
| --- | --- | --- | --- |
| `/login` | 登录入口 | 不适用 | 不适用 |
| `/admin` | `aij.bootstrap.admin` | 已有 | 无 |
| `/auth/admin-users` | `admin.user.manage` | 已有 | 无 |
| `/auth/roles` | `admin.role.manage` | 已有 | 无 |
| `/auth/audit-logs` | `admin.log.read` | 已有 | 无 |

基础管理员宿主需独立身份与数据库配置、`DATABASE_ENABLED=true`、`AUTH_ENABLED=true`，经保护的匹配迁移/初始化、有效管理员及角色权限定义、对应后端菜单记录，以及 Web/API 的 URL、issuer、Cookie 与存储隔离。Auth/Admin/RBAC/Menus/Audit 模块必须实际装配；浏览器登录还依赖正确的同源/允许来源配置。单独基础场景应明确插件为空，不能借启用 AI 的合成 fixture 证明这一点。当前安全 `.env.example` 默认关闭 auth/database；Seed 的管理能力开关不能替代基础菜单初始化。

**路由已存在，开箱初始化尚欠。没有独立完整 base 实例可交付。** 本次实际仍运行的查看地址为 `http://127.0.0.1:13655/login` 与 `http://127.0.0.1:3656/api`，仅用于当前合成 AI 场景。13655 使用已知来源测试代理；本卡未启动新进程，也不把旧 3655 当作 base 地址。凭据仅在既有忽略目录中由采集器读取，不复制、不输出。

## 证据、验证与影响

新增两个脚本：`scripts/verification/product-readiness/menu-origin.mjs` 和 `menu-origin.test.mjs`；另新增本文。本地证据位于 `.artifacts/orca-b02/AF-129/`，`latest.json` 指向有时间戳且带 SHA256 的实际证据；`checks.json` 保存最终命令、起止时间、退出码及输出。五类证据为运行归属、受保护 DB 前后快照、16 个实际 HTTP 结果、源码定位、base 路由与结论边界。

采集器只使用已有 `acceptanceRecord('test', id)`、`readDatabaseEnvironment`、`withDatabase` 目标保护。实际连接 `127.0.0.1:55433` 的 `aij_foundation_af124_test_201f2a5b8ef65148`，登录用户为 `aij_foundation_test`；核对数据库、current/session user、容器内端口 5432。业务 SELECT 位于 `REPEATABLE READ READ ONLY` 事务且最终 ROLLBACK；不创建/迁移/Seed 新库，不绕过目标保护。

前后比对九组字段：账号授权字段、角色、用户角色关联、角色权限关联、角色菜单关联、权限定义、菜单、插件安装与项目状态。均同时比较去敏行和 SHA256 指纹；账号不读取密码哈希，不将正常登录时间变化混作授权变化。HTTP 仅保存显式白名单字段，不保存头部、原始 body、Bearer、Cookie、密码或秘密值。测试检查实际证据哈希、源码行、状态码/路径/时间、目标边界、结论和脱敏 canary，并以变造证据验证拒绝路径。

正常登录/退出有预期写入：每次成功采集增加一条 bearer 会话并在 finally 退出撤销，`auth.login` / `auth.logout` 各增加一条审计记录，账号最后登录时间更新。采集器核对这些增量且拒绝其他审计/会话变化；不冒称零写入。除此之外无生产代码、数据库结构、API/页面行为、授权、菜单或插件行为变化；原轻企仓库未写入。

最终常规命令及结果（完整输出与实际退出码见 `checks.json`）：

```sh
node scripts/verification/product-readiness/menu-origin.mjs
node --test scripts/verification/product-readiness/menu-origin.test.mjs
pnpm exec eslint scripts/verification/product-readiness/menu-origin.mjs scripts/verification/product-readiness/menu-origin.test.mjs --max-warnings=0
git diff --check
git diff --no-index --check /dev/null scripts/verification/product-readiness/menu-origin.mjs
git diff --no-index --check /dev/null scripts/verification/product-readiness/menu-origin.test.mjs
git diff --no-index --check /dev/null docs/execution/AF-129-candidate.md
```

采集 exit 0（16 个 HTTP 结果，15 个 200、匿名身份 401）；离线测试 exit 0（7/7，无失败/跳过/todo）；定向 ESLint 与 `git diff --check` exit 0。三个未跟踪新增文件另用 `git diff --no-index --check /dev/null <file>` 检查，实际 exit 1 且 stdout/stderr 均为空；`--no-index` 的退出码 1 表示存在新增差异，此处没有空白错误报告，按该已知语义记录为检查通过，不冒报 exit 0。正式 `pnpm run verify:task -- AF-129` 尚未运行，由总控在 Worker 明确停止写入后以现有 reporter 注册并执行；Worker 没有改 registry/队列。无生产代码变更，因此未运行全量 build/typecheck、数据库迁移或 Seed；没有独立 base 启动、截图账号授权修改或负责人验收。

失败历史：最初普通采集 exit 1，诊断导入同一采集器也 exit 1，均在连接/登录前因把旧 PID 的不可解析 cwd 当作必需条件失败；诊断只输出 stack 位置，未输出原始错误或秘密值。本卡将旧现场 cwd 与构建版本保留为 unknown 后，常规采集通过；后续增强证据、审计增量与脱敏负例后再次完整通过。该问题在本卡允许脚本内解决，未通过修补运行服务或授权掩盖。

## 人工检查和交接

1. 核对 `latest.json` / `checks.json` 的 SHA、时间和退出码，打开相应 JSON 检查 HTTP、数据库前后行与指纹；不要拷贝或展示既有凭据文件。
2. 在当前 AI fixture 的 13655 登录页使用既有本地合成凭据，确认 `/admin` 和侧栏只汇总两条 AI 菜单；这一步会发生正常登录/会话/审计写入，不应修改权限或菜单。
3. 基础路由可按上述路径核对，但页面外壳/当前超级管理员访问不构成普通只读角色闭环；独立 base 无已运行地址，也没有独立 base 停止命令。本卡未停任何进程。
4. 总控独占接手后注册 AF-129，运行正式 `verify:task` 与定向门禁，精确检查并提交这三个新增文件及总控拥有的本卡正式记录/队列差异；提交标题逐字为 `核验 AI 菜单来源并给出基础版入口`，只本地、不 push。不得捎带其他卡片或继承规划差异。

AF-130 仅在 AF-129 正式本地集成节点完成后接续，并自行逐项核对所需前置接收；本卡不授权启动下一卡、不代替 ORCA-B01 接收。独立 base 初始化、普通账号读写隔离和审计闭环均未在本卡实施。Worker 用时约 35 分钟（2026-11-04 11:50 CST 起至本次停写交接，含源码审计、失败诊断、实现与候选校验；不含后续总控正式验证/提交），未达到 2 小时卡预算。

Writer 交接：候选文件与证据完成后，通过本 Task 的 `worker_done` 明确停止写入；以该回执为实际停写时点。在总控重新派工前不再改写文件，不暂存、提交、切分支或 push。
