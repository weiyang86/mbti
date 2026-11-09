# AF-138 候选交付：补齐知识写入的插件与成员事务围栏

> 本文保留 `5f5c5f7` 首轮候选的范围与验证历史。主 Agent 审核修订后的公共 WorkspaceContext owner、六文件候选、41 项源码回归及未运行 live 脚本，以 [AF-138-revision-candidate.md](AF-138-revision-candidate.md) 为准；下文三文件范围与 38 项计数不代表修订后的当前版本。

2026-11-05，状态 `CANDIDATE_SOURCE_CHECKED / REAL_DB_NOT_RUN`。本文件是唯一 Writer 自查与候选证据，不是独立 Review、正式 CODE_VERIFIED、负责人接收或发布记录。

## 工作区与授权

- 起始目录 `/Users/lei/orca/workspaces/aij-foundation/AIJ-W01-AF138`；开始 `git status --short --branch` 无已有修改。
- 分支 `weiyang86/AIJ-W01-AF138`；起始 HEAD 与当时 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- remote `origin = git@github.com:weiyang86/aij-foundation.git`（fetch/push）。未 fetch、切分支、push、merge 或改远端。
- 实际 Orca Worktree ID `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W01-AF138`；instance `40de0e74-5f9e-45ed-9aaf-7df2291497c4`；Orca 显示 `baseRef=refs/remotes/origin/dev`、`isMainWorktree=false`。
- Task `task_e3c1660d739f`；Dispatch `ctx_75329aca5a77`；Worker terminal `term_3b30414b-2eb7-40c4-8061-9f97b2375ac1`；正式集成依赖应引用 `task_34f986fd3442`，不能把候选 Task 当作正式已验证依赖。
- 根工作区只读查阅 `auto-ai-program-20261105/{PROGRAM,AF-138}.md`、`program.json`，以及冻结基线的三份 Markdown 与 `traceability.json`。未改历史规划、owner 记录、队列、registry、AGENTS、Schema、manifest、lockfile 或共享审计。
- 主 Agent 回复 `msg_019aa0a5cb0d` 确认：保持原三个 allowPaths；AF-138 独立测试目标、共享 fixture、DB 注册及真实 DB/HTTP/竞争验证由主 Agent 在正式集成范围处理。Worker 未扩卡、未借用旧任务 acceptance。

## 实际差异与影响

| 文件 | 候选差异 |
| --- | --- |
| `apps/api/src/plugins/aij-ai/ai-knowledge.service.ts` | 新增私有事务授权 helper；创建、编辑、问答提交统一调用。问答入队沿用 helper 返回的真实项目 ID。 |
| `scripts/verification/knowledge-lifecycle-fence.test.mjs` | 新增 38 个顶层源码回归用例，执行真实 Knowledge/WorkspaceContext/PluginRuntimeAccess/检索源码；存储、事务提交和竞争锁为合成依赖。 |
| `docs/execution/AF-138-candidate.md` | 本候选证据与供总控转写的真实集成步骤。 |

写事务在现有 ReadCommitted 边界内依次执行：运行项目/组织归属查询 → `assertEnabledInTransaction` 取得 `plugin-lifecycle:<project>:aij-ai` → 现有 `aij-client-workspace-membership:<workspace>` advisory lock → 查询并 `FOR SHARE` 锁定 member、workspace、membership、role、grant、permission → 原有写入/审计/入队。创建/导入与编辑、queued/refused 问答使用相同顺序；已有 JobService 同事务重新获取同一生命周期锁，无新增锁命名空间、Schema、队列或账本。成员管理只取 workspace 锁，ClientAuth 的成员行锁路径不获取插件/workspace 锁，当前查阅范围未发现反向锁依赖。

事务查询要求成员身份 active/未删除，membership active/未禁用/移除/删除，workspace 与同空间 role active/未删除，grant 未删除且目标 permission active/未删除。权限失败发生在文档/问答写入之前。文档创建和编辑要求 `workspace.knowledge.manage`，问答要求 `workspace.knowledge.query`。Workspace 没有 ProjectProfile 外键，仍分别使用运行项目解析和真实租户成员关系，不虚构二者关联。

API 路径、DTO、页面及返回结构沿用原实现；入口校验后失效的请求现在会在写事务返回既有 403/404/503。版本冲突与幂等逻辑保留。文档内容变更与原有审计同事务；新增审计/日志字段为零，refused 问答仍无新审计。queued 路径的模型可用性只读检查仍在事务前，真实执行未在提交入口发生。本卡只处理这些提交写事务，不声称覆盖执行器结果写回、到期清理或其他服务的所有授权问题。

## 实际运行的检查

运行时 Node `v24.21.0`、pnpm `10.0.0`；工作区独立安装，没有复制 `.env`、凭据、node_modules 或上传数据。

| 命令 | 退出码与结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 0；726 个已锁定包；manifest/lockfile 未修改。依赖安装脚本由当前 pnpm 配置忽略，未额外开启。 |
| `pnpm --filter @aij/api prisma:generate` | 0；现有 compilation-only wrapper 使用端口 1 的无凭据占位地址，不载入 env、不连接 DB；仅生成本工作区 ignored node_modules 内 Prisma Client 6.19.0。 |
| `node --test scripts/verification/knowledge-lifecycle-fence.test.mjs` | 0；38/38 顶层测试通过，0 skip/失败。包含 9 个显式锁等待时序（create/update/refused 各覆盖停用、成员暂停、撤权）；20 个状态/归属边界各验证 update/refused 两种路径；成功、queued 拒绝、幂等重放/冲突、实际并发双提交、事务内重放、两类版本冲突、审计失败回滚与同 fixture 恢复。 |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-knowledge.service.ts scripts/verification/knowledge-lifecycle-fence.test.mjs --max-warnings=0` | 0；2 个目标文件，0 warning。 |
| 下方源码别名 noEmit 类型检查 | 0；Knowledge 导入图 0 diagnostics；不生成 dist，不代替正式 API typecheck。 |
| `pnpm --filter @aij/api typecheck` | **2，未通过**；干净子工作区没有 `@aij/{contracts,core,runtime-contracts}` 的 dist 类型声明，产生 TS2307 及相关连带诊断。未为消除此失败构建全局制品；主 Agent 已确认集成时补齐构建依赖后运行正式门禁。 |
| `node --test scripts/verification/optimization-delta/offline.test.mjs` | **1，8/10 通过、2 失败**；DELTA-R2/R3 原断言期待停用后仍成功写入，现在实际事务围栏抛 NotFoundException。保留共享审计原文及失败，不把它当全绿验收。 |
| `git diff --check` | 0。 |

源码类型检查可原样重用，全部输入为本工作区源码与生成的 Prisma 类型：

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
const program = ts.createProgram([resolve('apps/api/src/plugins/aij-ai/ai-knowledge.service.ts')], options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: x => x, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
}));
console.log(`Knowledge import graph typecheck (workspace source aliases, no emit): ${diagnostics.length} diagnostics`);
process.exitCode = diagnostics.length ? 1 : 0;
JS
```

## 主 Agent 真实集成步骤（未执行）

下列步骤由总控在核验过目标保护的独立 AF-138 测试库串行执行，Worker 没有运行 DB、Docker、migrate/seed、服务、完整 build、HTTP 或真实厂商。当前没有本卡已运行访问地址。源码测试的内存锁与回滚不能证明 PostgreSQL 行锁语义或真实审计回滚成功。

### 1. 前置与真实 fixture

总控登记 AF-138 acceptance/fixture/task verifier；当前 `client-auth-fixture.mjs` 的 `clientFixtureTasks` 没有 AF-138。检查数据库配置、lease、repository、instance、测试端口与数据库名，不能改用 AF-119/AF-124 的旧 lease。补齐 workspace 包/API 构建并重跑正式类型门禁。复用 `createRemainingClientFixture('AF-138', { aiCenter: true })` 前核对当前 fixture 的账号激活、插件安装、AI 配置与离线 Provider 前置，缺任一条件明确记录失败，不能放宽保护。关闭 worker/scheduler，使用既有 `offline-knowledge` 合成 Provider；不调用厂商。

从 fixture 获取 `prisma`、`project`、`accounts[0].id`、`workspaces[0].id` 和 cookie。通过真实 POST 创建合成文档，内容包含 `aurora guide`，保存 ID、updatedAt；使用不匹配词提交 refused。服务取 `app.get(requireApi('plugins/aij-ai/ai-knowledge.service.js').AiKnowledgeService)`。API 验证与 service 竞争验证使用同一实例和真实 DB，service 直调是为了精确控制入口后时序，不替代 HTTP 权限验证。

### 2. 可直接转写的事务屏障

只在测试进程包裹 Prisma 事务，所有 SQL/写入仍执行真实事务。以下 helper 在写事务入口和实际 `FOR SHARE` 返回后提供屏障，另可在真实文档写入之后注入审计异常。不要把它写进生产服务或共享 fixture；总控可放入自己的 AF-138 集成测试。

```js
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const originalTransaction = prisma.$transaction;
const transact = originalTransaction.bind(prisma);
let armed;
function armWrite({ pauseAfterFence = false, failAudit = false } = {}) {
  assert.equal(armed, undefined);
  const probe = { entered: deferred(), proceed: deferred(), fenced: deferred(),
    finishFence: deferred(), pauseAfterFence, failAudit, pid: undefined };
  armed = probe;
  return probe;
}
prisma.$transaction = (operation, options) => {
  if (!armed || typeof operation !== 'function' || options?.isolationLevel !== 'ReadCommitted') {
    return transact(operation, options);
  }
  const probe = armed;
  armed = undefined;
  return transact(async tx => {
    [{ pid: probe.pid }] = await tx.$queryRaw`SELECT pg_backend_pid()::int AS pid`;
    probe.entered.resolve();
    await probe.proceed.promise;
    const proxied = new Proxy(tx, { get(target, key) {
      if (key === '$queryRaw') return async (...args) => {
        const result = await target.$queryRaw(...args);
        if (Array.isArray(args[0]) && args[0].join('?').includes('FOR SHARE OF u, w, m, r, g, p')) {
          probe.fenced.resolve();
          if (probe.pauseAfterFence) await probe.finishFence.promise;
        }
        return result;
      };
      if (key === 'auditLog' && probe.failAudit) return new Proxy(target.auditLog, {
        get(delegate, method) {
          if (method === 'create') return async () => { throw new Error('AF138_SYNTHETIC_AUDIT_FAILURE'); };
          return Reflect.get(delegate, method);
        }
      });
      return Reflect.get(target, key);
    } });
    return operation(proxied);
  }, options);
};
```

竞争者必须调用 `transact(...)` 使用另一条真实连接，不能被 probe 再次拦截。两连接均设置短有界超时；正式写事务默认 5 秒，屏障应在约 1 秒内释放。用 `pg_blocking_pids(probe.pid)` 观测实际阻塞 PID，禁止以固定 sleep 或“Promise 尚未返回”冒充锁证据。对 expected rejection 先挂处理器，所有 finally 都释放 `proceed/finishFence/竞争者提交屏障` 并 `Promise.allSettled` 收尾，防止未处理拒绝和悬挂事务。

### 3. 两方向真实竞争

每个用例先快照目标文档、该 workspace 的问答/审计/RuntimeJob、该项目的 AI Trace/调用记录。拒绝后比较这些业务对象：文档字段和 updatedAt、问答/审计/job/trace 数量与内容均不变；竞争者刻意更改的权限/插件表不纳入“零写”比较。

1. **停用先提交**：armWrite → 发起 updateDocument 或无证据 submitQuestion → 等 `entered`（入口检查已成功）→ 竞争事务取得 `pg_advisory_xact_lock(hashtext('plugin-lifecycle:' + project.id + ':aij-ai'))`，更新真实 installation 为 disabled 并保持事务 → 放行 `proceed` → 观察服务 PID 被竞争 PID 阻塞 → 提交竞争事务 → 服务应为 404，业务快照无变动。分别覆盖 create 作为同类正确路径对照，以及 update、refused；每次恢复插件状态。
2. **成员暂停/撤权先提交**：同样的入口屏障，竞争事务取得 `pg_advisory_xact_lock(hashtextextended('aij-client-workspace-membership:' + workspaceId, 0))`。分别将 membership 设 suspended/disabledAt，或改为不具知识权限的真实同空间角色，或将所需 grant.deletedAt 设非空；保持事务并放行服务，观察真实阻塞后提交。服务应为 403，零文档/问答/审计/job/trace 增量。恢复原始字段/角色/授权；也覆盖 member identity inactive、workspace inactive、role inactive、permission inactive 与 deleted 标记。SQL 使用模板参数，不能拼接未经校验的 ID。
3. **写事务先持锁**：`armWrite({pauseAfterFence:true})`，放行入口并等 `fenced`，此时真实授权 SQL 已取得 SHARE 行锁且还未写入。另一连接分别尝试生命周期停用、workspace 成员暂停、以及**不取得 advisory lock**的 member/role/grant/permission UPDATE；必须以 `pg_blocking_pids` 证明 UPDATE 被服务事务阻塞。放行 `finishFence`，当前授权写成功后竞争者才提交；接下来的请求拒绝。由此验证行锁实际保护授权至提交，而非只证明一次状态读取。
4. **项目/归属**：入口后将当前项目或其 organization 状态停用，再进入正式写事务，要求 503 且零业务写入；用外国 workspace/member ID 和同空间不匹配文档 ID 分别验证 403/404。不要给 Workspace 人工增加 ProjectProfile 关系。

### 4. 成功、幂等、版本与审计回滚

- 恢复所有授权后，真实 HTTP PATCH 改标题/正文/状态，各生成一条原有脱敏审计，updatedAt 前进；响应仍为原 DTO。通过 POST 创建/导入文档验证共享 helper；检查内容没有进入审计摘要。跨空间/匿名/无权限 HTTP 路径按原 401/403/404，不能只跑服务直调。
- 无证据 POST/submitQuestion 得到 refused + INSUFFICIENT_EVIDENCE，数据库新增恰好一个 question，runtimeJobId=null，无 job/provider/trace 增量。相同 key/query 重放返回同一 ID、idempotentReplay=true；同 key 不同 query 为 409。两条独立并发 service 调用同 key 仍只有一行；撤权后重放也应拒绝入口访问。
- 有证据路径使用已配置的离线 Provider，仅排队并保持 worker disabled。question 与恰好一个 RuntimeJob 同事务保存，scopeId=实际 project.id、workspaceId=当前空间。入口后撤权不得产生 question 或 job。并发同 key 至多一 job，provider 实际执行数为零。
- 使用旧 expectedUpdatedAt PATCH 为 409 且无审计；两个独立更新提交相同版本，仅一个成功、另一个 409，核对最终内容与一条审计。需要先读/后写交错时在测试 proxy 的 `aiKnowledgeDocument.findFirst` 返回后设置第二屏障，不改生产实现。
- `armWrite({failAudit:true})` 对 create/update 调用，放行入口后让真实文档写入执行，再在 `auditLog.create` 注入异常；服务为 503，重新从另一连接读取文档、updatedAt 和审计，与基线完全一致（create 为零新文档）。随后关闭注入、再次写入成功，证明回滚与锁释放；该故障注入验证真实 DB 回滚，不能以全 mock 替代。问答原路径没有审计，不伪造额外审计要求。

### 5. 清理与正式出口

finally 恢复 `prisma.$transaction = originalTransaction`、插件安装状态、member/workspace/role/permission 状态、membership role/status/disabledAt/removedAt/deletedAt、grant.deletedAt；关闭应用/连接，按现有 acceptance 管理执行**本次 AF-138 lease**的清理，不能 reset、drop 非该 lease 的库或删除其他任务凭据。保存聚合断言/退出码、真实 blocker PID 证据、库目标安全摘要和 HTTP 状态，不输出秘密/客户数据。

总控需把 AF-126 DELTA-R2/R3 的当前回归断言纳入自身正式集成范围，并保留历史报告“成功复现缺陷”的原始记录。正式 `verify:task`、适用门禁、执行记录/队列更新和原标题正式卡提交均由总控执行；本候选提交不替代它们。

## Writer 交接

没有实施数据库、厂商、页面或服务启动，未运行的真实集成矩阵和正式 API typecheck/verify 如上保留。候选仅包含三个 allowPaths；无共享文件或其他 Writer 差异。有效工程时间未超过本卡 3 小时预算；按派工交回候选，下一步依赖正式集成 Task 的真实验证。

**停止全部写入，交回主Agent集成。** Writer 在候选精确本地提交及 worker_done 后不继续修改，只有新派工才能恢复写入。
