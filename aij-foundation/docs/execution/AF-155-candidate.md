# AF-155 候选交接：接入受控Webhook通知投递

状态：CANDIDATE_READY，根集成/正式 verify:task/真实 DB 验收待执行；不是 CODE_VERIFIED，不代表 OWNER_ACCEPTED。仅本卡 Writer 自查，不冒充独立复核。历史负责人待验状态不变。

## 派工、基线与范围

- 正式 Task：`task_ec79a5c87a1f`；Dispatch：`ctx_c6f19616b50f`；Writer terminal：`term_8419b449-c446-4a29-a2ee-d086f1c429ce`；Coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- Orca 实际 Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W05-AF155`，instance `80227078-6326-4ca7-a6f9-69cee3350dfe`；父工作区为本仓库根工作区。
- 分支：`weiyang86/AIJ-W05-AF155`；起始 HEAD：`94b0236f775fa40a07944c5e0545ac6ce0e123f3`，Orca baseRef=`refs/remotes/origin/dev`。首次 `git status --short --branch` 干净；每批写入前重新检查分支/状态/HEAD/remote。
- origin fetch/push：`git@github.com:weiyang86/aij-foundation.git`。不切换分支，不 push/merge/PR/tag/发布。
- 根工作区只读读取 CURRENT_STATE、AF-155 spec、队列标题和来源；当时根 dev=`4085e23c5de9861068b7f1ccb530a5673cafda73`，已有未跟踪执行手册保留不动。轻企源码/数据库/进程未触碰。
- 仅修改本卡 8 个 allowPaths。无 bootstrap、Schema、migration、队列、registry、AGENTS、manifest、锁文件、依赖版本或其他卡文件改动。独立 `pnpm install --frozen-lockfile`，没有共享/复制 node_modules、env、真实凭据、上传目录或符号链接。
- Orca 工作区创建时间 2026-11-05 04:04:05 UTC；候选开发约 0.5 有效工程小时，低于 Worker 2.5h，为根串行验证保留至少 1h（本卡总预算 3.5h）。

## 实际差异与影响

1. `webhook-notification-policy.ts`：默认关闭；受信环境开关/最多 8 个精确 canonical HTTPS 端点。凭据、query/hash（包括空分隔符）、IP、非 443、特殊域和非规范写法拒绝。IPv4/IPv6 公网单播策略排除私网、特殊、文档、映射与过渡地址。
2. `webhook-notification-provider.ts`：真实 Node HTTPS 有界传输；全部 DNS 回答验证后固定单个 IP，TLS 正常 CA/主机名/SNI 验证和远端地址核对，固定 Host，无代理/重定向/地址或渠道回退。UTF-8 请求 <=128KiB、响应 <=8KiB、identity encoding、含 DNS 与所有等待的 10s 期限；单调时钟 checkpoint 和 AbortSignal 阻止迟到结果启动发送。构造参数仅允许受信、单实例测试 IO，无全局 fetch/prototype patch，无生产 loopback 或 insecure TLS 环境开关。
3. 发送时从服务器现有 webhook 渠道 binding 读取 SecretRef，每次调用现有 `resolveTrustedForPlugin('aij-notification', ref)`；现有 SecretCenter 负责命名空间与真实密钥解析。项目/组织/插件/配置/引用均由服务端检查，解析后复检绑定。凭据只在局部内存/HMAC 中使用，不进入 Context/intent/result/audit/log。
4. Provider 实现并文档化自有通用 v1 协议，签名 exact timestamp/key/raw UTF-8 body。固定正文，稳定 delivery key；仅接受 2xx、合法有界 JSON receiptId allowpattern，且不回显已知密钥/正文/标题值；只保存 providerMessageId。
5. NotificationRuntimeModule 只在显式有效服务端配置时注册真实 Provider；默认 registry 仍为空。NotificationDeliveryService 为 webhook 设置 maxAttempts=1，attempt>1 在外发前拒绝，其他渠道原 maxAttempts=5 与原逻辑不变。
6. 复用现有 RuntimeIdempotency 的专用 dispatch owner 保存永久一次性准入（不保存结果、无第二投递状态账本）。这是必需的持久保护：通用 JobService.retry 会重置 attempts=0，单靠 attemptNo 无法阻止人工重试。准入在 DNS/传输前提交，重复键或人工归零均不再传输；现有 Runtime 的租约 admission 继续防同租约并发。
7. 对可能外发后的任何失败，固定 `WEBHOOK_OUTCOME_UNKNOWN_MANUAL_RECONCILIATION_REQUIRED`；明确准入失败用 `WEBHOOK_ADMISSION_DENIED`。通知服务以原 lease/attempt 条件把原 RuntimeJob 置 dead 并保存安全代码，再抛出 runtimeRetryable=false，避免通用任意错误脱敏覆盖专用代码；未修改 JobService/RuntimeRegistry。
8. 新增 13 项实际源码测试和 ROOT-ONLY 新鲜 AF-155 DB/HTTP/TLS 夹具；协议和本候选记录为另外两个文档。

数据库：无 Schema/migration/秘密表/新状态，本 Worker 没有连接数据库。根验收将使用现有 scoped_config/secret_reference/runtime_outbox/runtime_job/runtime_idempotency 等 owner。Webhook 通知正文仍作为生产者 intent 保存在原 Outbox/Job；秘密不得进入 intent。页面/API/权限：不增加 UI、HTTP route 或权限；复用既有插件生命周期、SecretRef 与渠道配置权限。日志：不记录响应原文/URL/正文/凭据；保留固定终态代码与通用 Job 安全日志。

## 实际验证

在本独立子工作区执行：

| 命令/检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS，独立安装；最终回读 Already up to date，exit 0 |
| `pnpm --filter @aij/api prisma:generate` | PASS，exit 0，明确 compilation only / no DB / no env loading |
| `pnpm --filter @aij/core --filter @aij/contracts --filter @aij/runtime-contracts build` | PASS，3 个小型包，exit 0；无 API/Web build |
| 4 个允许 TS + 2 个测试脚本定向 eslint `--max-warnings=0` | PASS，exit 0 |
| `pnpm --filter @aij/api typecheck` | PASS，源码与 tsconfig.test 两个 noEmit，exit 0 |
| `node --test scripts/verification/webhook-notification.test.mjs` | PASS，13/13，0 failure/skip |
| `node --check scripts/verification/webhook-notification-live.test.mjs` | PASS，exit 0；没有执行 ROOT-ONLY fixture |
| `git diff --check` | PASS |

证据：`.artifacts/af-155/candidate-checks/{install,lint,typecheck,pure-tests}.log`；自有 TLS 合成证书/私钥仅在 ignored `.artifacts/af-155/tls/`，从未复制真实凭据。

13 项源码测试覆盖：严格 URL/白名单、公网地址分类、实际模块 factory 默认关闭/启用/拒绝、recipient 与 attempt>1 零 IO、服务器门禁与 resolve 期间绑定停用、实际 UTF-8 HMAC/固定正文/稳定 key/一次性 fence、字节请求上限、混合/私网 DNS 与 family mismatch、重定向/压缩/响应限制/非法 UTF-8/回执/异常脱敏、发送前/迟到 DNS/响应取消、真实 10s DNS 期限、实际通知 handler 的安全终态和其他 Provider 重试保留、真实 Node HTTPS 对自有 TLS 的 Host/SNI/pin/受信与不受信证书/错误主机名/大响应/重定向/在途 abort。

初次失败如实保留说明：首次 lint 的 no-control-regex 和 TypeScript 的 autoSelectFamily 类型不兼容已修正；首次 noEmit 因独立工作区缺少 core/contracts/runtime-contracts dist 失败，构建获准的小型包后通过。首次真实 TLS 边界测试出现拒绝响应后 Promise 未 settle，明确终止本人的测试进程，修正为先 reject 再关闭流，定向及完整测试复验通过。最后一次回显防护增加闭包时出现 TS18046 narrowing 错误，以局部 string 常量保留窄化后复验；失败日志保留于 typecheck-narrowing-failure.log。没有绕过这些失败、没有改其他文件压制检查。

未运行：正式 `verify:task AF-155`、API/Web 重型构建、任何 DB/Docker/migrate/seed、应用服务、live fixture、notification-outbox/config DB 回归、真实公网 DNS/CA/通知接收端与负责人验收。无对用户宣称可访问的运行地址；测试 OS 临时 loopback listener 已关闭。

## 根接续、人工验收与已知边界

根总控接收本 Writer 停写后，精确集成候选 8 文件；登记正式 verify:task 与 AF-155 精确 protected acceptance allowlist（migration/seed/runtime-environment/auth-support），保留所有原有保护。根 owns DB 与重型构建并发 1；完成实际 API build、`AIJ_AF155_ROOT_LIVE=true node --test scripts/verification/webhook-notification-live.test.mjs` 及原 notification-outbox/config 回归，再更新正式记录/队列并作原标题正式集成提交。夹具自行 seed runtime/plugin/configuration/secret 定义，无需修改 runtime-fixture 的条件分支。

live 夹具将真实调用安装/启用与渠道/SecretRef HTTP，producer transaction -> Outbox claim/consume -> Job claim/execute；验证成功一次回执与 producer/lease replay、未知结果一次请求且实际 operator retry 无第二次传输、queued plugin/config/ref/project/org 停用零 DNS/传输、秘密/正文安全投影和关闭后 applicationPools=0。其自身只映射 app-scoped IO 到拥有的 ephemeral TLS listener，仍执行本实现的有界 Node HTTPS 与 CA/主机名验证，无真实通知。根须核对实际输出，不能把此处准备好的断言当作已通过。

人工检查协议：默认 off 时任何 webhook 不外发；对受信 exact endpoint 安装/启用与绑定合成 ref；成功查看 RuntimeJob completed 和唯一 receipt；未知查看固定 dead 代码，人工 retry 不产生第二次请求；停用后队列不外发；安全查询/audit/log 无凭据和正文。端点 HTTP 接受不表示人收到/阅读。本卡不完成邮件/短信/微信/企业渠道。

崩溃在 fence 后但真正发送前也需要人工对账，属于 at-most-once 准入的取舍；接收方仍须 durable idempotency，header 本身不保证 exactly-once。通用 Runtime 的崩溃租约回收代码仍为 `lease_expired_at_attempt_limit`（按授权不改 generic JobService），此时同样不能声称未发送，须按协议对账；Provider 返回的未知结果有明确 webhook 安全代码。不能自动删 fence、自动补发或换 key；新意图由业务生产者/负责人决定。没有在途停用撤回、公网/真实接收方联调或厂商送达承诺。

下游依赖只可在根完成集成 Task `task_3fe524a10250` 的真实 gates 后引用该 Task，不得引用本候选即视为 CODE_VERIFIED。候选提交标题逐字使用队列名称 `接入受控Webhook通知投递`，候选 SHA 随 Orca worker_done 交回；本记录无需自引用提交 SHA。

Writer 交接：本候选提交完成后 **STOP ALL WRITING**，仅向协调者发送一次 worker_done，根接收与负责人验收仍待完成。
