# MBTI 运营工作台动作覆盖记录（B1 / B2a 订单）

基准原型：输入包 `inputs/mbti-dazi-admin.html`，SHA-256 `fb7607763dbc41472bccda10fc24f9241ec4d306d3b745eaabdb7be4a94248a6`。实现 `/ops/` 保留 B1 UI 外壳；B2a 已连接既有订单按号详情客户端，其余业务服务尚未连接。不能把占位空态或隔离组件测试当成真实业务验收。原稿42组按单项动作列出，组内复合操作展开到按钮、表单、筛选与弹层。

状态：`UI_SHELL` 表示导航或控件占位；`UI_CONTRACT` 表示等待后续业务 API；`NOT_RUN` 表示未执行验收。`LOCAL_UI_TESTED` 仅指本地合成响应/组件测试；`BLOCKED` 表示环境依赖阻塞，真实服务端授权与公网同号验收另列，B2–B5/C2 不预先勾选。订单唯一既有读取 API 为 `GET /api/admin/mbti/orders/{id}`，权限 `mbti:orders:read`。前端 capabilities 只负责显隐，服务端决定授权。未创建订单、配置草稿或支付数据。

## 全局动作（B1）

| 动作 / 控件 | admin 路由 | API / 服务端权限 | 角色/字段边界 | HTTP拒绝 / 持久化 / 证据 | 状态 |
|---|---|---|---|---|---|
| 侧栏分组、14路由原序、当前项键盘可达 | /ops/#/overview…#/release | GET /api/admin/mbti/ops/session | 四角色按服务端能力显示 | HTTP与四角色拒绝未验；桌面/手机对照截图未采集 | UI_SHELL |
| 顶部工作队列与页面返回 | 全部14页 | 工作队列 API 未定 | 按页面权限 | 空态占位；返回使用浏览器历史；未验 | UI_SHELL |
| 功能搜索、Ctrl/⌘K、Escape | 全部14页 | 本地路由搜索 | 仅列服务端可见页面 | 仅UI操作；键盘验收未执行 | UI_SHELL |
| 日期范围与渠道筛选 | overview/growth/moderation | UI_CONTRACT：无管理端统计查询及渠道归因来源 | B1 会话页面能力；筛选不构成服务端授权 | B2b 预设/自定义/日期校验、前一等长周期与四渠道选择 `LOCAL_UI_TESTED`；三页均无业务请求，不把未知计为0；真实过滤查询 `NOT_RUN` | 呈现 `LOCAL_UI_TESTED`；数据 `UI_CONTRACT` |
| 列表搜索、状态、分页条数、翻页 | 业务页 | 各业务查询 API 未接通 | 按服务端读取权限 | 0条空态；分页控件；无持久化 | UI_CONTRACT |
| 详情/预览抽屉、遮罩关闭、移动导航折叠 | 全部14页 | 预览 API 未接通 | 服务端决定可见数据 | 触控尚未实测；抽屉明确未连接 | UI_CONTRACT |
| 草稿表单、未保存提示、放弃/返回 | content/catalog/assessment/ai/retention/social | 配置 API 未接通 | owner/editor可编辑范围；仅owner发布 | 本地临时文本；保存禁用；HTTP拒绝未测 | UI_CONTRACT |
| 加载/空/错误/401/403/500/超时 | 登录与全局请求 | Foundation auth + /api/admin/mbti/ops/session | 以真实会话及权限为准 | 客户端有错误映射；无服务器实测 | UI_SHELL |
| 管理员登录/刷新/CSRF安全注销 | /ops/登录 | POST /api/auth/browser-login；GET /api/auth/session；POST /api/auth/logout | Foundation SysUser/Role/Permission | test55437 owner/账号缺失；DB与浏览器验收阻塞 | NOT_RUN |
| AIJ超管与项目owner隔离 | /ops/登录与权限路由 | GET /api/admin/mbti/ops/session | owner非superadmin；AIJ超管单独标识 | 代码拒绝浏览器伪角色；真实HTTP403/字段未验 | NOT_RUN |

## 原型42组逐项动作

| ID / 原型动作（逐控件展开） | admin路由 | API / 权限 | 允许角色与字段范围 | HTTP拒绝 / 持久化适用阶段 / 证据 | 状态 |
|---|---|---|---|---|---|
| `UI-01.1` 日期/渠道筛选与周期对比（控件：日期/渠道筛选；周期对比） | `#/overview` | UI_CONTRACT：缺经营聚合/按日趋势端点；MBTI 表无获客渠道字段 | 保留 B1 服务端会话入口；前端筛选不授权或写入 | B2b 北京时间预设/自定义日期、非法/倒序/未来日期校验、前一等长周期、四渠道选择已实现；本地组件/日期测试通过，隔离浏览器检查筛选。真实汇总/HTTP/持久化 `NOT_RUN`；见 [B2b交付](MBTI-ADMIN-B2-WORKSPACE-DELIVERY.md) | 筛选 `LOCAL_UI_TESTED`；统计 `UI_CONTRACT` |
| `UI-01.2` 切换净实收、支付订单、访问人次及指标口径（控件：切换净实收；支付订单；访问人次；指标口径） | `#/overview` | UI_CONTRACT：缺按日净实收/支付数/访问聚合与可复算退款事实映射 | 不从单笔订单或权益推算经营指标，不读私密字段 | 趋势三选项、收入构成与口径抽屉已实现；所有数值为 —，来源、gross/net、分母、归因与成熟窗差距标 needs_human_review。日期/组件测试和隔离浏览器抽屉检查通过；真实 KPI 对账 `NOT_RUN` | 呈现 `LOCAL_UI_TESTED`；数据 `UI_CONTRACT` |
| `UI-01.3` 运营待办、工作队列与模板跳转（控件：运营待办；工作队列；模板跳转） | `#/overview` | UI_CONTRACT：缺全日期异常队列/匿名举报积压/待发布差异/模板交付排名来源 | 治理跳转随 B1 会话能力禁用；其他路由仍由 B1 显隐；无处理/发布写入 | 三项待办数量均 —；治理/发布仅导航；异常队列与管理模板按钮可见禁用，未伪装携带筛选或模板标签。组件导航/禁用测试通过；真实队列、任务与模板数据 `NOT_RUN` | 导航/禁用 `LOCAL_UI_TESTED`；来源 `UI_CONTRACT` |
| `UI-01.4` 导出报表 CSV（控件：导出报表 CSV） | `#/overview` | UI_CONTRACT：缺同筛选汇总/CSV 导出端点及其服务端 mbti:ops:export 校验 | owner/editor/support 预期可导出，reader 无能力；当前所有账号禁用 | 缺接口和权限说明可见；能力 true/false 均无法开放导出，本地组件测试通过。没有 CSV/下载成功、未发导出请求；真实角色 HTTP 拒绝与文件核对 `NOT_RUN` | 禁用 `LOCAL_UI_TESTED`；导出 `UI_CONTRACT` |
| `UI-02.1` 渠道指标、测评完成与传播行为（控件：渠道指标；测评完成；传播行为） | `#/growth` | UI_CONTRACT：缺渠道报表、同批测评汇总、访问/保存/分享/回流持久化事件与归因 | B1 access 入口；静态四渠道名称不代表已查询记录 | 保留四 KPI、两组独立行为及六列表；按渠道选择行，未知值均 —，不画假比例。日期/组件测试通过；390px隔离浏览器选 xhs 后只留该渠道，表格局部横滚且页面无溢出。真实报表 `NOT_RUN` | 呈现/筛选 `LOCAL_UI_TESTED`；数据 `UI_CONTRACT` |
| `UI-02.2` 预览后 7 日付费率与指标口径（控件：预览后 7 日付费率；指标口径） | `#/growth` | UI_CONTRACT：缺首看预览事件、同用户支付关联与满7日队列来源 | 不把 ShareAsset 生成/GET、guest 或订单数量当首看人数 | 抽屉明确成熟日归属周期、分子/分母、未成熟剔除和零分母 —；候选口径 needs_human_review。本地组件测试覆盖说明；真实 cohort、率及归因复算 `NOT_RUN` | 口径呈现 `LOCAL_UI_TESTED`；指标 `UI_CONTRACT` |
| `UI-02.3` 导出渠道表（控件：导出渠道表） | `#/growth` | UI_CONTRACT：缺同筛选渠道表/CSV 端点与服务端 mbti:ops:export 校验 | 仅使用会话能力说明缺权限，不据此授权导出；当前全角色禁用 | 本地组件测试验证 capability true/false 均禁用；无客户端 CSV 生成或下载成功提示。真实同筛选列表/导出核对、reader HTTP 拒绝 `NOT_RUN` | 禁用 `LOCAL_UI_TESTED`；导出 `UI_CONTRACT` |
| `UI-03.1` 交易订单 · 搜索、状态、分页、导出、详情（控件：交易订单；搜索；状态；分页；导出；详情） | `#/orders` | 仅 GET /api/admin/mbti/orders/{orderId}；精确权限 `mbti:orders:read`；列表/状态筛选/分页/导出无已接接口 | 以服务端权限判定读取，不在客户端按角色授权；仅白名单订单字段，金额为分+币种，保留 H5 同一订单号；无支付凭据、私密联系方式或私有作答 | B2a 本地13项测试通过，含原始响应、按号输入校验/编码、加载/空/错误/401/403/404、字段投影及旧响应丢弃；隔离组件桌面/手机空态和非法输入已检查。真实角色200/403/401/404及公网H5同号：`BLOCKED/NOT_RUN`，未证明服务端授权通过；状态/分页/导出等控件可见禁用。详见 [B2a交付](MBTI-ADMIN-B2-ORDERS-DELIVERY.md) | 详情 `LOCAL_UI_TESTED`；服务端验收 `BLOCKED`；列表/筛选/分页/导出 `UI_CONTRACT` |
| `UI-03.2` 生成任务 · 筛选异常、详情、重试、恢复范围（控件：生成任务；筛选异常；详情；重试；恢复范围） | `#/orders` 生成任务标签 | UI_CONTRACT：任务查询/异常队列/同任务重试/幂等/审计接口未接通 | 不把 `unlocked` 当素材已交付；所有任务动作禁用，reader无可调用写路径；owner/support预期操作仍待服务端契约 | B2a 本地组件测试和390px隔离组件检查标签/禁用控件；真实任务、重试、权限拒绝、持久化均 `NOT_RUN` | `UI_CONTRACT`；禁用呈现 `LOCAL_UI_TESTED` |
| `UI-03.3` 退款原因与确认（控件：退款原因；确认） | `#/orders` 订单详情 | UI_CONTRACT：退款/原因/确认/审计接口未接通 | 详情中退款按钮禁用并说明依赖；不虚构退款原因表单、资金结果或累计退款金额；任何角色均无客户端退款写路径 | B2a 组件测试覆盖详情及拒绝后旧数据清除；真实owner/support退款、editor/reader拒绝和幂等/持久化 `NOT_RUN`，无接口不能用路由404冒充403 | `UI_CONTRACT` |
| `UI-03.4` 体验兑换码 · 生成一批、按套装、停用（控件：体验兑换码；生成一批；按套装；停用） | `#/orders` 体验兑换码标签 | UI_CONTRACT：来源隔离账本/套装查询/生成/停用接口未接通；unknowns `needs_human_review` | 保留标签与禁用控件；不生成码、不读写原型localStorage、不消耗权益；无客户端兑换码写路径 | B2a 本地组件测试及390px隔离组件检查禁用态；真实生成/停用/重复兑换/角色拒绝和持久化 `NOT_RUN` | `UI_CONTRACT`；禁用呈现 `LOCAL_UI_TESTED` |
| `UI-03.5` 本机前台订单 · 刷新、详情与处理（控件：本机前台订单；刷新；详情；处理） | `#/orders` 本机前台订单标签 | UI_CONTRACT：来源隔离测试账本和处理接口未接通；可返回交易订单执行既有按号读取 | 保留原型入口与测试语义，刷新/详情/处理禁用；不把公网独立guest/数据库混成本机账本，不制造演练订单 | B2a 本地组件测试及390px隔离组件检查入口和禁用控件；真实测试账本/处理/角色拒绝 `NOT_RUN`；公网同一H5订单待总控协调 | `UI_CONTRACT`；禁用呈现 `LOCAL_UI_TESTED` |
| `UI-04.1` 互换/联系授权与待处理统计（控件：互换/联系授权；待处理统计） | `#/moderation` | UI_CONTRACT：缺管理端授权汇总/匿名工单来源；现有 guest 社交接口不用于运营读取 | 沿用 B1 moderation 页面能力（mbti:ops:moderation:write）；reader 不显示入口，独立匿名只读权限 needs_human_review | 四指标均 —；上方日期/渠道仅选定授权统计范围，举报队列明确全日期。组件/390px隔离空态检查通过；无工单记录、无联系方式/申请渠道/位置/作答读取。真实汇总/HTTP/持久化 `NOT_RUN` | 空态/筛选 `LOCAL_UI_TESTED`；数据 `UI_CONTRACT` |
| `UI-04.2` 查看处理、查看记录、驳回/限制（控件：查看处理；查看记录；驳回/限制） | `#/moderation` | UI_CONTRACT：缺匿名工单详情/历史/原子处置/幂等/审计服务及 mbti:ops:moderation:write 服务端操作校验 | 所有角色处置禁用；保留匿名字段说明及禁用的结论/依据/记录结果；不以客户端能力授权写入 | 无虚构工单或 MOD 编号；本地组件能力 true/false 均禁用。隔离390px实际验证抽屉、禁用表单、焦点循环/Escape/焦点返回；真实处理/重复处理/HTTP403/审计/持久化均 `NOT_RUN` | 抽屉/禁用 `LOCAL_UI_TESTED`；处置 `UI_CONTRACT` |
| `UI-05.1` 双图调试台 · 上传/替换、恢复两张图、选择配方/人格、确认授权（控件：双图调试台；上传/替换；恢复两张图；选择配方/人格；确认授权） | `#/ai` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿/试片）；owner（系统参数）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B4；当前只有UI壳 | `UI_CONTRACT` |
| `UI-05.2` 本机试片、失败演练、真实网关就绪状态、保存试片（控件：本机试片；失败演练；真实网关就绪状态；保存试片） | `#/ai` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿/试片）；owner（系统参数）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B4；当前只有UI壳 | `UI_CONTRACT` |
| `UI-05.3` 风格配方 · 编辑、替换参考、恢复内置、带入试跑（控件：风格配方；编辑；替换参考；恢复内置；带入试跑） | `#/ai` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿/试片）；owner（系统参数）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B4；当前只有UI壳 | `UI_CONTRACT` |
| `UI-05.4` 调用记录与手机效果（控件：调用记录；手机效果） | `#/ai` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿/试片）；owner（系统参数）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B4；当前只有UI壳 | `UI_CONTRACT` |
| `UI-06.1` 首页与场景 · 编辑首屏及消费场景（控件：首页；场景；编辑首屏；消费场景） | `#/content` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B3；当前只有UI壳 | `UI_CONTRACT` |
| `UI-06.2` 平台入口 · 四渠道编辑与模拟进入（控件：平台入口；四渠道编辑；模拟进入） | `#/content` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B3；当前只有UI壳 | `UI_CONTRACT` |
| `UI-06.3` 查看手机效果及付费页预览（控件：查看手机效果；付费页预览） | `#/content` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B3；当前只有UI壳 | `UI_CONTRACT` |
| `UI-07.1` 商品套装 · 改名、价格、权益、上/下架、预览购买页（控件：商品套装；改名；价格；权益；上/下架；预览购买页） | `#/catalog` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B3；当前只有UI壳 | `UI_CONTRACT` |
| `UI-07.2` 海报与头像模板 · 改名、素材、启停、排序与预览（控件：海报；头像模板；改名；素材；启停；排序；预览） | `#/catalog` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B3；当前只有UI壳 | `UI_CONTRACT` |
| `UI-08.1` 题库与计分 · 维度过滤、编辑题干/选项/方向（控件：题库；计分；维度过滤；编辑题干/选项/方向） | `#/assessment` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B3；当前只有UI壳 | `UI_CONTRACT` |
| `UI-08.2` 试算结果（控件：试算结果） | `#/assessment` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B3；当前只有UI壳 | `UI_CONTRACT` |
| `UI-08.3` 人格与相处说明书 · 筛选、编辑、手机预览（控件：人格；相处说明书；筛选；编辑；手机预览） | `#/assessment` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B3；当前只有UI壳 | `UI_CONTRACT` |
| `UI-09.1` 阶段与复测计划 · 编辑标签、快捷回访天数、预览（控件：阶段；复测计划；编辑标签；快捷回访天数；预览） | `#/retention` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B4；当前只有UI壳 | `UI_CONTRACT` |
| `UI-09.2` 成熟队列、同版复测、对比查看（控件：成熟队列；同版复测；对比查看） | `#/retention` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B4；当前只有UI壳 | `UI_CONTRACT` |
| `UI-10.1` 交换名片规则 · 推荐、申请上限及预览（控件：交换名片规则；推荐；申请上限；预览） | `#/social` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B4；当前只有UI壳 | `UI_CONTRACT` |
| `UI-10.2` 同型雷达 · 开关、半径、匿名阈值及预览（控件：同型雷达；开关；半径；匿名阈值；预览） | `#/social` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor（草稿）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B4；当前只有UI壳 | `UI_CONTRACT` |
| `UI-11.1` 运行模式、适配器、模型、同源网关、画幅、超时、生成指令（控件：运行模式；适配器；模型；同源网关；画幅；超时；生成指令） | `#/ai-settings` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（系统参数）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-11.2` 连接检查、保存、打开双图调试台、接入说明（控件：连接检查；保存；打开双图调试台；接入说明） | `#/ai-settings` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（系统参数）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-12.1` 四通道切换、未保存提示与草稿（控件：四通道切换；未保存提示；草稿） | `#/payment-settings` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（支付商户/凭据引用）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-12.2` 商户、回调与凭据引用（控件：商户；回调；凭据引用） | `#/payment-settings` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（支付商户/凭据引用）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-12.3` 检查参数、预览收银入口、接入状态（控件：检查参数；预览收银入口；接入状态） | `#/payment-settings` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（支付商户/凭据引用）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-12.4` 回调演练 · 成功、重复、少 1 分、验签失败（控件：回调演练；成功；重复；少 1 分；验签失败） | `#/payment-settings` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（支付商户/凭据引用）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-13.1` 付款时限与兑换入口（控件：付款时限；兑换入口） | `#/trade-settings` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（交易规则）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-13.2` 售后方式、期限、当前生效规则（控件：售后方式；期限；当前生效规则） | `#/trade-settings` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（交易规则）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-14.1` 发布记录 · 详情、发布说明、确认发布（控件：发布记录；详情；发布说明；确认发布） | `#/release` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（发布/回滚）；reader 按字段脱敏读取；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-14.2` 草稿差异与草稿/线上预览（控件：草稿差异；草稿/线上预览） | `#/release` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（发布/回滚）；reader 按字段脱敏读取；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-14.3` 回滚为新版本、保留待发布草稿（控件：回滚为新版本；保留待发布草稿） | `#/release` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（发布/回滚）；reader 按字段脱敏读取；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-14.4` 操作日志（控件：操作日志） | `#/release` | C2 配置接口/UI_CONTRACT；permission code与字段待接口方确认 | owner（发布/回滚）；reader 按字段脱敏读取；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B5/C2；当前只有UI壳 | `UI_CONTRACT` |

## B1 实际证据与阻塞

- 已核对仓库 HEAD `80386d668bb79b196192c59eb83c6ce79e200dd9`；原型哈希如上。
- `/ops/` 路由/构建和客户端会话流程有代码；业务服务、四个真实角色、浏览器会话截图和 HTTP拒绝证据未取得。
- `GET /api/admin/mbti/orders/{id}` 客户端保留权限码 `mbti:orders:read`；不推断列表、导出、退款接口。B2 可接现有订单详情请求。
- 阻塞：指定 owner `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation` 不存在。总控确认当前其他 worktree 不是 test55437 owner，禁止重建、猜配置或重置身份。需原 owner 绝对路径和可核验 marker、数据库、角色及端口证据。
- B1不声明14页/42组已完成；未连接项由B2–B5/C2逐项补验。真实支付、位置聚合、模型供应方和微信真机维持未配置/blocked_external边界。
