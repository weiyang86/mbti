# MBTI Ops B2a — 订单与交付交付记录

## 基线与候选

- Run `run_801f9322af2e`；Task `task_1fb29d7f766c`；Dispatch `ctx_ffae4f870355`。
- 工作目录 `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti`，全程 `dev`，未切分支或工作树。
- 开工核对 HEAD：`271d2deacf24fc9b57dce1a8dfc6f2e77e17c8a0`，即指定 B1 集成基线。
- 已验证的代码候选 SHA：`874f0c19328063fff4e83ff04d1cb1e0f6179eb5`；提交 `feat(admin): 接入订单按号详情并标明未接通动作`。
- 本记录随后单独提交；最终交付 HEAD 以本记录提交及 Orca `worker_done` 中的完整 SHA 为准。后续提交仅补本文，不改变已验证代码。
- 来源：`orca-inputs/MBTI-Orca-20261109/inputs/mbti-dazi-admin.html`、同输入包 `cards/B2.md`、[覆盖表](MBTI-ADMIN-COVERAGE.md)；本次仅完成 B2a 订单屏，不展开 B2 经营总览、增长或治理。

开工时受控文件无修改；已有未跟踪的输入包、许多移动硬盘 AppleDouble `._*` 元数据。Git 自开工即报告 `.git/objects/pack/._pack-…idx` 的 `non-monotonic index`，实际读取、diff 和提交成功；没有清理或修复共享 Git 对象目录，没有把元数据加入提交。

## 变更路径

| 路径 | 用途 |
|---|---|
| `admin/src/orders.vue` | 订单页四标签、按号详情、状态处理、未接通动作禁用 |
| `admin/src/orders.css` | 沿用 B1/原型紫色工作台体系的订单样式和手机布局 |
| `admin/src/ops-order.ts` | 按现存服务实现投影字段、校验同号、金额与日期展示 |
| `admin/src/ops-api.ts` | 读取订单原始响应，保留 Foundation 会话/刷新/CSRF 机制 |
| `admin/src/ops.vue` | 原 `/ops/#/orders` 入口接入组件，去掉 JSON 整包显示 |
| `admin/scripts/orders.test.mjs` | 合成响应的客户端测试、实际 Vue 组件内存渲染测试和现有 Guard 元数据检查 |
| `admin/scripts/ops-policy.test.mjs` | B1 路由/角色持久化约束覆盖拆出的订单组件 |
| `admin/eslint.config.js` | 排除本移动硬盘自动生成的 `._*` 元数据，避免其被当源代码解析 |
| `docs/execution/MBTI-ADMIN-COVERAGE.md` | 精确更新 `UI-03.1` 至 `UI-03.5`，其他 B2 页仍待接入 |
| `docs/execution/MBTI-ADMIN-B2-ORDERS-DELIVERY.md` | 本次范围、证据及未完成项 |

未修改后端实现、权威 API 文档、Foundation `/admin/`、公网源码/配置、数据库、账号或订单。依赖、构建目录、隔离布局检查文件及截图均未提交。

## 接口与界面行为

唯一业务请求为 **`GET /api/admin/mbti/orders/{orderId}`**；原服务端精确权限 **`mbti:orders:read`**，保留 `JwtAuthGuard`、`PermissionsGuard` 和 `Cache-Control: no-store`。页面能力仅控制入口显示，订单操作本身由实际 HTTP 响应决定。没有新增列表、退款、导出、交付或兑换码请求。

现存 `MbtiOrdersAdminController` 使用 `MBTI_RAW`，`TransformInterceptor` 对其跳过 `success/data` 包装；B1 客户端原先按通用包装读取，B2a 已修正为只对此订单请求读取原始响应。Foundation 登录、会话和注销继续使用原包装，Cookie 为 `same-origin`，401 最多刷新并重试一次。格式错误的成功响应变为客户端 `INVALID_ORDER_RESPONSE` 错误，不能作为订单成功；上游实际 502 仍是服务错误。

只保留 `id`、`result_id`、`product_code`、`amount`、`currency`、`status`、`unlocked`、`created_at`、可选 `paid_at`、`payment_availability`、`pricing_mode`。响应订单号必须与查询号完全一致，金额须为非负整数，币种须为三位大写码，字段结构不符即清空详情并报错。额外字段（含 provider 凭据、支付参数、联系方式、答案）不会进入组件状态，也没有原始 JSON 回退展示。

输入仅去首尾空格、保留大小写，接受 1–128 位字母/数字/短横线/下划线，拒绝内部空白、控制符、HTML、路径或查询字符；再经 `encodeURIComponent` 构造单一路径段。金额明确显示如合成测试夹具的 `990 分 · CNY`，不会推算实付、退款或经营总额。时间注明北京时间；`unlocked` 与素材交付分开展示，接口未返回的交付/退款信息明确待接入。

加载、初始空态、输入错误、404、403、401、网络/超时、5xx 和无效响应分别处理。修改/清空订单号即清除原结果，较早请求的迟到响应以及离页后的结果被丢弃，权限拒绝不会保留上一次详情。未知状态码显示“未识别状态”及原业务码。

四个原型标签均保留。列表日期/渠道/状态、分页和导出可见禁用；生成任务异常/详情/恢复范围/同任务重试、退款、体验码按套装/生成/停用、本机订单刷新/详情/处理均明确 `UI_CONTRACT` 及依赖。没有创建假订单或演练成功，没有把权益解锁当成交付成功，没有复制原型 localStorage 账本。任何角色在本页均无业务写路径；这不等于真实 reader 写入拒绝已验。

## 实际命令与结果

运行版本：Node `v24.21.0`、pnpm `10.0.0`。以下 pnpm 命令工作目录为根 checkout 的 `admin/`。

| 命令 | 退出码 | 实际结果 |
|---|---:|---|
| `pwd`、`git branch --show-current`、`git rev-parse HEAD`、`git status --short` | 0 | 目录、dev、指定 B1 HEAD 正确；元数据警告与未跟踪文件如上 |
| `pnpm install --frozen-lockfile` | 0 | 锁文件未修改，依赖仅本地安装 |
| `pnpm test`（最终） | 0 | 13 项全部通过，含原 B1 两项 |
| `pnpm lint`（最终） | 0 | 无错误/警告 |
| `pnpm typecheck`（最终） | 0 | `vue-tsc --noEmit` 通过 |
| `pnpm build`（最终） | 0 | Vite 构建16模块，base `/ops/`；产物留在忽略的 `dist/` |
| `git diff --check`、`git diff --cached --check` | 0 | 无空白错误，精确路径暂存 |
| `test -d /Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation` | 1 | 指定原 F1 owner 仍不存在，没有重建 |
| `orca ports --json` | 0 | 开工时当前工作区未发现监听端口 |
| `curl --noproxy '*' --max-time 5 --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' http://127.0.0.1:4256/api/admin/mbti/orders/MBTI-B2-local-read-probe` | 7 | `ECONNREFUSED` / HTTP `000`；没有收到 HTTP 响应，不能计为401/403/404 |
| `git -c gc.auto=0 commit -m 'feat(admin): 接入订单按号详情并标明未接通动作'` | 0 | 生成上述代码候选 SHA，无 push/deploy |

首次 `pnpm test` 为 exit 1（12/13）：测试里的 logout 桩误用了原始订单响应；将该桩修正为 Foundation 包装后重跑通过。首次 `pnpm lint` 为 exit 1：解析 `._main.ts` 等 AppleDouble 文件失败；添加专用忽略后重跑通过。最终检查均在完整代码改动后执行。

13项测试里的订单/会话 HTTP 均为**隔离合成响应**，并非真实服务记录。测试核对同号与分/币种、原始响应/包装差异、敏感额外字段丢弃、无效200响应拒绝、403/404/5xx区分、401单次刷新/失败退出、CSRF保留、网络/超时、实际Vue组件空/加载/详情/错误态、换号清空/迟到响应忽略及未接通控件禁用。服务端定向检查只读取现有 controller 的 Guard/permission/no-store/原始响应元数据，未执行真实 Guard 或数据库授权。

## 布局检查的限定范围

本机 `pnpm dev` 启动4255后，Orca打开 `/ops/`，观察到真实未登录视图及4256代理 `ECONNREFUSED`；没有输入账号或模拟会话。另以忽略目录内临时 HTML **单独挂载订单组件**，页首显示“隔离组件样式检查 · 未登录，未查询真实订单，不代表 RBAC 验收”。此文件已删除，Vite和该浏览器标签已关闭。

实际使用 `orca tab create`、`goto`、`snapshot`、`viewport --width 1440 --height 1000`、`viewport --width 390 --height 844 --mobile`、`screenshot`、`fill`、`click`、只读 `eval`、`tab close`；成功命令 exit 0、`ok:true`。检查了桌面/手机空态、非法 `../invalid` 输入产生 `aria-invalid=true` 与错误提示、三个未接通标签的禁用态。390px时 `document.documentElement.scrollWidth === innerWidth === 390`。HMR曾使旧ref失效（CLI exit 0但`ok:false/browser_stale_ref`），重新snapshot后重试成功，没有把旧ref失败计为成功。

本地忽略截图为 `admin/.local-data/b2-orders-layout-desktop.png` 和 `admin/.local-data/b2-orders-layout-mobile.png`。这些只证明隔离组件布局，**不是已登录订单页、四角色、真实订单详情或原型同页面对照的浏览器验收**。

## B1 阻塞与剩余验收

| 验收 | 状态与原因 |
|---|---|
| test55437真实owner/editor/support/reader登录、刷新、安全注销及权限/持久化 | `NOT_RUN / BLOCKED`；原owner缺失，缺少同仓database/user/port/project marker；未运行账号初始化或猜测环境 |
| 已授权运营/reader按号200、无权限账号403、失效或无会话401、授权账号查缺失号404 | `NOT_RUN / BLOCKED`；本地无可用API/DB身份，不能用模拟响应或路由404冒充权限拒绝 |
| editor/reader对退款、重试、导出等真实服务端拒绝 | `NOT_RUN / UI_CONTRACT`；本页未接任何该类请求，接口/契约待定，未声称HTTP403通过 |
| 公网真实H5订单与运营页同号/同金额/同币种/同状态/同解锁核对 | `NOT_RUN / BLOCKED`；由总控后续协调独立开发域身份及数据库，不读取或修改公网账号/订单 |
| 真实订单支付/退款/交付/导出/体验码、幂等与审计 | `NOT_RUN / UI_CONTRACT`；本次没有这些实现或验收 |

后续由总控在已确认的开发环境创建/选择同一H5订单，将前台订单号原样交给有真实 `mbti:orders:read` 的管理员与reader查询，核对金额（分）、币种、状态和解锁；再分别验证无权限账号实际403、无会话/游客实际401、授权账号缺失号实际404及响应无敏感字段。保留脱敏HTTP与已登录桌面/手机截图，补全B1会话和真实角色拒绝证据，才可提升服务端/公网验收状态。本次未连接公网、未配置/重置DB、未开收费能力、未push/部署，也未启动其他B2页面。
