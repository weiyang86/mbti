# AF-206 候选交付：复用统一运行账本执行个人工作流

状态：CANDIDATE_ONLY，非 CODE_VERIFIED / Owner 接收。外部厂商 DEFERRED_NOT_PASSED；全40 NOT_RUN_TARGET_ACCEPTANCE、native14/vendor/owner 未通过。真实凭据保持空；未启动访问地址。

## 注册与来源

- Task `task_68041431d7c5`；Dispatch `ctx_dbf3d82b9f13`；Writer terminal `term_26f4ee2d-4f5a-43b2-b92c-8cca19da0a32`。
- Orca worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W18-AF206`，instance `1edc3878-2d4a-4a03-8ae6-81aeae00e0ae`，baseRef `refs/remotes/origin/dev`，注册创建时间 2026-11-07 00:11:46 UTC。
- 分支 `weiyang86/AIJ-W18-AF206`；first HEAD / verified origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；初始 `git status --short --branch` 干净。
- remote fetch/push 均 `git@github.com:weiyang86/aij-foundation.git`；未 push、切分支或改远端。
- 阅读主目录当前 AGENTS 与固定 W18 CONTRACT；来源仅 `2ee9172a30be7694dc2cb097a43fbce1f0a14e65`。SOURCE_BOOTSTRAP.json SHA256 `a1315d50f341bdf17ea202aa3626035523598ce6188004c61301a15386e39bc0`；885 个 manifest.files 全部逐项 git show + SHA256 校验，未复制 live root 或其他候选。
- source-only bootstrap commit `fe3201f1955f77c5a07e9e95596fd263446634ca`，标题 `W18 verified source-only bootstrap`。候选 delta 仅其后的五个允许文件；总控不得集成 bootstrap。
- 候选提交以本文所在 commit 为准，标题逐字 `复用统一运行账本执行个人工作流`，SHA 在 worker_done 交接消息回读报告（避免提交内自引用 SHA）。

## 实际差异与边界

新增 origin service：精确只读 WorkflowRef、原 snapshot.source version/revision/publicationVersion/输入字段匹配、独立 hash 域、已知 marker 删除辅助函数、真实 SQL immutable origin INSERT + 同事务元数据审计、runtime 从关系恢复原 session/tokenVersion 并调用原认证 owner 端口、workflow/Agent epoch 与 scope 匹配。无 marker 且无 relation 的旧路径返回，任一只存在一端拒绝；未知 snapshot 扩展不被删除。

新增 Runs service：通过原 Run driver 委托一次 submit/read/recover，通过原 preview owner 预览；前后短事务检查当前 workflow、Agent 及当前查询身份，按原请求 key 验证 submit 返回身份；未知网络错误固定503且不重试；保持 unknown/过期恢复状态。仅显式 public projection 返回 ISO 日期，不输出会话、快照正文或私密配置。

新测试运行上述实际 TS 服务代码（TypeScript transpile，仅依赖协作者，不启动 Nest/PG/运行时）。新增 ROOT_WIRING 给出原 owner 精确锚点、DI/类型和 SQL/FK/index/immutable triggers 建议，特别约束 workflow→session→Memory→Agent 锁序。未改原服务、schema/migration、SDK index/module/权限、队列/registry/current state。数据库、接口正式挂载、页面、权限注册均无当前实际影响；接线后只新增来源关系及 metadata audit，不复制 Run/Job/Trace/status/cost/wallet。

## 验证命令与结果

全部使用本工作区独立 node_modules，无共享/借用 env、上传或根目录依赖。

- `pnpm install --frozen-lockfile --ignore-scripts`：exit 0，800 包，无 lockfile 变化。
- `pnpm --filter @aij/api prisma:generate`：exit 0，schema-only 明确不连接 DB/不读取 env。
- `pnpm --filter @aij/contracts --filter @aij/core --filter @aij/runtime-contracts build`：exit 0，仅三个小包。
- `node --test scripts/verification/personal-workflow-run-origin.test.mjs`：最终新运行 exit 0，15 passed、0 failed、0 skipped。
- `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-personal-workflow-run-origin.service.ts apps/api/src/plugins/aij-ai/ai-personal-workflow-runs.service.ts scripts/verification/personal-workflow-run-origin.test.mjs --max-warnings=0`：exit 0。
- `pnpm exec tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --skipLibCheck --strict apps/api/src/plugins/aij-ai/ai-personal-workflow-run-origin.service.ts apps/api/src/plugins/aij-ai/ai-personal-workflow-runs.service.ts`：exit 0，定向入口及其原依赖类型检查。
- `git diff --check`：exit 0。来源 bootstrap 字节与候选 allowPaths 单独核验；未使用缓存验收报告。
- 可见 Git 警告：共享 git object store 的 `._pack-f03e767c944ca97bc7cba847811aab0e60e02cb8.idx` 报 non-monotonic index，读取/提交命令均成功；未删除或修理共享对象。无测试失败历史被隐藏。

NOT_RUN：DB/Docker/migrate/seed/server/browser、原 Run 实际 runtime/lease/Trace/并发/admission/PG FK 与 audit 回滚、upstream HTTP、packed installed SDK、全量 API/Next build、root verify:task、native/vendor/Linux/full40。测试中的 rollback/FK/lease 是明确命名的小协作者，只证明服务错误传播与调用顺序，不是上述实际验收。

## 总控接收与人工步骤

先完成 I205 真正 CODE_VERIFIED，再接收本候选五文件 delta，落实 `AF-206-ROOT_WIRING.md`；新建隔离 PG 验证 scoped FK/immutable/审计回滚与 same-key 唯一 admission；通过原 runtime 检验三阶段 auth、lease-loss、Agent/workflow ABA、晚到 IO、unknown 保留与清理；保留旧个人Agent/catalog hash及回归。运行真实HTTP与下游I207安装实包校验并执行完整正式门禁后才可登记I206完成。需要关注固定 A.resolve 的 ai.execute 权限与 GET 路由 READ 权限的有效组合，文档已明示；不得悄然削弱运行授权。

工作时长：从注册 00:11:46 UTC 至约 00:21 UTC，elapsed/effective 均约 0.16h（单 Writer 无子Agent；远低于2.5h Worker上限），未运行 root 预算内重型验证。

Writer 交接：本候选提交、SHA/allowPaths回读后 **STOP ALL WRITING**；交由总控独占接线与正式验证。候选成功只表示派工范围交付，不表示已运行、验收通过或正式接收。

## R1 追加交付（优先于上述 R0 权限组合说明，历史不反填）

本次 Task `task_4e5b5a6a8605` / Dispatch `ctx_e59b8f14eb91`，同一注册工作区与 Writer；起始 HEAD `92b15d53d823d6cd9521c99b2304a2fb31c887de` 且工作区干净，remote/branch 不变。原 bootstrap `fe3201f1955f77c5a07e9e95596fd263446634ca` 与原候选提交完整保留；未复制或改 root 文件。已只读全文核对主目录 CONTRACT R1，SHA256 精确匹配 `b2340b8926523bfaf435ef0d21938ba25adbbfa9d8ecc22496709d4d38b532da`。

Root 已确认 R0 的 GET 额外要求 ai.execute 是契约缺陷，不是预期授权。新增 `WorkflowPublicationRuntimePort.resolveForReadInTransaction` 与 origin.`resolveReadOrigin`，两个 origin 入口共享严格 ref/project/input/current-session 检查。read/recover 的私有 locate 固定走 READ 和读取 resolver；submit 前后、preview、admission/dispatch 仍走原执行 resolver，recordOrigin 仍依赖原 admission 执行授权锁且不重新倒序加锁。无客户端模式、403 fallback 或执行权限降级。查询使用新合法同 owner 会话，运行期依然复检原启动会话。

新增6项有意义协作者测试，最终 `node --test scripts/verification/personal-workflow-run-origin.test.mjs` exit 0，21 passed / 0 failed / 0 skipped，其中原15项全部保留通过。新增矩阵覆盖仅READ无EXECUTE可查询、每一READ权限缺失拒绝且无执行副作用、仅READ不能submit/preview/admission/runtime、仅EXECUTE仍能submit/preview且前后均走执行resolver、IO后撤权拒绝、403不回退、两个入口共享真实性检查以及读取端口缺失503。provider/enqueue/reserve 计数来自明确的小协作者，不是实际provider/PG/runtime证据。

重新执行上文同参数的定向 eslint 与 strict tsc、`git diff --check`，均 exit 0。没有重装依赖、DB/Docker/server/GUI/heavy build/正式验收；root 的实际PG/HTTP权限矩阵仍 NOT_RUN，CODE_VERIFIED / vendor/fulltarget 状态没有变化。修改仅原五个 allowPaths，ROOT_WIRING 已更正两个具体 resolver 的接线要求。

本次额外 effective/elapsed 约0.06h，低于0.25h追加上限；累计 Worker 约0.23h。R1 提交标题仍精确为 `复用统一运行账本执行个人工作流`；新 SHA 在 worker_done 回读报告。本次提交与最终检查后 **STOP ALL WRITING**，Writer 交还总控；总控接收 bootstrap 之后的累计五文件 delta，或按原候选+本次R1顺序接收，均不包含bootstrap。
