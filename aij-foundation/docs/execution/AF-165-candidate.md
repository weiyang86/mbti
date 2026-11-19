# AF-165 候选交接：提供私有Agent运行预检与费用上限接口

状态：CANDIDATE / ROOT_INTEGRATION_PENDING，非 CODE_VERIFIED、非独立复核、非负责人接收。仅本卡 Writer，无 helper workers。

## 实际派工与基线

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W08-AF165`
- Task：`task_1dee79ba4dff`；Dispatch：`ctx_8c67db45a395`
- Worker terminal：`term_8415d3bb-0b26-43f1-bad7-7daa4f98f38a`；Coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`
- 分支：`weiyang86/AIJ-W08-AF165`；初始 clean HEAD 与 origin/dev：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`
- remote fetch/push：`git@github.com:weiyang86/aij-foundation.git`；origin/dev 保持初始 SHA；无 fetch/push/merge/tag。
- 注册状态通过 `orca worktree current --json` 实际回读；写入前核对 status/branch/HEAD/remotes，阶段内 Task/Dispatch/terminal/Worktree 不变。初始状态干净，后续只有本卡 allowPaths 未跟踪文件；bootstrap 后 HEAD 为下列独立提交。

## 精确 bootstrap（一次、随后只读）

来源全部是同库 commit `589d587ba1bd9da782fc6d35245430bfe147c4a3` 的 `git show commit:path` 源码 blob，16 项 SHA256 全部与派工匹配后才恢复。独立 bootstrap 提交：`f10db31b8a9e0b0229c088c5c2224f8491a7c2f1`，标题 `chore: restore authorized AF-165 source bootstrap`；不是底座正式集成，不含 env/凭据/数据/deps。初始实际 Schema 仅用于本地无 DB 生成与编译，未修改。

| 路径 | SHA256 |
| --- | --- |
| packages/contracts/src/index.ts | d6c18befc81d6bc7c011365d011afc7b20e97f6c9915925779f73a24ffdce4b6 |
| packages/sdk/src/index.ts | 823f36b527a7d96a554edb710bfd6bb2c0fffc26ea802f3357908d57ce6dea07 |
| packages/sdk/src/personal-skills.ts | 099f9e79ac8bb8994a36adb6fc7810d2f4278531e221a521d29be99c75066b9e |
| packages/sdk/src/personal-agents.ts | 2554f86f4e074955d1d754a287662de1d2e812fd06899905719f11546b7f1ed1 |
| packages/sdk/src/personal-agent-runs.ts | e4993f878b2d9a620797dcb9b29c6abf466ea8d230aabc7060807da13097c5a0 |
| packages/sdk/src/personal-memories.ts | 0748a96c2ba1785b7f6e8b3c1743634b9b4239ccacefdd63a69bca29efc5d45d |
| packages/sdk/src/ai-run-recovery.ts | 50442f5852da685ed5d353bc8186590cf006adda617e69948620fe4458216b2c |
| scripts/build-workspace-package.mjs | 5dde66fd6520f6cc06af91ee064163fac3accef3fa50cd17f8890d463da1f1c0 |
| apps/api/src/client-workspaces/workspace-context.service.ts | 8acb86c7108fbc7adead9528515f8dc3ebc4e9884785b9b1c6b0ed2861844467 |
| apps/api/src/client-workspaces/client-workspace-permissions.ts | a690442b2754bf6eb6629cca008ef025331d630aeb07cd8ebb2f32058968ca00 |
| apps/api/prisma/schema.prisma | d52f3bbcc47adcb9cae17f571906f2c7bd88b55b19f0464ab47370d95a84b026 |
| apps/api/src/plugins/aij-ai/ai-personal-agents.dto.ts | 7dd8f38e4a1a32a0c49a4b4d6cd2b6cb19f599bb04e87b5c3a5f6c32c9ecd781 |
| apps/api/src/plugins/aij-ai/ai-personal-agent-snapshots.service.ts | 727f511720647cfa788fce39a09fea8314f5c8a653e52bb141e09f3379433380 |
| apps/api/src/plugins/aij-ai/ai-center-provider.ts | a76afb64beec2ba578e1ae17d6ce4c85fb89d13313b45d8a5ce9570c3ba6c66d |
| apps/api/src/plugins/aij-ai/ai-center-policy.ts | dd256e3ce0ff636f7538136261606caf200cf5001b2b7cffcf9add33b7d911cb |
| apps/api/src/plugins/aij-ai/ai-vendor-profiles.ts | 595d7bb03934ae13ea99b934ff0ae7e9668ff058e6722b63a8e20026e2f493fb |

来源集成依赖由派工固定：contracts/catalog `task_bb2bf1841ea9`、SDK/memory `task_f597249cbeb2`、Skill `task_623c04531bae`、Agent `task_8225f38866ac`、personal run/snapshots `task_5731129d1d35`、recovery/build `task_634f404155e8`、Workspace fence `task_34f986fd3442`。候选只包含 bootstrap 后本卡八个新文件的 delta，总控不能整体 cherry-pick bootstrap 覆盖已集成的共享文件。

## 本卡实际差异与影响

新增三个 API 源文件（DTO/controller/service）、一个 SDK factory 源文件、离线与 root-only live 两个验收脚本、本交接记录和开发说明共八个 allowPaths。GET 同时要求 aiExecute 与 aiAssetsRead；一个事务复用当前生命周期/权限锁、精确 catalog 锁、实际快照 owner 和实际 estimator，返回字面 SAFE allowlist。配置状态使用现有 flags、catalog validation 与 configuredTrusted，默认关闭仍可预检；外部主机、vendor 协议、禁用模型等不绕过已有规则。

数据库/Schema/迁移/权限定义/env：无新增。预检不写任何执行/预算/catalog/private asset/audit 表，不解析密钥、不调用外部模型或网络、不预留或承诺执行。页面：未改且未新增私有运行 UI。日志：无新增内容日志；不可将快照或正文写入日志。接口地址仅是接线后路径，Worker 未启动 API/Web，当前无已运行地址。

## 验证与失败记录

- `pnpm install --frozen-lockfile --ignore-scripts`：独立安装完成，未共享或符号链接其他工作区 node_modules，manifest/lock 无差异。
- 实现前 `origin/dev` 的 `git ls-tree` 确认三个预检 API 源文件及 SDK factory 均不存在；这是源码缺口证据，未宣称实际旧 API 已启动或返回过 404。
- `node scripts/prisma-schema.mjs generate`：通过，使用既有隔离编译入口、端口 1、无环境文件与 DB 连接。
- `node scripts/build-workspace-package.mjs packages/contracts`、`packages/runtime-contracts`、`packages/core`：小型公共包构建通过，仅 ignored dist。
- 初次 API noEmit **失败**：core/runtime-contracts 尚未构建而无法解析；构建既有小包后实际 noEmit 通过，未改 gate/源码以掩盖失败。
- 初次新增严格类型用例 **失败**：`.mts` 泛型箭头 `<T>()` 测试夹具语法被 TS 拒绝；改成 `<T,>()` 后通过。
- 最终 `node --test scripts/verification/personal-agent-run-previews.test.mjs`：**10/10 PASS**；覆盖 DTO/controller/双权限/生命周期与成员 fence helper/原 resolver/原 estimator/SAFE 投影/flags-off 与 configured/DeepSeek/不解析密钥/旧 p-UUID/SDK ESM+CJS及严格类型；使用明确的 offline transaction adapter，不宣称 PostgreSQL 或真实会话证明。
- 最终目标 `eslint --max-warnings=0`、API `tsc --noEmit`、live 脚本 `node --check`：**PASS**；16 个 bootstrap SHA256 和 origin/dev 复检保持不变。本地候选 SHA 由提交后回读并通过 worker_done 交付；diff whitespace 在精确暂存后检查。
- **NOT_RUN**：正式 `verify:task AF-165`、数据库/迁移/seed/API启动、真实 session/API/PG fence/hash、fresh heavy build、packed compiled SDK/浏览器。root-only live 脚本是待执行验收，不是通过证据。

## 总控后续与 Writer 停写

接线、真实验收与人工步骤详见 [开发说明](../development/PERSONAL_AGENT_RUN_PREVIEWS.md)。Root 必须在原 dev 单数据库 writer/单 heavy build 调度下完成新鲜 AF-165 注册与验收；Candidate 不改变正式队列/registry/全局依赖/module/SDK index/bootstrap。不得 push Worker 分支或把候选当 CODE_VERIFIED；本卡不自动续跑其他任务。

Worker 完成全部允许文件后作精确原名本地候选提交并回读 SHA，随后 **STOP ALL WRITING**；总控收到明确停写后取得 Writer 接收权。预算上限 Worker 1.5h / 全卡 3h，本次约 0.4 有效工程小时，保留至少 1.5h 给 Root。无正在运行的数据库/应用/外部模型，未自动接续下一卡。
