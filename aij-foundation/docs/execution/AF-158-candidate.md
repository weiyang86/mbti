# AF-158 候选交付：提供用户私有Skill管理页面

状态：CANDIDATE_READY，**不是 CODE_VERIFIED**；总控集成、正式门禁、真实浏览器及负责人验收待执行。Writer 完成本候选本地提交后停止全部写入，精确候选 SHA 由交接消息和 `.artifacts/AF-158/handoff.json` 回报。没有 push、PR、merge 或发布。

## 授权、工作区与来源

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W06-AF158`；真实 instance `0845a3c8-e4b6-48df-817b-0e714dbb7d7f`，状态 in-progress。
- Task `task_9ea4996f4da6`，Dispatch `ctx_5be2a5afc236`，Writer terminal `term_8e76c77b-5f42-41de-aa68-03c4d2aa0e2b`。
- 分支 `weiyang86/AIJ-W06-AF158`；初始状态干净；HEAD 与当时 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；origin fetch/push 均为 `git@github.com:weiyang86/aij-foundation.git`。完整写前记录见本工作区忽略目录 `.artifacts/AF-158/baseline.json`。
- 按派工从 `a0b18bfa6a9bd091332cdff0135edcee0aedda85` 精确 `git show commit:path` 恢复指定 7 个文件，全部 SHA256 与派工一致；单独 bootstrap 提交 `1a394798b8d51b23c50b1e5b510bb7d2eada4655`。候选以此为父提交，**总控仅接收 bootstrap 之后的单卡差量，不回放 bootstrap**。
- Bootstrap 包含 workbench 的 3 个文件、SDK index/personal-skills/ai-run-recovery 及 workspace build 脚本；候选没有修改 SDK、工作台状态/恢复 journal/锁或 build 脚本。只读取根工作区 AF-154 API/测试和本卡规格，没有写根 dev、正式队列、registry、Schema 或轻企仓库。
- 使用 frontend-design-review 技能做同 Writer 自查；使用 Orca orchestration/CLI 技能核对实际注册工作区及最终交接。没有子代理或 helper worker。

## 实际差量与影响

共 8 个允许路径：`apps/web/app/client/skills/page.tsx`、`apps/web/app/components/client-skill-library.tsx`、`client-skill-library-state.mjs`、`client-skill-library-state.d.mts`、现有 `client-ai-workbench.tsx`、`scripts/verification/client-skill-library.test.mjs`、`client-skill-library-live.test.mjs` 及本文档。

新增 `/client/skills`，复用 Ant Design、PageHeading、adminTheme、客户空间/知识库样式。工作台只增加一条受实际当前 context 的 `workspace.ai.assets.read` 控制的「我的 Skill」链接。页面通过既有 `clientApi` 与实际编译的 `@aij/sdk.createPersonalSkillsClient` 调用 AF-154 的 list/create/get/update/delete/versions 六个接口，不维护本地 CRUD 真值。

会话与空间来自 `/client/auth/me`、`/client/workspaces?page=1&pageSize=100`、`/client/workspaces/context`；URL 只允许导航空间编号。只读资产角色能读自己的条目与历史；没有 manage 不提供写入能力，客户端状态方法也拒写。每次写入都需要明确确认，编辑/删除携带服务端 revision；409 给出刷新或重新读取当前版本入口，不自动提交/重试 POST。服务端同编号重放可能返回已有记录，反馈明确说明，没有把它冒充新增。

每次空间选择、重新验证、退出，以及 pagehide/页面隐藏/卸载立即清空私有列表、详情、历史、预览、草稿、确认框与旧错误并中止请求。回到页面/窗口重新获得焦点会重验会话。所有异步成功、拒绝与 finally 均用 epoch 检查，取消信号不能阻止的旧响应也不能覆盖当前空间。每个请求同时保留 8 秒超时。名称和提示词仅在页面内存与确认后发往既有 API，不写浏览器存储、URL、遥测或 workbench journal。

列表每页最多 20 条，版本每页最多 10 条，通过真实 `afterId` / `beforeRevision` 游标替换当前页；预览标明「历史、只读、非当前编辑内容」，不能恢复或执行。区分加载、无空间、无读取权限、已知未配置 API 地址、网络失败、HTTP403/404/503、实际空列表；后端 SDK 仅公开 HTTP 状态，因此 404/503 只说明能力/服务不可用及可能原因，不伪称确知插件安装或停用原因。

数据库/Schema/权限定义/后端接口：无修改；页面复用现有权限。日志/遥测：无新增。包/依赖/全局 CSS：无修改。仅 frozen 独立安装到本子工作区并构建 contracts/sdk/ui 小包；没有复制环境、凭据、node_modules、上传目录或真实数据。

## Worker 验证与失败记录

- `corepack pnpm install --frozen-lockfile --ignore-scripts`：exit 0，独立安装；日志 `.artifacts/AF-158/install.log`。
- `corepack pnpm --filter @aij/contracts build`、`--filter @aij/sdk build`、`--filter @aij/ui build`：均 exit 0。消费的是这些包的真实 dist。
- `node --test scripts/verification/client-skill-library.test.mjs`：最终 **31/31 pass，fail/cancel/skip/todo 均 0**；日志 `.artifacts/AF-158/pure-tests-final.log`。覆盖真实编译 SDK 的 cookie/no-store/空间 header、六方法、字段白名单、scope/owner 选择、权限、请求 abort/超时、旧详情/历史及三类写入的旧成功/拒绝、创建确认/重放/409、revision CAS409、删除确认、列表/版本游标、历史只读编辑隔离、成员重验/退出/生命周期清空、响应契约拒绝和所有主要错误状态。HTTP 响应为单元合成响应，不充当真实后端/数据库证明。
- `corepack pnpm --filter @aij/web exec tsc --noEmit --incremental false`：exit 0（覆盖页面导入图与声明）；日志 `.artifacts/AF-158/typecheck-final.log`。
- 定向 ESLint：页面、组件、状态、workbench、纯测试与 root-only live 文件 `--max-warnings=0`，exit 0；声明文件单独使用 `--parser @typescript-eslint/parser --no-inline-config --max-warnings=0`，exit 0。声明单独运行时 Next 规则输出 Pages 目录提示，未产生 ESLint error/warning；未改全局配置压制它。
- 初次 lint 因测试辅助函数未使用解构变量失败 1 项，已改为显式投影字段后复跑通过；初轮纯测试 26/26，随后补充旧写入拒绝、未配置与超时用例至 31/31。未隐藏失败。
- `node --check scripts/verification/client-skill-library-live.test.mjs`、`git diff --check`：exit 0。

NOT_RUN Worker：`verify:task AF-158`、API/Web 重构建、真实 HTTP/数据库验收、实际生产浏览器桌面/移动页面检查。没有启动数据库、Docker、migrate/seed、应用服务或厂商/支付/通知；3655/3656 未由本 Worker 启动。拟访问地址 `http://localhost:3655/client/skills` **未在 Worker 运行或浏览器验证**。

## 总控必须完成的接收与验证

1. 核对 Writer 明确 STOP ALL WRITING 及精确候选 SHA，只集成 bootstrap 之后这 8 路径差量；AF-154 API、SDK 与 Schema 依赖须引用已完成的真实集成 Task（SDK `task_623c04531bae`，既有 workbench `task_99d2fef42591`），本候选不是其替代。
2. 总控独占修改五处 AF-158 保护性登记：database connection、migration、seed、auth-support、client-auth-fixture；另由总控建立正式 verify:task registry 和执行/队列记录。本 Writer 未修改这些共享文件。
3. 根 dev 在独占数据库/重构建调度下校验目标、生成 Prisma、构建 API/Web 和所需包，注册正式 AF-158 门禁。只创建新 AF-158 租约；不得借用 AF-154 旧租约。使用 `AIJ_AF158_ROOT_LIVE=1 node --test scripts/verification/client-skill-library-live.test.mjs`，仅允许真实根工作区 dev、git common-dir 相等与显式环境门控之后创建数据库。
4. Live 文件以实际 AF-154 API 和新页面状态验证 5 组：真实 session/context + 创建/重放/刷新/409；编辑 CAS409/重载/12 版本游标；真实 HTTP 旧空间响应先到后阻塞交付，切换后的详情与草稿完整保留；真实只读权限及 3 种写入 HTTP403 且资产/版本/审计行数不变、成员/空间404；22条游标列表与确认删除、同删重放、历史404/tombstone/编号拒用、内存清除。测试不返回或保存 cookie/名称/提示词证据，结束关闭应用并核对 API pool=0。它尚未执行，根首次运行如有失败须保留记录并交回原 Writer。
5. 实际 production Web 的桌面（如 1440px）和手机（如 390px）检查：从有 read 权限的 AI 工作台进入；新建填写/返回检查/确认；编辑确认及 stale409 重新读取；刷新不增加记录；查看历史只读/游标；删除确认；只读账号能读自己的条目但不能写或看到他人资产。另测试切换空间/重新登录/离开页面时内容清空，延迟旧响应不回填；无权限、停用能力、未配置、断网、空态与加载态各有真实证据，输入不进入地址栏/存储。检查长中文提示词、表格横向滚动、键盘标签与确认框焦点。当前仅复用了既有响应式样式和 Ant 控件，未作 Figma/Storybook 对照或完整 WCAG 合规声明。
6. 通过正式门禁后总控按原任务名称本地提交、按授权处理队列与 Git 节点并回读 SHA；候选提交不代表 CODE_VERIFIED、独立复核或负责人接收。后续新卡不得引用本 Worker 候选完成作为正式代码依赖。

没有产品范围阻塞；未完成项是上述总控专属正式验收。Worker 使用预算小于 2h，保留至少 1h 根集成预算；实际起止时间随 handoff artifact 记录。
