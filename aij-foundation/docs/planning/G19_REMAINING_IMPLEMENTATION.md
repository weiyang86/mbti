## 2026-11-04 最新交付入口

AF-116～AF-120 五节点已完成代码验证，按节点提交推送，等待负责人一次性统一 review。[统一汇报材料](../review/REMAINING_DELIVERY_REVIEW_20261104.md)包含成果、验证、提交索引和外部待决项。预算门禁、DeepSeek适配、独立评测留存、文本文件导入和集成收尾已实现；真实DeepSeek调用未执行，仍保持先前上游确认及本机配置门禁。下方历史HEAD、未提交记录和估时不代表当前状态。

---

# G19 后续实现规划

更新时间：2026-11-02（Asia/Shanghai）

规划基线：`dev` / `HEAD=origin/dev=d78cc404e78ad0dd90ebc8eebfc0bd2d502bea70` 是 NEXT-19B 开工时的历史基线。本文件最初记录候选范围；该批次后来获负责人授权并完成代码校验。工作区后续汇总提交/推送状态见下方执行对账和各卡执行记录。

## 当前执行对账（2026-11-02）

- NEXT-19B G19-05/AF-112、G19-06/AF-113、G19-07/AF-114 均为 `CODE_VERIFIED`；批次 `OWNER_CHECK_PENDING`。NEXT-19A 与 NEXT-19B 的统一负责人验收/接收均保持 `PENDING_UNIFIED_OWNER_CHECK`。
- AF-114 最终注册校验报告：`.artifacts/verification/AF-114/AF-114-final.json`；真实 DB/HTTP/离线 Provider 6/6，API/Web build、typecheck、lint、卡片 diff-check 均 exit 0。未做浏览器人工观察。后续工作区汇总提交 `82d93552e55d17b4eaee8576452fa13606eb9f77` 已推送并回读一致；不是三张卡的独立提交。
- NEXT-19C G19-08/AF-115「G19 客户问答 7 天到期与内容清理」已完成注册校验，6/6 实际 PostgreSQL/loopback HTTP 测试通过；Prisma validate/generate、API build、lint、typecheck、diff-check 通过。详情见 [AF-115](../execution/AF-115.md)。负责人验收/接收仍待执行。
- AF-115 完成后停止；预算门禁、真实 Provider/DeepSeek 和 Workspace 文件导入均未获本卡授权。NEXT-19A、NEXT-19B 的负责人状态没有改变。

## DeepSeek 决策补充与条款核对（2026-11-02）

本节记录负责人在 2026-11-02 给出的 DeepSeek 决策及本日对官方公开资料的核对。它是规划输入，不是 Provider 接入授权、执行卡、正式 AF 编号或代码校验结果；本次没有发起 DeepSeek 请求，也没有改队列。

| 决策项 | 当前记录 |
| --- | --- |
| 外部调用 | 数据范围仅限合成或彻底去标识输入，敏感字段必须屏蔽；负责人选择先确认上游数据用途、地域和删除承诺，确认前暂停真实 Provider 请求。 |
| AIJ 留存 | AF-115 当前明确所有既有和新建 `AiKnowledgeQuestion.query`、`answer`、`citations` 按 `createdAt + 7 days` 清理；到期读取统一返回 410，保留无正文状态行与运行时关联。独立评测记录/Trace 不在 AF-115 范围；负责人此前提出评测用脱敏输入/输出保留 7 天，该对象的清理尚未在本卡实现。 |
| 成本 | 一次评测累计硬上限为人民币 10 元，按冻结价目、负责人确定的换汇率和 token 上限做 AIJ 内部预算预留，价目不匹配时拒绝。`deepseek-flash` 是建议值，尚未固定；预算门禁未实现。 |
| 凭据 | 只由负责人写入本机被忽略的 SecretRef 环境配置；不进入仓库、日志、响应或执行记录。 |
| 上游条款 | 负责人选择 3B：先向 DeepSeek 确认数据用途、地域和删除承诺；确认前暂停真实 Provider 调用。 |

### DeepSeek 官方条款与数据处理现状

核对时间：2026-11-02。以下是对公开页面的事实摘要，不构成法律意见，也不保证服务条款今后不变。

- [DeepSeek Open Platform Terms of Service](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) 页面标明 2026-04-29 生效。条款要求开发者对提交 Input 有权利、许可和授权；面向终端用户的下游应用须披露个人信息处理规则并取得同意或其他合法依据，同时建立数据安全措施。API Key 要安全保管且不得暴露在浏览器/客户端。付费价格会调整，开发者对费用负责（第 2.2、3.3–3.4、4.1、5.5、6.1–6.2 节）。
- [DeepSeek Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html?locale=en_US) 页面最后更新为 2026-02-10。其列举的用户输入包括 prompt、输入文件、聊天历史和输出；明确不应提交敏感个人信息。其保留规则按数据种类、用途和法律要求变化；示例中为提供服务而处理的输入数据可在账号存续期间保留。该政策说明数据可能存储在用户所在国家之外，并说明其直接在中国境内收集、处理和存储数据；政策还列出改善/开发服务（包括模型和技术训练）等用途，但公开资料未给出 API payload 的专属无训练承诺。下游开发者处理其终端用户个人信息的规则不由该政策覆盖，开发者须自行披露（第 1、3、6 节）。
- 官方资料**没有承诺 Open Platform API 的 prompt/output 在 DeepSeek 侧固定 7 天删除**。[Context Caching 文档](https://api-docs.deepseek.com/guides/kv_cache/)称缓存默认开启、按 best-effort 运行，停止使用后通常在数小时至数天自动清除；这不是 API 输入/输出的删除保证。AF-115 所实现的七天只约束 **AIJ 自己存储的客户问答正文**，不能写成 DeepSeek 侧留存期；评测记录是独立 owner/范围。
- [当前模型与定价页](https://api-docs.deepseek.com/quick_start/pricing/)按百万 token 以美元列出模型输入/输出价、缓存命中价及高峰/非高峰价，并说明价格可能调整。公开页当前列出 `deepseek-flash` 和 `deepseek-v4-pro`。官方 [Chat Completions API 响应文档](https://api-docs.deepseek.com/api/create-chat-completion/)返回的是实际 token 用量，不是每次响应的人民币账单金额。因此人民币 10 元的“超额前拒绝”还需确定模型、换汇口径和预留策略；AIJ 可按冻结价目与实际 token 计算内部预算，但不能把内部估算冒称 Provider 账单真值。

### 与本库当前实现的关系

- `apps/api/src/plugins/aij-ai/ai-runtime.module.ts` 在生产环境使用空 Provider Registry，并绑定 `UnconfiguredAiBudgetAdmission`，即生产执行目前 fail-closed；离线 Provider/预算仅在测试模式注册。
- `AiBudgetAdmissionPort` 当前仅接收项目、Provider、模型和能力标识，不含费用上限/预留额度；`AiProviderUsage` 仅当 Provider 提供权威费用收据时才接受 `costAmountNanos`，不能用估价伪装实收成本。
- `AiExecutionTraceService` 只存输入/输出的形状摘要、token 用量和可选 Provider 报告成本，不存原文；AF-115 已为 `AiKnowledgeQuestion` 实现 7 天内容清理及到期 API 410。独立评测记录和 Trace 不在 AF-115 范围。
- Provider 凭据应继续走既有 SecretRef owner。候选实现不得在 `ScopedConfig` 写入 API Key，不得让客户端提供 Provider/model/SecretRef 选择。

### 历史候选开发卡（已获批并由 AF-115 执行）

**建议标题：G19 客户问答 7 天到期与内容清理**

| 项目 | 候选定义 |
| --- | --- |
| 唯一 owner | `apps/api/src/plugins/aij-ai/**` 拥有 `AiKnowledgeQuestion` 内容和到期语义；复用 `AsyncRuntime` 调度，不另建清理服务 owner。ClientWorkspace 继续拥有 Workspace 认证与隔离。 |
| 依赖 | G19-01 至 G19-07 `CODE_VERIFIED`；NEXT-19A/B 负责人统一验收仍待执行。后由负责人明确授权，分配 G19-08/AF-115。 |
| 预计工时 | 3–4 有效工程小时，按现有 Schema 和 AsyncRuntime 能力评估；若迁移、调度或真实 HTTP 验收超过 4 小时，先拆卡，不压缩验收。 |
| 范围 | 将所有既有和新建 `AiKnowledgeQuestion` 的 `query`、`answer`、`citations` 纳入 `createdAt + 7 days` 到期清理；期限内 API 可按现有 Workspace 权限读取，到期后 API 不得返回内容。保留非内容状态元数据以维持既有运行时关系；清理应可重试、幂等。此卡不实现 DeepSeek adapter、不调用 Provider、不改 Workspace 权限、不导入文件。 |
| 成功验收 | 真实注册校验使用随机隔离 PostgreSQL 与 OS 选择的本机 loopback 端口；6/6 用例通过，包含期限内读取、到期/历史 410、清理、重复清理无副作用，以及问答状态和 RuntimeJob 关联保留。 |
| 拒绝验收 | 跨 Workspace/匿名请求仍拒绝；清理作业不可用时，读取接口也按到期时间拒绝正文；未知记录不泄露跨 Workspace 是否存在；迁移失败或清理失败不得报告为已删除。全部使用合成数据和离线 Provider。 |
| 实际命令 | `pnpm run verify:task -- AF-115`；该注册命令实际执行目标保护、迁移 deploy/status、Prisma validate/generate、API build、PostgreSQL/HTTP 测试、lint、typecheck、diff-check，最终 exit 0。 |

到期 API 的通用 410 和状态行保留由负责人在 AF-115 指令中固定，并已实现验证。此卡不等于预算门禁或 DeepSeek 接入卡；真实 Provider 请求仍需满足上游确认条件。AF-115 结束后没有获批后续 G19 卡。

### 开工前最少待决项

1. **换汇率与模型版本**：预算规则已选 1A；仍需负责人给出本次固定 USD/CNY 换汇率，并确认是否采用 `deepseek-flash`。未给出时预算准入必须 fail-closed。
2. **评测记录留存**：与客户问答正文分开的评测输入/输出清理尚未实现；明确 owner 和执行边界后再登记对应卡，不将 AF-115 扩大到 Trace/评测数据。
3. **上游确认**：条款边界已选 3B。在 DeepSeek 确认 API 数据用途、地域和删除承诺前，真实 Provider 请求暂停。可另行授权离线实现，但不能记录为 live 接入通过。

负责人此前决定已记录为预算 1A、上游条款 3B。关于 7 天留存，AF-115 明确授权所有 `AiKnowledgeQuestion` 的 query/answer/citations 均按 7 天处理；此前提出的独立评测输入/输出留存仍是另一个未实现范围。DeepSeek 真实调用在上游用途、地域和删除承诺确认前仍暂停；本卡不发起调用。

## 已完成与当前状态

- **G19-00**：场景决策记录在 [G19-00](../execution/G19-00.md)。范围是企业知识问答、企业客户/终端用户、服务端认证 Workspace 隔离、DeepSeek Provider、`aij-ai-standard` 纳入范围。评测暂定 20 个合成样例，答案评分至少 90%、无依据问题拒答 100%、跨 Workspace 隔离 100%。原 G19-00 记录的预算解释是历史状态；负责人于 2026-11-02 补充决定一次评测累计硬上限 ¥10、超额前拒绝，具体换汇/定价策略见上文。
- **NEXT-19A / G19-01..04 / AF-108..111**：四卡均有真实注册校验、代码校验、标题提交和推送记录；`origin/dev` 已回读。AF-111 的 20 例合成评测为可回答 18/18、无依据拒答 2/2、跨 Workspace 引用泄漏 0。负责人统一验收仍为 `PENDING_UNIFIED_OWNER_CHECK`，不得由代码或 Git 状态推断已验收/接收。
- **NEXT-19B / G19-05..07 / AF-112..114**：三卡已按顺序完成代码校验；批次状态为 `OWNER_CHECK_PENDING`，负责人统一验收/接收仍为 `PENDING_UNIFIED_OWNER_CHECK`。证据见 [AF-112](../execution/AF-112.md)、[AF-113](../execution/AF-113.md)、[AF-114](../execution/AF-114.md)。负责人选择 3B：先确认 DeepSeek 数据用途、地域和删除承诺，因此当前真实调用暂停；预算口径 1A 与模型/汇率细节仍待补齐。Workspace 文件导入/发行授权仍是独立待决项。
- **NEXT-19C / G19-08 / AF-115**：代码校验通过，负责人验收/接收为 `PENDING_UNIFIED_OWNER_CHECK`；未提交/未推送。该卡只处理 AiKnowledgeQuestion 内容期限；不处理预算、DeepSeek Provider 或文件导入。

## 可复用 owner 与已存在能力

| 能力 | 当前唯一 owner / 证据 | 后续边界 |
| --- | --- | --- |
| 知识文档、检索、问题/答案 | `apps/api/src/plugins/aij-ai/**`；AF-108..111 | 不复制第二个 Knowledge Service 或问答结果表。 |
| Workspace、成员、认证与权限上下文 | `apps/api/src/client-workspaces/**`、`client-auth/**` | 只从服务端认证上下文取 Workspace；客户端不得自报租户身份。 |
| 持久任务、尝试、重试 | `apps/api/src/async-runtime/**` | 继续复用既有 `JobService`/`RuntimeRegistry`。 |
| Provider 凭据、Trace/Cost | SecretRef/SecretCenter、`AiExecutionTraceService` | 不将 secret 明文写入配置或日志；不建第二份成本账本。 |
| 客户端 Web API | `apps/web/app/components/client-api.mjs` 与既有 Workspace 页面 | 新页面只消费真实 API；按钮隐藏不能替代后端授权。 |
| 文件上传 | `apps/api/src/files/ClientFilesService` 与 `FileAsset` | 现有客户文件按成员归属且 `workspaceId=null`；不得直接当成 Workspace 知识源，需另行确定文件 owner/授权合同。 |

## NEXT-19B 已执行范围与验收摘要

编号冲突扫描在 2026-11-02 对当前队列分配表/历史、`taskExecutions`、`docs/execution`、验证注册表、提交标题和工作区可搜索文件执行后，映射为 AF-112、AF-113、AF-114；负责人随后明确授权该批。以下表格保留原范围与验收设计，不再表示候选或未授权。

| 顺序 | 候选卡 / AF | 估时 | 唯一 owner 与依赖 | 范围和可判定验收 |
| ---: | --- | ---: | --- | --- |
| 1 | **G19-05 / AF-112：知识文档更新、停用与审计 API（CODE_VERIFIED）** | 3–4h | API：`aij-ai`；复用 ClientWorkspace Guard/权限和 AuditLog。依赖 AF-108..111 `CODE_VERIFIED`；NEXT-19A 负责人验收继续待执行。 | 为同一 Workspace 文档提供受限更新、停用/恢复与分页状态查询；只允许管理权限。真实 PostgreSQL/HTTP 覆盖成功更新、无权限/匿名拒绝、跨 Workspace 不可枚举、并发旧版本冲突（若采用版本条件）、审计不含正文；停用后新检索/问答不得返回该文档或其引用。优先只用现有 `AiKnowledgeDocument` 字段，不预设 Schema 变更。 |
| 2 | **G19-06 / AF-113：客户 Workspace 知识库管理页（CODE_VERIFIED）** | 3–4h | Web 页面 owner：`apps/web/app/client/**`；只消费 AF-112 及 AF-108 API。依赖 AF-112 `CODE_VERIFIED`。 | 提供合成知识的创建/列表/编辑/停用/恢复操作；保持现有登录和 Workspace 选择语义。验证有效表单、加载/空状态、401/403、校验冲突与 API 失败反馈；运行受影响 Web 构建和真实 API 消费验证。页面不上传文件，不缓存跨 Workspace 内容。 |
| 3 | **G19-07 / AF-114：客户 Workspace 知识问答页（CODE_VERIFIED）** | 3–4h | Web 页面 owner：`apps/web/app/client/**`；问答能力继续归 `aij-ai`，认证继续归 ClientWorkspace。依赖 AF-110/111 `CODE_VERIFIED`；同一候选批按顺序执行。 | 使用真实 POST 提交与 GET 轮询；展示处理中、带引用答案、证据不足拒答、失败和重试提示。测试匿名/无权限拒绝、跨 Workspace 结果不可读、不得用请求体指定 Workspace；至少一个真实 HTTP/API consumer 路径，运行 Web build。只用测试专用离线 Provider 和合成知识。 |

**原估算：9–12 有效工程小时；每卡 3–4 小时。** NEXT-19B 已完成，三张卡均有真实注册校验和执行记录。卡片收尾时未作单卡提交；负责人随后授权汇总处理混合工作区，因此当前快照以一次汇总提交 `82d93552e55d17b4eaee8576452fa13606eb9f77` 推送。它不替代单卡提交，也不改变负责人验收状态。

## 其他未进入 NEXT-19B 的待决范围

1. **Workspace 文件导入**：现有 `FileAsset` 上传把文件绑定到用户且 `workspaceId=null`。要将其作为知识源，先确定文件与 Workspace/知识文档的唯一归属、权限继承、删除和恢复语义、可解析格式及大小限制；否则不可直接复用或复制文件服务。
2. **发行**：纳入 `aij-ai-standard` 是产品范围决定，不是许可证、公开发布渠道或平台支持授权。

## NEXT-19B 历史启动 Prompt（已执行；不得重复启动）

```text
批准启动 NEXT-19B，仅执行 G19-05/AF-112、G19-06/AF-113、G19-07/AF-114，按本文件范围和依赖顺序逐卡执行。Codex 为唯一 Writer，不使用 Trea 复核。允许 NEXT-19A 负责人统一验收继续待执行并叠加开发，但不得标为已验收或已接收。

仅使用本库合成知识、隔离 test PostgreSQL、真实 loopback HTTP 和测试专用离线 Provider；不连接真实 DeepSeek、不发送真实客户数据、不产生付费请求、不引入文件上传。复用 aij-ai、ClientWorkspace、AsyncRuntime、SecretRef、AuditLog 和 AiExecutionTraceService 唯一 owner。

每卡开工先核对 dev/HEAD/origin/dev、工作区/普通索引、依赖、owner 和 AF 编号；保留全部继承差异。注册本卡真实测试文件、命令及前置条件，运行 verify:task、适用 lint/typecheck/Prisma/build，以及成功/拒绝路径。失败修复后完整重跑；每卡更新 docs/execution/AF-编号.md、CODING_QUEUE.json 和必要契约文档。记录命令退出码与断言，不推断负责人验收。

每卡不超过4有效工程小时，本批不超过3卡/12小时。通过后按仓库规则只提交可安全隔离的本卡差异，标题逐字使用队列任务名；本次 Prompt 不授权 push。若依赖/owner/安全边界不成立、超时或无法安全分离，保留成果并停止，不跳卡、不启动其他批次。
```

## 规划基线证据（记录于批次授权之前）

- 当前规划基线：`dev`，本地 HEAD 与 `origin/dev` 跟踪值为 `d78cc404e78ad0dd90ebc8eebfc0bd2d502bea70`；本机工作区保留约 1,914 条继承状态项。
- 普通 `.git/index` SHA-256：`31f3785d31ec6ff81c0b4785af2e8d33cc37a76880dc2f754419cb2a99caedb4`；本节点只读核对，未暂存、提交或推送。
- 冲突扫描未发现 AF-112..114、G19-05..07 的既有注册、执行记录、验证注册或提交标题。
- 上述记录描述规划阶段；NEXT-19B 后续执行结果以各卡执行报告为准。该批实际仅运行本库隔离 test PostgreSQL、loopback HTTP 和 test-only offline Provider；未调用真实 DeepSeek、客户数据或付费服务，未导入文件。

### 本节点核验结果

| 核验 | 结果 |
| --- | --- |
| 基线命令：`git branch --show-current`、HEAD/`origin/dev` 读取、`git status --short --untracked-files=all`、`.git/index` SHA、`git diff --check` | 全部 exit 0；开始状态 1,914 项，结束 1,915 项（本次新增本规划文件）；HEAD 与 `origin/dev` 均为上述 SHA；普通索引哈希不变。 |
| 编号扫描：工作区 `rg`、执行记录路径历史、Git 提交标题、HEAD 验证注册表 | 全部 exit 0；AF-112..114 和 G19-05..07 在登记前均无命中。 |
| `CODING_QUEUE.json` 解析与 Node 断言 | exit 0；确认候选映射/状态、NEXT-19A 负责人验收仍待执行、ownerAcceptanceRecords 哈希未变，候选没有伪建执行记录。 |
| 修改规划文档的本地 Markdown 引用检查 | exit 0；所有相对链接目标存在。 |
| `git diff --check`、`git diff --cached --check` | 均 exit 0；普通索引未修改。 |
| 业务测试、Prisma、数据库、HTTP、服务及 Provider 调用 | 未运行；本节点只做规划和队列状态整理。 |

一次仅供读取的临时队列摘要命令因假设 `formalTaskIdAssignments` 是数组而 exit 1；实际字段是对象。该命令未写文件；修正读取方式后，后续状态检查均 exit 0。
