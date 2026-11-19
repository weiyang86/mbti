# AF-157 候选交接：修复手工重试后的任务租约身份冲突

状态：`CANDIDATE_READY_ROOT_VALIDATION_PENDING`，不是 CODE_VERIFIED、独立 Review 或负责人接收。Sole Writer 为本 Dispatch；本卡结束后明确 STOP ALL WRITING，由总控串行精确集成。无 Trea 等待。

## 身份、授权与来源

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W06-AF157`，instance `4aad89b8-8686-4156-b8ed-414be7d2fae9`，Orca workspaceStatus `in-progress`。
- Task `task_b02791c489dc`；Dispatch `ctx_7a48699169e4`；Worker terminal `term_8ca02995-125b-479e-886c-64d6374df67c`；Coordinator `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 开始 clean；分支 `weiyang86/AIJ-W06-AF157`，HEAD 和 origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。origin fetch/push 均 `git@github.com:weiyang86/aij-foundation.git`。完整只读基线在 `.artifacts/af-157/baseline.json`。
- 按派工恢复 a0b18bfa6a9bd091332cdff0135edcee0aedda85 的两个精确 blob，SHA256 分别为 worker `40cf966db25d347a36213f6c41015b617a5ec40d3973518b24e3e4b511d8fc1c`、reentry test `92c685b27e526f2d14bd06a1bb8597476447cbad96d653de02b775561c70ba64`；依赖集成 Task `task_cd3c87021b71`。单独 bootstrap 提交 `d174e85d7c70b8100c800e816d029ce1fcae5e0f`。reentry test 此后只读；最终候选只含 bootstrap 后的本卡 delta，总控不要重放 bootstrap。
- 只读核对根 checkpoint `.artifacts/auto-ai-program-20261105/AF-155/held-before-core-fix/checkpoint.json`、其中 notification source/真实验收脚本和 `.artifacts/verification/AF-155/run-5XVqFB/report.json`。checkpoint 明确同 worker+attempt 碰撞，没有重复外部投递；没有还原/修改 AF-155 文件，没有访问轻企源码或数据库。

## 实际差异与影响

候选 9 个文件：JobService 增加领取 nonce、四项身份 SQL admission/ORM fence、callback 和 processing admission reference、退出清除；registry 回调类型增加兼容可选 leaseNonce；RuntimeAdminService retry/cancel 清除内部 nonce；一条 additive SQL；精确 Schema 字段提案；纯测试与根专用 live 测试；租约说明和本交接文档。生产 schema.prisma、全局 manifests/lock/registry/队列/AGENTS、AiRuntimeModule、SDK index 均未改。

数据库影响只有待总控执行的 `ALTER TABLE runtime_job ADD COLUMN lease_nonce UUID`，旧行 NULL，无额外 ledger/index/default。API/页面/权限无新增；显式管理 select 不暴露 nonce；已有重试状态限制、attempt 上限和外部错误策略保持。没有新增敏感日志字段。没有运行地址：Worker 未启动 API/Web/DB/Docker，不提供虚构访问入口。

## 已执行的无数据库检查

- `pnpm install --frozen-lockfile` exit 0，726 packages，6.8s；依赖生命周期脚本按既有配置未自动执行。独立 node_modules，无凭据/环境/上传复制、无跨工作区共享目录/符号链接。
- 临时 `.artifacts/af-157/schema.prisma` 从本工作区生产 Schema 的只读内容加且仅加字段，并设置生成输出到本工作区 node_modules/.prisma/client；Prisma 6.19.0 generate exit 0，真实 client/generator realpath 均在本 Worktree。环境过滤并使用 port 1 的假编译 URL，无 dotenv/连接。生产 Schema 未改。日志 `.artifacts/af-157/generate.log`。
- `pnpm --filter @aij/runtime-contracts build`、`pnpm --filter @aij/contracts build`、`pnpm --filter @aij/core build` 各 exit 0；只构建小包。
- 最终 `node --test scripts/verification/job-lease-nonce.test.mjs scripts/verification/runtime-worker-reentry.test.mjs` exit 0：31/31（AF-157 18 + AF-137 13），0 fail/cancel/skip/todo；覆盖 nonce SQL 参数/新鲜度、缺失/非法拒绝、transactional/orchestrated 全身份写入、callback、同 claim admission、手工 retry 同 worker+attempt1 新 nonce 到达 handler、旧成功/失败、plugin defer、completed replay、安全 projection 和 migration 字段形状。
- `pnpm run lint` exit 0；`pnpm --filter @aij/api typecheck` exit 0（两个 API/test tsconfig noEmit，使用本地临时 client，不是正式 Schema 验收）；live `node --check` exit 0；`git diff --check` exit 0。最终命令/退出码在 `.artifacts/af-157/verification.json` 和同名日志。
- 早期失败保留：`.artifacts/af-157/pure-first.log` 为纯测试加载器漏列 node:crypto，AF-157 文件未加载而 AF-137 13/13 通过；第二轮实际 29/31，两个断言错按 orchestrated 仅一次 heartbeat 计数，已修正为真实两次 admission/续租、并保留全部身份断言后重跑通过。不是产品通过证据，不隐藏失败。

## NOT_RUN 与总控接续

1. **生产 Schema、数据库、迁移、Seed、API/Web build、真实 HTTP/PG 和 `verify:task -- AF-157` 全部 NOT_RUN Worker**。总控收到停止写入交接后只应用候选 delta，将提案字段加到实际 RuntimeJob，登记保护白名单：runtime-environment、database/migration、database/seed、verification/auth-support（含其多处 task allowlist），以及正式 verification registry/队列/执行记录。Worker 未自行放宽它们。
2. 总控使用已核验的独立 test 目标串行创建 AF-157 新合成库，执行迁移/generate/API build 和适用 lint/typecheck；在根 dev 以 `AIJ_AF157_ROOT_LIVE=true node --test scripts/verification/job-lease-nonce-live.test.mjs` 或等效注册门禁执行实际两 PG session 用例。文件包含真实 JobService/RuntimeIdempotency/handler、同 worker 字符串、同 attempt1 的新旧 nonce、旧回调拒绝/heartbeat 无延长、同 claim 并发1次、default transactional1次/过期恢复、真实 aij-ai lifecycle/project gate 和关闭自身连接后的连接0证据。仅控制合成 lease expiry，不改 completed、不动 provider fence；正常路径写 `.artifacts/af-157/integration/<acceptanceId>/job-lease-nonce-live.json`。当前这些断言仅已编写/语法检查，未声称通过。
3. 原 `runtime-worker.test.mjs`、`runtime-retry.test.mjs`、`ai-runtime-fencing.test.mjs` 均未改/未运行；均从真实 claim 获取身份，无需伪造 nonce。总控在新 Schema 下运行原回归和 AF-137。AF-155 checkpoint 必须单独原样恢复/复跑 EXACT same-worker unknown 案例；terminal sealing 用新 callback nonce，禁止用换 worker、重置 fence 或更改默认重试策略规避问题。
4. 人工验收：由总控给出真实新库报告后，检查同 worker retry 后 handler 再次到达且终态正确；旧身份拒绝无新副作用，管理列表不含 nonce，独立 session 关闭为 0。当前无常驻服务或人工账号由 Worker 创建。
5. 根正式门禁/记录/队列/原名提交及回读完成后才可结束 I-*；本地候选提交不代表正式验证/验收，不 push/merge/PR/tag/发布。外部 provider 的永久 dispatch fence 与 unknown 策略仍属原 owner，本卡不承诺 exactly-once。

候选提交标题逐字为 `修复手工重试后的任务租约身份冲突`，精确 SHA 由提交后 `.artifacts/af-157/handoff.json` 与最终 Orca worker_done 回读报告给出；本文件不自引用未来 commit SHA。Worker 预算不超过 3h、总卡含总控 4h；本次无等待占用数据库/重型构建资源，有效工程时间与起止时间以最终 handoff 记录为准，保留至少 1h 给总控。最终 Writer 状态：**STOP ALL WRITING**。
