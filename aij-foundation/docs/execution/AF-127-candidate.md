# AF-127 / ORCH-GEN-01 Worker 候选交接

任务标题：新增 base 与 ai-standard 配置契约。状态：`CANDIDATE_OFFLINE_VERIFIED_NOT_INTEGRATED`；不是正式 `CODE_VERIFIED`、`DEV_INTEGRATED` 或负责人接收。仅交付 OPT-005 配置子范围。

## 授权、基线与 Writer

- Run `run_ffaba3dac618`；候选 Task `task_ab35ea51e26c`；Dispatch `ctx_80233e3150eb`；集成 Task `task_fd7c0ba30304`。
- 前置 I-ORCH-GOV-01 为 `task_04c12ee99f6d`，总控消息 `msg_49fb909e8f31` 确认 GOV 正式集成并推送。
- 实际初始 `HEAD`、`origin/dev` 均为 `5430947b583e07d419f17c098a68f842f47ead40`，与总控指定 GOV SHA 完全一致；初始 clean。
- 分支 `weiyang86/orca-b01-gen`；origin fetch/push 均为 `git@github.com:weiyang86/aij-foundation.git`。
- 注册 Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/orca-b01-gen`；实例 `98244e2a-ae8c-44df-86e0-4c8b39d04ab0`。
- Worker 自己实现，未起子 Agent。Node `v24.21.0`、pnpm `10.0.0`；在本 Worktree 执行 frozen install 后才写代码，没有链接其他 Worktree 的 node_modules 或复制真实凭据。
- 本地候选 SHA 通过随后唯一 `worker_done` 报告给总控；候选提交只包含本记录及下列四个批准文件，不推送。

## 实际差异与影响

1. `scripts/project/editions.mjs`：明确 base / ai-standard、可信 `aij-ai` 现有 owner 和依赖、非秘密配置白名单、按项目/环境派生的 SecretRef 变量名。非秘密布尔/分类/URL 做本地校验，所有实时开关默认 false。
2. `scripts/project/cli.mjs`：create 增加 `--edition`，拒绝未知选项；show 与 run 共用离线配置边界，保留插件列表，校验精确 AI 声明、`.env.example` 和 `.env` 身份，拒绝插件注入与有效/悬空符号链接。show 不返回本地凭据；保留 base v1 清单和原 base 生成器回归。
3. `scripts/test/project-configuration.test.mjs`：增加13项实际 CLI/文件往返测试，含身份/插件/声明篡改、转发白名单、秘密不复制不回显、peer 隔离与旧清单兼容；原31项配置测试保留。
4. `docs/development/PROJECT_EDITIONS.md`：使用、配置声明、前置要求、身份隔离、验证与 GEN-02/03 剩余范围。

数据库 / Schema / migration / Seed：无修改、无操作；API 路由 / 页面 / RBAC 权限 / 授权：无修改。CLI JSON 新增 edition/editionContract 声明；ai-standard 启动加载列表仅为 aij-ai，默认所有 capability 与异步运行时仍关闭，未安装或启用持久插件。日志仅增加去敏配置拒绝信息；SecretRef 声明不含值。DeepSeek 现有三项门禁、AI 执行/成本与凭据 owner 不变。没有启动或声称任何访问地址已运行。

白名单限制生成器交给子进程的环境；应用仍按既有 runtime-environment owner 读取本项目 `.env`，该文件须由本项目可信操作者维护。本卡没有把本地可写清单声明为防篡改签名，也没有创建第二套 runtime/SecretCenter。

## 实际验证与退出码

| 命令 | 退出码 / 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 0；本 Worktree 独立安装726包，锁文件未修改；原有 Prisma 等 dependency build-script 忽略提示保留，未擅改策略或执行重建 |
| `node --version` / `pnpm --version` | 0 / 0；v24.21.0 / 10.0.0 |
| `node --check scripts/project/cli.mjs` / `node --check scripts/project/editions.mjs` | 0 / 0 |
| `node --test scripts/test/project-configuration.test.mjs` | 0；初轮44/44，无 fail/skip/todo |
| `node --test scripts/test/runtime-environment.test.mjs scripts/test/project-configuration.test.mjs scripts/verification/project-generator.test.mjs` | 0；最终57/57（44配置、8运行环境、5既有生成器），fail/cancelled/skip/todo 均0 |
| `pnpm exec eslint scripts/project/cli.mjs scripts/project/editions.mjs scripts/test/project-configuration.test.mjs --max-warnings=0` | 0；最终无输出 |
| `git diff --check` | 0 |

最终证据：本 Worktree `.artifacts/af-127/offline-tests-final.log`、`.artifacts/af-127/eslint-final.log`。此前通过日志保存在同目录，测试合成配置另位于 `.artifacts/af-127/config-tests/run-*`、`.artifacts/af-003/config-tests/run-*` 与 `.artifacts/next-11a/project-generator-tests/`。这些忽略目录不进入候选提交，日志不替代总控本次正式验证。

无测试或 lint 失败。初始探索读取时，尚不存在的 `scripts/project/editions.mjs` 和误猜的 `packages/aij-ai` / `scripts/test/project-generator.test.mjs` 路径导致 cat/rg exit 1/2；随后已通过实际源码定位现有 `apps/api/src/plugins/aij-ai` 和 `scripts/verification/project-generator.test.mjs`，不把这些定位错误计为通过。

未运行：正式 `pnpm run verify:task -- AF-127`（由总控注册和执行）、数据库/迁移/Seed、HTTP/API 启动、Next 重型构建、真实收费 AI/支付、部署和人工页面操作。本卡没有这些受保护运行证据，也不声称独立 AI 项目已能运行。

## 总控精确注册请求

未修改 package.json、registry、队列、runtime-environment.cjs 或 database/seed.mjs。没有保护文件补丁请求。

请总控给 AF-127 注册下列 node-test；正式 reporter 使用既有 `reporterPath`：

```js
{
  id: "project-editions-offline",
  kind: "node-test",
  command: [process.execPath, "--test", "--test-reporter=" + reporterPath,
    "scripts/test/runtime-environment.test.mjs",
    "scripts/test/project-configuration.test.mjs",
    "scripts/verification/project-generator.test.mjs"],
  testFiles: ["scripts/test/runtime-environment.test.mjs",
    "scripts/test/project-configuration.test.mjs",
    "scripts/verification/project-generator.test.mjs"],
  files: ["scripts/project/cli.mjs", "scripts/project/editions.mjs",
    "scripts/runtime-environment.cjs", "scripts/plugin-launch-policy.mjs"],
  verification: ["57项离线配置/CLI真实文件成功和拒绝路径；无DB/服务/外部AI"],
  effects: {
    writes: [".artifacts/af-003/config-tests/", ".artifacts/af-127/config-tests/",
      ".artifacts/next-11a/project-generator-tests/"],
    services: [], testDatabase: false, uniqueWriter: false
  }
}
```

另加上述定向 ESLint 与 diff check，注册前置为 Node24/pnpm10、自有 frozen install 和 GOV 集成 SHA 校验。无需新增 package script、依赖或锁文件变化。

## 人工步骤、预算与交接

按 PROJECT_EDITIONS.md 的两个 create 和 show 命令生成全新合成目录，核对 base 空插件、AI 可信依赖和带项目/环境的 SecretRef 名；只在生成的合成项目 `.env` 写 `PROJECT_ID=foreign`，show 应 exit 2 且无敏感回显。此次自动测试已覆盖这些成功/拒绝操作；负责人现场检查仍待执行。

Worker 有效工程耗时约0.2h（2026-11-04 10:15至10:26，含安装/实现/校验/记录，按最终交接时间取整）；单卡4h预算绝大部分留给总控集成，预计无 Worker 剩余实现工作。没有功能硬阻塞；正式注册/集成尚未完成。交接后明确停止写入，只允许原 Writer 在总控退回修复后续写。

总控须接收停止写入的候选、精确集成、正式验证、更新记录/队列、按原名提交推送并回读远端 SHA 后，才能完成 `task_fd7c0ba30304`；GEN-02/03 的代码依赖必须引用该真实集成 Task。OPT-005 整体、干净 clone AI 产品矩阵和负责人验收仍待后续授权任务，不自动续跑。

## 2026-11-04 原 Writer 退回修复：AppleDouble 可移植性

新修复 Task `task_6318a6146cd9` / Dispatch `ctx_dacf3baf8ae7`；同一注册 Worktree 和原 Writer 续修，开始 HEAD 为旧候选 `7d3dbd4b8b1355dd75bbc0369aeb92b0fdfd9c84`，origin/dev 仍为 `5430947b583e07d419f17c098a68f842f47ead40`，分支/remote 不变且开始 clean。总控明确确认原 dev 已应用候选并冻结实现，没有并发 Writer。

原 dev 的正式 `pnpm run verify:task -- AF-127` 在 `.artifacts/verification/AF-127/run-hRLLeT/report.json` 为 `FAIL` / exit 1（2026-11-04 02:27:01Z–02:27:04Z）；总控回报57项中56通过1失败。原因是外置 `/Volumes/Lexar` 自动添加 `._.env.example`、`._.gitignore`、`._README.md`、`._aij.project.json`，旧测试把这些 AppleDouble 元数据当成生成器业务文件。Worker 已只读核对该原 dev 报告的 FAIL/exit 1，失败报告保持原样，不回填通过，也不由本工作区测试替代原 dev 正式复验。

本次仅修改 `scripts/test/project-configuration.test.mjs` 中同一用例：先从目录枚举中过滤 `._` 前缀，精确断言剩余四个业务文件，再只读取这份已校验业务文件列表。未删除、修改或读取用户 AppleDouble 元数据；未修改生成器实现、其他业务范围或共享保护文件。本记录追加修复历史，不覆盖上一轮本工作区通过记录。

修复后 `node --test scripts/test/runtime-environment.test.mjs scripts/test/project-configuration.test.mjs scripts/verification/project-generator.test.mjs` exit 0，57/57，fail/cancelled/skip/todo 均0；同一三文件定向 ESLint exit 0，`git diff --check` exit 0。新日志分别为 `.artifacts/af-127/offline-tests-appledouble-fix.log` 与 `.artifacts/af-127/eslint-appledouble-fix.log`，既有日志保留。

未运行正式 verify:task、外置盘原 dev 复验、DB/HTTP/Next 构建；schema/API/页面/权限/运行日志影响均无变化。此轮有效工程耗时约0.03h，累计约0.23h；修复 SHA 由随后 worker_done 提供，基于旧候选的独立提交，不推送。交接后明确停止写入，剩余为总控精确应用修复、保留失败历史并在原 dev 正式复验。
