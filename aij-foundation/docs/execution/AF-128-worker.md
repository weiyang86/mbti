# AF-128 Worker 候选交接

2026-11-04，ORCA-B01 / ORCH-CI-01，任务标题「建立不依赖历史报告的产品验证入口」。这是 Worker 候选执行记录，正式 verify:task、队列更新、dev 集成推送和负责人接收由总控完成；不标为 DEV_INTEGRATED 或 OWNER_ACCEPTED。

## 基线与唯一 Writer

- 工作区：`/Users/lei/orca/workspaces/aij-foundation/orca-b01-ci`。
- Orca Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/orca-b01-ci`；实例 `10ff4a5f-e54f-431e-bcf6-2004cbe9f44f`。
- Run：`run_ffaba3dac618`；Task：`task_7d01d561524b`；Dispatch：`ctx_34932ddcfea9`；终端：`term_5f62828a-fac2-4d23-b076-898583a1b32b`。
- 分支：`weiyang86/orca-b01-ci`；origin fetch/push：`git@github.com:weiyang86/aij-foundation.git`。
- 开始时无修改，实际 HEAD / origin/dev / 远端 `refs/heads/dev` 都为 `5430947b583e07d419f17c098a68f842f47ead40`。总控消息 `msg_4e94aa293047` 确认它是已验证的 GOV 正式集成 SHA，前置 I-GOV 已完成。
- Node `v24.21.0` / pnpm `10.0.0`；本工作区 `pnpm install --frozen-lockfile` exit 0（6.2s），独立 node_modules，无链接其他工作区，无锁文件变化。pnpm 提示已有依赖 build scripts 默认忽略；未自行放开依赖策略、未复制 .env/凭据。
- 沿用默认模型，仅本 Writer；没有子 Worker、没有访问或修改原轻企仓库。

## 实际差异

新增 `scripts/verification/product/{catalog,runner,database-preflight,runner.test,af128-registration}.mjs`、`docs/development/PRODUCT_VERIFICATION.md` 及本独立记录。

产品入口将检查分成 `checks` 和 `database`，支持 `all` 串行组合；直接执行当前源码与登记测试，不用旧 AF 任务的冻结 SHA、队列状态或历史报告作为前置。结构化计数拒绝零用例、空/打印 PASS 文件、skip/todo/cancelled；传播非零退出，缺前置立即停止。报告记录被测 HEAD、工作树 digest、始末一致性、计划/已运行/未运行和明确的 CI-02 未覆盖矩阵。

DB 组限制原 Git 主工作区的 dev 分支、总控串行选择与排他锁；真实实例身份/本地非空 Schema 与迁移链先行，然后 generate/编译，再复用 readiness 和 Workspace 隔离测试。它们按原有 AF-011/056 fixture owner 新建合成测试库，不要求存在旧证据；没有增开 DB task allowlist、没有修改目标保护。

## 实际命令与证据

| 命令 | 结果 |
| --- | --- |
| `git status --short --branch`、branch/HEAD/origin/dev/remote 核对 | exit 0，开工 clean，基线匹配 |
| `git ls-remote --heads origin dev` | exit 0，远端 SHA 同 GOV |
| `pnpm install --frozen-lockfile` | exit 0，8 个工作区、726 包，本地安装 |
| `node --test scripts/verification/product/runner.test.mjs` | 最终 exit 0，34/34，0 fail/cancelled/skip/todo，约 6.26s；均为离线 fixture |
| `node scripts/verification/product/runner.mjs --group checks --sha 5430947b583e07d419f17c098a68f842f47ead40` | exit 0，runtime/project/database-target 82/82、package ownership 3/3；共 85 项，0失败/跳过/todo；候选工作树 dirty/digest 如实记录 |
| `pnpm exec eslint scripts/verification/product --max-warnings=0` | exit 0 |
| `git diff --check` | exit 0 |

候选前纯检查报告：`.artifacts/product-verification/run-Ei2yUi/report.json` 和 `run-qBr0so/report.json`，均绑定 GOV HEAD 及当时工作树摘要；最终候选提交的实际 SHA 和提交后报告另由 worker_done 回执提供，避免记录自引用 SHA。所有报告/合成 Git 仓库留在本工作区忽略目录，不传递为源库成果或必需输入。

保留失败：新增取消用例的第一次模拟使用未完成 Promise，进入等待；核对 PID/PPID/PGID 和 CWD 后仅停止本卡测试组 95540 与合成目录子组 96279，该次 exit 143、1 cancelled，不计通过。改成显式 `AbortSignal.abort()` 后完整回归 34/34 exit 0，最终无遗留该次进程。其余回归故意触发非零/缺 DB/缺迁移等是离线拒绝断言，不是产品 DB 功能通过证据。

未运行：正式 `pnpm run verify:task -- AF-128`（注册表受保护，仅总控集成）；真实 DB/HTTP、Prisma generate、API build、Next 重型构建、全仓 typecheck、浏览器、收费 Provider、部署/发布。它们没有被假报通过。没有启动访问地址，无可用人工页面账号。

## 影响与精确共享文件请求

没有 Schema/migration/业务 API/页面/权限规则/审计 owner 改动，没有 DB/凭据/客户数据操作，没有停止其他项目进程。新增运行日志和报告只落本工作区 `.artifacts`；未来 DB 组的 effects 和本机前置见产品验证文档。

总控只需在受保护文件应用：

1. `package.json` scripts 新增 `"verify:product": "node scripts/verification/product/runner.mjs"`。
2. `scripts/verification/registry.mjs` import `af128Registration` from `./product/af128-registration.mjs`，登记 `"AF-128": af128Registration`。注册对象已给出精确 files/testFiles/命令与 effects，默认只跑本卡离线回归、产品纯检查、eslint、diff-check。

总控先精确集成并运行正式 AF-128 门禁；真实 DB 组只在原 dev 持串行租约后运行并保留成功/拒绝证据。Worker 没有修改 package.json、registry、队列、全局依赖、dev 或其他任务文件，也不会 push。

## 人工核验与交接

人工可先运行 `--list`，检查分类/未覆盖项，再运行 `--group checks` 并查看报告中 85 个用例、真实 HEAD、dirty/digest 和 notRun。缺/错 SHA 必须非零；原 dev 之外请求 `database --serial-db` 必须在连接前拒绝。DB 功能与页面人工验收须由总控在真实受保护环境补充，Worker 不将离线 fixture 当作独立复核。

下一依赖：GEN-03 后由 CI-02 完成干净 clone 的 ai-standard 生成/安装/端到端矩阵，本卡不关闭 OPT-006，不宣称该端到端完成。Worker 工作约 0.25 有效工程小时，余下正式集成预算留给总控；本候选提交之后停止写入，等 worker_done 确认即结束本派工，任何修复交回原 Writer。

## 原 Writer 修复派工（2026-11-04）

总控正式集成验证失败后交回同一 Writer：Task `task_621d04b1f953`、Dispatch `ctx_d09a21d4f0bc`，仍为原工作区/分支/remote。本次开始 clean HEAD `484e1f47c17a94a4ebcf23f3a4c9ebc4251084cb`，origin/dev 已前进至 `70a0f8254a93ab2ef1451e03bdfa2bb8c11b2c2a`；这是在原候选上定向修复，不重设基线或混入其他卡。自有依赖沿用本工作区前次成功 frozen install，总控已明确冻结原 dev 的旧候选实现，未与本 Writer 并发修改。

保留两次正式失败，未覆盖或删除任何证据：

- 原 dev `.artifacts/verification/AF-128/run-1vuH4c/report.json`：exit 1，34 项 33 通过/1 失败；fresh checkout 的 `baseline.dirty` 为 true。Writer 只读核对原现场合成仓库，Git status 确实出现 `?? ._.artifacts`，来自外置卷 AppleDouble 元数据。
- 原 dev `.artifacts/product-verification/run-0KVaqe/report.json`：exit 1，DB 目标、generate、三包 build、API compile 通过；readiness 前七子项通过，最后旧“所有产品表 count=0”断言被 `withDatabase` 包成 `UNAVAILABLE`，Workspace 项未运行。源码证据表明当前 `20261102000000_ai_knowledge_document` / `20261104020000_general_ai_runs` 迁移含权限参考行 INSERT；DMMF 所有模型均已映射，不能将此误判成连接故障或 dbName null。

实际修复：仅合成 Git fixture 的 `.gitignore` 增加 `._*`，fresh checkout 用例主动创建并保留合成 AppleDouble 文件；真实源码 dirty/变更拒绝仍由原回归覆盖，产品 runner 一字未改。DB 组改登记产品专用 readiness 测试，定向保留旧测试八个 DB/HTTP 场景；新增 `row-snapshot.mjs` 对所有 public 表（每个当前模型加迁移账本）的行数及完整行内容指纹做迁移后/探针后的严格相等检查，不任意豁免参考表、不删除行、不跳过失败。新增 5 项离线指纹回归；旧 `scripts/verification/readiness.test.mjs`、Schema、迁移和产品实现均未改。

本次 `node --test scripts/verification/product/runner.test.mjs scripts/verification/product/row-snapshot.test.mjs` exit 0，原 34/34 加指纹 5/5，共 39/39，0 fail/cancelled/skip/todo，日志 `.artifacts/af-128-worker-fix-regression.log`；`pnpm exec eslint scripts/verification/product --max-warnings=0`、`git diff --check` 均 exit 0。产品专用 DB 测试只做 `node --check` 语法检查，不在 Worker 连接 DB、启动 HTTP、generate 或构建；真实 DB/HTTP 能否通过仍待总控串行复验，未报成功。

共享注册请求已精确更新 `product/af128-registration.mjs`：原回归步骤的 command/testFiles 加入 `row-snapshot.test.mjs`，files 加入 helper 与新 readiness；product catalog 的 `database-readiness` 指向新测试。若总控 registry 当前引用导出对象，无须额外保护文件改动；若已内联对象，请按该模块精确同步，不省略新回归。修复仅在本卡目录、产品验证文档及本记录，没有 Schema/API/页面/权限/日志 owner 影响，没有运行访问地址或真实 DB 操作。

本次追加约 0.15 有效工程小时，连同初次 Worker 工作约 0.40h；预算余量由总控调度。修复候选 SHA 以 worker_done 回执为准，总控应只应用相对 `484e1f4` 的修复差异，然后重跑正式 AF-128 及原 dev 串行 DB 组，保留本节两次失败；CI-02 完整产品矩阵仍未完成，本修复不改变覆盖边界。候选提交后再次明确停止写入，等待总控验收或交回修正。

## 共享 fixture 补登记与总控真实复验（2026-11-04）

本次 Task `task_ac4dd422e81e` / Dispatch `ctx_a433b4723fb4`，原 Writer 仅补证据和精确共享请求；开始为 clean `weiyang86/orca-b01-ci@4fcf022078f5dda2a3723c6a0194c13bea35ff66`，origin/dev 仍为 `70a0f8254a93ab2ef1451e03bdfa2bb8c11b2c2a`，remote 不变，沿用独立依赖。没有修改共享实现、产品 runner、测试或注册对象。

新增保留失败：原 dev `.artifacts/product-verification/run-JdMH6K/report.json` 的 status=FAIL、exit 1；全部前置通过，产品 readiness 9/9 通过，Workspace 主用例 1/1 失败在 `prepareClientFixture` 第 44 行 `assert.ok(clientFixtureTasks.includes(task))`，尚未进入任何 Workspace 业务 HTTP 子断言。报告 notRun 为空只表示两个分组步骤都已尝试，不能据此声称业务断言执行或通过。

源码核对：Workspace fixture 明确使用 AF-056；该编号已经在 runtime acceptance、migration createAcceptance、Seed 的显式登记及正式 taskRegistry 的 Workspace 测试中存在，仅共享 clientFixtureTasks 漏登。精确请求为总控在 `scripts/verification/client-auth-fixture.mjs` 的该数组把 `"AF-055", "AF-089"` 改为 `"AF-055", "AF-056", "AF-089"`；其余内容字节不变，不增加任意/新 DB 任务、不调整 owner 或目标保护。总控已依 `msg_baaec197b703` 应用此修改；Worker 只读比较原 dev 该文件与本工作区旧文件的精确替换结果相等，并核对三层白名单和正式 registry 均已登记，离线检查 exit 0，无数据库连接。现有 `includes(task)` 严格断言继续承担拒绝漏登任务的检查，本次不复制新的解析/白名单实现。

总控成功复验：只读核对原 dev `.artifacts/product-verification/run-oXXK90/report.json`，status=PASS、exit 0，target/generate/三包构建/API compile 全通过；readiness 9/9、Workspace 隔离 5/5，共 14/14，failed/cancelled/skipped/todo 全为 0。baseline/endBaseline 都是 HEAD `70a0f8254a93ab2ef1451e03bdfa2bb8c11b2c2a`、dirty=true、sourceDigest `5bfbf054e77bc1c8a0132dd13672025f31980803910625c0f1c4e3665c80a119`，始末一致；不把该结果写成干净 SHA 已验证。旧 `run-1vuH4c`、`run-0KVaqe`、`run-JdMH6K` 的失败状态和内容全部保留。

本次仅更新产品验证文档和本记录，`git diff --check` exit 0；没有新增可执行代码，未重复运行未变的 39 项回归、构建或 lint，没有 Worker DB/HTTP 操作，无 Schema/API/权限/页面/日志 owner 影响，无运行访问地址。总控仍须完成最终正式 `verify:task -- AF-128`、全仓 lint、精确集成提交推送及远端回读；若需再次执行产品组，继续使用原 dev 串行租约和实际 SHA。此有限 DB/HTTP 组的 14 项通过不覆盖 DELTA 的 `admin/runtime/readiness` 未解决差量，也不完成 CI-02 完整产品矩阵或负责人接收。

本轮约 0.05 有效工程小时，累计 Worker 约 0.45h；候选 SHA 以本 Task 的 worker_done 回执为准。此文档候选提交后停止写入，总控只需应用相对 `4fcf022` 的文档差异；共享 fixture 补登记已由总控完成，禁止将本工作区仍未补登记的共享旧文件覆盖回原 dev。
