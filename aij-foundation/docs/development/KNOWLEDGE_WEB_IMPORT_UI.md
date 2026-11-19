# Workspace 知识网页导入与来源核对

AF-182 为候选前端实现；正式 API/PG、原生浏览器与生产构建验收由总控执行。本页位于现有 `/client/knowledge`，复用 AntD、PageHeading、adminTheme 和 Workspace 知识管理权限 `workspace.knowledge.manage`，不提供个人资产语义或查询角色的管理入口。

## 使用

1. 有管理权限的当前成员选择「导入网页」，填写文档编号、标题和完整 HTTPS 地址，再选择「核对导入内容」。客户端拒绝明显不合法、非 HTTPS、用户信息、片段、反斜杠及空白地址，DNS/TLS、SSRF、实际成员权限与生命周期由服务端权威校验。
2. 在确认弹窗核对编号、标题和地址，选择「确认导入并保持停用」。调用实际公共 SDK `createKnowledgeWebImportsClient.importWeb`，仅一个 POST，不设置重试或自造幂等键。成功结果必须严格匹配预期编号、标题、Workspace、停用状态及受限元数据结构。
3. 成功后明确选择「重新读取列表核对」。这会重验证当前账号、成员列表和当前 Workspace 权限，再读取普通文档列表（全部状态、第一页）。网页文档保持停用；若需要参与现有检索，应在普通列表单独明确选择「恢复」。本功能不调用知识查询、启用、来源刷新、版本或恢复来源 API。
4. 仅来源标记为 `web-import` 且属于当前 Workspace 的行提供「核对来源」。点击后调用该行的受限 `getWebSource`，普通列表不会预取。展示原始/最终 URL、原始/文本 SHA-256、提取版本与 `contentMatchesSource`。手动编辑正文后可能出现不一致；元数据仅说明导入时的快照，不代表实时内容或分享授权。
5. 若响应丢失、网络/服务错误或结果校验不通过，文档可能已提交，继续导入将被锁定。必须主动重读普通列表并按原编号核对（必要时翻页或核对已找到文档的来源），再勾选已核对结果并选择「完成核对，允许新导入」。解锁本身不会发送 POST，已有编号由原 API 拒绝覆盖。来源读取成功后关闭弹窗，也可保留“已读取”的布尔凭据供明确确认。

## 隐私与生命周期

控制器只使用内存；不写 localStorage、sessionStorage、URL、路由参数、历史、日志或分析。未知结果锁只保留账号/空间对应的布尔状态，不保存 URL、正文、标题或原编号。整页重载后内存锁不会持久保存；用户仍需遵守按原编号核对，服务端唯一编号约束继续生效。

空间切换、同空间刷新/重验证、会话/账号/成员/角色重验证、窗口 blur/focus、visibilitychange、pagehide、退出和卸载都会清空私密来源、确认草稿、普通文档正文/编辑表单、文件选择和 Modal，并使旧异步响应失效。每次重新装载会重新读取 `/client/auth/me`、成员列表和当前权限；查询角色不会读取知识管理列表/来源或发起导入。确认、表单校验、来源动作、关闭与解锁均使用版本凭据，旧弹窗事件不能操作新上下文。

来源地址可能携带私密查询文字，使用 React 普通文本展示，不提供链接、图片、iframe 或抓取 HTML 渲染。长 URL/校验和使用内部折行/滚动，工具栏允许换行。Modal 条件挂载，关闭会卸载 portal；Escape 回到导入按钮或来源动作按钮。桌面和 390px 原生浏览器行为尚待总控实际检查。

原有手动创建、UTF-8 TXT/MD/CSV 文件导入、编辑、状态切换、筛选、分页和独立知识查询路径继续使用原 owner/API；未增加全局样式、依赖或权限。

## 可重复验证与剩余验收

Worker 已运行：

- 冻结安装 `pnpm install --frozen-lockfile --ignore-scripts`（本工作区独立安装，无环境/凭据/数据库/上传目录复制）。
- `node scripts/build-workspace-package.mjs packages/contracts`、`packages/sdk`、`packages/ui`：真实小型公共包编译通过。
- `node --test scripts/verification/client-knowledge-web-import.test.mjs scripts/verification/client-knowledge-web-import-live.test.mjs`：16 项通过，覆盖编译 SDK、严格结构、真实 React/AntD SSR、单 POST、停用、拒绝/未知/跨空间/旧版本/账号/角色/来源隔离。
- Web `tsc --noEmit` 与本卡七个代码/测试文件定向 ESLint（含 `.d.mts`）通过，无规则降级。

`client-knowledge-web-import-live.test.mjs` 是自有 synthetic loopback HTTP 传输测试：只运行临时 HTTP server，内存模拟提交后断连及延迟回包，退出时关闭连接和 server。它不是 Nest/PG、真实网页读取、HTTPS 信任链或真实 plugin 生命周期证据；HTTPS 字符串只是请求数据，测试不会抓取它们。

总控应先接收真实 I181 安全修复，再串行集成本卡，保留实际 AF179 依赖，并注册/运行 `verify:task AF-182` 与正式门禁。需要补齐真实 API/隔离 PG、受信任自有 HTTPS reader/parser 默认限制、实际 plugin 生命周期、SDK/页面状态、停用/手动不一致/单独启用、外部成员与只读角色、提交后丢响应不重试及按编号重读、延迟旧 HTTP 无新空间写入、运行 owner 哈希和 pools=0。还需桌面与 390px 浏览器表单/确认/来源/隐私/角色/账号/Escape/无页面横向溢出证据及生产 Web 构建。Worker 没有启动 API/Web、运行 DB/Docker/migrate/seed、重型构建或付费调用，未声明运行访问地址或 CODE_VERIFIED。

## 总控复测后的定向修复（2026-11-06）

总控首轮生产页面/原生浏览器报告已验证 CSV、首次停用、来源一致到手动不一致、提交后丢回复单次 POST/人工重读解锁、390px 无溢出及私密存储为空，但发现来源 Escape 后焦点为 BODY，以及中文根目录下测试 harness 使用 URL.pathname 导致 MODULE_NOT_FOUND；这些是总控的证据，不能以 Worker 的 ASCII 路径首轮通过替代。

已将本卡测试中的文件加载统一改用 `fileURLToPath`；新增真实中文、空格、字面 `%` 和 `#` 临时文件的同加载函数检查。生产关闭处理仍立即清理草稿和来源、条件卸载 Modal，不等待动画；焦点恢复改在该 React commit 的 passive effect 中执行，此时旧 portal 与焦点锁已卸载。恢复凭据只保存版本号和来源/导入布尔值，控制器检查仍是当前有管理权限的账号/空间版本，随后仅聚焦仍连接且未禁用的原按钮；重验证、新会话、角色变化、下一操作或卸载均使旧凭据失效，没有定时器或旧来源/URL 留存。

新增组件生命周期检查使用真实 React DOM portal、安装的实际 rc `lockFocus` 与 `useEscKeyDown`，配合自有最小 DOM host 和隔离的视觉/表单控件；覆盖来源/导入表单/确认的关闭、重复打开后 Escape 两次、卸载、同空间重验证、账号/角色/空间变化、目标断开及禁用。它在旧实现下产生真实失败，修复后与原16项合计29项通过，Web noEmit 与七文件定向 ESLint 通过。该组件测试不冒充原生浏览器；总控需在生产构建后重新验证真实页面的关闭/Escape、Tab 焦点及隐私清理。文件选择器路径没有因猜测进行重做。

## 总控当前验证

原候选 NOT_RUN 描述保留。总控已接收 d2b7a3c 修正并完成正式 run-18ksmf 和原生生产页面/隔离PG/实际HTTPS接线验收，详见 [AF-182 执行记录](../execution/AF-182.md)。当前 CODE_VERIFIED / OWNER_CHECK_PENDING。OS文件窗口直接选取/取消以及原生tab真正触发hidden/focus的序列未证明，不以CLI tab切换或组件夹具冒充该结果。服务均已关闭，没有部署地址。
