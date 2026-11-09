# AF-133 候选交付：修复管理员宿主对客户认证的隐式依赖

2026-11-04；候选实现与纯代码检查完成，尚未执行正式注册验证、API build 或真实数据库/HTTP 回归。此记录不代表 CODE_VERIFIED、UI-1/ORCA-B01 接收或负责人验收。

## 派工、基线与边界

- Run：`run_d4eae5ba3a3b`；Task：`task_edce47e6dbb2`；Dispatch：`ctx_974fafaadb4f`。
- Writer：`term_69ed95e3-4779-4b58-862a-c4770974ffa0`；总控：`term_bc55f07a-bdd7-4207-8cce-91eb1f03863d`。
- Orca Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`（原主工作区，当前派工明确授权的三个路径范围）。
- 分支 `dev`，起始及交接前 HEAD 均为 `b13a3468c08c2021fed06e9aa289192dd68ca829`；remote 为 `git@github.com:weiyang86/aij-foundation.git`。候选有效工程耗时约 0.3h，未包含总控后续验证，卡片上限 2h。
- 仅改 `apps/api/src/app.module.ts`、`scripts/verification/client-auth-http.test.mjs`，新增本记录。没有暂存、提交或 push，正式卡提交交总控在全部门禁通过后完成。
- 开工时已有 AF-132 范围：`docs/planning/CODING_QUEUE.json`、`scripts/verification/{admin-users,auth-http,rbac-http}.test.mjs`、`scripts/verification/registry.mjs` 的修改，以及未跟踪的 `docs/execution/AF-132-candidate.md`、`docs/execution/AF-132.md`、`docs/planning/orca-product-goal-20261104/AF-{132,133}.md`、`scripts/verification/client-workspace-permission-baseline.mjs`、`scripts/verification/ui1-renew.mjs`、`scripts/verification/ui1-renew.test.mjs`。全部保留，未写入这些路径或纳入本卡暂存。

## 根因与实际 diff

派工证据为 AF-132 完整 AF-029 复验 `run-ZzV97a`：auth-http 13 项、rbac-http 15 项通过，client-auth-http 在已通过 13 个子测试后于关闭客户认证阶段启动失败，报 `CLIENT_JWT_SECRET is required`。这是总控报告的历史结果，本候选没有再次运行该复验。

源码确认 `AppModule.forRoot` 原来在 `capabilities.auth` 开启时无条件装配 `AdminClientDirectoryModule`，后者 imports `ClientAuthModule`，引入客户 JWT 与 Service provider。配置 owner 允许 `auth=true/clientAuth=false` 且三个客户密钥缺失/空；宿主组合因此违反既有开关契约。

1. `apps/api/src/app.module.ts`：从管理员基础模块数组移出 `AdminClientDirectoryModule`，单独按 `runtime.capabilities.auth && runtime.capabilities.clientAuth` 装配。管理员基础数组仍由原 auth 条件控制，其余客户端、存储、异步与插件组合条件原样保留。未改模块 owner、ClientAuthService、Guard 或运行时配置验证。
2. `scripts/verification/client-auth-http.test.mjs`：保留原 client-only 请求为独立子测试，新增 admin-only 子测试。两轮均显式 `AUTH_ENABLED=true`、`CLIENT_AUTH_ENABLED=false`；分别删除三个客户密钥和将三个密钥全部设为空字符串，包含此前遗漏的 `CLIENT_AUTH_TOKEN_SECRET`。
3. 新子测试在启动前调用既有 `readApplicationEnvironment(adminOnly)`，用布尔断言确认三个有效配置值仍分别为 undefined/空字符串，防止根 `.env` 或受保护 test 配置回填密钥而误报通过；断言消息只含密钥名称，不打印值。若将来本机环境文件配置了客户密钥，缺失场景会明确拒绝该前置，而不修改环境文件或使用替代密钥。
4. 每轮均要求真实管理员登录 200、非空 accessToken、Bearer `auth/me` 200 且当前用户与登录投影一致；客户 login/me 404；持有效管理员 Token 访问目录列表、会话列表、同意记录及会话撤销路由均 404。还保留 health 200，增加 ready 200 和关闭后该验收库的应用连接为零断言。管理员密码和新 Token 加入既有敏感值响应检查集合，证据文件只记录状态码/布尔结果。
5. 原 enabled、namespace、DTO/Origin、凭据与 Cookie/JWT 拒绝、身份与会话重验、审计、事务回滚、限流、停机恢复、缺迁移和零池断言保留。子测试数由 15 增至 16；没有跳过、删除或降低原验证路径。

产品侧改变只影响关闭客户认证时的宿主模块装配与管理员客户目录路由可用性；双认证开启时仍装配原目录。没有数据库/Schema/迁移/Seed、页面、权限定义/Guard 或日志 owner 改动，也没有收费 AI、支付、生产、部署或发布操作。后续测试会使用既有合成管理员登录并产生原 owner 管理的会话/审计记录，本候选未实际写入数据库。

## 已运行的纯检查

- `pnpm exec eslint apps/api/src/app.module.ts scripts/verification/client-auth-http.test.mjs --max-warnings=0`：最终 exit 0，无输出。
- `node --check scripts/verification/client-auth-http.test.mjs`：exit 0。
- 一次 `node --input-type=module` 纯文本自查：用 `git show HEAD:scripts/verification/client-auth-http.test.mjs` 与当前源文对照，除新增运行时读取 import 外，原 client-only 阶段前部与最后缺迁移阶段以后逐字相同，原 client-only 请求逐字保留，原 disabled 的客户 login/me 404 与 health 200 请求仍存在；14 个周边子测试保持，当前共 16 个子测试，exit 0。
- 一次仅读取键存在状态的环境前置检查：根 `.env` 不存在，当前受保护 test 配置文件不含上述三个客户密钥；没有打印凭据或密钥值，没有建立数据库连接。这只说明当前缺失场景不会从这两个文件回填客户密钥，不是宿主启动证据。
- `git diff --check`：exit 0。本记录另以 `git diff --no-index --check /dev/null docs/execution/AF-133-candidate.md` 检查新增文档空白；新增差异退出码为 1，无空白错误输出。

候选未运行 `verify:task`、API build、测试文件中的真实 HTTP/数据库操作、迁移或 Seed；未启动/停止服务、占用固定端口、创建数据库或改变受保护环境。本次没有真实运行 URL、服务 PID、新凭据位置或浏览器验收结果可交付。上述纯检查不能推出新宿主已成功启动，也不能替代开启功能时独立密钥的严格校验。

## 总控接手与人工验收

候选范围内无实现阻塞或共享文件修改请求，Writer **明确停止写入并交接这三个路径**，等待总控正式验证；若真实验证失败，由总控退回原 Writer 在本卡范围修复。总控按以下顺序接手：

1. 在原 `dev` 串行注册 AF-133，先核对受保护 test 数据库目标归属及资源租约，再运行 `pnpm run verify:task -- AF-133`。门禁需包括当前 API build、真实 `client-auth-http.test.mjs`、定向 lint/diff 和数据库预检；不使用旧 dist 或历史通过报告替代本次验证。保留 `run-ZzV97a` 历史失败。
2. 人工检查真实输出：三个客户密钥全部缺失/全部为空两种 admin-only 宿主均实际启动；管理员 login/me 成功；客户 login/me 及持有效管理员 Token 的目录四类路由均 404，ready/health 200，关闭后零应用连接。检查原 client-only、enabled、namespace、拒绝、审计、事务及缺迁移阶段继续通过，开启客户能力时仍严格要求三个独立密钥。候选没有通过添加虚假密钥、降低 Guard 或改变错误状态码绕过问题。
3. 按基线精确分离 AF-133 的 registry/队列更新与三个候选文件，保留 AF-132 继承差异；适用门禁全部通过后更新正式执行记录/队列，以原标题 `修复管理员宿主对客户认证的隐式依赖` 作一次精确本地提交，不 push。不能安全拆分时保留成果并报告阻塞，禁止宽泛暂存。
4. 提交后才完成实际 AF-133 集成 Task，记录其真实 ID 供下游引用；AF-132 等该集成完成后重跑完整 AF-029、prepare-manual、浏览器路径和自身正式提交。AF-130 是否可叠加待验 UI-1 仍等待负责人明确，AF-131 不启动，修复批次最多三卡。任何 CODE_VERIFIED 均不代表负责人接收，出口仍由总控按批记录为 OWNER_CHECK_PENDING。
