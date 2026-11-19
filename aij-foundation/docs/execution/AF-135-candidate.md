# AF-135 — 字典只读授权与服务端写入拒绝（候选交接）

日期：2026-11-04。状态：`CANDIDATE_READY_FOR_COORDINATOR_VERIFICATION`，不是 CODE_VERIFIED 或负责人接收。

## 派工与基线

- Run：`run_d4eae5ba3a3b`；Worker Task：`task_42e072720d90`；Dispatch：`ctx_a03f2913bfd4`；Writer terminal：`term_c63da606-51e3-4e0d-b051-723fa4e58ddf`。
- 工作区：`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`，`dev`，开始及交接 HEAD 均为 `e5447680360c1bb569a411fe0c1dee3dbf31a250`，origin 为 `git@github.com:weiyang86/aij-foundation.git`。未切分支、暂存、提交或推送。
- 真实前置：AF-134 集成 `task_860aa66579d5` 已完成。AF-135 最多 4 有效工程小时，本次没有触发拆卡条件；未将壁钟时间冒充有效工程小时。
- 继承修改：`docs/planning/CODING_QUEUE.json`；继承未跟踪文件：`docs/planning/AIJ-Base-1.0-Orca-Execution-Playbook.md`、`docs/planning/orca-product-goal-20261104/AF-135.md`。均未写入；registry、正式队列及正式执行记录由总控独占。

## 实际差异与影响

1. `apps/api/src/dictionaries/dictionaries.controller.ts`：分类 GET 和条目 GET 各在 handler 声明 `admin.dict.read`；分类 POST/PATCH/DELETE、条目 POST/PATCH/DELETE 继续声明 `admin.dict.manage`。分类 Controller 去除统一 manage 类声明，条目写 Controller 保留 manage 类声明。没有改通用 decorator、Guard 或全局 AND/default-deny。
2. `scripts/dictionary-policy.cjs`、`.d.cts`：唯一字典 policy 增加 `dictionaryEffectivePermissions`。只有有效 manage 且 read 定义有效时才推导 read；read 不推导 manage，也没有其他能力的通配 manage→read。函数不更改输入授权数组。
3. `apps/api/src/rbac/permissions.service.ts`：在现有 DB 事务和用户/角色/定义状态筛选后，保留原始 `permissions`，另外生成 `effectivePermissions`。API 授权、`/admin/permissions/my` 与菜单复用这一 owner 的结果；super 仍必须有有效定义。没有客户端自报权限、额外授权表或权限缓存。
4. `apps/api/src/menus/menus.service.ts`：既有菜单过滤使用相同的有效权限集合；菜单状态、可见性、页面可用性、插件启用与项目安装状态条件保持。未改菜单 seed 或已有菜单。
5. `scripts/database/seed.mjs`：原 host 默认不开字典的语义保持；显式 `--dictionaries` 时也经既有 `registerDefinition` 增加 read 定义。仍使用 INSERT / ON CONFLICT DO NOTHING 和 namespace 校验，不重写已有定义状态、角色授权、密码或菜单。持久 Base 已在 AF-134 登记 read，本卡不运行 seed。
6. Web `app/auth/dictionaries/page.tsx` 的 AdminShell 入口要求 read；`admin-dictionaries.tsx` 对只读身份显示“查看条目”和只读说明，既有写按钮仍要求 manage，plugin owner 条件保持；`admin-audit-logs.tsx` 安全 permission 白名单增加 read。没有新增前端推导权限规则，也没有修改后台审计 owner/脱敏逻辑。
7. 新增 `scripts/verification/dictionary-read.test.mjs` 和 `dictionary-read.integration.test.mjs`；无 Schema、migration、数据库连接配置、依赖或锁文件变化。写入审计仍由既有 dictionary / RBAC owner 负责，真实拒绝审计由待跑 HTTP 测试验证。

## Worker 已执行的验证

以下均 exit 0；没有运行数据库、Docker、服务启停、构建、完整 typecheck 或正式 verify。

```sh
node --test scripts/verification/dictionary-read.test.mjs scripts/verification/base-development.test.mjs scripts/verification/seed-cli.test.mjs scripts/test/runtime-environment.test.mjs scripts/test/database-target.test.mjs scripts/test/project-configuration.test.mjs
```

126/126 通过，fail/cancel/skip/todo 均 0。其中 AF-134 相关纯回归 118 项、新增权限边界纯测试 8 项。新增测试经 ts-node 只转译加载当前源码，不依赖旧 dist，不创建应用或 Prisma 实例；以内存 transaction client 执行真实 PermissionsService、PermissionsGuard、MenusService、ManagementAccessService 和 DictionariesService，覆盖：

- 单向字典兼容、有效定义、原始/有效授权分离，以及其他 manage 权限不推导 read。
- 两个 GET 与六个写 handler 的真实 metadata；类+handler AND 与未声明拒绝。
- read-only / manage-only / 空权限在 API、菜单、权限快照中的一致性。
- 原身份授权移除、角色解绑/停用/软删除、定义失效下一调用拒绝；用户停用/软删除 401、授权不可用 503、super 不能复活失效定义。
- read-only 经真实 Guard 六项写拒绝并记录 manage requirement，直接调用六项 Service 写也在既有事务权限检查时拒绝。
- manage 仍不能修改 plugin owner 字典/条目；实际 DTO 拒绝 core/plugin 编码与客户端设置 pluginCode。

```sh
pnpm exec eslint apps/api/src/dictionaries/dictionaries.controller.ts apps/api/src/rbac/permissions.service.ts apps/api/src/menus/menus.service.ts apps/web/app/auth/dictionaries/page.tsx apps/web/app/components/admin-dictionaries.tsx apps/web/app/components/admin-audit-logs.tsx scripts/dictionary-policy.cjs scripts/dictionary-policy.d.cts scripts/database/seed.mjs scripts/verification/dictionary-read.test.mjs scripts/verification/dictionary-read.integration.test.mjs --max-warnings=0
node --check scripts/verification/dictionary-read.integration.test.mjs
node --check scripts/database/seed.mjs
node --check scripts/dictionary-policy.cjs
git diff --check
```

历史 fixture 未改，也没有删除断言。检查发现 AF-016 `rbac-management.test.mjs:46/99` 的 1/4/core=4 数量断言对应未启用 dictionaries，未受本卡影响；AF-021 `dictionaries.test.mjs:50` 仍有 migrations ledger 长度必须为 2 的历史假设，这是既有全迁移历史与旧 fixture 的问题，不是本卡新增迁移。AF-035 的 `ui2-reader` 只有 bootstrap，不是本卡字典 read 角色，其 403 断言仍有意义并保留。没有证据要求为本卡调整这些 fixture。

## 总控待执行的真实验证

Worker 没有探活、重建或停止当前服务。派工记录的持久 Base 是 `http://127.0.0.1:3855/login` / `http://127.0.0.1:3856/api`，独立 PostgreSQL `55434`；此处不是“新代码已运行”的声明。AF-029 原服务、原 dev/test 与轻企来源均未访问或写入。

总控接收本候选后串行执行派工规定的 `pnpm base:dev stop` → `pnpm base:dev start --build`，只重建持久 Base。注册 AF-135 正式门禁并运行：

```sh
node --test scripts/verification/dictionary-read.integration.test.mjs
pnpm run verify:task -- AF-135
```

集成脚本复用 `base-development-support.mjs` 严格 Base preflight、正式 browser-login、Cookie 和 Origin/CSRF；只经 API 创建并操作本卡随机合成角色、非超级管理员和字典，凭据和会话只在内存中。不会改已有账号授权或密码，不执行手工 SQL，也不保存密码、Cookie、CSRF 或哈希。运行成功应得到 1 个父测试及 6 个子测试，证据写入忽略目录 `.artifacts/orca-b02/AF-135/dictionary-read-live-integration-r*.json`，仅含身份 ID、请求路径/方法/状态与检查结果。

真实场景包括 manage-only 的完整分类/条目 CRUD 与只读菜单兼容；read-only 权限快照、菜单、分类与条目分页读取；同一有效 Cookie 与核对过的 CSRF 下六种写入均 403，每次后逐字段比较全部本卡可见分类和条目；空权限/匿名分别拒绝且数据不变；其他管理能力不扩权；core/plugin namespace 与 owner 输入拒绝；角色停用、解绑、read/manage 撤权下一请求生效且原会话仍有效；既有 permission_denied 审计含六次 manage requirement。子测试失败时不会把证据标为 completed，不自动清库或删除合成数据。

HTTP 页面状态 200 只证明路由可用，浏览器已渲染的只读行为仍待总控观察。人工步骤：

1. 总控经正式 API 新建另一个随机非超级管理员，角色仅授 `admin.dict.read`，凭据仅在本地临时使用。集成测试结束会撤掉自己创建的 read/manage 授权，且不会持久保存账号凭据，不能把其遗留身份当成仍有权的人工账号。
2. 在 Base 登录该只读账号，确认后台菜单只出现获授权的字典入口，进入分类，点“查看条目”，确认列表实际读取且写按钮不可用。
3. 以同一 Cookie/正确 Origin/CSRF 执行六种写入拒绝并检查数据（由集成脚本提供真实 HTTP 证据）；另以 manage-only 合成账号确认读写和菜单兼容。
4. 撤销只读授权后下一 API 请求 403、菜单和有效权限为空；页面经既有刷新机制更新。完成 lint、typecheck、Git 范围检查和正式记录。

## 边界、依赖与 Writer 交接

实质候选实现与纯测试已完成；真实 HTTP、构建、浏览器、完整质量门禁和负责人验收全部待总控执行，因此不宣称本卡已验证。API 读取在未登记 read 定义的旧环境中会 fail closed；此类环境需由既有正式初始化流程显式启用 dictionaries 增加定义，不能靠补写已有角色或放松 Guard 兜底。

本 Worker 在此候选交付后**明确停止全部写入**，交回总控串行集成；总控可接续本卡验证与修复调度。总控完成 verify、记录/队列、按原标题的本地提交与 SHA 回读并完成真实集成 Task 后，才可将该集成 Task ID 作为 AF-130 最终建号/授权/审计卡的下游依赖。候选 Task 自身完成不替代集成完成；不 push，不启动 AF-131，不扩展批次，不更改 UI-1/AF-029 既有验收状态。
