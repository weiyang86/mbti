# 私有工作流线性编辑器（AF-178 候选）

入口沿用 `/client/workflows?workspaceId=<workspace>`，页面是否已运行以总控验收记录为准。需同时具有 `workspace.ai.assets.read` 和 `workspace.ai.assets.manage`；只读角色可查看自己的草稿和历史。复用 Ant Design、PageHeading、adminTheme 和原有 AF170 SDK/API，不新增依赖、全局样式、Graph v1 布局字段、Schema 或权限。

## 可编辑范围

只有简单构建器生成的完整规范图可进入“编辑线性流程”：一个 start、1–62 个连续编号 Agent 步骤、一个 end，固定 next/in 连线，最多 20 个合法输入键。`classifyLinearWorkflow` 验证整个图，再按步骤编号重建，并比较 SDK 的完整 canonical 内容；标签、自定义节点/端口、改过连接顺序的编号、条件、并行、汇合、循环和审批不会被丢弃或转换。空图保持只读拓扑和名称编辑。

编辑器显示连接的开始、Agent、结束卡片。卡片展示名称、编号和固定版本，拖动左侧 44px 手柄到目标卡片后松开，会改变真正的步骤顺序；方向键 ↑/↓ 和上下移按钮调用同一个语义排序入口，Escape/pointercancel/丢失指针捕获取消拖动。滚动只发生在内部区域，位置只由当前顺序计算，不保存坐标。卡片外、间隙、错误指针、无效坐标或越界目标拒绝排序。

添加步骤必须读取自己的 Agent 并明确选择当前或历史版本。可移除旧步骤、添加另一个固定版本，再移动到所需顺序；不会跟随最新版本。编辑输入键或名称后“检查并确认保存”。至少一个步骤、最多 62 步和 20 个输入键，空流程、重复/非法键不允许保存。缺失、已删除、停用、当前 pin 已变更或版本 ID 不匹配时拒绝写入，要求重新读取并明确选择。仍可使用经核验的历史 pin，当前 Agent 更新不会自动改写历史绑定。

## 保存和隐私边界

编辑开始时复制并冻结当前完整基线和 revision。保存使用原有 `PATCH`，只发送完整 `{name, graph, expectedRevision}`；没有原始 JSON 编辑器。规范图/名称改变应返回下一 revision，完全相同内容应保持 revision。页面核验返回名称、revision、规范图、SHA-256 graphDigest 和每一个精确 `nodeId/agentId/revision/agentVersionId`，不能把任意成功响应当作保存结果。

取消只丢弃编辑，保留已读取的当前图；读取历史会关闭编辑，历史始终只读。名称编辑对复杂图仍完整发送原图和原固定绑定。创建、改名、删除、创建结果未知时的明确原样确认、墓碑和历史行为保持 AF173 语义。

409、网络、超时或未知写入结果阻断进一步修改，关闭图编辑表单/确认框，必须明确重新读取当前草稿或重新验证；不重试 PATCH、不自动合并或切换源图。已发送的服务端请求不能靠 Abort 撤回，重新读取才可确认最终版本。响应结构/摘要不符或权限失效清除私有上下文。仅旧有创建 POST 保留明确原样确认机制，图 PATCH 没有 replay。

每轮编辑和确认框有独立的内存 token，实际 UI 所有编辑/拖动/保存回调携带它；旧编辑或确认框回调不能修改新的编辑。异步请求另由 epoch、AbortSignal 和 timeout 控制。切换空间/账号、重新验证、focus、visibility、pagehide 和退出清除表单、拖动、Modal、详情及历史。私有输入/名称/图/pin/位置不写 storage、URL 或日志。

Agent 历史接口仍是 AF159 的完整版本接口，会在传输层返回 instruction 等内容；本卡不改变该既有 overfetch。响应严格验证后只保留名称、编号、enabled、revision、版本 ID 和日期，instruction、模型配置和 Skill 内容不进入状态/UI/storage/log。

## 总控验证入口

Worker 离线验证：`node --test scripts/verification/client-workflow-library.test.mjs scripts/verification/client-workflow-linear-editor.test.mjs`；使用实际构建 SDK、合成 transport/自有临时 loopback、状态机和组件 SSR，不是数据库或浏览器证据。

总控需先完成真实 I177 安全依赖集成，保留已验证 AF170/AF173 的生产实现，按现有规则仅为 AF178 新租约注册五处保护：`scripts/runtime-environment.cjs`、`scripts/database/migration.mjs`、`scripts/database/seed.mjs`、`scripts/verification/auth-support.mjs`、`scripts/verification/client-auth-fixture.mjs`；另注册正式验证和隔离 Web build。Worker 不写这些共享文件。

根 `dev`、真实 API/Prisma/SDK 就绪后运行：

```sh
AIJ_AF178_ROOT_LIVE=1 node --test scripts/verification/client-workflow-linear-editor-live.test.mjs
pnpm run verify:task -- AF-178
```

live 脚本有显式 root 路径、主工作区、dev 和环境开关保护，随后才动态导入数据库设施。使用 fresh AF178 隔离合成库和 PluginLifecycle，覆盖真实 create→graph PATCH→新旧不可变版本、历史 pin/顺序/输入/noop、stale CAS、其他 OWNER/只读/空间/缺失或删除 pin 拒绝、真实 HTTP 依赖读取后的旧 scope 零 PATCH、已提交后丢失响应的锁定和明确读取；记录运行账本 before/after 哈希及 upstream0，finally 关闭服务并断言 API pools0。该脚本由 Worker 仅检查语法和 lint，真实结果以总控执行记录为准。

桌面和 390 宽原生浏览器验收需实际用鼠标 move/down/up 拖动，保存后重新读取图、再读 v1 核对旧顺序/绑定；键盘 ↑/↓ 和上下移保存也须真实测试。检查 Escape 取消确认后焦点返回、pointercancel 不改顺序、窄屏无页面横溢、角色只读/空间或账号切换/隐藏和离页清除私有内容；不得通过 evaluate 或 DOM 改写制造排序。总控还须运行当前 Run 和 Memory 回归及 production build，本冻结 Worker 基线不含这些页面回归源文件。

这是线性图编辑与版本保存范围，不提供发布、执行、恢复历史或任意画布编辑，不代表完整 REQ019 已完成。


总控技术接收：`.artifacts/verification/AF-178/run-YSPZBs/report.json` PASS；87+203+24+66+真实PG12/Web类型/productionWeb/lint通过。真实原生mouse/ArrowDown/上下移保存v2/v3/v4、历史v1与精确pin/输入持久化、noop/撤权无v5；390截图已查看、protectedPG后检、专用host CLOSED/pools0/upstream0。候选不是最终边界，详见[执行记录](../execution/AF-178.md)。完整画布/发布执行及负责人接收仍PENDING。
