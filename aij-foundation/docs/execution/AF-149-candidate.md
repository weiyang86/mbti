# AF-149 接入AI工作台的原任务查回与恢复 — candidate

## 初始现场（bootstrap 前）

- 时间：2026-11-05T10:57:55.359951
- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W04-AF149`
- Task：`task_7389d92e8945`；Dispatch：`ctx_13bb585597fc`；Writer：`term_d3ed2892-9dbe-43cf-ae6b-b11c25a94222`
- 分支：`weiyang86/AIJ-W04-AF149`
- HEAD / origin/dev：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`；`git status --short --branch` 仅分支行，无既有差异。
- Remote：`origin git@github.com:weiyang86/aij-foundation.git`（fetch/push）。
- 总控根工作区及轻企来源只读；仅本卡 allowPaths 写入；无子代理。

## Source bootstrap

- `apps/web/app/components/client-ai-workbench-state.mjs` ← `a065f43457e0fd77f688f99dabbc99a03133062a`；SHA256 `4b6f4b350882e88ad5573c3a7cab99f925800930e3a80c4712e858fce2b1dbf6` verified。
- `apps/web/app/components/client-ai-workbench-state.d.mts` ← `a065f43457e0fd77f688f99dabbc99a03133062a`；SHA256 `f17624598265136865cb0a42acdbdbc4007e672f35101468a6bb5d1cf903490b` verified。
- `apps/web/app/components/client-ai-workbench.tsx` ← `a065f43457e0fd77f688f99dabbc99a03133062a`；SHA256 `690113c3d5109c29a3caf742b8d5e310867158f6d2ff3e54ba2856dafb5dab0f` verified。
- `scripts/verification/client-ai-workbench.test.mjs` ← `a065f43457e0fd77f688f99dabbc99a03133062a`；SHA256 `bd847360b336ad607846f9644f4d8aa327ff06d26df7e4456cfb3abd3bb67905` verified。
- `packages/sdk/src/index.ts` ← `06928768a0e0b1529ad6d9c5bc10fa4e0c15f938`；SHA256 `e466bc1bc33dedfcb57d0a1fce48933071a6e972e480142e2d77da24dbbd0cfa` verified。
- `packages/sdk/src/ai-run-recovery.ts` ← `06928768a0e0b1529ad6d9c5bc10fa4e0c15f938`；SHA256 `50442f5852da685ed5d353bc8186590cf006adda617e69948620fe4458216b2c` verified。
- `scripts/build-workspace-package.mjs` ← `06928768a0e0b1529ad6d9c5bc10fa4e0c15f938`；SHA256 `5dde66fd6520f6cc06af91ee064163fac3accef3fa50cd17f8890d463da1f1c0` verified。

Bootstrap commit：`488e03dd08a6e356187d5505b7ed13b8a718f234`；候选 delta 仅在该提交之后，SDK/build script 随后只读。来源集成 Task：`task_0649f7dbff73` / `task_634f404155e8`。

## 候选实现与边界

- 只改本卡七个 allowPaths（含此记录）。Bootstrap 之后没有 SDK、后端、Schema、manifest、lock、队列、registry、AGENTS 或根工作区改动；总控只接收 bootstrap 之后的候选提交，不接收 bootstrap 的继承来源。
- 工作台注入编译后的真实 `createAiRunRecoveryClient`，用户点击“查回原提交状态”才 GET `/client/ai/run-requests/:key`，不要求原 prompt、不发 POST、不自动重试执行。正常 POST 确认仍须精确原输入摘要、沿用原 key。
- 单独的 `recoveryReference` 只承载七字段服务端元数据；严格校验投影字段、id、agent、绑定 runId、状态/预算组合、规范 ISO 日期与先后关系。没有把窄投影转成 `AiAgentRunResult`，没有合成成功输出；可读内容由正常授权 GET runs 读取。
- `succeeded/settled` 或 `failed/released` 才可解除 journal，并展示显式“开始新任务”；queued/running/unknown + reserved 不因过期解除，不推断退款。`contentAvailable=false` 清空 output/Blob 缓存，不再尝试读该引用的内容。
- 查回 404 只提示原 POST 可能仍在途，保留 key、digest 和原标识确认路径；畸形响应和不一致元数据不会清除 journal。401/403 清除私有内存和权限，再验证后仍恢复原保护。
- Web Lock 内对七字段快照比较并更新；同时保护 metadata GET、普通 GET 和 POST 的迟到响应。存储内容是持久化 journal 的权威来源，防止旧页面从内存复活已删除 key，或覆盖/清掉另一页面的新 pending key。锁/存储失败封闭阻止新提交。
- 原 42 项测试全部保留。F1 的跨空间保护仍断言错摘要无 POST、正确原输入复用原 key；按当前任务的私有内存要求，空间切换后清空原输入，测试重新填入精确原值。F2 410 缓存清除与有效读取恢复断言保留。

影响：数据库/Schema/权限定义/服务端审计与日志无变化；页面新增查回和窄元数据展示，接口仅消费现有 AF145 GET。持久化仍仅 `memberId, workspaceId, agentCode, key, digest, runId, status`，不保存 prompt/output/凭据。没有启动任何访问地址，没有 DB/Docker/seed/migrate/真实厂商调用。

## Worker 实际验证

- `pnpm install --frozen-lockfile` exit 0：独立 node_modules，无 env/凭据/上传文件复制，无借用可变目录。包管理器提示忽略依赖安装脚本，未为此运行 DB 或改全局依赖。
- `pnpm --filter @aij/contracts build`、`pnpm --filter @aij/sdk build`、`pnpm --filter @aij/ui build` 各 exit 0：只构建轻量共享包，在本工作区生成忽略的 dist，供真实 SDK 导入及 Web noEmit 使用；没有 API/Web 全构建。
- `node --test scripts/verification/client-ai-workbench.test.mjs scripts/verification/workbench-request-recovery.test.mjs` exit 0：**85/85**，0 fail/skip/todo；其中原有 42，新增 43。覆盖丢 POST 响应 → reload → GET、404 原提交在途、错摘要/原 key 确认、旧 scope/旧授权拒绝、双页新 key 的迟到 queued/terminal 元数据及普通 GET/POST、过期 unknown/terminal、畸形投影/日期/预算、401/403、锁等待/比较更新失败、存储损坏/读写失败、私有文字/Blob 清除。
- 目标 ESLint（state.mjs、tsx、三个测试文件）`--max-warnings=0` exit 0；声明文件另以 `--parser @typescript-eslint/parser --no-inline-config --max-warnings=0` exit 0。声明文件单独 lint 时 Next 插件输出 pages 目录定位提示，lint 无 error/warning，未修改共享配置。
- `pnpm --filter @aij/web typecheck`（tsc --noEmit）exit 0；`node --check scripts/verification/workbench-request-recovery-live.test.mjs` exit 0；`git diff --check` exit 0。
- 早期测试失败已修复：原 source SDK 的 data-URL 导入不能跟随新增 relative module，改为真实 dist 导入；新 harness 初版缺少 envelope message、route 三元条件优先级错误；一处未使用局部变量 lint 错误。最终成功结果如上，未用跳过隐藏失败。

## ROOT-ONLY 仍待运行（NOT_RUN，不冒充 CODE_VERIFIED）

`workbench-request-recovery-live.test.mjs` 已准备，但本 Worker **没有执行**。它仅引用总控拟扩展的 `prepareClientAiWorkbenchLive({task:'AF-149',browserOrigin})`；基线子树不含共享 live helper，本卡禁止复制或修改该文件。

总控下一步：

1. 集成依赖引用真实 I-* Task：AF142 `task_0649f7dbff73`，AF145 的真实集成 Task 由总控记录补齐，AF146/SDK `task_634f404155e8`；不把候选 Task 当集成依赖。本候选仅在 bootstrap `488e03d` 之后，不能把此来源提交再次集成。
2. 总控独占扩展共享 helper 的 AF149 精确 opt-in `AIJ_AF149_ROOT_ACCEPTANCE=true`、主 worktree 检查、DB allowlists 与 `.artifacts/auto-ai-program-20261105/AF-149` 独立产物路径；默认不传 task 的 AF142 guard 继续只接受 AF142 opt-in。live 文件包含 AF149 不能授权默认 AF142、AF142 不能授权显式 AF149 的回归。
3. 注册 `verify:task -- AF-149` 并串行跑适用门禁、API/Web production build 与 fresh AF149 真实 fixture。live 测试实际 POST 被受理后，在响应到达实际 workbench store 前主动丢弃；reload 后用真实编译 SDK + GET 查回同一 id，不发第二个 POST；实际 JobService pump 断言第一次执行 1、后续 0，upstreamCalls 由 0 到 1 后不增加，再正常读取真实 output。
4. 总控完成**实际浏览器丢响应代理证明**：在真实 Web 页面使用新 AF149 合成账号/空间提交，代理仅截断已被 API 受理的首次 POST 响应；刷新页面不填写 prompt，点击“查回原提交状态”，网络面板应只有原 key 的 GET、没有新 POST，元数据区不展示伪造输出；pump 后点击读取实际结果，再确认执行/upstream 次数各 1。另验 404 在途保护、未知过期无法新建、safe terminal 显式开始新任务、权限拒绝和空间切换缓存清除。
5. 真实证据、共享文件、正式队列/registry/执行记录、正式提交/push 与远端 SHA 回读由总控负责。本记录不是负责人接受，出口仍待根验证与 OWNER_CHECK_PENDING。

## Writer 交接

Worker 自查完成，未冒充独立 Review。有效工程时间估计约 **0.3 小时**（开始 2026-11-05 10:57 CST，含 install/目标验证/记录；精确收尾时间以候选提交时间为准），未使用卡片 2.5h Worker 上限，保留至少 1h 给总控验证；总控用时不在此估计内。候选提交之后明确停止本卡写入；共享文件请求仅限上列总控已有职责，无其他实现阻塞。
