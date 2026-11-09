# AF-161 执行用户私有Agent并复用统一任务账本 — Worker 候选交接

状态：CANDIDATE / NOT CODE_VERIFIED；正式验收与 OWNER_CHECK_PENDING 由总控登记。本记录是 Worker 自查，不是独立 Review 或负责人接收。完成候选本地提交和 readback 后，Writer 明确 **STOP ALL WRITING**，等待新派工；不续跑下一卡。

## 身份与写入阶段核验

- Issue/card：AF-161，唯一 Writer 为本 Worker，无子代理或 helper Worker。
- Worktree ID：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W07-AF161`。
- Worktree instance：`dc25f139-39ba-4959-bd09-32a090d44656`。
- Task：`task_be969bf156ad`；Dispatch：`ctx_0b0530fb66da`。
- Worker terminal：`term_b00a5d3c-b43d-4c9f-9ee2-8c9b53ac87d2`；coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- Branch：`weiyang86/AIJ-W07-AF161`；初始 HEAD 与 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，初始 `git status --short --branch` 干净。
- Remote fetch/push 均为 `git@github.com:weiyang86/aij-foundation.git`；未改 remote，未 fetch/push/merge/tag/切换分支。
- 主工作区与轻企仓库均未写入；未改正式 queue/registry/AGENTS、manifest、lockfile、生产 Schema/module/SDK index。

每次写入阶段均重新执行了 `git status --short --branch`、`git rev-parse HEAD` 与 `git remote -v`（以及初次 `git worktree list` 和 `orca worktree current --json`）。阶段记录：

| 阶段 | HEAD / 状态 |
| --- | --- |
| bootstrap 前 | 94b0236…；干净；已核对真实 Orca 身份及 origin/dev |
| API/SDK 初始实现前 | 38fdae1…；干净，仅已授权 bootstrap 独立提交 |
| admission/fencing 实现前 | 38fdae1…；仅本卡 provider 与私有新增模块/SDK 文件 |
| 离线/live fixture 修复和扩充前 | 38fdae1…；仅 allowPaths 自有差异 |
| 交付文档与候选提交前 | 38fdae1…；仅 allowPaths 自有差异，remote 和 origin/dev 保持原值 |

Bootstrap commit：`38fdae15d424090c5bb62dd2a934df61a5fbef95`。使用 `git show 16cfeabbd248a9faff0efd77ad946b033d18e526:path` 恢复派工清单中的全部 16 个 source blobs；写文件前逐一校验 SHA256，任何不符即 assertion 退出，然后只精确暂存这 16 个路径并独立提交。该提交只是 compiler/source bootstrap，不是基线集成、数据库或依赖/凭据复制。其后只有 allowPaths 中的 run/provider 被修改，其余 14 个 bootstrap 路径保持不变。根目录集成须按精确候选 delta 处理 bootstrap，避免把已存在的旧内容覆盖到根目录。

## 实际改动与边界

候选包含 10 个 allowPaths：

- `apps/api/src/plugins/aij-ai/ai-center-run.service.ts`：共用 admission，新增服务端私有入口；同事务 lifecycle/身份/授权/目录锁与原共享 key 锁；原子 reserve/enqueue/run；dispatch 实际依赖复检；Job→Run→settlement 租约隔离，失败也不可逃逸 fencing；既有 owner read/reconcile/retention 保留。
- `apps/api/src/plugins/aij-ai/ai-center-provider.ts`：只为现有 snapshot 增加可选可信 provenance 类型，不改 transport/协议、限额、脱敏或 provider 执行逻辑。
- `apps/api/src/plugins/aij-ai/ai-personal-agent-snapshots.service.ts`：从同 owner/Workspace 的当前 enabled Agent、不可变 Agent version、ordered Skill versions 及 active 当前 Skill 行解析可信快照，精确 modelRevision/catalogVersion；无 executor 依赖。
- `apps/api/src/plugins/aij-ai/ai-personal-agent-runs.service.ts`：严格的 id/input/key/revision 边界，委托既有 Run owner。
- `apps/api/src/plugins/aij-ai/ai-personal-agent-runs.controller.ts`：同源、feature flag、会话/Workspace、双权限、202、无 query/no-store。
- `packages/sdk/src/personal-agent-runs.ts`：只提交，复用既有 ClientApi，读取/恢复用共用工厂。
- `scripts/verification/personal-agent-runs.test.mjs`：实际源码、显式 offline doubles 的 14 项检查；不宣称 PG/JobService 证据。
- `scripts/verification/personal-agent-runs-live.test.mjs`：全新 AF-161 root-only 真实 API/JobService/Registry/PG/Trace/预算/loopback fixture；Worker 未运行。
- `docs/development/PERSONAL_AGENT_RUNS.md`：接口、锁/预算/nonce、根目录接线/验收/SDK 及人工步骤。
- 本执行记录。

数据库：没有新模型/表/迁移/SQL；只复用 AF-159/154 模型与既有 Run/RuntimeJob/Trace/budget。未连接 DB、Docker、migrate/seed；没有启动 API/Web，没有访问地址。页面：无改动。权限：使用已有 `workspace.ai.execute` + `workspace.ai.assets.read`；无新增权限。审计/日志：未新增含私有内容的记录，Trace 继续用现有 coarse shape 脱敏，运行输入/输出保持原 retention/redaction。真实 vendor calls、付费模型、支付、通知均未使用。

## 验证及失败记录

已运行且成功：

- `pnpm install --frozen-lockfile --ignore-scripts`：独立本地 node_modules，锁文件未变，无跨工作区依赖/上传/环境共享。
- `pnpm --filter @aij/api prisma:generate`：自有 compiler generation，无 DB 连接/环境文件载入。
- 小公共包构建 `node scripts/build-workspace-package.mjs packages/{contracts,runtime-contracts,core}`（逐个执行）：通过；只生成 ignored dist。
- `pnpm --filter @aij/api exec tsc --noEmit`：通过。
- `pnpm --filter @aij/api exec tsc -p tsconfig.test.json --noEmit`：通过。
- `pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --lib ES2022,DOM packages/sdk/src/personal-agent-runs.ts`：通过。
- 定向 `pnpm exec eslint`：run/provider、全部本卡 personal-agent 模块、SDK、两个新 verification 文件，`--max-warnings=0` 通过。
- `node --test scripts/verification/personal-agent-runs.test.mjs`：14/14 通过；覆盖参数伪造、immutable/history/order、当前依赖与上下文 gates、共享 key、text/JSON、credential IO 期间撤销、legacy catalog、缺失/错误/过期/旧 nonce、同 worker 新租约、预算不确定性和 SDK transport。
- `node --check scripts/verification/personal-agent-runs-live.test.mjs` 与 `git diff --check`：通过。

Before-fix 实际源码复现：从 bootstrap commit 读取原 run.service，在 ignored `.artifacts/af161/before-fix.mjs` 内 transpile 并注入显式离线依赖，缺失 leaseNonce 仍出现 1 次 provider invoke、3 次 Run 写入并成功。证据 `.artifacts/af161/before-fix.json` 标记 `BEFORE_FIX_UNFENCED_EXECUTION_REPRODUCED`，不是 DB 证据。修复后的对应实际源码测试要求缺失/格式错/旧 nonce、过期、错误 worker/attempt 均零写入/零 settlement/零 transport。

真实失败及修复：

1. 首次 API noEmit 失败，原因是独立安装后尚未构建 runtime-contracts/core 产物；补齐允许的小公共包构建后通过，没有改源码或放宽门禁。
2. 首次 offline 测试 10/11，通过项不掩盖失败；一项把同步参数拒绝错误用 `assert.rejects(promise)` 捕获，修正为 async callback 后通过，之后扩充至 14 项。
3. 新 live 脚本初次 lint 发现三个未使用 destructuring 变量，改为显式过滤可保存字段后通过。
4. Before-fix 临时 harness 初次执行使用了错误的 execFileSync options 形式，修正后成功复现；未产生外部调用或产品数据。

NOT_RUN（留总控，不能由上述测试替代）：正式 verify:task、实际 PostgreSQL/session/API/JobService live 新脚本、legacy DB text/image/recovery/fencing、模块/入口接线及重型 API/Web build、SDK index 导出/build/ESM+CJS packed consumer、真实 DB pools=0、浏览器/人工验收。原 live 脚本仅语法/lint；没有以 skip、假 JobService 或 SQL 返回值计为 DB 通过。

## 总控下一步与交接

完整步骤见 `docs/development/PERSONAL_AGENT_RUNS.md` 的根目录集成清单。关键是停止后由 root 接线 controller/三个 providers 和 SDK export；为新 AF-161 注册真正的验收/fixture 白名单及 pluginManagement seed 透传；串行跑新 live 脚本、legacy 门禁、正式 verify:task 与 packed SDK consumers。真实依赖集成 IDs：`task_8225f38866ac`（AF-159）、`task_623c04531bae`（AF-154）、`task_634f404155e8`（恢复 AF-145）、`task_062c43c051bb`（AF-157）；没有使用候选 Task 冒充已集成依赖。

预算：Worker 用时约 0.4h（2026-11-05 15:51–16:15 CST，含实施/检查/交付；最终精确停止时间与 SHA 在 worker_done/readback），低于 2.5h Worker 上限，保留至少 1.5h root。没有硬阻塞、没有申请扩范围、没有修改根目录共享文件。尚存风险是 root-only 真实验证未运行与共享接线未完成，因此此交付仅为可审候选；如真实校验发现问题应以新派工交还唯一 Writer。

候选提交使用任务原名 `执行用户私有Agent并复用统一任务账本`，仅本卡差异；最终 SHA 由 worker_done 附带，避免自引用。提交后 readback 确认本工作区干净、origin/dev 原 SHA 和 remote 未变，明确 STOP ALL WRITING 后仅发送一次 worker_done，不续跑/轮询。

## 追加修正交接（root review 后恢复同卡）

原候选 `67bd29448e66852a1283ea1382db1f756cca222f` 和独立 bootstrap `38fdae15d424090c5bb62dd2a934df61a5fbef95` 均保留，不 amend、不改写历史。新 Task `task_286aaa168126` / Dispatch `ctx_951f59fde00b`；Worktree/instance/terminal/branch/remotes 与上文一致。恢复时 HEAD=原候选、工作区干净、origin/dev=94b0236…，root 明确未集成 AF-161 delta；每个修正写入阶段和追加提交前再次核对 status/HEAD/remotes，只写本卡 allowPaths。

root 指出的初版错误均承认并修复：live fixture 误用了不存在的 personal-skills 路径和未注册的短权限码；p-UUID namespace 与合法目录 code 重叠且 blanket rejection 破坏列表；依赖映射误把 AF-154 标成 AF-157、把恢复 AF-145 标为 nonce。更正后的映射为 AF-154=`task_623c04531bae`、AF-157=`task_062c43c051bb`、恢复 AF-145=`task_634f404155e8`、AF-159=`task_8225f38866ac`；并未声称这些 runtime fixtures 已在 Worker 运行。

产品修正仅将私有 Agent/Skill 编译 code 和 Run.agentCode 改成 `personal:UUID`，删除目录 blanket rejection，dispatch provenance identity 相应更新。实际 contract 中 code 为 string，Schema agent_code 为 String，compileAgent 不按目录 regex 验证内部 code，因此不需要 Schema 或 policy 变更。目录快照/旧 hash 不改，新的回归同时检查列表、提交、执行、原 hash、重放与同输入跨来源 key 冲突。live fixture 改用实际 `/client/ai/skills` 路由和编译后的权限常量，加入 p-UUID 回归、personal: code 断言；其余路径/状态已与 root 实际 controllers/guards/services 只读核对，将 active gates 的混合状态断言收紧为源码对应的精确状态。

初始失败/修复证据：新增 `valid legacy p-UUID catalog code still lists/submits/executes with its unchanged hash` actual-source regression 在原候选先失败，NotFoundException 来自 snapshot blanket rejection，整个 agents() 列表 404；修复后离线测试 15/15 通过。其余定向 API source/test noEmit、SDK target noEmit、lint、live 语法检查、diff check 通过；没有安装新依赖或改变现有 compiler/bootstrap。新 live、正式 verify:task、DB/JobService/应用/重型构建/SDK packed consumer 继续 NOT_RUN，先前离线模拟不升级为数据库证据。

修正限时：本轮约 0.2h，低于 0.4h Worker 上限（总卡仍保留 root 预算）。最终 parent chain 为 `94b0236 → 38fdae1 bootstrap → 67bd294 首候选 → 本追加候选`，最终完整 HEAD 通过 worker_done/readback 交付；root 仅在 STOPPED 后集成 `38fdae1..最终HEAD` 的 10 路径卡片 delta，避免重复套用 bootstrap。追加提交使用同一原任务标题，提交 readback 后再次明确 **STOP ALL WRITING**；尚未 CODE_VERIFIED，没有 push 或改其他卡/root。
