# AF-214 候选交付记录

状态：CANDIDATE_READY / NOT_CODE_VERIFIED；真实目标验收 NOT_RUN_TARGET_ACCEPTANCE；vendor DEFERRED_NOT_PASSED；owner PENDING。本记录是同一 Writer 自查，不是独立复核或负责人接收。

## 身份、来源与范围

- 实际 Task：`task_98f94af27448`；Dispatch：`ctx_37ab6098b797`；Writer terminal：`term_16e15a8a-a587-4228-a9b1-68547cc21dc9`。
- Orca Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W20-AF214`；instance：`95dfd3a6-a536-4d59-973f-cf6356e7fa18`；branch：`weiyang86/AIJ-W20-AF214`。
- 初始 HEAD / 实际 origin/dev：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`；remote：`git@github.com:weiyang86/aij-foundation.git`；起始状态干净。已向总控发送初始核对报告 `msg_24bed61a8c32`。
- 首先读取主工作区 AGENTS 和 W20 CONTRACT；合同 SHA256：`9c40f7e10b129535fc2fd490f58b86ba4212d1a0ad4473b216b805827ca8b40c`；来源清单 SHA256：`0dd96fc9dbe0b3652a2f1d82e577d1aeb39a36ea2d897ea1673f0e6da653220b`，均与派工一致。
- 只以只读 `git cat-file --batch` 从不可变源 `129aa515b5c7fd8a3269d97b3521136fc641f59d` 物化清单中 961 个 blob，每个内容 SHA256 均核对通过。未复制 live-root 实现、待处理 AF191/203 或用户修改。
- 独立 bootstrap 提交：`6bad7848abdcdac7b8cad9a84bef8f7adf45bdf8`，标题 `W20 verified source-only bootstrap`。候选提交标题严格为 `提供知识问答引用的受控来源查看`；最终 SHA 由 worker_done 返回并可从本分支 HEAD 读取，交接不要求将提交自身 SHA 写入自身内容。
- 使用本工作区独立 pnpm frozen install，`--ignore-scripts`，仅复用下载缓存；根/API/Web node_modules 真实目录均处于本子工作区。未复制凭据、真实 env、上传内容或共享 node_modules。
- Worker 有效工程时间约 0.35 小时（含读取、实现、修复、验证与记录；不含 root 后续集成），低于 1.75 小时上限；单卡含 root 总上限 3.5 小时由总控继续计量。

## 相对 bootstrap 的精确 allowPaths delta

仅新增以下七个路径，没有修改来源 owner 或共享文件：

1. `apps/api/src/plugins/aij-ai/ai-knowledge-citations.controller.ts`：仅 GET 引用路由、原 WorkspaceContextGuard/knowledgeQuery、原 claims 转交抽象 port，拒绝额外参数/GET body/非法 ID，提供私有响应早期 middleware 和脱敏 filter。
2. `apps/api/src/plugins/aij-ai/knowledge-citation.ts`：纯当前来源投影，校验问答 owner/workspace/状态/删除/清理/七天期限/存储引用和当前文档；复用原始摘录算法比较，变化 409、过期 410、不可用 404，64KiB UTF8 和真实 SHA256。
3. `packages/sdk/src/knowledge-citations.ts`：单个 read GET，原 ClientApi 的 Cookie/Workspace 通道、严格 ID/options/响应精确字段/UTF8 字节/时间/checksum/取消，无自动重试。
4. `apps/web/app/components/client-knowledge-citation.tsx`：明确“查看当前来源”，继承原 AntD/adminTheme，读前后原 me/context 身份、sessionGeneration、role、权限核对；只显示已存提取文本并明确不是历史快照。RAM 中保存，关闭/blur/hidden/pagehide/scope/撤权清除，取消和代次隔离迟到响应；打开时每两秒仅重验授权，八秒请求期限。
5. `scripts/verification/knowledge-citations.test.mjs`：实际 helper/controller/SDK/UI controller 分支、SDK CJS/ESM/声明编译、真实 React 转义输出的定向单测；合成依赖只证明单元行为，不称为真实 HTTP/DB/native 成功。
6. `docs/planning/auto-ai-program-20261105/W20/AF-214-ROOT_WIRING.md`：原模块/服务/SDK barrel/页面/bootstrap 接线清单、具体事务实现轮廓、真实验收矩阵。
7. `docs/execution/AF-214-candidate.md`：本记录。

## 验证命令与结果

所有命令均在该子工作区执行，Node `v24.21.0`、pnpm `10.0.0`。

| 命令 | exit / 真实结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 0；独立安装 800 包，lockfile 未改 |
| `pnpm --filter @aij/api prisma:generate` | 0；原 `scripts/prisma-schema.mjs` 仅编译，环境被清理，固定不可连接 port 1，不读 env，不连接数据库 |
| `pnpm --filter @aij/contracts build` | 0；原小包产物，仅本地 ignored dist |
| `pnpm --filter @aij/sdk build` | 0；原 barrel 可达实现构建成功；新增引用模块另由本次单测严格编译并发出声明，新增公开 barrel 的真实接入仍归 root |
| `pnpm --filter @aij/ui build` | 0；原 UI 小包构建成功 |
| `pnpm --filter @aij/core build` | 0；原 core 小包构建成功 |
| `pnpm --filter @aij/runtime-contracts build` | 0；原 runtime-contracts 小包构建成功 |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/ai-knowledge-citations.controller.ts apps/api/src/plugins/aij-ai/knowledge-citation.ts packages/sdk/src/knowledge-citations.ts apps/web/app/components/client-knowledge-citation.tsx scripts/verification/knowledge-citations.test.mjs --max-warnings=0` | 0；定向 lint 通过 |
| `pnpm --filter @aij/api typecheck` | 0；实际源码和原 test tsconfig 的 noEmit 检查通过，无 API build |
| `pnpm --filter @aij/web typecheck` | 0；实际 Web noEmit 检查通过，无 Next build |
| `node --test scripts/verification/knowledge-citations.test.mjs` | 0；18 tests、18 pass、0 fail、0 skip；含新 SDK 严格 NodeNext 声明编译 |
| `git diff --check` / 提交前精确 staged diff 检查 | 0；路径仅七个授权新增文件 |

首轮单测 15/17 通过，两个实际 ClientApi 测试因测试 envelope 缺少原 contracts 必需的 message 而拒绝为 503；已补充正确 envelope 并重跑 18/18 通过。另加强原始 URL query 拒绝，避免解析器忽略原型形状参数。上述为单元修复，未以假响应替代真实验收。

Git 在共享 objects/pack 中反复输出 `non-monotonic index .../._pack-f03e767c944ca97bc7cba847811aab0e60e02cb8.idx` 警告；所需命令返回 0、961 blob 实际哈希验证成功，未修改或删除共享 Git 元数据。

## 影响、未运行项与交接

- 数据库：无 schema/migrate/seed 或数据写入；新增 helper 不接数据库。原服务事务方法与真实锁等待、时间、会话栅栏由 root 实现并验收。
- 接口：候选定义 `/api/client/ai/knowledge/questions/:questionId/citations/:documentId`；尚未接入宿主模块，不宣称接口已运行。权限只需原 knowledgeQuery，不新增 knowledgeManage 要求。返回 CURRENT 和真实 checksum，不宣称不可变历史原文。
- 页面：只新增实际组件，原问答 article 挂载归 root；不修改旧答案语义。UI 无持久化、URL、ObjectURL、日志、HTML 插入或实时网页请求。两秒授权重验属于周期检测，真实撤权到清除存在网络检测延迟，不能声称即时推送。
- 日志/Job/Run/Trace/cost：本卡未新增日志或执行写入。真实 HTTP/数据库零写入证据仍 NOT_RUN，由 root 验证。
- NOT_RUN：root `verify:task`、完整 API/Next 构建、DB/迁移/seed/Docker/server/GUI/Linux/native、真实公开安装后 SDK/HTTP/锁竞争/拒绝路径验收、vendor 调用；没有实际启动访问地址。未注册 queue/registry、未 push/PR/merge/tag/deploy/release。
- 人工验收：root 接线后，原问答中以拥有查询权限但无管理权限的成员点击查看；确认当前文本提示、标题/编号/摘录/SHA256与纯文本；再验证来源编辑 409、停用/删除 404、过期 410、跨成员/Workspace 拒绝、撤权/换会话以及关闭/隐藏/失焦后的取消和迟到响应隔离。完整矩阵见 ROOT_WIRING 文档。
- 原依赖：`task_64bbf46af804`、`task_accf9151274c`；W20 governance 的真实 I ID 在该派工正文中未给出，由 root 绑定真实依赖；候选本身不能充当 CODE_VERIFIED 依赖。
- Root 接手项：原 AiRuntimeModule + useExisting、原 AiKnowledgeService 事务方法、bootstrap 私有/parser hooks、SDK barrel 与公开构建、原 citation article 挂载、正式 verifier/质量门禁和记录队列、本地正式提交及真实 I 完成。worker 只提供候选；总控接收本次明确停止写入后独占这些工作。
- 交接：精确候选提交完成后 STOP ALL WRITING；worker_done 发送一次实际 Task/Dispatch、三段式结果与候选 SHA。禁止在交接后继续修改；最终批次出口 OWNER_CHECK_PENDING。
