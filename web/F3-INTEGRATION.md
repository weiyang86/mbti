# F3 Web 候选接线与联调

2026-11-09，Run `run_594d408d15de`，Task `task_f5cd29bae48e`，Dispatch `ctx_3446d2ba1a1f`。基线 `777a5ea1c4229f6540582345827a316d90afd6fe` 已含 F1/F2；只读参考 PR20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`。本文件是内部候选联调记录，`needs_human_review`，不是正式发布或权威契约。

## 范围与字段依据

- 只改 `web/` 的必要封装、入口、消费者与本记录。未整合 PR20 全部商业页面，保留 dev 的页面、颜色和按钮样式；未改后端、Prisma、根 `docs/api/`、数据库或交付 4056/5173。
- 总控同步的字段依据为后端树 `docs/integration/MBTI-F3-candidate.openapi.yaml` 与 `MBTI-F3-candidate.examples.json`，版本 `0.4.0-f3-candidate.1`。候选文件由后端 Writer 持有，前端未定稿或复制正式契约。
- PR20 的 `constants/payment.ts`、pricing/unlock 使用本地 990/1990、1000 补差与 `studio.tier`；其 payment mock 本地订单和自动 paid 状态不能用于本轮验收。本实现全部从服务端目录读金额（分）、币种、可售状态；不计算本地升级价，不读旧订单或 studio 解锁缓存。
- `GET /products` 在商品目录与确认页消费；`POST /orders` 在确认页只发 `result_id/product_code` 与 `Idempotency-Key`；`GET /orders/{id}` 在同号状态页消费；`GET /orders` 与 `GET /entitlements/me` 在本人记录页独立消费。列表支持服务端 `next_cursor`。
- 商品与订单明确显示受控测试价格；不可售 SKU 禁用下单。确认页先读本人结果和服务端目录，创建 pending 后展示持久 `id`，状态页读取 `order_id/status/unlocked/payment_availability`，本人列表显示服务端冻结金额/币种。未配置通道时明确不可支付；不调 `requestPayment`，不写本地 paid/unlocked，也不把订单状态替代服务端权益。
- 购买意图按 API 基址、当前游客、结果、商品绑定；只持久化请求意图，不缓存订单或权益。网络失败、刷新和同意图重试沿用原键；改变结果/商品后进入确认页或更换身份会创建新键；存储失败阻止 POST。键可在非安全 HTTP 上用 `crypto.getRandomValues` 生成，无 crypto 时有非鉴权唯一键后备；符合候选 16–128 位字母数字/下划线/连字符限制。
- 五项接口使用 F1 的同一独立游客客户端；并发首访共享领号，401 保留失效身份、不换号、不重放。订单与权益读取错误分别显示失败，不能将请求失败显示为“空列表成功”。

## 启动及恢复

总控已停止前轮 H5 并授权本树占用 4155。当前临时 H5 由 Orca terminal `term_6078fbe2-c933-4bbf-bf6e-8d5145c80e5f` 运行，基址固定测试 4156，Mock 关闭。

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-f3-web/web
npm ci
VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run dev:h5 -- --host 127.0.0.1 --port 4155 --strictPort
```

精确访问 `http://127.0.0.1:4155/#/`。后端 4156/test55437 的切换与重启只由后端 owner/总控处理，本 Worker 未操作其配置/依赖/数据库或旧 API 进程。集成后从集成树用最终 API 基址构建、复验，再由总控切换已交付 H5；本候选不操作 main，不 push/merge。

## 本地检查

| 命令 | 结果 |
| --- | --- |
| `npm ci` | 退出 0，本树独立依赖 |
| 基线 `npm run test:api` / `npm run type-check` / 真实配置 `npm run build:h5` | 均退出 0；原 15 项请求测试 |
| 候选 `npm run test:api` | 退出 0，22 项；覆盖丢失响应后刷新重试键、允许字段、结果/商品/身份更换、并发意图、持久化失败、401 不重放、四个读取请求的共享身份/路径、404/409/422/503 不回退及非安全环境键格式 |
| 候选 `npm run type-check` | 退出 0 |
| `VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run build:h5` | 退出 0 |
| `git diff --check` | 退出 0 |

锁文件已有 75 项 npm 审计提示与 Sass 弃用提示，本轮未升级依赖。Git 读取时输出共享对象库 `._pack-*.idx` 的既存 non-monotonic index 诊断，本 Worker 未修改共享 Git 元数据或 `._*`。

## 真实 HTTP 与页面证据

**F3 真实页面验收：NOT_RUN。** 收尾时尚未收到总控的 F3 路由 ready 通知；按总控指令先交可审查候选，后续由总控接续。没有 F3 成功订单号或真实拒绝状态可报告，22 项测试是隔离请求测试，不能作为真实交易链路成功证据。

| 实际验收项 | 状态 |
| --- | --- |
| 商品目录 200 与两个 SKU 的真实页面展示 | NOT_RUN |
| 页面 POST orders 201、服务端金额/币种、持久订单号 | NOT_RUN |
| 网络丢失响应后刷新/重试同意图 201 原单 | NOT_RUN（隔离测试通过） |
| 页面同号 GET 状态 200、pending/unlocked=false、无可用支付通道 | NOT_RUN |
| 本人订单列表/权益状态 200，另一游客空列表及跨人订单 404 | NOT_RUN |
| 真实 401 不换号、不重放，409/422/503 可见拒绝 | NOT_RUN（隔离测试通过） |
| 最终 LAN HTTP 源的键生成与请求预检、手机尺寸截图 | NOT_RUN（无 randomUUID/无 crypto 的键格式已由隔离测试覆盖） |

此前在仍运行 F2 的 4156 上，仅通过真实页面为本轮 A/B 独立游客初始化并创建 A 自选结果 `ef9d96f7-ea95-4b23-aefd-754155dfff55`；这不作为 F3 路由通过证据。临时源首页、结果页已实际打开；未提交网络文件、凭证或浏览器存储。

浏览器 A profile `4085febb-ff65-4743-8425-5dbc33c59a61` / page `42385d40-5e58-4f24-a3fc-4eb91d8ccae3`；B profile `1004d434-97a9-4809-9d2a-8c490ec1ad1d` / page `fefeb536-0ee8-4b27-9633-fdf9af318512`，均为独立隔离 profile。凭证只保存在浏览器，不写入报告或提交。

## 后端 ready 后建议接续

1. 总控确认 4156 为 F3/test55437 后，复用 A 原 profile，打开 `http://127.0.0.1:4155/#/pages/pricing/pricing?result_id=ef9d96f7-ea95-4b23-aefd-754155dfff55`。保留原游客；若该测试结果未保留，通过首页自选入口新建本人结果后进入商品。
2. 观察真实 `GET /products` 与 `GET /results`，tier1 测试价格/币种来自响应，tier2 按 `saleable=false` 禁用。点击 tier1 → 确认页 → 创建测试订单，记录 POST 201 的 `id/amount/currency/status/unlocked/payment_availability`，不得从旧本地订单补值。
3. 打开 `pages/order-status/order-status?order_id=<真实id>`，刷新和手动查询仍使用同一订单号。点击“查看金额、本人订单与权益”，核验真实 GET orders 与 entitlements/me；pending 时权益应为空、页面不可发起支付。
4. 返回相同结果/商品的确认页再创建，核验原幂等键与原订单号。可在浏览器受控丢弃一次真实响应后刷新重试；须区分“真实后端已写入 + 客户端故障注入”和隔离测试，记录同号及列表只落一单。
5. B 打开本人订单/权益入口应为空；将 A 的真实订单号带入 B 状态页应真实 404。用独立无效游客验证一次 401 后后续请求本地阻止、无新 auth/guest/写重放；不要将运营凭证放进浏览器。
6. 由总控在最终 LAN H5 源验证 `window.isSecureContext=false` 时键生成（`getRandomValues` 路径）与包含 Idempotency-Key 的浏览器预检，并查看 390px 页面截图；仅保存去敏方法/URL/状态码与业务测试订单号，不保存请求头或 token。

候选 SHA 以本次 worker_done 回执为准；候选代码与文档提交后停止写入，由总控审阅/集成 dev。

## unknowns / needs_human_review

生产 SKU/价格、真实支付通道、正式履约/退款、可找回账号绑定和跨设备恢复由后端候选列为外部待定；本轮仅受控测试单。最终 LAN HTTP 源的集成页面、跨物理设备、微信端、真实收费/支付回调/付费权益授予及后端重启持久性均须分开记录，不以隔离测试或本机缓存冒充。
