# MBTI Admin C2 候选交付：配置 consumer、公开硬闸与快照边界

2026-11-10。Run `run_801f9322af2e`，Task `task_79f69865ab99`，Dispatch `ctx_d32fe5fca289`，worker `term_7f5eb2c8-0db5-4152-ae05-f9a8d294b5ab`。根 checkout `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti`，单 Writer，分支 `dev`；起点 `dfc0cbe07a9e7a136d6b9ce110b7940ca4d5ada3`，已包含 C1 `8b582f8`。最终完整 SHA 见本文件所属提交及 worker 回执。

**代码候选已接入并通过本地验证；整张 C2 的真实运行验收仍 BLOCKED / NOT_RUN。** 八类公开候选尚未收到 Remy 批准，本次没有开放匿名配置值、启用插件、push、部署、创建账号、迁移/Seed/重置数据库或改根 `docs/api/` 正式契约。没有恢复或猜测原 test55437 owner。采用 orchestration / orca-cli 技能执行派发回报，未派生 worker。

## 实现与 consumer 归属

已读根/web/Foundation AGENTS、C2 卡、RUNBOOK、C1/B3/B5 交付及 consumer 边界，核对当前请求/session/CSRF、题库/session/result、商品/订单 owner 和 Prisma schema。Foundation 接入与独立上游边界保持不变。

根 admin 的 B3–B5 十个配置路由（`#/content`、`#/catalog`、`#/assessment`、`#/ai`、`#/retention`、`#/social`、`#/ai-settings`、`#/payment-settings`、`#/trade-settings`、`#/release`）上方装配 `config-server.vue` + `config-api.ts` 的真实 C1 候选 consumer，复用 `ops-api.ts` 同源 Cookie/CSRF/no-store 请求。读取失败直接显示实际状态，无演示登录或本机持久化。原 B3/B4/B5 typed 表单、手机预览、计分、文件/双图及回调演练留在折叠的“本机原型演练”内；其旧 unavailable consumer 不冒充 API 接线。

API 面板选择本页可读类别，展示真实 draft 和 published 两列；编辑一个完整类别 JSON 对象，经 C1 原 schema 严格验证后才保存。null 表示未配置，不自动用原型 Seed。面板展示服务端类别级 diff、draft revision、published version、项目/环境、needs_human_review/unknowns。JSON 格式错误不发请求；服务端验证失败为 400。没有新增自由发布说明、凭据、模型、商户或资产字段。

UI 入口可根据真实 ops session 中现有 `admin.config.manage` 权限呈现；旧 B1 capability 仅用于原型呈现。保存/发布等动作依赖 C1 在当前数据库事务内返回的 `authorization`（`canSaveDraft` / `canPublish` / `canReadSystem`），并在每次写入重新鉴权。ops session 原 `mbti:ops:access` 入口要求保留；没有授予新角色或推断权限。

保存只提交一个类别和当前整数 expectedDraftVersion。保存后重新读取两份投影，发布/回滚后也清空并重读；读取期间 active 版本或项目/环境不一致显示 409。400/401/403/404/409/503 清除旧投影、抽屉和操作权限，不自动覆盖冲突。输入未保存时导航、直接 hash、退出和刷新均有保护；异步旧响应在离页后不能恢复状态。

## 实际管理路径与授权

前缀 `/api/plugins/mbti-config`；C1 的 JwtAuthGuard、PermissionsGuard、PluginRoute 和服务事务内 gate 均保留。请求 `cache: no-store`；C1 controller 成功响应 `Cache-Control: no-store`。

| 方法/路径 | 当前用途与输入 | 服务端要求 |
| --- | --- | --- |
| GET `/draft`、`/published` | 真投影、修订、diff、授权及原 unknowns | `admin.config.manage`；普通权限只读前八类 |
| PATCH `/draft/:category` | 恰好 `{value,expectedDraftVersion}`；完整类别 | `admin.config.manage`；系统三类另需平台超管+`admin.secret.manage` |
| POST `/publish` | 恰好 `{expectedVersion,expectedDraftVersion}` | 平台超管+config+secret；CAS/非空差异 |
| POST `/versions/:version/rollback` | 恰好 `{expectedVersion}`，更早有效版本 | 同上；新版本号，保留草稿 |
| GET `/versions`、`/versions/:version`、`/audit` | 实际版本/审计列表与详情抽屉 | C2 收紧为平台超管+config+secret，服务内检查；普通 config 或仅持 secret 的非超管均 403 |

版本/审计抽屉没有本机伪记录。历史版本、回滚目标与审计 ID 只使用服务端响应。所有发布入口均不读取 B1 的 release capability 充当授权。系统类仍只有 aiRuntime/payments/trade 候选，credentialRef 继续由 C1 从任何响应移除。角色正式映射继续 needs_human_review。

## 匿名入口硬关闭与精确候选白名单

候选路径为 `GET /api/v1/config/published?channel=wechat|mp|douyin|xhs`，仅在 plugin 装配后存在，另有 PluginRoute 每次安装/启用检查。controller **没有配置服务依赖**，`MBTI_PUBLIC_APPROVED=false` 是源码常量，没有环境变量、客户端参数或安装标志能改变它；即使误改常量，第二道拒绝也不返回数据。有效单渠道请求固定 404，无 categories、source、version 或任何配置值；无/重复/任意 channel，或附带 draft/view/projectId/environment/version 等额外 query 返回 400。停用/安装行删除为 404，项目环境归属不可用为 503，均不带值；公开异常过滤器也设置 no-store。

未注册公开 draft、历史版本或任意 scope 查询。future `publicCandidate()` 只是**没有 HTTP consumer 的内部候选读取方法**：从可信运行配置及 active ProjectProfile 派生数据库项目 ID，在同一事务中锁定安装并检查 enabled，仅取 release.active 指向的快照，绝不读 draft。它和纯函数 projector 供替身测试及后续获批后的接线审查使用；不能将其测试称作匿名发布生效。

内部 projector 逐类别重新执行严格 C1 shape 校验，再按以下唯一候选白名单复制；此表不等于正式批准或当前公开响应。

| 类别 | 完整允许字段 |
| --- | --- |
| content | headline、accent、sub、cta、moments、avatar、meet、caption |
| channels | 仅请求渠道的一个 key；内含 name、landing、badge；不含另外三渠道 |
| catalog | shop 项 id/title/cents/desc/on；styles 项 id/title/art/on/order |
| assessment | question_bank_version；questions 项 id/index/dimension/prompt/options(id/label)/reverse；无用户答案或私有计分记录 |
| personas | 16型固定 key，各 title/quote/recharge/communication/care |
| imageRecipes | recipe 枚举 |
| retention | tags、days |
| discovery | order、daily、radar、radius、minimum；无位置或实际人数 |

系统类 aiRuntime/payments/trade 不进入白名单；payment/merchant/secretRef/凭据/provider/model/prompt/PII/用户记录不读取、不返回，嵌套额外字段经严格 schema 拒绝。未来公开 schema 仍是 `mbti-config-candidate/v1` / needs_human_review；没有提升进根 OpenAPI。

## 渠道、缓存和 H5 展示边界

web 只将原型四个**精确名称**映射为公共 channel：`微信小程序→wechat`、`公众号 H5→mp`、`抖音小程序→douyin`、`小红书小程序→xhs`。原始 mp/h5、任意字符串、对象或原型属性名均不能转换。H5 当前默认入口名为“公众号 H5”，显式非法 channel 保持回退，不降级映射为其他渠道；首页到目录携带原名称。正式渠道归因仍待 owner 确认。

未来投影身份为 `(ProjectProfile.id, channel, publishedVersion)`，`cacheIdentity = JSON.stringify([projectId,channel,version])`；ProjectProfile 是服务端当前环境的项目行，客户端无法指定。admin 和公开候选服务都不缓存投影、不缓存草稿；web adapter 每次 GET 重读，不创建游客、不附 guest token、不读写游客身份或配置存储，没有共享响应缓存。publish/rollback 后面板显式清空再读，停用/删除安装/权限及服务错误清空；再次启用从源重读。没有缓存可跨进程或浏览器残留，无需在 lifecycle 另建第二套失效账本。

H5 首页预留已发布 headline/accent/sub/cta、单渠道 badge/落地入口；商品目录仅预留独立、只读的 title/desc 展示预览。客户端复制白名单显示字段，丢弃候选价格、题库和人格对象。旧商品列表、可售状态、结算金额和下单 body 仍归原业务 API。任何不可用、错误 shape、错误渠道/identity、draft 或系统字段响应都返回 null，沿用原页面；目前因匿名硬闸始终回退。离页或刷新读取先清空预览并用请求序号丢弃旧响应。没有用配置覆盖结果页、已在答会话或历史订单。

## 版本与快照：查到的事实及不能验证的部分

- C1 release 的整数 expectedVersion / expectedDraftVersion 是内部候选 adapter 标识，与旧 consumer 的 unknown revision 明确区分，不伪造版本。发布和回滚继续使用同一 C1 ScopedConfig / ConfigurationChange / AuditLog owner，无新表/迁移。
- `MbtiOrder` 已有 amount/currency/status/pricingMode，创建从服务端 `MBTI_PRODUCTS` 拷贝 amount/currency；幂等重放按原订单返回。读取仍按 row 投影，状态按原支付账本 owner 正常演进。C2 没有更改它、产品/支付 owner 或历史行。
- `MbtiQuizSession.bankVersion` 引用 `MbtiQuestionBank.version`，保存答案/提交按该 session 原 bankVersion 查 scoring；`MbtiResult` 保存 bankVersion/typeCode/dimensionCounts。web quiz draft 持有原题目及版本并校验恢复。C2 不更新这些 owner、记录或存储键。
- **上述 schema 没有 configuration publishedVersion 的稳定快照字段**，题库 payload/scoring 的不可变管理 owner 和配置到真实商品 ID/人格的映射也未定。故本次不把配置版本塞进 bankVersion、pricingMode 或本机存储，不添加迁移，不让新 session/order 采用候选题库/价格/规则，不重写任何历史数据。
- 新旧真实订单金额/币种/状态和旧 session/result 问题/答案语义：**NOT_VERIFIED，真实 DB 场景 BLOCKED/NOT_RUN**。代码审查和业务现有单元回归不等于历史数据实测；没有伪造历史持久化 fixture 来勾选通过。

## 验收证据分层

| 场景 | 实际证据 | 仍缺 |
| --- | --- | --- |
| A 保存草稿，B 仍旧发布 | 实际 C1 owner+事务替身；挂载 Vue 面板旧 published 不变，保存后重读；匿名有效渠道 404 无字段 | 真实双浏览器/DB；匿名生效因审批未开放 |
| active+draft 并发 | 本地真实 Nest HTTP 两请求返回 [200,409]；内部投影新 version/value，仅同一渠道 | PostgreSQL 锁/跨进程/真正匿名新值 |
| 回滚 | HTTP 200 新 v3；draft revision 保留；内部投影旧值且新 identity | 真实 DB/浏览器 |
| 停用/删除安装 | 真实 lifecycle/runtime owner+事务替身；admin/public 404，内部读取 404，无缓存；重启 fixture 不造数据 | 真数据库重启/安装生命周期 |
| 非法字段/查询/秘密 | 严格 schema、额外 body、八类 allowlist、query/channel、draft/system/identity 前端拒绝 | 真实浏览器越权复验 |
| 历史订单/测评 | schema与调用链检查；原业务回归；配置 owner 不写业务模型 | NOT_VERIFIED，未持久化验证 |
| 角色/错误 | 本地 Nest HTTP 实测 200/400/401/403/404/409/503；无 session、config 账号、无权限、系统类拒绝、持 secret 非超管拒绝、root 发布和历史成功 | auth transport 为 stub；真 JWT/Cookie/CSRF、真实账号角色 NOT_RUN |

`mbti-config.test.ts` 共12项，使用真实 ManagementAccess、PermissionsService、PluginRuntimeAccess、Lifecycle、生产 controller 方法与 schema；仅身份 transport 和数据库事务存储为替身。HTTP 是 `127.0.0.1:<ephemeral>` 临时端口，测试后关闭，没有可长期访问的 dev URL。admin 新5项测试实际挂载 server 组件，覆盖单类别、修订、发布/回滚/历史、状态、越权按钮和旧异步；其余原57项不削弱。web 42项含匿名无身份、四名称映射、draft/system/wrong-channel 拒绝、展示字段裁剪和无缓存生命周期测试。web 的“两个 browser”只是独立 VM/uni.request 替身，不是真浏览器。

## 命令与结果

完整最终命令数组、退出码、耗时和本机日志路径记录于 [C2 checks](MBTI-ADMIN-C2-CHECKS.json)。最终执行结果如下，构建与同一 Foundation 的测试串行，避免重建 dist 干扰。

| 命令 | 结果 |
| --- | --- |
| `pnpm --dir admin test` | 0，62/62 |
| `pnpm --dir admin lint` / `typecheck` / `build` | 各0；47 modules |
| `pnpm --dir aij-foundation test` | 0，scripts 97/97 + API 95/95；其中配置12项 |
| `pnpm --dir aij-foundation exec node --test scripts/verification/plugin-manifest.test.mjs scripts/verification/configuration-schema.test.mjs` | 0，39/39；覆盖 dfc0cbe 原 owner 关系白名单 |
| `pnpm --dir aij-foundation lint` / `typecheck` / `build` | 各0；Nest API、workspace packages、Next web |
| `npm --prefix web run test:api` / `type-check` / `build:h5` | 各0；42/42、Vue 类型检查、H5 构建；构建有现存 Sass 弃用提示 |
| `npm --prefix web ci` | 0；仅恢复锁文件依赖，未改 lock/依赖版本 |
| `git diff --check` | 0 |

初轮 web 未安装依赖导致 esbuild/vue-tsc 不存在，按现有 lock 用 npm ci 修复。现有 web 测试把中文路径 URL.pathname 直接交 esbuild，产生编码路径解析失败，改为 fileURLToPath（两处），保留原断言。初轮 admin 新组件 renderer 缺全局 document/兄弟节点与移动语义，原 ops fixture 缺 permissions；补齐替身后原测试及新测试通过，没有放宽业务/授权校验。

## 审批、阻塞与 unknowns

1. **PENDING_HUMAN_APPROVAL**：Remy 尚未批准八类可在 dev 暴露给 H5；硬闸保持 false。获批后还需审查接线、正式字段/角色/渠道归属和投影，不靠环境变量上线。
2. **BLOCKED / NOT_RUN**：原 F1 test55437 owner 缺失；未猜 env、重建数据库/账号、重置或 Seed。需总控提供已建立的同 MBTI dev 数据库及可核验归属，才能做真 DB 两浏览器、Cookie/CSRF、持久重启和公共域同单号测试。
3. **needs_human_review**：原 MBTI_UNKNOWN 全部保留；正式类别字段/ID、每类权限及插件权限命名、商户凭据族、公开用户投影、C2 正式 revision 语义和历史兼容仍未定稿。系统真实模型/商户、消息、资产、位置/聚合与 B1/B2 其他缺口未关闭。
4. 新订单/新 quiz/config version 快照及题库不可变 owner 缺少获批语义；保持只读展示/回退，不复用字段或迁移历史。真实 H5/运营/超管/API 可访问地址与角色账号当前无可核验新证据，不能把示例端口或临时 HTTP fixture 报作运行服务。

未修改 main、独立上游、根正式 OpenAPI、Prisma schema/迁移、真实 env/用户数据、公共部署；现有 AppleDouble 与 orca-inputs 未跟踪内容保留。精确路径提交在 dev 后停写，由总控处理审批和真实环境验收，不能把本地候选当成 C2 已全面通过。
