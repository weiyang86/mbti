## 2026-11-04 最新交付入口

AF-116～AF-120 五节点已完成代码验证，按节点提交推送，等待负责人一次性统一 review。[统一汇报材料](../review/REMAINING_DELIVERY_REVIEW_20261104.md)包含成果、验证、提交索引和外部待决项。预算门禁、DeepSeek适配、独立评测留存、文本文件导入和集成收尾已实现；真实DeepSeek调用未执行，仍保持先前上游确认及本机配置门禁。下方历史HEAD、未提交记录和估时不代表当前状态。

---

# AIJ 剩余工作状态总览

更新时间：2026-11-02（Asia/Shanghai）。本文件顶部“最新队列状态”是当前规划基线；以下旧规划头和记录仅保留历史证据。
历史规划读取基线（G19-00 记录前）：`dev` / `HEAD=origin/dev=d78cc404e78ad0dd90ebc8eebfc0bd2d502bea70`；普通 `.git/index` SHA-256 `31f3785d31ec6ff81c0b4785af2e8d33cc37a76880dc2f754419cb2a99caedb4`。当时记录的工作区计数不代表当前工作区状态。
历史队列对账回执：此前从 `dbbc500368742eb685a2090a475af5e6e43252c5` 起完成一次文档对账并推送；其远端回读 `bed7e5f91b1c3383c71314a1e599eb17fb9dd754` 是历史 SHA，不是当前远端状态。详见下方历史记录及 closeout 回执。
范围：AIJ 底座队列，不包含轻企业务工作流。

统一负责人验收入口：[AIJ 已代码验证批次：统一负责人验收清单](OWNER_ACCEPTANCE_CHECKLIST.md)。该清单仅供人工复核导航，不改变 `CODING_QUEUE.json` 中的负责人验收/接收记录。

## AF-115 完成后的当前增量状态（2026-11-02）

- AF-115/G19-08 属于 NEXT-19C，现为 `CODE_VERIFIED`；隔离 PostgreSQL + 本机 HTTP、6 项集成断言、Prisma validate/generate、API build、lint、typecheck 均通过。具体命令、报告和失败修复历史见 [AF-115 执行记录](../execution/AF-115.md)。
- 本卡基线为 `dev` HEAD 与 `origin/dev` 跟踪引用 `5ec1204673a404f0c22a3be8ac30c36dcf802f99`。本卡完成后 HEAD 未变；工作区有 AF-115 实现/执行记录/队列差异及继承规划差异，未提交、未推送。普通 `.git/index` SHA-256 仍为 `28f4f5c764ddcdc793d108a5ddc571ae257a42cb1866116cbc988634356f58f0`，未被 AF-115 使用或修改。无法安全分离继承队列/G19 规划文件中的本卡差异，故未提交。
- NEXT-19A、NEXT-19B、NEXT-19C 的负责人统一验收/接收均待执行；AF-115 的代码校验、Git 状态不改变负责人验收/接收记录。`nextCardCandidate` 与 `recommendedNextBatch` 均为空；预算门禁、DeepSeek Provider、Workspace 文件导入没有获本卡授权，均未启动。

## AF-115 开工前队列基线（2026-11-02；历史快照，HEAD `5ec1204673a404f0c22a3be8ac30c36dcf802f99`）

- 分支 `dev`；本地 `HEAD` 与 `origin/dev` 跟踪引用均为 `5ec1204673a404f0c22a3be8ac30c36dcf802f99`。开始本次规划时工作区干净，`git diff --check` exit 0。普通 `.git/index` 当前 SHA-256 为 `28f4f5c764ddcdc793d108a5ddc571ae257a42cb1866116cbc988634356f58f0`；原索引 `31f3785d…` 已归档但未恢复。没有在本轮提交或推送。
- NEXT-19A/G19-01…04/AF-108…111 与 NEXT-19B/G19-05…07/AF-112…114 均为 `CODE_VERIFIED`；NEXT-19B 的代码快照包含在工作区汇总提交 `82d93552e55d17b4eaee8576452fa13606eb9f77`，随后文档对账提交 `5ec1204673a404f0c22a3be8ac30c36dcf802f99` 已推送。NEXT-19A、NEXT-19B 统一负责人验收仍为 `PENDING_UNIFIED_OWNER_CHECK`。这不是逐卡独立提交，也不是验收/接收。
- **当前无已授权的下一张实现卡。** `nextCardCandidate`、`recommendedNextBatch` 均为空；旧的 `remainingBacklog` 71 卡和 210–272 小时统计包含大量已完成任务，不能作为当前剩余开发量或启动入口。

### 按未完成事项分类

1. **依赖满足且已获准、可立即编码：无。** 当前队列明确没有下一批授权。不得把旧 Prompt 或已完成卡重新当作待开发卡。
2. **需要负责人输入后才能规划/实施：**
   - DeepSeek live：输入/输出字段 allowlist、个人/敏感数据分类、脱敏与 Trace 规则、数据保留期、DeepSeek 数据处理授权、SecretRef 配置方式、10 元预算周期与超额行为，以及 live 请求授权。
   - Workspace 文件导入：确定 `FileAsset` 与 Workspace/知识文档的唯一 owner、授权继承、删除/恢复语义、支持格式和大小限制。
   - 发行：确认许可、分发渠道、支持平台、是否允许公开发布/部署。现有本地 pack 验证不等于这些授权。
3. **代码已验证、仍待统一负责人检查：** UI-1（AF-026–029）以及 NEXT-03、04、05、06、08、09、09B、10、10B、11A、11B、12、13、14、15A、15B、16、17、17B、18A、18B、18C、19A、19B。NEXT-06 的 `owner check complete` 仍缺明确接收记录，不据此视为已接收。已明确记录接收的 UI-2、NEXT-02、NEXT-07 和 AF-025-A 不在本轮改写；AF-043/058 浏览器观察仍是未执行的负责人知情接受，不是观察通过。
4. **状态需按卡级证据继续核实、不能推断：** G0–G3 的包级状态分别为 `WAITING_ACCEPTANCE`、`CODE_VERIFIED_PENDING_OWNER_ACCEPTANCE`、`PARTIALLY_ACCEPTED`、`PARTIALLY_ACCEPTED`，需逐项映射其正式卡和负责人记录后才能定论；NEXT-01 虽含代码验证卡，整批仍为 `PROPOSED_NOT_AUTHORIZED`。队列中的其他历史/中间状态不得从代码校验、提交或推送推断验收。
5. **已识别并在队列/规划摘要中校正的冲突：** AF-103/104/107 的历史中间 Git 状态曾与执行记录、提交祖先及批次收尾记录不符；G5–G19 包级状态摘要曾落后于已完成卡；旧剩余卡数/工时及 G19B 未授权文字过期。历史快照保留并明确标注，不覆盖负责人验收记录。

### 推荐下一步

先进行统一负责人检查与人工验收准备，按上列批次逐项读执行证据，并把未做的浏览器/外部服务观察单独保留为待执行；之后负责人再选择是否批准新的开发范围。当前不推荐新建 AF 卡或开始 G19 live/file-import 代码。

### 可复制的下一节点 Prompt

```text
批准仅准备 AIJ 已代码验证批次的统一负责人验收清单；本次不实现业务代码、不启动服务或数据库、不调用外部 Provider、不分配正式 AF 编号、不提交或推送。

以当前 dev/队列及各 docs/execution/AF-*.md、注册校验报告为准，先核对 HEAD、status 和验收记录。整理所有 CODE_VERIFIED 但负责人统一检查仍待执行的批次，逐批列出需要查看的执行记录、可复现的本机步骤、实际地址/凭据获取方式、预期结果，以及未执行的浏览器或外部 live 观察。代码通过、提交或推送不得推断负责人验收/接收。AF-025-A 等已记录接收状态按原队列保留。

只更新明确过期的验收清单或状态链接，不修改 ownerAcceptanceRecords，不标记任何新验收。完成后给出按批次顺序的人工验收清单和仍需负责人决定的 DeepSeek、Workspace 文件导入、许可/发行输入，然后停止。
```

---

## 历史规划快照（以下各节记录 NEXT-19B 执行前的整理，不作为当前队列入口）

## G19B 执行前的队列结论（历史）

- NEXT-12 至 G19-00 的原连续执行已完成；G19-00 决策已提交并推送。负责人随后单独授权 NEXT-19A，G19-01…04/AF-108…111 已代码校验、提交并推送；NEXT-19A 统一负责人验收仍待执行。
- `taskExecutions` 含不同批次和重复的历史中间快照；原始状态行数量不作为去重卡数或负责人验收统计。本次只对账 NEXT-13、NEXT-11B 及明确列出的验收边界。
- NEXT-19B 的 G19-05…07/AF-112…114 已完成编号冲突扫描并登记为候选；批次仍为 `PROPOSED_NOT_AUTHORIZED`，编号登记不代表实现授权。真实 DeepSeek 和 Workspace 文件导入仍等待专属 owner 输入。
- 旧剩余工时文件已过期：`REMAINING_WORKLOAD.md` 的 107–136 小时和队列的 210–272 小时统计都包含已完成阶段，不能当成当前剩余工时。G19 的 28–44 小时只是历史粗估，需按批准范围重新估算。

## G19B 执行前的 Git 与工作区快照（历史）

| 项目 | 实际状态 |
| --- | --- |
| 分支 / HEAD | `dev` / `dbbc500368742eb685a2090a475af5e6e43252c5` |
| origin/dev | 首次推送回读 `bed7e5f91b1c3383c71314a1e599eb17fb9dd754`；补充回执推送后最终回读 `8119ddd2b9d2409f88a9e1d3190bf0f559ab0d93`，与本地 dev HEAD 一致 |
| G19-00 Git | 决策文档提交 `0a1118daa83f985a90d12adea78db27c5d52196b`；收尾记录提交 `dbbc500368742eb685a2090a475af5e6e43252c5`；均已快进推送 |
| 本节点队列对账 | `bed7e5f91b1c3383c71314a1e599eb17fb9dd754`、`8119ddd2b9d2409f88a9e1d3190bf0f559ab0d93`，标题均为“AIJ 队列状态对账”；两次均非强制推送，最终远端回读等于 HEAD |
| 普通 `.git/index` | 未恢复；SHA-256 `31f3785d31ec6ff81c0b4785af2e8d33cc37a76880dc2f754419cb2a99caedb4`。此前卡片提交使用独立索引 |
| 继承工作区差异 | 保留；本文件只新增状态摘要，不重建或清理历史差异 |
| 本文件 | 本轮在既有未跟踪草稿上更新；因完整草稿属于继承差异，保留为未跟踪，不混入本节点提交 |

本次普通 `.git/index` 不恢复、不改写；提交使用 `.artifacts/continuous/2026-11-01-to-G19/AF-107-working.index`，只暂存本节点文档路径。该隔离提交不代表工作区干净，也不覆盖其他继承差异。

## G19-00 已记录的负责人选择

| 决策项 | 当前记录 |
| --- | --- |
| 场景 / 用户 | 企业知识问答；企业客户与终端用户 |
| 数据类别 | 业务/客户数据，需服务端按已认证 workspace 隔离 |
| 模型 / Provider | DeepSeek，经服务端 SecretRef；自动验证不调用真实 Provider |
| 费用 | 10 元。未给出周期；G19-00 暂按首次评测累计上限记载，不视为长期预算 |
| 自动评测 | 20 个合成样例；答案评分通过率 ≥90%；无依据问题拒答率 100%；跨 workspace 隔离率 100% |
| 回答边界 | 只提供带来源的知识答案，不执行写操作或外部动作；使用者在业务决策前人工判断 |
| 纳入 `aij-ai-standard` | 是（作为产品范围决定，不代表许可证或发布渠道获批） |

## 尚未完成的开发与前置决策

### G19B 执行前的 AI 实现提案（历史；当前状态见首节）

G19-00 决策已记录；NEXT-19A 的 G19-01…04 / AF-108…111 均已代码校验、提交并推送。AF-111 的 20 例离线合成评测通过；NEXT-19A 负责人统一验收仍为 `PENDING_UNIFIED_OWNER_CHECK`。

本次规划把 NEXT-19B 拆为 G19-05/AF-112、G19-06/AF-113、G19-07/AF-114，分别覆盖知识文档维护 API、客户 Workspace 知识库管理页、客户知识问答页。正式编号仅在对队列分配表/历史、执行记录、verify 注册、可搜索工作区文件和提交标题扫描无占用后登记。NEXT-19B 当前为 `PROPOSED_NOT_AUTHORIZED`；不得从本规划、编号登记或 NEXT-19A 的代码/Git 状态推断已获开工授权。

候选范围、单一 owner、前置、成功/拒绝验收和复制即用 Prompt 见 [G19 后续实现规划](G19_REMAINING_IMPLEMENTATION.md)。三卡估计各 3–4 小时，批次合计 9–12 小时，只使用合成数据、隔离 test PostgreSQL、真实 loopback HTTP 和测试专用离线 Provider；不得调用真实 DeepSeek、发送客户数据或产生付费请求。

真实 Provider 评测仍等待负责人确定：允许输入/输出字段及个人/敏感数据范围、脱敏与 Trace 规则、数据保留期、DeepSeek 数据处理授权和 SecretRef 配置、10 元预算周期/超额动作及 live 调用授权。另因现有 `FileAsset` 是成员归属且 `workspaceId=null`，Workspace 文件导入须先确认文件 owner/授权契约；上述事项不属于 NEXT-19B，也未分配正式 AF 卡。

### 队列和执行记录一致性整理：本轮结果

- **NEXT-13：** 两条重复批次摘要已合并为一条规范摘要，formal mapping 为 G5-01…G5-04 → AF-083…AF-086；四卡最终记录均为代码校验及提交/推送完成，批次负责人统一检查仍待执行。较早 AF-085 `PENDING_CARD_COMMIT_AND_PUSH` 队列快照没有删除，已标明被最终 Git 收尾记录取代。
- **NEXT-11B：** AF-075…AF-079 均有代码校验和 Git 收尾证据；AF-076 注册 E2E 报告 `.artifacts/verification/AF-076/run-Ryh30Y/report.json` 记录 8/8。AF-075 的 stale `READY_FOR_CARD_COMMIT` 已按精确标题提交和 AF-076 后续推送链修正；AF-076 旧集成验收 blocker 作为已解决历史保留。统一负责人检查仍待执行。
- **AF-025-A：** 不改变队列 `ownerAcceptanceRecords`。其 2026-10-30 明确记录为负责人已接收，旧执行文档/Prompt 的“待接收”保持历史冲突并在本总览说明来源；AF-043、AF-058 的浏览器观察状态仍是 `NOT_PERFORMED_OWNER_ACCEPTED`，绝不写成观察通过。
- **NEXT-01、NEXT-06 和其他批次：** 不从 CODE_VERIFIED、commit 或 push 推断负责人验收/接收。NEXT-01 保持 `PROPOSED_NOT_AUTHORIZED`；NEXT-06 的 owner-check-complete 字段不等于正式接收。
- **G19：** G19-00 决策和 NEXT-19A/AF-108…111 已完成代码/Git 收尾，统一负责人验收仍待执行。NEXT-19B 的三张候选卡已做冲突扫描并登记 AF-112…114，但批次仍未授权；真实 Provider 与 Workspace 文件导入继续等待专属 owner 输入。

队列证据新增于 `CODING_QUEUE.json` 的 `queueReconciliationHistory`，包含来源 HEAD、归档的重复 NEXT-13 行、AF-085 中间状态说明、AF-076 blocker 的解决证据以及本轮 Git 读回限制。owner acceptance 记录保持不变。上述是状态整理，不重跑、不重新验收任何代码卡。

## 本轮校验命令与结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `node .artifacts/continuous/2026-11-01-to-G19/queue-reconciliation-snapshots/validate-queue-reconciliation.mjs`（首次） | 1 | 初版将继承工作区的 G19 候选指针假定为 G19-00，和已存在 AF-107 状态冲突；未改数据。 |
| 同上（第二次） | 1 | 初版只接受一个 G19 状态枚举，未识别队列 ownerInputBoundary 的旧文字形式；修正为检查实现授权边界。 |
| `node .artifacts/continuous/2026-11-01-to-G19/queue-reconciliation-snapshots/validate-queue-reconciliation.mjs`（最终） | 0 | JSON 可解析；NEXT-13 唯一且 4/4；NEXT-11B 5/5；AF-076 E2E 8/8；AF-085 历史/最终 Git 状态并存；18 个记录/报告路径存在；9 个提交对象及 ancestry 通过；owner 接收记录、NEXT-01/NEXT-06 和 G19 未授权边界保持。 |
| `git --no-optional-locks diff --check -- docs/execution/AF-085.md docs/planning/CODING_QUEUE.json docs/planning/AIJ_REMAINING_WORK_INDEX.md docs/planning/AIJ_REMAINING_WORK_STATUS.md` | 0 | 本节点涉及文档无 whitespace 错误。 |
| `git --no-optional-locks ls-remote origin refs/heads/dev`（普通沙箱） | 128 | SSH 到 github.com:22 返回 `Operation not permitted`；通过已授权的受控权限路径重试。 |
| 同命令（已授权本机权限路径，提交前） | 0 | 实时 origin/dev 为 `dbbc500368742eb685a2090a475af5e6e43252c5`，与本地 dev HEAD 相同，可安全做 fast-forward-only push。 |

本轮 `pnpm`、Prisma、API/Web 构建和业务测试未运行：任务仅整理队列/状态文档，未修改实现代码或 Schema。普通 `.git/index` SHA 在本节点复核仍为 `31f3785d31ec6ff81c0b4785af2e8d33cc37a76880dc2f754419cb2a99caedb4`；sidecar 暂存检查及最终 Git 回执另见 `.artifacts/continuous/2026-11-01-to-G19/queue-reconciliation-closeout.json`。

## 负责人验收与发行事项

### 明确记录为已接收

队列的负责人接收记录明确列出 UI-2、NEXT-02、NEXT-07 和 AF-025-A（2026-10-30）。其中 AF-043、AF-058 的浏览器观察注明未执行但负责人知情接收；不能写成浏览器观察通过。

### 仍需统一负责人检查

队列对 NEXT-03、NEXT-04、NEXT-05、NEXT-08、NEXT-09、NEXT-09B、NEXT-10、NEXT-10B、NEXT-11A、NEXT-11B、NEXT-12、NEXT-14、NEXT-15A、NEXT-15B、NEXT-16、NEXT-17、NEXT-17B 标注了负责人检查待执行或批次状态不完整。NEXT-18A/B/C 也没有可据以推断验收完成的统一接收记录。

实际验收应按批次执行记录逐项确认，并保留各自人工/浏览器步骤；代码通过、提交和推送都不代表验收或接收。NEXT-06 的队列字段写着 owner check complete，但没有等价的明确接收记录，本文件不扩大解释。

### 发布决策仍待负责人确认

许可、发行渠道、支持平台及是否允许公开分发仍未确定。已有 private pack/本地 consumer 验收不代表获得 publish、公开分发、部署或平台支持声明的授权。

## 历史后续顺序建议（已过时；当前顺序见首节）

1. 负责人可单独批准已规划的 NEXT-19B（AF-112…114），范围仅限合成数据、真实本地 API 和测试专用离线 Provider；NEXT-19A 验收仍待执行，不得改写。
2. 真实 DeepSeek/live 路径开始前，先确定字段 allowlist、隐私/脱敏/保留、数据处理授权、SecretRef 配置、10 元预算周期/超额动作及 live 调用授权。
3. Workspace 文件导入需先确定现有成员归属 `FileAsset` 与知识文档的 owner/权限契约。
4. 另行安排批次统一验收；明确记录未做的浏览器或外部服务步骤。
5. 另行裁定许可、分发渠道、支持平台和部署计划。

## 历史估算口径（不作当前剩余工时）

| 工作 | 可用估算 | 说明 |
| --- | ---: | --- |
| G19 全范围 | 暂估 28–44h（历史） | 旧规划值，不能作为当前剩余工时估算 |
| NEXT-19B / G19-05…07 | 9–12h | 当前候选规划；AF-112…114 已扫描/登记，批次未授权 |
| 队列一致性清理 | 未估 | 以文档核对为主，需先避免覆盖继承状态 |
| 批次负责人验收 | 未估 | 取决于人工浏览器/运行环境检查范围 |
| 发行与部署准备 | 未估 | 许可、渠道、平台和真实服务决定均未完成 |

当前没有可靠的“全部剩余工作总小时数”。不要引用旧的 107–136h 或 210–272h 作为当前预测。

## 历史资料来源与边界（规划阶段记录）

- 状态核对起点为 `CODING_QUEUE.json` 的 HEAD `dbbc500`；结论还对照 AF-075…AF-079、AF-083…AF-086 执行记录、注册报告、提交对象及本地 commit ancestry。文档修改后的最终 Git 回执见 `.artifacts/continuous/2026-11-01-to-G19/queue-reconciliation-closeout.json`.
- 历史批次验收/接收状态以明确的负责人记录为准；本轮没有新增或推断验收。存在冲突时保留旧证据并注明来源，不假造完成状态。
- 用户附图仅作为文档呈现形式参考；图中的轻企业务 09–45 节点不属于 AIJ 队列，未导入本清单。
- 本次仅新增 G19 规划卡与候选编号登记；不新增代码、Schema、数据库数据、API、权限或服务变更。候选卡未获实现授权。
