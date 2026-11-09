# AF-231 · 统一个人Agent日志的文档生成恢复端口

候选交付，**not CODE_VERIFIED / owner acceptance pending**。仅本卡 allowPaths 新增；原 controller 实际接线、正式 verify:task 和真实 API/PG/浏览器验收留给 root。自查是同一 Writer 自查，不是独立复核；W23/W24 人工验收 PENDING、40 项目标及历史失败均未改写。

## 身份与基线

- Task：`task_99e42f0b8b56`；Dispatch：`ctx_f66612ffb091`。
- Worker terminal：`term_7f7c389f-c9da-4b09-bbef-16d84628ba28`；coordinator：`term_26cef18e-31e9-4c43-8f62-bd8db5c92ea5`。`orca terminal show` 确认本 terminal 在本 Worktree；未读写其他 terminal。
- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W25-AF231`；instance `419b1508-9973-4a75-bdfa-317c296386a7`。
- 已注册 child，parent 为本仓库 root Worktree；Orca 创建时间 `2026-11-09T02:05:46.422+08:00`。
- 分支：`weiyang86/AIJ-W25-AF231`；初始 status 只有该分支标头，clean。
- 初始 HEAD = `origin/dev` = `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；remote fetch/push 均 `git@github.com:weiyang86/aij-foundation.git`。
- 唯一源码基线：`46079d20b55b4c581cc5cd0a8464ad2e0dd55326`。root 只读取精确 `W25/CONTRACT.md`、`W25/SOURCE_BOOTSTRAP.json` 规划文件；未读 root live 源码、用户交接 JSON/HTML/原型、真实 env/凭据/local-data。
- bootstrap 清单原字节 SHA256：`105443376feda721bcc0196921333f655a9f0f9aeb0a6d4c8dea7664e0bb7001`；完整载入 1112 项，逐项核对源 tree mode/OID、`git show OID` blob 的 Git SHA1、SHA256、bytes，落盘后再次核对 bytes/mode。无 symlink、live copy、merge/cherry-pick。
- source-only bootstrap SHA：`5dbb327ecd600427abb67394752984279f2cdbf9`，标题 `AF-231 source-only bootstrap from verified Git blobs`。这只恢复源清单，不是本卡实现提交；root 不得整段接收此提交。
- candidate SHA：本记录所在的中文原名候选提交；实际完整 SHA 在 worker_done 回执中交回，避免自引用 SHA 改写。候选差异以 `git diff 5dbb327ecd600427abb67394752984279f2cdbf9 <candidateSHA>` 审查。

Git 查询和 bootstrap 遇到共享 Git object store 内 `._pack-…idx` 的 `non-monotonic index` stderr；相关 Git 命令 exit 0 且逐项 blob/hash 校验通过。未修改或清理共享 `.git`；这是仍存在的环境告警，不隐去为无告警。

## 实际差异与边界

1. `apps/web/app/components/client-personal-agent-request-journal.mjs`：统一错误、原 key、严格 parser、完整 entry/ref equality、family selector、guarded read/locked/CAS storage facade，以及 document JournalPort。
2. 同名 `.d.mts`：原 SDK 的 DocumentGenerationRef/Envelope/Recovery 结构类型和冻结 JournalPort/storage facade 声明，不引用未来 sibling。
3. `scripts/verification/client-personal-agent-request-journal.test.mjs`：26 个实际实现行为测试；用 Node 原生 exclusive Web Locks，StorageLike 为同步 Map backend，未 mock CAS。
4. `docs/planning/auto-ai-program-20261105/W25/AF-231-ROOT_WIRING.md`：旧 owner 精确最小替换、端口生命周期、真实验证与 root 后续责任。
5. 本执行记录。

仅同一原 bucket/原锁名，version 1、16384 字符、32 entry；旧 entry 仍精确 8 键，新 entry 多 family/origin/attempted。旧 family 按 workspace/agent、新 family 按 workspace 唯一；CAS 不改其它 family/空间的 entry JSON 键序、字段、字符串。expected 比较包括完整 metadata 和规范字段顺序的完整 ref；不会凭部分 identity 删除或覆盖。

submit 在同锁先保存 attempted:true、原字符串读回、再次 CAS 比较，之后最多一次 send；无锁/损坏/上限/写失败/不一致阻止新发送。断联、abort/timeout/晚到只保留；suspend 清 RAM 并取消 epoch，不删持久 entry。bind 不得换 origin/runId；ACK 每次重新执行 verify，只有精确匹配已绑定 run 的 succeeded/settled 或 failed/released 可删，未知/404/410/异常仍锁定。documentCurrent=false 不授予输出读取权限。

影响：没有 schema/DB/migration/seed、API route、权限定义、日志落盘、页面 DOM 或正式依赖/lockfile 改动；不存 body/instruction/output/session/token。独立 node_modules 来自本 child 的 frozen install，无共享上传/凭据；仅 contracts/sdk 小包生成忽略的 dist。模块不启动服务、poll、付费调用、发布或 push；执行旧基线套件时其已有单元测试内启动并关闭短时 synthetic loopback HTTP fixture（无外部网络或真实 API 服务），已在命令表明确记录；未启动常驻 API/Web 服务，本轮没有可声称实际运行的新 UI/API 地址。

## 命令与结果（包含失败）

| 命令/阶段 | exit | 真实结果 |
| --- | --- | --- |
| `pwd`、两个技能 SKILL 读取、`orca skills get orchestration` / `orca-cli` | 0 | 读取派工/CLI 指南，无 helper Worker |
| `printenv ORCA_CLI_COMMAND ORCA_DEV_REPO_ROOT ORCA_TERMINAL_ID` | 1 | 三个变量未设置；按技能使用默认 `orca`，不是测试通过 |
| `git status --short --branch`、HEAD/remote/origin/dev、`orca worktree current --json` | 0 | 注册 child/clean/精确初始 SHA 符合；Git stderr 告警如上 |
| 精确 CONTRACT 全文读取、SOURCE_BOOTSTRAP 全字节解析/hash | 0 | 契约与 1112 blob 清单确认 |
| bootstrap 第一次 Python 脚本 | 1 | 在 `.gitignore` 与冻结源不同处触发过严断言，尚未落盘/暂存；不掩盖失败 |
| bootstrap 修正脚本 | 0 | 初始 clean 已证实后允许清单覆盖 tracked 基线版本；先完整核验 1112 项再落盘，独立提交如上 |
| `pnpm install --frozen-lockfile` | 0 | 本 child 独立安装 800 packages；pnpm 默认未运行列出的依赖 build scripts；未开启这些脚本 |
| `node --check apps/web/app/components/client-personal-agent-request-journal.mjs` | 0 | 新模块语法通过 |
| 定向 eslint（新 `.mjs`、`.d.mts`） | 0 | 通过 |
| 新行为测试第 1 次 | 1 | 24 项中 15 pass/9 fail；测试 fixture 共享 owner 被 descriptor 用例改写，另有 JSON 对 -0 规范化、大小阈值假设问题 |
| 新行为测试第 2 次 | 1 | 23 pass/1 fail，另捕获持久化期间 abort 引发的真实未处理拒绝；修复 race 在已 abort 时也总接住底层 promise |
| 新行为测试第 3 次 | 1 | 23 pass/1 fail；固定 entry 个数未真实耗尽字节上限，改为计算合法满 bucket 后再验证新 entry 超限 |
| 新行为测试第 4 次 | 0 | 24/24 pass，无 unhandled rejection；测试/实现修复均在本 Writer 中 |
| `pnpm --filter @aij/contracts build` | 0 | 小包成功 |
| `pnpm --filter @aij/sdk build` | 0 | 小包成功 |
| 定向 eslint（新模块/声明/测试，`--max-warnings=0`） | 0 | 通过 |
| TypeScript isolated declaration `createProgram`，strict/NodeNext/ES2022+DOM/noEmit、types=[]、不跳过声明检查 | 0 | 新 `.d.mts` + 实际 SDK 类型依赖，0 diagnostics |
| `node --test scripts/verification/client-personal-agent-run.test.mjs` | 0 | 原未改 owner 的 21/21 离线基线通过；内含原 synthetic loopback HTTP fixture，不是完整 API 服务/数据库验收 |
| 新测试补充 pre/post-send CAS 冲突和 5 个 SDK status 后运行 | 0 | 26/26 pass，真实新实现 + 原生 Web Locks；CAS 本身未 mock |
| `orca terminal show`、`wc`、定向 status/diff 查询 | 0 | 身份及范围记录，未操作其他 terminal |
| 最终新模块/声明/测试定向 eslint | 0 | 补充测试后通过，0 warning |
| `git diff --cached --check` / `--stat` 与五 allowPaths 集合断言 | 0 | 空白检查通过，仅五个候选新增文件暂存 |

可复现主行为命令：

```sh
node --test scripts/verification/client-personal-agent-request-journal.test.mjs
pnpm exec eslint apps/web/app/components/client-personal-agent-request-journal.mjs apps/web/app/components/client-personal-agent-request-journal.d.mts scripts/verification/client-personal-agent-request-journal.test.mjs --max-warnings=0
node --test scripts/verification/client-personal-agent-run.test.mjs
```

自查重点：同锁两实例只发一次；attempted 先于 send；存储缺锁/失败/写后不一致和 pre-send 完整 CAS 不匹配均零 send；post-send 冲突不覆盖现存记录；早/晚 abort、超时忽略、queued lock、suspend、当前/其它 family/空间保留；ACK fresh verify、未知/拒绝保留、二次 CAS、当前文档不一致只安全终结；不存在第二 key 或永久 output 缓存。

## NOT_RUN 与交接

NOT_RUN：root 原 controller 实际导入新 owner 后的全回归；注册正式 `verify:task AF-231`；全 API/Next 构建；浏览器 localStorage/Web Locks 的真实双页面竞争；真实 API/Auth/隔离 PG/runtime/权限成功拒绝路径；DB/migrate/seed；native/390px/供应商请求。它们没有被这些离线测试代称通过；超出候选派工的操作由 root 独占。

root 先按 ROOT_WIRING 实际替换旧私有 read/locked/CAS 与 family find，再注册本卡验证、执行真实门禁、更新正式记录/队列、按原名提交完成真实 I231。后续 I232/I233 依赖真实 I Task ID；不可把此 candidate 的 Task/Dispatch 当 CODE_VERIFIED 依赖。人工验收至少核对旧请求可恢复且不会路由到文档生成；两页竞争只一次提交；丢响应重新挂载不自动提交；显式原 key recover；unknown/404/410 不解锁；安全 ACK 再次 GET 后只移除选中条目；日志中无正文或凭据。

工时：从 Orca 注册时间 02:05:46+08:00 到本记录收尾 02:22:00+0800，保守 wall clock 16.24 分钟（0.271h，包含恢复、安装、失败修复、自查、记录）；提交/交接最终精确分钟在 worker_done 交回，Worker 1.25h 上限内，不计作 root 已完成真实集成验证。候选提交后 **STOP ALL WRITING**，仅回读 SHA/status 并一次 worker_done；未 push、不续卡、未启动其它 Worker，root 接收后成为唯一后续 Writer。
