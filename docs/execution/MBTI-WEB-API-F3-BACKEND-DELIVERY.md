# F3 后端候选交付

2026-11-09，Run `run_594d408d15de`，Task `task_a9c6a2af5905`，Dispatch `ctx_f0a372b66e02`。仅后端候选；前端由总控另派 Web Writer 验收。

## 基线、候选与范围

- 工作树 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f3`，分支 `weiyang86/mbti-web-api-f3`。
- 实际基线 `777a5ea1c4229f6540582345827a316d90afd6fe`，已含集成 F2；PR20 参考固定为 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`，题库仍为 `qb-v0.4-prototype-1`。
- 实现、内部候选、样例及去敏 HTTP 回执提交：`ccc82db1a2a22bfceae6bae563ce6e19b1ac92a8`。本交接文档为后续独立提交，完整交付 HEAD 见 worker_done。
- 输入包 `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane`；已读 RUNBOOK、API-REVIEW，以及根/web/Foundation 的 AGENTS。
- 变更仅为 Foundation MBTI 订单/权益业务模块、附加迁移、路由注册、项目测试/运行工具、`docs/integration/MBTI-F3-candidate.openapi.yaml` 与 `.examples.json`、`docs/execution/MBTI-F3-http-evidence.json` 及本记录。
- 没有改 `web/`、`UIhtml/`、权威 `docs/api/`，没有 push/merge/main 操作，没有真实外部收费、微信登录或模型生成。
- 候选全部为内部 `needs_human_review`，不代表正式发布。990/1990 分来自 PR20 的受控测试 fixture，不是生产商业定价；目录第一项可创建测试 pending 单，第二项不可售。

## 运行与数据库边界

测试 API 保持运行：`http://192.168.0.200:4156/api/v1`（同机 `http://127.0.0.1:4156/api/v1`）。宿主 `/api/ready` 200/READY；精确 CORS 源为 `http://127.0.0.1:4155`、`http://192.168.0.200:4155`。两者订单浏览器预检均 204、ACAO 对应原源、ACAH 含 `content-type,x-guest-token,idempotency-key`；未批准源无 ACAO。

秘密配置及 PostgreSQL owner 仍为 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`。本树独立 `pnpm install`、Prisma client 和构建，没有链接其他仓/树依赖。每次迁移与 fixture 前由 `MBTI_LOCAL_OWNER_ROOT`、同 Git common-dir、项目 package、容器 label/volume、实际数据库角色及 marker 核验归属；只迁移 `127.0.0.1:55437/mbti_foundation_test`，没有改 dev 55436 schema 或替换 4056/5173。

切换和重启 4156 均已提前通过 Run 中转总控；F3 测试 fixture 额外启用现有 Foundation Auth/RBAC，随机 JWT secret、回调 secret 与三个本项目非超级管理员测试身份仅存在本树忽略的 `.artifacts/mbti-f3-test-fixture.json`（0600）。没有共享公开 ops token，前端不持有运营凭证；原 owner `.env` 没有被改为测试认证配置。

## 五项真实 HTTP 结果

以下均共同前缀 `/api/v1`；回执在 `MBTI-F3-http-evidence.json`，仅包含本脚本创建的合成数据，游客/JWT/签名/密码均去敏。

| 操作 | 成功与拒绝证据 |
| --- | --- |
| #47 GET /products | 200 `{items:[...]}`；code/name/description/amount（分）/currency/saleable/pricing_mode/highlights/tier 来自服务端；tier2 含不可售原因；缺失、非法、过期游客 401 |
| #48 POST /orders | 201，且同 key 重放仍 201 原单；只接受 result_id/product_code；服务端冻结归属、商品、金额、币种；客户端注入 amount/currency/status/unlocked/owner/paid_at 均 422；缺失/非法 key 422，不可售或未知 SKU 409，他人/不存在结果 404 |
| #49 GET /orders | 200 `{items:Order[],next_cursor}`；新游客空数组；只列本人、时间/id 倒序；分页可连续读取，无效/跨人 cursor、limit 越界及重复参数 422 |
| #50 GET /orders/{id} | 200 `{order_id,status,unlocked,payment_availability,paid_at?}`；order_id 就是创建与运营读取的持久 id；他人/不存在订单 404，缺失/非法/过期游客 401 |
| #53 GET /entitlements/me | 未支付时 200 `{items:[]}`；仅验证成功的测试 charge 产生 scope=controlled_test 的一项；另一游客空列表；非法/过期游客 401 |

普通下单真实状态为 `pending`、`unlocked=false`、`payment_availability=unconfigured`，没有 `pay_params` 或 `paid_at`。没有定时器假支付、mock 解锁或客户端缓存账本。

幂等唯一键为游客 + SHA256(Idempotency-Key)，持久化规范化 result_id/product_code 指纹；事务 advisory lock 与数据库唯一约束共同保证首次六个并发请求只落一单。同 key 异意图并发得到 201+409，之后仍确定 409；另一游客可独立使用同 key。原始重试 key 不存库、不转发渠道。

`MbtiOrder` 保存业务购买快照；`id` 是持久业务订单号。`resultId` 是保留的原始引用，故意没有结果级联外键；F2 删除本人结果后仍能查询、运营读取和重放已有订单，新购买同一已删结果 404。金融快照/终态与权益事实有数据库不可变约束，不能通过结果删除级联丢失。

## 受限运营同号链路

独立内部入口：`GET /api/admin/mbti/orders/{id}`，权限 `mbti:orders:read`。采用原有 Foundation `AuthService` 登录、持久 admin session、`JwtAuthGuard`、`PermissionsGuard` 与现有全局管理员 guard；每次查当前角色/权限，没有另一套认证或权限系统。仅返回同一 Order 安全投影，无游客身份、凭证或渠道秘密；读取会从已验证的 Foundation 事实修复延迟业务投影，不接受运营传入金额/支付状态。

最近一轮同号同金额两份独立真实 HTTP 回执：

- `POST /api/v1/orders` → 201，`id=MBTI-0c039665-5766-4216-b703-6b2525c633fb`、`amount=990`、`currency=CNY`。
- `GET /api/admin/mbti/orders/MBTI-0c039665-5766-4216-b703-6b2525c633fb` → 200，完全相同的 id/amount/currency 与订单投影。

Foundation 非超级管理员 ops 角色允许 200；无凭证、普通 X-Guest-Token 或将游客凭证当 Bearer 均 401；已登录但无权限角色 403。已发出的 ops 会话在其角色临时禁用后也被 403 拒绝（finally 恢复本脚本 fixture 角色）；不存在单号 404。以上均为 HTTP 证据，SQL 仅补充验证落库唯一性。

ops 路由仅在显式启用 Foundation 管理认证时注册；部署环境若仍关闭 AUTH，不会出现无鉴权运营读入口。dev 的真实管理员配置/角色由总控接入现有安全配置，测试随机身份不搬到开发或生产。

## 支付复用与明确未验项

只在 `NODE_ENV=test`、`APP_ENV=test`、启用现有 Auth 且显式加载本地随机测试 secret 时注册受控通道。`POST /api/admin/mbti/test-payments/{id}` 还要求独立 `mbti:payments:test` 权限；普通只读 ops、游客和无权限管理员不能初始化。该入口是测试协议工具，独立于只读运营查询和五项用户接口，不用于前端接线。

复用 `plugins/aij-payment` 原有 `PaymentService`、`PaymentCallbackService`、`SyntheticTestPaymentProvider`、raw-byte HMAC 验签、时间窗、订单状态机以及唯一 `payment_order/attempt/callback_event/transaction` 账本；没有复制支付交易账本。受控 payable source 只解析服务端冻结的 MBTI 单价/币种/归属，底座所需 member/workspace 是内部 test-only 账本 fixture，**不是游客绑定可找回账号**。底座渠道 orderNo 是内部适配标识；MBTI 对外持久业务号始终是 create/status/ops 中同一个 Order.id，并由底座 payableReference 关联。

实际 HTTP `POST /api/v1/payments/controlled-test/callback` 结果：

- 无效签名、过期签名 401；错误订单号 404；金额差 1 分、币种错误 409，订单仍 pending、权益仍空。
- 同一已验事件五个并发请求得到一次 200、四次 409；重放 409；Foundation 仅一条 charge，业务仅一份权益，真实用户接口可读到 `paid/unlocked=true/payment_availability=controlled_test` 和 `scope=controlled_test`。
- 已验证失败回调 200 后，本人状态为 failed/unlocked=false、无 paid_at，未发权益；已失败或已支付单的反向终态回调 409。
- 只有匹配的 succeeded Foundation charge 才能将业务订单标 paid；权益写入与业务 paid 投影在同一事务，orderId 唯一，读时可修复 callback 提交后进程中断的投影窗口。

**blocked_external / needs_human_review：**真实支付渠道的商户/App 配置、渠道密钥/证书及 SecretRef owner 解析和真实渠道适配未提供，未进行真实或外部沙箱收费；当前通过的是明确的离线受控协议适配测试。生产商业 SKU/价格/交付承诺、售后、可找回账号与游客绑定/权益归属均未定；跨设备恢复及真实收费前必须闭合这些依赖。未调用微信登录、生成模型、照片/视频交付或篡改已有支付账本；可以交回就绪 F4，不等待外部支付凭证。

## 检查命令与退出码

下表 Foundation 命令 cwd 为本树 `aij-foundation/`，数据库相关命令均设置 `MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`。

| 实际命令 | 退出码、结果 |
| --- | --- |
| pnpm install --frozen-lockfile --ignore-scripts | 0；本树独立依赖，Node 24.21.0 / pnpm 10.0.0 |
| pnpm --filter @aij/api prisma:generate | 0；仅本树 schema 编译，无 DB 连接 |
| pnpm -r --filter './packages/**' build | 0 |
| pnpm --filter @aij/api typecheck | 0，应用及现有 test TypeScript 均通过 |
| pnpm --filter @aij/api build | 0 |
| node scripts/mbti-local.mjs check test | 0；同项目 test DB/容器/marker/实际角色 verified |
| node scripts/mbti-local.mjs migrate test | 0；仅 20261109120000_mbti_f3_orders 附加迁移 |
| node scripts/mbti/seed-f3-test.mjs | 0；随机非超级管理员、既有 RBAC grants，秘密保持忽略 |
| node scripts/mbti/verify-f3.mjs prepare-restart | 0；初轮 108 项；pending 同号 MBTI-e8e2c7c7-a1f4-43c6-983c-5e6a6002e007 |
| node scripts/mbti-local.mjs stop test / 同配置 start test | 均 0；提前通知总控后短重启；4156 恢复 READY |
| node scripts/mbti/verify-f3.mjs verify-restart | 0；9 项跨进程持久性，原 key 重放、已删结果账目、同金额运营读取、已验权益、另一游客404 |
| node scripts/mbti/verify-f3.mjs | 0；补充失败终态/禁止逆转/过期游客/去敏回调回执后，共121项；对应提交中的最新HTTP回执 |
| python3 输入包/smoke.py --base http://192.168.0.200:4156/api/v1 --phase F2 | 0；A结果 a8328ffd-97cd-4576-8955-8cd4c0b3ceb5 / 40271946-fc39-43ca-9a90-8d99e54a476f，B读取404，含F1 |
| node scripts/mbti/verify-f2.mjs | 0；64项，真实三场景SVG、跨版本/隐私/存储拒绝重试/删除撤销均通过 |
| node scripts/mbti/verify-f1.mjs | 0；46项游客摘要、过期/非法401、A/B404、计分、提交锁与不可变约束 |
| pnpm --filter @aij/api test | 0；现有79/79通过 |
| node --check 项目运行/fixture/HTTP脚本 | 0 |
| 候选 YAML/JSON 解析及样例必填字段核对 | 0；系统Python无PyYAML（首尝试1），改用本树锁定js-yaml完成；五项操作、字段与样例均通过 |
| git diff --cached --check 与精确暂存/实际秘密字串检查 | 0；未暂存.env、凭证、依赖、产物、日志、用户数据、._*或其他Writer目录 |

Git 既有 AppleDouble `._pack...idx` non-monotonic-index 警告未改动共享对象库；相关 Git 操作实际退出0。测试仅创建本轮合成业务/安全fixture数据，短暂禁用本fixture角色后已恢复，没有删除/重写历史账本。

## 保持服务与恢复

4156 运行本树构建，后台进程由 owner 的忽略 api.json 管理；4155 H5 属于并行 Web Writer。重启先通知总控及4155使用方；在本树 Foundation 目录执行：

```sh
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
export MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4156
export MBTI_H5_ORIGINS='["http://127.0.0.1:4155","http://192.168.0.200:4155"]'
export MBTI_F3_TEST_FIXTURE=1
node scripts/mbti-local.mjs check test
node scripts/mbti-local.mjs stop test
node scripts/mbti-local.mjs start test
node scripts/mbti/verify-f3.mjs verify-restart
```

从新集成树运行时须先本树安装依赖/Prisma生成/构建，再在该树执行 `seed-f3-test.mjs` 创建其自己的0600 fixture，不能链接依赖或复制展示秘密；不要同时启动第二个4156或迁移dev。`verify-restart` 的本次状态属于F3树 `.artifacts/mbti-f3-restart.json`，切树后要用原F3脚本核验本次保存状态（重新prepare-restart会创建新合成状态）。

待总控：集成该后端候选与Web消费者到dev，按安全项目配置接入管理员认证/授权后复验，再由总控部署。Worker没有完成dev迁移/部署、实习生另一台物理设备或H5页面验收；本机LAN的真实HTTP已通过，H5证据由Web Writer提供。保留owner工作树、测试卷、运行配置和忽略fixture，不删库、不停已交付开发服务。

## Web 实单运营补证

后续 Task `task_5672a0c22747` / Dispatch `ctx_570f21fa3109` 已用 Web 实际创建的 `MBTI-3f4a78f2-1e80-4871-9ea4-478944f33df7` 补齐现有Foundation运营同号990CNY的HTTP200和401/403拒绝，不再仅以本后端脚本另建订单代表Web同号链路。详见 [Web实单运营补证与dev准备](MBTI-F3-WEB-ORDER-OPS-ADDENDUM.md)、[去敏回执](MBTI-F3-Web-order-ops-http.json)；dev4056只读检查证实尚无管理员、JWT配置或F3迁移，具体准备流程/内部阻塞与NOT_RUN项均单列，未移用test凭证或重启服务。
