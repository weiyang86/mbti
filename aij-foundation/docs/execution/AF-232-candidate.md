# AF-232 候选交接：实现文档章节生成预览与任务控制器

状态：CANDIDATE，**不是 CODE_VERIFIED**，不代表负责人验收。W23/W24 人工验收仍为 PENDING，原 40 项目标及历史失败未改写。单 Writer 自查，不是独立复核；交接后 STOP ALL WRITING，不 push、不自动接续。

## 派工与基线

| 项 | 实际值 |
| --- | --- |
| Task | `task_11944e614359` |
| Dispatch | `ctx_15df0e20769e` |
| Worker terminal | `term_d2dea7da-1c76-468d-9faa-3673ff3678b1` |
| Coordinator terminal | `term_26cef18e-31e9-4c43-8f62-bd8db5c92ea5` |
| Worktree | `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W25-AF232` |
| Worktree instance | `a82d60da-3eb4-423d-8131-6c0d19bf4754` |
| Parent | `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation` |
| Branch | `weiyang86/AIJ-W25-AF232` |
| Initial HEAD / origin/dev | `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，初始 clean |
| Remote | `git@github.com:weiyang86/aij-foundation.git`（fetch / push 相同，未 push） |
| Frozen source | `46079d20b55b4c581cc5cd0a8464ad2e0dd55326` |
| Manifest SHA256 | `105443376feda721bcc0196921333f655a9f0f9aeb0a6d4c8dea7664e0bb7001` |
| Source-only bootstrap commit | `e3bcd421c82006a6ba521f9d78a4d48cddad3c35` |
| Candidate commit | 本文件所属原名提交；准确 SHA 随唯一 `worker_done` 回执交回，避免文件自引用 SHA |

Orca `worktree current --json` 确认新 child、`baseRef=refs/remotes/origin/dev`、明确父子登记，创建时间 `2026-11-08T18:05:54.593Z`。工程记录区间至 `2026-11-08T18:24:21+00:00`，按 Orca 创建时间保守起算约 0.31 小时，包含引导、实现、失败路径读取纠正、自查和交接记录，低于 Worker 1.5h；总卡/root 预算仍由总控核算。未启动 helper、未切模型。

先完整读取任务 spec 与 root 精确路径 `W25/CONTRACT.md`、`W25/SOURCE_BOOTSTRAP.json`。逐条 `git ls-tree` 核对 mode/OID，`git show <OID>` 读取 1112 个 blob，核对 SHA256/bytes/Git hash 后恢复共 9,557,461 字节并设置 mode；bootstrap 单独提交，对初始树实际为 589 路径变化（509 A、80 M）。后续再核验 1112 文件的 SHA256、字节数和磁盘 mode，tracked 源码仍等于 bootstrap。没有读取 root live 源码、用户交接资料、原型、真实 env/凭据/local-data；后续源码读取仅来自已恢复的 child。

## 实际差异与影响

仅新增以下五个 allowPaths；source-only bootstrap 必须与候选分开，不得整段集成 bootstrap：

- `apps/web/app/components/client-document-generation-state.mjs`：纯注入 factory，完整 PanelView、setContext/setBindings/dispose；没有未来 journal/panel import。
- `apps/web/app/components/client-document-generation-state.d.mts`：冻结契约的结构类型，沿公开 SDK ref/preview/run/recovery 类型。
- `scripts/verification/client-document-generation-state.test.mjs`：真实 Node WebCrypto、公开 SDK、离线注入端口行为测试。
- 本候选执行记录。
- `docs/planning/auto-ai-program-20261105/W25/AF-232-ROOT_WIRING.md`：总控真实 owner 接线与验证说明。

实现来源/索引/完整正文 UTF8 SHA、完整章节 slice SHA、范围和连续索引核验；instruction 保留 raw 字节语义，UTF16 2000 上限。ref 十二字段/document 九字段按固定顺序 canonical 化，不受插入顺序或权限数组顺序影响；digest 为 `SHA256(JSON.stringify(['personal-document-generation-v1', canonicalRef, rawInstruction]))`，成本字符串不转 Number。

每个 await/WebCrypto 前后复核 epoch、active、完整 auth/source pin；有界 timeout race 清理 listener/timer，旧 ticket 不能改新 state。当前 401/403/404 交原状态给同步父清除回调；回调后仅原 epoch 清子状态，保护回调新建的 scope。context、绑定、source/role/session/permissions 变化、suspend/dispose 清私有内容；取消确认撤销 consent 并中止晚到确认。

分页每次最多 50、严格有序去重、最多 20 页，只选择后 inspect。preview、确认、提交分别重新核价，比较完整原 ref；变化拒绝且清 quote，不能采用新价格。execute 多要求 documents.manage/ai.execute。submit 只经 JournalPort.submitOnce，一次 send 防双击；丢回复/未知状态保留原 key，不重试。submit 输出遮蔽；显式 readResult 才可能显示当前来源、未到期、succeeded/settled、至多 64000 UTF16 输出。recover 可在新 session 或没有 saved source 时取原 key 元数据；documentCurrent=false 禁读。ACK 回调重新 verifyRecovery/recover，unknown/reserved、失配或 410 不解锁。

数据库、服务端接口、权限定义、正式日志 owner、队列/registry/共享 owner/依赖锁及现有页面均无改动。只消费既有 documents/AI 权限和 generation SDK 四方法；没有 storage、fetch、poll、新日志、文档写入、compose、应用生成结果入口。没有启动服务，**没有可声称已运行的新访问地址**，未读取/更新 3955 凭据和原 3 文档。

## 验证命令与真实结果

环境：Node `v24.21.0`，本 child 独立 `node_modules`。

| 命令/检查 | Exit | 结果 |
| --- | --- | --- |
| `orca skills get orca-cli --json` / `orca skills get orchestration` | 各 0 | 读取匹配运行时规则 |
| `orca worktree current --json` | 0 | 已注册新 child / lineage / 基线符合 |
| 1112 blob Python 引导（每项 git show/ls-tree/hash-object、完整核验、独立 git commit） | 0 | bootstrap SHA 如上 |
| `pnpm install --frozen-lockfile` | 0 | 800 包独立安装；依赖 native/Prisma build scripts 被 pnpm 忽略，未额外执行 |
| `pnpm --filter @aij/contracts build` | 0 | 小包 build |
| `pnpm --filter @aij/sdk build` | 0 | 小包 build |
| `node --test scripts/verification/client-document-generation-state.test.mjs` | 0 | 最终 76 tests / 76 pass / 0 fail；此前首轮 64/64、扩展轮 75/75 同为 0 |
| `pnpm exec eslint apps/web/app/components/client-document-generation-state.mjs apps/web/app/components/client-document-generation-state.d.mts scripts/verification/client-document-generation-state.test.mjs --max-warnings=0` | 0 | 最终及前轮定向 lint 均通过 |
| `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM apps/web/app/components/client-document-generation-state.d.mts` | 0 | 声明隔离检查，非全 Web/API typecheck |
| 1112 文件 post-bootstrap SHA256/bytes/mode 与 tracked unchanged 检查 | 0 | 全部一致 |
| `git diff --check` / 最终 staged diff 检查 | 0 | 无空白错误；候选路径只取五个 allowPaths |

测试覆盖双击/两个 controller 共享注入 journal、丢响应/晚到、原价全部字段与 document 全九字段、raw digest、source/角色/会话/权限/validationKey 更换、2000/2001 UTF16、64000/64001、getter 零执行、crypto 挂起换源、当前/旧拒绝、同步父清除重入、cancel/suspend/dispose、timeout 后延迟 send 拒绝、unknown/410、origin/run 失配、documentCurrent=false、新会话无 source 恢复、配置关闭仍可读/恢复、过期遮蔽、有限分页、无自动请求。两个 controller 的单元采用注入内存 journal，**不是实际 Web Locks/持久存储验收**。

保留诊断：Git 多次输出 `non-monotonic index .../.git/objects/pack/._pack-f03e767c944ca97bc7cba847811aab0e60e02cb8.idx`，相关 Git 命令及 blob 核验最终 exit 0，未擅自修改共享 Git object/pack。早期探索读取 `client-document-section-state.mjs`（应为 sections 复数）的 shell exit 1，纠正后读取了实际冻结源码；一次推测 controller 文件名的 cat 返回不存在，随后已用原公开 SDK/owner 文件核对（未将此探测算通过验证）。`printenv ORCA_CLI_COMMAND ORCA_DEV_REPO_ROOT` exit 1 表示均未设置，按技能在 macOS 选定 `orca`。实现测试未发生失败，不将这些探测错误隐藏为已通过检查。

## NOT_RUN 与 root 后续

`verify:task`/正式 registry 与队列、全 API/Next build、完整 Web/API typecheck、DB/migrate/seed/schema generate、服务、Docker/native、浏览器人工验收、实际 Auth/PG/runtime/loopback 上游、真实持久 journal/Web Locks、任何外部供应商/付费请求均 **NOT_RUN**。没有声称服务端联调或真实扣费路径通过；全波真实集成由 root 独占。

人工验收在 root 完成真实接线后进行：选原已保存完整章节→显式分页和选已发布兼容 Agent→输入原指令→预览→原来源/内部 nanos 估算确认并勾选→双击仅提交一次→主动读取；取消零提交。丢回复刷新后应零自动请求，仅显式原 key recover/read；改角色、session、权限、source 和真实 blur/hidden/卸载同步清父子私有内容；unknown/410 不提供解锁/新 key 绕过；过期和 documentCurrent=false 无输出。

下一依赖：root 接收 C231 后以真实 I231 ID 为 I232 依赖，完成共享 journal/原 guarded API 注入、正式注册和全部适用门禁，再决定 I232 的 CODE_VERIFIED。AF233 只使用冻结结构，不依赖未来候选文件。候选完成后本 Writer STOP ALL WRITING；root 可精确接收五文件候选，唯一 worker_done 交回准确 candidate SHA 和最终 clean 状态。
