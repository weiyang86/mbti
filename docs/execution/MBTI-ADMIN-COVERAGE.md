# MBTI 运营工作台动作覆盖记录（B1）

基准原型：输入包 `inputs/mbti-dazi-admin.html`，SHA-256 `fb7607763dbc41472bccda10fc24f9241ec4d306d3b745eaabdb7be4a94248a6`。实现 `/ops/` 路由为 UI 外壳，真实业务服务尚未连接；不能把占位空态当成业务验收。原稿42组按单项动作列出，组内复合操作展开到按钮、表单、筛选与弹层。

状态：`UI_SHELL` 表示导航或控件占位；`UI_CONTRACT` 表示等待后续业务 API；`NOT_RUN` 表示未执行验收。B2–B5/C2 不预先勾选。订单唯一既有读取 API 为 `GET /api/admin/mbti/orders/{id}`，权限 `mbti:orders:read`。前端 capabilities 只负责显隐，服务端决定授权。未创建订单、配置草稿或支付数据。

## 全局动作（B1）

| 动作 / 控件 | admin 路由 | API / 服务端权限 | 角色/字段边界 | HTTP拒绝 / 持久化 / 证据 | 状态 |
|---|---|---|---|---|---|
| 侧栏分组、14路由原序、当前项键盘可达 | /ops/#/overview…#/release | GET /api/admin/mbti/ops/session | 四角色按服务端能力显示 | HTTP与四角色拒绝未验；桌面/手机对照截图未采集 | UI_SHELL |
| 顶部工作队列与页面返回 | 全部14页 | 工作队列 API 未定 | 按页面权限 | 空态占位；返回使用浏览器历史；未验 | UI_SHELL |
| 功能搜索、Ctrl/⌘K、Escape | 全部14页 | 本地路由搜索 | 仅列服务端可见页面 | 仅UI操作；键盘验收未执行 | UI_SHELL |
| 日期范围与渠道筛选 | overview/growth | 指标 API 未接通 | 允许读取汇总者 | 无随机KPI；自定义日期当前仅UI | UI_CONTRACT |
| 列表搜索、状态、分页条数、翻页 | 业务页 | 各业务查询 API 未接通 | 按服务端读取权限 | 0条空态；分页控件；无持久化 | UI_CONTRACT |
| 详情/预览抽屉、遮罩关闭、移动导航折叠 | 全部14页 | 预览 API 未接通 | 服务端决定可见数据 | 触控尚未实测；抽屉明确未连接 | UI_CONTRACT |
| 草稿表单、未保存提示、放弃/返回 | content/catalog/assessment/ai/retention/social | 配置 API 未接通 | owner/editor可编辑范围；仅owner发布 | 本地临时文本；保存禁用；HTTP拒绝未测 | UI_CONTRACT |
| 加载/空/错误/401/403/500/超时 | 登录与全局请求 | Foundation auth + /api/admin/mbti/ops/session | 以真实会话及权限为准 | 客户端有错误映射；无服务器实测 | UI_SHELL |
| 管理员登录/刷新/CSRF安全注销 | /ops/登录 | POST /api/auth/browser-login；GET /api/auth/session；POST /api/auth/logout | Foundation SysUser/Role/Permission | test55437 owner/账号缺失；DB与浏览器验收阻塞 | NOT_RUN |
| AIJ超管与项目owner隔离 | /ops/登录与权限路由 | GET /api/admin/mbti/ops/session | owner非superadmin；AIJ超管单独标识 | 代码拒绝浏览器伪角色；真实HTTP403/字段未验 | NOT_RUN |

## 原型42组逐项动作

| ID / 原型动作（逐控件展开） | admin路由 | API / 权限 | 允许角色与字段范围 | HTTP拒绝 / 持久化适用阶段 / 证据 | 状态 |
|---|---|---|---|---|---|
| `UI-01.1` 日期/渠道筛选与周期对比（控件：日期/渠道筛选；周期对比） | `#/overview` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor/support/reader（查看）；导出 owner/editor/support；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-01.2` 切换净实收、支付订单、访问人次及指标口径（控件：切换净实收；支付订单；访问人次；指标口径） | `#/overview` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor/support/reader（查看）；导出 owner/editor/support；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-01.3` 运营待办、工作队列与模板跳转（控件：运营待办；工作队列；模板跳转） | `#/overview` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor/support/reader（查看）；导出 owner/editor/support；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-01.4` 导出报表 CSV（控件：导出报表 CSV） | `#/overview` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor/support/reader（查看）；导出 owner/editor/support；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-02.1` 渠道指标、测评完成与传播行为（控件：渠道指标；测评完成；传播行为） | `#/growth` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor/support/reader（查看）；导出 owner/editor/support；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-02.2` 预览后 7 日付费率与指标口径（控件：预览后 7 日付费率；指标口径） | `#/growth` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor/support/reader（查看）；导出 owner/editor/support；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-02.3` 导出渠道表（控件：导出渠道表） | `#/growth` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/editor/support/reader（查看）；导出 owner/editor/support；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-03.1` 交易订单 · 搜索、状态、分页、导出、详情（控件：交易订单；搜索；状态；分页；导出；详情） | `#/orders` | GET /api/admin/mbti/orders/{订单号}；`mbti:orders:read`（保留既有码） | owner/support（退款/重试）；reader（允许读取）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-03.2` 生成任务 · 筛选异常、详情、重试、恢复范围（控件：生成任务；筛选异常；详情；重试；恢复范围） | `#/orders` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/support（退款/重试）；reader（允许读取）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-03.3` 退款原因与确认（控件：退款原因；确认） | `#/orders` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/support（退款/重试）；reader（允许读取）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-03.4` 体验兑换码 · 生成一批、按套装、停用（控件：体验兑换码；生成一批；按套装；停用） | `#/orders` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/support（退款/重试）；reader（允许读取）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-03.5` 本机前台订单 · 刷新、详情与处理（控件：本机前台订单；刷新；详情；处理） | `#/orders` | 对应B2/B3/B4业务接口/UI_CONTRACT | owner/support（退款/重试）；reader（允许读取）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-04.1` 互换/联系授权与待处理统计（控件：互换/联系授权；待处理统计） | `#/moderation` | 名片治理 API 待契约/UI_CONTRACT | owner/editor/support（处理）；reader（拒绝写入）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
| `UI-04.2` 查看处理、查看记录、驳回/限制（控件：查看处理；查看记录；驳回/限制） | `#/moderation` | 名片治理 API 待契约/UI_CONTRACT | owner/editor/support（处理）；reader（拒绝写入）；低权限不返回支付凭据、私密联系方式或私有作答 | 成功/拒绝HTTP及数据变化：`NOT_RUN`；阶段：B2；当前只有UI壳 | `UI_CONTRACT` |
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
