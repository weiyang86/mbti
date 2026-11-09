# RuntimeJob 每次领取的租约身份（AF-157 候选）

本卡修复通用 orchestrated Job 的手工重试身份碰撞：`retry()` 保持既有策略，将 attempts 重置为 0；同一个持久 Worker 再次领取时仍是 attempt 1，但已不是之前的执行。原先 processing admission `{jobId, leaseOwner, attempt}` 会误认成旧调用重入，跳过 handler 并让新租约留在 running。AF-155 根工作区 checkpoint 与 `run-5XVqFB` 记录了该失败；并未重复发送通知。本卡不修改通知实现或永久 dispatch fence。

`RuntimeJob.leaseNonce` 为内部 nullable UUID 字段，映射 `lease_nonce`。迁移只新增这一列，无默认值；已有 pending 行为 NULL。每次 `claim()` 调用使用 Node `randomUUID()` 生成新的 v4 UUID，绑定 SQL 参数并转换为 PostgreSQL UUID，同时持久化并返回 `lease_nonce`。批次内 UUID 可以相同，完整身份必须包含唯一 job id；不同 claim 调用从不复用 nonce。回收过期租约也必须生成新值。

租约身份是 `(id, leaseOwner, attempts, leaseNonce)`。`execute()` 和 `admitLease()` 拒绝缺失、非字符串、非 v4 UUID 的 nonce，不发 ORM/SQL 写入、不调用 handler；共享 `leaseWhere()` 在生成 ORM 条件前再次验证，避免 undefined 条件被 Prisma 省略。SQL admission 使用四项身份、running、未删除、尚未过期以及 FOR UPDATE；heartbeat、transactional completion、orchestrated completed-ledger replay/completion、失败和 plugin defer 使用同样四项身份。transactional completion 改为检查 updateMany 的 count；不匹配会回滚当前事务内的业务效果与幂等写入。Orchestrated completion 的幂等写入受同事务 admission 行锁保护。

processing admission 增加 `leaseNonce`，因此同 claim 重入只执行一次；手工重试后新 nonce 可以进入 handler。已经 completed 的业务幂等记录仍重放结果，不新增第二套 Job/Outbox/event 账本。Job 回调保留可选 `leaseNonce?: string` 类型以兼容既有 handler，真实 JobService 在两种执行模式中始终提供它。AF-155 后续 terminal sealing 必须校验该值，并以四项身份做条件写入；缺失时拒绝，不能降级为旧 owner+attempt 条件。

成功、失败/重试、过期最终尝试进入 dead、取消和人工重试均清除 nonce。人工操作的状态限制、attempt 上限、默认退避和外部错误分类不变。回收扫描是依据数据库当前状态的集合操作，不持有旧 callback 身份。管理列表与 scoped status 保持显式安全 select，不返回 nonce；内部 processing admission 只在 RuntimeIdempotency 中保存，未加到管理列表 resultReference。没有新增 API、页面、权限或包含 nonce 的运行日志。

Worker 只提交 SQL 和 `docs/execution/AF-157-schema.prisma` 的精确字段提案；生产 Schema 由总控在接到 STOP ALL WRITING 后修改。临时 client 是从本工作区的忽略 Schema 副本生成，输出 realpath 在本工作区 node_modules，供无数据库语义检查；它不是正式 Schema 接受或迁移证明。混用旧版租约写入代码不具备 nonce 防护，总控应在受控停写后统一接入字段与租约代码。

纯测试运行实际服务源码，使用记录型持久层检查 SQL 参数、ORM 条件、callback 和 admission；不把模拟存储的串行化当成 PostgreSQL 证明。根专用 `job-lease-nonce-live.test.mjs` 要求主工作区 dev、显式 `AIJ_AF157_ROOT_LIVE=true`、受保护 AF-157 新验收库以及实际生成 client/API build；Worker 未执行。该文件验证同 Worker 重置 attempt 1 后再次到达真实 handler、独立 PG 会话中的旧成功/失败/heartbeat 拒绝、同 claim 并发只执行一次、默认 transactional/过期恢复、真实插件安装启停和 project 拒绝、管理投影及连接归零。只在本卡新合成库控制 leaseExpiresAt 模拟过期，不伪造 JobService 返回结果、不直接改 completed 状态、不删除/重置 provider fence；结束释放所有 handler barrier、关闭自身连接和 API，不删除验收库。

nonce 解决执行租约身份，不承诺外部 exactly-once。超时、网络未知结果以及外部投递仍由 provider 的持久幂等/歧义策略处理；不能把 unknown 当未发送。AF-155 的原始 same-worker unknown 场景应在本卡正式集成验证后原样恢复运行。
