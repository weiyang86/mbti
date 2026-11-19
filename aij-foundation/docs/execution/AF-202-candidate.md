# AF-202 候选交付：实现个人文档导出附件API与公共SDK

状态 CANDIDATE_READY / OWNER_CHECK_PENDING；不是 CODE_VERIFIED。Writer 独立完成自查，不冒充独立复核。实际 candidate SHA 由提交后的 Orca worker_done 消息报告（避免自引用提交）。

## 身份与来源

- Task `task_cde578d66bd5`；Dispatch `ctx_601123bbf763`；terminal `term_ccca9e4a-3b6b-44ee-9487-80f16e06c1c0`。
- 已注册 top-level Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W17-AF202`；instance `88b6130f-9bab-4b07-86c3-f9a2611f2a1d`；parent null；branch `weiyang86/AIJ-W17-AF202`。
- 初始 clean；HEAD=origin/dev=`94b0236f775fa40a07944c5e0545ac6ce0e123f3`；fetch/push remote `git@github.com:weiyang86/aij-foundation.git`。
- 唯一源码来源 `15358325d7e6d0a90e6c55fe124c2c7ad13eb46e`。只读 main-root CONTRACT/SOURCE_BOOTSTRAP.json，manifest sha256 `2563c88d9844ff6a2c1c275567cd07252445fef01ef02e26a546156f5561392e`。
- 867 个文件逐一 git show、sha256 验证后写入自己的干净 worktree；source-only bootstrap `eb89016a3aba49a1418aee4012d30f41137d5396`，标题 `W17 verified source-only bootstrap`；仅候选相对 bootstrap delta 交 root，禁止集成 bootstrap。未读其他 Worker 活跃实现。

## 实际差异与影响

10 个 allowPaths：documents 下 DTO/service/controller/profile 四新文件、原 PersonalDocumentsService 窄内部事务入口；SDK personal-document-exports/client-binary-response 两新文件；小测试；ROOT_WIRING；本记录。

新增 API 私有 capability/create/list/get/content，独立 read+export 权限、同源修改校验、精确输入、元数据白名单、安全文件名与 response-close 取消。真实原 Executor 调用在两短事务之间；事务二重验当前权限、生命周期、未删及 revision；FileAsset+immutable revision 关系+无正文审计同事务。并发 loser 复用并清理 stage，未知 commit 精确 id/asset 读回，unknown DB 不盲删。原文档 CRUD/history、文件 owner、Job/Run/Trace 均不迁移或替换。

SDK 没有第二套 fetch：新 helper 由原 transport 接入，读取有界真实 stream，核对长度/headers/expected identity/hash；无 POST 重试；失败清零。默认关闭；没有 UI 改动，没有启动访问地址，没有真实外部账号或密钥。

## 已执行命令与结果

- baseline `git status --short --branch` / `rev-parse HEAD origin/dev` / `remote -v`、`orca worktree current --json`：成功；首个误用 `orca context` exit 1，已用受支持 current 替代，无状态修改。
- manifest Python SHA256 + 867 次 `git show source:path` + 精确路径 add/bootstrap commit：exit 0。
- `pnpm install --frozen-lockfile`：exit 0，独立 node_modules，800 packages；依赖 lifecycle scripts 默认 ignored，未更改全局依赖策略。
- `pnpm --filter @aij/api exec prisma generate --config prisma.config.mjs`：exit 0，schema-only，无 env/连接/迁移。
- `pnpm --filter @aij/contracts build`：exit 0，仅小包，供 SDK strict imports。
- `node --test scripts/verification/personal-document-exports.test.mjs`：最终 exit 0，15/15；真实 candidate TS/DTO/controller、实际默认 Executor DISABLED、实际 PersonalDocumentsService 窄入口、SDK WebCrypto/stream/ESM/CJS + strict types、定向 API strict program 均通过。
- 测试修复前两次 runner 失败：ts-node 对 SDK `.js`→`.ts` resolution 缺失，experimentalResolver 在当前 Node 不兼容；已改为测试临时目录真实 TS transpile 的 ESM/CJS 两模块，清理临时文件。没有运行伪造 renderer/host Python。
- 定向 API 初次编译发现 DTO format widening（TS2322），补 `as const` 后最终测试内 strict program 零 diagnostics；无豁免。
- Orca 初次 baseline report 误用 type message 拒绝，改为 type status 成功 `msg_fd765d27509e`。
- `git diff --check`：exit 0；最终 staged diff 也检查后提交。以上曾失败均已修复，不隐藏为第一次即通过。

小协作者事务测试涵盖两事务之外渲染、顺序复用、并发 one artifact/file/audit、变版/撤权/删除、audit rollback、提交响应丢失恢复、unknown DB stage 保留、旧revision当前权限下载。stream 测试覆盖真实 ReadableStream 超限/短流/缺长度/abort cancel；下载错误清零与无额外 POST。它们不是 PostgreSQL/Docker/HTTP 接线验收。

## NOT_RUN 与 root 依赖

NOT_RUN：正式 `verify:task AF-202`、真实 PG/API/HTTP/CSRF、真实 Docker/Linux render、安装实包公共 index、全 API/Next build、真实页面/浏览器/OS保存。按指派由 root 独占，不能以小测试替代。外部状态 DEFERRED_NOT_PASSED；完整40/AF191原生14未动。

共享 schema/SQL/permission/config/module/SDKindex/原fetch/guarded wrapper/registry/queue/state 全未修改；精确接线与真实门禁清单见 `docs/planning/auto-ai-program-20261105/W17/AF-202-ROOT_WIRING.md`。新 relation API 在 root 完成迁移与 DI 前不声称可运行；真实 I201→I202→I203 串行，候选非下游依赖完成。

人工验收：默认 off 时 capability 待配置；可信测试配置启用后保存文档并显式导出两格式，列举/下载核对字节；两请求并发只一持久结果；渲染中更新/撤权/停用拒绝；删除文档旧附件404；历史 revision仍需当前权限；错误无正文/宿主路径/私有meta，private/no-store/nosniff。

有效工程时间约 0.18 小时（约 11 分钟，含核对/实现/测试/记录），低于 Worker 2h；无 DB/build/GUI共享锁占用。提交后明确 STOP ALL WRITING，Writer relinquished，随后只发一次 worker_done 交总控；不 push、不运行后续卡。

## P3 回访修复（2026-11-07，原 Writer 再次交还）

本次 Task `task_f9856c43b38b` / Dispatch `ctx_8f53ea62c85b`；工作区/terminal/branch/remote 不变。起始 clean HEAD `c39c7a5915e6390db9f57ea528ec6a93dd6eef0e`，867 文件 bootstrap `eb89016a3aba49a1418aee4012d30f41137d5396` 未变；只阅读自己候选/基线，没有读取 live AF201/root 源码。协调方已交接只读 Sol review STOP，本次为原 Writer 的定向修复，不将自查当独立 review。

修复：把 executor 返回 artifact 的 outcome/cleanup/cancel 拒绝移到受 finally 保护的范围内；finally 只对返回的实际 Buffer 清零（可选 artifact 无 Buffer 时不操作）。随机 id 生成移到 executor 调用前，不在已持有 artifact 时发生 finally 外的工作。stage/persisted 文件字节由原文件 owner 管理，不触碰。未知提交精确恢复、实际 profile projectId、SDK stream/hash/deadline/单次 POST 行为保持不变。

新增 3 项确定性测试：held original Buffer + 实际 AbortController 在 run resolve 前 abort，断言 503/无 stage、file、relation、audit 且原 Buffer 全零；失败 outcome/cleanup 未确认的 artifact 同样清零；成功后原 RAM 清零而持久化副本字节仍完整。原 15 项保留。ROOT_WIRING 明确要求 trusted configured origin 的 credentialed CORS 精确暴露 Content-Disposition、X-Content-Type-Options 及五个 X-AIJ-* 头，并要求真实跨端口浏览器+安装实包 SDK 验证；未修改 shared bootstrap/CORS 本身。

实际检查：

- `node --test scripts/verification/personal-document-exports.test.mjs` 最终 exit 0，18/18（含定向 API strict TS、SDK strict TS、ESM/CJS、真实 ReadableStream/WebCrypto）；无测试豁免。
- 首次定向 ESLint exit 1：旧 controller 测试局部 `signal` 赋值未使用；移除该无用变量后，对全部 8 个候选代码/测试文件运行 `pnpm exec eslint ... --max-warnings=0` exit 0，零 warning。
- `git diff --check` 与最终 staged diff check exit 0；候选仅追加修改 service/test/ROOT_WIRING/本记录 4 文件，相对 bootstrap 累计仍为原 10 个 allowPaths。按原任务标题追加本地候选提交，不 amend bootstrap、不 push；实际新 SHA 见本次 worker_done。
- NOT_RUN：正式 verify:task、真实 PG/API/HTTP/Docker/Linux/完整 build/Next/浏览器/安装实包 CORS。按派工由 root 串行验证；协调方告知 AF201 实际 PG 场景通过不等于本 Worker 正式验收，也未推断 I201 已完成。外部 DEFERRED_NOT_PASSED；账号/密钥/数据保持私有，未访问。

本次有效工程时间约 0.07h（4 分钟），累计 Worker 约 0.25h，低于本次 15 分钟和累计 2h 上限。无数据库/重构建/GUI 锁使用。提交并确认 clean WT 后 STOP ALL WRITING，Writer relinquished；由 root 接收新 STOP 后再集成 AF202，候选仍不是 CODE_VERIFIED。

## Session fence 回访（原 Writer，四路径限定）

Task `task_a0efe9839bff` / Dispatch `ctx_e95b65e9cf2d`，起始 clean HEAD `b461a2ca79e406ce77fba35bd5208a898da4b9f6`；branch `weiyang86/AIJ-W17-AF202`、原 Worktree/terminal 和 `git@github.com:weiyang86/aij-foundation.git` remote 已复核不变。仅修改 service/test/ROOT_WIRING/本记录，没有读写 root/shared auth/Controller/module/registry 或 AF201 活跃源码。

`create` 新第五参数是可选可信内部 authorize(tx)；在 initial snapshot、final commit、unknown readback 三个原事务回调首行调用，早于任何 tuple 复用或 metadata 恢复，无 nested auth transaction，无 client DTO/SDK 变化。root Controller 必须始终提供原 ClientAuthService.assertSessionInTransaction(tx, req.clientClaims) 闭包；可选仅兼容内部调用。初始 401 不渲染；第二事务 gate 401 不提交 file/relation/audit；恢复 gate 401 不释放已提交 metadata，且不被普通 unknown/cleanup 错误覆盖。文件清理由原 AF201 discard 判断提交状态，已提交/未知字节不删除；原 artifact RAM 在 finally 清零。

验证命令与结果：

- `node --test scripts/verification/personal-document-exports.test.mjs` 最终 exit 0，23/23（原18项保留、新增5项）。新测试实际调用 Service 并断言 gate 收到当前协作者 tx 且 active=1：初始401无render；render中session撤销/stage中tokenVersion变化；unknown commit正常恢复再次验证；unknown commit后撤销返回401且保留已提交字节；cleanup状态未知也保留原401和stage、只清零executor RAM。包含定向 API/SDK strict TS 零诊断、ESM/CJS/stream/hash/原未知提交回归。
- `pnpm exec eslint apps/api/src/documents/personal-document-exports.service.ts scripts/verification/personal-document-exports.test.mjs --max-warnings=0` 最终 exit 0。初次发现 no-ex-assign（重赋 catch 参数），已改用局部 failure 变量，未豁免规则；本次无测试失败。
- `git diff --check`、staged diff check exit 0；四文件精确 stage 后按原标题追加提交。bootstrap 867文件未动，累计相对 `eb89016a3aba49a1418aee4012d30f41137d5396` 仍只原10个 allowPaths。新 SHA 由本次 worker_done 报告。

NOT_RUN：真实登录/session/tokenVersion PG竞争、API/HTTP/Docker/packed SDK/浏览器/完整build/正式verify:task；均由 root 接线后验收。总控报告此前十场景通过不是本次 gate 的实际 PG证据；本 Worker 测试只有事务协作者，不冒充真实认证库。没有启动访问地址，没有访问数据或真实密钥；外部 DEFERRED_NOT_PASSED。

本次有效工程时间约 0.08h（5分钟），累计 Worker 约 0.33h，低于本次15分钟/累计2h上限；未使用DB/Docker/重构建/GUI。提交并核实 clean WT 后 STOP ALL WRITING，Writer relinquished；候选不是 CODE_VERIFIED，由 root 等待本 STOP 后精确集成及 Controller 接线。
