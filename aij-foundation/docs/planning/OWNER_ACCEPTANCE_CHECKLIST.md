# AIJ 已代码验证批次：统一负责人验收清单

更新时间：2026-11-02（Asia/Shanghai）

## 范围与状态原则

本清单按 `dev` 上的 `docs/planning/CODING_QUEUE.json` 与对应执行记录编制。当前 HEAD 为 `5ec1204673a404f0c22a3be8ac30c36dcf802f99`；开始时工作区已有规划差异，检查时工作副本队列 SHA-256 为 `aea86928c0933128fca003e0cd6bf9e0b69cbe305534f8bbc1e5153706d38f73`。本清单以开始时工作副本中的队列为准；本任务没有修改队列。工作区原有规划差异保留；本文件只提供验收导航，不改变机器队列、负责人接收记录或任务历史。

- 待统一负责人检查：UI-1，以及 NEXT-03、04、05、06、08、09、09B、10、10B、11A、11B、12、13、14、15A、15B、16、17、17B、18A、18B、18C、19A、19B。
- `CODE_VERIFIED`、本地提交和推送只表示代码/同步状态，不等于负责人验收或接收。每批应逐项对照执行记录和其中链接的最终校验报告；没有实际人工/外部观察的项目继续保持待执行。
- NEXT-06 虽写有 `owner check complete`，队列未记录独立的正式接收结论，故本清单仍列入待负责人明确确认。
- UI-2、NEXT-02、NEXT-07、AF-025-A 的现有负责人接收记录不在待验批次中，本清单不重做、不改写。AF-043/AF-058 的浏览器观察曾记录为未执行但负责人知情接收，不是浏览器观察通过。
- NEXT-01 仍为 `PROPOSED_NOT_AUTHORIZED`；G0–G3 仍有包级待验/部分验收摘要，卡级映射未核实。两者不冒充可验收批次，也不据此分配后续工作。

## 操作前统一检查

1. 从该批次行进入各卡 `docs/execution/AF-编号.md`，核对范围、Owner、最终注册报告、失败后完整重跑结果和未完成项。报告链接在每份执行记录中；以最终完整运行报告为准，不把早期失败报告当成通过。
2. 本次没有检查或启动 Web/API；以下 URL 中的动态端口均为执行记录里的短时校验地址，执行完已关闭。固定端口 `http://127.0.0.1:3655`（Web）和 `http://127.0.0.1:3656`（API）只是本地约定，不能据此判断当前有服务。
3. 若负责人另行决定进行浏览器操作，先核验监听端口及 PID、PPID、CWD、完整命令，再决定是否使用。不要停止身份不明或继承的进程。页面路由是目标地址，不代表当前可达。
4. 账号只通过执行记录指向的本机忽略文件或负责人既有安全配置取得。不要把密码、Cookie、OTP、Token 或密钥贴入聊天、文档、截图或报告。测试账号可能绑定随机临时数据库，不能直接假设能登录当前宿主。
5. 本清单没有启动任何服务/数据库、发送邮件短信、调用真实 AI/支付 Provider，或对验收状态作任何写入。

## 按队列顺序检查

每行的执行记录包含该批全部卡片的最终校验报告路径；“记载地址”是历史证据地址，不表示现在仍运行。

### UI-1 — 管理员登录、会话与浏览器消费

- 卡片：AF-026–AF-029。记录：[AF-026](../execution/AF-026.md)、[AF-027](../execution/AF-027.md)、[AF-028](../execution/AF-028.md)、[AF-029](../execution/AF-029.md)。
- 负责人操作：若确认本机 UI-1 服务仍由本项目运行，访问 `/login`，检查空/错误密码提示；用合成管理员登录、刷新、退出，再直接访问 `/admin`，预期退出后回到登录页；过期 Cookie 应失效。执行记录已有 Codex 的浏览器观察，但仍不是负责人的统一验收。
- 记载地址：`http://localhost:3655/login`、`http://localhost:3655/admin`；均是 2026-10-27 记录地址，不是当前可达证明。旧 PID 56810/57053 也只是历史身份，不可据此操作。
- 合成账号：用户名 `aij-admin`；初始口令记录位置为忽略文件 `.local-data/seed/test/aij_foundation_af029_test_b256f19c7593d266/initial-admin.json`。仅在本机安全查看，不复制或回报内容；先确认对应验收库/账号仍存在。
- 预期：Cookie 会话可刷新保持；退出/过期后受保护页不能继续使用旧会话；Bearer/Cookie、Origin 与 CSRF 契约按 [管理员浏览器指南](../development/ADMIN_BROWSER_AUTHENTICATION.md) 检查。

### NEXT-03 — 客户登出、改密与同意记录

- 卡片：G4-01/AF-039、G4-02/AF-040、G4-03/AF-041。记录：[AF-039](../execution/AF-039.md)、[AF-040](../execution/AF-040.md)、[AF-041](../execution/AF-041.md)。
- 负责人操作：此批没有保留的人工 Web/API 服务或账号。只有确认本项目 API 当前由负责人安全启动后，才使用其本机 API 基址检查 `/api/client/auth/consents`（GET/PATCH）；验证同版本重复提交幂等、撤回留下 `granted=false` 历史；再验证登出/撤销和改密后旧会话失效、重新认证及限流。
- 记载地址：配置目标为 `127.0.0.1:3656`，不是当前服务声明。账号/密码没有为统一人工检查准备；不得借用跨批次临时数据库账号。
- 预期：未登录/错误产品身份拒绝；合法 consent 可读取、创建、撤回且重复提交不重复写入；改密后旧 Cookie/会话失效。AF-039 的代码交付曾获负责人代码级确认，但 NEXT-03 的统一人工验收仍 pending。
- 未做观察：负责人浏览器中的本地操作尚未执行；本批不涉及真实外部服务。

### NEXT-04 — 安全文件存储与客户文件管理

- 卡片：AF-045–AF-048。记录：[AF-045](../execution/AF-045.md)、[AF-046](../execution/AF-046.md)、[AF-047](../execution/AF-047.md)、[AF-048](../execution/AF-048.md)。
- 负责人操作：AF-048 给出的页面路由目标为 `/auth/files`，客户 API 为 `GET /api/client/files?page=1&pageSize=20`。服务和账号均未为人工验收保留；只在固定端口服务归属确认后，用负责人本机管理员和客户合成会话观察。
- 地址/凭据：`http://127.0.0.1:3655/auth/files` 是历史目标路由，不保证可达。没有人工账号文件；使用负责人安全配置的管理员，客户侧需使用相应隔离 test 账号。
- 预期：管理员只能读取项目通用文件，下载内容字节完整；客户只看本人文件；跨项目 ID 为 404，missing/corrupt 文件不能下载；菜单和 API 均要求后端权限。
- 未做观察：AF-048 明确未运行人工准备钩子；历史 3655/3656 占用记录不可直接沿用。不得读写轻企文件。

### NEXT-05 — 客户注册、验证、找回及 Runtime Readiness

- 卡片：AF-049–AF-052。记录：[AF-049](../execution/AF-049.md)、[AF-050](../execution/AF-050.md)、[AF-051](../execution/AF-051.md)、[AF-052](../execution/AF-052.md)。
- 负责人操作：本批没有常驻人工入口、人工账号或固定 URL。以执行记录和真实 DB/HTTP 最终报告验收注册、单次令牌、找回、限流、Ready 状态和拒绝路径；不把自动测试当浏览器验收。
- 地址/凭据：无当前可访问地址；不提供人工密码。自动验证所用账号为隔离合成账号。
- 预期：未知账号找回响应不可枚举；令牌单次、限期、重放拒绝；错误凭据/限流按文档返回；服务 readiness 对真实依赖失败闭合。
- 未做观察：无浏览器/邮件送达观察；不得触发真实邮件或短信。

### NEXT-06 — 客户 Workspace 与身份隔离

- 卡片：AF-053–AF-056。记录：[AF-053](../execution/AF-053.md)、[AF-054](../execution/AF-054.md)、[AF-055](../execution/AF-055.md)、[AF-056](../execution/AF-056.md)。
- 负责人操作：无持久 Web/API 地址或人工账号。检查 AF-053 的 Schema/所有权证据及 AF-056 的真实 test PostgreSQL/HTTP 报告；重点核对匿名 401、非成员/跨 Workspace 403/404、伪造 workspace/role/permission 不提升权限、管理员与客户认证不能互换。
- 地址/凭据：AF-056 只用 OS 临时 loopback 端口并已关闭；其数据库 `aij_foundation_af056_test_53c38c268373df84` 是合成验收库，不是负责人登录凭据。
- 状态提示：队列称 owner check complete，但没有正式独立接收记录；负责人需明确确认，而不是默认本批已接收。

### NEXT-08 — Runtime、SDK 与 UI 包边界

- 卡片：AF-059–AF-062。记录：[AF-059](../execution/AF-059.md)、[AF-060](../execution/AF-060.md)、[AF-061](../execution/AF-061.md)、[AF-062](../execution/AF-062.md)。
- 负责人操作：无登录/浏览器服务。查看执行记录中的 workspace consumer、packed tarball、ESM/CJS、types、依赖和 API/Web 宿主构建证据；确认唯一包 owner 与实际 consumer。
- 地址/凭据：无 HTTP 地址、无账号、无密钥需求。
- 预期：本地包实际安装、导入、类型解析和 consumer build 有运行证据；失败/不兼容依赖路径拒绝。不是 publish 或许可通过。
- 未做观察：没有浏览器 UI 人工观察。

### NEXT-09 — Workspace/packed package 双模式消费

- 卡片：AF-063–AF-065。记录：[AF-063](../execution/AF-063.md)、[AF-064](../execution/AF-064.md)、[AF-065](../execution/AF-065.md)。
- 负责人操作：审查 workspace link 与 tarball consumer 报告和 `consumer-WCUgkU/evidence.json`。AF-064 另有一个未完成的可视检查：负责人在自己的本地 Web 正常运行后检查实际 `PageHeading`/公共组件的标题布局与消费者显示。
- 地址/凭据：AF-064 没有启动固定地址服务；没有人工账号。不得把通用 3655 端口写成当前运行地址。
- 预期：同一公开包接口能以 workspace 和本地 tarball 两种方式被真实宿主消费；版本/peer dependency 和类型入口一致。
- 未做观察：AF-064 浏览器视觉验收未执行；NEXT-08 与 NEXT-09 负责人检查仍 pending。

### NEXT-09B — 跨 workspace 与 packed consumer 兼容矩阵

- 卡片：G12-08/AF-066。记录：[AF-066](../execution/AF-066.md)，报告在该记录链接的 `run-99DMlC`。
- 负责人操作：复核隔离 consumer 的本地 pack 安装、ESM/CJS/type resolution、版本/依赖矩阵及拒绝路径报告。
- 地址/凭据：没有 HTTP 服务、浏览器入口或账号；不需要密钥。
- 预期：workspace 与 packed 安装均由真实 consumer 导入、构建；不兼容版本明确拒绝。
- 未做观察：无浏览器观察；NEXT-08/NEXT-09 的统一验收仍 pending。

### NEXT-10 — 插件目录、生命周期与管理 API

- 卡片：AF-067–AF-070。记录：[AF-067](../execution/AF-067.md)、[AF-068](../execution/AF-068.md)、[AF-069](../execution/AF-069.md)、[AF-070](../execution/AF-070.md)。
- 负责人操作：AF-070 记录的 API 路由为 `GET /api/admin/plugins`，并以受信任测试插件执行 install/enable、读取 operations、disable。只有在负责人准备的本机服务中操作；预期匿名 401、普通角色 403、禁用后插件路由不可用。
- 地址/凭据：本机 API 约定 `127.0.0.1:3656`；此批没有保留运行中的服务或账号。使用本机安全配置的合成管理员/普通角色，不回显密码。
- 预期：只对注册目录中的插件执行受控生命周期，非法插件/版本拒绝，失败状态与审计去敏。
- 未做观察：没有负责人浏览器会话；不调用真实 Provider/Secret、外部服务或任意脚本。

### NEXT-10B — 插件依赖、升级回滚与恢复

- 卡片：AF-071–AF-072。记录：[AF-071](../execution/AF-071.md)、[AF-072](../execution/AF-072.md)。
- 负责人操作：只需核对测试报告/执行记录中版本兼容拒绝、事务回滚、幂等重试和恢复断言；AF-072 没有新增 HTTP 页面或路由。
- 地址/凭据：无持久人工地址/账号；无真实 Provider/短信/邮件调用。
- 预期：缺依赖/失败升级不留下半启用状态；重试不重复变更；恢复后旧密钥或停用状态按契约处理。
- 未做观察：无浏览器观察。

### NEXT-11A — 项目生成与双项目隔离

- 卡片：AF-073–AF-074。记录：[AF-073](../execution/AF-073.md)、[AF-074](../execution/AF-074.md)。
- 负责人操作：优先查看 AF-074 两个项目的 summary/校验报告；如需复现，负责人之后可运行记录中的 `pnpm run verify:task -- AF-074`，它会建立并停止本卡自有合成项目/API/DB。
- 记载地址：历史运行 Web `http://127.0.0.1:61066`、`:61068`；API `http://127.0.0.1:61067`、`:61069` 的 health/ready 路由。均已停止、当前不可访问；无账号/密码提供。
- 预期：projectId、issuer、cookie prefix、存储根与数据库身份不同；文件/记录/Token/Cookie 交叉读取和认证拒绝；health/readiness 与两个隔离项目实际连接一致。
- 未做观察：没有浏览器 UI，也没有发行包/外部 Provider 观察。

### NEXT-11B — packed consumer 升级、readiness 与备份恢复

- 卡片：AF-075、AF-076、AF-077、AF-078、AF-079。记录：[AF-075](../execution/AF-075.md)、[AF-076](../execution/AF-076.md)、[AF-077](../execution/AF-077.md)、[AF-078](../execution/AF-078.md)、[AF-079](../execution/AF-079.md)。
- 负责人操作：核对 AF-076 当前状态章节与最终 `run-Ryh30Y` 报告；重点看 packed consumer 实际安装、迁移、数据库/文件恢复、错误迁移拒绝、health/readiness 断库与恢复。AF-076/078 的宿主均已停止。
- 记载地址：AF-076 短时 API `http://127.0.0.1:37266/api/health`、`/api/ready`，Web `http://127.0.0.1:37265/`；AF-078 短时 API `http://127.0.0.1:37256/api/health`、`/api/ready`，Web `http://127.0.0.1:37255/`。均不可当作当前运行服务。无账号/真实凭据需求。
- 预期：安装物确为本地 private tarball 且 consumer 在 checkout 外；上一 Schema 到当前迁移成功；备份恢复后的记录/文件内容/hash 一致；ready 随 DB 断开/恢复呈 503/200，liveness 不伪装 DB ready。
- **记录冲突待核实：** AF-076 文件顶部 2026-10-31 当前状态及最终 E2E 报告说原端到端已通过；该文件下方保留的早期历史段落、以及 AF-079 当前收尾段仍有“AF-076 未完成”的旧表述。队列将 NEXT-11B 标为 code-verified/pushed，但负责人统一验收仍 pending。本清单不改写这些历史；验收应以 AF-076 标注的最新章节和最终报告为主，并在任何状态变更前先由负责人确认冲突。
- 未做观察：本批没有仍运行的人工消费者/页面；许可、发布渠道、公开分发、部署及平台支持不在该批本地 private pack 授权内。

### NEXT-12 — 通知配置与 Outbox

- 卡片：AF-080–AF-082。记录：[AF-080](../execution/AF-080.md)、[AF-081](../execution/AF-081.md)、[AF-082](../execution/AF-082.md)。
- 负责人操作：没有页面或留存服务。需要检查 API 时，先自行确认 API 宿主身份，再访问本机目标 `http://127.0.0.1:3656/api/admin/notifications/status`；仅用测试 SecretRef 查看/设置/轮换/清除配置。使用拥有 `admin.plugin.manage`/配置权限的本机管理员，并核对只读角色拒绝。
- 地址/凭据：3656 是操作目标，不是当前可达声明；无本卡专用密码文件。只用负责人安全配置的管理员身份；不要配置真实 Provider。
- 预期：状态仅显示引用和 configured 状态；未安装插件/外项目引用/字面凭据/旧版本写入拒绝；Outbox/投递 owner 不重复。
- 未做观察：未发送短信、邮件，也没有外部送达结论。

### NEXT-13 — 客户注册与验证闭环

- 卡片：AF-083–AF-086。记录：[AF-083](../execution/AF-083.md)、[AF-084](../execution/AF-084.md)、[AF-085](../execution/AF-085.md)、[AF-086](../execution/AF-086.md)。
- 负责人操作：AF-086 的页面路由为 `/client/register`、`/client/verify-email`、`/client/forgot-password`、`/client/reset-password` 和 `/client/login`。历史浏览器 smoke 使用 `http://127.0.0.1:43686`，已停止；没有持续人工地址。表单浏览可以在负责人确认启动的本机 Web 上进行；完整注册/找回使用测试通知适配器和合成账号，不应触发真实邮件。
- 凭据：校验生成的客户凭据在忽略目录 `.local-data/auth/test/<acceptance-db>/client-accounts.json`；令牌通过 test adapter 交付，不能把明文 token 从报告或聊天中复制。当前没有为人工服务准备账号。
- 预期：重复注册响应不枚举；未验证登录拒绝；验证/找回 token 单次、重放拒绝；重设密码后旧会话失效、新密码可用；注册不自动加入 Workspace。
- 未做观察：已有页面只读 smoke 未提交认证/改密请求；没有真实邮件送达、真实邮箱互动或外部消息服务验证。

### NEXT-14 — 客户管理页面与角色矩阵

- 卡片：AF-087–AF-090。记录：[AF-087](../execution/AF-087.md)、[AF-088](../execution/AF-088.md)、[AF-089](../execution/AF-089.md)、[AF-090](../execution/AF-090.md)。
- 负责人操作：在自己确认运行的 Web 打开 `/auth/clients`；授权管理员检查列表/详情中的邮箱遮蔽、会话与同意摘要；普通角色确认菜单不出现客户入口、直调 API 为 403；退出后回到 `/login`。
- 地址/凭据：路由目标为本机 Web `127.0.0.1:3655/auth/clients`，不是当前服务证明。自动测试用合成管理员凭据 `.local-data/seed/test/<acceptance-db>/ui2-accounts.json`；仅当数据库仍是匹配的隔离验收库时本机查看，不把测试凭据用于其他库。
- 预期：邮箱始终遮蔽；敏感字段不进入 API/UI/浏览器流量；普通角色不能靠隐藏按钮绕过后端授权。
- 未做观察：AF-090 的自动化已有真实浏览器观察，负责人统一人工验收仍 pending；没有真实客户数据。

### NEXT-15A — AI Provider 合同与配置页面

- 卡片：AF-091–AF-092。记录：[AF-091](../execution/AF-091.md)、[AF-092](../execution/AF-092.md)。
- 负责人操作：AF-091 记录的页面目标为 `http://localhost:3655/auth/configuration`。若负责人启动的是本库页面，可用具备 `admin.config.manage` 的管理员检查配置，未授权 `admin.secret.manage` 的角色应收到 403；已授权操作只显示 SecretRef 配置状态，不显示 secret。AF-092 没有公开模型执行 UI/route，只复核异步状态机报告。
- 地址/凭据：3655 是历史/配置目标，不表示当前运行；使用负责人安全配置账号或本机忽略的合成管理员凭据。不填写或解析真实 Provider Secret。
- 预期：配置校验、能力开关/预算限制及失败分类有效；异步任务的幂等、取消、超时、重试有真实 DB 证据。
- 未做观察：没有真实 AI Provider/模型调用或付费请求。

### NEXT-15B — Trace/Cost 脱敏与失败预算路径

- 卡片：AF-093–AF-094。记录：[AF-093](../execution/AF-093.md)、[AF-094](../execution/AF-094.md)。
- 负责人操作：无持久页面/人工 URL。检查真实数据库证据中的合成 Trace、幂等成本回执、输入输出与异常去敏、预算拒绝及重试状态。
- 地址/凭据：无账号/服务入口；只用离线 Provider fixture 与合成 DB。
- 预期：Trace/Cost 唯一 owner 不重复；错误正文、输入、输出和凭据不落库；预算/Provider 失败按受控状态处理。
- 未做观察：没有真实 Provider、模型或付费调用。

### NEXT-16 — AI 配置/Trace 页面与失败闭合

- 卡片：AF-095–AF-098。记录：[AF-095](../execution/AF-095.md)、[AF-096](../execution/AF-096.md)、[AF-097](../execution/AF-097.md)、[AF-098](../execution/AF-098.md)。
- 负责人操作：检查配置页目标 `/auth/configuration` 和 Trace 页面 `/auth/ai/traces`；用具备 `admin.runtime.read` 的管理员查看分页/脱敏记录，普通角色预期 403。对无 Provider/超预算/队列失败/权限撤销检查失败闭合。
- 地址/凭据：文档记载的 Web 目标为 `http://localhost:3655`，无本批常驻页面服务。登录使用负责人安全配置的管理员；不填真实模型凭据，测试 Provider 为离线合成实现。
- 预期：页面不暴露 prompt/payload/secret；模型缺失、预算拒绝和撤权结果明确失败，不产生伪造成功 Trace/Cost。
- 未做观察：没有真实 DeepSeek、其他付费 Provider 或生产凭据观察。

### NEXT-17 — Connector manifest、Webhook 与管理页面

- 卡片：AF-099–AF-101。记录：[AF-099](../execution/AF-099.md)、[AF-100](../execution/AF-100.md)、[AF-101](../execution/AF-101.md)。
- 负责人操作：AF-101 页面目标 `/auth/integrations`；本机 Web/API 确认归属后，使用具备 `admin.integration.manage` 的管理员查看 operation、执行本地检查/限次重试，再用无权角色确认拒绝。AF-100 的回调只用本机合成 SecretRef、合成 raw body 和签名复现有效 202、重放拒绝、错误签名/过期/跨项目拒绝。
- 地址/凭据：页面目标为 `127.0.0.1:3655/auth/integrations`、API 目标为 `127.0.0.1:3656`，当前没有本卡准备的固定地址/账号。使用负责人安全管理员身份和测试专用 SecretRef；不要连接外部系统。
- 预期：按服务端当前项目和权限过滤操作；签名/时间窗/重放策略正确，敏感值不进入 operation/audit。
- 未做观察：AF-101 负责人浏览器操作未执行；真实第三方 Connector/Webhook 未接通。

### NEXT-17B — SecretRef 轮换与停用恢复

- 卡片：G17-04/AF-102。记录：[AF-102](../execution/AF-102.md)。
- 负责人操作：无持久 API 地址或账号；只检查真实 DB/HTTP 自动化报告中的旧/新引用切换、停用、无引用恢复拒绝和 in-flight 事件处理。
- 地址/凭据：无。不要提供真实 connector 密钥。
- 预期：SecretRef 不回显；停用期间路由/事件不绕过生命周期状态；恢复后只使用当前受信引用。
- 未做观察：未调用外部 Connector。

### NEXT-18A — 支付 Provider contract 与创建/查询请求

- 卡片：AF-103–AF-104。记录：[AF-103](../execution/AF-103.md)、[AF-104](../execution/AF-104.md)。
- 负责人操作：以离线 contract、真实隔离 DB/HTTP 报告核验服务端定价、workspace scope、幂等和拒绝路径；没有前端页面或持续人工服务。
- 地址/凭据：临时 HTTP host 已关；无可供人工登录的地址/账号。没有支付商户凭据。
- 预期：客户端不能设金额/币种/Provider；重复幂等键仅产生一个订单，跨 workspace/无权限/未知 payable 拒绝；Provider 缺失 fail closed。
- 未做观察：没有真实 Provider、付款或退款调用。

### NEXT-18B — 管理查询与退款申请

- 卡片：AF-105–AF-106。记录：[AF-105](../execution/AF-105.md)、[AF-106](../execution/AF-106.md)。
- 负责人操作：页面目标 `/auth/payments`。在负责人确认运行的本机 Web 中，用具备支付读取权限的管理员检查合成订单/详情/待审申请；仅对本批合成测试订单提交退款申请，预期状态 `pending_manual_review` 并有审计记录。
- 地址/凭据：`http://127.0.0.1:3655/auth/payments` 是目标路由，不是当前可访问声明；使用负责人安全配置管理员/退款申请角色，不取商户密钥。
- 预期：申请只进入人工审核队列，不调用真实资金或 Provider；越权请求拒绝。
- 未做观察：真实退款、付款、支付回调/资金流水均未执行。

### NEXT-18C — 合成支付轨迹对账

- 卡片：G18-05/AF-107。记录：[AF-107](../execution/AF-107.md)。
- 负责人操作：没有页面/持久人工服务。检查隔离数据库与真实 HTTP 报告中的对账幂等、差异分类、重复处置拒绝及去敏审计。
- 地址/凭据：测试 API 动态端口已关闭；无支付账号或 Provider 凭据。
- 预期：回调或对账处置不能覆盖经核实的账本真值；synthetic difference 只能被标记 acknowledged/escalated，不宣称资金已变化。
- 未做观察：无真实 Provider 对账、扣款、退款或冲正。

### NEXT-19A — Workspace 知识问答合成闭环

- 卡片：AF-108–AF-111。记录：[AF-108](../execution/AF-108.md)、[AF-109](../execution/AF-109.md)、[AF-110](../execution/AF-110.md)、[AF-111](../execution/AF-111.md)。
- 负责人操作：无常驻人工 Web/API；可以检查 AF-111 的 20 例最终评测、真实 PostgreSQL/HTTP、引用与跨 Workspace 拒绝报告。AF-111 最终临时 API 地址 `http://127.0.0.1:59212` 已停止，不可复用。
- 凭据：复现校验会新建随机测试库，合成客户账号位于忽略目录 `.local-data/auth/test/<acceptance-db>/client-accounts.json`；不要在聊天或报告中读取/粘贴密码。
- 预期：有来源答案、无证据拒答、跨 workspace 不泄露；结果由 test-only `offline-knowledge` Provider 生成。
- 未做观察：未调用 DeepSeek、未发送客户数据、未产生付费请求；负责人统一验收仍 pending。

### NEXT-19B — Workspace 知识库管理与问答页

- 卡片：AF-112–AF-114。记录：[AF-112](../execution/AF-112.md)、[AF-113](../execution/AF-113.md)、[AF-114](../execution/AF-114.md)。
- 负责人操作：如果负责人自行启动本机 Web，可观察 `/client/knowledge` 与 `/client/knowledge/questions`；检查成员只能选服务端已授权 Workspace、文档列表/编辑/停用/恢复、问答提交/轮询、引用与证据不足拒答，以及匿名/无权限/跨 Workspace 拒绝。
- 记载地址：AF-112 临时 API `http://127.0.0.1:60346`、AF-113 临时 API `http://127.0.0.1:63269`、AF-114 临时 API `http://127.0.0.1:65477` 均为测试期动态地址，已关闭，不是人工入口。页面目标遵循本地 Web 端口 3655，但没有常驻服务。
- 凭据：如复跑本地注册校验，会在对应随机验收库和 `.local-data/auth/test/<acceptance-db>/client-accounts.json` 使用合成客户账号；无专用当前人工账号。不要使用真实客户资料。
- 预期：workspace 从认证会话导出；文本知识与结果不会跨 Workspace 泄漏；引用来自服务端检索；无证据拒答；本批 Provider 是离线测试实现。
- 未做观察：AF-113/AF-114 的负责人浏览器观察未执行；未调用 DeepSeek、不发送邮件/短信、不做文件导入、不产生付费请求。

## 明确不属于当前待验清单

- 已有接收记录：UI-2、NEXT-02、NEXT-07、AF-025-A。保持队列原值。
- 已接受但观察未做：AF-043 的浏览器/loopback 观察与 AF-058 浏览器观察。接受记录说明了未观察事实，不能改写成观察通过。
- 未获整批授权：NEXT-01。G0–G3 包级状态也须先做卡级对账；本清单不替负责人裁定。
- 当前 G19 owner inputs 仍待决定：DeepSeek live 的数据字段 allowlist、敏感数据分类、脱敏/Trace/保留策略、处理授权、SecretRef 配置、10 元预算周期与超额行为、live 调用授权；Workspace 文件导入的唯一 FileAsset/Workspace/知识文档 owner、权限继承、删除恢复、格式/大小；发行的许可、渠道、平台和公开发布/部署授权。

## 负责人批次结果记录格式

每批检查后由负责人明确给出结论；在负责人确认前不要改队列：

```text
批次：NEXT-xx
结论：通过 / 有条件通过 / 退回修正
已查看的执行记录及最终报告：……
实际人工操作与结果：……（未操作项明确写未执行）
遗留外部观察/负责人输入：……
负责人验收/接收状态变更授权：是 / 否
```
