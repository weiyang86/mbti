# AIJ 通用 Webhook 通知接收协议 v1

阶段：AF-155 候选实现；未完成根工作区真实数据库验收和负责人接收。此协议由本仓库定义，不声称兼容任意厂商 Webhook、邮件、短信、微信或企业渠道。RuntimeJob 的 completed 只表示端点按本协议通过 HTTP 接受，不能证明人已收到、阅读或完成业务处理。

## 服务端启用与边界

默认关闭：未设置 `AIJ_NOTIFICATION_WEBHOOK_ENABLED=true` 时，NotificationRuntimeModule 不注册 Webhook Provider，沿用缺失 Provider 的拒绝行为。配置为 true 时还必须有 `AIJ_NOTIFICATION_WEBHOOK_ENDPOINTS`，其值为 1 至 8 个不重复的完整 URL 的 JSON 数组。例如：

```sh
AIJ_NOTIFICATION_WEBHOOK_ENABLED=true
AIJ_NOTIFICATION_WEBHOOK_ENDPOINTS='["https://receiver.your-company.com/notifications/v1"]'
```

这两项只由受信宿主进程设置，不是公开配置、页面字段或客户提交的策略。启用但白名单无效时启动拒绝。端点必须是精确的规范 HTTPS URL，包含固定路径；禁止凭据、query、fragment、IP、非 443 端口、localhost 和特殊域。显式 `:443`、大小写主机、路径规范化等非规范写法也拒绝，路径的差异不互相授权。发送请求的 recipientAddress 必须逐字匹配白名单；这一步先于任何 DNS、SecretRef 解析和传输。

每次发送从当前运行项目取 `scope=project`、`pluginCode=aij-notification`、`configKey=notification.channel.webhook.secretRef` 的 active/private/sensitive/secretRef 绑定。调用现有 `SecretRefPort.resolveTrustedForPlugin('aij-notification', ref)`，由现有 SecretCenter 检查项目命名空间、引用 provider/状态、插件绑定并解析密钥；不增加秘密表、不把密钥传给 NotificationDeliveryContext。取配置和发送准入时均检查项目、组织、插件；解析后复检精确渠道绑定和引用状态。停用在发送进入前生效；已在途的请求不能被撤回。

DNS 的全部回答必须是被允许的公网单播地址；混有私网、特殊用途、IPv4-mapped IPv6、过渡地址、文档地址或家族不匹配即拒绝。选择其中一个地址固定到本次 socket 的 lookup，TLS 使用原主机做 SNI 和正常 CA/主机名验证，并核对远端 IP。使用独立请求、不复用全局 agent、不读代理配置、不跟随重定向、不切换第二地址、不回退其他 Provider。没有生产 loopback/跳过 TLS 验证的开关。受信构造参数仅供测试夹具注入单实例 IO，不存在从 HTTP 或配置加载执行代码的接口。

## 请求与签名

POST 到批准的完整路径。UTF-8 JSON 的字段固定，序列化顺序如下；正文至多 128 KiB（按 UTF-8 字节计算）：

```json
{"protocol":"aij.notification.webhook.v1","messageId":"message-1","recipientId":"recipient-1","title":"通知标题","body":"通知正文","contentType":"text","idempotencyKey":"notification:event-1","deliveryKey":"notification:event-1"}
```

contentType 为 text 或 html。recipientId 是生产者的接收对象身份；recipientAddress 是已批准的传输端点，不放进正文。正文不包含 SecretRef、密钥、签名原文秘密、相关 ID 以外的上下文或完整内部 Job。现有 Outbox/Job 继续保存生产者提交的通知正文；本卡不改变其数据保留规则。

头：`Content-Type: application/json; charset=utf-8`、精确 Content-Length、`Accept: application/json`、`Accept-Encoding: identity`，以及：

| 头 | 值 |
| --- | --- |
| X-AIJ-Webhook-Timestamp | 发送时 Unix 秒的十进制字符串 |
| X-AIJ-Webhook-Delivery-Key | RuntimeJob 的稳定 idempotencyKey（`notification:<eventId>`） |
| X-AIJ-Webhook-Signature | `v1=` + 小写十六进制 HMAC-SHA256 |

HMAC 的共享密钥来自本次 SecretRef。被签名字节为 `timestamp + "\n" + idempotencyKey + "\n"` 的 UTF-8 字节，紧接实际发送的原始 JSON 字节，不另加结尾换行。接收方必须对原始字节验签，不能先解析并重新序列化；用常量时间比较，核对头/正文的两个身份字段一致。密钥永远不是 recipient URL/query，且不放入 URL、正文、日志、审计、错误或回执。

接收方应定义并执行时间窗口（建议 ±300 秒，时钟同步），对首次未见 key 拒绝过期请求，并把有效 key、请求摘要和接收回执持久化，与接收业务意图原子提交。相同 key/摘要返回原回执，key 相同而内容不同应拒绝；保留期应覆盖生产者对账期。这里的 key 是接收方实现持久幂等的依据，单靠头不能提供 exactly-once。

## 响应

只有 HTTP 200–299 且符合下列条件才表示端点接受：Content-Type 是 application/json（可带 charset=utf-8），Content-Encoding 缺省或 identity，无 Location，响应正文不超过 8 KiB，且是合法 UTF-8 JSON：

```json
{"receiptId":"receiver-accepted-123"}
```

对象只允许 receiptId；ID 须匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`。接收方须生成不包含通知正文或凭据的独立、不透明回执 ID；不能返回完整业务响应。发送端只保留 `{providerMessageId: receiptId}`，不保存原始响应。空 204、重定向、非 2xx、压缩/超长/非法 UTF-8/非法 JSON/多余字段/非法 ID 均不算接受。传输错误不会把任意响应、URL、正文或异常详情写进状态/日志。

## 单次外发、歧义与人工对账

Webhook Job 固定 maxAttempts=1，其他 Provider 保持原来的 maxAttempts=5 和重试流程。attemptNo 不等于 1 时，在外部 IO 前拒绝。现有 JobService 的 lease admission 防止同一租约并发重复执行；另在已有 RuntimeIdempotency 中以 owner=`aij-notification.webhook-dispatch@1`、原 Job idempotencyKey 保存一次性准入（无回执、无第二投递账本、无新 Schema）。准入在 DNS/传输前持久化，重复键永久拒绝；因为现有人工 retry 会重置 attempts，仅看计数不足以保护外部写入。准入不因超时/失败/人工重试而删除，过期时间设为 9999 年，维护作业不得清理后重新开放相同意图。

从 Provider 进入后的总期限至多 10 秒，覆盖配置/SecretRef/准入等待、DNS、TLS、请求写入和响应读取。AbortSignal 向下传播；取消或期限后即使 DNS/异步读稍后返回也不会开始传输。可能已经发送后，任何网络错误、超时、重定向、状态错误或回执不合格均以固定代码 `WEBHOOK_OUTCOME_UNKNOWN_MANUAL_RECONCILIATION_REQUIRED` 标记原 RuntimeJob dead。明确准入失败使用 `WEBHOOK_ADMISSION_DENIED`。仅保存这些白名单代码；generic JobService/RuntimeRegistry 不改，不能把 arbitrary provider error 作为可公开错误。

崩溃在准入后、实际发出前也可能损失一次通知，需要人工核查；进程崩溃导致租约过期时，通用 Runtime 的 `lease_expired_at_attempt_limit` 同样必须视作可能外发、需要对账，不能解释为“未发送”。没有自动重发、自动回退或准入清理。现有管理员 retry 即使把 attempts 归零也不会第二次传输。接收方查询/对账应使用原 delivery key；如需创建新意图，必须由业务生产者/负责人明确决定新 key 和重复风险，本卡不自动创建补发意图。此策略是 first-attempt-only 的 at-most-once 外发准入，不保证成功送达。

## 根工作区验收

Worker 只能运行源码纯测试、自有 TLS 夹具、lint、noEmit 和 no-DB Prisma generate。`webhook-notification-live.test.mjs` 必须在根工作区串行运行，使用新建受保护 AF-155 数据库、真实安装/启用、合成 SecretRef/渠道配置、真实 producer transaction/Outbox/Job 和单实例 TLS 夹具，绝不连接真实端点。

根总控负责把 AF-155 加入已有的精确任务保护列表（`scripts/database/migration.mjs`、`scripts/database/seed.mjs`、`scripts/runtime-environment.cjs`、`scripts/verification/auth-support.mjs` 中相关列表），登记 verify:task，运行实际 API build 后执行：

```sh
AIJ_AF155_ROOT_LIVE=true node --test scripts/verification/webhook-notification-live.test.mjs
```

夹具自行准备 runtime/plugin/configuration/secret 权限定义，不要求修改通用 runtime-fixture 的 seed 分支。测试包含成功只存一次回执、重复租约/生产者 replay、未知结果与实际 operator retry 不再次外发、排队后 plugin/config/ref/project/organization 停用零 DNS/传输、安全投影的秘密/正文 marker 与关闭后 applicationPools=0。原有 notification-outbox 和 notification-config DB/HTTP 回归也由根工作区运行。实际生产 DNS/公网 CA 路由和真实接收方幂等尚需后续独立联调，不以合成夹具通过冒充厂商或人的送达验收。

## Root网络边界核对（2026-11-05）

根审查依据[IANA IPv6分配表](https://www.iana.org/assignments/ipv6-unicast-address-assignments/)与[IPv6特殊用途表](https://www.iana.org/assignments/iana-ipv6-special-registry/)限制到当前RIR分配区间，并额外排除特殊/文档/过渡地址。仅检查2000::/3会包含3ffe等保留地址，因此不采用该宽泛判断；区间由表推导并有固定边界测试，未来分配默认拒绝，须刻意更新代码，不自动联网放宽。IPv4按[IANA特殊用途表](https://www.iana.org/assignments/iana-ipv4-special-registry/)保守拒绝所有所列特殊区间（含部分可全局路由例外）。DNS返回多个地址时全部通过才固定单IP。不是任意IPv6目的地或公网可达性承诺。

AF157接入后，通知handler要求合法claim nonce才可进入provider；终态写入校验job/worker/attempt/nonce及有效状态，且清除nonce。实际manual retry保持同worker、同attempt1，用新的nonce进入handler后仍由原永久dispatch fence阻止第二次发送；不修改通用processing admission metadata，不换worker绕过验收。
