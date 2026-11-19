# AF-138 审核修订候选

2026-11-05，`CANDIDATE_SOURCE_CHECKED / LIVE_NOT_RUN / OWNER_CHECK_PENDING`。这是原 AF-138 候选的延续，不是正式 CODE_VERIFIED、独立 Review 或负责人接收。

## 起点、Writer 与预算

- 当前 Worktree `/Users/lei/orca/workspaces/aij-foundation/AIJ-W01-AF138`，Orca ID `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W01-AF138`。
- 本轮 Task `task_671e565d7087`、Dispatch `ctx_432be0f1b747`、terminal `term_3b30414b-2eb7-40c4-8061-9f97b2375ac1`；主 Agent 明确原 Worker 重新成为此六文件范围唯一 Writer，root 不并发改这些路径。
- 2026-11-05 07:52:28 +0800 开始复核：分支 `weiyang86/AIJ-W01-AF138`，工作区干净，HEAD `5f5c5f7d5869a1fc4de852a5a851e9883e846c87`；remote `git@github.com:weiyang86/aij-foundation.git`。原始开发基线仍为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，未 fetch/切分支/改远端。
- 开始即估计前轮约 0.75 有效工时，累计硬上限 4 小时；本修订单独上限 2 小时，因此本轮可用额度为 2 小时。本轮约 0.3 小时、累计约 1.05 小时，均为 Writer 工时估计，不含 idle 等待；未达到上限，无超预算续跑。
- root 目录保持只读；没有安装依赖、生成全局制品、DB/Docker/seed/migrate/服务/真实厂商操作；未写共享 fixture、registry、CODING_QUEUE 或 Schema。

## 六文件最终状态与接收方式

本次最终 SHA 的树同时包含原 `5f5c5f7` 与本次修订；交接消息给出完整最终 SHA。**root 尚未接收原候选，必须按原始 `94b0236` 到最终 SHA 的这六条路径集成完整最终状态，不能只把本轮 commit 的增量当作完整 AF-138。** 原候选提交保留，不 amend 或重写历史。

| 路径 | 最终版本包含的变化 |
| --- | --- |
| `apps/api/src/client-workspaces/workspace-context.service.ts` | 新公共 `assertWritePermissionInTransaction(tx, memberId, workspaceId, permission): Promise<void>`；校验 ID/permission 的运行时类型、长度、语法；复用 workspace advisory lock 与完整授权 SQL/FOR SHARE；原 `resolve` 读语义未改。 |
| `apps/api/src/plugins/aij-ai/ai-knowledge.service.ts` | 原候选创建/编辑/queued/refused 事务围栏保留；私有 helper 仅解析项目、取得插件生命周期锁，再委托公共 WorkspaceContext 方法；不再包含通用授权 SQL 或 workspace 锁。 |
| `scripts/verification/knowledge-lifecycle-fence.test.mjs` | 原 38 项仍执行实际 Knowledge、WorkspaceContext、PluginRuntimeAccess 源码；新增 3 项覆盖公共 owner 归属、13 组非法输入、同一事务/void/拒绝/脱敏错误契约，合计 41 项。 |
| `scripts/verification/knowledge-lifecycle-live.test.mjs` | root 可直接运行的真实 DB/HTTP 脚本，22 个分组、16 条预期真实锁等待；Worker 仅 lint/语法检查，运行有效用例数为 0。 |
| `docs/execution/AF-138-candidate.md` | 原历史内容保留，仅增加“以修订候选为准”的指向，避免旧 38 项/三文件范围被误读为当前事实。 |
| `docs/execution/AF-138-revision-candidate.md` | 本轮授权、检查结果、真实脚本边界与明确停写交接。 |

DB 表/Schema/DTO/API 路径、页面及既有审计内容均不新增。通用鉴权和成员锁只由 WorkspaceContext owner 持有；aij-ai 持有自己的项目/插件能力围栏。权限错误发生于业务写之前，仍为既有 403；插件停用为 404、基础设施错误为 503。原版本冲突/幂等规则不改。

## 锁顺序与管理端点核对

知识提交事务：projectId → plugin lifecycle advisory → 公共 workspace advisory → member/workspace/membership/role/grant/permission SHARE → 业务行/审计/job。JobService 在同一事务重取已持有的生命周期锁，不新增第二队列。

核对现有 `ClientWorkspaceManagementService` 的 `addMember/changeMemberRole/changeMemberStatus/leave`，均先取相同 `aij-client-workspace-membership:<workspaceId>` 与 `hashtextextended(key,0)`，再改成员行；这些方法不获取插件锁。Workspace 名称更新不持有该 advisory，但公共 owner 的 workspace SHARE 行锁会与其 UPDATE 串行。ClientAuth 成员身份事务先取 member 行锁，不回取插件/workspace advisory；本次查阅范围没有反向等待环。没有为统一顺序而越界改管理端点；其原有“保留 owner/不能自行停用”等治理规则未改。

## 实际检查与已知失败

| 本轮命令 | 退出码/有效用例 |
| --- | --- |
| `node --test scripts/verification/knowledge-lifecycle-fence.test.mjs` | 0；41/41 通过，0 skip/失败；包括原 38 项及新公共 owner 检查。 |
| `pnpm exec eslint apps/api/src/client-workspaces/workspace-context.service.ts apps/api/src/plugins/aij-ai/ai-knowledge.service.ts scripts/verification/knowledge-lifecycle-fence.test.mjs scripts/verification/knowledge-lifecycle-live.test.mjs --max-warnings=0` | 0；4 个目标源码/脚本，0 warning。 |
| `node --check scripts/verification/knowledge-lifecycle-live.test.mjs` 与 `node --check scripts/verification/knowledge-lifecycle-fence.test.mjs` | 均为 0；只检查 JS 语法，未执行 live 测试或其 imports。 |
| 两个服务导入图 noEmit 类型检查（下方） | 0；0 diagnostics；使用 workspace 源码别名，不生成 dist。 |
| `node --test scripts/verification/optimization-delta/offline.test.mjs` | **1，8/10 通过、2 失败**；仅 DELTA-R2/R3 历史“停用后仍写入”的复现断言被当前围栏拒绝。共享审计未改，失败未隐藏。 |
| `git diff --check` | 0。 |

前轮常规 `pnpm --filter @aij/api typecheck` 的退出 2（缺 workspace dist 声明及连带诊断）保留；本轮没有重复运行或构建全局制品来消除它。root 构建当前 API 后须执行正式 API 类型门禁。正式 verify/task 注册、DB 与 HTTP 本轮均未执行，没有可交付的已启动地址。

```sh
node --input-type=module <<'JS'
import ts from 'typescript';
import { resolve } from 'node:path';
const config = ts.readConfigFile('apps/api/tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve('apps/api'));
const options = { ...parsed.options, noEmit: true, rootDir: process.cwd(), baseUrl: process.cwd(), paths: {
  '@aij/contracts': ['packages/contracts/src/index.ts'],
  '@aij/runtime-contracts': ['packages/runtime-contracts/src/index.ts'],
  '@aij/core': ['packages/core/src/index.ts']
} };
const program = ts.createProgram([
  'apps/api/src/plugins/aij-ai/ai-knowledge.service.ts',
  'apps/api/src/client-workspaces/workspace-context.service.ts'
].map(p => resolve(p)), options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: x => x, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
}));
console.log(`Knowledge and Workspace owner import graph typecheck (source aliases, no emit): ${diagnostics.length} diagnostics`);
process.exitCode = diagnostics.length ? 1 : 0;
JS
```

## root 真实验证入口（未运行）

root 在正式集成范围登记 AF-138 独立 acceptance 与共享 allowlist，完成依赖/API 构建与目标保护后，从接收后的根工作区运行：

```sh
node --test scripts/verification/knowledge-lifecycle-live.test.mjs
```

脚本使用要求的 `createRemainingClientFixture('AF-138', {aiCenter:true})`；它新建随机 `aij_foundation_af138_test_<16hex>` 数据库，校验 task/repository/instance/lease，不接受旧 lease、不 reset/drop 任何库。尚未登记时会失败，不能改用其他 AF task 绕过。脚本核对当前编译的公共方法与 AI 委托；旧 API 制品应失败而不是假绿。

`aiCenter` seed 不提供旧 Knowledge 模型端口的四条配置，脚本只在本次独立库创建 AF-138 专用离线配置和内存 synthetic env SecretRef。worker/scheduler 关闭，注册表只取既有 `offline-knowledge`；本地计数器记录任何意外 invoke，预期为零，无厂商/付费调用。

22 个分组实际断言计划如下，**均尚未执行**：

- 真实 HTTP 创建/编辑/无证据 refused 成功、原有审计与内容脱敏；匿名、其他 workspace 成员、撤知识权限拒绝，AI 业务快照无变化。
- update/refused/queued 三类写事务分别在入口已成功后，与插件停用、membership 暂停、member identity 停用、知识 grant 撤销竞争，共 12 个分组。使用两条独立 pg 连接持锁/观察，必须从 `pg_blocking_pids` 证明服务 PID 等待竞争 PID，先提交失效状态后再确认 403/404 与零文档/问答/job/trace/AI 审计增量。
- 写事务先取公共 owner 的真实 SHARE 行锁，再阻塞 4 类竞争者：插件生命周期、workspace 成员锁，以及不取 advisory 的 member UPDATE、grant UPDATE；必须证明竞争 PID 等待服务 PID，放行成功提交后才允许变更，下一请求拒绝。
- refused/queued 两类并发相同 key 仅一 question；queued 仅一个现有 RuntimeJob，正确 project/workspace/plugin 归属；重放同 ID、不同 query 为 409，trace/AI 审计不增。
- 同一文档版本的两个真实并发 HTTP PATCH，仅一个 200、另一个 409、一条审计；过期版本请求不改变业务快照。
- 在本次新库安装**仅拦截 AF-138 指定 correlation 的** PostgreSQL 测试触发器，真实 `audit_log` INSERT 抛异常；create/update 均 503，文档/updatedAt/AI 审计及其他业务快照全部回滚。移除本卡触发器/函数后更新成功，保留恢复审计。没有将 JavaScript mock 异常当作 DB 回滚证据。

PrismaService 配置 `connection_limit=1`；脚本使用现有 `withDatabase` 为竞争者和观察者建立独立、经过同一 lease/目标身份核验的 pg 连接。bounded 查询轮询只用来确认实际 blocker PID，不用 sleep 推定等待成功。事务入口/授权完成的屏障仅在测试进程的 transaction proxy 内，所有 SQL 与生产服务仍真实执行。所有在途请求与竞争者立刻附加 rejection handler，finally 释放屏障并等待 settle；恢复 transaction hook、provider hook、初始授权字段，删除本卡配置/引用与本卡测试触发器，再关闭 app/Prisma，查询 pg_stat_activity 确认本次新库零 aij-api session。独立 pg client 由 withDatabase 的 finally 关闭。

聚合证据位于**实际运行工作区自己的** `.artifacts/auto-ai-program-20261105/AF-138/live-*/result.json`：仅 task/新 lease 标识、分组 PASS/FAIL、安全错误码、HTTP 状态、真实 blocker PID、provider 计数和清理状态；无凭据、cookie、token、请求正文、SQL 参数或原始 driver 错误。Worker 没有生成该 live 证据文件。测试数据和本次新库保留供总控检查，没有删库清理；旧任务库与凭据不触碰。

边界保留：脚本不能证明实际运行前的 DB 成功；共享 `createRemainingClientFixture` 若在返回 app handle 之前初始化失败，其内部资源可见性由现有 shared helper 决定，当前六文件没有改该 helper。root 若遇此失败应在共享治理范围清理该新 lease 的部分初始化，不借用旧实例继续。本脚本没有扩展到真实厂商、执行器结果写回或所有状态笛卡尔积；项目/组织及更细 deleted 状态在 41 项源码回归覆盖，真实 DB 全矩阵仍由总控按正式门禁决定。

## 明确交接

最终候选按原标题精确本地提交，只包含上述六文件当前差异；原 `5f5c5f7` 保留。正式队列/registry/共享数据库登记、真实脚本运行、AF-126 当前回归断言整合、正式 verify 与原标题正式提交均由主 Agent 串行执行。

**停止全部写入，交回主Agent集成。** 本 Writer 在候选提交和本 Dispatch worker_done 后不继续改产品、测试或文档；此候选不是正式 CODE_VERIFIED。
