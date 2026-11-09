# AF-220 候选：提供独立AI本地集成运行配置

状态：CANDIDATE；**不是 CODE_VERIFIED，不是负责人验收**。本 Worker 的职责为七个新模块、离线纯检查及 root 接线交接；真实环境、共享接线、正式队列/registry/verify:task 均归 root。候选提交标题逐字为「提供独立AI本地集成运行配置」。

## 身份、来源与边界

- Task `task_ca3af94d7c60` / Dispatch `ctx_c9571bda1c19` / terminal `term_d567203f-d45f-445c-aa0d-87f66baeb851`。
- 注册 new-child Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W22-AF220`，instance `df44bf9d-5337-494c-be4b-9b549d0910e0`，parent 为批准 root，baseRef=origin/dev。
- Branch `weiyang86/AIJ-W22-AF220`，初始 HEAD `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，初始 status clean，remote `git@github.com:weiyang86/aij-foundation.git`。身份登记 Orca message `msg_d5753f920bd9` 已送达后继续。
- 根 W22/SOURCE_BOOTSTRAP.json SHA256 `1396522f0782f4e9fa5478786ea67d78cde328ec745de2725a85decff978eea3`；sourceCommit `dc13430835ae89b58ae18577be12643224c9c55e`；1026 blobs。
- 使用一次 `git cat-file --batch` 读取清单 OID，先验证每项 blob OID/type/bytes/SHA256 与 immutable git ls-tree 的 mode/path，再写本子工作区；未全量 checkout、未读 live root 源码。bootstrap 独立提交 `a6b2ac0ea5c20b64d842a704eb7f87456ba5b320`，标题 `W22 verified source-only bootstrap`。
- 候选 SHA 为本记录所在提交，最终实际值由 worker_done 回报；root 仅集成 bootstrap 之后的本卡精确新增 delta，不集成 bootstrap 本身。
- 后续复查清单全部 1026 项 SHA256/mode：0 变更。未改现有实现、manifest、锁文件、全局规则、旧 Base、runtime shared、seed、Schema/迁移或 root WIP；未复制 root.env/凭据/原型/AF191/208/node_modules/上传，未装新依赖。
- 源码复用来自同一冻结提交的 scripts/base-development 与原 runtime/migration/schema owner。复用原 canonical/private file/PID snapshot/migration inventory/ledger guard，不复制原 seed 或另建产品服务。

## 精确候选 delta（10 个新增路径）

| 路径 | 实际作用 |
| --- | --- |
| scripts/ai-local-development/config.mjs | 固定身份、capabilities、四 secrets+DB 密码生成/隔离、私有 owner/config 读写、explicit 入口保护、脱敏 |
| scripts/ai-local-development/cli.mjs | 四命令与 start --build、互斥锁、init-only root hook、非破坏 lifecycle/readiness |
| scripts/ai-local-development/processes.mjs | 自有 process record、PID/birth/CWD/command/uid/instance 拒绝及精确 SIGTERM |
| scripts/ai-local-development/service.mjs | 原 API/Next 的持久 supervisor、child identity 保护、受控生命周期日志 |
| scripts/ai-local-development/build.mjs | 独立输出、owner marker、Web public allowlist、Next env 文件拒绝、原共享生成配置字节恢复 |
| scripts/ai-local-development/database.mjs | exact 新目标、真实 PG16 身份与原迁移账本保护后仅 deploy/status |
| scripts/ai-local-development/docker.mjs | 本地 context/Unix endpoint、完整 labels/image/commands/volume/ports 拒绝，empty env-file，owned up/stop |
| scripts/verification/ai-local-development.test.mjs | 18 项离线纯检查，PG connect 拦截计数必须为 0 |
| docs/planning/auto-ai-program-20261105/W22/AF-220-ROOT_WIRING.md | Root 共享入口/Compose/seed hook/真实验收接线细节 |
| docs/execution/AF-220-candidate.md | 本候选执行与交接记录 |

## 验证命令与实际结果

| 命令/检查 | exit | 结果 |
| --- | --- | --- |
| manifest bytes SHA256、1026 git cat-file blob/hash/mode 校验、bootstrap commit | 0 | 全部匹配；源提交/清单固定 |
| `pnpm install --frozen-lockfile` | 0 | 独立安装 800 packages，downloaded 0；未更改 manifest/lock；依赖安装脚本按 pnpm 默认未运行 |
| 七个新增模块各 `node --check scripts/ai-local-development/<name>.mjs` | 全 0 | config/cli/processes/service/build/database/docker 语法通过 |
| `node --test scripts/verification/ai-local-development.test.mjs` | 0 | 最终本卡 18 项（初次 16 项；后补 Next env 守卫与 owned ID 重复 stop 用例） |
| `node --test scripts/verification/base-development.test.mjs scripts/test/runtime-environment.test.mjs` | 0 | 原 Base/runtime 18 项 |
| `node --test scripts/test/project-configuration.test.mjs scripts/test/database-target.test.mjs` | 0 | 原 project/DB target 87 项，均 synthetic/offline，网络在 socket 前拒绝 |
| `node --test scripts/verification/ai-local-development.test.mjs scripts/verification/base-development.test.mjs scripts/test/runtime-environment.test.mjs scripts/test/project-configuration.test.mjs scripts/test/database-target.test.mjs` | 0 | 最终合计 **123 tests / 123 pass / 0 fail / 0 skip** |
| `pnpm exec eslint scripts/ai-local-development/*.mjs scripts/verification/ai-local-development.test.mjs --max-warnings=0` | 0 | 定向 ESLint 通过，无规则屏蔽 |
| `node scripts/ai-local-development/cli.mjs --help` | 0 | 真 CLI 帮助；PATH=/nonexistent 的纯检查也通过，无 Docker/hook 依赖 |
| `node scripts/ai-local-development/cli.mjs init` | **2（预期拒绝）** | Root initializeAiLocal hook 缺失；REJECTED / initialization NOT_RUN；资源操作前拒绝 |
| `node scripts/ai-local-development/cli.mjs status` | 0 | NOT_INITIALIZED / aij-ai-local |
| `node scripts/ai-local-development/cli.mjs start` | **2（预期拒绝）** | 冻结 shared reader 尚无 explicit 接线；资源操作前拒绝 |
| 回查 1026 immutable 文件 SHA256/mode + product runtime directory exists | 0 | 源文件 0 改变，`.local-data/ai-local-development` 不存在 |

Git 多次显示已有 AppleDouble pack `._pack-...idx` 的 `non-monotonic index` 诊断，但以上 git 操作成功，未清理或改动 root 对象库。Orca 初次登记 type update / check --from 被 CLI 拒绝，改用已支持的 status / --terminal 后成功；这些传输纠正没有改变任务源码或隐瞒验证失败。

有效用例包括固定环境/端口/秘密/未知变量拒绝，旧 Base/host/test/外部库拒绝且零 connect；owner repo/user/host/instance/context/endpoint 与 symlink/权限拒绝；未知容器/卷/labels/镜像/commands/loopback/privilege/Compose 扩展拒绝；Web build/start 无 DB/auth/provider/NODE_OPTIONS，Next 自动 env 文件拒绝；PID birth/CWD/command/user/parent/instance 拒绝；init 动态 hook 缺失、失败不写 initialized、重复编排不改变 values，以及原 migration ledger guard。注入 collaborators 仅证明编排/拒绝顺序，不证明真实 PG/seed/用户/菜单/权限初始化。

## 实际影响、未运行项与 root 依赖

- 数据库：只新增受保护的未来运行入口，没有连接 DB、执行 SQL/migrate/seed，未创建库/容器/卷；清单 SQL 仅静态 checksum 读取。
- 接口/页面/权限：无现有 API、SDK、页面、Schema 或权限 owner 修改；真实装配五身份/空间、AI 安装/权限/菜单和调度由 root hook/原 owner 实现，不是本候选已交付结果。
- 日志：应用原始 stdout/stderr drain；只输出固定 supervisor 生命周期与受控错误，不记录 raw secret/headers/body/provider 输出。未产生真实服务日志或客户数据。
- 访问地址：**没有已启动的 Web/API 地址**。3955/3956/55435 仅为固定配置目标，不能据此宣称已运行。AI 厂商/导出未配置；通知/支付不启用。
- NOT_RUN：Docker/真实 PG 身份和迁移、真实 root seed、5 合成客户/空间/权限、HTTP/SDK/业务任务/worker owner 调度、Web/浏览器/native、真实持久化/重复 init/owned lifecycle、full API/Next build、注册 verify:task 与其他 root 正式质量门禁、厂商/导出/外网。schema-only generate/小包 build/TypeScript 全量 typecheck 本卡无必要且未执行；新增代码全为 .mjs，已语法检查和定向 ESLint。
- Root 前置：共享 explicit 环境入口与精确 build ignores（root 已通知其 Writer 内实现，Worker 未复制）；正式 Compose 加七项自有 labels；init-only `initializeAiLocal({owner,values,runtime})` 使用原 seed/ClientAuth/Workspace/插件/权限窄出口；package alias/原 DB 保护/实际验收及正式记录。详细参数与人工步骤见 AF-220-ROOT_WIRING.md。
- 人工/root 验收：完成接线后先 init 并核对真实五身份和空间，再重复 init 对比密码/grants/菜单/配置、start/浏览器与 SDK/HTTP 成功拒绝、持久化与 stop/start；记录旧 Base/host 未受影响、明确服务保留或停止结果。所有步骤均尚待 root 真跑，不能用本纯检查替代。

## 工时与 Writer 交接

Worker 观测起点为注册 worktree 创建时间 2026-11-08 16:54:18 +08:00；候选完成约 17:18 +08:00，有效工程耗时约 **0.4h**（含 bootstrap、安装、实现、自查、离线验证和记录，等待答复另计），低于 1.5h Worker 上限；本卡 4h 余量留 root 集成/真实验证/修复/正式记录。没有子 Agent、push、PR、main/tag、部署/发布、模型或 CLI 设置切换。

本地候选原名提交并回读实际 SHA 后，Writer 明确 **STOP ALL WRITING** 并只发送一次 worker_done；root 接收后自行串行集成。未获新派工前不再写入；候选不是正式 CODE_VERIFIED，批次出口仍由 root 如实登记 OWNER_CHECK_PENDING。
