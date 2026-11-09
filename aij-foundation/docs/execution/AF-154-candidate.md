# AF-154 候选交接：提供用户私有Skill与不可变历史版本接口

状态：**CANDIDATE_ONLY / ROOT_GATES_PENDING / NOT CODE_VERIFIED**。本文记录同一 Writer 自查，不是独立 Review、负责人验收或正式接收。Worker 完成本候选本地提交后 **STOP ALL WRITING**；不修改正式队列、registry、生产 schema 或根 dev，不 push/merge/PR。

## 派工和干净起点（任何文件写入前已回读）

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W05-AF154`。
- 实际 Worktree instance：`4235438a-829b-47b3-9c01-7de9fddbca7c`，Orca child of 根工作区。
- Task：`task_9afa245801a8`；Dispatch：`ctx_ec2a01a49135`。
- Worker terminal：`term_e16c8895-44c5-482b-9eed-f5cf3a4a6ba1`；coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- branch：`weiyang86/AIJ-W05-AF154`；初始 status：clean。
- 初始 HEAD 与 origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- remote fetch/push：`git@github.com:weiyang86/aij-foundation.git`；没有 fetch 后篡改起点，没有远端写入。
- 原始证据：本工作区忽略目录 `.artifacts/af154/baseline.json`；独立 frozen install，无共享 node_modules/env/credentials/uploads/symlink，无其他 Writer。

## 已隔离的来源 bootstrap

单独提交：`76d4504f65eaf69ea36c5eaa59321a200ad47a6e`，标题 `chore: bootstrap AF-154 integrated source dependencies`。四个 blob 均从派工指定 commit 经 git show 取得，写入前 SHA256 精确核验；bootstrap 外的原工作区与轻企仓库均未修改。总控**只集成 bootstrap 后的候选提交**，不要重带已集成的来源变更。

| 路径 | 来源 commit / 集成 Task | 已验证 SHA256 |
| --- | --- | --- |
| apps/api/src/client-workspaces/workspace-context.service.ts | fd3b420e95bd6f0577ae1b297ee2c619d5a048f4 / task_34f986fd3442 | 8acb86c7108fbc7adead9528515f8dc3ebc4e9884785b9b1c6b0ed2861844467 |
| packages/sdk/src/index.ts | 06928768a0e0b1529ad6d9c5bc10fa4e0c15f938 / task_634f404155e8 | e466bc1bc33dedfcb57d0a1fce48933071a6e972e480142e2d77da24dbbd0cfa |
| packages/sdk/src/ai-run-recovery.ts | 同上 | 50442f5852da685ed5d353bc8186590cf006adda617e69948620fe4458216b2c |
| scripts/build-workspace-package.mjs | 同上 | 5dde66fd6520f6cc06af91ee064163fac3accef3fa50cd17f8890d463da1f1c0 |

候选 commit 标题逐字为 `提供用户私有Skill与不可变历史版本接口`，紧跟上述 bootstrap；最终完整 SHA 由 worker_done 回读交付。SDK index 的候选 diff 只追加 personal-skills export，保留 recovery 导出。其余三个 bootstrap 文件在恢复后只读。

## 实际 diff 与产品影响

仅13个 allowPaths：3个新 DTO/service/controller，既有 ai-runtime.module 与 workspace-permissions，小型 SDK personal-skills 与 index，单个新 SQL migration，2份测试脚本，API说明，schema fragment，本执行记录。

- API：六个 `/api/client/ai/skills` 路由：list/create/get/PATCH/DELETE/versions；真实 Nest 装配，不使用 mock owner/store。
- 数据库：只编写 `20261105010000_ai_personal_skills/migration.sql`，新增两表/外键/索引/范围约束与版本不可变 trigger、当前 identity/tombstone trigger，并追加权限 catalog 和 active system OWNER grants；Worker 未连接/创建数据库、未 migrate/seed/Docker。
- 生产 `schema.prisma` **未修改**。Root 在明确停止后，按 `AF-154-schema.prisma` 加两模型及 MemberUser/ClientWorkspace 两处 backrelations；SQL-only check/trigger 要纳入 parity 审查。
- 权限：新 exact `workspace.ai.assets.read/manage`；既有权限完全保留，OWNER 与默认 MEMBER 行为沿现有 provisioning owner。私有 ownership 始终以认证成员和服务端 workspace context 再验证，不允许同空间其他 OWNER 越权。
- 同一事务：生命周期重新核实与锁 → shared membership fence/行锁 → scoped asset quota/code/CAS → 当前行、追加 snapshot、脱敏 audit，审计错误全部回滚；没有 nested tx、unsafe SQL、模型调用或费用/执行账本。
- 编辑/删除：code 固定作创建幂等键，重放比较 revision1 的精确内容；内容 no-op 不写，陈旧 CAS409。删除不提升内容 revision、不加快照，重复删除稳定，快照保存但不可通过已删除 current 读取，不允许 code 复活。
- 页面：无新增页面/菜单；没有启动访问地址。SDK 使用实际 ClientApi headers/cookie/no-store；不保留 tenant/auth secrets。
- 日志：审计只含 IDs/revision/action/字段名，使用既有 member actor 约定，无 name/instructions/body/credentials；没有修改全局日志 owner。

## 已运行检查（Worker）

证据位于本工作区 `.artifacts/af154/`，不是正式验收产物。

| 检查 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS，独立工作区安装，manifest/lock 未变（install.log） |
| `node scripts/prisma-schema.mjs generate` | PASS，仅基线 schema 的 no-DB client generate，固定 port1，不生成新模型依赖 |
| `node --test scripts/verification/personal-skills.test.mjs` | PASS，11 tests / 11 pass / 0 fail / 0 skipped；执行实际 DTO/service/controller/shared fence/SDK源码，替身仅用于离线 SQL 结果控制（pure-tests.log） |
| targeted ESLint：3个新 API文件、module/permissions、SDK两文件、2个测试脚本 | PASS，0 warnings（lint.log） |
| `pnpm exec tsc -p .artifacts/af154/tsconfig.json --noEmit` | PASS，目标API及真实依赖源码，paths 只读映射现有 contracts/core/runtime-contracts，避免缺失 dist（targeted-typecheck.log） |
| `pnpm exec tsc -p .artifacts/af154/sdk-tsconfig.json --noEmit` | PASS，SDK source及真实contracts source，strict NodeNext（sdk-source-typecheck.log） |
| Prisma validate，基线schema + 本卡fragment/backrelations 的忽略目录临时副本 | PASS，schema valid，无DB连接；真实生产schema未改（schema-validate.log） |
| `node --check scripts/verification/personal-skills-live.test.mjs` | PASS，仅语法；**没有运行 live** |
| `git diff --check` | PASS |
| `pnpm --filter @aij/api exec tsc --noEmit` | FAIL，缺少 contracts/core/runtime-contracts 的 dist，伴随下游类型级联错误；未构建或改动其他包来隐藏（typecheck.log） |
| `pnpm --filter @aij/sdk build` | FAIL，缺少 @aij/contracts dist/type declarations；编译 SDK 的根 gate 待Root执行（sdk-build.log） |

首次临时 schema 验证调用使用了错误的 hoisted Prisma 路径而报 MODULE_NOT_FOUND，改为真实 root node_modules/prisma 路径后成功；没有改动源代码来掩盖该调用错误。标准类型检查/SDK构建的失败仍然保留，未将 source-only noEmit 冒充 package build 成功。

## Root 必须执行的剩余门禁

1. 接收本 Writer 明确 STOP ALL WRITING 与 candidate SHA，只 cherry-pick 候选 diff；核对来源依赖真实集成 Task（上表），根端串行集成，禁止拿 worker Task 当 CODE_VERIFIED。
2. 注册 AF-154 verify/DB任务并应用 schema fragment。审查生成迁移 parity，特别是 varchar、composite FK、索引/唯一键与 SQL-only immutability triggers/checks；实际 Prisma generate、fresh migrate/status 由Root独占。
3. 构建原有依赖包、SDK和API；检查实际编译的 SDK ESM/CJS 及 TypeScript声明消费。不允许用本卡 source-only检查替代这些 gate。
4. `AIJ_AF154_ROOT_LIVE=1 node --test scripts/verification/personal-skills-live.test.mjs`：新鲜 AF-154 lease，真实 Cookie/API、两个OWNER/两个空间+默认MEMBER、重放/异内容409/CAS单胜/版本/配额/删除，状态/Origin/foreign ID/伪造字段拒绝，public全表哈希（仅排除 session lastSeen/updatedAt auth记账列）、真实 PG shared fence 阻塞撤权、audit SQL trigger 故障回滚、实际编译SDK transport。Worker状态：**NOT_RUN**。
5. 运行注册 `verify:task` 与其他适用质量门禁，完成正式记录/队列/集成Task和原名提交/推送回读SHA，再最终代码+PR Review与OWNER_CHECK_PENDING；这些均由Root负责，Worker未越权操作。

真实 live 文件含门控，不带 root flag 会 skip；skip 不算验收通过。人工验收与完整HTTP语义见 `docs/development/PERSONAL_SKILLS_API.md`。没有未获授权的应用服务/外部网络调用、重型 API/Web build、DB/支付/通知/文件/供应商动作。

## 未实现、风险和交接

不提供个人 Agent 绑定、公有/市场/共享资产、脚本执行/沙箱、附件、完整 retention/restore、浏览器UI。SQL migration、真正 PG 并发及代码包消费者尚未验收；Root live 脚本是待执行代码，不能称为已通过。当前事务 fence 为 workspace级+member级串行，小型限额适用，但不宣称经过吞吐性能评估。

本 Writer 不创建下游卡或继续其他工作；候选本地提交只表示可review交付。本文及最终 worker_done 声明：**STOP ALL WRITING / STOPPED**，Root 可以在收到该最终交接后独占集成与 schema 写入。预算：本 Worker约1小时，预留Root至少1.25小时，未接近4小时合计上限；后续范围若超预算须拆卡，不能跳过真验收。
