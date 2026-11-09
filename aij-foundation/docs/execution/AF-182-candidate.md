# AF-182 候选交接 — 提供知识网页导入与来源核对页面

状态：CANDIDATE_READY_ROOT_VALIDATION_PENDING；不是 CODE_VERIFIED，不是负责人接收。Writer 自查不冒充独立复核，不等待 Trea。

## 派工与写入基线

- Task：`task_46e6d8626bdf`；Dispatch：`ctx_9c9c2bd2d0ff`；Writer terminal：`term_30992151-a645-4185-9e2b-390191ec4fc7`；总控：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 实际 Orca Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W12-AF182`；instance：`1e103b93-f795-4be2-94c5-2b7106a7f004`；由 `origin/dev` 注册创建。
- 分支：`weiyang86/AIJ-W12-AF182`；起始 HEAD / origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；首次 `git status --short --branch` 干净。
- Remote fetch/push：`git@github.com:weiyang86/aij-foundation.git`。未 fetch 改 tracking ref，未 push/merge/tag/main/dev 写入或远端 Issue/PR 操作。
- 2026-11-06 北京时间约 04:42 开始；每个写入阶段前均回读 status、HEAD、remote，仍在同一注册分支，仅本卡文件有修改；root 与轻企源库没有写入。

21 个授权 blob 来自 `55719998d8d6aafe18260c87d5c230352a16522b` / 集成 Task `task_64bbf46af804`，逐文件 SHA-256 与派工值一致后恢复，单独提交 `c067669fb7aa941ac1c23d766232869fc3d182d8`（17 文件实际与起点不同，4 文件原本已一致）。所有 bootstrap 文件随后只读，仅两个同时位于 allowPaths 的 manager/API 作本卡增量；候选交接仅需取该 bootstrap 后的本卡候选提交。完整 pinned hashes 和命令证据留在本地 ignored `.artifacts/af182/`，不会把它当正式队列或凭据来源。

## 实际差异与影响

- 修改 `client-knowledge-manager.tsx`：现有 Workspace/权限/页面结构内增加导入入口、仅网页行的按需来源动作、同空间/账号/角色重验证及生命周期隐私清理；旧异步结果不刷新其他空间。保留手动、文件/CSV、编辑、显式状态切换、筛选、分页；普通知识查询文件未改。
- 修改 `client-knowledge-api.ts`：只组合实际公共 AF179 SDK。新增 `client-knowledge-web-import.tsx` 及 `.mjs`/`.d.mts` 控制器：表单、明确确认、只发一次 POST、严格受限响应校验、未知结果锁/主动重读/明确解锁、私密文本来源核对与旧回调凭据。
- 新增两份测试与 `KNOWLEDGE_WEB_IMPORT_UI.md`。新增 UI 没有 CSS/依赖/全局 index/API/schema/module/权限/数据库迁移差异。调用仅现有 AF179 首次导入与来源 GET，不实现来源刷新/版本/恢复/自动启用/自动查询。
- 日志/存储：不增加 URL/正文/来源日志或浏览器持久化；不渲染抓取 HTML、iframe、图片或外链。Controller RAM 清理保留未知请求对应的布尔锁，不留 URL/标题/正文。卸载后无法跨整页刷新持久化锁，服务端编号唯一约束仍是覆盖防线。

## 真实验证与失败记录

- `pnpm install --frozen-lockfile --ignore-scripts`：通过，独立工作区 781 包，无复制/共享父 node_modules/环境/上传目录。
- `node scripts/build-workspace-package.mjs packages/contracts`、`packages/sdk`、`packages/ui`：全部通过，只编译小型公共包。SDK 是授权实际源码导出，未改源码实现或全局 index。
- `node --test scripts/verification/client-knowledge-web-import.test.mjs scripts/verification/client-knowledge-web-import-live.test.mjs`：最终 **16 passed / 0 failed**。含 5 个真实 loopback HTTP 子测试，覆盖合成提交后丢回复、一次 POST、普通列表原编号重读、重复编号拒绝、私密来源 GET/手动不匹配、延迟旧空间 POST 和同空间 GET/角色账号变化零新写入；不是 API/PG/HTTPS reader 验收。
- `pnpm --filter @aij/web typecheck`：最终通过。定向 ESLint 对五个前端文件及两个测试 `--max-warnings=0`：最终通过，含 `.d.mts`。`git diff --check`：通过。
- 修复前证据：首个 Python bootstrap 校验脚本因本机 Python 不支持 `zip(strict=True)` 失败，发生在任何文件写入前，已用等长断言/普通 zip 完成全21个核验；首轮 ESLint 对 `.d.mts` 方法签名报 `node.params is not iterable`，改为 ambient 函数与 `typeof` 属性，无 inline TSFunctionType/规则关闭；控制字符正则改为字符码检查。后续 typecheck 发现 AntD `event.currentTarget` 为 HTMLElement 而非 HTMLButtonElement，已修正焦点引用类型；测试中超精度数字字面量改为显式构造无精度 lint 告警。所有最终门禁重新通过，失败日志原样留存。
- 原有 G19/AF119 文件与 CSV 源码测试没有修改；已保留 CSV 选择器/帮助全部边界与旧方法，未运行其真实 DB 验收。基线正式队列尚无 AF182 行，Worker 按 allowPaths 没有更新队列/registry 或冒充正式 `verify:task`。

## NOT_RUN / 总控接续

根工作区 DB、Docker、migrate、seed、API/Web 启动、重型 API/Web build、原生桌面/390px 浏览器、生产依赖审计修复、真实 HTTPS reader/parser/默认限制/实际 plugin 生命周期、真实 AF182 API/隔离 PG、owner 哈希/pools=0、正式 verify:task/队列更新/正式接收均 NOT_RUN。无运行访问地址；没有 public live URL、vendor、付费模型、支付或通知调用。

总控必须先完成真实 I181 安全修复集成依赖，再集成本卡；真实 I179 依赖以实际集成 Task `task_64bbf46af804` 为已给定来源，若正式编排要求补充依赖由总控登记。总控应按开发文档完成真实 API/PG 与编译 SDK/页面验收、原生桌面及390px表单/确认/来源/隐私/角色账号切换/Escape焦点/无页面横向溢出、生产构建、自查、正式 verify:task 与执行记录/队列后，按原任务名提交并依当前授权控制推送。候选不满足正式卡片验收，不能据此完成 I-*。

人工验收：管理角色打开 `/client/knowledge`，保留旧手动/TXT/MD/CSV/编辑/分页操作；新增 HTTPS 导入确认后在全部状态查到停用文档，来源按需读取；修改正文后核对为不匹配，单独恢复后再测查询；跨空间/只读角色/新账号不应得到来源或写权限；确认/POST/GET等待时触发重验证或切换，旧结果不回填；断开已提交回复后禁止重发，须原编号重读并明确确认。

Writer 预计有效用时约 0.35h，低于单卡含 root 1.5h 上限，余量交总控；候选提交 SHA 通过最终 worker_done 回报。最终交接前停止所有写入，不自动续卡，不把自查或本地候选提交当正式接收。

## 二次派工：中文路径与关闭焦点修复

- 新 Task：`task_08c6ecba75ef`；Dispatch：`ctx_071ee948a782`；Writer terminal/注册 Worktree/分支/remote 与前次一致。恢复写入前实际 HEAD 为 `8fbe8fb7522412eb1b8a1a877cd305448e3664b7`，工作区干净；总控明确停止原九路径写入，继续 One Writer。每个后续写入阶段均回读 status/HEAD/remote，保留8fbe祖先和 bootstrap，不改变 origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- 总控已告知真实 I181 完成：`task_f52c621165c7`，root dev `7da28fea`；Worker 未把这些全局改动带入子工作区。仅只读查阅总控授权的 `focus-repro.json`、`source-escape2.txt`、`browser-first-proof.json` 三份证据，没有访问应用、DB、凭据、依赖或其他根工作区数据。
- 修复前：总控中文根目录测试 **15 pass / 1 fail MODULE_NOT_FOUND**；原生生产页面来源 Escape 清理URL后 activeTag 为 BODY。Worker 新增路径/组件生命周期回归，在旧实现运行得到中文路径 MODULE_NOT_FOUND，以及 source/form/confirm Escape 后原按钮焦点断言失败（`repair-before.log`）；不把期望改成 BODY。
- 修复：测试依赖加载采用 `fileURLToPath`，同函数真实加载包含中文/空格/百分号/井号的模块；本卡九路径无其他 `.pathname` 转文件路径错误，剩余 `.pathname` 只用于证明测试夹具存在URL转义差异。关闭时保留即时私密 DOM 卸载，将按钮聚焦移到提交后的 passive effect，以避开仍存活的 rc 焦点锁；控制器 `canRestoreFocus` 检查当前有管理权限的账号/空间与精确版本，目标还须 isConnected 且非 disabled。传递原来源按钮 ref，不保留旧回调、DOM节点副本或来源数据；凭据仅版本号和布尔值，无 timer/RAF 延迟重试。
- 回归：真实 React DOM 与实际安装的 rc 焦点锁/Escape hook、自有最小 DOM host 和隔离视觉表单控件，验证 source/form/confirm 的关闭、Escape与重复打开后Escape、旧上下文/角色账号/同空间重验证、断开/禁用目标、unmount，以及 URL 清除。不是完整 AntD 浏览器或原生桌面结果，原生生产复测仍为总控独占。
- 最终 `node --test scripts/verification/client-knowledge-web-import.test.mjs scripts/verification/client-knowledge-web-import-live.test.mjs`：**29 passed / 0 failed**；原16项全部保留通过。`pnpm --filter @aij/web typecheck` 与原七文件定向 ESLint `--max-warnings=0` 通过；只读 bootstrap 哈希及 allowPaths/diff 检查通过，无新依赖、锁文件、权限、API/Schema或全局修改。
- 实际本次修改七路径：manager、web-import.tsx、state.mjs、state.d.mts、单元/SSR/组件测试、开发文档、本候选记录；API包装与loopback测试未改。保留一次 POST/未知锁/手工解锁及旧CSV/手动/编辑/状态路径，不根据未经证实的文件选择器疑虑改造产品。
- 本轮有效用时约0.20h，累计 Worker 约0.55h（低于1.5h累计上限，root预算另由总控核算）。API/DB/native浏览器/heavy build/正式verify:task/队列/I182完成/推送仍 NOT_RUN；总控须接收 STOPPED 后在真实 I181 依赖上执行正式原生与集成复验，候选仍非 CODE_VERIFIED。新原名提交 SHA 在本次 worker_done 中报告，不自动续卡。
