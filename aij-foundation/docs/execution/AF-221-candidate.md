# AF-221 父组件接线补充候选记录（当前）

状态仍为 CANDIDATE_READY / Candidate not CODE_VERIFIED；NOT_RUN_TARGET_ACCEPTANCE 与 OWNER_CHECK_PENDING 未改。下方原 f258 记录保留，补充实现覆盖其中“父组件尚待接线”的待办，不反填真实验收通过。

## 本次独占交接与基线

- Task task_19d52bafe9f1；Dispatch ctx_4e61e8d56592；terminal term_a8671749-cadd-4107-b310-83e31c83bd7f。
- 同一 Orca 已注册子工作区/branch/remote，补充初始 HEAD f258f17342199bef4429f02d073178b0b5f665ee，2026-11-08T09:57:50Z 实际回读 clean；初始身份消息 msg_350ac1585d2d。
- 初次 STOP msg_1736aa85d1a8 及初次候选保留，负责人授权同卡补充，不是下一批；总控确认三个父文件零 diff 并独占交还 Writer。本次不 amend 初次候选或 source-only bootstrap 1b69fcad90a577e25c92526acce442b599101bac，不读根 live 源码，不修改 root/dev。
- 补充是 f258 之上的独立本地候选提交，继续原标题“提供个人文档历史恢复为新版本”，确切 SHA 由最终 worker_done 回读交接。root 需精确接收初次六文件候选及本次补充，再执行正式门禁；没有复制共同 bootstrap。

## 补充精确路径与行为

只修改 `apps/web/app/components/{client-document-access.ts,client-document-manager.tsx,client-document-library.tsx,client-document-restore-panel.tsx}` 与本执行记录、`W22/AF-221-ROOT_WIRING.md`；只新增 `scripts/verification/client-document-restore-composition.test.mjs`。初次 restore state/d.mts/28 项测试无修改，SDK/Schema/依赖/registry/队列无修改。

原 access owner 现在暴露 guarded ClientApi 和同步失效订阅，只有 GET me 的无 workspace 特例，其他仍需精确空间，保留原 verifier 前后/完整身份/generation/迟到 bytes 清零/未知写入语义，当前拒绝交原 owner，旧代次拒绝不清新 owner。library 实际传这个 outlet。

原 manager 现在持有一个共享 restore store，永久传给单个无 key 面板；父变更围栏派生同一 store 的 busy/confirmation/locked，没有第二锁。只保存基线相等时显式退出编辑到可比较视图，脏稿提示保存或明确丢弃，原历史选择/删除/忙/冲突/未知态均阻止退出。可以明确继续编辑；恢复成功/ACK 后只用原 guarded SDK get 重读当前详情，保持保存视图。拒绝/访问失效同步清父子，render 也遮罩旧完整身份，blur/hidden/unmount 不丢未知锁。旧 CRUD recovery 仍由原 manager 持有，阻止 restore scope，不另造 owner。

页面继续 AntD/adminTheme/PageHeading，已保存正文折行/转义、标题和正文可聚焦，沿用取消 Modal 原范围焦点返回。功能文案更新，分段再生成仍未来。DB/API/SDK/权限/审计/日志无新 owner，无服务地址或外部调用。

## 补充验证

- `node --test scripts/verification/client-document-restore-state.test.mjs`：exit 0，原 28/28。
- `node --test scripts/verification/client-document-restore-composition.test.mjs`：exit 0，17/17；实际编译 SDK + 实际 transpile 后的 access/manager/library/panel，测试 guarded 回调前后撤权、严格 me 空 workspace 特例、当前 401/403/404/成功却 foreign principal 的同步清理顺序、旧 generation 与 bytes、保存/脏稿/历史/删除/忙/CAS/原 unknown gate、readonly、同锁父写禁止与 null/重开不丢锁、原 guarded get 成功重读、React effect 前 mask、永久单面板与不新建 store、实际 parent blur/hidden/unmount handler 的**合成**调用、library 不传 raw。
- `node --test scripts/verification/client-document-export-integration.test.mjs`：exit 0，受影响原离线围栏 3/3，无 PG/HTTP。
- focused `pnpm exec eslint`（四个受影响组件 + 新 composition 测试，原推荐规则 `--max-warnings=0`）：exit 0；无规则屏蔽或共享配置修改。
- `pnpm --filter @aij/web typecheck`：exit 0。
- `git diff --check` 与精确暂存 diff-check：exit 0。
- 补充没有失败检查；原首次失败与已修复事实见下方历史。未重复安装/小包 build，使用本子工作区原独立安装与已编译 SDK/UI/contracts；没有使用 root node_modules。

真实 DB/PG/HTTP/API/CAS/旧 v1/v2/导出引用、浏览器/native/390/真正 hidden、root verify:task/full API/Next build 仍 NOT_RUN；未运行其他卡根真实验收。合成事件/React hook harness 不代表真实 native 通过，root 是唯一正式验证与集成 Writer。已有 Git sidecar non-monotonic 诊断继续保留，Git 检查正常退出，未改根 Git sidecar。

补充有效工时约 0.25h（含实现、自查、离线验证、记录和候选提交，未超过 0.60h）；前次 0.30h 原样累计，Worker 累计约 0.55h，总卡上限 3.5h 含 root。候选回读后 **STOP ALL WRITING**，待总控接收并真实验证，不等待 Trea、不声称负责人接收，不 push/PR/tag/部署/发布或修改模型/CLI。

---

# AF-221 候选交付：提供个人文档历史恢复为新版本

状态：CANDIDATE_READY，Candidate not CODE_VERIFIED；正式接线、verify:task 和真实验收交总控。目标验收保持 NOT_RUN_TARGET_ACCEPTANCE，负责人接收保持 OWNER_CHECK_PENDING。无 Trea、push/PR/main/tag/部署/发布、模型或 CLI 设置变更。

## 身份、来源与提交边界

- Task：task_3ec5292e3b7a；Dispatch：ctx_61c2109865d9；Writer terminal：term_a8671749-cadd-4107-b310-83e31c83bd7f。
- Worktree：ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W22-AF221；instance：7193ef36-3e6c-42ba-85ae-ae54abacfdd3。
- Orca worktree show 确认 CLI 创建的 root 子 Worktree，baseRef refs/remotes/origin/dev；branch weiyang86/AIJ-W22-AF221；initial HEAD 94b0236f775fa40a07944c5e0545ac6ce0e123f3；初始 clean。
- Remote：git@github.com:weiyang86/aij-foundation.git。根源码只读，没有复制 live root 源文件；只读取根 W22/CONTRACT.md 与 SOURCE_BOOTSTRAP.json。
- 清单 SHA-256：1396522f0782f4e9fa5478786ea67d78cde328ec745de2725a85decff978eea3；sourceCommit dc13430835ae89b58ae18577be12643224c9c55e。
- `git cat-file --batch` 按 1026 条清单提取；逐条对比该 sourceCommit 的 ls-tree mode/type/oid，验证 blob SHA-1、SHA-256、bytes 与落盘 mode/hash；exit 0。无全量 checkout，无凭据/env/原型/上传/node_modules/待验 AF191/208 拷贝。
- Source-only bootstrap：1b69fcad90a577e25c92526acce442b599101bac，标题 `W22 verified source-only bootstrap`。1026 blobs 中相对 initial HEAD 有 503 个路径变化，51204 insertions / 672 deletions；这是独立来源准备，不是本卡 delta。
- 本卡候选是本文件所在的下一独立提交，标题逐字 `提供个人文档历史恢复为新版本`；最终交接提供确切 candidateSHA，不把自引用 SHA 写进其自身提交。总控只精确取本卡六文件候选差异，不重复集成 bootstrap，不把候选当成已验证正式卡片提交。

Git 读写曾打印已有 macOS sidecar pack index `._pack-f03e767c944ca97bc7cba847811aab0e60e02cb8.idx` 的 non-monotonic 诊断；所执行 Git 命令均成功退出，逐 blob 验证成功。未删除、修复或改写根 common Git 的该 sidecar。

## 精确 delta 与影响

只新增以下六个 allowPaths，不修改已有文件、正式队列、registry、依赖或共享配置：

| 路径 | 内容 |
| --- | --- |
| apps/web/app/components/client-document-restore-panel.tsx | ClientDocumentVersionRestorePanel，AntD/adminTheme、历史目录、名称/正文比较、单独确认、恢复结果重读与独立 ACK、事件清理、取消后 scope 围栏焦点返回 |
| apps/web/app/components/client-document-restore-state.mjs | 原公开 SDK get/versions/getVersion/update；当前 me/context/role/permissions/64hex session 与 head 前后核对；精确三字段 PATCH；no-op、CAS、opaque RAM 未知锁、取消与迟到围栏 |
| apps/web/app/components/client-document-restore-state.d.mts | 与 .mjs 配对的 props scope、状态和控制器声明 |
| scripts/verification/client-document-restore-state.test.mjs | 实际编译 SDK 的 28 项离线合成回归与静态 AntD 渲染/事件 wiring 检查 |
| docs/planning/auto-ai-program-20261105/W22/AF-221-ROOT_WIRING.md | 原父组件、ClientApi owner 窄出口、退出编辑、永久单面板、两个回调与总控真实验收 hook |
| docs/execution/AF-221-candidate.md | 本候选执行、证据与停止写入交接 |

数据库/Schema/迁移/seed：无变化、未连接。接口/SDK/权限/审计/日志 owner：无新增，原 update 实际为 PATCH，历史用 beforeRevision，不混用 Agent version ID。页面：新增未接线面板；保留原 PageHeading 与主题，不宣称 Figma 匹配或已上线。权限：原 read 可比较，read+manage 才可恢复，当前 401/403/404 同步清子状态并通知原父 owner 清理；父页实际清理仍待总控接线验证。没有运行访问地址，未启停任何服务。

## 验证与结果

| 命令/检查 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile | exit 0；本 Worktree 独立 node_modules，800 packages，复用包缓存，零下载；pnpm 提示部分依赖 build scripts 被忽略，未修改授权或执行它们 |
| pnpm --filter @aij/contracts build | exit 0；必要小包 |
| pnpm --filter @aij/sdk build | exit 0；测试使用此实际编译公开 SDK，未新造 SDK |
| pnpm --filter @aij/ui build | exit 0；支持 Web 类型检查的必要小包 |
| node --test scripts/verification/client-document-restore-state.test.mjs | 最终 exit 0，28/28 pass |
| pnpm exec eslint apps/web/app/components/client-document-restore-panel.tsx apps/web/app/components/client-document-restore-state.mjs apps/web/app/components/client-document-restore-state.d.mts scripts/verification/client-document-restore-state.test.mjs --max-warnings=0 | exit 0；原推荐规则直接通过，无规则屏蔽、共享配置修改或本地 parser override |
| pnpm --filter @aij/web typecheck | exit 0，tsc --noEmit；不是 Next build |
| git diff --check / 候选暂存 diff-check | exit 0 |

初次 lint exit 1：新代码正则触发 no-control-regex，已改用 codePointAt 字符检查并保留原规则。首轮测试 exit 1、26/27：非法服务端 revision 被夹具同时用作输入 scope，已修正夹具；27/27 后补充回退修订拒绝与未知锁跨 null 的 render masking 检查，最终 28/28。没有隐藏失败。

28 项覆盖：分页与 beforeRevision、完整形状/归属/UUID/版本上限、真实 getVersion 的 documentId/revision、严格 me/context/64hex、read/manage/撤销和 401/403/404 清理顺序、名称正文差异/no-op/空正文/取消、唯一 PATCH/新 head、CAS 与人工并发版本、所有尝试后 4xx/409/503 未知锁、null/身份/空间/文档/修订变化、原 role/session 下 GET + 独立新鲜 ACK、阻止新 owner 读取旧恢复正文、ACK 后 head/auth 变化、迟到/超时/失焦/hidden 样式 suspend/dispose、静态内容转义、窄屏 CSS、hook 前 scope masking 与合成 visibility wiring。旧历史/导出引用仅在合成夹具保持不变，不能冒充真实 PG/API/导出证据。

应用 frontend-design-review：沿用既有 AntD 与 adminTheme，比较区使用可折行的双列到单列布局，pre 内容转义并可键盘进入，明确写入后果/取消/恢复锁与错误。无 Figma、服务或浏览器访问；焦点返回、390px、真正 hidden 均仍须原生验收。

## 未运行、依赖与交接

NOT_RUN：DB/PG、migrate/seed、Docker、HTTP/API、厂商调用、服务、浏览器/native、full API/Next build、root verify:task、原父页实际接线与清理、真实旧 v1/v2 和导出持久引用检查、其他卡根验收。未执行 schema-only generate（本卡不需要）。本卡没有伪造上述通过，也没有取用其他卡工作区资源。

下一步依赖总控：按 ROOT_WIRING 在原 ClientDocumentLibrary/createDocumentAccess/ClientDocumentManager 接 raw-shaped 且当前权限围栏的 ClientApi；增加显式退出编辑状态；永久挂载单实例；同步清父页并原 owner 重读；执行本卡正式注册与真实 PG/API/导出/桌面/390/native hidden 验收，再决定 CODE_VERIFIED/OWNER_CHECK_PENDING。冻结 manager 总是 editing=true，因此接 JSX 本身不足以使入口可用；已明确记入 hook。

Worker 有效工程工时约 0.30h（向上计入实现、验证、修复、记录与候选提交；上限 1.5h，未超限；总卡含 root 3.5h）。无已知候选离线门禁阻塞，真实接线/目标验收未完成。

Writer 在候选提交并回读 SHA/status 后 **STOP ALL WRITING**，只发送一次 worker_done；根工作区与共享文件的后续修改权交总控。候选不替代正式验证、正式卡片提交或负责人接收。
