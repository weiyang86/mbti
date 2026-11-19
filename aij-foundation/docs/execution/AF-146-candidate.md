# AF-146 — 支持有界CSV知识文件导入

状态：CANDIDATE_SOURCE_CHECKED / ROOT_LIVE_NOT_RUN / OWNER_CHECK_PENDING。仅候选交付，未登记正式 CODE_VERIFIED，也不代替负责人接收。候选 SHA 为本记录所在的原标题提交，完整 SHA 在 worker_done 回执中交接。

## Writer、起点与源码引导

- 唯一 Writer：Task `task_22b33115a931`，Dispatch `ctx_0c1cfe596fdc`，terminal `term_9858d48e-fa2d-4f27-90d0-84a414c51b9c`。
- Orca Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W03-AF146`；instance `71c3de55-c4a8-4399-9a4a-14db7e98da11`；branch `weiyang86/AIJ-W03-AF146`。
- 开始核对（2026-11-05 09:52:27 +0800）：工作区干净，HEAD 与本地 origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；remote fetch/push `git@github.com:weiyang86/aij-foundation.git`。没有切分支、fetch、push 或写根工作区。
- 按当前指派，使用 `git show fd3b420e95bd6f0577ae1b297ee2c619d5a048f4:<path>` 读取两份精确源码，并逐一核对 SHA256 后，单独提交 source-bootstrap：`2a71fe21536e8544240ee84d529fcc7dc976c5d6`，标题 `AF-146 source bootstrap from verified AF-138`，来源集成 Task `task_34f986fd3442`。

| source-bootstrap 路径 | 核对的 SHA256 |
| --- | --- |
| apps/api/src/plugins/aij-ai/ai-knowledge.service.ts | 923e0a3004da3b9da14530f49faa8f04d3074244aa79dfdaab40d6809d99941d |
| apps/api/src/client-workspaces/workspace-context.service.ts | 8acb86c7108fbc7adead9528515f8dc3ebc4e9884785b9b1c6b0ed2861844467 |

workspace-context 在 bootstrap 后保持只读，最终摘要仍为上表值。AF-146 的实现差异仅为 **bootstrap 到候选提交** 的六路径增量；root 已集成 AF-138，不得重放 bootstrap 或本子树相对于旧 origin/dev 的继承差异。

读取根工作区的正式需求基线、阶段/源码差距/追溯和当前 program/spec，并读取 AF-138 原/修订/正式执行记录；冻结历史文件的旧授权声明不替代当前指派。读取时摘要：REQUIREMENTS_BASELINE `3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a`；SOURCE_GAP_ANALYSIS `60929edb7bddb97a86bfda7edd2ff36daf303afbf54c5cbc20bb33a11b155f4a`；DELIVERY_AND_ACCEPTANCE `b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f`；traceability.json `5b833d53e02396cc2f53f13554b53510c02226fcfb6c57368f54c3ae9a57bb59`；当前 AF-146 spec `821b51c64dde0d3c5e6271dd6852a12cf876f9c2cd092aad12b1c641cc2a354b`。仅覆盖 REQ-009 的 CSV 格式切片。

## 实际六路径增量及边界

| 路径 | 实际变化 |
| --- | --- |
| apps/api/src/plugins/aij-ai/knowledge-csv-parser.ts | 无第三方依赖的有界状态机；实际解析 CSV，并生成可读的逐行 header/value 知识正文。 |
| apps/api/src/plugins/aij-ai/ai-knowledge.service.ts | 原 importDocument 接受 .csv 与对应 MIME；严格 UTF-8 解码后调用解析器，仍经原 createDocument/事务/审计写入。 |
| apps/web/app/components/client-knowledge-manager.tsx | 原文件选择器/本地扩展名校验接受 .csv；原位置说明格式、限额和公式为文本；未改全局 CSS。 |
| scripts/verification/knowledge-csv-import.test.mjs | 92 项实际 parser/service/WorkspaceContext/PluginRuntimeAccess 源码测试，存储为合成事务。 |
| scripts/verification/knowledge-csv-import-live.test.mjs | root opt-in、主 dev 工作区专用的新 AF146 lease HTTP multipart/DB 验证脚本。 |
| docs/execution/AF-146-candidate.md | 本候选证据及停止写入交接。 |

输入仍限制原始字节 <=51200；仅 UTF-8、逗号分隔，支持开头 BOM、LF/CRLF、引号内逗号/双引号转义/换行。CSV 最多 200 数据行、32 列，表头原始解码值最多 100 Unicode code points、去空白后非空且唯一，数据单元格最多 2000 code points，所有数据行与表头列数一致。拒绝无数据、全空白数据行、额外空行、单独 CR、未闭合/裸引号/闭引号后杂字、NUL、C0（换行除外）、DEL/C1 控制字符与越界。CRLF 统一成 LF 后计数。生成正文包含 Row N 和重复表头，整段最多 50000 code points；仍受原 createDocument 的 64KiB UTF-8 正文上限约束，超出在事务前拒绝。

CSV MIME 仅 `text/csv`、`application/octet-stream` 或空值；.txt/.md 保留既有 text/plain/text/markdown/octet-stream/空值规则、解码及原正文行为。CSV 不接受 text/plain、Excel MIME、XLSX、GBK 或自动分隔符检测；公式值包括 =/+/-/@ 全部保留为普通文本，不执行。生成格式为 `Row 1` 后逐行 `header: value`，值内换行缩进两空格，表头内换行转义为可见 \\n，数据行之间空一行。

原始文件只在请求内存存在，checksum 始终针对原始 bytes（含 BOM/引号/原始换行），不是转换后的内容；sourceFilename 延续原 display-only 路径叶子/控制符清理。没有新 Schema、表、迁移、文件落盘、FileAsset 或导入账本。接口仍是 `POST /api/client/ai/knowledge/documents/import`；DTO/权限代码/源元数据/审计 owner 不变，导入审计仍只有标识和 checksum，无正文或原始文件。未创建任务、调用模型或引入厂商凭据。

AF-138 的 createDocument 和共享事务 helper 未改：入口成员复检后，写事务先 project/plugin lifecycle lock，再委托 WorkspaceContext 的 workspace advisory + 授权 SHARE，再写文档与审计。解析和正文拒绝发生于业务写之前；权限失效/插件停用仍由现有围栏拒绝。源测试的合成回滚不冒充真实 PostgreSQL 回滚。

## 已执行校验

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0；本子工作区独立 726 packages，未复制或链接其他工作区的 node_modules/env/凭据/上传目录；锁文件/manifest 未改。依赖安装提示跳过第三方 build scripts，保留默认策略。 |
| `pnpm --filter @aij/api prisma:generate` | exit 0；使用仓库 compilation-only 包装器，端口 1 占位 URL，不连接 DB 或读取 env 文件。 |
| `node --test scripts/verification/knowledge-csv-import.test.mjs` | exit 0；92/92 PASS，0 fail/cancel/skip/todo。 |
| `node --check scripts/verification/knowledge-csv-import-live.test.mjs` | exit 0；仅语法检查，未运行 imports/HTTP/DB。 |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-knowledge.service.ts apps/api/src/plugins/aij-ai/knowledge-csv-parser.ts apps/web/app/components/client-knowledge-manager.tsx scripts/verification/knowledge-csv-import.test.mjs scripts/verification/knowledge-csv-import-live.test.mjs --max-warnings=0` | exit 0；五个目标文件，0 warning。 |
| API service/parser 导入图 TypeScript noEmit | exit 0；0 diagnostics，沿用 api tsconfig，rootDir/baseUrl 为本 worktree，@aij/core、contracts、runtime-contracts 指向本树 packages/*/src/index.ts，未生成 dist。 |
| Web 组件导入图 TypeScript noEmit | exit 0；0 diagnostics，沿用 web tsconfig，incremental=false；@aij/ui、sdk、contracts 指向本树源码，未生成 dist。 |
| `git diff --check` | exit 0。 |

92 项覆盖 BOM/混合引号/多行/CRLF、公式惰性、Unicode code point 计数、行/列/表头/单元格上下界、生成正文精确 50000 与拒绝 50001；实际 service 的 MIME/扩展名/字节/UTF-8/格式/正文拒绝零写入、原始 checksum 与文件名清理、txt/md 的八组 MIME 回归及原 50KiB 边界；实际 AF138 helper 的 lifecycle→workspace→SHARE 顺序、入口后停用/撤权拒绝、审计失败合成回滚。首轮 exit 1，89/91 PASS：两个测试构造错误（JS 未配对代理项经 Buffer 编码会替换为有效字符；原中文样例未超过 64KiB），已改用 UTF-8 编码代理非法字节和真实超界正文。首轮 lint exit 1 为未使用的遍历变量，已改为有界 code point 计数；最终上述命令全部通过，未改生产拒绝条件来迎合错误测试。

未执行：正式 `verify:task` 注册/运行、DB/Docker/seed/migrate、API/Web heavy build、完整依赖制品门禁、HTTP、浏览器和厂商请求。没有启动地址、live 报告或实际 DB PASS。现有 AF138 fence/offline 回归 loader 尚未登记新 parser import，需由 root 在集成治理范围补充映射后运行，不能把未运行的回归说成通过。

## root 集成与真实验收请求

1. 确认本 Writer 明确停写后，**仅集成本记录所在候选提交的六路径增量**，不 cherry-pick `2a71fe2` source-bootstrap；保留当前 AF138 与其他卡记录。正式 registry/queue/执行状态和正式提交由总控处理。
2. 在保护规则保持不变前提下登记 AF-146 新 acceptance 名称/lease 与正式 verify：`scripts/runtime-environment.cjs`、`scripts/database/migration.mjs`、`scripts/database/seed.mjs`、`scripts/verification/auth-support.mjs`、`scripts/verification/client-auth-fixture.mjs` 的既有受保护 allowlist。不得借用 AF119/AF138 旧库/lease。
3. 给 root 现有 `knowledge-lifecycle-fence.test.mjs` 和 `optimization-delta/offline.test.mjs` 的实际 AiKnowledgeService 源码 imports map 添加 `'./knowledge-csv-parser': loadSource('apps/api/src/plugins/aij-ai/knowledge-csv-parser.ts')`；只增加依赖映射，不减弱断言。Worker 未写这些范围外文件。
4. root 按单并发完成当前 API/Web 制品门禁、AF138 与本卡源码回归；当前 API build 含 parser 后在主 `dev` worktree 显式执行：

```sh
AIJ_AF146_ROOT_LIVE=1 node --test scripts/verification/knowledge-csv-import-live.test.mjs
```

脚本先拒绝缺少 opt-in、非 dev 或 linked worker worktree，再动态加载 DB helper。使用 `createRemainingClientFixture('AF-146', {aiCenter:true})` 新建随机 `aij_foundation_af146_test_<16hex>`，核对 task/repository/instance/database。仅在本新 lease 移除 shared fixture 上那条无 operation 的合成 enabled 安装行，以实际 PluginLifecycleService.install/enable 和真实 operation/audit 完成生命周期后才发知识请求；通过受保护 seed 注册 pluginManagement 权限。调度器关闭，offline provider invoke 被计数并要求零，不配置真实模型。

计划 30 个独立分组（含父项共31节点），Worker 实际运行0个：生命周期安装/启用；引号/BOM CSV 201 与原始 checksum/单审计/无 FileAsset；txt/md、octet-stream/空 MIME 成功；18 类 quote/UTF8/binary/size/shape/header/rows/columns/cell/generated-text/document-byte/MIME/extension/extra-field 拒绝；匿名401、非成员403、伪造workspace403、foreign/missing Origin CSRF403；其他成员在自己的空间读不到导入文档。每个拒绝前后对全库 document/audit 和 FileAsset/job/trace/provider 数量作快照比较，不只核对状态码。

聚合证据写本工作区 `.artifacts/auto-ai-program-20261105/AF-146/live-*/result.json`：只有源 SHA、lease/database标识、检查名/状态、HTTP状态、provider计数与清理结果，排除正文/URL凭据/cookie/token/原始 driver 错误。finally 还原 provider、关闭 app、通过已校验同一 lease 的独立 pg 连接检查零 aij-api session，再恢复环境；测试库与合成记录保留，不 drop/reset。若 shared fixture 在返回 app handle 前失败，脚本只能报告 fixture-handle-unavailable，root 须检查该新 lease 的部分初始化；不冒称关闭不可见的资源。

人工验收：root 服务实际启动后进入现有客户知识库页面，选择有管理权限的 Workspace，上传表头 `name,note`、数据 `Aurora,"comma, value"` 的 UTF-8 CSV，确认文档正文转换与来源；再导入 txt/md，上传不齐列/非法引号/超限文件确认拒绝且列表不增加。使用另一成员与缺少 origin 的请求复验隔离/拒绝，核对真实报告的零写入和零 provider。Worker 未执行这些页面/API操作；没有宣称完整多源知识导入已交付。

## 预算和停止写入

从 09:52 初始核对到候选交接约 0.2 有效工程小时，低于 Worker 2.5h 上限；预留 root 约1h，预计总计约1.2h，仍低于3.5h卡片上限。实际 root 用时由总控记录；如后续真实门禁出现需扩域/超限问题，应保留失败证据并拆卡/重新派工。

**本 Writer 在原标题候选提交后停止全部写入并交回总控。** 后续集成、保护 allowlist、旧 loader 回归、真实 HTTP/DB/浏览器、正式 verify/队列/提交与负责人验收由 root 控制；不自动续卡、merge/push/发布，也不要求历史 Trea 复核。
