# AF-167 在私有Agent执行中应用显式授权记忆 — Worker 候选

状态：CANDIDATE_ONLY / ROOT_INTEGRATION_AND_LIVE_NOT_RUN / OWNER_CHECK_PENDING。候选不是 CODE_VERIFIED；自查不冒充独立复核、正式集成或负责人验收。

## 身份与基线

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W08-AF167`，instance `f44ec315-fe1d-4ba9-9b37-e0071785789b`。
- Task `task_254517e4068c` / Dispatch `ctx_f299d46f34ab` / terminal `term_f4c3154b-1780-4fd4-942f-825d53542ea7`；总控 terminal `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支 `weiyang86/AIJ-W08-AF167`，起始 HEAD 与干净 origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；origin fetch/push 为 `git@github.com:weiyang86/aij-foundation.git`。Worker 全程不 fetch/push 或移动 origin/dev。
- 单独 bootstrap 提交 `8b1551c37854846a1d2634063b422ecfae75c9ef`，21 个授权 source blobs 来自 `589d587ba1bd9da782fc6d35245430bfe147c4a3`，写入前逐个核对 prompt 中 SHA-256。源文件 provenance 与集成 Task 对照遵循派工清单；此提交不是这些源能力已集成的证明，不应作为本卡候选 delta 重复集成。
- 每次写阶段前核验 Task/Worktree/branch/HEAD/remotes/status，记录于本工作区 ignored `.artifacts/af-167/{bootstrap,implementation-phase,qa-phase,documentation-phase}.json`；收尾 commit 阶段另存本地记录。既有/用户差异起始为 0；未碰主 dev/轻企/正式 queue/registry/module/Schema/SDK index。

## 实际差异

1. 新增 dedicated memory context service：actual TX 内显式 owner/grant 选取、稳定 query9/最多8、AF163 文本校验、原 refs 重验、Memory/grant/Agent 锁序与 AF163 advisory fence，内容只在 RAM。
2. Run admission 在 base Agent resolver 前选取、在 reserve/enqueue 前合并编译，只保存 opaque memoryId/revision refs；原 key replay 先返回不重选。两次 dispatch 检查均先 Job/Run 后 Memory/grants 再 Agent，credential IO 后再次读取原 refs；保留全部 nonce/lease/attempt/terminal/budget fencing。
3. compileAgent/provider invoke 接受内部可选 ephemeral user context，无记忆默认保持原消息；catalog/image 不接受非空记忆。原 pure snapshot resolver 仅增加可选 memoryRefs 的 type/import，没有 memory selection 行为。
4. 新增 16 个 actual-source/offline fake 测试与 root-only fresh live 验收脚本；旧 private run fixture 仅显式注入 empty memory resolver，保留已知无记忆用例。新增开发契约说明。

所有 bootstrap 后差异仅在 allowPaths 的 9 个文件：4 个 API source、2 个 memory test、1 个 legacy fixture test、2 个文档。无新 Schema/migration/依赖/权限/API flags/SDK contract/UI 路由。

## 实际验证与失败

本地 Node `v24.21.0`，本工作区独立 frozen pnpm 安装；不共享/复制 node_modules、env、上传、数据或真实凭据。

| 命令 | 结果 | 本地证据 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | exit 0，下载缓存复用，独立安装 | `.artifacts/af-167/install.log` |
| `pnpm --filter @aij/api prisma:generate` | exit 0，仅编译；脚本移除 env/凭据并指向 loopback port 1，不连接 DB | `generate.log` |
| `node scripts/build-workspace-package.mjs packages/{contracts,runtime-contracts,core}`（逐一执行） | 各 exit 0，小型公共包构建 | `contracts-build.log` / `runtime-contracts-build.log` / `core-build.log` |
| `node --test scripts/verification/personal-agent-memory.test.mjs` | exit 0，16/16，0 fail/skip/todo | `source-tests-final.log` |
| `pnpm exec tsc -p apps/api/tsconfig.json --noEmit` | exit 0，实际 API source 无 emit；未运行 API build | `api-noemit-final.log` |
| 对 4 个改动 API source 与 3 个 test 的 `pnpm exec eslint … --max-warnings=0` | exit 0 | `lint-final.log` |
| `node --check scripts/verification/personal-agent-memory-live.test.mjs` | exit 0，仅语法检查，未执行 | 收尾 checks 记录 |
| `git diff --check` | exit 0 | 收尾 checks 记录 |

保留失败：最早 legacy test 依次因尚未 generate 的 Prisma client、未构建的 runtime-contracts 退出非零；完成独立 generate/public builds 后，legacy test 仍因 bootstrap 未包含 `ai-personal-agent-runs.service.ts`（及 controller）报 MODULE_NOT_FOUND。未恢复未授权源文件或降级该 gate；完整 legacy test 在当前 Worker 工作区 **未通过，需总控集成后重跑**。证据 `legacy-before.log`、`legacy-after-generate.log`、`legacy-source-tests.log`。

新增离线测试首轮 7/14，通过数偏低源于 fake 把含 grant 子查询的 Memory selection 误派成 grant 查询；修正后 13/14，剩余为锁序测试同类 query 识别错误；修正测试后 14/14，再增 transport 后删除与 credential barrier 丢 lease 用例，最终 16/16。首次定向 lint 报 compileAgent unused，增加空 context 字节兼容断言后通过。保留 `source-tests.log`、`source-tests-fixed.log`、`source-tests-pass.log` 与 `lint.log`，没有改生产 gate、放宽限制或伪造 PG 成功。

## 影响、未运行与总控交接

数据库：没有连接、创建、迁移、seed、Docker 操作或数据写入；实际 Schema 只作只读编译源。未来只增加既有表 SELECT/锁及 Run.snapshot 的 refs；预算和 Trace 使用原 owner。接口/页面/SDK/权限码不变；新 admission 要求真实 memory resolver DI，启用记忆会影响上下文/预算预检和原授权撤销后的执行。日志无新增 logger，Trace 仍为 coarse input/output shape，Job/resultReference 仅原 Run ID/status。

Worker **NOT_RUN**：注册 `verify:task -- AF-167`、实际 API/JobService/PG/Trace/budget、loopback HTTP、credential-read barrier、PG 并发锁/死锁观察、全表 plaintext/删除、实际 compiled/packed SDK consumer、浏览器、API/Web heavy build、原 AF161 完整 regression、AF163 live 和负责人验收。没有运行中的页面/API/上游地址，也没有付费模型/BYOK/fallback/通知/支付请求。

总控 STOPPED 接收后需：精确集成 bootstrap 后候选 delta；在正式 module import/providers 接入 `AiPersonalAgentMemoryContextService`；为 AF-167 注册自己正式 lease/fixture/runner；在主 dev 独占 DB/heavybuild 运行开发契约中的 fresh live 与原 gates；根据实际结果修复或交回 Writer；更新正式执行/队列，按原名正式提交及授权推送回读后才能完成 I-*。无 schema/index/global manifest 变更请求。候选 parent 是 bootstrap，不代表可重复集成整个 bootstrap。

工时：Worker 连续活动约 0.5 小时以内（bootstrap 2026-11-05 10:34:50 UTC 至收尾，阶段 UTC 见 ignored 记录；这是估计有效工程时间，非精确计费）；小于 2.25h Worker 上限，给 root 留足至少 1.75h 的派工预算。最终本地 candidate SHA 由交接回读提供；文档不自引用其尚未产生的 hash。

**交接：完成精确候选本地提交与回读后 STOP ALL WRITING；不自动继续下一卡。** Worker_done 提供真实候选 SHA、允许路径、最终 checks、NOT_RUN 和预算。候选已完成交付范围，正式集成/真实验收与 owner review 仍待总控和负责人。
