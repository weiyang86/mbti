# AF-203 提供个人文档Word与PDF导出面板 — candidate

状态：CANDIDATE_ONLY / ROOT_INTEGRATION_PENDING；不是 CODE_VERIFIED 或负责人接收。外部厂商 DEFERRED_NOT_PASSED，真实账号/密钥留空。

## 真实身份与来源

- Task `task_b06779aa5f3d`，新 Dispatch `ctx_86351bd8c6f5`；Writer terminal `term_4a5a6a9c-40a6-4720-bc25-a81b50c8b40e`；协调 terminal `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- Orca registered new-top-level WT `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W17-AF203`；instance `6ff735ba-530b-471f-9b63-ae56b9878ffd`；branch `weiyang86/AIJ-W17-AF203`。
- 原始起点/固定 origin/dev `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；remote `git@github.com:weiyang86/aij-foundation.git`。
- immutable source `15358325d7e6d0a90e6c55fe124c2c7ad13eb46e`；manifest SHA256 `2563c88d9844ff6a2c1c275567cd07252445fef01ef02e26a546156f5561392e`。
- 本轮遵循协调修订 msg_64badcb08e5c，接替已明确停止的失败尝试，复用批准的 source-only bootstrap `59e854ff7a3f6d3b42e0ed18c59c2b9d64e10efe`（标题 W17 verified source-only bootstrap，父提交94b0236）；本轮开始 HEAD 即该 bootstrap，干净。独立逐一重验867文件 SHA256 和 manifest SHA256 全匹配，没有重新复制/重建 bootstrap 或读取其他 Worker 未完成代码。
- candidate SHA 由标题“提供个人文档Word与PDF导出面板”的本提交给出，最终交接消息报告实际 SHA；此记录不填自引用哈希。候选只包含下列六文件，不含 bootstrap delta。

## 实际差异

1. `apps/web/app/components/client-document-export-panel.tsx`：注入式 AntD/adminTheme 面板，固定 DocumentScope/已保存文档 props，中文动作、权限/配置/未保存/unknown/conflict 状态、真实浏览器下载实现与焦点/hidden清理。
2. `apps/web/app/components/client-document-export-state.mjs`：纯 RAM 异步状态机，所有 IO 注入、generation fencing、超时/abort、scope/dirty/busy锁、unknown显式read+ack、409重读合并、401/403/404父级失效、URL revoke/bytes清零。
3. `apps/web/app/components/client-document-export-state.d.mts`：固定契约 structural port 与状态类型，无未交付 SDK import。
4. `scripts/verification/client-document-export-state.test.mjs`：21组实际状态机的异步成功、拒绝及边界测试。
5. `docs/planning/auto-ai-program-20261105/W17/AF-203-ROOT_WIRING.md`：精确接线、宿主焦点恢复、冲突/unknown锁、真实门禁与工具诊断请求。
6. 本执行记录。

无数据库/schema/迁移、接口实现、权限登记、文件owner、Run/Job/Trace、SDK transport/index 或原 manager/access/library 修改。页面只有 root 接线后才实际可访问；本轮未启动服务，没有已运行访问地址。没有正文/filename/bytes storage、query、console/log写入；下载文件名只传浏览器原生 download。

## 实际验证命令与退出码

- `orca orchestration check` exit0：读取并执行本轮接替修订；`orca worktree list --json` exit0 核验注册实例。
- `git status --short --branch` / `git rev-parse HEAD` / `git remote -v` exit0，开始干净且后续只新增允许文件；每批写前复核。Python hashlib核验 manifest 与867 files exit0。
- `pnpm install --frozen-lockfile --ignore-scripts` exit0，800包、独立本工作区 node_modules，无借用其他工作区/env/uploads；没有改锁文件。安装仅有 Node url.parse deprecation提示。
- `pnpm --filter @aij/contracts build && pnpm --filter @aij/sdk build && pnpm --filter @aij/ui build` exit0，均为小实包构建，没有全量 API/Next 构建。
- `node --test scripts/verification/client-document-export-state.test.mjs` exit0，最终21/21通过，0失败/跳过；deadline用 Node mock timers，不是浏览器/真实CPU渲染时间验收。初版15/15亦通过，后续修复与新增边界后重跑。
- `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2017 --lib dom,dom.iterable,esnext --module esnext --moduleResolution bundler --jsx react-jsx --esModuleInterop apps/web/app/components/client-document-export-panel.tsx` exit0（检查实际面板及其依赖/声明）。
- 首次同时 lint4文件 exit2：原 ESLint 对 `.d.mts` 的 parser/plugin组合崩溃 `node.params is not iterable`；函数属性声明重试同样 exit2。根因及请求保留在 ROOT_WIRING，没有改共享配置/禁用规则，默认声明lint仍待root修复，不能声称全仓lint通过。
- 首次单独运行时lint exit1：React refs构建store的初始化规则与正则控制字符规则；已改为稳定store+effect更新注入API/callback，并用字符码判断安全文件名。修复后 `pnpm exec eslint apps/web/app/components/client-document-export-panel.tsx apps/web/app/components/client-document-export-state.mjs scripts/verification/client-document-export-state.test.mjs --max-warnings=0` exit0。
- `.d.mts` 使用 ESLint Node API、overrideConfigFile:true 与成对 typescript-eslint.parser/plugin、no-unused-vars:error 实际 lintText 检查 exit0；此独立小检查不替代默认仓库声明lint。
- `git diff --check` exit0；最终 exact allowPaths 和 source-only bootstrap分离检查结果由交接报告确认。

NOT_RUN：verify:task/正式全仓门禁、PG/Docker/数据库/迁移/seed、生产Next/heavy API、server/真实HTTP/实包新增导出客户端消费者/真实浏览器/OS保存对话框。按派工均归root串行独占，Worker没有越界执行，不用fake IO/DOM冒充这些门禁。

## Root 与人工验收

精确步骤见 ROOT_WIRING。Root 按真实 I201→I202→I203 顺序，接 actual guarded SDK 与 manager当前 scope/保存 revision，完成export权限登记与真实下载链路；修复共享`.d.mts` lint配置并运行正式门禁。人工打开真实当前文档，检查Word/PDF显式生成与下载、未保存禁用、待配置/权限、busy并发、unknown读+确认、409草稿保留、401/403/404失效、桌面/390px/键盘、切scope/撤权/失焦/hidden/迟到清理与实际字节。

没有未完成伪实现；未接线、默认声明lint故障和真实验收都明确待root，不宣称生产成功。总有效工程时间：本轮约0.5小时以内（最终交接给出保守上界），加前次失败尝试<5分钟，低于修订 Worker剩余1h40m/卡片含root3.5h上限。完成候选提交后 Writer 交出六路径写权限并 STOP ALL WRITING，不接续其他任务、无push/PR/merge/tag/deploy/publish。


## I202 实际契约修复交接（本轮新派工）

- Task `task_95021283b017` / Dispatch `ctx_bb0cd748ff18` / Writer terminal `term_50a07d0c722a30d273e21c3354c87d4e`；原 a229 交接已停止，root明确退回同六路径，本轮开始时干净HEAD `a22992e7408739a236874b1023fb0167afe0fb22`，branch/WT/remote均保持原注册值。
- 依赖证据：root提供真实I202 `task_f22906679b97`，正式 AF-202 `run-fZysq0` PASS 2+12、本地 `2ee9172a30be7694dc2cb097a43fbce1f0a14e65`；本Worker没有擅自集成root或其他Writer提交。
- 只读实际root SDK `packages/sdk/src/personal-document-exports.ts` SHA256 `3c1a2b78b598812fe0ac6bf431a55c4905b5faeb2cb4f09e7ba54fbe97fe3655`，以及 API `apps/api/src/documents/personal-document-exports.service.ts` SHA256 `67f6f1771b71058ea2b0324053794ab969bf6e8d8da4b03be489ae5030729342`，核实API复用原文档owner且list/get不依赖configured，capability由原exportCapability返回configured&&permitted。
- 修复状态meta验证：DOCX页数必须null，PDF必须整数1..100，renderer必须aij-plain-document-v1；声明pageCount改为number|null，UI仅PDF显示页数。
- 修复capability严格三元组：ready=true/true，not_configured=false/false，not_permitted配置任意/canExport=false；canRead基于read+export、已保存clean、非busy/非suspended与已知ready/not_configured；canCreate还需configured/canExport/ready且无unknown/conflict。
- 原21组测试意图保留，修正原假设错误的fixtures（原configured=false/canExport=true及Word整数页数不能作为真实通过证据），新增3组回归至24组：DOCX真实null创建/列举/下载、PDF页数1/100及非法页数/renderer拒绝、关闭配置已有Word/PDF仍可读/下载且不生成；not_permitted同时覆盖配置true/false且禁止所有操作。
- 实际命令：修改fixtures并加回归后，尚未修实现时 `node --test scripts/verification/client-document-export-state.test.mjs` exit1，24组18过6失败，真实重现误配；修实现后同命令exit0，24/24通过、0失败/跳过。先失败后修复的诊断保留，不隐藏失败。
- `pnpm exec eslint apps/web/app/components/client-document-export-panel.tsx apps/web/app/components/client-document-export-state.mjs scripts/verification/client-document-export-state.test.mjs --max-warnings=0` exit0；严格panel `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2017 --lib dom,dom.iterable,esnext --module esnext --moduleResolution bundler --jsx react-jsx --esModuleInterop apps/web/app/components/client-document-export-panel.tsx` exit0；成对typescript-eslint.parser/plugin的声明lint Node API exit0。本轮没有重跑已知默认`.d.mts` lint崩溃或掩盖历史exit2，root仍须修正共享parser pairing。
- `git diff --check`与exact六路径/候选继承链检查在提交前执行，实际结果与修复提交SHA由最终交接报告给出；本轮修复提交为a229直接后继，vs批准bootstrap59e854总delta仍只有原六文件，bootstrap不进入产品候选delta。
- 影响：无数据库/API实现/权限登记/审计日志owner或原manager/access变动，只修正面板对实际SDK数据的接受与拒绝逻辑；浏览器/HTTP/PG/Next/Native预览/verify:task全部NOT_RUN，由root负责；没有正在运行的新访问地址，CODE_VERIFIED未声明。
- 人工验收追加：使用真实Word导出确认成功而非unknown，列表Word不展示页数，PDF显示1..100实际页数；configured=false/canExport=false/not_configured时显示待配置，禁止生成但拥有read+export可读取下载已有两格式；not_permitted两种配置均禁用全部导出操作。继续原scope/dirty/busy/unknown/focus/清理真实验收。
- 本轮预算<=15有效分钟（保守上界0.25h），加协调已记录前两次总Worker上界0.5834h，累计Worker保守上界0.8334h；未使用新Worker或子agent。完成修复提交并报告SHA后再次 STOP ALL WRITING，交回六路径唯一Writer权限。
