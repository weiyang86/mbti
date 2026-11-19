# AIJ 剩余开发统一 Review 材料

日期：2026-11-04。交付分支：`dev`。基线：`d77120dc3ebf8fa038129682ead214d1c04051c5`。

## 请先看这里

本次按负责人要求，将可独立完成的剩余开发划为 AF-116～AF-120，逐节点真实验证、原标题提交、快进推送；最终集中 review。五个节点的代码与最终集成校验均通过；AF-116～AF-119已各自提交推送，AF-120以本材料所在提交完成收尾。负责人统一 review 待执行。

真实 DeepSeek 付费调用尚未执行，调用开关保持默认关闭；此前要求的上游数据用途、地域和删除承诺确认未收到新的完成证据。本次没有把离线模拟、代码校验或推送当成负责人验收。许可、公开发行和正式部署保持负责人决定。

## 节点成果与提交

| 节点 | 交付能力 | 提交 | 证据 |
| --- | --- | --- | --- |
| 准备 | 登记依赖顺序、每节点验证/提交/推送与统一 review 方式 | [b391e94](https://github.com/weiyang86/aij-foundation/commit/b391e9443ae802810706e6f6ba2c6d3260ae9739) | [执行计划](../planning/REMAINING_DELIVERY_20261104.md) |
| AF-116 | 持久化预算 run/reservation；数据库锁限制并发，累计 ¥10 硬上限；模型/汇率/价目冻结，失败占额不自动释放 | [4d9dbc1](https://github.com/weiyang86/aij-foundation/commit/4d9dbc15ee522250f221bc996d5c20e1a55a4bf0) | [执行记录](../execution/AF-116.md) |
| AF-117 | 服务端 DeepSeek 适配；固定官方 endpoint、allowlist、常见敏感字段屏蔽、响应/超时/重定向拒绝；预算与 SecretRef/Trace 组合 | [f863c2d](https://github.com/weiyang86/aij-foundation/commit/f863c2d8bfeac59217636f56ab6a1259924b3521) | [执行记录](../execution/AF-117.md) |
| AF-118 | 独立评测快照：只从真实终态问答捕获，run/case 幂等；七天到期即拒读，异步只清正文、保留状态关联 | [08aa14e](https://github.com/weiyang86/aij-foundation/commit/08aa14e596c99b84d71eeda93f4945f7053ab216) | [执行记录](../execution/AF-118.md) |
| AF-119 | Workspace `.txt/.md` 导入，50KB/UTF-8 校验、来源摘要；Web 导入按钮、来源列与 SDK multipart；沿用编辑/停用/恢复 | [b1e0ad8](https://github.com/weiyang86/aij-foundation/commit/b1e0ad877537cf2a09e9046452299f6d51209b68) | [执行记录](../execution/AF-119.md) |
| AF-120 | 跨节点与旧能力回归；修复正常启动入口的 F01 全插件拒绝；导入事务遵守插件启停锁；当前私有包消费与统一材料 | 本材料所在提交 | [执行记录](../execution/AF-120.md) |

前四节点均已通过 `pnpm run verify:task -- AF-编号`：预算6/6、Provider协议5/5与预算回归6/6、独立评测留存6/6、文件导入6/6。数字含父测试；不按重复运行次数累计独立功能数。完整命令、失败修正和最终报告位置保留在对应执行记录。

## 实际行为与影响

### 预算与模型调用

一次评测由服务端 project/run 标识绑定；客户端无法选择预算周期、Provider、模型或 SecretRef。每次外部调用按完整模型上下文与输出上限，用冻结峰值未命中价预留人民币估算金额；并发进程共享数据库行锁。成功后按实际 token 用量结算内部估算；失败、超时、进程退出或无法确认用量时继续占用完整预留。重复 reservation 不会再次请求。

内部预算不填入 Provider 实收账本，DeepSeek 仅返回 token 用量时，`AiExecutionTrace.costSource=unreported`、实收金额为空。固定汇率必须在本机配置，测试用7.2仅为合成夹具。该 ¥10 门禁是冻结价目/汇率下的 AIJ 内部预算，不等同上游账单限额；上游价格变化应重新确认价目并换新 run，配置到期或缺失即拒绝。

真实调用需同时明确打开 `AI_DEEPSEEK_LIVE_ENABLED`、`AI_DEEPSEEK_UPSTREAM_CONFIRMED`，并声明 `AI_DEEPSEEK_DATA_CLASS=synthetic-or-deidentified`，同时具备有效预算配置、插件/能力授权与 SecretRef。现有配置示例将两个调用开关设为 false，预算为空；没有保存真实凭据。常见邮箱、长号码和凭据格式会屏蔽，但自动屏蔽不能替代输入数据分类；首期只允许合成/彻底去标识输入。

### 评测与留存

`POST /api/client/ai/knowledge/evaluations` 仅接收 `questionId/runKey/caseKey`；服务端验证当前 Workspace 知识管理权限，从真实已完成/拒答/失败问题生成脱敏快照，客户端不能声明答案或评分。`GET /evaluations/:id` 同样受权限约束；到期统一410，匿名401、外区404，响应 no-store。

七天起点沿用源问题 createdAt，避免复制快照延长原内容期限。清理未执行/失败时，读取也拒绝过期正文。新增 `aij-ai.evaluation-expiry-cleanup` 每小时通过既有 AsyncRuntime 清正文；保留评测状态、run/case 和源问答关联，不扩大修改 Trace/Cost 留存。

### 文件导入与权限

`POST /api/client/ai/knowledge/documents/import` 接收 multipart 的 file/documentCode/title。首期支持 UTF-8 `.txt/.md`，最大50KB；非法编码、二进制、空文件、错误格式、超限和伪造租户字段均拒绝。原件不落盘，创建 Workspace 所有的知识文档快照并记录安全显示文件名和 SHA256，不改变成员私有 FileAsset 的归属。

原件留在上传者本机；服务器不提供原件删除/恢复。导入快照通过现有文档编辑、停用/恢复管理；停用后退出新检索，恢复后重新参与。PDF、DOCX、OCR、批量导入属于后续扩展。导入审计只记录文档标识、状态与摘要，不记录正文。插件停用与新导入写入使用既有生命周期锁串行化。

Web 路由：`/client/knowledge`（新增导入按钮/来源列），`/client/knowledge/questions`（现有问答）。这些是路由说明，测试临时服务已经退出，不声明固定3655/3656当前可访问。

### 数据库与包

新增三次迁移：预算 run/reservation 两表、评测记录一表及问答复合唯一约束、知识文档两个可空来源字段。仅在本库随机新建的隔离 test 验收库部署；没有迁移开发/共享/正式数据库，没有删除旧库。

SDK 只补齐 FormData 的浏览器 boundary 处理；现有 Cookie、Workspace header、no-store 与错误契约保留。正常启动入口只允许当前已注册的 AI/通知/支付插件，默认空集合，未知/轻企业务插件仍拒绝。未升级依赖、修改锁文件或公开发布包。

## 最终验证

最终 `pnpm run verify:task -- AF-120`：**PASS / exit 0**，1项前置、17项步骤全部通过。报告：`.artifacts/verification/AF-120/run-WOnxza/report.json`。

| 验证 | 结果 |
| --- | --- |
| 默认根测试 / API装配 | 84/84、8/8；失败、跳过、todo均0 |
| 七组目标回归 + base/SDK私有包消费 | 50/50结构化测试，失败、跳过、todo均0（含父测试，独立场景不重复累计） |
| 原20例离线知识评测 | 有依据18/18、无依据拒答2/2、跨Workspace引用泄漏0；只代表offline-knowledge评测 |
| Prisma / 构建 / 代码门禁 | validate/generate、API build、Web production build、lint、typecheck、diff-check均exit0 |
| 补充插件清单测试 | 15/15，确认显式注册模块与未知代码拒绝 |

[机器可读验证摘要](REMAINING_DELIVERY_VERIFICATION_20261104.json)已保存每节点最终报告SHA256、实际命令、退出码及结构化计数；完整日志在本机忽略的 `.artifacts/verification/`。当前base私有源包与SDK包均实际离线安装验证，未publish。所有临时API/Provider测试宿主都已按测试finally退出；原PostgreSQL实例及旧验收库保留。

修正后的完整最终运行无失败。之前失败均保留，不计为通过：AF-118 测试误用不存在的插件状态；AF-119 测试模块根目录无法解析应用级 SDK 链接；AF-120 并行建库触发保护锁、测试局部变量未使用。已修正后完整复跑，未删除锁或削弱保护。

## 负责人一次性 Review 顺序

1. 先看上表五节点与最终验证，确认交付范围、边界及每节点提交；需要代码细节时进入执行记录和对应提交。
2. 看新增迁移及预算并发/失败保留策略，确认接受冻结价目估算与保守占额；确认模型/汇率/上游处理条件后，才能启用真实评测。
3. 看文件导入“文本快照、原件不落盘”的生命周期，确认首期格式/大小满足需求；知识库页面视觉与人工操作仍留给本次负责人统一 review。
4. 历史已代码验证批次的完整导航仍见[原统一验收清单](../planning/OWNER_ACCEPTANCE_CHECKLIST.md)。本次不重做历史开发，也不改写旧负责人接收记录；未执行的浏览器/外部观察没有补记为通过。

## 仍需外部输入的事项

| 事项 | 当前状态 | 后续条件 |
| --- | --- | --- |
| DeepSeek 真实20例评测 | 未执行；代码/离线契约已实现 | 上游数据用途/地域/删除承诺确认，固定汇率、模型/价目核定、本机 SecretRef 与显式启用 |
| 真实短信/邮件送达、支付扣退款 | 未执行，沿用原离线边界 | 独立 Provider 凭据、业务范围与真实动作确认 |
| 许可、公开分发渠道、支持平台、生产部署 | 待负责人决定 | 本地私有包验证不替代许可与发布决定 |
| 负责人正式验收 | 待本次统一 review | 本材料、执行证据与必要页面操作；代码通过和推送不等于已接收 |

没有新的常驻后台续跑任务。最终收尾后停在统一负责人 review；不自动启用真实付费调用或正式部署。

## 来源与追溯

- [DeepSeek 模型与定价](https://api-docs.deepseek.com/quick_start/pricing/)：2026-11-04核对，首期模型 deepseek-flash、版本 DeepSeek-V4.1-Flash-1017；预算快照采用峰值缓存未命中输入/输出价，设置到期时间。
- [DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)：固定非流式、关闭 thinking、显式输出上限与 JSON 形状、token用量校验。公开协议与价格随时间变化，不视作长期固定承诺。
- [任务队列](../planning/CODING_QUEUE.json)、[本次计划](../planning/REMAINING_DELIVERY_20261104.md)、[知识问答契约](../development/AI_KNOWLEDGE_QA.md)。
