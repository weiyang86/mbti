# AF-173 候选交付：提供个人工作流草稿管理与流程预览页面

状态：CANDIDATE / ROOT_VERIFY_PENDING，非 CODE_VERIFIED、非负责人接收；Worker 未启动真实应用或执行数据库验收。Writer 在本候选提交后 STOP ALL WRITING，等总控接收，不自动接续其他卡。

## 派工、来源与写入边界

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W10-AF173`；instance `bb6730dc-6078-4556-a9b9-902c1678c175`。
- Task `task_117c4b5fc41b`；Dispatch `ctx_f34c9b63a361`；terminal `term_3d39595c-be43-4bfd-bf25-47ea9eb4f3dd`；总控 terminal `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支 `weiyang86/AIJ-W10-AF173`；起始 HEAD / `origin/dev`：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`，起始 status clean。
- fetch/push remote 均为 `git@github.com:weiyang86/aij-foundation.git`；无 push、远端改写、分支切换、全局依赖变更。总控主工作区与轻企均未写入。
- 单独 bootstrap：`b0ffa1ea48a55c114f4ad1cf01c036fc2d09d736`，严格从 `8ebad0d62ae043e9ec0ca1b9b0f8df1a2b23b622` 读取派工指定的 16 个 source blob，逐个 SHA-256 匹配后一次提交；无 env、数据、依赖目录或 Schema。SDK 工作流依赖 integration Task `task_5943982f67fa`，其余来源按派工列出的实际 I-* Task；不是把 bootstrap 当作已集成基线。
- 各写入阶段均回读 pwd/Orca 工作区、status、分支、HEAD、remote：初始 clean@94b0236；bootstrap 后 clean@b0ffa1e；状态层→组件/入口→离线/根 live 脚本→修正/文档阶段 HEAD 均为 b0ffa1e，status 仅本卡 allowPaths 的新增文件及 Agent 导航一处改动。bootstrap 其余 15 个只读文件经与 8ebad0d 比较无差异。
- 本卡候选 parent 为 b0ffa1e；总控应只精确接收 `b0ffa1e..候选HEAD` 的 9 个 allowPaths，不重复接收 bootstrap。Worker 工程用时约 0.5h，低于 1.5h；预算总额 4h 包含总控。

## 实际改动与产品行为

新增 `/client/workflows` 及 ClientWorkflowLibrary、状态层和声明、普通 SVG/HTML 图预览，现有 Agent 页只增加“工作流草稿”导航，配置及运行逻辑未改。沿用 PageHeading、Ant Design、adminTheme、现有工作台布局，无全局 CSS、依赖、manifest/lock、SDK/Schema/module/index 或注册表改动。

先真实 `me → workspaces → context → assets.read`，显式空间 selector 缺失不选默认空间，非成员空间拒绝；URL 只读取不透明 workspaceId。当前个人范围由 API 再鉴权，其他 OWNER 也不共享草稿。assets.read-only 仅能看自己的列表、详情和历史，不创建写表单/写动作。

- 实际 SDK `createPersonalWorkflowsClient` / `validatePersonalWorkflowDraft`（通过 clientApi）负责 API 和结构校验，列表及不可变版本摘要按 20/cursor 分页。
- 普通字段填写编号、名称、输入键；读取自有 Agent 摘要，显式选择拥有的当前/历史版本，按顺序增加、移除、重排步骤，生成 canonical start→steps→end 图。未选固定版本不能保存，提交前重读自有摘要及精确版本；缺失、停用、变更均显示拒绝，不替换 latest。
- AF159 只有返回完整内容的版本列表接口；为历史版本选择进行有界读取，校验公共形状后只保留 pin 元数据，不在页面状态保存 Agent 指令、Skill 配置或 Memory，不请求 Agent get / Skill / Memory。
- 已存复杂图只能改名，以原图及原 Agent revision 提交 CAS；条件、并行、汇合、有限循环、人工审批占位全部保留，不进入线性 builder。
- 当前图与独立获取的历史图、绑定和版本记录分别显示。历史不恢复、不提升；删除显式确认当前 revision，服务端保留编号墓碑。
- SVG 展示真实节点/边/端口，文本拓扑列出全部标签、条件、边、Agent pin；可展开有限嵌套循环体。SVG 不使用任何用户拼接的 DOM id、unsafeHTML、外部渲染器/图像。图区域独立滚动，页面组件设置 minWidth/maxWidth/文本换行，桌面/390 实际浏览器验收由总控完成。
- DRAFT / 结构有效不表示可执行；人工审批明确为占位，不提供授权或自动决定。本卡无 canvas 拖拽、发布、运行入口或伪禁用动作。

严格验证公共字段、数量/文本/日期/版本 bounds、未知字段、游标顺序、图结构、图 SHA-256 及每个精确 Agent binding。私有状态只在 RAM；无 storage、日志、URL 私有内容。切换空间、账号重新验证、focus、visibility、pagehide、dispose/logout 清除编辑/确认/详情/历史；epoch+Abort+timeout 阻止旧成功、拒绝、finally 或依赖读后的 HTTP 写入。

POST/PATCH/DELETE 不自动重试、不自动合并。409 明确重新读/检查；仅 POST 真正发送后结果未知才保留原 code/name/canonical graph/pins，允许明确原样确认；预检失败没有 replay，400 后修改输入会建立对应新请求身份，跨 scope 清除 RAM replay。已发往服务端的写入不能靠客户端 Abort 撤销，须按实际结果重新读取。

数据库/API/权限/日志影响：复用 AF170 API 与存储，不新增接口、迁移、权限或账本；本页不执行 Agent，不写 Run/Job/Trace/预算预留/Memory/通知/支付。以上 durable 不变性仍须总控 real PG 验收证明，Worker 离线测试不是此证明。

## Worker 验证与失败记录

实际 PASS：

1. `pnpm install --frozen-lockfile --ignore-scripts`（本子工作区独立 node_modules，无共享/符号链接至其他工作区）；小型 `pnpm --filter @aij/contracts build`、`--filter @aij/sdk build`、`--filter @aij/ui build`，实际 ESM/CJS/declaration 输出，SDK 不是 source stub。
2. `pnpm --filter @aij/web typecheck`（tsc --noEmit，包含新 d.mts）；最终通过。
3. `node --test scripts/verification/client-workflow-library.test.mjs`：48/48 PASS，真实编译 SDK+状态与源组件/SSR，synthetic transport；唯一网络是测试自建 127.0.0.1 临时端口，after 主动关闭所有连接/server。包括顺序创建精确图、复杂图 name-only/noop/历史、严格 graph/public corruption、只读/缺失/越界/依赖、CAS/未知结果显式 replay/400 修正身份、所有 async 读取阶段及生命周期的迟到成功/拒绝、依赖屏障之后零 POST、timeout、storage0 源检查、条件 Modal/focus 恢复和 SVG SSR。最终输出 `.artifacts/af173/offline.tap`（ignored own artifact）。
4. `pnpm exec eslint apps/web/app/client/workflows/page.tsx apps/web/app/components/client-workflow-library.tsx apps/web/app/components/client-workflow-library-state.mjs apps/web/app/components/client-workflow-graph-preview.tsx apps/web/app/components/client-agent-library.tsx scripts/verification/client-workflow-library.test.mjs scripts/verification/client-workflow-library-live.test.mjs --max-warnings=0`：PASS。
5. 新根 live 脚本仅 `node --check`：PASS；`git diff --check` PASS；bootstrap 只读文件对源无差异。

修正前真实结果：首次 ESLint 报 control-regex、unused vars/expression，已修复；live 脚本 unused MANAGE 已去除。额外明确输入 `.d.mts` 的命令触发现有 `eslint-config-next/parser` 与 typescript-eslint `node.params is not iterable`，未修改全局配置或降级规则；该声明由真实 tsc 验证，另用 ignored `.artifacts/af173/lint-declarations.mjs` 只对该文件指定 TS parser、保留原所有规则，结果 PASS。Next 还打印仓库缺少 pages 目录的现有提示。一次扩展生命周期用例在实际进入 Agent 摘要请求前 reject 了测试 gate，47 个计数中 45 PASS/2 FAIL；改为等待被测试请求实际进入 barrier，之后 47/47、最终 48/48 PASS，不掩盖此修正前失败。

NOT_RUN：任何 DB/Docker/migrate/seed、真实 API/Web startup、API/Web production heavy build、fiveguards、正式 verify:task、real live 脚本、desktop/390 浏览器。页面没有实际访问地址或运行进程可交付；`/client/workflows?workspaceId=<opaque-id>` 是待启动后的路径。未调用付费模型/供应商/通知/支付，未向外发消息（只按派工完成 Orca 交接）。

## 总控串行接收与真实验收

1. 接收 STOPPED 后精确审查候选 delta；已有 AF170 实际 API/Schema/module/SDK 必须保留。根工作区独占 DB/heavybuild 各 concurrency1。不得 cherry-pick bootstrap 覆盖已集成共享 index/module。
2. 总控注册新 AF173 lease：`scripts/runtime-environment.cjs`、`scripts/database/migration.mjs`、`scripts/database/seed.mjs`、`scripts/verification/auth-support.mjs`、`scripts/verification/client-auth-fixture.mjs` 五处（另按现有约定更新 runner/registry 和 web-build-isolated；Worker 没写这些文件）。使用 AF173 新隔离测试库，绝不借用旧卡租约或主库。
3. 重建适用公共包与真实 API/Prisma 后，根 `dev` 使用 `AIJ_AF173_ROOT_LIVE=1 node --test scripts/verification/client-workflow-library-live.test.mjs`；脚本在 explicit root path/dev/common-git-dir gate 后才动态引入数据库模块，fresh lease→审定 migrate/seed→真实 Cookie API/PluginLifecycle/PG→built SDK+state。校验真实 CRUD/history/exact pins、复杂图 name-only/noop/CAS、两空间/foreign/其他 OWNER/只读个人记录、实际丢失创建响应的精确 replay、真实 HTTP 依赖读后 scope 切换零 POST、停用/变更拒绝、20/cursor、tombstone/plugin 关闭拒绝；运行域表哈希不变及 upstream0，finally 关闭所有 store/应用并查 API pools0。该文件由 Worker 只做语法/lint，运行错误必须如实修复并记录。
4. 运行正式 `verify:task AF-173` 与适用质量门禁、production Web build、桌面/390 真实浏览器。人工：从 Agent 导航进入→选空间→新建普通字段草稿，选自有 Agent 历史/当前版本，添加/重排/移除→确认保存；改名→查看 v1 与当前 v2 分离→键盘 Escape 取消确认并焦点返回→CAS 冲突重新读→确认删除；复杂图应覆盖条件/并行/join/loop/approval 标签、端口/嵌套文本；切换角色/空间/账号/focus/隐藏/离页，确认旧名称/图/历史/Modal/输入清除，390 无页面横溢。
5. 总控完成真实门禁、执行记录、正式队列更新及原名卡片提交/必要回读后才完成 I-*；候选不代表 CODE_VERIFIED、PR review、独立复核或负责人验收。后续 canvas/editor/publish/executor 必须另卡，不能在本候选扩写。
