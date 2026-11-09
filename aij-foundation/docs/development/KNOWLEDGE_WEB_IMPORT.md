# AF-179 网页知识初次导入

当前为 Worker 候选，尚非 CODE_VERIFIED。生产 Schema、迁移、模块、bootstrap 和 SDK index 由总控在 Writer STOP 后集成；没有启动可访问的服务地址。

## 接口与所有权

- `POST /api/client/ai/knowledge/documents/import-web`：仅 `{documentCode,title,url}`，复用真实客户会话和 `x-aij-workspace-id` 对应的服务端 WorkspaceContext；要求现有 `knowledgeManage`。代码 2–80 字符沿用小写知识编码规则，标题 1–160 字符且无控制字符，URL 最长 2048 字符，实际 URL/DNS/TLS 决策完全由 AF171 执行。
- `GET /api/client/ai/knowledge/documents/:id/web-source`：相同权限，仅当前 workspace 的未删除网页来源；其他 workspace 返回 404，缺权限返回 403，无会话返回 401。禁止查询参数与 GET body。没有网页来源的旧文档返回 404。
- 写入要求严格同源；两接口成功和所有拒绝路径均须 `Cache-Control: private, no-store`。不接收 workspaceId、状态、正文、快照、resolver、connector、headers、CA、provider 或凭据等额外字段。
- AiKnowledgeService 仍是唯一文档 Writer。网页导入生成 **inactive** 文档，只有用户复核后通过原有 PATCH/status 路径才能进入现有 active 检索；原手动、文件、CSV 的 active 默认、trim 和 checksum 语义不变。
- 只做新文档导入，不覆盖已有 documentCode。409 重试仍可能再次执行网络 GET；没有网络 exactly-once、自动更新、304 缓存、历史、embedding、索引、UI 或异步运行/计费/通知/支付写入。

网络前的短事务核验插件生命周期、项目/组织、成员状态/角色/权限和已验证会话。网络及真实 AF174 解析在事务之外执行；网络后复用原文档写入事务，并在创建前再次取得 AF138 共享锁与行锁、核验上述条件。会员 tokenVersion、会话撤销/过期、角色授权、workspace 和项目/组织失效均可拒绝最终写入。文档、四个来源字段与 ID/status 审计同事务；审计失败全部回滚。PG 的真实阻塞/撤销行为由总控实测。

网页正文不截断，超过 64KiB 整体拒绝。保留 AF174 规范化文本的前导表格 TAB，`sourceTextChecksum` 对应 **精确持久化正文**；原文件和手动内容继续 trim。来源字段：

| 字段 | 值 |
| --- | --- |
| sourceUrl | 规范化的原始请求 URI，保留 query，只在受限元数据接口返回 |
| sourceFinalUrl | AF171 实际抓取的规范化最终 URI |
| sourceChecksum | 原始响应 bytes 的 SHA-256，复用旧字段 |
| sourceFilename | 固定 `web-import`，复用旧字段 |
| sourceTextChecksum | 导入时精确正文的 SHA-256 |
| sourceExtractionVersion | 固定真实策略 `aij-knowledge-web-text/1` |

元数据响应仅包含 documentId、上述六个来源值和 `contentMatchesSource`。该布尔值每次对当前正文重新求哈希；后续人工编辑会变为 false，不重置来源或覆盖修改。不存储 raw HTML、headers 或原 bytes；普通创建/list/PATCH 响应的显式 select 不含来源 URI；网页审计只含原有 ID/status 与 correlationId，不含 URL、正文或哈希。

## 总控集成约束

1. 先完成真实 I177，再精确集成候选提交。bootstrap 提交只是经核验同仓源码快照，不等于依赖卡的正式集成。
2. 将 [四字段片段](../execution/AF-179-schema.prisma) 加入现有 AiKnowledgeDocument，按 [SQL 提案](../execution/AF-179-migration.sql) 新建 additive migration；旧行四字段全 null，旧默认/关系/迁移不改。SQL 检查 complete-together、URL 长度/形状、hash、marker、policy 和现有 status，不把 SQL 当成 SSRF 验证。不约束可修改正文与 import-time hash 始终相等。
3. root 校验独立测试库目标后生成真实 Prisma client，并执行实际 API 编译。Worker 仅使用 `.artifacts/af179/client`，没有生产 client 变更，也没有 `any` / `as unknown` 掩盖新增模型字段。
4. 默认服务可通过可选 token 的构造参数默认值组合真实 reader/parser；若在模块显式注册，使用 `KNOWLEDGE_WEB_IMPORT_TRANSPORT -> new KnowledgeWebImportTransport()`。测试 override 必须仅在 test/test 环境的可信应用组合入口注入同一 token，不能暴露为 HTTP 字段或环境驱动的生产 reader 绕过。root live suite 要求 `app.get(token) === transport`，禁止 monkey patch 业务服务。
5. root 给 SDK index 增加 `export * from "./knowledge-web-imports.js";`，运行真实 SDK build/pack 并校验 ESM/CJS/types。工厂为 `createKnowledgeWebImportsClient(actualClientApi)`，方法为 `importWeb(workspaceId,input)` 与 `getWebSource(workspaceId,documentId)`；复用实际 ClientApi 的 cookie、Workspace header、no-store 行为，每次只发一个请求，没有重试。
6. root 接入本卡导出的早期 middleware。顺序必须覆盖 CORS、JSON 解析及五类 guard 的失败：先 `knowledgeWebImportPrivateMiddleware`，再 CORS、body parsers，再 `knowledgeWebImportParserErrorMiddleware`，然后原有路由/guard。保留 rawBody 需求和原 parser 行为。方法上的 exception filter 可规范化路由/guard/DTO/业务错误，但无法独自覆盖 Nest 默认 parser 之前的 400/413。

本地已核对 Nest 11.1.19 的 `NestExpressApplication.useBodyParser` 实现。root 可采用 `NestFactory.create<NestExpressApplication>(..., {rawBody:true,bodyParser:false})`，先装 private middleware/CORS，再 `app.useBodyParser('json')` 与 `app.useBodyParser('urlencoded',{extended:true})`，紧跟 parser-error middleware，避免 init 时自动 parser 抢先执行。必须实际验证无会话、坏 JSON、超限 JSON、插件禁用及权限拒绝均 private/no-store；不能仅检查装饰器。既有 API 的 parser 限制与错误路径须回归。

## 无数据库验证

在独立 worktree frozen 安装后先构建小包：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @aij/contracts build
pnpm --filter @aij/runtime-contracts build
pnpm --filter @aij/core build
pnpm --filter @aij/sdk build
node --test scripts/verification/knowledge-web-import.test.mjs
```

该测试只在 ignored `.artifacts/af179` 合并 schema 提案、生成 scratch client，使用清洁编译环境和 port 1 的合成 DSN，不连库、不修改生产 schema/client。覆盖真实服务/DTO/parser/reader 源码、目标 noEmit、编译后的新增 SDK 模块 ESM/CJS/types 与现有实际 ClientApi。事务 double 只证明参数、顺序、失败原子性，不证明 PostgreSQL 行锁；成功网络输入是明确的 synthetic transport，不声称验证默认 TLS。默认真实 reader 另直接验证非法/private literal URI 拒绝，以及 synthetic private DNS 在 connect 前拒绝。

## root-only 真实验收

[live suite](../../scripts/verification/knowledge-web-import-live.test.mjs) 只能由 root 执行，Worker **NOT_RUN**。它创建并清理自有临时证书/HTTPS listener，通过 trusted reader connect seam 仅连接该 listener；保留实际 AF171 HTTPS/TLS/解析/边界逻辑及实际 AF174 parser。此 seam 的信任 CA 只用于自有 HTTPS 验收，不是生产默认 CA 的证明；默认 reader 的非法/private URI 拒绝在同套实际编译产物上另测，AF171 的真实默认 DNS/TLS 证据继续适用。

root 在 `.artifacts/af179/live-adapter.mjs` 导出 `createFixture({transport,transportToken})`，注册新 AF-179 任务及 DB/fixture guards、创建 fresh AF179 隔离测试库与实际构建 API，并在应用创建前注入 transport token。返回值须包括：

- `lease.task === 'AF-179'`、`app`、`prisma`、`project`（实际 ProjectProfile）、`baseUrl`（loopback `/api`）、`workspaces[alpha,beta]`、`cookies[alpha,beta]`、`accounts[alpha,beta]`。
- 拥有实际插件管理权限的 `operatorId`，使 suite 直接调用实际 `PluginLifecycleService.disable/enable`。
- `withAuditFailure(action)`：在隔离 PG 安装只拒绝本测试知识审计的临时 trigger，执行 action，并 finally 移除 trigger/function；不得用 stub/audit mock 代替真实 rollback。
- `close()`：关闭真实 API/数据库资源；`assertClosed()`：证明该 acceptance 的 API sockets、PG pools/connections 为 0（suite 自己另外证明 owned TLS sockets 为 0）。

```sh
AIJ_AF179_LIVE_ADAPTER=.artifacts/af179/live-adapter.mjs node --test scripts/verification/knowledge-web-import-live.test.mjs
```

缺少 adapter 会明确失败，不能 SKIP/PASS。suite 覆盖 inactive 精确导入/原子审计、检索与既有显式激活、来源权限/foreign/readonly、重复码、严格 DTO/query、anonymous/origin、坏 JSON/413 隐私、private redirect/redirect cap/body limits/UTF8/parse/实际 TLS failure 零写入、自有 HTTPS hold 期间会员/会话/角色/授权/workspace/项目/组织失效及实际插件禁用后零写入、真实审计 rollback、人工修改 mismatch、实际公开 SDK 两模块条件/声明与资源清理。

root 还需运行已注册 `verify:task AF-179`、现有 CSV/文件/knowledge lifecycle 真实成功/拒绝回归、实际 Schema/client/API 构建、打包 SDK/types 消费检查、I177 质量门禁及自查/PR review，更新正式执行记录/队列并按原名提交。该候选不提供 UI，不启动页面；人工验收在实际服务运行后先导入 inactive，查看受限元数据，再用原 PATCH 激活，修改正文后确认 mismatch。批次出口仍为 OWNER_CHECK_PENDING。


## Root技术结果

`.artifacts/verification/AF-179/run-BROWuA/report.json` PASS：13/92/51/66/packed4/真实网页9/旧CSV31/原知识锁23、Schema/generate/SDK/API/workspace types/lint全部通过。认证最终围栏已移至ClientAuthService唯一owner并增加namespace/时间/token-version持有HTTPS拒绝（共13模式）；Workspace SDK保留共享含UUID标识契约。生产默认transport模块与显式test-only seam已接线，inactive不自动发布/更新，四来源字段和审计原子。真宿主/API/TLS/pool0、证书及审计trigger清理，原失败保留。前述Worker NOT_RUN是历史阶段事实，不能反填；实际范围与限制以[执行记录](../execution/AF-179.md)为准，owner仍PENDING。
