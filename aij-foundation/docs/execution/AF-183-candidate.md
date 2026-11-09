# AF-183 候选交付记录

任务名称：实现阿里云向量化与重排协议适配器。状态：CANDIDATE，非 CODE_VERIFIED / 非负责人验收。Writer：当前派工 Codex，未使用子 agent、helper worker 或 Trea。

## 真实派工与基线

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W12-AF183`。
- Orca instance：`3ec5ed38-3ae9-4d0b-92d6-e809d2add988`，parent 为原 dev 工作区；`orca worktree current --json` 核实为已注册非 main Worktree。
- Task：`task_b5f660221aef`；Dispatch：`ctx_cd8c541c8e54`。
- Worker terminal：`term_fd9fbe04-109b-4dbc-bd51-e94ebde8a3af`；协调 terminal：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支：`weiyang86/AIJ-W12-AF183`；起始 HEAD 与本地 `origin/dev`：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- remote：`origin git@github.com:weiyang86/aij-foundation.git`（fetch/push 配置相同；没有 push/fetch/远端写入）。
- 初始 `git status --short --branch` 干净，无继承差异。bootstrap 清单 `[]`，不需要也没有 bootstrap restore/commit。
- 本次只写 allowPaths 五个文件和忽略的本 Worktree `node_modules` / `.artifacts/af183`；不写 root、qingqi、队列/registry、Schema、现有 provider/module/index、manifest/lock。

每个写入阶段前均回读 `git status --short --branch`、HEAD、origin/dev 与 remote；20:43Z 首次安装/实现前、20:49Z 测试夹具阶段、20:50Z 输入安全修正阶段、20:52Z 文档/提交前，基线均为上述 SHA。后续最终回读记在交接输出。工作开始约 2026-11-05 20:40Z（本地 2026-11-06 04:40）。

## 实际变更

1. `apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts`：Node stdlib-only 真实可复用协议实现，固定北京原生 embedding-v4/rerank 模型、端点、维度、结构及大小/超时限制；沿用现有 `request(url, init)` 传输接口；私有内存数值结果；严格 schema/usage/安全错误；取消注入请求并拒绝迟到结果。
2. `scripts/verification/aliyun-retrieval-protocol.test.mjs`：真实编译源码的边界套件，含真实 owned loopback HTTP 测试和不合作边界取消/截止测试。
3. `scripts/verification/aliyun-retrieval-protocol-live.test.mjs`：仅总控运行的 whole-API dist + 真实 `AiCenterHttpTransport` 回环协议验证脚本，Worker NOT_RUN。
4. `docs/development/ALIYUN_RETRIEVAL_PROTOCOL.md`：2026-11-06 官方来源、native/OpenAI/SDK 形状差异、固定策略、限额、结果边界、后续宿主职责与可复现命令。
5. 本执行记录。

数据库/迁移、API/SDK、页面、权限、日志格式、产品目录/已配置 capability 影响：均无。无 env/真实 secretRef、真实 vendor 请求、数据导入/索引/知识接入、第二成本/运行账本。无产品进程或可访问页面，只有测试期间临时回环服务器，finally 清理连接。

## 验证与真实失败

- 独立 `pnpm install --frozen-lockfile --ignore-scripts`：PASS（726 packages，冻结锁文件未变）。Node v24.21.0 / pnpm10 / TS5.9.3，未运行安装脚本或 DB generate。
- 初次单文件 tsc 使用 `--typeRoots apps/api/node_modules/@types`：FAIL TS2688，因为仓库 hoisted linker 的 Node types 在本 Worktree 根 `node_modules/@types`；已移除此错误路径参数，使用原编译器默认解析后 PASS，没有改依赖或放宽类型检查。
- 单文件 strict tsc 编译与隔离 suite 初版：6/6 PASS；加入真实回环 HTTP 后 7/7 PASS。
- 最终 `pnpm exec tsc <本卡 TS> --target ES2022 --module commonjs --moduleResolution node --strict --skipLibCheck --types node --noEmit`：PASS（与原 API strict/skipLibCheck 方向一致，无类型断言绕过门禁）。
- 最终真实单文件编译 + `AIJ_ALIYUN_PROTOCOL_MODULE=.artifacts/af183/compiled/aliyun-retrieval-protocol.js node --test scripts/verification/aliyun-retrieval-protocol.test.mjs`：8/8 PASS，0 fail/skip，含真实临时回环 HTTP 序列化、乱序向量复位、原文档下标重排、429 无重试、累计超大响应及实际流取消；其余为结构/usage/秘密/未知错误/迟到结果/固定超时拒绝。
- 目标 `pnpm exec eslint`（TS + 两个 mjs，`--max-warnings=0`）：PASS；root-only wire 脚本 `node --check`：PASS（只检查语法，非执行通过）；`git diff --check`：PASS（暂存前的增量检查，提交前另查完整 cached diff）。
- 完成同 Writer 自查：端点/模型/参数封闭；默认未配置；结果不含文本/凭据/request_id；未知 usage 不伪造零或金额；无第二传输/账本、重试或失败切换；未修改 allowPaths 外受管文件。自查不是独立复核。
- ROOT ONLY / NOT_RUN：完整 API types/build、whole-API 真实 transport wire、原 TEXT 回归、全仓 lint、`verify:task`、真实 vendor 验收。数据库/迁移/真实付费测试未授权，未运行。

## 接收边界

该候选证明协议封装与严格归一化可用、离线网络拒绝/取消路径有效，不证明后续 host auth/secret/admission/cost/provider registration 或真实 vendor 可用性。默认 capability 未配置；不得将候选当成产品支持已经启用。I183 集成任务须依赖真实 I181（AF181 HIGH 修复先集成），由总控独占正式 API 构建/回归/校验及注册记录更新；Worker 不更新任何正式队列状态。

人工验收：检查固定官方模型/端点与来源，查看真实 diff；运行总控完整 dist 两套测试并确认秘密不回显；确认 provider/catalog/Schema/公共 API 没有变化且 `configured:false`；记录尚未实现的 host 接线，不进行付费调用。

Worker 工程实耗约 0.25h（含官方浏览、安装、实现、测试、自查与记录），小于 1.25h 上限；预留总控 1.75h 配额，未启动后卡。候选 SHA 与 STOP ALL WRITING 在最终交接提供（本记录随候选提交，不能自嵌其自身 SHA）；候选提交标题严格为“实现阿里云向量化与重排协议适配器”，无 push。总控接收明确停止写入后才能集成；本地提交不代表 CODE_VERIFIED 或负责人验收。

## 同卡 Writer 交回修正（2026-11-06）

上述记录保留为首版历史。首版候选 SHA 为 `6fd335f763f2047e1cdfb768de24576680df7f69`；收到总控明确交回同一卡唯一 Writer 后进行本次增量，未 amend/reset 首版。新 Task `task_718beb708cce` / Dispatch `ctx_7650eb9bf5b3`，Worktree/terminal/branch/remote 与前述相同，root 尚未集成或修改本范围。交回初态干净，HEAD 为首版 SHA，origin/dev 仍 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`；每次测试/实现/文档写入阶段前再次回读状态、HEAD、origin/dev、remote（21:06Z、21:07Z、21:08Z 后续修正阶段）。仅原五个 allowPaths 修改，无新 bootstrap/依赖或越界。

两项首版缺陷已确认：正常 LF/CR/TAB 被笼统 Cc 拒绝；自动解压 Response 的编码 Content-Length 被误当作解码长度比较。先补真实 HTTP 回归并在旧编译产物上运行：原八项保留通过，新增排版用例报 `ALIYUN_INPUT_INVALID`，正常 gzip 报 `ALIYUN_RESPONSE_INVALID`，总计 10 pass / 5 fail（含父子测试失败计数），没有隐藏 before-fix 失败。

另发现并向总控提出真实边界问题（ask `msg_02542571e6ad`）：Node v24.21.0 / 内置 Undici 7.29.1 将完整 97-byte gzip 与去尾 8 bytes 的 89-byte gzip 都解成相同 85-byte 合法 JSON。总控在 `msg_788b611ee070` 明确确认可观察保证：固定 gzip/deflate/br 单编码、编码长度声明和解码流各限 256 KiB、identity 严格匹配、可观察 HTTP/decoder/JSON/UTF8/schema 错误仍拒绝；不声称原 Response 能独立校验 gzip CRC/尾部，不新增网络/解压传输。

实际增量：`text()` 只豁免 TAB/LF/CR 并原样保留，继续拒绝其他 C0/C1、Cf/bidi 和未配对 Unicode；编码感知长度分支保留全部响应边界；普通 suite 新增真实网络排版、gzip/deflate/br、两种大小上限、错长度、解码/JSON 错误、未知复合编码及压缩取消 socket 清理，并如实断言 Node gzip 尾部宽容接受。root-only wire 同步以上路径，仍 Worker NOT_RUN；文档同步了实际可观察保证和不提供的压缩完整性保证。原八项未删除，旧 `abc\n` 拒绝断言按授权纠正为 `abc\v`，同时新增正向 LF/CR/TAB 发送与反向逐类 unsafe 控制测试。

中间目标 lint 真实 FAIL：显式 C0 范围触发 `no-control-regex`，以及夹具未使用变量；改为 Unicode 类加普通排版排除的等价表达、显式 drain 使用后修复，无 suppress/忽略/放宽门禁。

本次最终真实命令和结果：

```sh
pnpm exec tsc apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts --target ES2022 --module commonjs --moduleResolution node --strict --skipLibCheck --types node --noEmit
pnpm exec tsc apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts --target ES2022 --module commonjs --moduleResolution node --strict --skipLibCheck --types node --outDir .artifacts/af183/compiled --declaration
AIJ_ALIYUN_PROTOCOL_MODULE=.artifacts/af183/compiled/aliyun-retrieval-protocol.js node --test scripts/verification/aliyun-retrieval-protocol.test.mjs
pnpm exec eslint apps/api/src/plugins/aij-ai/aliyun-retrieval-protocol.ts scripts/verification/aliyun-retrieval-protocol.test.mjs scripts/verification/aliyun-retrieval-protocol-live.test.mjs --max-warnings=0
node --check scripts/verification/aliyun-retrieval-protocol-live.test.mjs
git diff --check
```

以上全部 PASS，suite 为 15/15 pass、0 fail/skip（10 顶层 + 5 子测试），无真实付费/密钥调用。root-only wire 只语法检查 PASS，执行仍 NOT_RUN；现有八项逻辑与原成功/拒绝断言保留（仅纠正不再成立的 LF 拒绝样本）。完成同 Writer 自查：没有新传输/解压器，编码声明与解码累计上限独立，identity 长度严格，标准排版原样而其他控制继续拒绝，解码后的 schema/usage 等原校验仍执行；自查不冒充独立复核。

本次结束时累计 Worker 工程时间约 0.45h（首版约 0.25h + 本次含复现/问答/修正/测试/记录约 0.20h），小于累计 1.25h 上限，保留整卡 root 配额。增量本地提交仍采用原任务名“实现阿里云向量化与重排协议适配器”，最终完整 SHA 随 worker_done 提供，首版历史保留且不 push。再次 STOP ALL WRITING 后交接，总控正式门禁/whole-API types/build/真实传输集成/原 TEXT 回归/DB/真实 vendor 仍 NOT_RUN，I183 仍依赖真实 I181，本候选仍非 CODE_VERIFIED；不存在应用访问地址或待清理的夹具服务器。
