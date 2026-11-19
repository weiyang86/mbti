> 最新：AF191 `run-bkQU68`正式PASS，14真实原生场景及同Run/真实SDK/PG/拒绝/清理均通过，负责人待验。旧段落为保留的阶段记录，最新状态见[执行记录](../execution/AF-191.md)。独立SDK验收页为短时host，现已关闭；常驻本地入口3955保留，付费厂商尚未联调。

> W22 当前：root 适配器已接线，HTTP/PG/SDK 同任务已实际执行到原生失焦场景；完整 14 场景未通过，BLOCKED_NATIVE_FOCUS_VISIBILITY，未 CODE_VERIFIED。见执行记录的 W22 阶段，以下旧阻塞说明保留。

> ROOT状态：AF191 BLOCKED_NATIVE_ENVIRONMENT。18离线/真实仓库外SDK安装检查通过；原生GUI实际permission_denied，formal run-xUNwmb FAIL，隐藏仍NOT_PROVEN。真实root适配器和PG/native14同任务联调尚未完成；本文契约不能当作已实现/已验收。见[执行记录](../execution/AF-191.md)。

# AF-191 · 当前工作台与独立 SDK 前端目标验收

状态：Worker 候选准备完成，**目标验收 NOT_RUN / 非 CODE_VERIFIED / OWNER_CHECK_PENDING**。仅有离线检查不能关闭冻结 AC-003。原生文件选择器历史证据仍为 NOT_PROVEN；本卡没有上传交互，不补写其通过。真正 `document.hidden` 证据必须由总控原生操作提供，不能通过派发 DOM 事件或改写属性代替。

冻结成功条件：普通用户在现有 `/client/ai` 工作台提交并查看通用目录 `general-text` Agent 的真实 API 任务；一个仓库外独立项目实际安装私有 `@aij/sdk` 与 `@aij/contracts` tgz，使用公开 `createClientApi` / `createAiClient` 读取**同一 Run ID**，得到一致状态、结果及权限判断。独立项目不再次提交。匿名、无权限、其他成员必须在 API 上分别被拒绝，隐藏按钮不算拒绝证据。管理端 AI 目录只用于合成配置准备。

候选新增四个脚本：

- `workbench-sdk-target-consumer.mjs`：创建全新的仓库外目录，校验私有包内容/依赖/入口，离线真实 npm 安装本地 tgz，执行 ESM/CJS/声明消费矩阵，提供受限静态 handler 和带代际、AbortSignal、身份复检、内容到期清理的只读状态机。
- `workbench-sdk-target.test.mjs`：离线状态、安全静态路由、实际打包安装、编译类型及 loopback HTTP 校验；它使用合成 HTTP 响应，不能代替真实产品验收。
- `workbench-sdk-target-live.test.mjs`：只允许主 `dev` 工作树显式开启；要求总控真实 adapter。实际断言原生提交、安装包的 HTTP 成功/拒绝、PG 归属/Run/Job/Trace/成本 owner、同 Run 的桌面/390 页面及清理。adapter 缺失直接 FAIL。
- `workbench-sdk-target-proof.mjs`：补充检查当前源码/编译产物/包/安装锁/原始回执哈希、时间、租约、计数、拒绝及原生 PNG。它只报告 INTEGRITY_CHECKED，不能认证截图来源，也不能替代真实 harness。

消费页面为独立验收项目的原生 HTML/ESM 页面，没有引入 UI 依赖或改写产品 AntD、PageHeading、adminTheme。页面只有 Workspace、Run 编号和一个读取操作；无凭据输入、URL 参数、私有内容日志或浏览器存储。结果使用 `textContent`。所有 ID 只是待 API 验证的定位值。每次读前后都验证 `/client/auth/me` 与 `/client/workspaces/context`，比较服务端返回的完整身份/上下文，再展示精确 Run。读取期间身份、角色、权限或范围变化会拒绝结果；失焦、获得焦点、隐藏、卸载、输入改变和显式重新读取都会清空结果并使旧回调失效。宿主可通过 `aij-scope-changed` / `aij-role-changed` / `aij-session-changed` 通知清空；这些事件只撤销本地展示，不能授予权限。外部状态变化要通过服务端复检确认，页面不声称能瞬时获知服务器上所有撤权事件。

读取超时会取消并清空，成功内容达到服务端 `expiresAt` 后自动清空。`unknown` 只展示状态，不重试写入。当前工作台的原请求未知、显式查回/确认与新 CAS 策略完全由原实现负责，本消费页没有 POST 或恢复提交接口。

总控操作顺序和精确 adapter/schema 见 [AF-191-ROOT_WIRING](../planning/auto-ai-program-20261105/W14/AF-191-ROOT_WIRING.md)。建议命令：

```sh
pnpm --filter @aij/contracts build
pnpm --filter @aij/sdk build
node --test scripts/verification/workbench-sdk-target.test.mjs
pnpm exec eslint scripts/verification/workbench-sdk-target*.mjs --max-warnings=0
AIJ_AF191_ROOT_ACCEPTANCE=true AIJ_AF191_ROOT_ADAPTER=/absolute/root/scripts/verification/workbench-sdk-target-root.mjs node --test scripts/verification/workbench-sdk-target-live.test.mjs
node scripts/verification/workbench-sdk-target-proof.mjs /absolute/ignored/artifact/target-proof.json
```

后两条仅由总控在完成接线、最新真实 SDK/API/Web 构建及独占 PG 租约后运行。总控还须注册并运行正式 `verify:task AF-191` 和适用门禁。不得以设置环境变量、JSON 声明、Worker 源码测试或旧批次截图代替这些步骤。

人工验收必须实际使用当前工作台登录、选择已确认 Workspace、填写合成目标并提交一次；记录页面 Run ID，泵真实 Job 后查看成功结果。打开同一授权 origin 的 `/af191-consumer/`，手工输入该 Workspace 和 Run ID，得到相同结果；390 宽度复验两个页面。分别用匿名、无权限、同空间不同成员验证页面反馈与实际 HTTP 拒绝，再在延迟读取期间实际改变范围/角色/会话、原生失焦/隐藏/卸载，确认旧结果消失且晚回调不能恢复。浏览器操作、截图、HTTP 和 PG 断言须关联本次新租约及唯一 Run。

本卡不增加数据库表、API、权限、SDK 导出、全局依赖或产品页面；对现有日志行为无改动。消费者与 fixture 进程只由总控短时启动，Worker 未提供运行中的产品访问地址。上游为自有 loopback 合成服务，**不是付费模型、厂商接通或生产就绪证明**。全部自有 socket/进程关闭、应用连接池归零、标记的仓库外目录删除后方可交付；保留只读证据，不停止未知 Base/其他项目进程。
