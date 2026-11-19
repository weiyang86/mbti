# AF-229 · 提供章节生成预览任务API与公共SDK — Candidate

状态：候选离线校验 PASS；**Candidate not CODE_VERIFIED**。自查由同一 Writer 完成，不是独立复核，不等待 Trea。root 尚需接线、真实串行验证和正式记录；W23 人工验收仍 pending，本批 OWNER_CHECK_PENDING。

## 身份、来源与提交边界

- Task：`task_64c7d5d018e8`；Dispatch：`ctx_b296cd67f5bb`；terminal：`term_c2c21591-c10c-4439-9326-c4afdd8c55f2`。
- 注册 child Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W24-AF229`，parent 为原 dev；branch：`weiyang86/AIJ-W24-AF229`。
- 初始 `git status --short --branch` clean；HEAD 与 origin/dev 均 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；origin fetch/push：`git@github.com:weiyang86/aij-foundation.git`。
- 原 root 仅读取 W24 CONTRACT、SOURCE_BOOTSTRAP 与任务派工契约；未读取 root live 源码、真实 env 或用户原型。源码全部从冻结 `165338eb41eca99d3b779964a7e9f73f402a0d23:path` 的 Git blobs 恢复。
- SOURCE_BOOTSTRAP 原始文件 SHA256：`ccc1f0f9fa3c950debb65ed2eb0954ebf57523d07281b8aef191c736fbc088db`。1085 条逐项核对 Git tree mode/OID、git hash-object、bytes、SHA256，写后再次逐项核对内容和 executable mode；exit 0。无删除路径。
- source-only bootstrap SHA：`46957a47cf82311717c9ce83e2987beeec7de8dc`（标题“恢复W24冻结源码基线”），与候选 delta 独立。候选仅一次按中文原标题提交，实际 candidate SHA 由最终 worker_done/git log 给出，禁止将 bootstrap 当候选集成。
- 独立 node_modules，无链接 root/原产品依赖、凭据、上传或数据库。未创建 helper/subagent，未写正式 queue/registry/barrel/global dependencies/schema/migrations，未修改主 dev。

## 实际 diff 与影响

八个 allowPaths 新文件，无既有代码删除：

- DTO：精确 7 字段 preview / 3 字段 submit 与完整 12+9 字段 ref 校验，plain/null prototype、descriptor、符号/隐藏/污染/额外键拒绝，raw instruction 原样保留，冻结并脱离输入。
- Controller：四个冻结路由，原 WorkspaceContextGuard/claims、三项 read 权限、submit 额外 manage/execute、原 POST origin/执行开关、NoStoreGuard、query/GET body 拒绝。scope 不取 body。
- thin service + abstract DocumentGenerationRunDriver：每操作只调用原 owner 一次，原 HTTP 异常原样传播，明确 Date→ISO，精确投影 publicRun 与 metadata，私有字段/不一致结果安全 503，缺 driver 503。
- SDK：四操作各一次原 ClientApi 请求，AbortSignal/跨 scope header 交给原 transport，无 retry/poll/cache/storage；strict input/wire、text 输出、状态/预算组合、日期/费用/ref 绑定校验；安全 TypeError 不回显输入且不伪造 HTTP 状态。
- 后端 boundary 与 SDK ESM/CJS/类型离线测试；本执行记录和 root 接线说明。

文档/章节解析、会话锁、Memory/Agent、预算、Run/Job/Trace、保留期、幂等、存储均未新建或接管。本候选没有数据库/schema/migration、页面、权限定义、日志账本或运行端口变更，未写 audit/input/output storage；只新增待 root 注册的入口与 transport。没有已运行的访问地址，Web/API/DB/Docker/native/外部付费调用均未运行。

## 冻结源码核验依据

上述 source commit 中 `ai-center-run.service.ts` 的 publicRun 返回精确十字段，cost 为 string、日期为 Date；recoverRequest 仅返回七字段，contentAvailable 是未 purge 且未过 expiresAt，unknown/reserved 不代表自动重试，过期正常 read 为 410。`ai-center-provider.ts` 在 outputFormat=text 时直接返回 redacted string，不是 `{text: ...}`；JSON 分支只属于原 json Agent，本接口拒绝该对象。

已读原 SDK `index.ts` 的 ClientApi/ClientRequestFailure、createClientApi credentials/include、workspace header、cache/no-store、signal/HTTP 失败习惯，以及 personal-agent-run-previews、personal-agent-runs、ai-run-recovery、personal-workflow-execution、personal-document-sections 的类型与安全校验习惯。新 SDK 仅 type-import ClientApi，不复制 transport、错误包装、redaction、runtime 或原 owner 的恢复/预算逻辑。

## 命令与结果

环境：Node `v24.21.0`，pnpm `10.0.0`。所有最终验证均 exit 0：

| 命令 | 结果与范围 |
|---|---|
| immutable bootstrap Python（git show / ls-tree / hash-object / bytes / SHA256 / mode） | 1085/1085 PASS，独立 source commit |
| `pnpm install --frozen-lockfile` | PASS，自有依赖；800 packages，lock 未变；依赖 build scripts 被 pnpm 忽略，未擅改策略 |
| `node scripts/build-workspace-package.mjs packages/contracts` | PASS，小 contracts 包 |
| `node scripts/prisma-schema.mjs generate` | PASS，schema-only，脚本清空敏感环境并强制不可连接 `127.0.0.1:1` 占位，未读 env/连接数据库 |
| `pnpm --filter @aij/sdk build` | PASS，现有 public graph；新模块因 barrel 未接而不在该产物内 |
| `pnpm --filter @aij/api exec node --test -r ts-node/register test/personal-document-generation.test.ts` | PASS，7 tests；原 source 语义编译，offline driver/controller/DTO collaborator，不是 PG/session/runtime 验收 |
| `node --test scripts/verification/personal-document-generation-sdk.test.mjs` | PASS，23 tests；实际新 SDK 模块 NodeNext/CJS 语义编译、ESM/CJS 执行、NodeNext typed consumer；非 outside packed |
| `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module commonjs --moduleResolution node --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --types node` + 本卡 3 backend source 与 1 test 文件 | PASS，isolated graph，无全 API build/typecheck |
| `pnpm exec eslint` + 本卡 6 个代码/测试文件 + `--max-warnings=0` | PASS |
| `git diff --cached --check` | PASS，eight allowPaths additions only，无删除/既有文件改动；提交前再次核对 |

离线覆盖：每操作一次调用、fresh claims/scope 传递、raw instruction/输入不变及 preview UTF8 SHA256 绑定（SDK 沿既有 WebCrypto 习惯，缺失安全 TypeError）、原异常 identity、缺 port、五种 status/budget、string 输出与 64000 边界、purged metadata/sourceCurrent 独立、私有字段拒绝、日期/成本/ref/UUID/counter/selector/id/key 边界、null prototype、getter/symbol/hidden/proto/proxy trap 安全拒绝、无输入回显、route/guard/permissions、origin/禁执行/query/body、signal 与输入 await 后脱离。

曾经失败并已修正，未掩盖：首次身份回执用了 CLI 不支持的 `--type info`，exit 1、未送达，随后以 `status` exit 0 送达 `msg_81e93c70581d`；第一次 backend test 使用不存在的相对 preload 路径 exit 1，改用 package 内 `pnpm exec`；初版 tests 的 contextual lambda typing/request cast 和数组 descriptors 的 TS 推断导致编译 exit 1，修正后全部语义检查通过；一次 lint unused helper exit 1，删除未使用 helper 后 lint 通过。SDK build 首次与 lint 用 && 串行，因 lint 失败未执行，随后独立实际执行 PASS。

Git 读取冻结对象时反复输出外接盘 `._pack-*.idx non-monotonic index` 的既有 AppleDouble index 警告；Git 命令均成功取回目标对象，所有 blob/hash/mode 验证与提交 exit 0，未修改共享 `.git` 或隐藏该输出。

## NOT_RUN、人工步骤与下一依赖

NOT_RUN：注册 `verify:task`、root 适用质量门禁、真正 strict-JSON/private HTTP、真实 auth/session/membership/permission、PG/事务/并发/保留期/runtime/provider loopback、outside freshly packed ESM/CJS/NodeNext/browser、公用原 Agent/workflow/text/image 回归。没有 mock/offline 通过被记为上述通过。

root 接线与人工步骤见 `docs/planning/auto-ai-program-20261105/W24/AF-229-ROOT_WIRING.md`：正式 I227→I228 成功并读取真实集成 SHA/Task 后，精确集成本卡 delta，bind 原 driver、接 strict bootstrap/module/SDK public barrel，串行跑成功与拒绝路径、root verify/门禁，再更新正式队列并按原标题提交。负责人按批人工确认，候选与本地提交均不等于正式接收；不 push。

Worker 有效工时约 0.5h（包含失败修复，低于 1.5h 上限）；实际结束与 candidate SHA 以最终交接消息为准。候选提交后 **STOP ALL WRITING**，Writer 已把后续共享接线与真实验收交还 root，不自动开始下一卡。
