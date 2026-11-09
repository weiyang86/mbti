# AF-175 候选执行记录

任务名：实现受限Python脚本容器执行适配器。

状态：CANDIDATE_READY；交接后 STOP ALL WRITING。不是 CODE_VERIFIED、I-* 集成完成、独立 Review 或负责人接收。真实 Docker 验收尚未执行。

## 身份、基线和写入边界

- 注册 Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W10-AF175`。
- Worktree instance：`88c4f0b3-1e03-428a-b37d-a6020c53c2e1`；父目录 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation` 仅只读参照，未在其写入/运行。
- Task：`task_48063a87e12c`；Dispatch：`ctx_8172c661a3dd`。
- Writer terminal：`term_e0cdf5d8-1a33-4d4d-8f7a-ae79c701cc30`；Coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支：`weiyang86/AIJ-W10-AF175`；初始 HEAD/本地 origin/dev 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- remote fetch/push：`origin git@github.com:weiyang86/aij-foundation.git`；未 fetch/push/PR/merge/tag/deploy/release，未改 main/dev。
- 初始 `git status --short --branch`：只有分支行，无已有修改。各写入阶段先回读分支/status/HEAD/remotes，均为同一基线；中间差异只有本卡 allowPaths。bootstrap 列表为空，无 bootstrap 提交，候选父提交保留实际 origin94。
- 无子代理、Helper Worker、DB/Docker daemon 命令、migrate/seed、应用启动、付费模型、支付或通知调用。独立执行 `pnpm install --frozen-lockfile --ignore-scripts`，使用本子目录 hoisted/copy node_modules，无共享或符号链接依赖。忽略目录 `.artifacts/af175/` 仅为本卡编译与自有合成假 CLI 证据。
- 有效工程时间约 0.30 小时（2026-11-06 00:57–01:15 CST，估计，含自查/测试/记录）；低于 Worker 1.5 小时上限。剩余批预算由总控统计，本记录不替代其跨 Worker 账目。

## 实际差异及影响

仅五个允许路径：

1. `apps/api/src/plugins/aij-ai/python-sandbox-runner.ts`：可调用实际 Docker create/start/attach/inspect/kill/rm 状态机；默认关闭；固定摘要镜像/CLI、无 shell/host Python 回退/挂载/宿主环境、标准库 wrapper + JSON stdin；输入与输出有界、UTF-8 严格；随机名称/nonce、完整 ID/镜像核验；清理无法确认时覆盖为 CLEANUP_UNCONFIRMED；实例并发上限立即拒绝，无队列。
2. `scripts/verification/python-sandbox-runner.test.mjs`：编译实际源码并运行自有 Node 假可执行文件，覆盖实际 spawn 协议与竞争/拒绝路径。假 CLI 不执行 Python，不连接 daemon，不代表隔离证明。
3. `scripts/verification/python-sandbox-runner-live.test.mjs`：总控原 dev 独占真实 gate；显式 ownership ack/绝对 CLI/固定摘要/原主目录 guard；只观察本次完整 ID/随机名称并在每次 start/kill/rm 检查归属及完整资源/namespace 参数；真实 Python、Unicode、网络/文件系统、洪泛/超时/OOM/PID 和取消竞态，结束核验本次 ID/名称均 absent。无 pull/全局扫描/重启/配置修改，未知情况失败关闭。
4. `docs/development/PYTHON_SANDBOX_RUNNER.md`：使用契约、策略、清理限制、总控验收步骤与官方来源。
5. 本执行记录。

数据库/Schema/迁移：无。公开接口/模块/SDK index/Skill/Agent/tool/Job/Run/Trace/预算/支付：无。页面/路由/权限菜单：无。日志：适配器不记录脚本、输入、输出、argv 或 Docker 原始错误；返回输出仅不可信私有 RAM 文本。访问地址：没有启动 API/Web/HTTP 服务，没有新增可访问地址。

## 验证命令与结果

- `pnpm install --frozen-lockfile --ignore-scripts`：exit 0，manifest/lock 未改；首次独立安装，二次回读 Already up to date。
- `node --test scripts/verification/python-sandbox-runner.test.mjs`：最终 exit 0，37/37 pass、fail/skip/todo 0，约 31.8 秒；本地证据 `.artifacts/af175/offline-final.tap`。每次测试重新小范围编译当前实际源码，不依赖旧 dist。
- `node_modules/.bin/tsc apps/api/src/plugins/aij-ai/python-sandbox-runner.ts --module commonjs --target ES2022 --moduleResolution node --types node --strict --skipLibCheck --noEmit`：exit 0。
- `node_modules/.bin/eslint apps/api/src/plugins/aij-ai/python-sandbox-runner.ts scripts/verification/python-sandbox-runner.test.mjs scripts/verification/python-sandbox-runner-live.test.mjs`：exit 0。
- `node --check scripts/verification/python-sandbox-runner-live.test.mjs`：exit 0。
- 无 ownership ack 执行 `node --test scripts/verification/python-sandbox-runner-live.test.mjs`：exit 0，0 pass、1 skip，原因 `NOT_RUN: root ownership acknowledgement absent`；证据 `.artifacts/af175/live-guard-not-run.tap`。仅确认关闭门禁，不访问 Docker，不计真实验收通过。
- `git diff --check` / 提交前精确暂存差异检查：通过；只提交上述五路径，提交标题逐字采用任务名称，实际 SHA 由 worker_done 回读报告。

37 项包含：默认关闭、可信配置/相对或缺失 CLI 拒绝、脚本/输入字节限制、重复键/深度/键数量/无穷值/孤立 surrogate 拒绝、预取消/缺镜像无创建、精确 argv/stdin/环境策略、Unicode 正常/跨 chunk UTF-8、各路恰好 64 KiB、非法 stdout/stderr UTF-8、非零/OOM 安全元数据、stdout/stderr 洪泛、控制洪泛、create 超时/无响应/错误/短 ID/错误完整 ID、未知 owner/image/name/inspect、后续 owner 变化、删除失败/假成功/确认不可达、create/attach 取消、kill 后归属变化拒绝 rm、截止与实例容量释放。不回显合成 Docker 私有错误。

## 有意义的失败/修复证据

- 首轮离线 28/29：测试假设子进程仅有四项环境，但 macOS 自动加 `__CF_USER_TEXT_ENCODING`；明确只允许这个系统 locale 键额外存在，继续精确校验四项显式环境及合成秘密未继承。后续全部通过，未扩大容器权限/资源门禁。
- 初次 TypeScript 检查引用 `apps/api/node_modules/@types/node` / `.pnpm` 隔离布局失败；本仓库 .npmrc 是 hoisted/copy。改用本 Worktree 正确 hoisted 根 types，最终实际 tsc 通过，无跨工作区依赖。
- 初次 lint：JSON token 字符类多余转义，修正后通过。
- 官方源码自查发现 Docker PID 不支持字面值 private，改成固定空字符串所表达的独立 PID namespace；stdin 改为显式三路 attach + 单行有界协议，不依赖 EOF。该发现来自源证据，不是冒充真实 Docker 测试。
- 单调截止时间和 CLI reap 未确认失败关闭是在同一 Writer 自查中补充，不冒充独立审查。

## NOT_RUN、后续依赖与交接

真实 Docker image lookup/pull/create/start/inspect/kill/rm 与任何真实 Python 隔离、cgroup/seccomp/内存/PID 效果均 NOT_RUN。派工说 root daemon 29.9.2 且无预装 Python 镜像，本 Worker 未核实或拉取。总控先在原 dev 串行确认 daemon 归属、官方 python:3.13-slim-bookworm 平台摘要、预装审批镜像；再按开发文档设置三个 gate 环境项运行真实 gate；fetch/平台/cgroup 缺失必须真实报告阻塞，不降级资源/隔离或改用宿主 Python。

完整 API typecheck/build、全局 lint、正式 verify:task 注册/执行、真实 Docker gate、独立代码/PR Review 和负责人检查均由总控/负责人继续；Worker 未修改正式队列/registry/AGENTS/依赖 manifest/lock/生产 module/Schema/SDK index。没有运行正式门禁，不能标成已验证卡片或完成 I-*。

候选可由总控在收到明确 STOPPED 后精确集成。后续 executableSkills、图表/文档包与 artifact export、公开准入审批/执行策略及多实例容量/运维恢复仍属后续任务；本卡 Docker 共用宿主内核，不是恶意多租户或 VM 隔离认证。下游依赖引用总控真实 I-* 集成 Task，当前候选 Task 不充当 CODE_VERIFIED 依赖。

Writer 在单次候选提交与只读 SHA/status 回读后 **STOP ALL WRITING**，只发送一次 worker_done；不自动续卡、不推送、不改全局状态。
