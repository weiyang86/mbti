## 2026-11-04 最新交付入口

AF-116～AF-120 五节点已完成代码验证，按节点提交推送，等待负责人一次性统一 review。[统一汇报材料](../review/REMAINING_DELIVERY_REVIEW_20261104.md)包含成果、验证、提交索引和外部待决项。预算门禁、DeepSeek适配、独立评测留存、文本文件导入和集成收尾已实现；真实DeepSeek调用未执行，仍保持先前上游确认及本机配置门禁。下方历史HEAD、未提交记录和估时不代表当前状态。

---

# AIJ 剩余开发卡索引与恢复 Prompt

更新时间：2026-11-02（Asia/Shanghai）
范围：当前队列历史批次及 G19 后续规划；此索引只整理状态与生成 Prompt，不新增实现授权，不改变负责人验收状态。

## 当前状态对账（2026-11-02；AF-115 完成后）

- 当前分支仍为 `dev`，HEAD 与本地 `origin/dev` 跟踪引用仍为 `5ec1204673a404f0c22a3be8ac30c36dcf802f99`。AF-115 开始时该提交是干净基线；当前工作区包含 AF-115 实现/记录以及之前继承的规划差异，尚未提交或推送。原 `.git/index` 未恢复；AF-115 全程未使用或修改普通索引，SHA-256 仍为 `28f4f5c764ddcdc793d108a5ddc571ae257a42cb1866116cbc988634356f58f0`。
- NEXT-19A/G19-01…04/AF-108…111、NEXT-19B/G19-05…07/AF-112…114、NEXT-19C/G19-08/AF-115 均为 `CODE_VERIFIED`。NEXT-19A/B/C 负责人统一验收/接收仍待执行；AF-115 因队列和 G19 规划文件继承差异无法安全分离，未提交、未推送。详情见 [AF-115 执行记录](../execution/AF-115.md)。
- `nextCardCandidate` 与 `recommendedNextBatch` 均为空；NEXT-19C 已完成本卡后停止，没有后续 G19 卡获批。旧的 2026-10-31 卡片表和剩余工时只作历史参考。
- 未完成事项分为：批次统一负责人检查；DeepSeek live、Workspace 文件导入与发行决定所需的负责人输入；队列中少数旧 Git/包级状态冲突（已核对并保留历史）。预算门禁、DeepSeek Provider 和 Workspace 文件导入未由 AF-115 启动。
- 机器队列 `executorInstalled=false`；Prompt 文档不是后台执行器，也不会自动恢复续跑。

> 下方详细卡片路线、估时和 Prompt 是 2026-10-31 的规划快照，可能包含已完成卡片；仅供历史范围追溯，不作为当前入口或剩余工时。开始新任务前重新核对机器队列与执行记录。

统一负责人验收入口：[AIJ 已代码验证批次：统一负责人验收清单](OWNER_ACCEPTANCE_CHECKLIST.md)。清单中的历史 URL、动态端口和账号路径以对应执行记录为准，不表示服务仍运行；代码校验、提交或推送不等于负责人验收/接收。

## 怎么用

1. 下方卡片表和连续恢复 Prompt 是历史授权/规划快照，不可直接启动。G19-00 与 NEXT-19A/B/C 已完成代码校验；当前没有下一批授权。
2. 需要单卡交接时，在对应卡片行复制 Prompt。卡片别名是唯一需选的标识；正式 AF 编号只从 `CODING_QUEUE.json` 的注册表现场核对/分配，不能猜号。
3. 本索引的卡片标题、依赖、批次预算和状态摘要以 `CODING_QUEUE.json` 为准；详细验收以 `REMAINING_TASK_PROMPTS.md` 对应小节、任务执行记录和源码 owner 为准。资料冲突时保留证据并停止，不以本索引覆盖机器状态。
4. 代码校验、提交、推送不等于负责人验收或接收。未做的人工验收、外部 live 接入、负责人专属输入必须保持待执行。

附件图片仅供“索引 + 每卡估时/源码入口/范围 + 可复制 Prompt”的呈现参考。图片中的轻企业务 09–33 节点不属于 AIJ 队列，不导入、不映射成 AIJ 任务。

## 历史开发入口快照（2026-10-31；不得作为当前状态）

**当前入口：NEXT-13 / G5-01「注册 API/DTO、身份去重和账号状态」。** NEXT-12 的 G14-01/AF-080、G14-02/AF-081、G14-03/AF-082 均已代码校验并提交、快进推送；NEXT-12 统一负责人验收仍待执行。持续队列授权允许保留该待验状态继续开发。

- AF-082 基线：`dev` @ `f80a7eab54176ac126486db7bc58fcf1e4eb247f`。最终 `dev` 与实时回读的 `origin/dev` 均为 `16345009622394723c97f1d042f34e8e6f3fade9`；仅快进推送，无强推。
- 开始证据：`.artifacts/continuous/2026-10-31-to-G19/AF-082-baseline.json`；队列授权快照：`.artifacts/continuous/2026-10-31-to-G19/queue-start.json`，SHA-256 `1813aca58714326adad067835b54cba70aeab5db8091e890ae642b1272f69960`。
- AF-082 最终完整注册校验报告为 `.artifacts/verification/AF-082/run-pVmqnu/report.json`：verify exit 0；真实 PostgreSQL/Nest HTTP 6/6、AF-081 Outbox/PostgreSQL 回归 6/6；API build、lint、typecheck、diff-check 均 exit 0。之前失败运行均留存，并在最终完整复跑中修复后通过。提交 `16345009622394723c97f1d042f34e8e6f3fade9`，推送后回读 SHA 一致。
- 规划索引 `docs/planning/AIJ_REMAINING_WORK_INDEX.md`、README、CURRENT_STATE、RELEASE_PROFILES、AF-081 执行记录及未跟踪 `REMAINING_WORKLOAD.md` 属于 AF-082 开始前的继承差异，保留在工作区且不包含在 AF-082 提交中。队列有意保留继承变更，只提交了 AF-082 的定向队列状态。
- 机器 `automationState` 标为 `NOT_CONFIRMED`，其中旧 `currentCard` 仍写 G13-04A/AF-077；它不是当前活动卡证据，也不能证明后台续跑在运行。不要创建重复 Writer/自动化。
- AF-025-A、NEXT-02、NEXT-07 及其他历史验收/接收记录均按队列现状保留；不得由本批代码结果反推或覆盖。

## 已完成，不列为剩余开发

| 范围 | 现有记录 | 后续处理 |
| --- | --- | --- |
| NEXT-12 / G14-01 / AF-080 | `CODE_VERIFIED`，提交推送 | 不重做；与 AF-081 同属 NEXT-12，批次验收仍按队列。 |
| NEXT-12 / G14-02 / AF-081 | `CODE_VERIFIED`，提交 `f80a7eab54176ac126486db7bc58fcf1e4eb247f` | 已有推送回读记录；负责人统一验收仍待执行。 |
| NEXT-11B / AF-075…AF-079 | 执行记录显示代码校验/提交推送完成 | 仅作为 NEXT-12 前置；不重复实现，不扩大负责人验收状态。 |
| NEXT-01…NEXT-11A、G4…G13 | 状态分散在队列与各执行记录 | 有待验项按原记录保留；开发入口从当前 G14-03 开始，不为整理文档重跑任务。 |

## 剩余工作一览

下表是 **2026-10-31 历史快照**：当时列 27 张任务卡，AF-082 已代码校验、提交并推送，表内余下 26 张从 NEXT-13 到 G19-00。其 65–86 小时是当时排程估计，不是当前剩余工时，也不含 G19 后续实现。当前 G19 候选工时与状态见 [G19 后续实现规划](G19_REMAINING_IMPLEMENTATION.md)。单卡拆分估时只用于排程，不替代开卡后的真实估算；单卡不超过 4 小时，预计超限先拆卡。

| 顺序 | 批次 / 卡片 | 正式 AF | 卡片规划估时 | 依赖 | owner / 源码入口（开卡复核） | 目标与关键验收 |
| ---: | --- | --- | ---: | --- | --- | --- |
| ✓ | NEXT-12 / G14-03 | AF-082 | 完成 | AF-081；NEXT-05、NEXT-10B | 通知唯一 owner：`apps/api/src/plugins/aij-notification/**`；复用 SecretRef、ScopedConfig、AuditLog、插件生命周期 | `CODE_VERIFIED`，提交并推送 `16345009622394723c97f1d042f34e8e6f3fade9`；负责人统一验收仍待执行。 |
| 2 | NEXT-13 / G5-01 | 开卡分配 | 2–2.5h* | NEXT-03、NEXT-12 | 客户身份 owner：`apps/api/src/client-auth/**`；定向核对 SecretCenter/通知端口 | 注册 DTO/状态/身份唯一性；匿名请求不能授予管理或租户权限；真实 DB/HTTP 覆盖合法与重复身份拒绝。 |
| 3 | NEXT-13 / G5-02 | 开卡分配 | 2–2.5h* | G5-01 | 同上；令牌模型由 ClientAuth 唯一拥有 | 单次验证令牌仅存哈希，绑定用途/有效期/项目；覆盖过期、重放、错误用途、限流和账号枚举防护。 |
| 4 | NEXT-13 / G5-03 | 开卡分配 | 2–2.5h* | G5-01、G5-02 | 同上；复用通知端口 | 找回/重设密码、重新认证、旧会话撤销和去敏审计；真实 DB/HTTP 验证旧凭据拒绝。 |
| 5 | NEXT-13 / G5-04 | 开卡分配 | 2–2.5h* | G5-01…G5-03 | ClientAuth + 实际 Web consumer；按现有路由定位 | 注册→验证→登录→找回真实闭环；Provider fixture 仅验证协议，不作为短信/邮件送达证据；外发 live 留人工。 |
| 6 | NEXT-14 / G6-05 | 开卡分配 | 2–2.5h* | NEXT-03、NEXT-13 | 管理 API / Web 唯一 owner；现有成员管理路由与 `apps/web/app/admin/**` 定向定位 | 客户列表/状态、分页和最小只读会话/同意摘要；权限在服务端控制，不新增未经批准的导出/删除。 |
| 7 | NEXT-14 / G6-06 | 开卡分配 | 2–2.5h* | G6-05 | 同上 | 客户详情与受控状态管理；只消费已存在 API，响应去敏，成功/403/不存在路径真实验证。 |
| 8 | NEXT-14 / G6-07 | 开卡分配 | 2–2.5h* | G6-05、G6-06 | ClientAuth 会话/同意 owner + 管理 API | 会话/同意查询与受控撤销；敏感操作重新认证、只影响本项目、审计可追溯。 |
| 9 | NEXT-14 / G6-08 | 开卡分配 | 2–2.5h* | G6-05…G6-07 | Web 宿主 + RBAC/API owner | 普通/高权限角色浏览器矩阵、敏感信息去敏；UI 隐藏不能替代 API Guard，未执行浏览器步骤标待验。 |
| 10 | NEXT-15A / G15-01 | 开卡分配 | 3–4h* | NEXT-05、NEXT-10B | `aij-ai`：`apps/api/src/plugins/aij-ai/**`，复用 AsyncRuntime/SecretCenter | Provider/模型合同、SecretRef 与能力开关；预算和插件未启用时服务端 fail-closed；不连付费模型。 |
| 11 | NEXT-15A / G15-02 | 开卡分配 | 3–4h* | G15-01 | `aij-ai` +唯一队列 owner | 异步执行、幂等/取消/超时状态机；真实 DB/队列覆盖成功、重复、取消、超时和拒绝。 |
| 12 | NEXT-15B / G15-03 | 开卡分配 | 3–4h* | NEXT-15A | `aij-ai` Trace/Cost 唯一 owner | Trace 关联、输入输出脱敏、失败分类、成本真值 owner；不能从日志推算或重复记账。 |
| 13 | NEXT-15B / G15-04 | 开卡分配 | 3–4h* | G15-03 | 同上；复用 Provider 合同与队列 | 合成 Provider + 真实 DB/队列覆盖失败/重试/预算拒绝、Trace/Cost 幂等和恢复；禁止付费调用。 |
| 14 | NEXT-16 / G16-01 | 开卡分配 | 2.5–3h* | NEXT-15B | `apps/api/src/plugins/aij-ai/**` + `apps/web/app/plugins/aij-ai/**` | Provider/模型配置管理和权限；仅显示 SecretRef/configured 状态，API 强制 RBAC。 |
| 15 | NEXT-16 / G16-02 | 开卡分配 | 2.5–3h* | G16-01 | 同上 | Trace/Cost 分页查询、过滤、去敏与审计；验证匿名/普通角色拒绝。 |
| 16 | NEXT-16 / G16-03 | 开卡分配 | 2.5–3h* | G16-01、G16-02 | AI API/Web 单一 owner | 授权/撤权、预算、插件停用的端到端门禁；数据库结果与权限响应一致。 |
| 17 | NEXT-16 / G16-04 | 开卡分配 | 2.5–3h* | G16-01…G16-03 | 同上 + AsyncRuntime | Provider 缺失、超预算、队列失败与撤权恢复；失败闭合、无敏感日志、无真实模型调用。 |
| 18 | NEXT-17 / G17-01 | 开卡分配 | 3–4h* | NEXT-05、NEXT-10B | Integration owner：`apps/api/src/integration-center/**`；复用 SecretCenter/AsyncRuntime | Connector manifest、scope、SecretRef、allowlist；未注册/未授权 connector 拒绝。 |
| 19 | NEXT-17 / G17-02 | 开卡分配 | 3–4h* | G17-01 | Integration 唯一入站事件 owner | Webhook 签名、时间窗、防重放与幂等；真实 HTTP/DB 覆盖合法、伪造、过期、重复。 |
| 20 | NEXT-17 / G17-03 | 开卡分配 | 3–4h* | G17-01、G17-02 | Integration + 实际宿主 | 失败重试/操作查询/管理权限；权限拒绝、审计去敏、失败恢复真实验证；不联系第三方。 |
| 21 | NEXT-17B / G17-04 | 开卡分配 | 2–4h | NEXT-17 | 沿用 Integration/SecretRef 唯一 owner | 引用轮换后新请求取新值；旧明文不入库/日志；停用 connector 对新请求拒绝并明确 in-flight 策略。 |
| 22 | NEXT-18A / G18-01 | 开卡分配 | 3–4h* | NEXT-05、NEXT-10B | `aij-payment`：`apps/api/src/plugins/aij-payment/**`；支付状态唯一 owner | 支付合同、订单/尝试/交易边界；金额、币种和身份由服务端校验，状态唯一写入。 |
| 23 | NEXT-18A / G18-02 | 开卡分配 | 3–4h* | G18-01 | 同上 + AsyncRuntime | 创建/查询支付请求及幂等；真实 DB/HTTP 验证合法、金额/身份伪造拒绝、重复请求稳定；不扣款。 |
| 24 | NEXT-18B / G18-03 | 开卡分配 | 3–4h* | NEXT-18A | `aij-payment` 回调/交易 owner | 回调签名/时间窗/防重放/状态机与审计；真实 HTTP/DB 验证伪造、重放、非法跃迁拒绝。 |
| 25 | NEXT-18B / G18-04 | 开卡分配 | 3–4h* | G18-03 | Payment 管理 API/Web | 管理查询与 RBAC；退款只建受控人工申请，不执行资金操作；审计去敏。 |
| 26 | NEXT-18C / G18-05 | 开卡分配 | 2–4h | NEXT-18B | 沿用 aij-payment 对账 owner | 合成轨迹匹配/缺失/重复/金额状态差异；人工处理要授权并留审计，不能覆盖交易真值。 |
| 27 | NEXT-19 / G19-00 | 开卡分配 | 1–2h | 负责人场景输入 | 规划文档；不预设业务源码 owner | 只做高级 AI 场景决策：用户/权限、数据边界、Provider/模型、成本、人工确认、评测样本和阈值；不实现 AI。 |

`*` 表示由批次区间拆分出的规划估时，并非队列登记的正式卡片预算。正式 estimates 仍以队列为准，开卡后按真实范围复核；不可通过缩小估时跳过 4 小时拆卡规则。

## 复制即可恢复的 Prompt

### 连续恢复 Prompt（历史授权快照，已过期，不要直接复制启动）

```text
此块记录的是 2026-10-31 的历史授权。当前不可据此自动恢复 NEXT-12…19，也不能越过 G19-00 开始 G19 实现。现在 G19-00 和 NEXT-19A 已完成；只有负责人明确批准 NEXT-19B 后，才可按 [G19 后续实现规划](G19_REMAINING_IMPLEMENTATION.md) 开工。

按冻结顺序自动继续下一张卡，不逐卡等待确认。每卡只实现其注册范围，复用现有唯一 owner；登记真实 verify:task 成功/拒绝/恢复路径，运行真实 DB/HTTP/文件/队列场景和适用 lint、typecheck、Prisma、构建，失败修复并完整重跑。每卡更新 docs/execution/AF-编号.md 和 CODING_QUEUE.json，当前状态/契约变化时更新对应文档；不得把未运行写成通过，不推断负责人验收/接收。

历史授权每卡不超过4有效工程小时、每批不超过4卡/12小时；本段不再构成当前开发授权。轻企仓库/数据库只读，不清库或停止无关服务；G19 当前入口以 [NEXT-19B 规划](G19_REMAINING_IMPLEMENTATION.md) 为准，必须先取得明确批次授权。
```

### 单卡 Prompt 的五个固定门

单卡交接只需把 `{卡片别名}` 改成下表中的 Gx-xx，完整范围从 `CODING_QUEUE.json` 和 `REMAINING_TASK_PROMPTS.md` 读取：

```text
恢复已有 AIJ continuousQueueRun，仅核对并执行当前队列下一张卡 `{卡片别名}`；不得跳卡或扩展任务。先检查实际分支/HEAD/status/diff、前置 CODE_VERIFIED、唯一 owner 与 formalTaskIdAssignments；AF 编号未分配时只在确认空闲后登记。严格按队列和 REMAINING_TASK_PROMPTS.md 中该卡的范围实施，不复制已有 owner。

五项完成条件：1) 基线、依赖、owner、正式编号可核验；2) 注册该卡真实命令/文件/前置条件并通过真实成功与拒绝路径；3) 运行适用 lint/typecheck、Prisma、构建及 DB/HTTP/文件/队列门禁，失败修复后完整重跑；4) 更新 docs/execution/AF-编号.md、CODING_QUEUE.json 与必要契约文档，未执行/人工项如实待办；5) 只安全隔离本卡差异后按任务原标题本地提交，并仅按既有 continuousQueueRun 规则快进推送/回读。任何阻塞留证并停止，不虚报，不改变负责人验收状态。
```

### 每卡可复制 Prompt（顺序即队列顺序）

以下提示只定位卡片，不复制队列正文；执行者仍须读取该卡完整范围和验收。依赖未满足时 Prompt 的结果应是阻塞，而非跳过。

#### NEXT-13：客户注册与找回

```text
仅定位并执行当前队列下一卡 G5-01「注册 API/DTO、身份去重和账号状态」；之后的 G5-02…04 只在依赖达成且连续授权仍有效时继续。按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G5-02「一次性验证令牌：用途、哈希、有效期、限流和账号枚举防护」。先确认 G5-01 CODE_VERIFIED；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G5-03「忘记密码/重设、旧会话撤销与去敏审计」。先确认 G5-01/02 CODE_VERIFIED；自动化只用合成凭据，不发真实消息；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G5-04「注册→验证→登录→找回真实闭环」。先确认 G5-01…03 CODE_VERIFIED；fixture 不代表真实短信/邮件送达；按本索引单卡 Prompt 五项门执行。
```

#### NEXT-14：客户管理页面

```text
仅定位并执行 G6-05「客户列表、状态与最小只读会话/同意视图」。先确认 NEXT-03、NEXT-13 依赖并复用真实 API；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G6-06「客户详情与受控状态管理」。先确认 G6-05 CODE_VERIFIED；只消费已有 API，不新建第二个 Service owner；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G6-07「会话/同意查询与受控撤销、重新认证和审计」。先确认 G6-05/06 CODE_VERIFIED；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G6-08「权限矩阵、客户角色浏览器验收和信息去敏」。先确认 G6-05…07 CODE_VERIFIED；没实际执行的浏览器步骤保持待验；按本索引单卡 Prompt 五项门执行。
```

#### NEXT-15A：AI Provider 与异步执行

```text
仅定位并执行 G15-01「AI Provider/模型合同、SecretRef、能力开关和预算拒绝」。复用唯一 AI/SecretCenter owner，不调用真实付费模型；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G15-02「AI 异步执行、幂等/取消/超时状态机」。先确认 G15-01 CODE_VERIFIED；真实 DB/队列运行成功与拒绝路径，不重复造 Runtime owner；按本索引单卡 Prompt 五项门执行。
```

#### NEXT-15B：AI Trace 与 Cost

```text
仅定位并执行 G15-03「Trace 关联、敏感内容脱敏、失败分类与 Cost 唯一 owner」。先确认 NEXT-15A CODE_VERIFIED；成本不得从日志估算；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G15-04「AI 成功/失败/重试/预算拒绝和持久化回归」。先确认 G15-03 CODE_VERIFIED；真实 DB/队列加离线 Provider fixture，不调用真实模型；按本索引单卡 Prompt 五项门执行。
```

#### NEXT-16：AI 管理与组合门禁

```text
仅定位并执行 G16-01「模型/Provider 配置与权限页面」。先确认 NEXT-15B CODE_VERIFIED；页面/API 只展示 SecretRef 状态，不展示密钥；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G16-02「Trace/Cost 分页查询、脱敏与审计」。先确认 G16-01 CODE_VERIFIED；真实 HTTP/DB 覆盖权限成功/拒绝；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G16-03「角色、预算、插件停用的端到端组合回归」。先确认 G16-01/02 CODE_VERIFIED；服务端权限不得依赖 UI 隐藏；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G16-04「Provider 缺失、超预算、队列失败和撤权后的失败闭合及恢复」。先确认 G16-01…03 CODE_VERIFIED；按本索引单卡 Prompt 五项门执行。
```

#### NEXT-17 / NEXT-17B：Integration

```text
仅定位并执行 G17-01「Connector manifest、scope、SecretRef 和 allowlist」。复用 Integration/SecretCenter owner；不加入特定客户业务；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G17-02「Webhook 签名、时间窗、防重放与幂等入站」。先确认 G17-01 CODE_VERIFIED；真实 HTTP/DB 测合法、伪造、过期、重复；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G17-03「Integration 失败重试、操作查询和管理权限」。先确认 G17-01/02 CODE_VERIFIED；不联系第三方；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G17-04「SecretRef 轮换、Connector 停用和进行中事件策略」。先确认 NEXT-17 CODE_VERIFIED；只使用合成密钥引用，按本索引单卡 Prompt 五项门执行。
```

#### NEXT-18A / NEXT-18B / NEXT-18C：支付

```text
仅定位并执行 G18-01「支付 Provider 合同与订单/尝试/交易唯一 owner」。禁止真实支付 Provider；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G18-02「创建/查询支付请求与服务端金额、身份、幂等验证」。先确认 G18-01 CODE_VERIFIED；真实 DB/HTTP，只用离线 Provider fixture，不扣款；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G18-03「支付回调验签、防重放、幂等状态机和审计」。先确认 NEXT-18A CODE_VERIFIED；不连接生产 Provider；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G18-04「管理员支付查询与人工退款申请入口」。先确认 G18-03 CODE_VERIFIED；只记录授权人工申请，不发起付款/退款；按本索引单卡 Prompt 五项门执行。
```
```text
仅定位并执行 G18-05「合成支付轨迹对账与差异处理审计」。先确认 NEXT-18B CODE_VERIFIED；不执行资金操作；按本索引单卡 Prompt 五项门执行。
```

#### NEXT-19 历史场景决策边界（后续状态见本文件顶部）

```text
仅执行 G19-00「高级 AI 场景决策」，不实现业务、不调用模型。先收集负责人确定的场景、目标用户/权限、数据边界、Provider/模型、成本上限、人工确认点和评测样本/通过阈值；输入缺失就记录阻塞并停止。决策完成后另行拆卡、估时、授权，不自动越过 G19。
```

## G19 后续范围（本节以下为 2026-10-31 历史快照）

本段记录 G19B 获批前的决策边界。此后 NEXT-19A/B 已代码校验；当前没有后续 G19 批次授权。live Provider、Workspace 文件导入和发行边界仍需负责人输入，详见本文件顶部及 [G19 后续实现规划](G19_REMAINING_IMPLEMENTATION.md)。本地 pack 不代表 publish、公开分发、许可证认定或部署授权。

## 自动化与 Git 状态

- 当前聊天可按已批准队列恢复，但队列的后台自动化仍为 `NOT_CONFIRMED`，不能承诺无人值守续跑。
- 持续队列快照登记逐卡标题提交与 dev 快进 push；只有逐卡代码/文档校验全部通过、差异可隔离、实时远端读取确认可快进并回读 SHA，才执行对应 Git 节点。遇到远端不可达，不虚报同步，也不强推。
- 不连接轻企数据库，不写共享/正式库；数据库校验只用本库隔离测试目标与合成数据。不得 reset/drop/down-v、清卷或停止无关服务。真实短信/邮件、付费模型、付款/退款和第三方 live 均留负责人。

## 上次规划索引更新记录（2026-10-31）

本次重写此索引文档，并在同一已授权连续任务中恢复 AF-082：修复真实 HTTP 路径与 fixture/lint 问题，完整注册校验通过，按任务标题提交并快进推送；最终执行记录与队列已登记 Git 结果。NEXT-12 负责人统一验收保持待执行。此索引不替负责人验收或接收，也未包含在 AF-082 的卡片提交中。

- 机器队列：[CODING_QUEUE.json](CODING_QUEUE.json)
- 详细卡片与历史 Prompt：[REMAINING_TASK_PROMPTS.md](REMAINING_TASK_PROMPTS.md)
- 当前状态：[CURRENT_STATE.md](../current/CURRENT_STATE.md)
- 最近完成卡：[AF-082](../execution/AF-082.md)
- 下一候选卡：NEXT-13 / G5-01；正式 AF 编号需在开卡时检查注册表并分配。
- AF-082 最终注册校验报告：`.artifacts/verification/AF-082/run-pVmqnu/report.json`
- 上游独立 consumer 与项目恢复验收：[AF-076](../execution/AF-076.md)
