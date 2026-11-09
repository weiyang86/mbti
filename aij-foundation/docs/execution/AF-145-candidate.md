# AF-145 - 支持按原请求标识安全查回AI任务

状态：候选交付，STOPPED_HANDOFF；不是正式 CODE_VERIFIED，也不是负责人接收。Writer 在本卡候选提交后停止全部写入，候选 SHA 由 worker_done 回执提供；总控可用本文件的单次候选提交核对 SHA。未执行 merge、push、远端 Issue/PR、部署或发布。

## 基线与权限

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W03-AF145`，instance `dbc526a5-07e7-41c4-8c00-6981a01eec64`，Orca 确认 `isMainWorktree=false`、baseRef=`refs/remotes/origin/dev`。
- Task：`task_13a862777c2f`；Dispatch：`ctx_f4b1c3076a1e`；Writer terminal：`term_f1f7b5f4-e8ef-4a34-a502-32c955bd4c14`；coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支：`weiyang86/AIJ-W03-AF145`；起始 HEAD：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`；起始 status 干净；origin fetch/push 都是 `git@github.com:weiyang86/aij-foundation.git`。写入前复查结果一致。
- 无 source bootstrap、无继承差异。原 run service SHA256：`437808387305059bde47fd17bf3dcd63ff5c4647856431affe18dd782ac45a80`；原 controller：`f853bab7bebb7eda59101a227e0a182cbe14ea88b93abcefeb2d417d7ddbc828`。
- 新规格只读来源：root `docs/planning/ai-platform-baseline-20261105/{REQUIREMENTS_BASELINE,DELIVERY_AND_ACCEPTANCE}.md` 与 `docs/planning/auto-ai-program-20261105/{PROGRAM,WAVE-03,AF-145}.md`；AF-145 spec SHA256：`4173456ad884cc75970da524779e167e36046dae8f553d5092059aa9f8c6f848`。当前连续授权覆盖历史规划停点，历史 owner 状态保留。

## 实际差异与行为

本卡仅修改允许的六个文件：

| 路径 | 差异 |
| --- | --- |
| `apps/api/src/plugins/aij-ai/ai-center-run.service.ts` | 增加类型化 metadata projection 和 `recoverRequest`，按当前 project + workspace + member + 原 key 的复合唯一键读取；只 select 六个返回字段与内部 purge marker。 |
| `apps/api/src/plugins/aij-ai/ai-center-client.controller.ts` | 增加 `GET /api/client/ai/run-requests/:key`，现有 WorkspaceContextGuard + `workspace.ai.read`，`Cache-Control: private, no-store`。 |
| `packages/sdk/src/ai-run-recovery.ts` | 实际可复用 `createAiRunRecoveryClient(api).recoverRequest(workspaceId, key)` 与只读 metadata 类型；只发 GET，编码 key，透传错误，绝不重试或 POST。 |
| `scripts/verification/ai-run-recovery.test.mjs` | 加载实际 TypeScript Service、Controller、客户端 Guard、Workspace resolver、插件 gate 与 SDK，验证成功、拒绝、隔离、窄字段、无执行依赖。 |
| `scripts/verification/ai-run-recovery-live.test.mjs` | 准备 root-only Cookie/HTTP/PostgreSQL 验收；Worker 只语法检查和 lint。 |
| `docs/execution/AF-145-candidate.md` | 本次记录与停写交接。 |

响应严格只有 `id, agentCode, status, budgetStatus, createdAt, expiresAt, contentAvailable`。日期在 HTTP 中为 ISO 字符串；不存在/跨作用域统一 404；原 submit 语法之外的 key 为 400。`contentAvailable` 表示内容仍在保留期且未清理，不代表任务已完成或必定有输出；过期和已清理仍返回 metadata，标记 false。unknown/reserved 和 running/dead-job 的存储状态均保持原样；没有 retry/refund 授权字段。

接口重复校验 active member、active Workspace/Membership/Role 和当前 aiRead、启用的 aij-ai；仅 aiRead 即可访问。关闭执行入口、缺失/删除 Agent、模型、凭据和 catalog 均不阻止读取既有引用。新方法完全不调用原 `read`/`reconcile`/`submit`、配置目录、provider、budget mutation 或 Job enqueue。

数据：无 Schema、migration、新表或新账本，Worker 无 DB/Docker/seed/migrate；查询不写 Run/Job/预算/Trace。现有认证可能更新会话 lastSeenAt，现有插件 gate 使用事务级 advisory lock，均为复用现有授权机制。权限：新增受 aiRead 保护的入口，不增加权限代码或默认授权。页面：无 UI 改动，AF142 接入留下一卡。日志：没有新业务日志，不记录 key/input/output/credential；错误继续使用现有安全异常边界。没有在本工作区启动 API/Web，没有可访问的运行地址，厂商/付款/通知均未调用。

## Worker 验证

开始：2026-11-05 01:52 UTC；停写准备约 02:03 UTC；约 0.2h，远低于 2.25h Worker 上限。根验证仍须在本卡 3h 总预算内完成，建议预留原定 0.75h；无法完成时保留候选并拆卡，不隐去失败。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | exit 0，独立本工作区安装，锁文件未改。 |
| `pnpm --filter @aij/api prisma:generate` | exit 0，仓库编译专用脚本，隔离环境 + 127.0.0.1:1，无 DB 连接。 |
| `pnpm --filter @aij/contracts build` / `pnpm --filter @aij/runtime-contracts build` / `pnpm --filter @aij/core build` | 各 exit 0，仅轻量共享包编译，供实际源码加载和类型检查，产物忽略。 |
| `node --test scripts/verification/ai-run-recovery.test.mjs` | exit 0；39 Node test nodes = 10 顶层 + 29 子测，35 leaf；fail/cancel/skip/todo 均为 0。最终实现重复验证通过。 |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-center-run.service.ts apps/api/src/plugins/aij-ai/ai-center-client.controller.ts scripts/verification/ai-run-recovery.test.mjs scripts/verification/ai-run-recovery-live.test.mjs packages/sdk/src/ai-run-recovery.ts --max-warnings=0` | exit 0。 |
| `pnpm --filter @aij/api typecheck` | exit 0；`tsc --noEmit` 与 test tsconfig noEmit，未重型 build。 |
| `pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --lib ES2022,DOM packages/sdk/src/ai-run-recovery.ts` | exit 0。 |
| `node --check scripts/verification/ai-run-recovery-live.test.mjs` / `git diff --check` | 各 exit 0。 |

实现/验证失败：无。初始文件探索有缺失路径/未匹配 zsh glob，已按实际目录纠正，不属于功能测试通过证据。源码测试使用替身数据依赖执行实际实现，不是 HTTP/DB/浏览器证据。

NOT_RUN：正式 `verify:task AF-145`、live HTTP/DB、API/Web 重型构建、浏览器、厂商、部署。正式注册/共享文件/DB 仅总控允许写入或运行，故不把候选提交称作正式卡片通过。SDK 的共享 index 在 Worker 范围之外，尚未导出；消费包验收也留总控。

## Root 集成请求与验收

1. 收到 Writer 明确停写和候选 SHA 后，只接收上述六个路径；无 bootstrap 需要排除。保留 root 其他已完成卡和用户差异。
2. 在现有五个精确 protected allowlist 文件中注册 AF-145：`scripts/database/migration.mjs`（createAcceptance）、`scripts/runtime-environment.cjs`（acceptanceRecord）、`scripts/database/seed.mjs`、`scripts/verification/auth-support.mjs`（该文件内全部适用 task 检查）、`scripts/verification/client-auth-fixture.mjs`。不删除或放宽已有 target/schema/ownership 检查，不借用旧卡 lease。
3. root 在共享 SDK index 导出 `createAiRunRecoveryClient` 和类型。**当前 `scripts/build-workspace-package.mjs` 只 transpile index.ts，且只复制 index 声明；简单 re-export 不会输出新模块，CJS/ESM 将找不到它。** root 需在其共享构建范围补齐实际模块编译/打包及类型输出，再验证打包后的 CJS/ESM 消费；不要复制一份实现进 index。模块的类型 import 使用 `./index.js`，已通过 NodeNext noEmit。
4. 用 root-owned exact-runner adapter 设置 `process.env.AIJ_AF145_LIVE='1'`，再 `await import('./ai-run-recovery-live.test.mjs')`；正式 runner 会净化外部 env，不能靠命令外层 env 绕过。只允许 root 主工作区 `dev`，脚本同时核对固定 root、cwd/realpath、git-dir 等于 git-common-dir，且 opt-in 必须为 1。Worker 禁止执行 live；目标保护和 API 编译由 root 串行运行。
5. live 脚本创建新的随机 AF145 protected lease，执行审定迁移及合成基础用户 fixture；启动临时 loopback API:0，真实 Cookie 登录并创建两个 Workspace；直接写已有 Run/Job/预算引用。没有厂商配置或密钥，没有 paid/vendor 调用。提供 queued/running/succeeded/failed/unknown、expired/purged、跨 member/workspace/project 原 key 碰撞、匿名/invalid Cookie/key、撤权/停用与 SDK HTTP 场景。
6. live 对查回前后的完整 Run/Job/预算 Run/预算 Reservation/Trace 集合记录行数和 SHA256，要求完全相同；执行配置读取/provider/budget reserve/settle/enqueue 装 trap，调用次数须 0。预置 dead Job + running Run 保持 running/reserved；unknown/reserved 不能改作 refund 或重发。最终恢复 hooks，删除本次合成执行/预算引用，关闭 app/Prisma 并以新 AF145 lease 核验 aij-api pools0；证据只输出安全摘要到 `.artifacts/auto-ai-program-20261105/AF-145/live-*.json`。
7. root 注册正式 verify:task，完成真实成功/拒绝路径、适用 API 构建和 SDK 消费门禁，更新正式执行记录/队列、按原名正式提交。根验收如果失败，交回原 Writer 修复，不把本 source PASS 当成 live PASS。owner 仍 PENDING。

人工可复现步骤（root 运行后）：以原 Workspace 的有效 Cookie + `x-aij-workspace-id` 请求 `GET /api/client/ai/run-requests/<原key>`；核对只含七个字段；切成员/空间或用其他项目 key 得统一 404；无 Cookie 401、无 aiRead 403、非法 key 400；关闭执行开关仍能查回；过期标 false、unknown/reserved 保持原状态。比较查前后 Run/Job/预算/Trace 数量与状态，均不得改变。

下游依赖：AF142 UI 接入必须依赖总控本卡真实 I-* 集成 Task，而非本候选 Task；本卡未修改 UI、未宣称 lost-response 浏览器体验已经完成。SDK 多模块打包和 root live 验证是集成必需项；除此无已知实现阻塞。
