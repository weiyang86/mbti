# AF-163 候选交付：提供个人长期记忆与Agent授权接口

状态：候选实现和离线校验完成；不是 CODE_VERIFIED，不是负责人接收。总控串行集成/正式 verify:task/真实 DB+HTTP+packed SDK 门禁均待执行。Worker 只完成本卡，未续跑其他卡，未 push。

## Writer 与写入阶段

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W07-AF163`；instance `fdb37b3a-0ed8-4c3d-86e7-659825b09160`，`orca worktree current --json` 实际回读。
- Task `task_372c9f0819a5`；Dispatch `ctx_50f2a733452e`；terminal `term_91e0eccf-1634-4030-83fe-808d96595dc4`；coordinator `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- branch `weiyang86/AIJ-W07-AF163`；初始 HEAD 与 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，初始 `git status --short --branch` 无差异。
- remote fetch/push 都是 `git@github.com:weiyang86/aij-foundation.git`。没有改 remote；远端跟踪 `origin/dev` 保持上述 SHA。
- bootstrap 独立提交 `c045c239a750fbeead83a3efa41b2af535908294`（2026-11-05 15:53:55 +08:00）。候选提交只包含下方10个本卡新文件；请以最终 worker_done 的实际 SHA 回读候选。
- 所有实现、SQL/Schema、SDK、离线/live脚本、修复、文档和提交前均在终端回读 status/branch/HEAD/origin/remotes。各写入阶段 HEAD 一直是 bootstrap SHA、branch/remote/Task/Dispatch/terminal/Worktree 未变，status 从 clean 仅增加本卡 allowPaths 未跟踪文件；没有继承修改或 Writer 冲突。
- 主要实现/校验窗口为 2026-11-05 15:53–16:15 +08:00 附近，Worker 约0.4有效小时，包含本卡校验和自查；总卡4h封顶，保留总控至少1.5h。无 helper/subagent。

## 独立 bootstrap 来源证据

十个文件均由 `git show 16cfeabbd248a9faff0efd77ad946b033d18e526:path` 获取，写入前核验如下 SHA256，并单独提交；随后只读。

| 文件 | SHA256 | 已批准集成 Task |
| --- | --- | --- |
| packages/contracts/src/index.ts | d6c18befc81d6bc7c011365d011afc7b20e97f6c9915925779f73a24ffdce4b6 | task_bb2bf1841ea9 |
| packages/sdk/src/index.ts | 774089be5e90cecebfa1ef0084878ef19d407e77492a073e3e744408f598b01f | task_8225f38866ac |
| packages/sdk/src/personal-skills.ts | 099f9e79ac8bb8994a36adb6fc7810d2f4278531e221a521d29be99c75066b9e | task_623c04531bae |
| packages/sdk/src/personal-agents.ts | 2554f86f4e074955d1d754a287662de1d2e812fd06899905719f11546b7f1ed1 | task_8225f38866ac |
| packages/sdk/src/ai-run-recovery.ts | 50442f5852da685ed5d353bc8186590cf006adda617e69948620fe4458216b2c | task_634f404155e8 |
| scripts/build-workspace-package.mjs | 5dde66fd6520f6cc06af91ee064163fac3accef3fa50cd17f8890d463da1f1c0 | task_634f404155e8 |
| apps/api/src/client-workspaces/workspace-context.service.ts | 8acb86c7108fbc7adead9528515f8dc3ebc4e9884785b9b1c6b0ed2861844467 | task_34f986fd3442 |
| apps/api/src/client-workspaces/client-workspace-permissions.ts | a690442b2754bf6eb6629cca008ef025331d630aeb07cd8ebb2f32058968ca00 | task_623c04531bae |
| apps/api/prisma/schema.prisma | dc55532e13c913e0fe2c2a191ef4d59948a7023f47ba473995da79c36a967b2f | task_8225f38866ac |
| apps/api/src/plugins/aij-ai/ai-personal-agents.dto.ts | 7dd8f38e4a1a32a0c49a4b4d6cd2b6cb19f599bb04e87b5c3a5f6c32c9ecd781 | task_8225f38866ac |

这是同仓库来源编译 bootstrap，不能当作这些依赖已经正式集成；总控应仅接收候选delta，不能重复覆盖已集成入口/Schema。未复制环境、数据、凭据、依赖目录。独立 frozen pnpm 安装生成的本工作区 node_modules 和编译产物均 ignored；无跨工作区 node_modules/上传目录共享或 symlink。

## 实际 diff（本卡10文件）

1. `apps/api/src/plugins/aij-ai/ai-personal-memories.dto.ts`：严格白名单、三种类型、4000 UTF16/16KiB正文、100标题、boolean opt-in、最多16个唯一规范排序的Agent ID、CAS、bounded cursor。
2. `apps/api/src/plugins/aij-ai/ai-personal-memories.service.ts`：实际 Prisma transaction client 和绑定 literal SQL；lifecycle→共享 membership fence→owner/asset锁；本人读写、初始摘要重放、CAS/noop、quota200、同owner/space活动Agent检查、原子grants替换/撤销、原子审计/擦除。
3. `apps/api/src/plugins/aij-ai/ai-personal-memories.controller.ts`：5种CRUD方法、当前会话/工作区、aiAssets.read/manage、写Origin验证、最早route guard no-store（包括认证/DTO等拒绝）。未注册到正式module。
4. `apps/api/prisma/migrations/20261105040000_ai_personal_memories/migration.sql`：仅新增两表和本能力约束/触发器，scope复合FK、ownercode唯一、不可移动owner/code、不可复活墓碑、nullable擦除、活动内容非空、quota/grant限额。没有修改AF154/159迁移。
5. `packages/sdk/src/personal-memories.ts`：使用既有ClientApi的窄工厂与准确请求/结果类型，未改SDK总入口。
6. `scripts/verification/personal-memories.test.mjs`：实际源码离线DTO/Service/Controller/SDK/SQL检查，明确内存SQL/权限fake；不是PG/HTTP证据。
7. `scripts/verification/personal-memories-live.test.mjs`：全新AF163根验收脚本，Worker NOT_RUN；lease→migrate/status→seed→plugin/catalog→真实Cookie→HTTP→DB→packed SDK→pools0。
8. `docs/execution/AF-163-schema.prisma`：精确可合并两模型和三条backrelation；Agent既有id/workspace/member唯一键直接复用，SQL-only constraints明确列出。
9. `docs/development/PERSONAL_MEMORIES_API.md`：请求/响应、隐私和擦除语义、不可恢复、未来消费重检义务、根集成/人工验收。
10. 本候选执行记录。

## 校验与失败记录

已运行并通过：

- `pnpm install --frozen-lockfile --ignore-scripts`：本工作区独立安装，没有改manifest/lock/version；仅Node url.parse deprecation提示。
- `node scripts/prisma-schema.mjs generate`：只读已核验bootstrap Schema、dummy port1、无DB/env加载，生成本工作区client成功。
- `pnpm --filter @aij/contracts build`、`@aij/core build`、`@aij/runtime-contracts build`：小公共包编译通过，用于实际类型依赖；没有API/Web重型build。
- `pnpm --filter @aij/api typecheck`：`tsc --noEmit && tsc -p tsconfig.test.json --noEmit` 全部通过，包括新DTO/controller/service。
- `pnpm exec tsc -p .artifacts/af163/tsconfig.sdk.json`：SDK实际新文件、NodeNext/strict/ES2022+DOM/types[] noEmit通过；没有伪造入口导出。
- `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-memories.*.ts scripts/verification/personal-memories*.test.mjs packages/sdk/src/personal-memories.ts --max-warnings=0`：通过。
- `node --test scripts/verification/personal-memories.test.mjs`：8/8通过。覆盖初始重放/不同内容409、改后重放不恢复grant、noop、CAS、safe summary、外国OWNER/空间404、活动性/权限/插件拒绝、审计fault回滚、擦除/稳定重复删除、模拟CAS/200限额竞态、controller metadata/Origin和SDK真实源码transport。
- `node --check scripts/verification/personal-memories-live.test.mjs`：语法通过；没有执行live。
- `DATABASE_URL=postgresql://af163_compile@127.0.0.1:1/af163_compile node node_modules/prisma/build/index.js validate --schema .artifacts/af163/schema.prisma`：ignored副本仅加入本提案两模型/backrelations，离线validate通过。实际tracked Schema未改。
- 提交前 `git diff --check`、精确allowPaths和bootstrap SHA256回读。

真实失败和修复：首次定向lint因live脚本未使用saveCatalog失败，删除无关变量后通过；首次提案validate指向不存在的 `apps/api/node_modules/prisma/build/index.js` 以MODULE_NOT_FOUND失败，改成本工作区实际解析的 `node_modules/prisma/build/index.js` 后通过。自查修复稀疏Agent数组、SQL返回授权的排序规范化及SDK TextDecoder保留BOM；修复后重跑适用校验。没有把初次失败隐去或放宽门禁。

NOT_RUN：数据库/容器/迁移/seed/真实PG/HTTP/真实权限撤销锁观察/审计SQL fault/actual quota与CAS竞态/packed SDK消费者/浏览器/应用启动/重型build/正式verify:task。候选自查不是独立复核，没有Trea/负责人验收声明。

## 影响与保留限制

- DB：仅增加SQL候选与Schema提案；Worker没有DB写入。内容单mutable owner，不建版本、第二记忆账本、ShadowSecret、Job/Trace/usage/execution记录。
- API：集成后新增本人CRUD；另一OWNER无特权；无global/org共享、无runtime consume、无模型调用，REQ018仍部分未完成。
- 页面：无页面/UI改动；无真实运行URL。
- 权限：复用已存在aiAssets.read/manage；每操作在事务内再验证角色/授权和状态；disabled Agent允许预授权，但将来消费必须再检查enabled与grant。空grant是NONE。
- 隐私：删除当前grants且将title/content/kind/enabled/initialDigest置NULL；仅最小id/owner/code/revision/time墓碑。不可restore。审计仅action/revision/随机id/owner，不含memory body/title、Agent名字、code/grant/caller correlation metadata。
- 当前NoStore guard覆盖进入路由的成功和拒绝。已导出 `personalMemoryNoStore` 早期中间件并离线测试；总控须在bootstrap/body-parser初始化前 `app.use("/api/client/ai/personal-memories", personalMemoryNoStore)`，使全局parser在guard前拒绝的malformed JSON也no-store；本卡无bootstrap写权限。正式集成前还不能访问接口。

## 总控剩余工作与下一依赖

接收本Writer明确STOPPED后，只集成本卡candidate delta。基于已正式集成AF154/AF159及对应membership fence，将两模型/三backrelation合入实际Schema，挂载上述早期no-store中间件，将Service/Controller/NoStoreGuard接入ai-runtime.module，并将SDK模块导出到真实SDK index；源码bootstrap不当作依赖完成凭据。

注册AF163 acceptance/fixture/runner权限，执行受保护独立test库全新lease、migrate/status/seed、实际Schema/client generate与build。为live脚本先将编译/pack后的contracts/sdk安装到 `.artifacts/` 下独立consumer（不是source/dist直引），以 `AIJ_AF163_PACKED_CONSUMER` 指向；用 `AIJ_AF163_ROOT_LIVE=1 node --test scripts/verification/personal-memories-live.test.mjs` 执行。DB写者和重型build均由总控concurrency1调度。

根live脚本明确检查：同owner/space授权、disabled Agent预授权、notmember/plugin/Origin/bodyforgery零domain差异、CAS/200并发边界、pg_blocking_pids证实权限撤销直到保存commit才继续、Agent tombstone拒绝新grant且不改引用史、SQL审计fault回滚body/grants/tombstone、DELETE全表无明文/无grant/无restore、packed ESM/CJS HTTP、无execution/model调用、关闭后pool0。认证lastSeenAt/updatedAt正常触达从零domain差异快照中排除，其他所有表比较hash。

按 `PERSONAL_MEMORIES_API.md` 人工步骤执行；完成正式verify:task、适用质量门禁、队列/执行记录、原名本地提交与负责人授权的后续Git节点，再完成真实I-*集成Task。下游仅引用该真实集成Task ID，不能引用本候选为CODE_VERIFIED。失败交回Writer或拆卡，不能弱化擦除/权限/DB验收。

Writer交接：最终精确candidate提交并回读SHA后 **STOP ALL WRITING**，由worker_done发送候选SHA/路径/证据；无自动续卡。
