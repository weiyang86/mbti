# AF-142 原卡验收准备补充候选

本轮交付状态：**ROOT_HTTP_NOT_RUN / OWNER_CHECK_PENDING**。新增的是实际 HTTP/DB 验收准备代码，不能把语法检查或原有纯测试称为它已通过。

后续产品 F1/F2 审核修订见 [AF-142-review-fix-candidate](AF-142-review-fix-candidate.md)；本文件的 helper 未在该修订中改动或运行，不能作为产品通过依据。

## 派工、路径与预算

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W02-AF142`，instance `8b422a98-8b7e-49fe-b82c-9ef9ede94d46`。
- Task `task_5410ffea25b6`；Dispatch `ctx_cf6463bb57cd`；terminal `term_ef1bbaa3-70e3-430c-b158-c13cd96177ec`。
- 开工分支 `weiyang86/AIJ-W02-AF142`，HEAD `1641e63682ecf3b8b2953c80153a80e28f7e3749`，工作区干净；remote fetch/push 都是 `git@github.com:weiyang86/aij-foundation.git`，未切分支或 push。
- 仅新增 `scripts/verification/client-ai-workbench-live.mjs`、`scripts/verification/client-ai-workbench-live.test.mjs`、本文；原候选报告只加一行补充指向。产品源码和原纯测试本轮保持只读，根工作区无写入。
- 工时估计：契约/隔离核对约 0.15h，组合器与测试编写约 0.40h，自查/允许验证/报告与提交约 0.15h，补充合计约 **0.70h**；加原估计 0.8h 为 1.5h，原卡预算剩余约 2h 供总控验证，若预计不足应保留成果拆卡。

## 组合与安全边界

`prepareClientAiWorkbenchLive({ browserOrigin })` 只在显式 `AIJ_AF142_ROOT_ACCEPTANCE=true` 且当前仓库是 Git 主工作区时运行；同一进程最多一个活动组合器。每次通过现有 `createAcceptance("test", "AF-142")` 新建随机受保护 lease，不接收外部 lease、不冒用 AF-123 等旧卡、不 reset/drop。

组合现有 `migrate deploy/status`、`prepareClientFixture`、`clientEnvironment`、ClientAuth/Workspace HTTP、`prepareAiCenter`、实际 JobService。没有新造认证、AgentRun、预算或队列实现。没有直接调用 `createRemainingClientFixture(storageEnabled:true)`，因为其默认目录共享；本 helper 组合相同原语，在启动前指定：

```text
.local-data/af142/<本次lease id>/aij-foundation/test/storage
```

此路径有 lease 唯一前缀和要求的 `aij-foundation/test/storage` 后缀；检查 Git 忽略、仓库内路径、无符号链接和私有目录权限，不 chmod 共享目录或借用其他上传目录。证据目录已有父目录可保留原权限；新文件使用 0600，内容仅白名单状态、计数、目标 ID 和文件引用。

客户端账号与管理员密码只从原 helper 创建的忽略凭据文件读取；Cookie/Token 留在 fixture 进程内，返回接口给出文件引用，不在证据或错误里输出凭据、响应 payload、驱动错误。Nest 日志在 fixture 存活期间禁用并于 close 还原；创建期间临时设置 `abortOnError:false/logger:false` 以让启动失败进入清理，随即恢复原 NestFactory.create 属性。产品 bootstrap 未改。

实际 AI catalog 通过现有管理员 HTTP 接口保存。复用 `ai-center-fixture` 的模型与 SecretRef，但完全替换 Agent/Skill 内容：`general-text`、`general-json`、`general-image`，统一唯一输入 `goal`；不保存 MBTI 目录或行业指令。

仅此 fixture 进程显式设置 `AI_CENTER_CLIENT_EXECUTION_ENABLED/AI_CENTER_LIVE_ENABLED=true`，使用 `prepareAiCenter` 生成的 synthetic env key。先安装测试进程 transport 重定向，再开启开关；产品默认配置和真实用户未改。只允许原协议的两个精确地址，在唯一 transport 实例重定向至本次 `127.0.0.1:0` OS 分配端口；其他地址/路径或非 error redirect 策略在 fetch 前拒绝。合成服务只返回固定文本、schema JSON、有效小 PNG，或受控上游503。API、认证、Workspace、配置、Run、预算、JobService 均为真实实现，不 stub 整个 API。

`ASYNC_RUNTIME_ENABLED=false`，不运行自动 worker/scheduler timer。`pumpJobs(limit=10)` 显式、串行调用 JobService.claim/execute，仅允许本次项目的 `aij-ai.agent-execute` job；拒绝并发 pump。另一个合成成员拥有自己的空间，并只在主空间获新的合成 read-only 角色；同一主成员另有第二空间，其他成员看不到它。所有资源来自新 lease，不为真实用户扩权。

## 返回值及 root 操作

返回 `app/baseUrl/browserOrigin`、最小 lease `{id,database,ownershipFile}`、`references`（受保护 lease/客户端与管理员凭据文件引用）、`workspaceIds`（primary/second/other）、`memberIds`、`evidenceFile`，以及：

- `request(method,path,{actor:"owner"|"other"|null,workspaceId,body,status,origin})`：实际 HTTP，默认 owner，null 表示无 Cookie；错误只含 AF142 安全代码/状态码。
- `image({runId,workspaceId,actor})`：实际鉴权图片 GET，返回状态/contentType/bytes，禁止把 bytes 或响应正文写日志。
- `pumpJobs(limit)`：实际执行现有任务，无自动轮询；返回执行的 job IDs。
- `setMode("success"|"upstream-error")`：切换本次合成上游；第二种产生真实 attempted 后 unknown，不假装 failed/免费。
- `setExecutionEnabled(boolean)`：只控制此 fixture 进程客户端执行开关，便于验证503。
- `verifyTransportFence()`：向重定向器提交一个不允许路径，验证 fetch 前拒绝，不发出该请求。
- `saveHttpEvidence(checkCodes,runIds)`：仅接收大写白名单检查码/任务ID；正式测试全部组通过后使用。
- `close()`：停止新提交，等待活动 pump，清理本 lease 的 AI 图片、关闭 app/合成 server、恢复原 transport 属性/Logger/env，删除本 lease 独占 storage root，以独立保护连接检查该 DB 除检查器外连接为零，再释放检查器。保留随机 acceptance DB、受保护凭据和证据供审计，不删除/重置数据库；失败写 CLEANUP_FAILED 且抛安全错误，不冒充零池。重复已完成 close 可安全返回。

**root 必须先补共享注册**：本分支基线尚不认识 AF-142，涉及 `scripts/database/migration.mjs` 的 createAcceptance、`scripts/runtime-environment.cjs` 的 acceptanceRecord、`scripts/database/seed.mjs` 的 Seed allowlist、`scripts/verification/client-auth-fixture.mjs` 的 clientFixtureTasks、`scripts/verification/auth-support.mjs` 的 authKeys/authEnvironment 多处名单。它们本轮不在 Worker 允许范围；由 root 独占补齐并完成正式 registry/verify:task 注册。还需 root 准备当前源码对应的包/API dist/Prisma 产物和已经核验的隔离 PostgreSQL，不能复用别的 AF lease 掩盖注册缺口。

root 实际 HTTP 命令（DB/重型构建并发各1；Worker **未执行**）：

```sh
AIJ_AF142_ROOT_ACCEPTANCE=true node --test scripts/verification/client-ai-workbench-live.test.mjs
```

root 如需保持 API 供真实 Web/browser，可在主工作区的专用 Node REPL 依次操作，先确认计划 Web 的未占用 loopback 端口；示例 browser origin 为41783，调用结果用 void 避免 REPL 打印 app/env：

```js
process.env.AIJ_AF142_ROOT_ACCEPTANCE = "true";
var prepare = (await import("./scripts/verification/client-ai-workbench-live.mjs")).prepareClientAiWorkbenchLive;
var fixture;
void (fixture = await prepare({ browserOrigin: "http://127.0.0.1:41783" }));
// fixture.baseUrl 是实际随机 API URL；root 用它配置自己的 Web 进程。
// 凭据从 fixture.references.clientCredentialsFile 读取，勿打印内容。
// 浏览器提交后，在持有 fixture 的 REPL 显式执行：
await fixture.pumpJobs();
// unknown 场景：先 setMode("upstream-error")，提交，再 pumpJobs；之后改回 success。
// root 关闭自己启动的 Web/browser 后，必须显式释放 API：
await fixture.close();
```

root 不应打印完整 fixture、app、Response、登录对象或 process.env。API/合成服务只有在上述 prepare 真正完成后才可称已运行；本报告没有创建任何地址。

## HTTP 测试计划与证据

新 Node suite 有一个顶层测试、七个顺序 HTTP 子组，全部走真实实现：

1. 客户会话、Workspace context、同一成员的两个空间、另一成员不可见第二空间。
2. 三个 goal Agent 的列表、401、Origin403、输入400、缺Agent404、fixture执行关闭503、transport 非允许路径拒绝。
3. POST202、并发同键同 Run、异参数409、JobService 真执行、文本成功/预算 settled、原键重放不重复执行。
4. 同成员错空间404、另一成员 read-only 角色 execute403、读其他成员原任务404、无成员空间403。
5. JSON Agent 实际 schema 输出，经 HTTP 读取。
6. 图片 FileAsset、鉴权 PNG 字节、错空间/其他成员404/403。
7. 上游503后的真实 unknown/reserved/UPSTREAM_RESULT_UNCERTAIN、原键重放不重新执行，显式新键恢复成功。

脚本自身的证据位于 root 的 `.artifacts/auto-ai-program-20261105/AF-142/`：`fixture-<lease>.json`、所有 HTTP 组通过后才写 `http-<lease>.json`、关闭时 `closed-<lease>.json`。前两类文件引用原受保护凭据，不含值；关闭文件记录连接计数和失败清理阶段。迁移/Seed 原 helper 的既有保护操作证据仍保留其原目录，本 helper 没有改写它们或复制 driver 日志。

## 本轮实际验证与限制

| 实际命令 | 退出 | 结果 |
| --- | --- | --- |
| `node --check scripts/verification/client-ai-workbench-live.mjs` | 0 | 仅语法检查 |
| `node --check scripts/verification/client-ai-workbench-live.test.mjs` | 0 | 仅语法检查，未执行顶层或HTTP子测试 |
| `pnpm exec eslint scripts/verification/client-ai-workbench-live.mjs scripts/verification/client-ai-workbench-live.test.mjs --max-warnings=0` | 0 | 目标 lint |
| `node --test scripts/verification/client-ai-workbench.test.mjs` | 0 | 原有纯状态/SDK测试 28/28，不是新HTTP套件通过 |
| `git diff --cached --check`（提交前） | 0 | 本轮允许差异检查 |

Worker 没运行 Node live suite、DB连接/创建/迁移、seed、服务、Docker、build 或浏览器；没有获得 pool=0、实际HTTP结果、API已运行或浏览器通过证据。当前没有已执行检查失败；新 helper 的运行正确性、root 当前集成后的 API dist 兼容性及 cleanup/pool 证明仍待 root 实测，不能预填通过。

未覆盖真实厂商、费用/通知、图片坏数据/重定向/缺usage、保留期清理、管理员重试崩溃恢复等 AF-123 原 suite 场景，本卡不把它们算作新验收。运行中发现产品源码问题先交原 Writer/协调者，不在本补充并写原产品组件、状态模块或后端。正式注册和执行失败不能降级为旧 lease 或 stub API。

## 精确集成与停止写入

原始起点 `94b0236f775fa40a07944c5e0545ac6ce0e123f3` 到最终候选为恰好十个路径：原七文件、上述两个新脚本和本文；本轮提交只有三新增和原报告的一行指向。可按原提交 `1641e63682ecf3b8b2953c80153a80e28f7e3749` 加本轮提交串行集成，或从最终 SHA 精确提取十路径；不得覆盖 root 其他卡文件。最终 SHA 见交接消息/`git log -1`。

候选标题沿用 **提供个人用户通用AI任务工作台**，正文标注 AF-142 root-only 验收准备；未改正式队列/registry、无 merge/push/PR/main/tag/部署。**候选提交完成后，本 Writer 停止本卡全部代码、测试和文档写入，再发送本次 Dispatch 的 worker_done。** 正式验收与负责人接收继续由 root/负责人完成，下游仅引用真实 I-* 集成 Task。
