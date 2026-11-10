# MBTI Admin B5 — 系统参数与发布日志 UI

四个实际路由 `#/ai-settings`、`#/payment-settings`、`#/trade-settings`、`#/release` 已实现原型布局、本机参数编辑/检查、切换保护与抽屉。全部持久读取、保存、发布、回滚、退款、真实连接检查继续禁用并标为 `UI_CONTRACT`；本次不是上线或服务端贯通验收。

## 派发、基线与范围

- Run `run_801f9322af2e`；Task `task_94a021919bed`；Dispatch `ctx_0192fc2d987a`。
- 根目录 `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti`；全程 `dev`，初始 HEAD `4283c36574427cd7ab50f6ffb1f8c9da21864d11`（B4）。初始无已跟踪修改，保留未跟踪输入包与 `._*` AppleDouble 文件；Git 的 `._pack-….idx non-monotonic index` 既有噪声未清理。
- 单 writer，无子 Agent、分支切换或新 worktree。无 push、部署、生产操作或外部消息（除授权的 Orca worker_done）。提交完整 SHA 见 worker_done 回执。
- 新增 `admin/src/b5.vue`、`b5.css`、`b5-model.ts`、`b5-contract.ts` 和 `admin/scripts/b5.test.mjs`，更新本交付文档及覆盖表 **UI-11.1–2、UI-12.1–4、UI-13.1–2、UI-14.1–4 十二行**。
- `admin/src/ops.vue` 仅装配 B5、接入已有服务端能力、路由键控卸载和共享未保存保护：当前项重复点击不清 dirty，退出先确认，刷新/关闭触发 beforeunload，前台预览转 B5 抽屉，移除 B5 旧空壳。B1/B2/B3/B4 业务文件、Foundation、H5 和权威 API 文档未改。

## 输入与消费者边界

已阅读原始 `inputs/mbti-dazi-admin.html` 的 AI/支付/交易/发布函数和校验、`cards/B5.md`、B3/C1/C2 卡、原始及仓内 ADMIN-COVERAGE、B3 交付及 `config-contract-v1.ts`、现有角色 policy、Foundation SecretRef 与配置投影实现。原始 HTML SHA-256：`fb7607763dbc41472bccda10fc24f9241ec4d306d3b745eaabdb7be4a94248a6`。

B3 `mbti-config-consumer/v1` 保持原样，scope 仍为 content/catalog/assessment。B5 在独立 `b5-contract.ts` 定义消费者扩展，**不是 HTTP、公开或私有 payload schema**。`read/saveDraft/publish/rollback` 一律返回 unavailable，`persistence=false`；组件不调用这些持久操作，也不发读取或重试请求。不猜 API 路径、版本 ID、商户、回调、凭据或正式字段。

每个待确认项均显式为 `{status:'needs_human_review', value:unknown, reason:string}`，当前 value 为 undefined：schema（字段/投影/端点）、authorization（真实会话与服务端授权）、secretReferences（获批受限投影）、revision（opaque 预期版本/冲突/回滚目标）、history（按权限的版本/审计/分页）、snapshots（旧版与未知订单/结果兼容）。C1/C2 负责实际适配、权限、校验、唯一生效版本、持久化与公共字段白名单。

## AI 参数：精确字段与真实模式

| 原型字段 / 约束 | 当前 UI / 动作 |
|---|---|
| 运行模式：mock 本机演示 / gateway 真实网关 | 可在当前页内存切换；分别显示 OFFLINE / REAL，均不生成图片 |
| 供应商适配器：wan 万相 / custom 自有双图网关 | 保留字段位置和原型选项说明；控件禁用，值 UNCONFIGURED |
| 模型 ID：最多64字符；原型模型字符集及wan模型匹配 | 字段禁用，UNCONFIGURED；没有默认真实模型或可编辑模型输入 |
| 业务网关路径（同源）：最多108字符，原型仅 /api/ 路径 | 字段禁用，UNCONFIGURED；不接收厂商URL，不发送health/generate |
| 输出画幅：960*1280（3:4）、1024*1024（1:1）、720*1280（9:16） | 内存选择并校验固定枚举 |
| 最长等待秒数：20–180整数 | 内存编辑与本机校验；不控制真实任务 |
| 全局生成指令：最多450字，可用 {mbti}/{style} | 保留只读textarea，固定无个人信息的说明样例；不开放个人提示词输入 |
| 保存接口草稿、检查网关连接、双图调试台、接入说明/下载 | 保存/连接/下载禁用；本机格式检查可用；已获draft呈现能力才可导航至既有B4；说明抽屉可用 |

四个真实状态 adapter/model/gateway/health 始终 **UNCONFIGURED**。未读取服务端验证来源，不把离线选择、格式通过或B4本机成图当真实就绪。无模型调用、API key、个人提示词、上传或费用；没有新增file input。双图工作室沿用B4，不修改其逻辑。

## 支付：四渠道与受限字段

`wechat` 微信小程序、`mp` 微信公众号、`douyin` 抖音小程序、`xhs` 小红书小程序始终分开。内存初始只是原型样例：允许新下单、mock、MBTI搭子体验店，**不是线上配置**。可预览开关、mock/live环境和两个固定非个人信息的展示名；原型展示名约束1–40字，当前不开放任意文本。切换有改动时必须返回继续编辑或放弃输入并切换；放弃后目标使用自己的初始样例，不串渠道。无跨页面草稿、localStorage或sessionStorage。

| 原型字段 | 渠道与原型格式 | 当前处理 |
|---|---|---|
| AppID，input上限64 | 微信小程序/公众号分别显示；wx+16字母数字；其余6–64字母数字/_/- | 字段禁用；owner呈现UNCONFIGURED，其余受限·未提供 |
| 商户号/平台商户标识，上限64 | 微信MchID为6–20数字；其余3–64字母数字/_/- | 同上；未设置或验证真实商户 |
| 支付通知地址、退款通知地址，各上限240 | HTTPS域名和非根路径，禁止账号、查询/片段、本机域/IP等 | 字段禁用；未配置、导航或发送回调 |
| 商户证书序列号，上限64 | 仅两个微信渠道，原型8–64十六进制 | 禁用；未读取证书 |
| 微信支付公钥ID，上限80 | 仅两个微信渠道，原型PUB_KEY_ID_后接5–70字母数字 | 禁用；未提供真实标识 |
| 商户签名私钥引用、APIv3密钥引用、微信支付验签公钥引用 | 微信小程序 / 公众号各自一组 | 只显示字段名称与“未提供获批引用”，没有input或引用标识 |
| 开发者签名私钥引用、平台回调验签凭据引用 | 抖音 | 同上 |
| 应用凭据引用、回调验签凭据引用 | 小红书 | 同上 |

安全约束覆盖原型的任意环境变量名输入器：本次没有输入、硬编码、模拟或拼接secretRef。Foundation现有 `GET /api/admin/secret-references` / `:id` 使用 `admin.secret.manage`，安全返回引用元数据（id/ref/provider/status/configured/updatedAt），不返回解析后的值；`SecretRefPort.resolveTrusted*` 只供服务端依赖，`assertOwnedRef` 核对项目/环境归属。配置服务的敏感行只返回referenceConfigured，publicContext剔除敏感或secretRef。本次**不调用**这些API，也不把平台密钥管理权从MBTI owner推导出来；将来须服务端明确批准MBTI字段投影。

保存支付草稿、持久读取和正式连接均禁用。本机“检查参数”只检查当前可编辑枚举，不验证未开放的商户/回调/引用；不得据此推定凭据存在、沙箱或真实通道就绪。当前生效收银入口/展示名/时限为未知。收银预览仅用当前非敏感输入排版，支付按钮禁用，无金额、商户、回调、引用或订单。

### 回调模拟器隔离证据

模拟器明确写 LOCAL ISOLATED SIMULATOR，每次独立运行固定枚举条件，不生成测试订单号，不持有业务订单或账户标识，不读取商品/订单服务，不执行真实验签。纯函数只返回 `{steps:string[], illustratedGrants:number}`，组件局部ref展示后即丢弃。

| 场景 | 样例累计权益计数 | 真实副作用 |
|---|---|---|
| 成功 | 1 | 未执行 |
| 同一条件重复两次 | 仍为1 | 未执行 |
| 金额少1分 | 0 | 未执行 |
| 验签条件失败 | 0 | 未执行；不验证真实签名 |

组件和纯函数测试将fetch/XHR/WebSocket/EventSource、localStorage/sessionStorage/IndexedDB、navigator/postMessage/console/history设置拒绝陷阱；四种场景及重复运行 effects 始终为空。浏览器也封闭网络/存储入口并实际操作drawer得到1/1/0/0。没有HTTP、付款、账户、订单、账本、退款、兑换或权益解锁；“样例权益计数”绝不是实际发放次数或审计记录。

## 交易 / 售后

精确字段：付款时限ttl（1–120分钟整数，原型30）；允许体验码兑换redeem（boolean，原型true）；售后方式selfRefund（self自助模拟退款/support仅客服，原型self）；自助售后期限refundDays（1–30天整数，原型7，从支付成功时间起算，仅自助使用）。可本机编辑和检查，非法值不打开效果预览。当前生效规则未知，保存交易规则与执行退款禁用。

这些内存字段不修改订单有效期、退款约定、兑换入口或已购/已兑换权益。旧订单继续按成交快照；缺少或未知旧版规则的存量订单保留原兼容语义，待C2确认。历史测评与结果快照保持原值。没有创建订单、兑换或退款请求。

## 发布 / 差异 / 版本 / 日志

三个页签：发布记录、草稿差异、操作日志。当前生效版本、线上题库版本、待发布类别全部“未知”；未接通不等于零差异或真实历史为空。发布说明textarea最多100字，仅内存，切换页签也有保留/放弃提示。

发布记录表保留版本/发布时间/说明/涉及配置/操作列；详情抽屉仅未知占位，不造版本、时间、发布者或类别，不提供版本ID输入/可猜URL。草稿/线上预览分别为未提供，服务端diff不可计算；另外“本机输入差异”只比较当前页与原型初始参数，明确不是线上差异，不产生版本。本机说明不写审计。

审阅发布占位、差异/版本/回滚说明/日志详情抽屉可看；**确认发布、确认回滚并发布、回滚为新版本均禁用且无处理器**。回滚仅说明未来须创建新版本、保留待发布草稿，旧订单、未知规则及历史结果快照不改。操作日志保留时间、操作者/角色、操作、对象、版本、结果、原因的结构，所有数据等待服务端按权限返回，无伪造行。没有成功保存/发布/回滚提示或浏览器合成的版本历史。

## 权限预期与允许 / 禁用动作

角色来源仍是既有真实session，不新增演示角色、token或客户端授权。`ops-policy.cjs` 的呈现grant：页面入口 `mbti:ops:system:read`；本机参数编辑 `mbti:ops:system:write`；发布/回滚预期 `mbti:ops:release:write`；B4导航另需 `mbti:ops:draft:write`。这些是**服务端grant预期**；按钮显隐、组件props与本地测试不是HTTP授权证据。精确C2操作权限/字段映射仍needs_human_review。

| 角色意图 | 当前允许 | 持久动作 |
|---|---|---|
| owner | 本机非敏感参数编辑/校验、隔离演练、预览与说明；有draft呈现能力可打开B4 | 全禁用 |
| editor | 系统受限视图与无敏感信息的占位预览；内容草稿仍属于B3/B4 | 全禁用；无商户/引用返回 |
| support / reader | 受限视图、未知来源与占位说明 | 全禁用；无演练/系统编辑/发布 |

能力撤回清除内存输入/演练，release能力撤回清发布说明。离页由共享导航guard保护，直接hash/后退取消会恢复当前hash，退出/刷新另有确认；同页重复点击保留输入。抽屉支持Escape、焦点进入/返回和Tab循环。桌面双栏、手机单栏/四渠道2×2，日志表在自身容器横向滚动。

## 验证、截图与实际命令

`admin/scripts/b5.test.mjs` 新增11项，共 **57/57**（原有46项全部通过）。真实挂载B5及ops组件，验证四实际路由、AI无真实来源、字段family、四场景、内存重建、能力撤回、持久按钮无handler、渠道/页签guard、侧栏/直接hash/退出/刷新保护。没有将组件会话fixture视为真实登录或HTTP授权验收。

浏览器使用临时独立Vite、匿名组件，无登录/角色/API；canEdit/canRelease仅测试参数。沿用现有样式但隔离入口去掉外部Google字体导入，不改产品原有字体加载。1440×1000与390×844四页无横向溢出。浏览器实际点击检查参数、切换、回调、交易预览、发布/差异/回滚/日志占位及加载/错误演练；effects为空。网络证据见本地 `/tmp/mbti-b5-browser-evidence.json`，命令日志 `/tmp/mbti-b5-browser-final.txt`，均不保存请求体、凭据或真实数据。

| 实际命令 | 结果 |
|---|---|
| `git branch --show-current` / `git rev-parse HEAD` / `git status --short` | 0；dev / 4283c365… / 既有未跟踪文件 |
| `shasum -a 256 .../inputs/mbti-dazi-admin.html` | 0；上列原型哈希 |
| `pnpm --dir admin test` | 0；57/57 |
| `pnpm --dir admin lint` | 0 |
| `pnpm --dir admin typecheck` | 0 |
| `pnpm --dir admin build` | 0；Vue类型检查+Vite，42 modules |
| `python3 /tmp/mbti-b5-browser-qa.py` | 0；四页桌面/手机、回调与禁用/guard/状态/隔离 |

首轮测试55/57暴露两处测试装置问题：把“不能声称网关就绪”的否定文案误匹配为成功，以及自定义renderer读取select.value而非selectedIndex。修正断言后57/57，不放宽安全要求。浏览器首轮网络捕获未启动，资源列表为空，不能用于网络结论；随后显式capture start + reload，重新检查资源分类及演练。截图路径与最终资源数量追加在下方。

## 全部真实验证仍 NOT_RUN

- 真实管理员session、四角色200/401/403、直接写接口/猜版本越权、凭据引用按角色脱敏、插件未启用拒绝、公网 `/ops/`：**NOT_RUN**。
- 持久read/save/restart/冲突恢复、空差异发布拒绝、两个管理员过期版本并发仅一成功、原子版本/审计、回滚新增版本且保留草稿：**NOT_RUN**。
- 真实AI gateway/health/adapter/model、供应商模型/费用/上传、真实超时/重试/幂等：**NOT_RUN**。
- 真实商户/回调/凭据存在性、四渠道沙箱/支付/验签/重复通知/金额与权益幂等：**NOT_RUN**。
- 业务服务端订单有效期、退款/兑换执行、新旧快照与未知旧规则兼容、撤销不影响既有权益：**NOT_RUN**。
- 两浏览器跨端草稿不生效→发布生效→回滚、H5版本/缓存/渠道匹配/字段白名单与旧在答会话冻结：**NOT_RUN**。

以上均待C1/C2真实配置服务与适配器，不以本地模拟替代。Foundation未改，未跑其测试/build；未push或部署，交接后停写。

## 最终隔离证据补记

最终 `python3 /tmp/mbti-b5-browser-final-audit.py` 退出0：实际组件重新运行四种回调，纯内存金额/验签条件判断与重复接受屏障得到1/1/0/0；mobile drawer适配390px，焦点进入dialog。累计捕获 **33条本地GET资源**，API=0、非GET=0、外部来源=0，存储/传输陷阱尝试为空；详情 `/tmp/mbti-b5-browser-final-audit.json`。这是匿名组件证据，不是会话授权、真实HTTP或公网后台通过证据。

桌面整页和以下手机分段/抽屉截图均已实际打开检查；手机AI/支付长页最初的full-screenshot有工具拼接重复顶部，改用top/middle/bottom viewport截图复核，不能把该拼接异常当页面重复内容。截图为临时本地证据，未提交，无真实用户或凭据。

- ai-settings / desktop：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/94173ab6-e47f-4f7a-8e3d-ad703a317c93-screenshot.png`。
- payment-settings / desktop：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/cbc547fd-7052-4f3e-9be8-523f8bb7c51f-screenshot.png`。
- trade-settings / desktop：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/3e236d20-70d9-41a6-bac6-58118cd2442f-screenshot.png`。
- release / desktop：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/01384f38-d566-46dc-a246-af96f49826b7-screenshot.png`。
- ai-settings / mobile-top：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/3e528bb0-7c8d-4f48-b9ae-a7251c98f061-screenshot.png`。
- ai-settings / mobile-bottom：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/0e656be6-29f4-4df9-ac13-d558deae7dff-screenshot.png`。
- payment-settings / mobile-top：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/42a85547-4279-4dda-ab06-3ab039dbb017-screenshot.png`。
- payment-settings / mobile-bottom：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/c540b142-775e-45e4-a35b-b01121be8c48-screenshot.png`。
- trade-settings / mobile-top：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/d96df77c-2f6a-4c51-9f40-d89dbd7c20ef-screenshot.png`。
- trade-settings / mobile-bottom：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/34f5210e-d946-4c54-9ea4-e3587f0a650b-screenshot.png`。
- release / mobile-top：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/3833137c-2b6a-4cf1-a8bb-e4442385adec-screenshot.png`。
- release / mobile-bottom：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/0df9c3e9-df16-4389-ad99-d38ec436c667-screenshot.png`。
- ai-settings / mobile-middle：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/60f79847-1408-4b86-8c6a-bd2cf0688c95-screenshot.png`。
- payment-settings / mobile-middle：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/846121f8-d3c8-40c5-bec0-e6e6f62fadc8-screenshot.png`。
- payment-settings / mobile-simulator：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/01c24fc5-ca5c-4693-a26a-1f9f2186abad-screenshot.png`。
- release / mobile-rollback-drawer：`/var/folders/fr/kb9f9wm136b_m4wtc2g52zsh0000gn/T/orca-browser-screenshots/c3a8f402-bda1-4d94-ae00-ff6ba313b6ee-screenshot.png`。

最终test/lint/typecheck/build分别退出0，测试57/57，build 42 modules；输出分别位于 `/tmp/mbti-b5-test-final.txt`、`/tmp/mbti-b5-lint-final.txt`、`/tmp/mbti-b5-typecheck-final.txt`、`/tmp/mbti-b5-build-final.txt`。QA服务及临时组件入口收尾时停止/删除。
