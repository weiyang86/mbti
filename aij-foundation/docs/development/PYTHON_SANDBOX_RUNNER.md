# 受限 Python 容器适配器（AF-175 候选）

本卡交付可直接调用的 `PythonSandboxRunner`，尚未接入模块、SDK、上传、公开 API、Skill/Agent/tool、Job/Run/Trace、预算或支付。只支持标准库脚本与 JSON 输入，返回私有 RAM 中不可信 stdout/stderr 和有限状态；不返回文件、图表或文档。本 Worker 未调用 Docker daemon，真实隔离与资源限制效果由总控专用 gate 验证，候选提交不代表 CODE_VERIFIED 或负责人接收。

## 管理员构造与调用

从 `apps/api/src/plugins/aij-ai/python-sandbox-runner.ts` 直接导入类。默认 `new PythonSandboxRunner()` 返回 `DISABLED`，不启动 CLI。启用实例只能由可信服务端配置提供 `enabled: true`、可信可执行文件绝对路径 `dockerCliPath` 和预装审批镜像 `approvedImage`；镜像严格为 `docker.io/library/python@sha256:<64 位小写 hex>`。摘要格式校验不等于镜像来源审批。实例不解析 tag、拉取、构建或安装镜像；缺镜像失败关闭，没有宿主 Python 回退。

```ts
const runner = new PythonSandboxRunner({
  enabled: true,
  dockerCliPath: trustedDockerExecutable,
  approvedImage: administratorApprovedDigestReference,
});
const result = await runner.run({
  script: 'import json\nprint(json.dumps({"answer": input_data["n"] * 6}, ensure_ascii=False))',
  inputJson: '{"n":7}',
  timeoutMs: 10_000,
  signal: controller.signal,
});
```

用户 JSON 在容器中作为 `input_data` Python 变量；`sys.stdin` 为 EOF。脚本与输入经单行 JSON stdin 协议发送，wrapper 有界读取至 1 MiB（涵盖 64 KiB 脚本转义及 256 KiB 输入）；不将它们插入 argv、环境、日志、异常或 wrapper 源码。只有固定 wrapper 使用 `compile/exec`，执行位置是容器内 `/usr/local/bin/python3 -I -S -B -u -c <固定 wrapper>`。隔离模式跳过用户 site、site 初始化和字节码文件；标准库可导入。

脚本上限 64 KiB UTF-8；输入 JSON 文本上限 256 KiB、深度 32（根为 0）、总对象键/数组项 10,000。拒绝重复键、非 JSON、非有限数值以及孤立 UTF-16 surrogate（包括 JSON 转义后形成者）。数字使用 JavaScript JSON 的有限双精度语义。两路输出各 64 KiB，结束后使用 fatal UTF-8 解码，跨 chunk 字符不误判。非零脚本退出返回 `SCRIPT_NONZERO` 与安全退出码，OOM 返回 `OOM_KILLED`。CLI 错误、超时、取消、输出洪泛会丢弃已收集文本，避免将控制错误带入输出；无论成败都不自动记录或持久化脚本输出。正常完成的 stdout/stderr 仍是不可信私有文本，调用者不可自动插入 HTML、日志或公开响应。

实例默认并发 1，可由管理员固定设为 2；满额立即 `BUSY`，无等待队列。已取消请求优先 `ABORTED`，不排队、不创建。多实例和进程范围的调度/准入尚未提供，不应通过创建多个实例绕过容量控制。执行截止时间采用单调时钟，默认 10 秒，调用者可缩短或在 1–30,000 ms 内设置。控制命令各 5 秒、两路各 16 KiB，SIGKILL 后最多等 500 ms 确认 CLI 退出。创建时的取消先等有界 create 收敛，再清理；控制/清理阶段可能晚于执行截止返回，以免将杀 CLI 当作容器终止。未知创建 CLI 退出或未知归属不能报告已清理。

## 固定容器策略

使用 `spawn`、`shell:false` 和固定数组；CLI 工作目录 `/`，仅显式传递固定 `PATH`、不存在的 `HOME`/`DOCKER_CONFIG` 与 locale；不继承应用环境、Docker endpoint/context、代理或凭据。不允许客户端传入 daemon、镜像、挂载、环境、命令参数或标识符。默认本地 Docker socket 必须由总控配置/确认，适配器不接收端点选项，不修改 daemon 或全局配置。macOS 可在子进程启动后注入非秘密 `__CF_USER_TEXT_ENCODING`，离线测试单独记录该系统键。

create 强制 `--pull never`，无 hostpaths/bind、docker.sock、设备、端口、特权或附加 capability；固定：

- `--network none --read-only --user 65532:65532 --cap-drop ALL --security-opt no-new-privileges`，不关闭默认 seccomp。
- `--pids-limit 32 --cpus 1 --memory 256m --memory-swap 256m`。
- `--ulimit nofile=64:64 --ulimit core=0 --log-driver none`。
- `/work:rw,noexec,nosuid,size=64m,mode=1777`、`/tmp:rw,noexec,nosuid,size=16m,mode=1777` 两个 tmpfs，工作目录 `/work`。
- `--ipc private --pid '' --cgroupns private --no-healthcheck`；PID 空字符串是 Docker 支持的独立命名空间模式，字面值 `private` 不是合法 PID 模式。
- 显式 stdin/stdout/stderr attach + interactive；无 TTY。仅固定官方审批镜像环境和 Docker 自动产生的非秘密 HOME/HOSTNAME，不传播宿主环境。

每次调用产生 128 位随机名称和独立 192 位 nonce label。先 image inspect 固定摘要取得本地 image ID，再 create；启动前及每次 kill/rm 前都 inspect 精确名称，核验完整 64 hex ID、精确名称、nonce、审批镜像引用和 image ID。清理不使用全局 list/prune/killall、前缀 ID 或用户 label 查询。create 响应丢失时只经本次随机名称恢复已核验归属；只发现 absent 却不能排除晚到创建时，返回 `CLEANUP_UNCONFIRMED`。

运行中容器先精确 kill，再重新核验归属，rm 精确完整 ID，最后分别确认名称/ID 都 absent。普通 inspect exit 1、daemon 不可达、归属变化、删除失败或“rm 成功但仍存在”均不算清理成功。只有精确 missing-container 诊断可证明 absent；未知诊断失败关闭。`CLEANUP_UNCONFIRMED` 清空输出并覆盖成功状态，不能继续当作成功使用；当前无恢复服务，管理员需依据私有运维上下文处理，不能粗放清场。

## 验证与总控独占 gate

离线 gate 会只编译实际适配器，再启动自有 Node 假 CLI，记录 argv/env/stdin 和容器状态机；绝不执行提供的 Python，绝不调用 Docker。运行：

```sh
node --test scripts/verification/python-sandbox-runner.test.mjs
```

它验证固定参数、默认关闭/配置/输入拒绝、镜像缺失、UTF-8、精确输出上限/洪泛、非零/OOM 元数据、create 响应丢失/超时、取消、并发拒绝、归属变化、删除失败与缺失确认。假 CLI 的结果不是 Linux namespace/cgroup/seccomp 或真实 Python 执行证明。

总控必须在原主目录 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation` 的 `dev` 分支串行执行真实 gate，所有 Worker 先 STOPPED。首先自行从官方 `python:3.13-slim-bookworm` 核对多架构/平台摘要，记录来源及审批后的全摘要引用，并在必要时单独拉取自有镜像；本 gate 不执行 pull。派工说明中的 2026-11-06 daemon 29.9.2/无 Python 镜像仅为总控先验，本 Worker 未核实，不能假定已拉取。

总控在命令环境设置 `AIJ_PYTHON_SANDBOX_LIVE_ACK=OWNED_CONTAINERS_ONLY`、`AIJ_PYTHON_SANDBOX_DOCKER_CLI=<可信绝对路径>` 和 `AIJ_PYTHON_SANDBOX_IMAGE=<已审批/预装的全摘要引用>` 后，运行：

```sh
node --test scripts/verification/python-sandbox-runner-live.test.mjs
```

ack 缺失明确 skip/NOT_RUN；ack 存在但目录、分支、路径、镜像不合法会在访问 daemon 之前失败。gate 编译当前源码，仅记录自己 create 返回的完整 ID/名称/nonce；真实 spawn 前后观察自身容器，核验 uid/caps/noNewPriv/seccomp、所有固定参数、无 hostmount/credential env、只读根与 tmpfs、实际 cgroup/ulimit、JSON Unicode 算术、DNS/outbound/宿主 loopback 拒绝、洪泛/超时/OOM/PID、create/start 取消竞态，以及每个已记录 ID/名称最终 absent。它不列举/查看其他项目容器，不重启 daemon，不降级参数。镜像 fetch/平台/cgroup 能力缺失应保留真实失败/阻塞，不能用宿主 Python 或放宽 gate 替代。真实 gate 不会自动打印完整 inspect/env/daemon 异常，失败详情应按私有运维证据处理。

人工验收可先看关闭实例无 CLI、副作用为零；再由总控运行真实 gate，核对只有本次容器被清理。访问地址：本卡没有启动 API/Web，也没有新增页面/路由。

总控仍需完整 API typecheck/build/lint、正式 `verify:task` 注册与执行及适用的独立代码/PR review，才能决定 CODE_VERIFIED；负责人最终检查仍待进行。后续依赖必须使用总控 I-* 集成 Task 的真实 ID，不能用本候选 Task 作为已集成依赖。后续 chart/document 包、文件导出、准入/审批/运行策略、恢复运维与多实例调度另卡处理。Docker 共用宿主内核，本卡不构成恶意多租户/VM 级隔离认证，不开放公用执行入口。

## 核对来源（2026-11-06）

- [Docker running containers](https://docs.docker.com/engine/containers/run/)：固定资源/运行约束。
- [Docker container run CLI](https://docs.docker.com/reference/cli/docker/container/run/)：可选项与默认拉取行为，本实现强制 never。
- [Docker Engine security](https://docs.docker.com/engine/security/)：namespace/cgroup 与 daemon 权限边界。
- [官方 Python 3.13 slim-bookworm Dockerfile](https://github.com/docker-library/python/blob/master/3.13/slim-bookworm/Dockerfile)：管理员后续确认的镜像来源，不是本次镜像拉取证明。
- [Moby namespace mode 校验源码](https://github.com/moby/moby/blob/master/api/types/container/hostconfig.go)：PID 独立模式为空，IPC/cgroupns 支持 private。
- [Docker start attach 源码](https://github.com/docker/cli/blob/master/cli/command/container/start.go)、[stdin attach/once 配置](https://github.com/docker/cli/blob/master/cli/command/container/opts.go)：固定 attach 协议设计依据，真实 daemon 行为仍由总控 gate 验证。

## 总控实际集成结果（2026-11-06）

AF175正式run-mTMIXe PASS：真实API dist、41离线process+8真实Docker测试，12专用容器最终ID/name均不存在；实际running后Abort已观察，defaultseccomp/nonroot/no-net/readonly/cgroup资源均实测。原生Docker缺失--format输出换行导致旧cleanup误报，根保留精确exit1+目标不存在stderr，仅接受stdout空白/空数组；其他输出/连接错误仍unknown。失败run-XuCDaG/run-G6YUN6和定向诊断均保留。live测试现在直接加载apps/api/dist，不再转译scratch，不删除实际dist。官方OCIindex a5a7017efc5969e00ae2b91c8eb0631049a569652aa4ffc4501769049ae45c72在linux/arm64验证；其他平台未测。技术通过不是负责人接收或公开脚本准入，范围仍是默认关闭的内部适配器。
