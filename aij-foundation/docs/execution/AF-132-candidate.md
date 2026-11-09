# AF-132 候选交付：UI-1 陈旧验收状态显式归档

2026-11-04；候选完成，仅纯文件逻辑验证。正式注册验证、真实续建和浏览器验收由总控接手，不能据此将 UI-1 或 ORCA-B01 标为负责人已接收。

前部保留首轮三文件候选交接历史；总控随后执行的结果与本次有限测试修复扩展见文末「续接：受控基础权限目录断言」。

## 派工与写入边界

- Run：`run_d4eae5ba3a3b`；Task：`task_3e78e81ef791`；Dispatch：`ctx_7354934da18c`。
- Writer：`term_15612bb6-16e0-435e-b9cd-3f584971a306`；总控：`term_bc55f07a-bdd7-4207-8cce-91eb1f03863d`。
- 原工作区 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`，分支 `dev`，开工 HEAD `b13a3468c08c2021fed06e9aa289192dd68ca829`，remote `git@github.com:weiyang86/aij-foundation.git`。本卡上限 3 有效工程小时。
- 开工时已有总控差异：`docs/planning/CODING_QUEUE.json` 和未跟踪的正式卡 `docs/planning/orca-product-goal-20261104/AF-132.md`；均保留，未纳入候选写入。
- 仅新增 `scripts/verification/ui1-renew.mjs`、`scripts/verification/ui1-renew.test.mjs`、本记录。候选未改 registry、正式队列、Run 映射、ownerAcceptanceRecords，也未暂存、提交或 push；正式卡本地提交由总控在全部注册门禁通过后完成。

## 实际实现

新增唯一 CLI 操作，必须显式确认任务和待归档 lease，不提供自动清理、迁移或重置选项：

```sh
node scripts/verification/ui1-renew.mjs archive --task AF-029 --acceptance b256f19c7593d266
```

此命令只供总控完成串行运行切换后执行；候选 Writer 没有对真实状态运行该命令。归档命令本身不会创建新库或启动 Web/API。

1. 要求 `manual.json` / `web.json` 同时存在，记录均归 AF-029 和显式 lease；核对 database、API PID 与 Web 引用、预期进程命令/CWD/出生记录、同一测试库的凭据位置。验证原 lease 的 task/id/mode/ready/repository/database，以及 test owner 的 project/mode/repository/instanceId 归属，不连接数据库。
2. 要求 lease 的合法 Schema SHA-256 与当前 `apps/api/prisma/schema.prisma` 原始字节 hash 不同。无完整旧状态、同快照或伪造归属均拒绝；这些前置拒绝不会新建目录、锁或归档。
3. 旧 Web/API 每个 PID 必须明确不存在；默认使用信号 `0` 查询，只有 `ESRCH` 视为不存在。存活、PID 复用和无法确定都拒绝，不发送终止信号；使用既有 IPv4 loopback 端口探测确认 3655/3656 可用。
4. 独占获取与既有 prepare/stop 共用的 `web.lock` → `manual.lock`；锁冲突拒绝，重新核验原始状态、lease、owner、Schema、进程和端口。
5. 在 `.artifacts/af-029/renewals/<lease>/<UUID>/` 独占写入两份状态的原始字节，读回校验，持久写入 `manifest.json`。清单记录每份原状态的 SHA-256/长度/来源、原 lease hash、新旧 Schema hash、续建操作及恢复规则；仅记录凭据路径，不读取或打印凭据内容。文件和所有新目录的父目录完成 fsync 后，再次检查进程、端口、源文件和归档副本。
6. 最后才解除两份旧活动指针，持久写入 `complete.json`，返回 `ARCHIVED_FOR_RENEWAL` 与归档路径。数据库、卷、凭据、JWT key、原日志、lease 和历史快照均不改动。

归档保留原状态的空白、换行和 Unicode 原字节。它没有修改产品 API、Schema、页面、菜单、权限、AI 数据或负责人验收结论；新增运行痕迹仅为上述归档文件与操作锁。

## 失败与恢复

中途失败不会删除归档证据。已解除的指针尝试以独占创建方式按原字节恢复，不覆盖已有文件；恢复失败保留双锁，返回 `RECOVERY_REQUIRED_LOCKS_RETAINED`，阻止既有 prepare 隐式续建。失败记录为 `failed.json`；它优先于可能已落盘的 `complete.json`。成功解除状态后若锁清理失败，返回 `LOCK_RELEASE_FAILED` 和归档位置，保留锁供总控核验。

发生失败/中断后，总控先确认该操作已停止、两个旧 PID 不存活、固定端口空闲及锁归属。检查归档清单和两份副本 hash：缺失源文件用 `fs.copyFileSync(archive, source, fs.constants.COPYFILE_EXCL)` 独占恢复；已有源文件必须先匹配原 hash，差异时停止，不覆盖。两份源均恢复并核验后，才能由总控解除本操作遗留锁，再显式重试；保留失败 attempt。只有 `complete.json` 存在且没有 `failed.json` 的成功 attempt 才进入正常续建；锁清理失败时还须先完成锁归属核验。不能手工改快照、迁移历史库、重置旧账号或删除其他状态兜底。

## 验证结果

- `node --test scripts/verification/ui1-renew.test.mjs`：首轮 48/48；自查补强父目录持久化、归档重检、晚期完成失败和锁清理失败后，最终 **51/51**，fail/cancelled/skipped/todo 均 0，exit 0。
- `pnpm exec eslint scripts/verification/ui1-renew.mjs scripts/verification/ui1-renew.test.mjs --max-warnings=0`：首轮通过；增加锁清理错误处理后曾触发 `no-unsafe-finally`，已将清理和错误传播移出 finally，最终 exit 0。
- 三个新增文件各自以 `git diff --no-index --check /dev/null <file>` 检查空白，输出均为空；no-index 对新增差异返回 1，这是差异退出码，不记作命令 exit 0。普通 `git diff --check` exit 0。

测试使用临时目录、合成 lease/owner/凭据和可注入进程/端口/文件适配器，没有创建数据库、启动服务、占用固定端口或调用真实归档。覆盖未知任务/无效参数、缺失或部分状态、同快照、18 类归属/路径伪造、活进程/未知存活、两个端口拒绝、双锁冲突、原字节归档、保留文件字节与权限、重复归档拒绝、复制写入/损坏/意图写入/第二指针解除/完成写入失败、回滚失败保锁和独占手动恢复、归档时进程/Schema/副本变化、父目录持久化顺序、晚期完成失败恢复及锁清理失败。这些验证不能替代真实 AF-029 数据库和浏览器验收。

## 总控接手与人工操作单

候选 Writer 到此明确停止写入，将三个文件交总控接收；没有真实新 URL、凭据或运行版本报告可交付。总控需按顺序完成：

1. 注册 AF-132，运行 `pnpm run verify:task -- AF-132` 及适用 lint/diff 门禁，保留正式证据。
2. 再次确认旧实例归属、退出状态和 3655/3656 空闲，执行上方显式归档命令并核对 manifest、两份状态 hash、complete/failed 记录及历史 lease/凭据保持。
3. 运行 `pnpm run verify:task -- AF-029`，随后 `pnpm run verify:task -- AF-029 --prepare-manual`；沿既有 createAcceptance/migrate/seed 为当前 Schema 新建随机 AF-029 合成库，禁止复用或迁移旧库。
4. 用新实例报告的 URL 和该新库的本机凭据位置，检查空表单拒绝、错误密码拒绝、正确登录、刷新保持、退出、匿名直访拒绝。不能将 AF-029 旧凭据用于 AF-124 的 13655 入口。
5. 记录新 lease、版本/构建、真实 URL、凭据位置、归档索引和浏览器证据，保留全部历史 ownerAcceptanceRecords 字节/语义，出口最多 `OWNER_CHECK_PENDING`。
6. 完成执行记录/队列更新，按正式卡原名作精确本地提交，不 push，再完成集成 Task。AF-130 仍等待负责人答复，不从本候选成功推断可启动；AF-129 不重做。

候选范围内无遗留实现阻塞；真实数据库、构建、运行切换、正式验证、浏览器路径和本地提交尚由总控完成。

## 续接：受控基础权限目录断言

### 派工与历史失败

2026-11-04 总控交回有限扩展：Task `task_513ff54d23ec`，Dispatch `ctx_7c0680378f0f`，Writer `term_28d8a2013ff00fb01958e4f3b1043f6a`；仍在 AF-132 原 3h 预算内。续接前核验 `dev@b13a3468c08c2021fed06e9aa289192dd68ca829`；已有 registry、正式队列、正式执行记录、原三文件候选及正式卡均保留。

总控报告 AF-132 正式验证 `run-UGzp8g` 的 51 项已通过，真实旧 AF-029 指针归档成功，旧库/凭据未改。完整 AF-029 `run-AzFp1v` 的 auth-http 失败，历史失败报告原样保留，不能记为通过。只读诊断 `.artifacts/orca-b02/AF-132/auth-http-failure-diagnosis.json` 显示 fresh AF-013 已迁移库的 `ClientWorkspacePermission` 为 4 行；其它未授权业务表为空。历史全表空断言忽略了这份迁移目录，断言异常被 `withDatabase` 包装为 `UNAVAILABLE`，不据此认定服务不可用；本扩展没有修改该包装逻辑。

### 四行真值与唯一策略

固定目录来自 `apps/api/prisma/migrations/20261102000000_ai_knowledge_document/migration.sql` 和 `20261104020000_general_ai_runs/migration.sql` 的 INSERT，每份恰好两行：

| id | code | name |
| --- | --- | --- |
| `aij_workspace_ai_execute` | `workspace.ai.execute` | Workspace AI execute |
| `aij_workspace_ai_read` | `workspace.ai.read` | Workspace own AI results read |
| `aij_workspace_knowledge_manage` | `workspace.knowledge.manage` | Workspace knowledge manage |
| `aij_workspace_knowledge_query` | `workspace.knowledge.query` | Workspace knowledge query |

全部 `status = active`，`description = NULL`，`deleted_at = NULL`。每份 INSERT 用 `CURRENT_TIMESTAMP` 同时初始化 `created_at` / `updated_at`，同条 INSERT 两行共享时间戳；它们是运行时生成的时间，不伪造固定日期。

`20261029030000_client_workspace/migration.sql` 建立主键 id 和 `client_workspace_permission_code_key` 唯一 code；上述两份 INSERT 均 `ON CONFLICT (code) DO NOTHING`。产品 `client-workspace-management.service.ts` 的 `ensurePermissionCatalog` 使用 `createMany(skipDuplicates: true)`，再验证每个 code/name/status/deletedAt；它是 Workspace 业务流程，不是这三份 fresh 核心认证测试的基线，因此没有把完整业务权限目录或任意其它记录放行。两份迁移只向既有有效系统 OWNER 角色授权；这些 fresh 测试没有 Workspace 角色，角色/授权表仍必须为空。

### 精确 diff 与影响

- 新增 `scripts/verification/client-workspace-permission-baseline.mjs`：显式 `SELECT *` 获取全列并按 code 排序，要求恰好上述四行、恰好 8 个字段；逐字段匹配 id/code/name/description/status/deleted_at，并要求非空有效 Date 时间戳、每行创建/更新时间相同、同一迁移的两行创建时间相同。新增列、缺列、多行、缺行、重复或变更目录均拒绝。
- 修改 `auth-http.test.mjs`、`rbac-http.test.mjs`、`admin-users.test.mjs`：先执行精确目录断言，再遍历原 DMMF；仅已被完整验证的 `ClientWorkspacePermission` 不再断言零行。原九项核心模型允许名单不变，所有其余业务表继续逐表严格计数为 0，并增加模型名错误提示。
- 原有全部认证/越权/审计/敏感数据/停机/种子幂等请求与断言保留。没有改产品逻辑、Schema、迁移、数据库、服务、端口、菜单、权限数据、registry、正式队列或历史 ownerAcceptanceRecords，也没有暂存、提交、push。

### 本轮验证与交回

- 定向 lint：`pnpm exec eslint scripts/verification/auth-http.test.mjs scripts/verification/rbac-http.test.mjs scripts/verification/admin-users.test.mjs scripts/verification/client-workspace-permission-baseline.mjs --max-warnings=0`，exit 0。
- `node --check` 上述四个代码文件，全部 exit 0；没有执行这三个数据库测试文件。
- 一次纯内存 `node --input-type=module` 自查：直接从两份 SQL INSERT 提取四行静态真值，核对唯一索引与冲突策略；四行正确目录通过，17 种缺行/额外行/重复/各字段错误/时间戳错误/列变动均拒绝，exit 0。日期仅为这次纯函数检查的合成值，不是数据库证据。
- 一次纯文本 `node --input-type=module` 对照 HEAD：三文件子测试数量不变，除被替换的原全表空循环外，已有 assertion/request 行全部保留，原核心模型名单不变，exit 0。
- `git diff --check` exit 0；新增 helper 与本记录的 `git diff --no-index --check /dev/null <file>` 均无空白错误输出（新增文件差异退出码为 1）。

本轮新增/修改仅上述 helper、三个测试和本记录。扩展候选自查与 lint 完成，Writer **明确停止写入并交回总控**；真实 AF-013/014/015 及 AF-029 完整注册数据库回归、prepare-manual、浏览器六路径、版本/入口/凭据报告与精确本地提交仍由总控串行完成，历史失败证据继续保留。真实验证未执行，不能从本轮纯检查推出 AF-029 已通过或负责人已接收。
