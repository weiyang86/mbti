# AF-159 候选执行记录

任务原名：提供用户私有Agent与Skill版本绑定接口。状态：SOURCE_CANDIDATE / NOT_CODE_VERIFIED；总控接收与 OWNER_CHECK_PENDING 由总控管理，不由本子工作区写正式队列。自查不是独立复核或负责人验收。

登记：

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W06-AF159`，Orca instance `ccd3baf2-7301-4780-8bd5-3d7679e208a3`，status `in-progress`。
- Task：`task_a0d5881aa60e`；Dispatch：`ctx_150196a68bfc`；Writer terminal：`term_6092e434-45aa-482e-be80-08be3618e0a4`。
- 起始 branch：`weiyang86/AIJ-W06-AF159`；HEAD / origin/dev：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`，开始 status 干净。
- remote fetch/push：`git@github.com:weiyang86/aij-foundation.git`。未 push、未改分支、未写主工作区。
- 基线读数与 SHA256 位于忽略的 `.artifacts/AF-159/baseline.json`；写入阶段均复检 status/branch/HEAD/remotes。

来源 bootstrap 已按指定 git show 原始 blob 恢复并独立提交 `57b9c39936955fcaf1a1b33970d7573b375cb032`，来源 `a0b18bfa6a9bd091332cdff0135edcee0aedda85`：

| 路径 | SHA256 | 真实集成 Task |
| --- | --- | --- |
| workspace-context.service.ts | `8acb86c7108fbc7adead9528515f8dc3ebc4e9884785b9b1c6b0ed2861844467` | `task_34f986fd3442` |
| client-workspace-permissions.ts | `a690442b2754bf6eb6629cca008ef025331d630aeb07cd8ebb2f32058968ca00` | `task_623c04531bae` |
| packages/sdk/src/personal-skills.ts | `099f9e79ac8bb8994a36adb6fc7810d2f4278531e221a521d29be99c75066b9e` | `task_623c04531bae` |

以上 bootstrap 之后保持只读，候选 delta 不含这三份源码。总控只接收本卡候选提交，不能 cherry-pick/replay bootstrap 到 dev。

实际实现差异：

- 新 DTO / service / controller：`/client/ai/personal-agents` CRUD、版本分页和安全 model-options；完整配置 allowlist、同源、已验证本人上下文、aiAssets权限、事务活动复核、配额/重放/CAS/no-op/墓碑、ID/revision/action关联审计。
- 新 SQL migration：三张 aij-ai 私有资产表，7个 RESTRICT 外键、scope复合约束、字段/有序槽位检查、当前身份与墓碑保护、不可变版本/绑定，提交完整性约束阻止事后添加绑定；仅给既有 SkillVersion 增加一个复合唯一索引，未改 AF-154 原迁移。
- schema proposal：完整三模型及现有 MemberUser/ClientWorkspace/SkillVersion 回关系与唯一键的精确说明。真实 schema.prisma 未改。
- 新 SDK 窄工厂，复用实际 ClientApi，无独立 transport。新10组离线源码测试及总控专用真实 live 测试脚本，API指南。

影响：数据库仅提交 SQL 与提案，未连接数据库；API尚未接线或启动；无页面改动；权限复用已有 aiAssets.read/manage 不新增权限或授予；审计原子写入既有 AuditLog，红线不记录 prompt/名称/provider内容；未增加执行/Job/Trace/budget账本、模型调用、发布或业务目录写入。

验证（Worker）：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS，独立 node_modules，无锁文件变化 |
| `pnpm --filter @aij/api prisma:generate` | PASS，现有基线 schema 编译，无DB/环境文件加载 |
| `pnpm --filter @aij/contracts build` / `@aij/runtime-contracts build` / `@aij/core build` | PASS，小包类型前置 |
| `pnpm --filter @aij/api typecheck` | PASS（两个 tsc --noEmit） |
| `pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --lib ES2022,DOM packages/sdk/src/personal-agents.ts` | PASS，未接线模块单独类型检查 |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-agents*.ts packages/sdk/src/personal-agents.ts scripts/verification/personal-agents*.mjs --max-warnings=0` | PASS |
| `node --test scripts/verification/personal-agents.test.mjs` | PASS，10/10，无 skip；假 SQL 回包仅离线证据 |
| `node --check scripts/verification/personal-agents-live.test.mjs` | PASS，仅语法 |
| `DATABASE_URL=postgresql://compile_only:compile_only@127.0.0.1:1/compile_only pnpm --filter @aij/api exec prisma validate --schema ../../.artifacts/AF-159/schema.prisma` | PASS，仅无DB验证 scratch 提案合成schema；未覆盖生产schema |
| `git diff --check` | PASS |

前序失败与修复如实保留：首次类型检查因小包尚未构建出现模块缺失，构建前置后通过；SDK离线 mock 的响应遗漏现有契约必需 message，补齐后10/10；首次 lint 发现测试 unused变量，已修复；首次 scratch validate 缺少 DATABASE_URL，改用上述不可连接的合成 URL 后通过。所有日志仅保存在本人的 `.artifacts/AF-159/`。

NOT_RUN：`verify:task AF-159`（本分支不注册正式任务）、真实 PostgreSQL/live、迁移deploy/status、Seed、应用启动、API/Web重型构建、已导出 SDK ESM/CJS消费者矩阵和真实 pools0。live 脚本只做语法检查，未称真实数据库/HTTP/约束成功。Worker未复制 env/凭据/上传/依赖目录；无外部通信、AI上游、Docker或发布操作。

总控接收后独占步骤：

1. 仅集成候选 delta；保留 AF-154 已集成实现。依赖引用上述 I-* Task，不能引用本候选 Task 代替正式CODE_VERIFIED。
2. `apps/api/src/plugins/aij-ai/ai-runtime.module.ts` 新增 import `AiPersonalAgentsController` / `PersonalAgentNoStoreGuard` from `./ai-personal-agents.controller` 与 `AiPersonalAgentsService` from `./ai-personal-agents.service`；将 Controller 加入 `controllers`，将 Service 和 NoStoreGuard 加入 `providers`。AiCenterConfigurationService、ClientWorkspacesModule、PluginRuntimeAccessModule 已有，可直接复用。该文件 Worker 未改。
3. `packages/sdk/src/index.ts` 加 `export * from "./personal-agents.js";`，沿用总控当前的多模块 ESM/CJS构建方案；Worker 未改共享 index 或构建器。必须实际验证编译产物能导入工厂与全部类型、旧SDK消费者兼容。
4. 按 `AF-159-schema.prisma` 精确增加三模型、回关系与 SkillVersion 唯一键。`skillBindingCount` 为内部快照完整性字段，SQL/提案须一致。生成客户端，校验真实迁移与schema parity；保留所有SQL-only CHECK/trigger，不修改旧迁移。
5. 由总控注册 AF-159 verify:task、fresh acceptance/环境/Seed fixture allowlist；live 使用 `clientEnvironment` 与新 lease，因此需要与 AF-154 相同的正式注册面，不能借用旧任务名。串行执行 `AIJ_AF159_ROOT_LIVE=1 node --test scripts/verification/personal-agents-live.test.mjs`，再适用正式质量门禁/消费者矩阵。
6. live 设计覆盖真实 Cookie、生命周期、目录、本人Skill/version、安全投影、并发创建/CAS/100配额、旧pin、跨owner/空间/版本拒绝、角色/plugin/model/provider/Skill墓碑拒绝、实际SQL审计故障回滚、成员权限PG阻塞证据、SQL不可变与scope FK、SDK ESM/CJS、无上游/Job/Trace、关闭 pools0。它未被Worker执行，发现问题交回本Writer修复，不能把脚本存在视为验证成功。
7. 完成根执行记录与队列、精确标题正式本地提交、按已授权批次流程推送与回读，之后才结束 I-*。人工验收按 API 指南，当前无运行地址可交付。

边界与下一卡：私有运行/工作台/知识/工具/脚本/分享/发布、完整修剪/恢复均 FUTURE。当前Skill只有deletedAt活动条件，没有独立enabled字段；不可制造不存在的“Skill disabled”列。历史pin不等于未来执行授权。总控集成及真实门禁尚待完成；无其他Writer与本卡并写。

Writer交接：本卡候选提交后 STOP ALL WRITING；候选确切 SHA 通过最后 worker_done 回执交付（文档不自引用提交SHA）。除非总控发出新派工或返修，不继续本卡或下一卡。
