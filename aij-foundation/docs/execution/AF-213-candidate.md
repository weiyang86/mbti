# AF-213 候选执行记录

状态：CANDIDATE_ONLY，非 CODE_VERIFIED / 非负责人接收。任务名与候选提交标题：`提供个人Python Skill执行管理页面`。本记录随候选提交；实际 candidate SHA 在 worker_done 中交回，总控应以该 SHA 精确集成六个新增路径。

## 身份与不可变来源

- actual Task `task_a38b13e8889d`；Dispatch `ctx_97ba38a1c028`；Writer terminal `term_6755f661-e413-4aeb-b8bd-4708ed952191`。
- 注册 Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W20-AF213`；instance `4ca41c2f-d727-4880-b862-e5cfde372295`。
- branch `weiyang86/AIJ-W20-AF213`；initial HEAD / 实际 origin/dev 均 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；初始 clean；remote `git@github.com:weiyang86/aij-foundation.git`。
- 先读主工作区 AGENTS、CONTRACT（SHA256 `9c40f7e10b129535fc2fd490f58b86ba4212d1a0ad4473b216b805827ca8b40c`）、SOURCE_BOOTSTRAP.json（SHA256 `0dd96fc9dbe0b3652a2f1d82e577d1aeb39a36ea2d897ea1673f0e6da653220b`），均匹配派工。
- 唯一实现来源 `129aa515b5c7fd8a3269d97b3521136fc641f59d`；只用 `git cat-file --batch` 读取 manifest 列出的 961 blobs，逐项 SHA256 核验后物化。未复制 live root 实现、pending AF191/203 或用户修改，未切换分支。
- bootstrap commit `820999e2df58cec895d63ffc95ae84ac15301f90`，标题 `W20 verified source-only bootstrap`，463 files changed（剩余清单文件本来相同）；总控不要 cherry-pick 此提交。
- Git 读写命令曾打印共享对象库中的 `._pack-*.idx` non-monotonic index 提示；实际命令完成、源 blob hash 匹配，未修改或删除共享 Git 对象库。

## 精确 allowPaths delta

全部为 NEW，候选提交只包含这些路径：

1. `apps/web/app/components/client-personal-script-panel.tsx`：原 AntD/adminTheme/PageHeading 面板，真实 SDK 组合，源码确认、版本引用/digest、能力状态、严格 JSON、一次明确提交、手动 GET 与 SUCCESS 下载。
2. `apps/web/app/components/client-personal-script-state.mjs`：当前 me/context/role/permissions/head 前后校验、scope/blur/hidden/超时 epoch 隔离、RAM 原写入锁、版本未知 head 核对、原 key 恢复、终态明确确认、输出清零与 URL 撤销。
3. `apps/web/app/components/client-personal-script-state.d.mts`：实际 store 类型；沿用现有 `.d.mts` 局部 unused-vars 规则豁免，避免已安装 parser/plugin 对函数声明签名崩溃，仍由 tsc 验证。
4. `scripts/verification/client-personal-script-state.test.mjs`：实际状态控制器 + 实际已编译公共 SDK，合成传输仅作单元分支证明，不当作真实 HTTP/DB/沙箱/浏览器证据。
5. `docs/planning/auto-ai-program-20261105/W20/AF-213-ROOT_WIRING.md`：总控固定挂载、原权限、真实 I 依赖与验收接线说明。
6. `docs/execution/AF-213-candidate.md`：本候选记录。

没有更改数据库/schema、Controller/API、权限注册、日志、全局依赖、SDK barrel、原页面宿主、正式 registry 或队列。没有新 Skill/Job/File owner，没有 Agent binding、网络/tools/input files/多包/market/admin enable 功能。页面宿主实际挂载由总控做，当前没有运行访问地址。

## 命令与结果

| 命令 / 检查 | 实际结果 |
| --- | --- |
| `orca worktree current --json`，git status/branch/HEAD/remote，contract/manifest sha256 | exit 0，实际身份与基线匹配；首次已按派工向总控报告 |
| `git cat-file --batch` + Python SHA256 per blob | exit 0，961/961 MATCH；bootstrap 独立提交 |
| `pnpm install --frozen-lockfile --ignore-scripts --package-import-method=copy` | exit 0，800 packages，本工作区私有 node_modules；仅复用下载缓存，没有共享 node_modules/env/secrets/uploads |
| `pnpm --filter @aij/contracts build` | exit 0，小包构建 |
| `pnpm --filter @aij/sdk build` | exit 0，小包构建，实际 SDK 被新增单测加载 |
| `pnpm --filter @aij/ui build` | exit 0，小包构建 |
| `pnpm exec eslint apps/web/app/components/client-personal-script-panel.tsx apps/web/app/components/client-personal-script-state.mjs apps/web/app/components/client-personal-script-state.d.mts scripts/verification/client-personal-script-state.test.mjs --max-warnings=0` | 最终 exit 0；最初 `.d.mts` parser 崩溃和 React ref lint 已在 allowPaths 内修正 |
| `pnpm --filter @aij/web typecheck` | exit 0，无 Next build；新声明和实际组件通过 noEmit |
| `node --check` 新 state / 新 test | exit 0 |
| `node --test scripts/verification/client-personal-script-state.test.mjs` | 15/15 PASS、0 skip、exit 0，实际最终 TAP 断言汇总 |
| `node --test scripts/verification/personal-script-api-sdk.test.mjs` | exit 1，导入缺 `.prisma/client/default`，原组合断言 BLOCKED_NOT_RUN；没有伪造成功或复制生成 client |
| 全 manifest 源 blob 复核、候选 path 白名单、`git diff --cached --check` | 961/961 immutable hash 未变，精确六个 NEW allowPaths，无 inherited tracked/index 差异；候选暂存后检查 exit 0，不替代真实验收 |

新增单测覆盖：严格 JSON 的重复 decoded key、原型键、深度/数量/字节/Unicode/非有限值；单个源码版本 POST；仅显式提交一次；无源码管理权限的执行；资产管理/源码管理/AI execute/read 分离；配置关闭仍可读授权结果；null/失焦/切会话后锁保留；迟到 POST、download 和超时响应隔离；原 key 手动 GET；401/403/404/409/410；未知版本复读 head + 独立确认；UNKNOWN / CLEANUP_UNCONFIRMED 不解锁；SUCCESS 下载元数据/bytes 校验、消费清零、撤销 Blob URL。

## 未运行、人工验收与交接

NOT_RUN：root `verify:task AF-213`、正式注册/队列、真实 HTTP/DB/事务/沙箱/Python/Docker、GUI/浏览器下载、完整 API/Next build、Linux/native、vendor。没有启动 server、没有 migrate/seed/database 节点、没有 GUI、push、PR、tag、main、deploy、release。没有运行 URL；人工验收步骤与原宿主组合见 AF-213-ROOT_WIRING.md。

原 CODE 依赖 `task_ac8e218b1859`，W20 governance 实际 I ID 由总控补充核实，不能以本候选 Task 代替真实集成依赖。保持所有历史 `NOT_RUN_TARGET_ACCEPTANCE` / `DEFERRED_NOT_PASSED` / owner `PENDING`。

Worker 有效工程用时约 0.35h（向上取整，含 bootstrap、私有安装、实现、修复、验证与记录；低于 1.75h worker cap；整卡 3.5h 含总控）。候选提交后 STOP ALL WRITING，交接后不再修改文件；总控拥有挂载、共享文件、真实验证、registry/队列及正式精确原名提交。自查是同一 Writer 自查，不冒充独立复核。
