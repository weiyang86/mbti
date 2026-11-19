# 产品验证入口

ORCA-B01 / AF-128 / ORCH-CI-01 提供按当前产品能力运行的入口。它直接运行登记源码、构建命令与测试，不读取历史执行报告、冻结 AF baseline、队列状态或已存在的 `.artifacts` 作为通过条件。复用测试文件中的 AF 名称保留来源和隔离验收库 owner，不意味着复用当时的验证结果。

## 使用

在本仓库独立安装依赖后运行（Node 24 / pnpm 10）：

```sh
pnpm install --frozen-lockfile
node scripts/verification/product/runner.mjs --list
node scripts/verification/product/runner.mjs --group checks
node scripts/verification/product/runner.mjs --group checks --sha <40位被测HEAD>
```

总控集成 `package.json` 的精确请求后，也可用 `pnpm run verify:product -- --group checks`。`--list` 仅列出分类和命令，不执行验证、不产生 PASS。未知参数、组名、重复参数、缩写 SHA 或任意命令参数都拒绝。

## 当前分类与覆盖

可信登记源为 `scripts/verification/product/catalog.mjs`；CLI 不接受外部 registry、命令、可选/跳过步骤。

| 组 | 当前检查 | 副作用及前置 | PASS 的含义 |
| --- | --- | --- | --- |
| `checks` | runtime environment、project configuration、database target 的纯函数及拒绝路径；package ownership/boundaries | 只写忽略的 `.artifacts` 合成文件，不连接 DB、不启动 API | 本组当前源码断言通过；不证明 DB 或页面可用 |
| `database` | 当前全量迁移后的 Prisma/HTTP readiness、未迁移拒绝、数据库身份/断连/恢复/关池；Workspace 归属、跨租户与管理员/客户身份混淆拒绝 | 原 `dev` 工作区、总控串行资源租约、已受保护的 test PostgreSQL 55433 及本机 owner/凭据；新建合成验收库、迁移/Seed、临时 loopback API、本地编译 | 本组登记场景当前运行通过；不代表全部产品矩阵或负责人接收 |
| `all` | 按登记顺序先 `checks` 再 `database` | 同 `database`，组、前置、测试文件均串行 | 仅以上两组通过，仍不是完整产品认证 |

`checks` 直接运行 `scripts/test/{runtime-environment,project-configuration,database-target}.test.mjs` 和 `scripts/verification/package-boundary.test.mjs`。`database` 先核对当前 Schema/非空迁移链（记录各 SQL SHA-256）、真实 test 实例与连接身份，再 generate、编译 core/contracts/runtime-contracts 与 API，最后串行运行 `scripts/verification/product/readiness.test.mjs` 和 `scripts/verification/workspace-isolation.test.mjs`；不调用历史 `.preflight.mjs`、`verify:task` 或 Next 构建。测试自己为新建验收库执行当前迁移链；缺迁移、迁移失败和缺 DB 都失败，不把跳过解释成通过。

产品 readiness 从原 `scripts/verification/readiness.test.mjs` 定向适配，来源提交及调整原因保存在新测试头部；保留原八个真实 DB/HTTP 场景，旧测试原样保留。当前迁移会注册权限参考数据，因此在迁移完成后、后续 HTTP 探针前，捕获每张 public 表（当前所有 DMMF 模型加 `_prisma_migrations` 账本）的行数及完整行内容 SHA-256，结束时逐表严格比较；不再要求迁移后的参考表也必须空表，不豁免任何表。插入、删除、同数量更新、账本变更及缺表/多表都拒绝；原有源码/凭据保留与零 API 池断言仍在。新证据写入 `.artifacts/product-verification/readiness/run-*`，只保存指纹，不保存行内容。

这两项测试沿用 AF-011/AF-056 的合成验收 owner，Workspace 证据仍写原忽略目录；每次都会新建隔离库、重新执行断言，不需要目录中有旧报告。readiness 测试还需要现有本机 dev/test owner/secret 文件做保留校验；不能从其他工作区复制这些文件来满足前置。所有需要 DB 的组目前只允许原 dev 总控串行运行，子工作区即使有 `--serial-db` 也拒绝。

## 总控执行 DB 组

仅在原 dev 已核验的隔离环境，并持有本批数据库并发 1 租约时运行：

```sh
node scripts/verification/product/runner.mjs --group database --serial-db --sha <40位被测HEAD>
# 或在同一串行租约中执行已登记两组：
node scripts/verification/product/runner.mjs --group all --serial-db --sha <40位被测HEAD>
```

`--serial-db` 记录调用者已获得租约的明确选择，不授予数据库权限。入口还核对 Git 主工作区路径和 `dev` 分支，并通过原工作区 `.artifacts/product-verification/database.lock` 原子目录互斥；占用直接失败，不等待、不抢占、不自动删除疑似陈旧锁。它不能替代总控对其他 `verify:task` 或数据库工具的串行调度。异常中止后总控须先核实原执行器和其子进程已停止，再处理遗留锁。

前置只读取本机保护配置并核对 test 实例；不会启动服务、迁移 bootstrap 库、连接开发数据库、reset、drop 或清理。通过前置后的现有测试只对各自新建的 test 验收库写入，不停止共享 PostgreSQL，不使用真实产品数据。运行子进程剥离继承的 DB URL、JWT、Provider 凭据、`NODE_OPTIONS` 和 Node 测试上下文；测试仍使用仓库既有的受保护本地凭据读取流程。

## 报告与失败规则

每次有效运行新建 `.artifacts/product-verification/run-*/report.json` 和每步骤去敏 stdout/stderr，不要求任何旧目录或报告。报告包含：

- `scope=selected-product-groups`、选中的组、计划步骤、已执行步骤、未执行的 `notRun` 与每条命令真实退出码。
- `baseline.head`、分支、工作树是否含候选修改、`sourceDigest`，以及结束时再次采集的 `endBaseline`。摘要覆盖 Git tracked diff 和非忽略的 untracked 文件内容；HEAD 或源码在验证中变化，即使测试成功也返回 FAIL。忽略的构建产物、凭据和证据不属于源码摘要；DB 组重建登记的包/API 产物。
- 每个 Node 测试文件及全局结构化 summary：有效测试必须大于零，失败、取消、skip、todo 必须均为零。打印 PASS、空文件、空组、仅 check 无 test 的组不能通过。
- `productMatrix=DEFERRED_CI_02` 与明确未覆盖项；PASS 始终只属于选定分组。

非零子进程退出码原样传播；spawn 失败返回 127，超时返回 124，登记/参数/资源保护拒绝返回 2，断言/计数/源码稳定性失败返回 1。失败即停止，余下步骤列为未运行；没有缺 DB、缺迁移或跳过后继续 PASS 的分支。证据目录不接受符号链接，不打印本地凭据。

候选工作树可以运行，报告以 HEAD 加 `dirty/sourceDigest` 说明实际被测内容；这不能称为只验证了干净 SHA。正式集成后总控应在其实际 HEAD 上重新运行并保留报告；本地候选 PASS 不等于 DEV_INTEGRATED 或 OWNER_ACCEPTED。

## 本卡验证与后续边界

执行器回归命令：

```sh
node --test scripts/verification/product/runner.test.mjs scripts/verification/product/row-snapshot.test.mjs
pnpm exec eslint scripts/verification/product --max-warnings=0
git diff --check
```

回归中的 Git 小仓库、模拟 DB 前置失败和锁测试均位于本工作区忽略目录，只运行离线子进程；它们不构成真实 DB/HTTP 验收。合成 Git 仓库仅忽略 `.artifacts/` 和系统 `._*` 元数据；元数据保留、真实业务源码 dirty/变更拒绝均有回归，产品 runner 本身不另行过滤源码。真实缺目录/空链/缺 SQL/空 SQL/空 Schema 的迁移清单拒绝也在离线合成目录执行。指纹 helper 的离线回归覆盖非空参考数据、物理行顺序变化、空表、增删改/账本变化、缺表/多表、无模型及安全 SQL 标识符。

本卡只交付入口及有限分类。**干净 clone 的 ai-standard 生成、独立安装、端到端尚未完成**；GEN-03 之后由 CI-02 补产品矩阵。完整 RBAC/管理端/客户端页面、所有插件/文件/异步运行时/集成/AI/通知/支付组合不由这两组代验；真实收费 Provider、现有 DeepSeek 上游门禁、部署和发布也不在本卡范围。无 Schema、迁移、业务 API、页面、权限策略或审计日志 owner 的改动。

## 受保护文件的精确集成请求

Worker 没有修改 `package.json` 或 `scripts/verification/registry.mjs`。总控可执行以下两个定向修改：

1. `package.json` 的 scripts 新增 `"verify:product": "node scripts/verification/product/runner.mjs"`。
2. `scripts/verification/registry.mjs` 新增 `import { af128Registration } from "./product/af128-registration.mjs";`，并在 `taskRegistry` 登记 `"AF-128": af128Registration`。

`af128-registration.mjs` 已提供可审查的精确注册对象：Node24/独立依赖前置、执行器离线回归、当前产品 `checks` 实跑、目标 eslint、diff-check；**不运行 DB、HTTP 或 Next**。然后总控运行 `pnpm run verify:task -- AF-128`，按批次规则独占调度实际 DB 组、更新正式执行记录/队列并接收候选提交。若真实 DB/HTTP 失败，保留非零证据并交回原 Writer，不回填通过。

2026-11-04 真实复验还确认共享 `scripts/verification/client-auth-fixture.mjs` 的 `clientFixtureTasks` 遗漏既有正式 `AF-056`。精确共享请求仅在该数组 `"AF-055"` 之后加入 `"AF-056"`（片段由 `"AF-055", "AF-089"` 变为 `"AF-055", "AF-056", "AF-089"`），不修改 includes/lease owner 断言，不开放任意任务，不调整 acceptance/migration/Seed 三层已有白名单。此修改由总控唯一 Writer 应用；产品 Worker 只读核对其差异恰为该字面量。

预期复验为总控执行正式 `pnpm run verify:task -- AF-128`、全仓 lint 和原 dev 的 `database --serial-db --sha <实际HEAD>`，确认 readiness 与 Workspace 全部真实断言有效且 skip/todo/fail 为零。旧失败 `run-JdMH6K` 保留为 FAIL；共享补登记后的总控报告 `run-oXXK90` 已为该有限 DB/HTTP 组 PASS（readiness 9/9、Workspace 5/5，共 14 项），HEAD 为 `70a0f8254a93ab2ef1451e03bdfa2bb8c11b2c2a` 且 dirty/digest 如实记录。该报告不证明干净 SHA、完整产品矩阵或 DELTA 中尚未解决的 `admin/runtime/readiness` 差量通过；正式集成与负责人接收状态仍由总控收尾。
