# AF-141 root-only 真实验收脚本补充候选

本报告保留 c7fcf138 时点；当前 live 扩为 16 场景（新增字面身份及 revoke 在途屏障），改动/NOT_RUN 与预算见 [审核修订候选](AF-141-review-fix-candidate.md)，不以本报告旧 14 场景描述替代当前脚本。

## 派工与边界

- 原 Worktree `ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W02-AF141`，instance `5792afff-920f-4e12-8064-c906d96417a3`；分支 `weiyang86/AIJ-W02-AF141`。
- 本轮 Task `task_bb1f948d6e8b` / Dispatch `ctx_3ec0d81725b7` / terminal `term_679a2baa-8009-4389-ad16-d9ce18d2650f`；起点 `f5827478adcda79a0821e0ae9a281e8db6503e63`，干净，origin fetch/push 为 `git@github.com:weiyang86/aij-foundation.git`。
- 原卡起点仍是 `origin/dev@94b0236f775fa40a07944c5e0545ac6ce0e123f3`；未切分支。root 当前只完成 AF138/143 集成，未应用原候选，所有产品代码只读。
- 新增 `scripts/verification/client-username-login-live.test.mjs` 与本报告，原报告只增加补充链接；最终从原卡起点累计七个路径。
- 原卡 1.25h 估计保持；本补充预算 1h。有效工程工时估计：核对/helper 审阅 0.10h，脚本实现与自查 0.25h，检查/报告/候选交接 0.10h，共 0.45h；累计 1.70h，原卡 3h 中约余 1.30h 留 root 正式验收（不是墙钟或计费测量）。root 仍独占数据库、helper allowlist、registry、正式验收和队列。

## 交付与验证状态

新增一个 root-only Node 测试，14 个真实场景。复用 `createRemainingClientFixture('AF-141')` 创建新的独立随机 lease，不调用其他 AF 的旧 lease；使用本次合成账号的既有忽略凭据文件。每个场景经过真实 HTTP 调用实际 Controller/DTO/Service/Guard，再读取实际 PostgreSQL 数据，不替换认证方法或 Prisma 查询。

**真实 HTTP/PostgreSQL、并发、故障注入、关闭池检查全部 NOT_RUN；浏览器 NOT_RUN。** 本 Worker 未运行该脚本、DB/服务/build/Docker/seed/migrate/厂商/通知，也没有创建 live 证据 JSON 或可宣称已运行的服务地址。之前原候选纯测试 45/45 记录保持，不用它冒充此次真实验收结果。

| Worker 实际检查 | 退出 | 结果 |
| --- | --- | --- |
| `node --check scripts/verification/client-username-login-live.test.mjs` | 0 | 仅语法解析，不导入/执行测试。 |
| `pnpm exec eslint scripts/verification/client-username-login-live.test.mjs --max-warnings=0` | 0 | 定向 lint 无诊断。 |
| `git diff --check` | 0 | 无空白错误。 |
| `git diff --exit-code f5827478adcda79a0821e0ae9a281e8db6503e63 -- apps/api/src/client-auth/dto.ts apps/api/src/client-auth/client-auth.service.ts apps/web/app/components/client-workspaces.tsx scripts/verification/client-username-login.test.mjs` | 0 | 本轮产品实现和原纯测试未变；原候选报告仅新增补充链接。 |

首次语法检查退出 1，定位到 namespace 反例断言多余右括号；已改为明确的 foreign namespace HMAC key 列表并重查通过。没有发现必须修改产品代码的静态缺口；真实运行可能发现的故障仍由 root 执行后按同 Writer 流程退回，不预先声称已验证。

## root 集成前置与执行

本工作区从原基线到最终候选累计七路径：原五路径加上述新脚本与本报告。仅本轮三个文档/脚本差异作补充本地提交；提交标题沿用原卡逐字名称「支持客户端用户名密码登录并保留邮箱兼容」，最终 SHA 以 `git log -1` / worker_done 为准。root 可对七路径完整树精确集成，不引入子工作区环境、凭据或 node_modules。

root 须先按本卡授权登记 `AF-141`，未登记时不能借其他 AF 兜底。基线中涉及以下已有保护（由 root 改，Worker 未写）：

- `scripts/database/migration.mjs`：createAcceptance task allowlist。
- `scripts/runtime-environment.cjs`：acceptanceRecord task allowlist / schema snapshot 校验。
- `scripts/database/seed.mjs`：本卡 lease Seed allowlist。
- `scripts/verification/auth-support.mjs`：authKeys / authEnvironment 的三个 allowlist。
- `scripts/verification/client-auth-fixture.mjs`：prepareClientFixture allowlist。
- 正式 `registry` / 队列 / `verify:task` 由 root 管理。脚本直接复用受保护 `withDatabase/readDatabaseEnvironment/acceptanceRecord` 检查 pool0，不需要绕过保护或扩展其他 AF 的 lease。

完成产品七路径集成与以上登记，root 独占数据库/重构建窗口，构建当前 API 后才执行：

```sh
cd /Volumes/Lexar/日常工作/2026/aij底座/aij-foundation
AIJ_AF141_LIVE=1 node --test --test-concurrency=1 scripts/verification/client-username-login-live.test.mjs
```

脚本同时校验 cwd/repositoryRoot 必须等于上述主工作区，以及显式 opt-in。绑定 OS 分配的 loopback 端口；HTTP Origin 用应用真实 webUrl，未启动 Web 或声称生产 TLS/跨产品部署已通过。现有 helper 启用 aij-ai 的离线前置配置，但本脚本不调用 AI、通知或外部厂商端点。

root 运行时会在自身 `.artifacts/auto-ai-program-20261105/AF-141/live-<随机 UUID>.json` 持续写入 0600 的安全聚合证据，初始 14 场景均 `NOT_RUN`，逐场景更新 PASS/FAILED；前置或某场景失败后，后续场景保持 NOT_RUN/skip，不掩盖失败。文件只含 task/随机 lease ID、场景名、固定失败阶段、计数/布尔及清理结果，不序列化身份原文、Cookie/JWT、密码、数据库 URL 或原始 driver 错误。失败响应同样检查不得包含上述原文，成功响应仅校验安全 member 和 Cookie，Cookie 仅内存使用。

## 14 场景及必须成立的断言（目前全部 NOT_RUN）

| 场景 | root 运行时的实际断言 |
| --- | --- |
| success-and-cookie | 用户名/邮箱同账号各 200，大小写与 trim；真实 host-only HttpOnly/SameSite/Path/Max-Age Cookie，签名 issuer/audience/身份/时长，真实 `/me`，两条绑定 namespace 的 session 及 IP/设备 HMAC。 |
| dto-rejections | 缺字段、混填（含 null/空串）、单 null/空白、未知字段、UTF-8 字节超 72：9 个 400，无 Cookie/session/bucket。 |
| origin-rejections | 缺 Origin（空头）、错误 Origin、Sec-Fetch-Site cross-site：3 个真实 403，无 Cookie/session。 |
| uniform-credentials | 已知用户名/邮箱错密码及未知用户名/邮箱 4 个 401，公共 body 完全一致，无 Cookie/session。 |
| disabled | 同一合成账号停用后两种身份各 401，无 Cookie/session，finally 恢复原状态。 |
| pending-verification | pending_verification + emailVerifiedAt=null，两种身份各 401；保持原 active 存量验证兼容契约，不追溯添加产品验证门槛。 |
| soft-deleted | 软删后两种身份各 401，无 Cookie/session，finally 恢复原值。 |
| duplicate-username | 真库插入第二条大小写等价 username，先 active、再 disabled、再软删；每次 401，拒绝任选 owner；finally 仅删除本测试新建的随机 ID。 |
| duplicate-email | 同上，但真实等价 email；不依赖内存 fake/collation 推测。 |
| shared-account-budget | 两身份交替失败五次，账号桶计数恰为 5，第六次正确密码仍 429；四个桶精确属于本次 HMAC/namespace，反例 namespace 不命中；只推进窗口时间并保留计数，恢复登录后 identity/account=0、IP=1。 |
| concurrent-budget | 同账号两身份八个真实并发错误登录，allSettled 回收全部请求；恰五个 401、三个 429，账号计数恰为 5，无 Cookie/session。 |
| session-boundaries | 错 Cookie 名、真实 session namespace 改动、正确密钥但 foreign audience、tokenVersion 增量均 401；finally 恢复前置后真实 logout 200、过期 Cookie、旧 Cookie 下一请求 401。不是跨产品部署验收。 |
| audit-rollback | 本随机合成库添加 NOT VALID CHECK 约束仅拒绝 client-auth/login 审计 INSERT，真实登录 503 无 Cookie；finally 移除约束，session 数/lastLoginAt/success audit 全回滚，账号尝试未被成功重置，再邮箱登录 200 恢复。 |
| redacted-storage | 真库最小审计动作存在，AuditLog/Session/RateBucket 中无两账号原始身份、密码、完整 token、IP/UA 或 bcrypt hash，rate key 为 64 位 HMAC。 |

场景边界前仅删除本独立新库中明确属于本次两账号/未知合成身份/loopback IP 的 login identity/account/IP HMAC 桶。若发现未认识的 login 桶直接失败，不做宽泛清理；不清其他 scope。限流场景内部没有清桶，仅共享额度场景推进 windowStartedAt/blockedUntil 后验证计数仍为 5。helper 初始登录属于前置，首场景会明确重置相同的本次合成桶。

## 故障、资源与失败处理

唯一 runtime hook 包裹当前已构建 bootstrap 的 createApplication 原函数以记录应用引用，便于 helper 在初始化后抛错时仍关闭应用；不改磁盘产品代码、不替换 Service/Guard/Prisma 行为，finally 恢复原函数。所有自有 HTTP Promise 跟踪并带 15s 超时，并发用 allSettled，finally 再收敛在途请求。

约束名由固定前缀加随机 hex 构造，仅通过受保护的新 AF-141 lease 执行；局部 finally 与总 finally 都回收，移除失败会使结果 FAILED。无 trigger/function、reset/drop database、旧库清理或用户数据删除；仅本测试创建的重复身份在局部 finally 删除，原状态和 session namespace/version 改动均有 finally 恢复。

总 finally 恢复 hook，等待请求，移除故障，关闭捕获的应用及 Prisma，恢复原进程环境，再以受保护独立连接检查该 lease `pg_stat_activity` 的 `aij-api:%` 会话数为零；withDatabase 自行关闭此检查连接。任何清理失败都记录 FAILED，不把 app.close 等同 pool0；helper 未返回时只从其新环境识别 task 正确的新 lease，没有旧库回退。初始化失败若尚未建立 lease，pool0 检查无法验证也会标为失败。

后续仍须 root 正式 verify:task/质量门禁和真实浏览器两种登录方式、错误提示、切换清空及已有会话/退出矩阵；本候选不声称浏览器结果、CODE_VERIFIED 或负责人接收。预算不足或真实缺口由 root 返回具体证据拆卡/修订，不放宽断言。

本轮候选提交后明确停止全部写入，worker_done 后可由 root 接管精确集成；未 push/merge/PR/main/tag/部署，负责人接收保持 PENDING。
