# AF-163 个人记忆管理接口（候选，待总控真实验收）

这是一份由当前登录会员主动提交或确认的个人长期记忆存储。它没有自动推断、聊天录制、上传、脚本、embedding、模型调用或运行时注入；产品/组织共享记忆与每个 Agent 的实际运行时消费属于后续任务，本卡不代表 REQ018 完成。

## 访问与授权

接口前缀 `/api/client/ai/personal-memories`，使用现有 Client Cookie 会话与 `x-aij-workspace-id`。服务端验证会话、active member/workspace/membership/role/permission、project/organization 和 aij-ai 安装状态。列表与详情要求 `workspace.ai.assets.read`，写操作要求 `workspace.ai.assets.manage`；其他 OWNER 也不能读写本人记忆。服务事务按 plugin lifecycle → project/org/install share locks → 共享 membership fence/关联行锁 → owner memory advisory/asset locks 排序，权限更改等待已进入的保存提交。

写操作必须带与配置 `webUrl` 精确相同的 Origin，拒绝 cross-site。Controller 最先运行 NoStore guard，认证/上下文/DTO/业务拒绝及成功均设置 `Cache-Control: private, no-store`。框架在路由前拒绝的 malformed JSON 属全局 HTTP 解析层，总控必须在 bootstrap 中、app 初始化 body parser 前挂载本卡已导出的 `personalMemoryNoStore`：`app.use("/api/client/ai/personal-memories", personalMemoryNoStore)`，确保此类拒绝也 no-store；本卡没有修改全局 bootstrap 的授权。

## 数据和请求

- `code`：2–63 个小写字母/数字及单连字符，从字母开始；创建后不可改，删除后永不复用。
- `title`：非空文本，最多 100 UTF-16 单元、400 UTF-8 bytes。
- `content`：非空且不是纯空白的明确提交文本，最多 4000 UTF-16 单元及 16 KiB UTF-8；拒绝 NUL 和孤立 surrogate。SQL 另检查 Unicode 字符数与字节上限。
- `kind`：仅 `preference`、`confirmed_fact`、`task_summary`。
- `enabled`：可省略，默认 `false`；提供时必须为 JSON boolean。
- `agentIds`：可省略，默认 `[]`；唯一 ID 最多 16 个，按字面顺序规范化。引用必须为同会员、同空间、未删除的 private Agent；禁用 Agent 可以预授权。

空 `agentIds` 表示 **NONE**。`enabled=true` 与明确 Agent 授权是将来消费的必要 opt-in；本卡没有消费入口。未来消费者仍须即时复查权限、记忆 enabled/deleted、Agent enabled/deleted、同 owner/space 和当前 grant，不能将保存的授权当永久权限。

所有 body/query 均为严格白名单，禁止 user/member/workspace/source/system/global/secret/tool 等字段，也不接收自动采集、推断或恢复选项。

| 方法 | 路径 | Body/query | 返回 |
| --- | --- | --- | --- |
| GET | `/` | 可选 `limit` 1–50（默认20），`afterId` | `{items,nextCursor}`，摘要含 id/code/title/kind/enabled/revision/createdAt/updatedAt，不含正文或 Agent IDs |
| POST | `/` | `code,title,content,kind`；可选 enabled/agentIds | 201，当前完整详情 |
| GET | `/:id` | 不允许 query | 本人正文、摘要和当前 agentIds |
| PATCH | `/:id` | `title,content,kind,expectedRevision`；可选 enabled/agentIds | 完整替换全部可变字段；省略 opt-in/授权将重置为 false/[] |
| DELETE | `/:id` | 仅 `expectedRevision` | `{id,revision,deleted:true}` |

POST 的同 code + 相同初始规范内容重放返回当前状态且不重建旧授权；不同初始内容为409。活动行保留初始内容 tuple 的 SHA256（不返回 API）；没有明文初始快照或版本表。精确重放仍检查原请求 Agent 当前有效性。活动记忆配额为每 owner/space 200，删除释放活动名额而不释放 code。

PATCH 必须 CAS 匹配当前 revision；字段与规范授权完全相同时不增加 revision、不写审计。真实修改一次增加 revision、替换 grants 并写审计，均在同一事务。DELETE 首次也增加 revision；重复删除返回第一次删除的稳定结果（合法旧 revision 亦可），外国 ID 与随机 ID 均404。revision 上限为 2147483647。

## 删除与隐私

删除在一个事务内移除当前 grants，将 title/content/kind/enabled/initial_digest 全部 NULL，只保留 id、owner/space、不可变 code、revision 和时间墓碑。无正文历史、复制账本或 ShadowSecret；墓碑不可改、不可复活、不可物理删除或 truncate。明确的 code 永久保留用于拒绝重放/复活，不应承载敏感记忆正文。

删除是内容擦除，无法恢复；没有 restore 接口。它描述当前业务表与审计/API 的语义，不承诺清除 PostgreSQL WAL、基础设施备份或底层介质。审计仅记录 owner/space、随机 resource ID、action/revision，不保存正文、title、Agent 名称、code、grant refs 或调用方 correlation metadata；未处理基础设施异常统一变为503，不外泄 SQL 参数。

## SDK 与集成

窄工厂 `createPersonalMemoriesClient(existingClientApi)` 提供 create/list/get/update/delete；每次显式传 workspaceId，不留存身份/租户。请求校验与 API 同界限。总控需在 SDK 根入口导出 `./personal-memories.js` 后构建并验证 packed ESM/CJS；Worker 未改入口。

总控接收 STOPPED 后：合并 `docs/execution/AF-163-schema.prisma` 两模型及三条 backrelation（复用 Agent id/workspace/member 唯一键），保留该 SQL 的 CHECK/trigger；在 `ai-runtime.module.ts` 注册 AiPersonalMemoriesService、PersonalMemoryNoStoreGuard、AiPersonalMemoriesController；已有 workspace/plugin providers 可复用。服务通过实际 Prisma transaction client 的绑定 literal SQL 访问新表，没有伪造 ORM 成员或临时客户端复制。

Worker 未启动 API/Web，当前没有可用访问地址、页面变更或数据库变更。真实手工验收须在总控完成保护校验、隔离 test lease、迁移、seed、plugin/session 后使用同源 Cookie 请求：创建禁用记忆→本人详情→另一 OWNER 404→授权本人 Agent→CAS409→清空授权→删除正文→重复删除→重用code409，检查 no-store 和安全审计。

根验收脚本为 `scripts/verification/personal-memories-live.test.mjs`，Worker NOT_RUN；它只接受主 checkout/dev、显式 `AIJ_AF163_ROOT_LIVE=1` 与新的 AF-163 acceptance。总控须先注册 acceptance/runner/client auth fixture 的 AF-163 任务许可，完成新 Schema generate、build、正式 verify:task 及安装隔离 packed SDK consumer 到 `.artifacts/`，将目录以 `AIJ_AF163_PACKED_CONSUMER` 传入。测试包括真实并发200限额、CAS、PG blocking_pids 观察权限撤销 fence、Agent tombstone、SQL 审计 fault 回滚、全表擦除检查、禁止 execution ledger/model side effect 与关闭后 pools0。
