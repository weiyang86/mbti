# AF-171 候选交接：实现受限知识网页抓取适配器

状态：`CANDIDATE_READY / NOT_CODE_VERIFIED / OWNER_CHECK_PENDING`。本记录属于候选提交，不更新正式队列/registry，不代表总控接收、独立复核或负责人验收。候选提交完成后 Worker 明确 **STOP ALL WRITING**；最终 SHA 以同一提交的 `git log -1` 和 worker_done 收据为准（不能在同一提交内自引用其 SHA）。

## 真实派工、基线与写入核对

- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W09-AF171`；instance `edde02f2-86b6-48e1-9dab-5adf7d7de1ad`，由 `orca worktree current --json` 读取。
- Task：`task_9a05d8b342ec`；Dispatch：`ctx_1314b1c8328e`。
- Worker terminal：`term_f7b05385-29ab-4f55-a75e-67fa9ebf0dc7`；coordinator terminal：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- Branch：`weiyang86/AIJ-W09-AF171`；初始 HEAD / parent / frozen `origin/dev`：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- Remote fetch/push：`git@github.com:weiyang86/aij-foundation.git`；未 fetch/push、未改远端/分支、未改主工作区与 qingqi。
- 初始 `git status --short --branch` 仅显示本分支，干净。Bootstrap 清单为空，未恢复/复制 source blobs、未做 bootstrap commit。
- 下列各写入阶段均先读取 status/branch/HEAD/origin/dev/remotes；上下文的 Worktree/Task/Dispatch/terminal 保持上述值：独立 frozen 安装与新文件初稿（UTC 13:10 起）、单文件 TS/lint 修复及单元测试、13:26 缓存拒绝回归补测/修复、13:28–13:34 资源清理/单调 deadline 与使用文档、最终记录与候选提交。每次 status 只出现下述本卡新文件，HEAD/origin/dev 在候选提交前一直为指定基线，未发现继承或同范围 Writer 冲突。
- 工时：2026-11-05 UTC 约 13:10–13:40，Worker 约 **0.5 有效工程小时**；小于 Worker 1.5h 上限，保留 root 至少 1.5h 验证/集成预算。没有子 agent/辅助 Worker。

## 实际交付与影响

仅新增以下 5 个 allowPaths：

1. `apps/api/src/plugins/aij-ai/knowledge-web-reader.ts`：真实默认 resolver + HTTPS/TLS 实现、固定 URL/IP/头/字节/编码策略、逐跳 DNS 全量检查和实际 lookup pin、deadline/cancel、可复用类型/错误、server-owned conditional update/metadata-only 304。
2. `scripts/verification/knowledge-web-reader.test.mjs`：12 组实际执行测试，使用 Node HTTP parser/内存 Duplex，非 regex 源码断言或假 fetch 返回值。
3. `scripts/verification/knowledge-web-reader-live.test.mjs`：总控专用编译产物 + 自有 UDP DNS/HTTPS socket/TLS fixture 计划，Worker **NOT_RUN**，仅完成语法/lint 检查。
4. `docs/development/KNOWLEDGE_WEB_READER.md`：调用契约、固定策略、可信 seam、限制、总控命令、原始依据链接。
5. 本执行记录。

数据库/Schema/迁移/seed：无。接口/权限/SDK/菜单/页面/Knowledge 发布/embedding：无；上游授权与租户隔离须由未来 Knowledge URL API owner 完成。没有 env/依赖/lock/module/index/正式队列/registry 改动；没有运行应用或提供已启动访问地址。代码不打印日志，只提供固定错误 code；返回内容、URL query、validator 和原始错误不得写入外部日志或验收证据。HTML 保持不可信数据，不能直接渲染为可信 HTML/执行指令。

## 真实验证结果

环境：Node **24.21.0**，pnpm **10.0.0**；工作区自行 `pnpm install --frozen-lockfile --ignore-scripts`，最终回读 exit 0、Already up to date；没有共享/链接其他工作区的 node_modules、上传、env 或数据库。

| 命令/验证 | 实际结果与边界 |
| --- | --- |
| `pnpm exec tsc apps/api/src/plugins/aij-ai/knowledge-web-reader.ts --target es2022 --module commonjs --strict --esModuleInterop --skipLibCheck --types node --noEmit` | PASS，exit 0；仅本文件，不代表全 API typecheck |
| 同一 tsc 参数，将 `--noEmit` 替换为 `--outDir .artifacts/af171/compiled` | PASS，exit 0；真实单文件编译产物，用于下面测试，无 DB/重型构建 |
| `AF171_COMPILED_READER=.artifacts/af171/compiled/knowledge-web-reader.js node --test scripts/verification/knowledge-web-reader.test.mjs` | PASS，12/12、0 fail/skip；最终实现的编译产物，内存 transport seam，无 socket/TLS live 证明 |
| `node --test scripts/verification/knowledge-web-reader.test.mjs` | PASS，12/12、0 fail/skip；Node strip-types 直接加载；出现 MODULE_TYPELESS_PACKAGE_JSON 警告，未为消警改 manifest |
| `pnpm exec eslint apps/api/src/plugins/aij-ai/knowledge-web-reader.ts scripts/verification/knowledge-web-reader.test.mjs scripts/verification/knowledge-web-reader-live.test.mjs --max-warnings=0` | PASS，exit 0，定向真实 lint |
| `node --check scripts/verification/knowledge-web-reader-live.test.mjs` | PASS，exit 0；仅语法，不是执行/网络证据 |
| `git diff --check` / 候选提交前 staged diff check | PASS；只暂存以上 5 个新文件 |

测试覆盖：严格 URL/punycode/percent/数字 IP 正规化；全部 special address 类与边界、混合 DNS、地址家族/数量、真实 chosen lookup 单地址/all 与 IPv6；可信 constructor 快照；实际 HTTP parser 的正常 UTF-8/HTML 原始数据、受控出站头、长度虚报（偏大/偏小）、无 Content-Length 和 chunked 超限；类型/charset/压缩/重复与超量头拒绝；BOM/NUL/畸形/空正文；3 次 redirect 与超限/降级/账户/私网/二次解析重绑定拒绝；同资源条件更新、跨资源不转发、304 无正文/缓存非法/冲突 ETag；TLS 错误归类（单元模拟）、DNS/header/read/overall/慢速滴流 timeout、取消和清理、安全错误无 cause。未抓取任意用户网页或真实外部服务。

## 曾失败与修复（保留真实历史）

- 首次单文件 tsc 命令错误指定尚不存在的 `apps/api/node_modules/@types`，得到 TS2688；使用工作区安装实际 `node_modules/@types` 默认解析后继续，不改依赖。
- 初稿 tsc 暴露 never helper 的 narrowing、Node TLS type 中不含 family/autoSelectFamily；改用函数声明与显式 `KnowledgeWebTlsOptions` 类型。初稿 lint 报两处 `no-control-regex`；改为代码点检查，未降级规则。
- 13:26 补测发现 304 不同 ETag 仍被接受，**9/10 pass、1 fail（Missing expected rejection）**；修复 weak ETag 比较及 Last-Modified-only 语义后通过。后续加入 IPv6/all lookup 与连续滴流/取消，共 12 组通过。没有隐藏失败或标成已验证。

## NOT_RUN、限制与下一依赖

**NOT_RUN**：根总控 live fixture、全 API typecheck/适用总体 lint、正式 `verify:task AF-171` 与注册/执行/收据、编译默认 connector 的自有 socket/TLS 成功和拒绝证明、独立/PR/负责人复核、集成提交/推送/远端 SHA 回读；无 DB/应用/API/Web heavy build、SDK/browser gate、对外网络、供应商、付费模型、支付或通知调用。

总控 live 命令与细节见开发文档：分离默认 DNS 私网拒绝（真实自有 DNS、TCP=0）、默认真实 TLS connector 的已校验 lookup target（syscall 前拒连，无外连）、默认 CA 的 self-signed 拒绝、以及明确可信测试路由/测试 CA 下的实际 HTTPS/流/redirect/abort/refusal/cleanup。该 live 脚本本身尚未执行；语法/lint 不能替代执行，失败应交回原 Writer，不得填通过或把测试映射描述为公网默认传输成功。

本卡仅适配器；不支持 HTTP、自定义端口/认证头、压缩、非 UTF-8、HTML 解析或多地址 failover；地址策略保守拒绝特殊服务，静态分类须随 IANA 政策变化更新。下一任务 Knowledge URL 导入/更新 API 必须依赖总控完成的真实 I-* 集成 Task ID，而不能依赖本候选 Task 成功状态。总控接收明确停止写入交接后精确集成、正式验证、更新执行/队列、原名提交及远端回读；Worker 不继续下一卡、不修改 root/正式状态。

人工验收：阅读固定策略和差异，执行编译 + 单元 + 自有 live fixture，核对错误仅 code/count、重定向每跳 pin、304 不含正文及所有 socket/listener 已清理；按总控实际结果决定是否接收。访问地址：**没有已运行应用地址**。
