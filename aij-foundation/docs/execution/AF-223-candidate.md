# AF-223 · 提供个人文档章节索引只读接口 — 候选交付

状态：CANDIDATE_READY，**Candidate not CODE_VERIFIED**。本记录为同 Writer 自查与离线候选验证，未冒充独立复核或负责人验收，未等待 Trea。候选实际 SHA 由本记录所在原名提交确定，并在 orchestration worker_done 回执中明确报告。

## 身份与不可变基线

| 项目 | 实际值 |
| --- | --- |
| Task / Dispatch | `task_f5c4ef57ec62` / `ctx_c124e3befde9` |
| terminal | `term_3504334e-f385-4151-a58e-c8eae1472bbf` |
| Worktree | `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W23-AF223` |
| Worktree instance | `fec9bc78-40f3-4e7a-9450-f1e9aa0b14c4`，本仓库已注册 root child |
| branch | `weiyang86/AIJ-W23-AF223` |
| 起始 HEAD / origin/dev | `94b0236f775fa40a07944c5e0545ac6ce0e123f3` / 同 SHA，起始 `git status --short --branch` clean |
| remote | `origin git@github.com:weiyang86/aij-foundation.git`（fetch/push URL 相同，未 push） |
| source | `5289bd1eabff8d2c8891ba0baeab7f1bf323c8d2` |
| manifest SHA256 | `16075959b0ea95f4c71c218bf2e9a594314fb746fe32acfa02a2683a741a0014` |
| source-only bootstrap commit | `faac12db9cf71f1d41f330a4f5f2d43429c2b94b`，`chore: bootstrap W23 immutable source snapshot` |

首次身份回执通过 ask 发给总控；总控接受身份并更正 spec 路径为 root 的 `docs/planning/auto-ai-program-20261105/AF-223.md`，非 W23 子目录。root 只读取上述 spec、`W23/CONTRACT.md`（完整读取）及 `W23/SOURCE_BOOTSTRAP.json`。未读 live root 源码/凭据/原型。按清单逐文件执行 `git ls-tree` 核对 mode/oid，`git show 5289bd1…:path` 取精确 blob，核对 bytes/SHA256，写回后再次核对 hash/mode；1061 项全匹配、538 个实际 source-only 差异、无删除，先单独 bootstrap 提交。候选写入后重新核对 1061 source blobs 全部未变。

Node `v24.21.0`，pnpm `10.0.0`。当前 child 独立执行 frozen install，800 packages，下载 0；`node_modules` 是本 child 实目录，不指向 root/其他工作区，仅复用下载缓存；没有复制真实 `.env`、上传或客户数据。schema generate 使用仓库的安全 compilation-only wrapper，虚拟 `127.0.0.1:1` URL，不读取环境文件，不连接 DB。

## 实际候选 diff 与影响

仅六个 allowPaths 新文件：

- `apps/api/src/documents/personal-document-sections.ts`：纯内存快照索引、node:crypto SHA256，UTF16/UTF8 精确长度与连续块，ATX/fence 状态机、128/256 边界及显式 400。
- `apps/api/src/documents/personal-document-sections.service.ts`：严格 canonical expectedRevision query，一次原 owner 当前读取与 409 CAS revision 比较；显式注入原 owner 类型 token。
- `apps/api/src/documents/personal-document-sections.controller.ts`：GET 子路由、原 no-store/workspace/client 守卫与读取权限，使用服务端已解析 member/workspace。
- `apps/api/test/personal-document-sections.test.ts`：19 个真实编译的离线单元测试，导入原类型及原 guards/decorators，端口 collaborator 只模拟 owner 返回/拒绝，无 DB 或服务监听。
- 本执行记录及 `docs/planning/auto-ai-program-20261105/W23/AF-223-ROOT_WIRING.md`：候选证据、精确 module 接线与正式 I223 验收请求。

数据库/schema/migration：零新增和变更；Service 自身无写入/事务/Prisma/文件/模型/Job/审计依赖。接口影响：root 挂载后新增只读 `/api/client/documents/:id/sections?expectedRevision=N`；仅返回原当前授权快照的索引，不包含 body/code/name。页面与 SDK：零变更。权限：复用 `workspace.documents.read`，不新增 permission 或 auth owner。日志/费用：无新增私有日志或计费调用。输入与原正文不变，不正规化/截断，解析失败不回传正文/标题。访问地址：NOT_RUNNING，未启动任何应用服务。

## 验证命令与真实结果

以下命令均在此 child；未设置 TS_NODE_TRANSPILE_ONLY，未绕开真实 owner 类型编译。

| 命令 | exit / 证据 |
| --- | --- |
| 身份 git status/branch/rev-parse/remote、Orca worktree current | 0；起始 clean、精确 SHA 与登记 child 一致 |
| manifest/hash/mode/blob 恢复脚本及 source-only commit | 0；1061 精确项、538 实际差异、无删除；bootstrap SHA 如上 |
| `pnpm install --frozen-lockfile` | 0；独立 node_modules，800 packages；pnpm 默认忽略依赖 build scripts，未改全局/manifest 配置 |
| `node scripts/prisma-schema.mjs generate` | 0；Prisma Client 6.19.3，日志明确 compilation only / no DB / no env file |
| `pnpm --filter @aij/contracts build` | 0；仅 contracts 小包 ESM/CJS/types 产物（ignored），非 API 全构建 |
| `cd apps/api` 后 `node --test -r ts-node/register test/personal-document-sections.test.ts` | 首次 1：测试请求 fixture 不完整强转 ClientRequest，TS2352，未执行测试；改用未连接的真实 IncomingMessage/Socket，再次 0，19/19；补充 decoded 重复/prototype query 与 Unicode 换行边界后最终仍 0，19/19、fail/skipped/cancelled 均 0 |
| `pnpm exec tsc --noEmit --module commonjs --moduleResolution node --target ES2022 --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --resolveJsonModule --strict --skipLibCheck --types node apps/api/src/documents/personal-document-sections.ts apps/api/src/documents/personal-document-sections.service.ts apps/api/src/documents/personal-document-sections.controller.ts apps/api/test/personal-document-sections.test.ts` | 0；四个新 TS 入口及实际导入 owner 类型的隔离检查 |
| `pnpm exec eslint apps/api/src/documents/personal-document-sections.ts apps/api/src/documents/personal-document-sections.service.ts apps/api/src/documents/personal-document-sections.controller.ts apps/api/test/personal-document-sections.test.ts --max-warnings=0` | 0；最终源码和测试无 warning |
| 1061 source blob 重查、独立 node_modules 路径与外指 symlink 检查 | 0；source 未改，node_modules 实目录位于此 child，无指向工作区外部链接 |
| `git diff --check` 与候选 allowPaths/staged 差异审计 | 0；无空白错误，仅六条批准路径、无 bootstrap 混入（提交前检查） |

覆盖：空正文/纯正文/前言，六级列零标题与缩进/引用/HTML/BOM，UTF16 surrogate 与 UTF8 bytes、LF/CRLF/单 CR/混合行尾、组合字符、U+2028/U+2029，围栏同种/长度/空白关闭及未关闭，128/129（前言计数）、256/257 codepoints（含 emoji）、65536 bytes、非法 Unicode/控制字符；输入不可变、无截断、无正文泄露；data-only/null-prototype 与额外/symbol/nonenumerable/getter/继承形状；revision canonical 1/200 与错误值、重复原始 query 解码数组，service 单次委托/精确 scope/409/原异常透传，Nest route/guard/permission/no-store/DI metadata。

保留失败及环境诊断：最初 `printenv ORCA_CLI_COMMAND ORCA_DEV_REPO_ROOT` exit 1（均未设置，按 macOS skill 选择 orca）；错误 W23/AF-223.md 路径 cat exit 1，经总控明确更正后读取成功；合并读取中的不存在 `apps/api/test/tsconfig.json` 使 cat exit 1，实际测试配置为已读 `apps/api/tsconfig.test.json`；带不存在 `apps/api/src/config` 的 rg exit 2，后续针对真实文件读取成功；含未匹配 zsh glob 的 rg 命令 exit 1，改为真实 bootstrap/common 路径后 exit 0。以上为只读发现失败，未当作测试通过。git 多次报告共享 object pack 中 `._pack-f03e767c944ca97bc7cba847811aab0e60e02cb8.idx` 的 non-monotonic index 诊断，但相关命令 exit 0 且所有目标 blob hash/模式验证成功；未修改 root/.git 修理共享元数据。

## NOT_RUN、依赖及 Writer 交接

NOT_RUN：真实 API/HTTP/认证/撤权/跨成员/删除/插件/项目/旧 revision PG 路径，DB/seed/migrate/Docker，应用服务/native，完整 API/Next 构建与全库测试，root `verify:task`、正式 I223、真实只读数据库计数与内容快照、真实页面人工验收。离线拒绝测试仅证明透传原异常，metadata 测试只证明接线声明，均不证明真实权限/PG/native 已通过。无付费调用、push、远端 Issue/PR、main/tag/部署。

共享接线及人工验收见 `docs/planning/auto-ai-program-20261105/W23/AF-223-ROOT_WIRING.md`。root 需只接入两类到现有 DocumentsModule，独占执行正式保护租约、真实成功/拒绝和读前后不变性验证、原文档/历史/导出回归及治理门禁。后续 AF224 正式依赖须使用 root I223 的真实 Task ID；本 Worker Task 不替代它。没有候选实现硬阻塞，未接线和真实验证是明确留给 root 的工作。

有效工程工时约 0.25h（身份/不可变 bootstrap、实现、定向验证及记录；未含等待总控答复），低于 Worker 1.5h 上限，整卡 3.25h 预算的其余留给 root。最终原名候选提交只包含上述六个新增文件，不含 bootstrap；完成后明确 STOP ALL WRITING，通过原 dispatch 的 `orchestration send --type worker_done` 报实际 candidate SHA 并停止写入，不续开下一卡。
