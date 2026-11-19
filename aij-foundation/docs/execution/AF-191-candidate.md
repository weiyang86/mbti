# AF-191 候选执行记录

任务原名：**完成当前工作台与独立SDK前端的任务目标验收**。

状态：CANDIDATE_READY；真实目标验收 NOT_RUN，非 CODE_VERIFIED；owner 接收 PENDING。Worker 只交离线准备和总控真实验收入口，不关闭 AC-003、不修改队列/registry。正式 `verify:task` 与主 `dev` 集成由总控执行。

## 派工与写入前核对

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W14-AF191`；实际 instance `451ec8de-7eca-4a28-80f1-be35b5c10717`，Orca `worktree current --json` 已回读注册父工作树与 `origin/dev` baseRef。
- Task：`task_2d6e6640b4d0`；Dispatch：`ctx_a13764791c75`；Writer terminal：`term_6f4a5c9a-c673-4e29-9282-8be4c907a3b4`；coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支：`weiyang86/AIJ-W14-AF191`；初始 HEAD：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`，初始 `git status --short --branch` 干净。
- remote：`origin git@github.com:weiyang86/aij-foundation.git`（fetch/push）；未 push、切分支、合并或改远端。
- 唯一读取的 root 工作文件：规定 `W14/SOURCE_BOOTSTRAP.json`；SHA256 `995f2af4cbfb2fa8ca60ebcb7e66d03f4f5466190edee57ad646e6e32d4138d3`。确认 `sourceCommit=b434da8ba34f03b07b83f03be19b20061bb92fa9`，仅用该 Git commit 精确 `git show` 还原清单 773 个 blob，每个完整 SHA256 已核对，无 glob 或 root 工作源码复制。
- 独立 bootstrap 提交：`04e3856466a210456c30f1b7f528b8d6d873b60c`，288 个文件相对 origin94 产生差异，其余清单文件字节本来一致。**整个 bootstrap 不属于候选 delta**；总控只接收它之后的单卡提交。bootstrap 文件之后只读。
- 使用 Orca orchestration/orca-cli 和 frontend-design-review 技能；无 helper/subagent、无其他 Writer、无轻企访问。

## 实际候选差异（仅七个新增 allowPaths）

1. `scripts/verification/workbench-sdk-target-consumer.mjs`：全新仓库外项目、真实私有包安装/模块类型矩阵、严格静态路由、只读 SDK 状态机/页面。使用现有公开 SDK factories 与 contracts，无源代码/alias/symlink/shared node_modules 旁路。
2. `scripts/verification/workbench-sdk-target.test.mjs`：真实小包 pack/install/ESM/CJS/声明和 loopback HTTP；身份/权限/旧回调/TTL/未知状态；完整安装 ESM 依赖图、安全路径、拒绝/无效 envelope、门禁和完整性拒绝测试。
3. `scripts/verification/workbench-sdk-target-live.test.mjs`：总控显式 opt-in + 主 dev + 真实 adapter 必需；真实同 Run 工作台/SDK/API/PG/native 断言、原丢回复显式 GET 恢复、唯一执行及 finally 清理。缺失 adapter 或证据 FAIL，不跳过。
4. `scripts/verification/workbench-sdk-target-proof.mjs`：补充核验当前 source/API/SDK 产物及安装包/完整 dist graph/真实 lock 哈希、真实 lease、HTTP/PG/原生回执及清理文件；不将 JSON 自述当原生真实性证明。
5. `docs/development/WORKBENCH_SDK_TARGET_ACCEPTANCE.md`：冻结目标、状态、操作及验收边界。
6. `docs/planning/auto-ai-program-20261105/W14/AF-191-ROOT_WIRING.md`：精确 root adapter/fixture/registration/可信 transport/同 origin host 提案与 evidence schema。
7. 本执行记录。

数据库/schema/API/DTO/Guard/权限/SDK index/产品页面/依赖/锁/全局样式/日志均无候选修改。原 AntD/PageHeading/adminTheme 工作台保持原样；独立消费项目是授权的原生 HTML/ESM fixture。没有新增执行账本、成本账本或提交路径。

## 真实离线检查

- `pnpm install --frozen-lockfile --offline --ignore-scripts`：PASS，独立工作树安装 779 个包，无共享/符号链接 node_modules、无复制 .env 或凭据。
- `pnpm --filter @aij/contracts build`、`pnpm --filter @aij/sdk build`：PASS，仅两个小公共包；不是 API/Web 重型 build，也不是整 SDK 产品验收声明。
- `node --test scripts/verification/workbench-sdk-target.test.mjs`：最终 **18 PASS / 0 FAIL / 0 SKIP**。实际外部临时项目从真实 `pnpm pack` tgz 生成并 `npm install --offline --ignore-scripts --no-audit --no-fund`，真实 ESM/CJS import 与 strict NodeNext `.mts/.cts` noEmit 成功；故意错误类型被编译器拒绝。实际安装图通过 HTTP 读取、contracts bare import 解析及 SDK GET200/403/无效 envelope503 均核对。所有这些 HTTP 是自有合成离线测试，不是真实产品 API。
- 定向 `pnpm exec eslint scripts/verification/workbench-sdk-target-consumer.mjs scripts/verification/workbench-sdk-target.test.mjs scripts/verification/workbench-sdk-target-live.test.mjs scripts/verification/workbench-sdk-target-proof.mjs --max-warnings=0`：PASS，四个新增脚本无 warning。
- 默认 root 验收入口未 opt-in、opt-in 但缺 adapter：均实际子进程非零退出，测试断言通过；没有启动 DB/API/Web/native browser。
- 已关闭全部自有 loopback sockets，删除全部精确 marker 校验的生成消费者/pack/proof 单测目录。第一次失败遗留的确切 owned consumer 也已按真实路径及 marker 清理，未批量删除未知目录。最终临时目录 inventory 无 `aij-af191-consumer-*` 或本测试 `af191-packs-*` 遗留。

本工作树 ignored 证据：`.artifacts/af191/offline-first.txt`、`offline-second.txt`、`offline-third.txt`、`offline-fourth.txt`、`offline-fifth.txt`、`offline-sixth.txt`、`offline-final.txt`、`offline-final-v2.txt`、`offline-delivery.txt`，以及 `lint-second.txt`、`lint-final.txt`、`lint-final-v2.txt`、`lint-delivery.txt`。最终 delivery 复验18/18通过且定向 lint exit0；它们不进候选提交、不供其他任务当产品证据。

修复前失败保留：首轮14/16通过，包安装清单尾换行严格比较与继承 NODE_TEST_CONTEXT 的子测试门禁失败；改为清单结构核对和真实独立子测试环境。第二轮15/16通过，fetch 先规范化编码穿越造成错误测试预期；改为双编码真实 HTTP 与原始 handler 路径拒绝检查。第三轮15/16通过，合成 HTTP 缺现有 contracts 必需的 `message`，被真实 SDK503拒绝；修正测试服务器 envelope。第四轮17/17通过。扩展依赖图的第五轮15/16通过，正则误将模块中的普通字符串识别为 import；改为按 import/export 语句开头解析。第六轮17/17通过，最终增加竞态/unknown 检查后18/18通过。首轮 lint 的 `no-useless-escape` 与 `no-control-regex` 两项已修复，保留此诊断，不把历史失败抹成首次通过。

## NOT_RUN、依赖与交接

Worker 未运行正式 `verify:task AF-191`、API/Web 全量 build、PG/migrate/seed/Docker、实际应用服务器、付费/厂商调用、原生浏览器、真实租约、真实同 Run 成功/拒绝或 native14 cases。真实 document-hidden、桌面/390 展示、产品访问地址及 AC-003 均 NOT_RUN/NOT_PROVEN。历史 native OS 文件选择器 NOT_PROVEN 不变。

总控依赖：先接收 AF-189/190 集成真实 ID 与最新产品状态，再实现本文指向的共享 registration、AF191 保护租约、当前可信 transport、同 origin host 及真实 native adapter；构建最新实际 SDK/API/Web，运行正式 gate、真实成功/拒绝/PG/native、关闭探测和 hash checker。schema 无需改变。缺能力应明确 FAIL/拆卡，不能写 adapter 假数据或降低门禁。

Worker 实耗约 **0.4h**（2026-11-06 07:33–07:57 CST，含启动/审查/修复/记录），低于1.25h；卡总预算3h，总控保留 **1.75h**，未使用其独占 DB/build/native 配额。总控预计1.5–1.75h接线与真实验收；实际超预算或 native 无法取得时保留证据并拆分/报阻塞，不伪造通过。

交接：候选按上述原名作一次本地提交，candidate SHA 由发送 `worker_done` 的回执给出，报告本身不自引用其提交 SHA。**STOP ALL WRITING**；接收后总控只精确集成此候选提交，再执行正式验证、队列/记录与本地原名提交。此交接不是 CODE_VERIFIED、负责人验收或发布授权；无自动续卡、push、PR、部署。
