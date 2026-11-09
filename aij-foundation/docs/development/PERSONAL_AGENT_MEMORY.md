# 私有 Agent 的显式授权记忆（AF-167 候选）

本实现只在新私有 Agent TEXT/JSON 任务中使用 AF163 当前记忆：相同 Member + Workspace 的当前 Memory 必须 enabled=true、deleted_at IS NULL，并存在指向该私有 Agent 的复合 owner AgentGrant。保留在已停用/已删除 Agent 上的 grant 不是执行许可；原私有 Agent/Skill/model/provider/catalog resolver 与现有生命周期、成员、角色、权限检查仍须全部通过。没有自动采集、推断、组织共享、工具、脚本或新执行器。

当前为 Worker 候选，**不是 CODE_VERIFIED、DEV_INTEGRATED 或负责人接收**。真实数据库、服务、凭据屏障和编译 consumer 的正式证明由总控在主 dev 的新 AF-167 隔离验收中生成。

## 执行与存储

专用 injectable `AiPersonalAgentMemoryContextService` 使用调用方实际 Prisma transaction；新 admission 先读取当前匹配记忆，再调用原 Agent 快照 resolver。按 ID 的 C collation 稳定排序，查询 LIMIT 9；超过 8 条、任一 AF163 title/content/kind/UTF-8/revision 校验失败或合并编译超出当前模型 context 均整体拒绝，在 reserve/enqueue 前结束，不截断、不丢弃记忆。

快照唯一扩展为 `source.memoryRefs: [{memoryId, revision}]`，且只有非空时写入。没有 title、content、digest、name 或内容版本。请求 DTO、SDK 和 API 参数不变，客户端不能提交记忆正文、refs、source 或 context。原请求 hash 不变，完全相同 idempotency key 返回原 Run，先返回再做任何记忆选择。新无记忆及老快照不增加 memoryRefs；老队列无 refs 永远是 NONE，之后启用的记忆不会进入它。

内容仅在授权 transaction 中读取，保留于 RAM，传给现有 compileAgent/provider invoke 的可选 ephemeral 参数。编译时追加一条 user 数据消息，说明其为用户确认的上下文、没有工具/系统/行动授权；system、原 user input、Agent、Skill、catalog prompts 均不被修改。没有记忆时消息字节/快照格式/hash 保持原行为。catalog Agent 永不选择或接收个人记忆，编译器也拒绝对 catalog/image 使用非空 memory context。

正文不进入 Run.snapshot/input、Trace、Job、audit、resultReference 或另一个记忆版本，也不作为 output bookkeeping 保存。真实已准入任务的供应商响应继续归原 Run/output owner 与保留策略；删除当前记忆不能撤回已经发送给上游的数据，也不能承诺删除任意生成文档。合成上游必须返回固定常量，避免测试通过人为 echo 制造正文留存。

## 重新授权与锁顺序

派发和 credential IO 完成后、transport 前分别读取**原 refs**的当前 active/enabled/revision/owner/grant；任何编辑、停用、撤销、删除或成员/角色失效都在未尝试 transport 时拒绝，并通过原预算 owner 结算 0。Run.budgetStatus 为 released，而底层 reservation 沿用既有 `status=settled, chargedNanos=0`，不增加预算账本或状态。已尝试但结果不明维持 unknown/reserved，重入、恢复和 replay 不重发。

AF-189 升级补充：在原 provider/storage IO 完成后的成功结算事务内，再次核对当前生命周期、成员/角色、原 Agent 发布 epoch、模型/Skill 与显式 Memory refs；任何当前依赖失效均拒绝保存这次结果，已尝试的任务沿用 unknown/reserved，不自动重发或视为退款。调用期间删除记忆因此不再允许该次结果写成成功；删除前已经完成的结果仍归原 Run owner 保留。该行为由新的发布撤权/nonce 实测及原记忆回归验证，不重写 AF-167 的历史报告。

顺序为现有 lifecycle/membership -> Job -> Run -> AF163 owner advisory fence -> Memory（稳定 ID 次序）-> grants -> base Agent/Skill；新 admission 没有既有 Job/Run。Memory 查询只 `FOR SHARE OF m`，随后独立锁 grant，避免单个 join 的 planner 锁顺序先 Grant 后 Memory。使用与 AF163 CRUD 相同的 `ai-personal-memories:<workspace>:<member>` advisory key，保护新 grant/启用的 phantom；CRUD 原顺序 Memory -> Agent 不变。当前 membership 前置还持有 Workspace advisory，因此同 Workspace 的 CRUD 可能先等待该前置锁；真实 PG 检查应如实记录实际等待，不能把它误报为 Memory 行锁。

原 Job ID、worker、attempt、nonce 与未过期 lease 的锁和全部 terminal/output/Trace/budget fencing 保留。凭据/网络 IO 不跨 DB transaction 或持锁。只有 known source.memoryRefs 从 base 快照比较中移除，其余字段仍精确相等；refs 独立严校验，拒绝空数组、重复、无序、非法 ID/revision、额外键、foreign/outdated refs。不会改用新 revision 或加入新启用记忆。

## 总控接入与正式验收

总控在接收明确 STOPPED 后只集成本卡 bootstrap 后的差异。实际 module 需要 import `AiPersonalAgentMemoryContextService` 并加入 providers，让 AiCenterRunService 的新增 constructor 参数获得实际实例；Worker 无权修改 module。新私有 admission 若该 DI 缺失返回 unavailable；旧无 refs 的队列仍兼容，不能靠默认为空 resolver 在产品中绕开记忆。只有已知无记忆的旧 unit fixture 显式注入 empty resolver。

无需新 Schema、migration、SDK export、API flag、依赖或权限码。使用 AF163 已集成的 `ai_personal_memory`/`ai_personal_memory_agent_grant`；本 Worker 的实际 Schema 仅来自批准 bootstrap，用于离线 generate，是只读编译源，不是数据库迁移证据。总控还需按既有正式策略注册 **AF-167 自己**的 lease、runner、fixture task 身份与质量门禁，不能复用 AF161/163 lease 或放宽通用数据库保护。

根目录 dev、独立新 AF-167 测试库、fresh actual API 构建与生产 module 接入后：

- 运行 `node --test scripts/verification/personal-agent-memory.test.mjs`，再运行 `AIJ_AF167_ROOT_LIVE=true node --test scripts/verification/personal-agent-memory-live.test.mjs`。后者具有主工作区路径/dev/common-dir 硬保护，Worker NOT_RUN。
- live 使用实际 Cookie/API、JobService/Registry、PG、Trace、budget 与拥有的真实 loopback HTTP。只在 transport 边界把固定批准厂商 URL 导向 loopback，不改生产 host policy；响应为固定 TEXT/JSON/PNG，不使用 BYOK/fallback/真实付费请求。
- 验证匹配/禁用/无授权/foreign owner/其他 Workspace/其他 Agent/catalog 的选取，旧快照无变化，queued edit/disable/revoke/delete/role 拒绝与 reservation 0；真实 credential-read barrier 后撤销；PG 观察并发 CRUD/grant/delete 的实际锁等待和无死锁；>8/过大 context 无 Job/预留。
- 全表扫描采用参数化正文匹配，只输出泄漏计数：当前记忆在删除前只允许存在其 owner 表，删除后所有表为 0；正文/标题不写 evidence。检查当前 body/grants 清除，既有成功 constant output 保留；captured messages 仅存 RAM，finally 丢弃。
- 测试有效记忆时 stale nonce 不可写 output/Trace/settlement，unknown/reserved 不重发，exact replay/recovery 一份记录/一次调用；catalog image、private JSON、retention 与 pools=0。证据仅记录计数、lease/database 身份和服务关闭状态，正式 report 才是门禁结果。
- 再执行原 AF161 private/catalog TEXT/JSON/image、nonce/fencing、retention、compiled/packed SDK consumer 门禁及 AF163 删除/复合 owner 门禁，以及新注册 `verify:task -- AF-167` 的适用 lint/typecheck/build/真实拒绝成功路径。Worker 的纯 tests 不替代它们。

人工验收：用合成 Member 在同 Workspace 创建 enabled 私有 Agent 与显式记忆 grant，提交 TEXT/JSON 并在仅 RAM 的 loopback 捕获确认上下文；排队后编辑/撤销后执行应 failed/released 且调用数不增加；删除记忆后重放原 key 应仍返回原 Run，旧成功输出按原策略留存。不要将捕获内容粘贴到日志、截图或报告。Worker 未启动任何验收地址；地址须由总控实际启动后报告。
