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

**F3 五项真实页面链路已验。** 代码先按总控要求提交为 `5049150bae8719f5fb9398bef943d9818d33fa3e`；收尾期间收到明确 F3 ready 后继续原 Task，完成以下实际页面验收。本次后续提交只补证据文档，22 项隔离测试与真实 HTTP 证据分开记录。

| 实际验收项 | 状态 |
| --- | --- |
| 商品目录 200 与两个 SKU 的真实页面展示 | 从 A 结果页实际点击进入商品，GET products 与 results 200；tier1 显示 CNY 9.90，可创建测试单；tier2 显示 CNY 19.90 及 FULFILLMENT_UNCONFIGURED，按钮禁用。价格均来自响应 |
| 页面 POST orders 201、服务端金额/币种、持久订单号 | 实际点击确认/创建，POST 201；订单 `MBTI-3f4a78f2-1e80-4871-9ea4-478944f33df7`，金额 990 分 CNY，pricing_mode=controlled_test_fixture；真实列表响应无 pay_params/paid_at |
| 同意图再次下单、刷新 | 从同一 A profile 重新打开相同结果/商品确认页并再次点击创建，第二次 POST 仍 201 原单；A GET orders 仅一单。状态页刷新与“重新查询同一订单”均真实 GET 200，订单号不变 |
| 页面同号 GET 状态 200 | 显示 pending、未解锁、支付通道未配置/暂不可发起支付，没有调用支付或本地解锁 |
| 本人订单/权益 200 与跨人隔离 | A 从状态页实际点击本人记录页，订单与权益两个 GET 200；金额 CNY 9.90，服务端权益空。B 独立 profile 订单/权益均空；直接打开 A 订单的状态页真实 GET 404，页面显示“资源不存在” |
| 真实 401 不换号、不重放 | B 完成隔离检查后，明确将其测试凭证替换为无效串，调用原请求封装 GET entitlements/me 得到真实 401；随后 createOrder 在本地被失效身份阻止，刷新状态页仍提示失效。B 捕获仅一次 auth/guest、零次 POST orders，没有重新领号或重放写操作；B 当前保留失效测试态 |
| 4156 重启后的本单读取 | 总控收到可短重启窗口后完成测试 API 重启并通知恢复；A 原游客再次在页面查询本单、打开本人记录，GET 状态/列表/权益均 200，仍为同 ID、990 CNY、pending/unlocked=false、一单/空权益。未重放写操作 |
| 手机尺寸截图 | 已查看 390×844 商品、状态与本人记录截图，订单号折行、金额和错误/不可支付说明可读，无横向溢出；截图仅本机临时产物 |
| 真实网络丢失响应、真实 409/422/503 UI 故障 | NOT_RUN；网络失败后同键与拒绝不回退由隔离测试覆盖，不等同于真实故障注入 |
| 最终 LAN HTTP 源的键生成与请求预检 | NOT_RUN；127.0.0.1 页面为安全上下文，真实下单 OPTIONS 204。无 randomUUID/无 crypto 的键格式由隔离测试覆盖，最终 LAN 非安全源需总控集成后复验 |

本单关联 A 自选结果 `ef9d96f7-ea95-4b23-aefd-754155dfff55`（创建于切换 F3 前的同一测试库）。F3 ready 后全部交易调用均真实经过 Nest/Prisma/PostgreSQL API，不以 mock、SQL 或本机旧缓存代替服务端成功；未读取任何运营/支付 fixture 或后台鉴权材料。

浏览器 A profile `4085febb-ff65-4743-8425-5dbc33c59a61` / page `42385d40-5e58-4f24-a3fc-4eb91d8ccae3`；B profile `1004d434-97a9-4809-9d2a-8c490ec1ad1d` / page `fefeb536-0ee8-4b27-9633-fdf9af318512`，均为独立隔离 profile。凭证只保存在浏览器，不写入报告或提交。

去敏 Network 元数据仅留本机 `/tmp/mbti-f3-web-A-network.json`（73 条 API 请求/预检）及 `/tmp/mbti-f3-web-B-network.json`（27 条），均 `truncated=false`；字段仅 method/url/status/mimeType/timestamp，无请求头、token、请求体或真实用户数据。A 两次 POST orders 均 201，A/B 各只有一次初始化领号；A 控制台只有 Vite 调试消息。一次 Orca 文本定位等待超时后以新 snapshot 的元素 ref 重试点击成功，未将该自动化等待误报为 API 故障。

## 集成后接续入口

- 保留 A 原 profile，可直接打开 `http://127.0.0.1:4155/#/pages/order-status/order-status?order_id=MBTI-3f4a78f2-1e80-4871-9ea4-478944f33df7` 与 `http://127.0.0.1:4155/#/pages/orders/orders`；相同结果/商品确认页为 `pages/unlock/unlock?result_id=ef9d96f7-ea95-4b23-aefd-754155dfff55&product_code=studio_tier_1`。不要替换 A 身份或清理其购买意图；B 当前是明确的失效凭证测试态。
- 总控在最终 LAN H5 源验证 `window.isSecureContext=false` 时键生成（`getRandomValues` 路径）及包含 Idempotency-Key 的预检；当前临时 H5 只绑定 127.0.0.1，test API 当前只授权该源，不擅自改后端 CORS 或已交付服务。
- 若补真实丢失响应重试，须区分“后端已真实写入 + 客户端故障注入”和隔离测试，核验相同 key/订单 ID 与列表只落一单；不得通过伪造响应宣称成功。真实 409/422/503、跨物理设备、微信与支付授予继续单列。

候选 SHA 以本次 worker_done 回执为准；候选代码与文档提交后停止写入，由总控审阅/集成 dev。

## unknowns / needs_human_review

生产 SKU/价格、真实支付通道、正式履约/退款、可找回账号绑定和跨设备恢复由后端候选列为外部待定；本轮仅受控测试单。最终 LAN HTTP 源的集成页面、跨物理设备、微信端、真实收费/支付回调/付费权益授予未验；后端自己的受控权益/运营持久性由其报告负责，本 Worker 只见证本人的 pending 单重启后 GET。未推断生产发布或正式商业履约已完成。
