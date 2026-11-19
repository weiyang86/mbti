# AF-166 候选交付：提供个人长期记忆管理页面

状态：CANDIDATE / NOT CODE_VERIFIED；总控集成与正式验收待执行，之后仍需 OWNER_CHECK_PENDING。Writer 在本地候选提交与 SHA 回读后 STOP ALL WRITING；最终 SHA 见同一 Dispatch 的 worker_done。没有 push、远端 Issue/PR、部署或下一卡续跑。

## 身份、基线与写入阶段

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W08-AF166`，Orca instance `908abe76-b9a7-4011-83dd-bff8c2e8dc70`。
- Task `task_d4f691e0983e`；Dispatch `ctx_f33d052e32ff`；Writer terminal `term_2d3ef9ed-7f99-43d5-b261-27c585ed2c55`；总控 terminal `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支 `weiyang86/AIJ-W08-AF166`；初始 HEAD 与 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，初始 status 干净。远端 fetch/push 均为 `git@github.com:weiyang86/aij-foundation.git`。
- 每轮实现、测试补充、修正和提交前均回读 status/branch/HEAD/origin/dev/remotes；实现阶段 HEAD 为 bootstrap `839abf11f8b7e75ca2f2c7ddd907a3d83950fcd8`，差异只有本卡 allowPaths，`origin/dev` 持续保持初始 SHA。无继承或用户改动，无其他 Writer。
- 工作时间约 0.35 工程小时，未使用辅助 Agent；3h 批内余量交总控，Worker 未使用 1.75h 上限。

## 精确来源 bootstrap（独立提交）

先从 `589d587ba1bd9da782fc6d35245430bfe147c4a3:<path>` 读取全部 15 个授权 blob，全部 SHA256 与派工逐项相等后才写入，再独立提交 `839abf11f8b7e75ca2f2c7ddd907a3d83950fcd8`。只包含派工清单中的 contracts/SDK/index/build helper、Agent 页面及工作台源文件；没有复制 env、凭据、数据、依赖或产物。来源关系：contracts/Agent SDK `task_bb2bf1841ea9` / `task_8225f38866ac`，memory SDK `task_f597249cbeb2`，Skill SDK `task_623c04531bae`，run SDK `task_5731129d1d35`，recovery/build `task_634f404155e8`，Agent UI `task_51b45b290b1a`，workbench state `task_99d2fef42591`。这是 source-only bootstrap，不是基础集成完成证明；后续只改两个 allowPaths 中的导航行，其余 bootstrap 只读。

## 实际候选差异与边界

- 新增 `/client/memories` 页面、`client-memory-library.tsx`、无持久化的 state MJS 及声明；使用**实际编译**的 `createPersonalMemoriesClient` / `createPersonalAgentsClient`，经现有 `clientApi` 的 Cookie / no-store / Workspace header 传输。
- 先 me、workspaces、context，再读取私有摘要。读取与管理权限分离；只有读取权限可以查看自己的详情，不能创建/修改/删除。不可访问的先前空间不默默回退到其他空间，要求明确选择并重新验证。
- 标题、内容、三种类型、默认 false 的显式使用许可、最多 16 个唯一自己的 Agent；从真实分页 Agent 名称选项选择并显示启用/停用，停用可预授权。空授权=NONE。保存前确认完整替换、当前许可/授权与精确 expectedRevision；409 要求重新读取，写入不自动重试。
- 列表只保留摘要，不为每行抓正文。详情才读取当前内容/授权/修订，授权逐项验证 Agent 身份；404 显示不可用，无原始 ID/猜测身份，移除后才能保存。没有历史/恢复/自动学习/自动采集/组织共享/执行承诺，也不依赖 AF-167。
- 创建、修改和永久删除确认；确认 Modal **仅在 confirmation 存在时挂载**，私有状态清理立即卸载 portal。删除说明清除当前内容/授权、不能恢复或复用编号；已有任务结果按任务保留策略处理。
- 所有请求共享 epoch + scope abort + 独立 timeout，连不遵守 abort 的 transport 也会结束等待，隔离迟到 success/rejection/finally 与 mutation return。重新验证/切空间/切回窗口/visibility/pagehide/退出清空正文、授权、选项、草稿、错误和弹窗；scope 重验之后才读取新数据。
- 写入 timeout/网络异常属于结果不确定，清草稿并禁止写入直到重新读取；写入已确认、列表刷新失败则保留已确认反馈，明确提示不要重复提交。URL/storage/log/telemetry/journal 不保存正文或标题；页面内存是唯一私有 UI 存储。
- 原工作台与 Agent 页仅各新增一条资产读取权限内的记忆 Link，diff 各一行；未改变 recovery/journal/locks/submit 或 Agent 配置行为。
- 数据库/API/权限定义/日志实现均无变更；未改 Schema/module/SDK index/清单/锁文件/队列/registry/AGENTS/global CSS。页面新访问地址是 `/client/memories`，**未启动** Web/API，不声称已运行可访问。

## 已执行验证、失败与修正

- `pnpm install --frozen-lockfile --ignore-scripts`：成功，独立本地安装，无共享/symlink node_modules、无 lockfile 改动；pnpm 提示既有 Node url.parse deprecation。
- `node scripts/build-workspace-package.mjs packages/contracts`、`packages/sdk`、`packages/ui`：成功，仅小型公共包构建。SDK 实际输出 personal-memories / personal-agents 子模块及 ESM/CJS 声明。
- `node --test scripts/verification/client-memory-library.test.mjs`：最终 **55/55 PASS**，全部使用编译后的公共 SDK。覆盖默认 opt-out/NONE/唯一 16 个与排序、遗漏字段全替换语义、确认/CAS/撤销/删除/重放、只读与无读权限、不可用 Agent、分页、请求 timeout/写入结果不确定、成功后列表失败、principal 变化、所有依赖 me/workspaces/context/list/detail/grant/options/分页/mutation/logout 的旧作用域迟到成功和拒绝以及 finally。
- `pnpm --filter @aij/web typecheck`：最终 PASS。
- 定向 `pnpm exec eslint`（两个改动导航文件、新页面/组件/state/声明、两个测试文件，`--max-warnings=0`）：最终 PASS。配置本身打印既有 pages-directory 提示，未改 lint 配置或放宽门禁。
- `git diff --check`：PASS。
- 如实保留首轮失败：TS2345 因 Select 的 undefined value 推断，改为 `Select<string>`；离线 fetch fixture 缺少标准响应的 message，修正合成响应后通过；新增焦点 effect 触发 exhaustive-deps warning，改为稳定 activeDetailKey 依赖后零告警通过。这些不是 DB/真实 API/浏览器通过证明。

## 设计与可访问性自查

使用 `frontend-design-review` 技能，沿用既有 Ant Design / PageHeading / adminTheme / workspace 类，无 Figma/Storybook 输入，不重做视觉系统。Frictionless：主操作新建、详情编辑/删除、可回到第一页与重新验证，权限/错误有具体下一步；Craft：复用主题，详情标题焦点、各输入 aria-label、键盘可操作按钮和 AntD Modal；Trustworthy：明确许可/未执行、冲突重读、不确定写入、删除不可恢复。表格 `scroll.x=640` 只在表内横向滚动，容器 minWidth 0/maxWidth 100%、文本换行、Space wrap、继承 390px 移动布局。此处为**源码自查，不是独立复核，也不是浏览器视觉验收**；真实桌面/390px 布局和键盘/焦点仍留给 root。

## ROOT ONLY / Worker NOT_RUN

新增 `scripts/verification/client-memory-library-live.test.mjs`，Worker **没有执行**。脚本要求主目录、dev、非 child worktree、`AIJ_AF166_ROOT_LIVE=1`、新 AF-166 acceptance；仅绑定 127.0.0.1，真实 Cookie/API/DB 和编译 SDK/state，AI upstream 直接 fail guard。覆盖创建确认→修改/撤权→409/noop/replay/列表游标/删除与不可复用编号、真实 Agent 名称/foreign404/readonly403 零域写入、真实 HTTP detail/options/grant/mutation 旧 scope 返回屏障、写入确认后刷新失败的部分结果、私有状态清理、删除行 NULL 与 grants=0、审计不含私有文本、Run/Job/Trace 等账本不变、upstream=0、app.close 后 pools=0。其代码目前只通过 lint/type/source 自查，没有借用前卡真实验证。

总控先等待本 Writer 明确 STOPPED，再精确集成**bootstrap 后的候选 delta**（主 dev 已有 bootstrap 来源时不要重复 bootstrap commit）；依赖 AF-163 集成 Task `task_f597249cbeb2` 与 Agent 集成 Task `task_8225f38866ac` 及现有授权 transport。总控独占处理实际 Schema/module/SDK index/正式 queue/registry/fixture allowlist（本卡不需要新模型或 SQL），为 AF-166 注册 fresh acceptance 和适用 fiveguards/runner；重建自己的实际 API/Web/public SDK 后运行 `AIJ_AF166_ROOT_LIVE=1 node --test scripts/verification/client-memory-library-live.test.mjs`。前提文件若尚未注册 AF-166，必须由 root 正式适配，不由 Worker越权扩展。

另外 NOT_RUN：正式 `verify:task AF-166`、fiveguards、完整 heavy API/Web build、DB/Docker/migrate/seed、实际生产 Web、packed SDK 正式验收、真实 browser 和人工 owner 验收。没有 Trea 等待。

## 总控人工验收步骤

1. 实际生产 Web 登录：从工作台/Agent 页的授权入口进入记忆页；桌面和 390px 测试没有全页横向溢出，Tab/Enter/Escape、详情焦点与确认焦点可用。
2. 当前空间先显示摘要；新建填写编号/标题/内容/类型，默认关闭，空列表=NONE。选择自己的 Agent 名称（含停用状态）后明确启用，检查确认并保存，查看当前正文/授权/修订；没有擅自执行任务。
3. 编辑关闭许可/撤销所有 Agent 并确认，全字段替换后详情仍 NONE；两页面并发编辑造成 409，需重新读取才能再改；确认无静默重试或覆盖。新建重放与删除后编号不可复用的反馈准确。
4. 让已授权 Agent 被删除，详情显示不可用、无裸 ID，编辑需移除此项才能保存；只读角色可看不能写，真实服务器也 403，foreign 404 不改域数据。
5. 正文/草稿/选择/错误/确认存在时切空间、焦点恢复、visibility/pagehide、退出，检查立即清理且 modal portal 消失；延迟 HTTP 的返回不能回填旧内容或恢复弹窗。
6. 永久删除后确认当前内容/授权已消失且不可恢复；此前 Run/Job/Trace/结果保留策略未变、upstream=0/pools=0。总控完成正式验证、执行/队列记录、原名本地提交与授权 push/readback 后才完成 I-*；随后负责人验收。
