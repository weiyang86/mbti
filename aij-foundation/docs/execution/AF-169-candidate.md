# AF-169 候选交付：提供个人Agent运行与结果恢复页面

本记录为 Worker 候选交接，不是 CODE_VERIFIED、负责人接收或独立 Review。正式 `verify:task`、真实运行时/数据库、生产 Web 和 Orca 浏览器验收均由总控串行完成。

## Writer 与基线

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W09-AF169`；instance `cd423bf3-913d-46bb-baaa-5fe1b16bf2b4`。
- Task：`task_a0eaa8be4d20`；Dispatch：`ctx_078d97ac5035`；terminal：`term_31454c13-daba-4291-b7a8-a62f72374c0b`。
- 唯一 Writer 为本 Worker，无 helper/subagent；分支 `weiyang86/AIJ-W09-AF169`。
- 初始 HEAD 与 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；初始工作区干净。remote fetch/push 均为 `git@github.com:weiyang86/aij-foundation.git`。
- 授权的 15 个 bootstrap blob 逐个校验 SHA256，通过后独立提交 `f86ed547ac3365cc3985a6a3341f017d11b4a756`（`Restore authorized AF-169 source-only bootstrap`）。来源均为 `179751f0922104fc7eee454c87ca4f4d07796fc0`，实际 manifest 在忽略目录 `.artifacts/af169/bootstrap-manifest.json`。除另获 allowPath 的 `client-agent-library.tsx`，bootstrap 此后只读。
- 写入阶段前均回读 branch/status/HEAD/remotes：bootstrap 前为初始 SHA；实现、live 脚本、恢复边界与交接文档阶段均为 bootstrap SHA，状态仅包含本卡允许路径。候选本地提交标题逐字采用「提供个人Agent运行与结果恢复页面」，最终 SHA 由 worker_done 与 Git readback 交接。
- 未写原 dev 工作区、轻企仓库、队列、registry、AGENTS、全局 manifest/lockfile、Schema、生产 module/SDK index；未 push/PR/merge/tag/部署。

## 实际差异与边界

新增 `/client/agents/[id]/run`，正确 await Next 动态 params/searchParams。URL 只传 Agent 不透明 ID 与可选不透明 workspaceId；非法或外区 selector 不回退到其他空间。原「我的 Agent」列表仅在具备 assets.read + execute 且配置 enabled 时增加运行链接，配置编辑、历史与固定版本行为没有改动。

页面沿用 AntD、PageHeading、adminTheme 与现有布局，无新依赖、全局 CSS 或设计系统改造。使用 frontend-design-review 技能进行同 Writer 自查：一个主确认操作，明确返回路径，声明字段 label、错误重试动作、条件挂载 Modal、取消后还焦、提交后结果区域焦点、长文本换行与受限滚动、AI 内容说明。未提供 Figma 参考；浏览器的键盘/390px/高对比视觉检查尚未运行，不把源代码审查当成视觉验收。

执行页使用实际编译 SDK 的 `createPersonalAgentRunPreviewsClient`、`createPersonalAgentRunsClient`、`createAiClient`、`createAiRunRecoveryClient`，统一走现有 clientApi。仅通过摘要列表解析确切 Agent/revision，不读取完整 Agent、Skill 指令或 Memory 正文。先确认实际 me、分页 workspaces、server context；新提交同时要求 execute/assets.read。已有结果恢复仅依赖实际结果读取权限，不要求当前预览、Agent 仍启用或模型可执行。

安全预览校验严格字段、来源/版本、字段集合、文本/JSON、模型/目录版本、估计模型预算上限与 modelExecutionConfigured。预算是模型成本参考，不表示用户价格、支付/退款或准入承诺。默认关闭、禁用、依赖缺失、冲突和外部来源均不能启用提交；同页生命周期重入发现 revision 改变时，必须明确重新读取预览并再次检查，不静默切换模型。Memory 由服务端选择，仅 Agent 当前明确获授且启用的记忆可能应用，不保证自动学习。

用户手填每字段最多 2,000 字符，确认 Modal 仅在确认期间挂载；POST body 仅含 input/idempotencyKey/expectedRevision。同步 busy 与共享 withRecoveryLock 阻止同页/双页竞争；先持久化并回读校验，再在锁内重新核对才 POST。任何结果丢失、超时或拒绝均不自动 POST，也不生成新 key。

独立 journal owner 为 `aij.client.personal-agent.pending.v1:<memberId>`，未修改旧 workbench journal/validator。仅允许 version/entries envelope 及 memberId/workspaceId/agentId/revision/key/digest/runId/status，严格 schema、原型/额外字段检查、16,384 字符限额、32 条上限、scope 唯一性、锁内 CAS 与写后回读。输入、名称、指令、Memory、输出与凭据均不进入 storage/log/URL。存储读取、写入、quota、CAS 或 Web Locks 失败会阻止新提交。

恢复先解析 principal/scope，再 GET 原 key；401/403 清除页面私有状态，404 不解释为已确认未入队，410/503/未知/损坏不猜另一个 owner 或空间。保留 unconfirmed/unknown 的原 key；unknown 必须保持服务端 reserved 语义，不能开始新任务。仅服务端可确认的 succeeded/settled 或 failed/released 终态允许用户明确开始新任务，再取新预览和重新填表。此实现保守地不从 404 提供新任务。

安全 GET 轮询由用户开启，最多 40 次，可暂停/继续；每个请求具备 epoch/abort/8 秒 timeout，即使 transport 忽略 abort，迟到的成功/失败/finally 也不能写新 scope。pagehide/pageshow/focus/visibility/storage 事件重新校验或清空页面内容。保留期定时器清除缓存结果；queued/running/succeeded/failed/unknown/内容清理/内容过期/无可读结果/配置不可用分别展示。输出为 React 文本或校验后的 JSON，无 HTML 注入或原始账本快照。页面离开/暂停不表示服务端取消或退款。

数据库、接口、权限定义、运行时、Trace、预算与日志 owner：无生产变更。页面只消费已有 API；没有新 executor/ledger/model API，没有数据库或服务启动。路由未实际运行，不能提供已经可访问的地址。

## Worker 验证

独立执行 `pnpm install --frozen-lockfile`，锁文件未改；未共享或链接 node_modules，也未复制 env/凭据/上传目录。仅构建允许的小型公开包 contracts/sdk/ui，未执行 API/Web build。

| 验证 | 结果 |
|---|---|
| `pnpm --filter @aij/contracts build` | PASS |
| `pnpm --filter @aij/sdk build` | PASS，真实 ESM/CJS 与声明产物 |
| `pnpm --filter @aij/ui build` | PASS |
| `pnpm --filter @aij/web typecheck` | PASS，tsc --noEmit |
| 本卡 route/UI/state/声明/原 Agent 链接/两个测试文件的 `eslint --max-warnings=0` | PASS，未禁用规则或更改配置；存在原配置的 pages-directory 提示 |
| `node --test scripts/verification/client-personal-agent-run.test.mjs` | PASS 21/21，0 skip，真实编译 SDK + 状态 + 自有 synthetic loopback HTTP，非真实 API/PG 证明 |
| `node --check scripts/verification/client-personal-agent-run-live.test.mjs` | PASS，仅语法 |
| `git diff --check` | PASS |
| 正式 `verify:task -- AF-169` | NOT_RUN，root 注册/执行 |
| fresh AF169 API/JobService/PG/Trace/budget/Memory 验收 | NOT_RUN，root 独占 |
| 生产 Web build、桌面/390px Orca 浏览器 | NOT_RUN，root 独占 |

离线覆盖：严格预览/来源/版本/JSON；人工确认一次提交；丢响应与 timeout/reload 原 key 查回；same-tab/two-store 互斥；存储损坏/限额/quota/锁失败/写后读/CAS 失败；无 storage 明文；旧 scope 的迟到成功/拒绝/恢复不能写入；权限、关闭/禁用、stale、外区、401/403/404/410/503；unknown 保留预留；purged/expired 区分；只读恢复；revision 变化显式重取；轮询上限与保留期清除。

首轮失败保留：初次 noEmit 的泛型锁返回类型不匹配；初次 lint 的声明 TSFunctionType 导致仓库 Babel parser 崩溃及测试一处 unused expression；初次合成 HTTP envelope 缺少 message，14/15。均在本卡修复：锁回调 await、声明沿用现有 ambient signature 模式、明确 if/else、合成 envelope 符合真实 contracts。最终通过上述检查；没有降低门禁。忽略证据目录为 `.artifacts/af169/`，包括 unit-first.txt、unit.txt、typecheck-final.txt、lint-final.txt 等。

## 总控接续与人工步骤

1. 接收 STOPPED Writer 候选，仅集成 bootstrap 之外的 8 个 allowPath 差异；原 dev 已具备依赖时不要把 bootstrap 当成已完成集成。派工提供的依赖集成 ID 包括 AF165 SDK `task_716ae25e1295`、AF161 SDK `task_5731129d1d35`、Agent 页面 `task_37f759959fed`、恢复 SDK `task_634f404155e8`。AF167 当前明确 Memory 行为亦为必要依赖，派工未提供它的独立集成 Task ID；总控须从真实 registry 回读，不凭推测建立 DAG。
2. 总控为 AF169 注册 fresh lease 与相应数据库/auth/fixture/verification guards，结合实际 AF161/165/167 Schema/module；重建生成 Prisma/API/SDK。运行 `AIJ_AF169_ROOT_LIVE=1 node --test scripts/verification/client-personal-agent-run-live.test.mjs`。脚本要求原 dev 工作区、真实 JobService/PG、compiled SDK+state 与自有 loopback upstream；不接付费模型。
3. live 脚本准备了实际提交/Trace/budget/明确 Memory 成功、强制丢失已 admitted 响应后只 GET 查回单 Run/call/reservation、flags off 原结果无写恢复、外人/readonly/stale 无新增 owner 写入、真实旧 scope HTTP barrier、JSON、真实上游丢响应 unknown/reserved、purged/expired、最后 owned pool=0。Worker 未运行，root 必须实际运行并修复所有失败，不能把此脚本准备完成计为 live PASS。
4. 总控生产 Web build，使用实际 Runtime 宿主与 owned synthetic HTTP 在 Orca 浏览器检查：启用且有权限的 Agent 链接；异步路由/空间选择；手填字段→键盘开启确认→取消还焦→再确认一次→读取结果；lost-response/reload；readonly/config off 结果恢复；切换 scope/账号/focus 时旧 Modal/input/result 清空；过期/unknown 隐私与错误动作；390px 无整页横溢。确认 Modal 关闭即卸载，无历史指令或 Memory 正文请求，无 storage 明文。
5. 根总控完成正式 `verify:task`、适用门禁、执行记录/队列和 exact-title 卡片提交后，才可完成真实 I-* 集成 Task；本地候选不是 CODE_VERIFIED/负责人接收，不等待 Trea，不自动续卡。

Worker 用时约 0.7 有效工程小时，低于 1.75h；留给 root 不少于 2.25h 的本卡预算。交接后 STOP ALL WRITING；最终候选 SHA、精确路径和停止状态以 worker_done 为准。
