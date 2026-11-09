# AF-139 — 明确运行时就绪诊断与启动恢复验收契约

候选交付，待主 Agent 正式集成与验证；不是 CODE_VERIFIED 或负责人接收。唯一 Writer 为本 Dispatch，自查不是独立 Review。使用 `orca-cli` / `orchestration` 技能核对实际工作区并交接，不启动其他 Worker。

## 实际身份与边界

- 开始目录 `/Users/lei/orca/workspaces/aij-foundation/AIJ-W01-AF139`；Orca Worktree ID `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W01-AF139`，instance `ed8b5bcc-a3a5-46bd-bd4c-bf5649b77d53`，baseRef `refs/remotes/origin/dev`。
- Task `task_62c94c7fcbaa`；Dispatch `ctx_7351715e61ae`；Writer terminal `term_4c7b3fd5-7487-4478-8072-d2f7f1d05f82`；总控 terminal `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 开始分支 `weiyang86/AIJ-W01-AF139`；HEAD 与当时 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。`git status --short --branch` 干净，无继承差异；origin fetch/push 均为 `git@github.com:weiyang86/aij-foundation.git`。未切分支。
- 根目录 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation` 只读；读取冻结基线的 REQUIREMENTS_BASELINE、SOURCE_GAP_ANALYSIS、DELIVERY_AND_ACCEPTANCE、traceability.json，授权按当前 `auto-ai-program-20261105/PROGRAM.md` 与本卡执行。未修改历史接收、正式队列、registry、共享审计或 AF137 产品源码。
- 独立安装当前锁定依赖；不复制 `.env`、凭据、node_modules 或数据。没有 DB/Docker/seed/migrate、Prisma generate、服务启动、真实厂商调用、完整 build、push/PR/merge/tag/部署。

## 源码结论与验收契约

1. `runtime-fixture.mjs:33–56` 已显式开启 runtime，但在 listen/login 后直接返回；`RuntimeWorkerService.onModuleInit:26–28` 将 worker/scheduler 设为 running、`lastPollAt=null`，首轮分别由 1000/5000ms interval 触发。`RuntimeHealthService:22–24` 要求两者 running、无错误且心跳年龄小于 30000ms。因此 fixture 返回不意味着 runtime READY，旧测试直接期待 200 缺少收敛等待。源码足以确认该测试前置缺口；不能据此断定 AF126 两次历史 503 的唯一运行时原因。
2. 保持 startup、stale（含 30000ms 边界）、error、disabled、DB 失败为 503；进程 `/api/health` 保持 200 / `scope=process`。没有启动宽限豁免，不把 503 当成功；最终必须 HTTP200、`ready=true`、`reason=READY`、DB ready 和两类新鲜无错误心跳。
3. DB 恢复后，旧心跳可能仍在 30 秒窗口内，即使服务已返回 200，也不足以证明恢复后的 runtime 推进。等待必须看到 worker 和 scheduler 的 `lastPollAt` 均严格晚于恢复 `ALLOW_CONNECTIONS=true` 返回后的 barrier；相等、未推进、stale、错误均不能通过。
4. 当前 `AuthService.ensureDatabase/authenticate` 与 RBAC 在 controller 前依赖 DB。故障时合法结果可能是 `AuthExceptionFilter` 的精确 `{success:false,data:null,message:"Service unavailable"}` 503，并无 health 快照。本诊断将其标为 `SERVICE_UNAVAILABLE_BEFORE_RUNTIME_SNAPSHOT`，DB/worker/scheduler 记 null，不能编造 DB 或心跳状态；仍须等待真实 READY。其他空值/未知 503 体按畸形响应失败，401/403 立即失败。

AF126 原 `runtime-readiness` Node exit1、两子场景预期200得到503及父聚合失败仍是历史 FAIL；本候选没有改写它们。旧审计“成功复现缺陷”不等于产品通过；AF137/AF138 修复后旧 DELTA-R* 断言可能失败，总控应保留真实输出并在集成范围更新共享审计，不删除或忽略它。

## 允许路径内实际 diff

| 文件 | 最终变化 |
| --- | --- |
| `scripts/verification/runtime-readiness-diagnostics.mjs` | 新增 HTTP probe、严格响应检查、白名单投影和有界收敛等待；默认总限20秒、单请求8秒、按观测每200ms轮询，另设最多201次尝试；配置上限60秒。请求与读 body 共用 AbortSignal，超时即失败，丢弃原始异常 cause。 |
| `scripts/verification/runtime-readiness-diagnostics.test.mjs` | 受控时钟与实际源码加载；启动503→READY、30秒stale/错误/disabled/DB503、持续503、401/403、异常状态码、畸形JSON/结构、200契约不一致、DB恢复双心跳、网络/读body超时与秘密不进入诊断。 |
| `scripts/verification/runtime-readiness.test.mjs` | 原真实 HTTP/DB 脚本接入启动/监控/DB恢复等待；新增确定性受控 starting 状态 HTTP503 后释放门闩、由真实定时器推进的子例；保留所有原RBAC、载荷泄漏、取消审计、故障503、liveness200、数据不变与池关闭断言。 |
| `docs/execution/AF-139-candidate.md` | 本候选执行与交接记录。 |

受控 startup 子例只在测试中短暂置 worker `status=starting,lastPollAt=null`，确保登录较慢时也能观测一次503；随后恢复 running 并清空两类心跳，实际定时器重新填充后才允许成功，不手工调用 poll/tick 或注入绿色心跳。自然 startup 单独保留首次响应及完整收敛序列，可能合法地从200开始，不能伪称每次自然启动都实际观测到503。

诊断只输出 HTTP状态、白名单reason、DB ready、worker/scheduler状态、规范时间戳/年龄、hasError、相对时间、等待条件和失败码；每次观测保留在有上限数组中，失败异常包含该数组。未输出 URL、header、token、instanceId、lastError、队列载荷或原始异常。成功返回的原始响应仍交给既有泄漏断言，避免用投影掩盖产品响应泄漏。

DB/schema/API/页面/权限/产品日志均无实现变更。Worker 只使用合成依赖，无实际 DB 或 HTTP 服务；纯测试并非真实 HTTP/数据库通过证据。真实脚本仍通过原 AF052 受保护 fixture 创建随机逻辑验收库，artifact 名实保留 AF052，不冒充 AF139 数据库授权。

## 实际命令与结果

运行环境 Node `v24.21.0`、锁定 `pnpm@10.0.0`。

| 命令 | exit / 有效用例 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 0；独立安装726包，锁文件未变；依赖自带 build scripts 被 pnpm 忽略，未启用。 |
| 首轮 `node --test scripts/verification/runtime-readiness-diagnostics.test.mjs` | 1；36 pass / 2 fail，共38节点；实际 controller 源码加载缺少明确 DTO import stub，尚未运行两个源码场景；属于测试装配错误，不是产品 FAIL。已补齐允许的合成 DTO port，无修改产品源码。 |
| 修复后同命令 | 0；44/44，随后增加实际源码 DB恢复双心跳用例。 |
| `node --test --test-reporter=./scripts/verification/reporter.mjs scripts/verification/runtime-readiness-diagnostics.test.mjs` | 0；最终45/45节点，19个顶层，其中5个聚合父项；40个末级有效用例，0 fail/cancel/skip/todo。 |
| `node --test scripts/verification/optimization-delta/offline.test.mjs` | 0；10/10，0 fail/skip/todo；仅当前未合AF137/AF138的起始基线自查，不宣称缺口已关闭。 |
| `pnpm exec eslint scripts/verification/runtime-readiness.test.mjs scripts/verification/runtime-readiness-diagnostics.mjs scripts/verification/runtime-readiness-diagnostics.test.mjs --max-warnings=0` | 0；三文件定向 lint。 |
| `node --check` 分别检查上述三个 mjs | 均0；只检查语法，不加载真实 fixture。 |
| `git diff --check` / `git diff --cached --check` | 均0；候选提交前仅精确暂存四个 allowPaths。 |

未运行：真实 HTTP/DB 矩阵、正式 `verify:task AF-139`、API/全库 typecheck/build、真实厂商、页面验收；没有已启动访问地址。没有最终已知失败的本卡纯测试。有效工程工时约0.6小时，含核对/安装/实现/自查/交接，不含主 Agent DB与集成时间，低于2小时预算。

## 主 Agent 串行真实验证步骤

1. 接收本 Writer 停写后按四个路径精确集成，注册 AF139 正式检查；在 files/provenance 中覆盖新 helper/test 与实际 health/worker/controller 源码，质量门禁包含新纯测试、定向lint、diff-check和下述真实矩阵。正式状态/执行记录/队列与原标题提交由主 Agent 负责。
2. 在原 dev 使用既有 `g9TargetPrerequisite` 相同的 `checkDatabase('test')` 核验 host=127.0.0.1、port=55433、database/user=aij_foundation_test，实际 identity/sessionUser 相等，容器内 serverPort=5432；再按主 Agent 调度生成/编译当前API。DB/构建并发各1，不能运行子工作区DB或沿用陈旧dist。
3. 当前制品前置通过后运行 `node --test --test-reporter=./scripts/verification/reporter.mjs scripts/verification/runtime-readiness.test.mjs`。脚本保留AF052现有数据库allowlist、保护与证据路径；若正式记录需改成AF139 lease，由主 Agent 统一更新所有共享授权点后再运行，不在本候选绕过保护。
4. 期待4个子场景加父项共5节点全部通过：受控starting503→双真实心跳READY200；匿名401/缺权限403及授权200、队列不泄露和取消审计；真实逻辑DB断连503且liveness200→恢复后双新心跳READY200、原dead数据未变；关闭API后Prisma session清零。任一步失败保留非零Node退出与结构化报告，不接收503作为ready。
5. 在 `.artifacts/af-052/integration/<新acceptanceId>/` 查看 `startup-readiness.json`、`controlled-startup-503.json`、`controlled-startup-recovery.json`、`monitor-readiness.json`、`database-outage-503.json`、`database-recovery.json`；等待失败同名证据保留 outcome/转换/失败原因。人工按顺序核对初始503、最终200、两心跳均晚于barrier及小于30秒、DB拒绝时liveness200、RBAC拒绝与去敏；脚本结束后临时地址已关闭，不宣称持久页面可访问。

未解决/限制：AF126历史运行时响应体缺失，不能追溯证明旧503唯一原因；本轮没有真实DB结果。源码 queue-query失败分支缺少顶层reason，本诊断保留null及DATABASE_UNAVAILABLE，不修health owner。源码 fresh仅判断年龄<30000，没有未来时间下界；验收诊断拒绝未来心跳200，若真实出现应报告产品/时钟缺口，不能放宽检查。scheduler无注册schedule时心跳不证明发生DB调度写入；本卡恢复契约只断言DB readiness与heartbeat推进，不声称业务任务或全部调度能力已经恢复。停滞poll已知产品缺口由AF137负责，本卡不改写它。

## Writer 交接

候选提交标题逐字采用“明确运行时就绪诊断与启动恢复验收契约”；候选SHA由 worker_done 传递，避免文档自引用。候选只包含四个允许路径，没有push或正式CODE_VERIFIED声明。后续代码依赖必须引用主 Agent 的真实 I-* 集成 Task，本候选 Task 完成不等于下游依赖已满足。

**停止全部写入，交回主Agent集成。** 正式验证、共享审计更新、registry/队列/执行记录及负责人review由主 Agent 继续；本 Worker 完成一次 worker_done 后保持空闲。
