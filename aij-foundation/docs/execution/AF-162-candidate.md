# AF-162 提供用户私有Agent配置页面 — Worker 候选

状态：CANDIDATE / ROOT_VERIFICATION_PENDING，**不是 CODE_VERIFIED 或负责人接收**。本记录为本卡 Worker 自查，不是独立复核；没有等待 Trea。

## 授权与实际工作区

- 唯一 Writer：本派工 Worker，未派出子代理或辅助 Worker。
- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W07-AF162`；instance `03a2dae1-c6d1-4fda-8a08-95677277697f`。
- Task：`task_a1553f1b52fe`；Dispatch：`ctx_4a3e7a919b5f`；terminal：`term_7fe66506-8c29-4d7a-9915-fda658ab4db2`。
- 分支：`weiyang86/AIJ-W07-AF162`，起始 HEAD 与 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，首次 `git status --short --branch` 干净。
- remote：origin fetch/push 均为 `git@github.com:weiyang86/aij-foundation.git`；没有 fetch、push、切换或更改正式分支。
- 每个源码/测试/声明/记录写入阶段均先回读 status、HEAD、origin/dev、remote；派工身份固定如上，实际命令见 Worker 会话。
- 主工作区与轻企仓库未写入。未修改正式队列、registry、AGENTS、manifest、lockfile、依赖版本、生产 Schema/module/SDK index。
- Worker 约 0.5 有效工程小时（估算）；在 2h Worker 上限内，保留至少 1h 给 root，整卡上限 3h。

## 独立 bootstrap

授权 source-only bootstrap 已单独提交为 `efc86bd0872737c892b7a6f281b538ea83843f7c`，标题 `chore: bootstrap authorized AF-162 source dependencies`。

13 个 blob 均来自本仓库 `16cfeabbd248a9faff0efd77ad946b033d18e526`，写入前逐个验证派工指定的 SHA256。没有复制环境、凭据、数据或依赖目录。最终候选只包含此 bootstrap 之后的本卡 delta；root **不要把 bootstrap 当成依赖集成提交 cherry-pick**。

| 授权源码 | 已给定真实集成 Task |
| --- | --- |
| contracts index | `task_bb2bf1841ea9` |
| SDK index / personal-agents | `task_8225f38866ac` |
| SDK personal-skills | `task_623c04531bae` |
| SDK ai-run-recovery / package builder | `task_634f404155e8` |
| client-ai-workbench / client-skill-library / Skill state declarations / Skill route | `task_aeb0b614c4ca` |
| client-ai-workbench-state / declarations | `task_99d2fef42591` |

收尾时重新验证 11 个非 allowPaths 的 bootstrap 源码 hash 全部未变；其余两个组件的自有差异仅为导航链接。正式依赖以 root 已接收集成的真实 Task 为准；本卡不依赖 AF-161 未验证候选。

## 实际 diff 与影响

- 新路由 `apps/web/app/client/agents/page.tsx`；新组件 `client-agent-library.tsx` 和内存状态层 `.mjs`/`.d.mts`。
- 使用**编译后的** `@aij/sdk` `createPersonalAgentsClient` 与 `createPersonalSkillsClient`，组合既有 `clientApi`，保留 Cookie、`credentials: include`、`cache: no-store`、显式 Workspace header；没有自行复制 API 实现。
- 真实会话、空间列表和 context 后才读当前账号的私有数据。只读角色能看自己的当前配置/历史，创建修改删除禁用；无读取权限或 401/403 清除私有内容。服务器仍负责所有权和权限真值。
- code/name/instructions、默认 false 的配置启用、模型名称/code/revision、输入字段、text/JSON 输出及字段、最多 8 个不重复且有序的自有 Skill 固定 revision。Skill 与版本均从实际 SDK list/versions 选取，支持列表和历史 cursor；不输入/猜测 revision。
- 当前摘要/版本、不可变历史只读预览；固定版本可重新核对。当前详情会实际重读 model-options 和各 pin 的 Skill/历史版本以标识失效或未知；编辑中显示名称/编号/固定版本并提供上下移动/移除。
- 模型目录刷新保留草稿中的旧模型/code/revision/catalog，过时后禁止保存，须显式选择当前选项。不可用模型或 pin 提供重读/重新选择操作，没有强制保存路径。
- 创建、更新、删除均先弹确认；更新/删除使用当前 `expectedRevision`；409 提供重读，保留冲突草稿供查看；未知写入结果提示先刷新核对。没有自动 POST 重试、自动覆盖、run/debug/publish/market/script 操作。
- 每个 Agent/Skill/model 请求均有 epoch、AbortController 和 timeout；作用域取消也约束忽略 signal 的 transport。空间/账号重验证、logout、pagehide、visibility、focus 与卸载清除草稿/数据，旧成功、拒绝、finally 不回绘。
- 私有 prompts/names/options/pins/history/drafts/errors 只在页面内存；无 storage、URL 内容、遥测、journal 或私有错误原文日志。导航 URL 仅传 Workspace selector。
- AI 工作台和 Skill 页只在 `workspace.ai.assets.read` 时显示“我的 Agent”。工作台恢复 journal、锁、轮询逻辑无变化。
- 复用 Ant Design、PageHeading、adminTheme 与现有 class；无 redesign/globalCSS/新依赖。使用现有 Modal、可访问名称和 focus 样式、表格自身横向滚动、Space wrap 与顶部换行，待 root 真浏览器验证 390px。
- 无数据库、API实现、权限定义、日志落库或服务端迁移变更；页面仅消费 AF-159 和既有 Skill 能力。没有启动应用，**没有已运行访问地址**；集成后路由为 `/client/agents?workspaceId=<当前空间>`。

## 已执行验证与真实失败记录

1. `pnpm install --frozen-lockfile`：通过，独立本地安装，无 node_modules/上传目录共享或符号链接，lockfile 未改。pnpm 保留已有 ignored dependency build scripts 提示，未放宽设置。
2. `node scripts/build-workspace-package.mjs packages/contracts`、`packages/sdk`、`packages/ui`：均通过；仅允许的小包编译，dist 为 ignored own artifacts。
3. `pnpm --filter @aij/web typecheck`：最终通过；无 API/Web 重型 build。
4. `node --test scripts/verification/client-agent-library.test.mjs scripts/verification/client-api.test.mjs`：最终 **35 passed / 0 failed / 0 skipped**，其中本卡状态/编译SDK用例 32 个，既有 transport 契约 3 个（含父用例）。所有 HTTP 响应均明确为 synthetic，不冒充真实服务器或数据库证据。
5. 下列全部目标的原配置 `pnpm exec eslint ... --max-warnings=0`：最终 exit 0。目标为新 route、组件、state、声明、两个导航组件、offline 和 live 测试脚本；没有 parser override、规则禁用或全局配置修改。既有 Next lint 会输出仓库根 `pages` 目录查找提示，不是本卡 lint 错误。
6. `node --check scripts/verification/client-agent-library-live.test.mjs`、`git diff --check`：通过；live 仅语法检查，未运行。

初次 offline 测试出现测试脚本 `_` 重名语法失败，修复后发现 synthetic envelope 缺 `message` 与 fixture 错把 Skill 路径写为 `/personal-skills`，实际 SDK 使用 `/client/ai/skills`；均已修复并重跑，未更改 SDK 路由迁就测试。首次未设 barrier 防挂的测试进程已明确终止，后续 barrier 有失败分支/超时，最终测试没有挂起进程。

初次声明 lint 使用 Next Babel 的 TS function/method type AST 导致 `node.params is not iterable`；显式 TypeScript parser 交叉检查曾通过，但该 override 不是最终门禁。随后改为 ambient function declaration 的 `typeof` 结构类型，保留完整签名与规则，原始仓库配置最终直接通过；中间 ambient class 写法产生的 unused 参数错误也已消除。没有隐藏这些失败或扩大门禁。

离线断言覆盖字段与配置边界、未知 ownership/script 字段拒绝、实际请求体/headers、确认与取消、CAS、历史、真实返回版本选择/8个pin/排序、过时目录/模型、失效pin、readonly/no-read/403/401/foreign history、cursor、各类 dependent read/save 的旧成功/错误/finally、principal/space切换、处置、timeout 以及源码无持久化。

## ROOT ONLY / NOT_RUN 与人工验收

以下 **NOT_RUN by Worker**：DB/Docker/migrate/seed、API build/start、production Web build、真实 HTTP/PostgreSQL、桌面/390px浏览器、正式 `verify:task AF-162`、五守卫注册、正式队列/执行记录更新和负责人验收。

root 在接收 STOPPED 并精确集成后：

1. 确认 AF-159（私有 Agent API）及 Skill API/Schema 的正式已验证集成；本 Worker 没有引入它们的 API/Schema。为 AF-162 在 `scripts/runtime-environment.cjs`、`scripts/database/migration.mjs`、`scripts/database/seed.mjs`、`scripts/verification/auth-support.mjs`、`scripts/verification/client-auth-fixture.mjs` 注册**独立任务**，另注册 runner/registry 及 Web build 验证。不得复用其他卡 lease。
2. 原 dev 独占 DB/heavybuild，各 concurrency1，执行 root 正式门禁、生成 Prisma、编译 API/SDK/Web。
3. 在原 dev、原主工作区运行 `AIJ_AF162_ROOT_LIVE=1 node --test scripts/verification/client-agent-library-live.test.mjs`。脚本先校验显式开关、根路径、主 checkout 和 dev，才动态加载数据库流程；建立 fresh AF162 acceptance，真实 Cookie/session/context + actual compiled SDK + AF159 API + state 完成 create/replay、confirmed update、history/cursor、CAS409、actual model/pin versions、readonly server403/no durable changes、foreign404、真HTTP旧scope响应barrier、过时catalog显式选择、confirmed delete，以及执行账本不变/upstream0/app pools0。根脚本当前仅 syntax checked，不能提前声明通过。
4. 真浏览器桌面与390px：从工作台/Skill 入口进入；选明确空间；新建填写字段、选择模型、选择自有 Skill v1/v2、上下排序、确认保存；重读当前与历史；另一会话改配置触发409重读；刷新模型目录后明确再选；确认删除；只读成员只看自己的配置/历史、写按钮禁用；切空间/退出/离页后无旧私有内容回绘；确认无整页横向溢出、表格局部滚动、键盘焦点及 Modal 返回。
5. 正式验证后由 root 更新执行/队列，按任务原名正式提交并回读 SHA，完成其 I-* 集成 Task；candidate 本身不完成该 Task，也不代表 OWNER 接收。

## Writer 交接

候选提交标题逐字为 `提供用户私有Agent配置页面`，提交正文注明 AF-162；实际 SHA 由提交后 `git rev-parse HEAD` 回读并在 worker_done 报告，避免自引用。

交接范围仅 allowPaths 的 9 个文件：route、Agent 组件、state、声明、两个导航组件、offline/live 测试和本记录。此记录随候选提交；提交后明确 **STOP ALL WRITING / STOPPED**，不再续卡、不 push、不修改 root。正式接收与发布由负责人/总控决定。
