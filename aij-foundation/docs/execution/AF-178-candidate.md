# AF-178 候选交付：提供线性工作流可视化编辑与版本保存

状态：`CANDIDATE_OFFLINE_PASS_ROOT_ACCEPTANCE_PENDING`；候选不是 CODE_VERIFIED、独立复核或负责人接收。唯一 Writer 为当前 Orca Worker，无 helper/subagent；总控接收明确停写交接后才可集成。

## 派工与现场

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W11-AF178`。
- Task：`task_f64c9a0e5a86`；Dispatch：`ctx_2db4b827801b`；terminal：`term_9d641c6d-4063-40b6-b084-f86c2e3863c3`；coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支 `weiyang86/AIJ-W11-AF178`，起始 HEAD/origin/dev 都是 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；起始 clean；remote `git@github.com:weiyang86/aij-foundation.git`。不修改 origin/dev/main、远端 Issue/PR、全局 manifest/lock/依赖或生产 Schema/module/index。
- 17 个授权 bootstrap blob 在写入前逐个核对同库 `b7783dca67475a116e9a72a922fdba293e16cb57` 及指定 SHA-256，独立提交 `a3f89bb0bf523f63c1971a2fbe5480805591e87a`。只有 allowPaths 内三个页面/状态文件继续编辑，其余 bootstrap 源保持只读。它不表示底座已集成；总控不得用 bootstrap 覆盖现有生产 SDK/index。
- 快照和哈希：`.artifacts/af178/{bootstrap-baseline,bootstrap-hashes,implementation-baseline,closeout-baseline}.json`。每写入阶段已核对实际分支、HEAD、remotes、status；忽略目录为自己的证据。独立 frozen 安装，没有复制环境/凭据/数据/依赖或共享符号链接。

## 实际差异和边界

1. 状态增加完整 canonical 等价分类、冻结编辑基线、linear 模式、expectedRevision、编辑/确认 token、真实 reorder/add/remove/input 编辑。严格校验新版本/noop、返回完整规范图/graphDigest 和精确 pin，不接受“仅 HTTP 成功”。图 PATCH 无自动重试/merge/replay，未知结果/CAS 要求明确读取；旧 scope、旧编辑和旧确认回调不能改新编辑。
2. 新增线性可视组件，真实 pointer capture→卡片矩形目标→语义重排；方向键和按钮共用状态入口。开始/Agent/结束连线按当前语义顺序显示，44px 手柄，内部滚动，名称/编号/固定版本换行。只增加已有 AntD/PageHeading/adminTheme 组合，无新依赖、全局 CSS 或布局存储字段。
3. 已有 AF173 页面增加合法线性图编辑入口；创建复用同一组件，保留原有创建/改名/删除/复杂图只读/历史/隐私。确认框条件挂载，Escape 取消回到触发元素。原 48 项测试文件未改动、断言未放宽。
4. 新增 39 项计数的 compiled SDK/状态/指针控制器/SSR/自有 loopback 测试和 root-only 真实验收脚本；新增开发说明。

API/数据库/权限/日志影响：复用 AF170 PATCH/history，未新增 API、Schema、migration、Guard、权限或审计 owner。页面变更在客户 workflow library；不产生 Run/Job/Trace/Memory、预算/通知/支付，也不调用供应商。运行账本不变性和 upstream0/pools0 的真实 PG 证明由 root-only live 脚本准备，Worker 不冒充已通过。

## 实际验证与失败

已通过：

- `pnpm install --frozen-lockfile --ignore-scripts`，仅本子工作区独立安装。
- 小包 `pnpm --filter @aij/contracts build`、`pnpm --filter @aij/sdk build`、`pnpm --filter @aij/ui build`；生成真实 ESM/CJS/declarations。
- 原 `node --test scripts/verification/client-workflow-library.test.mjs`：48/48，0 fail/skip/todo；`.artifacts/af178/old48.log`。
- 两套合跑 `node --test scripts/verification/client-workflow-library.test.mjs scripts/verification/client-workflow-linear-editor.test.mjs`：87/87，0 fail/skip/todo；`.artifacts/af178/offline-final.log`。包括真实语义 pointer→PATCH intended graph、历史 pin/newversion/noop/旧版本、严格资格和复杂只读、62/20/空/坏 pin、外指针/越界/pointercancel、CAS/未知/timeout/错误返回、所有 lifecycle 迟到成功/错误、读取屏障后零写入和 storage0。loopback 只由测试在 `127.0.0.1:0` 建立，after 关闭连接和 server。
- `pnpm exec tsc --noEmit --project apps/web/tsconfig.json`：exit0；`.artifacts/af178/typecheck-final.log`。
- 原始完整 `pnpm run lint`：exit0，包括新 ambient 声明，未覆盖 parser 或修改规则；`.artifacts/af178/lint-final.log`。Next 仍打印既有缺少 pages 目录提示，无 lint 错误。
- `node --check scripts/verification/client-workflow-linear-editor-live.test.mjs`、`git diff --check`：exit0。

修复前：首次 Web noEmit 返回 TS2345（AntD 的 `PointerEvent<HTMLElement>` 与局部 `PointerEvent<HTMLButtonElement>` 不匹配），证据 `.artifacts/af178/typecheck-initial.log`；局部改为实际事件 HTMLElement 后通过。初版新增测试 86/86，扩展旧确认 token、62 步和历史 pin 当前更新后最终 87/87；没有删除或放宽原 48 项断言。

NOT_RUN：DB/Docker/migrate/seed、真实 API/Web 启动、API/Web production heavy build、root fiveguards、正式 verify:task、root live、桌面/390 原生浏览器、current Run/Memory 回归（冻结 Worker 树无对应测试源，交 root 集成树运行）。无运行中访问地址、常驻服务或合成账号交付。Worker 全部网络仅 frozen 安装及自有合成 loopback，不访问真实供应商/支付/通知。

## 总控接收和人工步骤

总控须接收 `STOP ALL WRITING` 后只精确集成候选 delta，先完成真实 I177 安全更新依赖；I178 的正式依赖必须写总控真实 I177 Task ID，不能把本候选或 bootstrap 当成集成完成。AF170/AF173 的已验证 API/Schema/SDK/页面基础依赖保留，bootstrap 的历史集成引用分别为 `task_5943982f67fa` / `task_f1c8b18f7c85`；本 Worker 不修改正式依赖队列。

按 [开发说明](../development/PERSONAL_WORKFLOW_EDITOR.md) 注册 exact AF178 五处保护和正式 registry/build；root 独占 DB/heavybuild 各 concurrency1，创建 fresh AF178 合成租约，运行 guarded real HTTP/PluginLifecycle/PG+builtSDK/state 验收，核对运行域 before/after hashes、upstream0、finally pools0。脚本已增加真正 graph PATCH 及旧 scope HTTP 屏障、unknown committed PATCH；它尚未运行，若发现失败应真实修复记录。

真实桌面和 390：打开自己的合法线性草稿→鼠标拖手柄重排→保存→重新读当前→读 v1 确认旧图/绑定未变；键盘手柄 ↑/↓ 和上下移→保存→查看新版本；添加当前/历史 pin、移除、改输入键；未修改保存不增加版本；复杂/自定义/空图保持只读，名称编辑不丢结构。测试 stale CAS、坏/停用来源、只读角色、空间/账号/隐藏/离页、旧 Modal 清除及 Escape 焦点，确认页面无横向溢出。不得 evaluate/DOM mutation 伪造拖动。

总控最终完整 lint/typecheck、current Run/Memory 回归、production build、verify:task、执行记录/正式队列及原名本地卡片提交与回读后才能完成 I178；之后负责人批次 OWNER_CHECK_PENDING。没有 Trea 等待，自查不是独立复核。未发布/运行/恢复历史/任意画布，不声称完成完整 REQ019。

Worker 有效工程时间约 0.3 小时（人工估计，不是精确计时）；开始快照 UTC `2026-11-05T19:19:07Z`，总控耗时不包含在这个 Worker 估值内，仍须计入本卡/批次预算。候选提交标题逐字为“提供线性工作流可视化编辑与版本保存”，最终 SHA 和 clean/STOPPED 以 Orca 交接回读为准；不 push，不自动接续下一卡。
