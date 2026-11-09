# F5 联系方式内部运行候选

状态：**candidate / needs_human_review**。本轮选择由 Run `run_594d408d15de` 总控给定，不是权威契约发布；不修改 `docs/api`。基线 `3580e0fd902a57b5870c7e376b5d98fe916a0e3c` 已含 F4 发起方公开前置条件修复 `74c546c`。

已读根、web、aij-foundation AGENTS，指定输入包 RUNBOOK / API-REVIEW / cards/F5，F4 总交付和 F4 runtime candidate。固定 PR20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f` 通过本地 git 对象只读检查，没有合并。

| PR20 来源 | 观察到的字段与消费 | 本轮候选适配 |
| --- | --- | --- |
| `web/src/api/contacts.ts` | 八个方法；PUT MyContacts；create `{buddy_id,channels}`；respond `{action}`；list 可带 buddy_id；granted `{channels:[{channel,value}]}` | 保留全部路径和基本形状；首建 201，同向同集合 pending 重试 200，同 ID |
| `types-social.ts` | MyContacts 三可选字符串；ContactRequest 的 id、buddy_id、status、channels、created_at、responded_at?、simulated；GrantedChannel 的 channel/value | 增加 observer direction；simulated 恒 false；公开 card ID 作为 buddy_id，内部 owner 不回传 |
| `pages/contacts/contacts.vue` | 三个 trim 输入、候选格式正则；全量表单 PUT、清空调用 DELETE、读失败阻止保存 | 全量替换，未传/空白删除；不得通过空表单覆盖读取失败；候选正则沿用 |
| `pages/contact-request/contact-request.vue` | 基础交换 accepted 才展示；PR20 用自己渠道选项、模拟回应、accepted 一律 granted | 必须改为申请接收方渠道；不能推断对方可用渠道，只处理通用 409；只 incoming pending 可回应，只 outgoing accepted 可 granted；反向独立 |
| `pages/exchanges/exchanges.vue` | accepted 联系请求按 buddy_id 标记为“双方授权” | 用 direction 区分对方授权给我 / 我授权给对方，不能推断互授 |
| `pages/buddies/detail.vue` | accepted 基础交换进入申请页 | 保留入口；基础名片接受不会授予任何联系值 |

精确字段、八项路径、校验和错误以 [OpenAPI](MBTI-F5-runtime-candidate.openapi.yaml) 为准；[examples](MBTI-F5-runtime-candidate.examples.json) 仅脱敏形状，不是输入有效值或 HTTP 证据。

## 存储复用边界

Foundation 的 `ClientFilesService` 依赖 client user 身份及 FileAsset，`FileContentService` 依赖通用资源元数据；AI plugin 的固定 scope 不适用 MbtiGuest。F5 没有冒充这些身份、生成 FileAsset、复制认证或存储实现。`MbtiContactStorage` 仅为同一个 `LocalStorageAdapter` 配置 MBTI 联系方式和 owner 的私密子目录；原适配器负责 root 归属、路径、无符号链接、0700 目录、0600 文件、UUID key、独占写入与 IO。owner 子目录只由内部 guest ID 的摘要推导，客户端不能指定。

业务层只持久化 immutable 私密对象引用、epoch、大小、checksum 与时间；值不入普通 JSON、名片、通用 FileAsset、日志或错误。本人 GET/PUT 与合法原请求方 granted 是唯一有原值的响应。每次读取重新访问私密适配器并验证长度、checksum、精确渠道白名单；无原值缓存，缺失、权限、内容损坏或写入故障均 503。清除直接移除 live 引用并撤销授权，即使旧文件暂时 IO 故障也可完成。

写入先写 immutable 对象再提交 DB 引用，失败不会提交引用。事务失败、提交结果不确定、替换或清除均不在线删除对象；避免补偿误删已提交对象或在途读者使用的对象。旧对象不可通过业务 API 读到；私密离线 GC、保留时长与物理擦除策略仍 `needs_human_review`，本轮不清理他人数据。公开文件路由猜 key / 匿名读拒绝及文件权限由真实 HTTP/辅助文件检查取证。

## 版本与并发

非空实际替换与非空清除单调增加 epoch；完全相同的规范化值不变。所有旧 pending / accepted 同事务变 revoked；重新填写、换回旧值不恢复。联系申请绑定接收方 epoch 和确切 F4 exchange ID，granted 同时重读双方公开事实、共享 `isBlocked`、原交换 accepted、当前私密引用和 epoch。

F4 canonical pair advisory transaction lock 原实现保留并供 F5 共用。F5 pair 操作先取 pair，再按内部 owner 排序取 owner 事务锁；本人维护/清除和 F4 公开开关只取 owner 锁且永不反向取 pair。F4 block / exchange revoke 同 pair 锁永久撤销关联申请，F4 discoverable=false 在 owner 锁下撤销双方所有活动联系申请。解除 block、重新公开或另建 F4 exchange 均不复活旧授权。

每个 directed sender/recipient 的 pending/accepted 还有 DB 部分唯一索引兜底。双方各可单独发起反向请求，不自动回应或互授。所有读取含 no-store；未持有/失效 guest 401，不会静默发行新身份或重放写入。

## 发布前仍待审核

候选格式范围、渠道命名、本人替换语义、撤回范围、公开名片作为授权前置、guest 到期后的资料留存、孤立对象 GC 与正式 HTTP 发布仍需负责人审核。本轮内部选择已授权执行，不据此阻塞验证。跨物理设备、微信、生产多实例负载和真实联系渠道均不是本后端 Worker 的验收范围；Web GUI 证据由另一 Writer 提供。
