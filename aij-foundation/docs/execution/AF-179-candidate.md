# AF-179 候选交付记录

任务原名：**接入知识网页导入与来源元数据接口**。状态：**CANDIDATE / NOT CODE_VERIFIED**；本地候选提交不代表集成、独立复核或负责人接收，批次出口仍为 OWNER_CHECK_PENDING。

## Writer 与基线

| 项 | 实际值 |
| --- | --- |
| Worktree | `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W11-AF179` |
| Runtime identity | `wt2:local:b4a14588-1b66-4c20-8864-845673395ac7` |
| Task | `task_51abecfc89f7` |
| Dispatch | `ctx_5a048a5c994f` |
| Worker terminal | `term_f653bcaf-c955-46ba-b535-4750be9adb41` |
| Coordinator terminal | `term_a1b633bc-6ace-4602-868a-dc2c12c5849e` |
| Branch | `weiyang86/AIJ-W11-AF179` |
| 起始 HEAD / origin/dev | `94b0236f775fa40a07944c5e0545ac6ce0e123f3` |
| origin fetch/push | `git@github.com:weiyang86/aij-foundation.git` |
| 起始 status | clean，仅上述分支，无继承/用户差异 |
| Bootstrap source | 同仓 `b7783dca67475a116e9a72a922fdba293e16cb57`，逐一验证派工清单全部 20 个 SHA-256；19 个文件有实际差异 |
| 独立 bootstrap commit | `5780e4a796a7acd87b02166af63905a19518ed77` |
| Writer 时间 | 2026-11-06 03:16 左右开始，约 0.4h，<=1.25h；单卡总预算 3h 包含 root，余量约 2.6h 供集成验收 |

bootstrap、源码、scratch/type/test、回归修正、文档/提交各写入阶段均在当前 worktree 回读 `git status --short --branch`、HEAD、branch 与 remotes；bootstrap 后各阶段 HEAD 均为 `5780e4a...`，变化只有本卡 allowPaths 与 ignored 自有 `.artifacts/af179`/依赖/小包输出。没有改 dev/main/远端引用/正式队列/registry/AGENTS；主工作区和轻企仓库未写入，未启动数据库、Docker、API/Web 或客户 URL 访问，未复制环境/凭据/数据/依赖目录。

## 实际差异与影响

- `ai-knowledge.service.ts`：AiKnowledgeService 保留唯一文档 Writer；新增受信内部网页来源联合类型，网页才保留精确正文与前导 TAB、默认 inactive，并原子写入四字段及仅 ID/status 审计。原手动/文件/CSV 写入默认、trim、checksum、现有字段/权限不变。网络前短事务与网络后正式事务两次核验实际会话、tokenVersion、成员/角色/grant/workspace、插件生命周期、项目/组织；网络/parse 不占用事务。来源读取再次核验并锁住当前 scoped 未删除行，正文只在内存用于 `contentMatchesSource` 比较。
- `ai-knowledge.controller.ts`、`ai-knowledge-web-import.dto.ts`：新增 POST import-web / GET :id/web-source，严格 sameOrigin、未知 body/query 拒绝、GET 无 body、受限 metadata、固定错误/私有缓存策略。Object 类型参数避免全局 whitelist 先静默剥除未知字段，已用真实 global ValidationPipe 验证。导出 root 早期 privacy/parser-error middleware，覆盖授权失败及坏 JSON/413 的接线仍由 root 完成。
- `knowledge-web-import.ts`：实际 AF171 reader + AF174 parser 默认组合，不接收不可信 resolver/CA/headers/provider/cache 选项；完整原始/最终规范 URI、原 bytes 与精确正文 hash、固定 extraction policy。64KiB 全量拒绝不截断，固定 safe error。可选 DI token 仅供可信 root 组合与 owned TLS 验收。
- `packages/sdk/src/knowledge-web-imports.ts`：严格三个输入字段，复用实际 ClientApi/Workspace header，无隐式重试；提供 importWeb/getWebSource、返回类型。真实 index 未改，公开包导出由 root 接线。
- `AF-179-schema.prisma` / `AF-179-migration.sql`：仅四个 nullable additive 字段及 complete-together/形状/长度/hash/marker/version/status SQL 检查提案；生产 Schema、旧 migrations、关系与默认值保持 bootstrap 原样。
- 两个 verification 脚本、开发文档与本候选记录：source/type/compiled SDK 离线验证，以及 root-only fresh PG/真实 HTTPS/API/PluginLifecycle/SDK 套件和具体 adapter/资源释放契约。

数据库影响：候选本身 **无 DB 操作**，SQL 只提案；root 迁移后旧行四字段 null 不受影响。接口影响：新增两路由；页面影响：无 UI；权限影响：只复用 workspace.knowledge.manage；日志/审计影响：不新增日志输出、网页审计无 URI/正文/raw HTML/headers/异常/source hashes，普通 list/PATCH/create select 不返回来源 URI，仅受限 metadata GET 返回精确 URI。

## 验证及失败记录

| 命令/检查 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS，733 个包在独立 worktree 安装，无 manifest/lock delta |
| contracts/runtime-contracts/core/sdk 小包 build | PASS；原 SDK index 保持只读，新模块由定向编译单独验证 |
| proposed-schema scratch `prisma generate` | PASS，`.artifacts/af179/client`，干净编译环境/port 1 合成 DSN，无生产 client/schema mutation、无 DB |
| 目标 `tsc --noEmit` + source suite 中真实 TS program | PASS，实际 service/controller/helper 及依赖闭包对 scratch proposed client，无 `any` / `as unknown` 藏模型错配 |
| `node --test scripts/verification/knowledge-web-import.test.mjs` | PASS，12 tests，0 fail/skip；输出 `.artifacts/af179/source-tests.txt` |
| 目标 7 文件 `eslint --max-warnings=0` | PASS |
| `node --check scripts/verification/knowledge-web-import-live.test.mjs` | PASS，仅语法，不执行 DB/TLS/API |
| `git diff --check` | PASS |
| root `verify:task` / 生产 Schema generate/API build / fresh AF179 PG + real TLS/API live suite / 实际公开 SDK pack/types / 既有 CSV/knowledge HTTP-DB 回归 / browser | **NOT_RUN（root 独占且 Worker 禁止）** |

离线 12 项覆盖实际 DTO/global pipe、URL 原始/最终规范化、exact 64KiB、默认真实 reader 和默认 import transport 的非法/private URI 拒绝、synthetic private DNS connect 前拒绝、实际 parser 前导 TAB/body hash、inactive 原子创建/来源投影、网络前及持有响应期间撤权后零写入、oversize/UTF8/parser/hash/transport safe refusal、重复码/审计 rollback、旧 manual/file/CSV，以及新增 SDK 编译 ESM/CJS/types 消费实际 ClientApi/no retry。事务 double 不是 PG 锁证明；synthetic body 不是默认 TLS 证明。

保留失败证据：首次目标 tsconfig 使用 scratch 相对 rootDir 导致 TS6059，改为真实 source 绝对 rootDir 后通过；首次 source runner 的 scratch client file-URL/CJS 解析失败，改绝对文件路径后通过；初版 test double 断言使用了已被事务 clone 替换的旧对象引用，另 SDK synthetic envelope 缺少真实协议 message，修正测试装配后所有断言通过。没有跳过断言、放宽门禁或把这些失败/未运行标为真实 DB/TLS 通过。

## 总控交接与人工步骤

代码/测试/schema SQL/开发文档详见 [KNOWLEDGE_WEB_IMPORT](../development/KNOWLEDGE_WEB_IMPORT.md)。root 须先完成真实 I177，再集成候选 delta（bootstrap 已有源可不重复接收），将四字段、迁移、早期 middleware、模块 token test seam、SDK index 与五 guards/fixture/registry 接线；运行真实 build/verify:task、owned HTTPS held response 后撤销会员/会话/角色/grant/workspace/项目/组织及真实插件 disable 零写入、审计真实 rollback、inactive→原 PATCH 激活的检索、元数据 foreign/readonly、人工编辑 mismatch、默认编译 transport private/invalid URI、实际公开 SDK 双模块/types 消费与 sockets/pools=0。

没有已运行访问地址。root 实际服务启动后，人工使用拥有 knowledgeManage 的会话在当前 workspace 导入合成网页，确认 inactive 与来源 URI/hash；active 检索应查不到该文档，用现有 PATCH 明确激活后可检索；再修改正文确认 contentMatchesSource=false，重复编码不能覆盖，切换 foreign/readonly 会话不能读取该来源。无新增 UI、自动更新、304/history/index/embeddings 或个人 Agent/Skill owner 规则。

Writer 完成定向检查与 exact-title 本地候选提交后声明 **STOP ALL WRITING**，worker_done 一次性交回实际候选 SHA、路径、证据和 NOT_RUN；此后停止本卡所有写入，不自动续卡、不 push。总控正式接收前不得将本卡标为 CODE_VERIFIED；下游仅引用真实 I179 集成 Task ID，不引用本候选 Task 充当依赖已完成。
