# AF-137 候选交付：修复异步轮询重入导致的虚假健康心跳

2026-11-05；仅为本 Dispatch 的实现与同一 Writer 自查记录，不是独立 Review、正式 CODE_VERIFIED 或负责人接收。授权以根工作区只读 `docs/planning/auto-ai-program-20261105/{PROGRAM.md,AF-137.md,program.json}` 为准；已读取冻结需求基线、SOURCE_GAP_ANALYSIS、DELIVERY_AND_ACCEPTANCE 与 traceability.json，追溯 REQ-021 / AC-021 的健康重入差量，不宣称完整 REQ-021 已交付。

## 开始核对与唯一 Writer

| 字段 | 实际值 |
| --- | --- |
| 工作目录 | `/Users/lei/orca/workspaces/aij-foundation/AIJ-W01-AF137` |
| Orca Worktree ID | `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W01-AF137` |
| Worktree instance ID | `61973f98-9180-4534-b8c4-6c4307c2fec9` |
| 起始分支 | `weiyang86/AIJ-W01-AF137` |
| 起始 HEAD / 当时 origin/dev | `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，两者一致 |
| 开始 git status | `## weiyang86/AIJ-W01-AF137`，无已跟踪/未跟踪差异 |
| origin fetch / push | `git@github.com:weiyang86/aij-foundation.git` |
| Task / Dispatch | `task_fd662c50af12` / `ctx_3582f70fb070` |
| Writer terminal | `term_1705ed43-0663-4446-8ffa-afcce4e487bf` |
| 总控 terminal / 集成 Task | `term_a1b633bc-6ace-4602-868a-dc2c12c5849e` / `task_cd3c87021b71` |
| 预算 | 2.5 有效工程小时，本次约 0.4 小时，未超限 |

`orca worktree current --json` 确认工作区由 Orca 创建、baseRef 为 `refs/remotes/origin/dev`、父工作区为指定根目录。根目录仅只读；没有修改其他 Writer 范围，没有子 Agent。独立执行 frozen 安装，没有复制凭据、环境文件、node_modules 或上传数据。

## 实际差异与行为

仅修改三个 allowPaths：

1. `apps/api/src/async-runtime/runtime-worker.service.ts`：删除 `poll()` 在判断 `activePoll` 之前的 `lastPollAt = new Date()`，用注释说明心跳只由新 `runPoll()` 推进。`runPoll()` 已有的起始心跳成为唯一写点；重入返回当前轮的 Promise，不重复 claim，不刷新时间，也不清除旧错误。
2. `scripts/verification/runtime-worker-reentry.test.mjs`：新增 13 个纯源码行为用例。复用只读 `optimization-delta/source-loader.mjs`，实际加载 Worker、Health、Scheduler、runtime-contracts 和 audit-redaction，使用受控时钟、可释放/拒绝 Promise、合成 I/O 依赖及不启动真实计时器的注册替身。没有复制被测实现，没有靠源码字符串匹配判定本卡行为。
3. 本候选记录。

四个阻塞位置分别为 outbox claim、outbox deliver、job claim、job execute。每处推进至 29,999ms / 30,000ms / 60,000ms，分别重入三次，确认总计九次重入仍只有一轮 claim/执行、调用者等待同一轮、心跳对象及时间保持原值；释放后仍 stale，下一次真实 poll 才更新心跳并恢复 ready。错误用例覆盖四个位置拒绝、固定错误码、失败后重新阻塞及重入不能清除旧错误，真正成功后恢复。另覆盖禁用启动、运行中禁用与重新启用、停止等待成功/拒绝、停止后队列中的 timer 回调拒绝新任务，以及 scheduler 自己刷新前仍 stale 的边界。

健康策略仍为 `< 30_000ms` 才新鲜；没有改 Health 或 Scheduler owner。正在进行的单轮任务继续按现有策略排空，配置禁用和 stopping 只拦截新一轮，不新增取消语义。长任务卡住时 ready 降为 false 是此次修复要求；单轮释放/完成不冒充新一轮心跳。

数据库/Schema/migration、API 路由与响应契约、页面、权限、日志与厂商调用均无改动。未启动服务，没有可访问运行地址；不宣称真实数据库、HTTP 或多进程租约验收已完成。

## 命令与结果

运行环境：Node `v24.21.0`，pnpm `10.0.0`。

| 命令/阶段 | exit | 有效用例/结果 |
| --- | --- | --- |
| `pwd`、`git status --short --branch`、`git branch --show-current`、`git rev-parse HEAD`、`git remote -v`、`git rev-parse origin/dev`、`orca worktree current --json` | 0 | 记录如上；写入前重复核对 |
| `pnpm install --frozen-lockfile` | 0 | 独立安装 726 个锁定依赖；锁文件/manifest 无差异；安装脚本保持 pnpm 默认忽略，没有启用脚本 |
| **修复前** `node --test scripts/verification/runtime-worker-reentry.test.mjs` | **1** | 13 例：5 PASS / 8 FAIL，0 cancelled/skipped/todo；四个阻塞和四个异常用例均捕获重入推进心跳 |
| **修复后** `node --test scripts/verification/runtime-worker-reentry.test.mjs` | **0** | **13/13 PASS**，0 failed/cancelled/skipped/todo |
| `pnpm exec eslint apps/api/src/async-runtime/runtime-worker.service.ts scripts/verification/runtime-worker-reentry.test.mjs --max-warnings=0` | 0 | 两个目标文件通过，无警告 |
| `git diff --check` | 0 | 空白检查通过 |
| `node --test scripts/verification/optimization-delta/offline.test.mjs` | **1** | **10 例：9 PASS / 1 FAIL**，0 cancelled/skipped/todo；唯一失败为旧 DELTA-R1 缺陷复现断言，原貌见下 |

新用例执行期间源码通过实际 TypeScript transpile diagnostics；这不等于 API 语义 typecheck。旧审计包含其他尚未关闭差量的“复现成功”断言，其 PASS 不计为本卡产品验收。

旧审计实际失败原貌（共享文件未修改、未过滤/跳过该用例）：

```text
✖ DELTA-R1 reproduction: a stalled active poll gets fresh heartbeat and remains ready
AssertionError [ERR_ASSERTION]: observed defect, not acceptance PASS

false !== true

at TestContext.<anonymous> (.../scripts/verification/optimization-delta/offline.test.mjs:72:12)
actual: false
expected: true
operator: 'strictEqual'
tests 10; pass 9; fail 1; cancelled 0; skipped 0; todo 0
```

修复前新测试的实际失败包括：`reentry cannot publish a heartbeat`，actual `2026-11-04T00:00:29.999Z`、expected `2026-11-04T00:00:00.000Z`；异常路径则为 actual `00:01:00.000Z`、expected `00:00:00.000Z`。这证实新测试能拒绝原始实现。

## 未运行与总控验证建议

未运行正式 `verify:task`、API 语义 typecheck、任何 build、DB/Docker/seed/migrate、HTTP/页面/服务、真实厂商、付费或通知。没有 Prisma generate；本卡测试不需要生成客户端或包制品。不写正式队列、registry、AGENTS、依赖清单/锁文件、Schema 或共享 offline.test.mjs。

总控在 `task_cd3c87021b71` 精确接收允许差异后：

1. 运行 `node --test scripts/verification/runtime-worker-reentry.test.mjs`，应 13/13；运行完整旧 audit 并保留上述失败记录，在总控获准共享范围将 DELTA-R1 改为修复后拒绝 stale 重入的验收，同时保留历史缺陷已复现证据。不要把旧 audit 的失败隐藏成绿色。
2. 运行适用 runtime 纯回归和正式 `verify:task -- AF-137`；在总控环境执行 API typecheck / build。DB 验收如需追加，由总控独占串行调度；本候选没有数据库验收证据。
3. 人工检查可从新测试四个阻塞位置选任一项：暂停在途 Promise、推进 60 秒、重入后读健康应 false，释放后仍 false，新轮成功再 true；关闭等待排空后不再更新心跳。当前无需使用任何在线地址。

正式 CODE_VERIFIED、执行记录/队列更新与正式卡片提交均留总控；负责人状态保持 OWNER_CHECK_PENDING。候选提交标题为“修复异步轮询重入导致的虚假健康心跳”，提交 SHA 由完成交接消息给出，不 push/merge/PR/tag/部署。下游不得以此候选 Task 代替集成 Task 的真实完成依赖。

**停止全部写入，交回主Agent集成。** 本记录随候选提交交付；提交和只读核对结束后 Writer 不再修改本工作区文件。
