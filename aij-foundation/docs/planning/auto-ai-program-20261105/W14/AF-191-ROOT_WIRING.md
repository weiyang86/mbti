# AF-191 · 总控接线与严格适配契约

这是总控实施提案，**Worker 未实施共享接线，真实验收 NOT_RUN**。只集成 bootstrap 之后的单个候选提交；不要合入 bootstrap 差异。AF-189/190 完成后必须重新构建最新实际 SDK/API/Web，以其当前产物运行本卡。通用 ADMIN CATALOG `general-text` 不依赖个人 Agent 的发布语义。适配器启动中途失败时必须在内部 finally 关闭已经取得的自有资源，不能等尚未返回的 fixture 由外层清理。

总控独占新增适配器 `scripts/verification/workbench-sdk-target-root.mjs`（Worker 不创建），导出 `async startTargetAcceptance(options)`。`options` 固定 `{task:'AF-191', freshLease:true, transport:'AiCenterHttpTransport:owned-loopback', concurrency:1}`。不能返回 mock Response、插入 Run 或直接构造成功。入口脚本本身检查主 dev、独立 git-dir、环境 opt-in、适配器真实文件与缺失方法；任何缺失都会 FAIL，没有 SKIP。

共享修改仅由总控进行：

1. 在 `scripts/database/migration.mjs` 的新 acceptance 任务授权，以及 `scripts/verification/client-auth-fixture.mjs` / `client-ai-workbench-live.mjs` 对应精确任务校验中加入 AF-191；逐个核对实际位置，保持旧任务 opt-in 不互相授权。新建 AF191 保护租约，不复用 AF142/149 或其他卡数据库。
2. 扩展现有真实工作台 fixture 以返回受本 lease 限定的计数、只读归属投影、合成 actor HTTP 和关闭证据。编译真实 App/Prisma 后启动，使用服务端会话/Workspace/member/role/project/org/plugin 锁和现有 admission/Job/Trace/budget/nonce owner。
3. **不要沿用 AF142/149 fixture 中覆盖 `transport.request` 的旧做法。** 参考总控已验证的可信本地 transport 注册方式，只在新租约测试环境允许指定自有 loopback upstream，调用实际 `AiCenterHttpTransport.request`。保留 endpoint/重定向/响应大小/nonce 栅栏；无外网或付费调用。合成上游仅返回真实 HTTP 兼容响应及 usage，不报告厂商实付 cost。
4. 注册正式 AF-191 `verify:task` 到新离线和真实脚本，适用的编译、API/Web build、原生证据和清理门禁均强制。Worker 未修改 registry、队列、manifest、SDK index 或 schema。
5. 一个自有 loopback fixture host 在同一授权 origin 代理实际 Next 页面与 API，并将 `createConsumerHandler(consumer)` 精确挂到 `/af191-consumer/`。原始请求路径先经过安全检查，不能在 handler 前将编码穿越转换为其他路由；其他路由复用原代理。无 CORS 放宽、session mutation、登录劫持或共享 node_modules。消费者只有自身 fresh npm 安装目录，静态 handler 仅允许其 HTML/CSS/JS 与包内 `.mjs`。

适配器返回属性：

| 属性 | 要求 |
| --- | --- |
| `task`, `approvedLeaseTask` | 都为 `AF-191` |
| `acceptanceId` | `createAcceptance('test','AF-191')` 的真实新 ID |
| `projectId`, `workspaceId`, `memberId` | 当前服务器验证的合成项目、Workspace、提交者；ProjectProfile 不充当 Workspace |
| `agentCode` | `general-text`，已发布通用目录 Agent |
| `transport` | `AiCenterHttpTransport:owned-loopback`，实际调用原 transport |
| `apiBaseUrl` | 本次自有 `http://127.0.0.1:PORT/api` |
| `artifactDirectory` | 自己创建、真实路径、git ignored 的 `.artifacts/…` 私有目录，关闭 fixture 后保留 |
| `sdkTgz`, `contractsTgz` | 本次最新真实 public dist 执行 `pnpm pack` 的私有包绝对路径；不发布包 |

适配器方法（任何一个缺失都失败）：

| 方法 | 实际操作与返回 |
| --- | --- |
| `counters()` | 真实 PG + 本次 HTTP/upstream 观察，精确 `{runs,jobs,traces,upstream,submits}`；前置全 0，后置全 1。`submits` 只统计通用 Agent POST，不含 fixture 登录/Workspace 准备。拒绝、消费者与二次 pump 后不得增长 |
| `databaseSnapshot(runId)` | 从本租约只读查询返回下面的真实归属投影；不返回 input/snapshot/output/nonce 明文 |
| `native(case,args)` | 实际 Orca 原生桌面操作当前页面，形成下面的回执；不能注入伪造页面状态、调 DOM setter 代替用户提交、篡改 `document.hidden` 或直接调用 API 代替页面操作 |
| `request({actor,method,path,workspaceId})` | 原生 fetch 对真实 API 的响应 `{status,body}`，四种 actor；私有 Cookie 留 RAM，不输出/持久化 |
| `fetchAsActor(actor,url,init,nativeFetch)` | 验证请求 exact 自有 origin、路径、GET、scope 后，仅补入该合成 actor 的私有 Cookie，再调用传入的 `nativeFetch`。不得构造/重写 Response、状态或响应体；匿名不带 Cookie。真实 SDK 的 `createClientApi` 自行解析 envelope/错误 |
| `mountConsumer({consumer,handler,route})` | 挂载到同 origin；浏览器复用通过真实登录产生的 Cookie。确认安装目录与源码/原仓库完全独立 |
| `pumpJobs()` | 原 JobService claim/execute；第一次一个 job，第二次零个；保持原 maxAttempts/nonce/admission 规则 |
| `evidence({consumer,runId,native,matrix,sourceFiles})` | 从真实观察形成下述私有原始文件并返回 descriptor 数组；不能从一份手写 pass JSON 扩写证据 |
| `close()` | 在 finally 中关闭自有 host/Next/API/upstream、撤销临时 fixture hook、关闭 PG 连接池，实际探测 socket/pool，返回 `{applicationPools:0,ownedSockets:0,files:[closedDescriptor]}`；不清除证据目录。消费者目录由 harness 校验 marker 后删除 |

`databaseSnapshot` 返回真实模型的窄投影，BigInt 转字符串：

```ts
{
  run: {id, projectId, workspaceId, memberId, agentCode, jobId,
    sourceType: 'catalog', budgetStatus: 'settled', estimatedCostNanos: string},
  job: {id, jobType: 'aij-ai.agent-execute', scopeId, workspaceId,
    status: 'succeeded', attempts: 1, maxAttempts: 1},
  trace: {jobId, projectId, attempt: 1, status: 'succeeded',
    costSource: 'unreported', costAmountNanos: null}
}
```

`sourceType` 从真实快照无个人 `source` 的事实投影为 catalog，不新增模型或 owner。原 Trace 的 `unreported` 不能编造成 0 元实付；Run 的估价必须匹配 API 返回并为 settled。schema **无需修改**。现有 RuntimeJob leaseNonce 与 admission 锁继续由实际 JobService/Service 负责，不能为验收绕开。

原生 cases 完整且不可缺省：`desktop-workbench-submit`, `desktop-workbench-read`, `desktop-consumer-read`, `mobile390-workbench-read`, `mobile390-consumer-read`, `anonymous`, `no-permission`, `other-member`, `scope-change`, `role-change`, `session-change`, `blur`, `document-hidden`, `unmount`。桌面宽度1440，移动宽度390。首个 case 在真实 `/client/ai` 提交一次并返回 `{case,native:true,runId,status:'queued',...}`；成功读取 cases 返回相同 `runId,status:'succeeded',output:'Synthetic goal completed.'`，其他 cases 返回 `privateContentCleared:true`。始终保存原生截图，关闭后的输出回执不保存私有结果全文，只保留其摘要。每个拒绝/撤权 case 用真实服务器状态；结束后恢复仅本次合成账号的初始登录/角色/范围，供下个 case 使用，不能触碰既有账户。

首个提交 case 的 args 还强制 `withholdFirstSubmitResponse:true,requireExplicitRecoveryGet:true`：自有 fixture host 在真实 API 已接收唯一 POST 后只丢失浏览器响应，原生页面显示原任务未知并锁定；人工点击原有“查回原提交状态”，经真实 GET 恢复原 Run 引用。返回回执必须含 `submissionUnconfirmedObserved:true,recoveryGetObserved:true,postCount:1`。不得调用确认提交或自动重发 POST；从恢复引用取得 queued 的同一 Run ID，再由真实 JobService 执行并正常读取。这样同时验证既有丢回复策略，整个目标始终只有一个 Run/Job/Trace/upstream。

拒绝与撤权 cases 还必须返回实际观测 `apiStatus`：anonymous401、no-permission403、other-member404、scope-change404（当前同一成员拥有的第二个合法 Workspace 读取原空间 Run）、role-change403、session-change401。每个 case 在页面上先清除旧数据再发起显式只读请求并保留 API 拒绝。只清 UI 而没有实际拒绝不合格。

**真实隐藏**须原生切换窗口/标签，使页面确实 `document.hidden === true` 并保存真实观察；调用 `dispatchEvent('visibilitychange')`、失焦截图或覆盖属性均不足。无法取得时记录 NOT_PROVEN 并 FAIL/保留出口待验，不降低门禁。原生文件选择器不属于本只读流程，历史 NOT_PROVEN 不变。

每个 `files` descriptor：`{path,kind,sha256,task:'AF-191',acceptanceId,observedAt}`；path 是仓库相对 `.artifacts/…` 实际普通文件，hash 是实际字节 SHA256，时间在本次开始/结束内。源码 descriptor `{path,kind:'source',sha256}` 由 harness 生成，结束时重新读当前文件验证；包括 API 编译 owner、SDK/contracts 公共入口与工作台当前源码。截图另加 `{case,runId,native:true,viewportWidth}`，kind=`native`，必须实际非空 PNG。

要求的原始 artifact kind 与 JSON 结构如下。结构校验仅为补充完整性检查，真实断言由 harness 对实际 API/PG/SDK/native 返回执行：

- `lease`：复制本新租约 ready ownership 记录的安全元数据，原 `task,id,mode:'test',ready:true,createdAt`，不得只生成一个自称批准的 ID。descriptor acceptanceId 对应 id。
- `http`：`{task,acceptanceId,runId,workspaceId,responses:[{method,path,actor,status,bodySha256}]}`。覆盖唯一 `/client/ai/agents/general-text/runs` POST202、原生显式 `/client/ai/run-requests/…` GET200 恢复原引用、同 Run GET owner200、anonymous401、no-permission403、other-member404；实际 SDK 同样拒绝。所有 Cookie/token/password 只在 RAM，raw response 仅摘要，不能保存私有内容日志。
- `pg`：`{task,acceptanceId,runId,workspaceId,before:{…全0},after:{…全1},...窄归属投影}`，从实际查询及 upstream/HTTP 计数形成；Run/Job/Trace 均须唯一且关联本 project、Workspace、member。
- `package-install`：`{task,acceptanceId,command:'npm install --offline --ignore-scripts --no-audit --no-fund',exitCode:0,packages:consumer.packages,lockSha256:consumer.lockSha256,installedHashes:consumer.installedHashes}`。实际安装记录，不修改生成的 package-lock。
- `package-matrix`：`{task,acceptanceId,matrix:['esm','cjs','esm-types','cjs-types','browser-importmap']}`；前四项是实际 `verifyConsumerModules`，最后一项必须原生页面真实求值成功才记录。
- `packed-sdk` / `packed-contracts`：实际 tgz 字节副本；`installed-sdk` / `installed-contracts`：真实安装的 `dist/index.mjs` 字节副本；`install-lock`：真实生成的 lock 字节副本。复制它们到自有 ignored evidence，以便消费者清理后仍可校验。完整 `installedHashes`、当前 dist graph 与 pack 命令记录亦保留。它们不是源码旁路、包发布或共享 node_modules。
- `native-receipts`：`{task,acceptanceId,driver:'orca-computer',runId,receipts:[{case,native:true,runId,screenshotSha256,...安全观察}]}`，一 case 一个真实 screenshot，不能复用旧 Run/租约或虚构原生 receipt。
- `closed`：`{task,acceptanceId,applicationPools:0,ownedSockets:0,...实际关闭探测}`。harness 自己删除消费者后记录 consumerRemoved，所有这些完成才写 `artifactDirectory/target-proof.json`。

根脚本执行后若真实适配器未实现、lease/源码/产物/包哈希不符、原生截图缺失、目标未达成或清理失败，都必须 FAIL；不要将 Worker18项离线通过、stub adapter、JSON 通过声明或旧 AF142 结果包装成验收。总控完成正式真实验证/质量门禁后再更新队列和执行记录，按任务原名作本地卡片提交；负责人接收仍 PENDING，不自动 push。
