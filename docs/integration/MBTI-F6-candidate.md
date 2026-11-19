# MBTI F6 雷达只读准备候选

> **candidate / needs_human_review — 内部实现建议，不是正式 API 契约，也不是接口验收通过回执。**
> 本次仅新增本文件；没有实现接口、修改 Web、安装依赖、访问数据库、发送 HTTP 请求或启停服务。

## 1. 固定范围与结论

| 项目 | 本轮实际值 |
| --- | --- |
| Run / Task / Dispatch | `run_594d408d15de` / `task_ecea6da97426` / `ctx_a4cdf6f4a071` |
| 准备工作树 / 分支 | `/Users/lei/orca/workspaces/mbti/mbti-web-api-f6-prep` / `weiyang86/mbti-web-api-f6-prep` |
| 集成基线 B | `3580e0fd902a57b5870c7e376b5d98fe916a0e3c`，本树起始 HEAD，已含 F1–F4 |
| PR20 固定参考 P | `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`，使用本地 Git 对象读取，未切换或合并该分支 |
| 输入包 | `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane` |
| 本次提交范围 | 仅 `docs/integration/MBTI-F6-candidate.md`；精确候选 SHA 随 worker_done 交付，可用 `git log -1 --format=%H -- docs/integration/MBTI-F6-candidate.md` 复核 |

已读根、`web/`、`aij-foundation/` 的 AGENTS，以及输入包 `RUNBOOK.md`、`API-REVIEW.md`、`cards/F6.md`。根规则要求推断字段列为 unknowns / needs_human_review；不修改 `docs/api/`、业务源码或 `UIhtml/`，不 push、merge 或接触 main。F5 的后端/Web Writer 和运行环境不属于本 Worker 的操作范围，也不等待 F5 完成。

**建议执行 F6 卡的明确 fallback**：先实现 #44/#45 的本人参与事实持久化，默认退出、显式加入/退出且不收位置；#46 对合法本人请求明确返回不可用。仓内缺少自愿位置来源、雷达位置授权、距离计算和已确认聚合口径，不能用全站同型人数、Mock 常数或合成 cohort 声称真实半径统计可用。总控的位置来源询问尚无补充，本文件不假定已有授权来源。

| 序号 / 方法路径（共同前缀 `/api/v1`） | 准备结论 | 实际交付/验收状态 |
| --- | --- | --- |
| #44 `GET /radar/participation` | 可准备实现：仅本人，缺记录即 `enrolled:false` | 本轮仅候选；B 中无接口/模型，未实测，不能标 API 已通过 |
| #45 `PUT /radar/participation` | 可准备实现：严格 boolean、本人 upsert、退出不受类型/位置限制 | 本轮仅候选；持久化、A/B 隔离和重启证据待后续实现验证 |
| #46 `GET /radar/same-type` | 可先实现 unavailable 响应与 Web 分态 | 真实半径聚合 **blocked / not_available**；明确不可用分支也尚未实现/实测 |

依据：输入 `API-REVIEW.md:60–62`；`cards/F6.md:3–5` 明确缺数据先交 #44/#45，#46 不可用必须区别于“人数较少”；`RUNBOOK.md:23` 指定 F6 依赖 F4，迁移、路由和请求层单 Writer。

## 2. PR20 的真实请求与展示（只描述 P，不冒充已集成）

以下 `P:path:行号` 全部指固定 P 的源文件，须用 `git show P:path` 查看；不是当前工作树中的文件。

| 证据 | 准确提取 |
| --- | --- |
| `P:web/src/api/radar.ts:1–30` | 顶部仍是待 Remy 确认 TODO。`RadarParticipation={enrolled:boolean}`（5–7）；`SameTypeCount={count:number\|null}`（9–12），注释把 null 单一定义为“人数较少”。GET `/radar/participation`（14–17）；PUT 同路径、body `{enrolled:boolean}`（19–22）；GET `/radar/same-type` 可带 `type_code?:string`、`radius_m?:number`（24–30）。每个函数在 `useMock()` 时短路到 Mock。 |
| `P:web/src/api/radar.ts:26–29` | 两个 query 均只在 truthy 时编码；`radius_m:0`、空 `type_code` 会被客户端省略，不能据此认为服务端会接受这些原始输入。 |
| `P:web/src/api/types-social.ts:16–28` | `MyCard` 包含 `id/nickname/type_code/type_name/declaration/interests/style/visibility/has_visual_set/latest_result_id?/updated_at`。没有位置、雷达授权或半径；雷达两种响应接口定义在 `radar.ts`，不在此文件。`visibility` 只有 name/interests/declaration/manual（3–8）。 |
| `P:web/src/api/cards.ts:15–18` | 雷达页面的本人类型通过 `getMyCard()` → GET `/cards/me` 获取；Mock 开关也会使此请求短路。 |
| `P:web/src/pages/radar/radar.vue:84–90,108–125` | 半径按钮 `[500,1000,3000]`，初值 `500` 米；`enrolled` 初值 false。每次 `onShow` 调 `load()`，并发 GET 本人名片和参与状态，随后调用 `refreshCount()`；名片缺类型时以 INFP 示例代替。任一初始请求失败会设整页 `loadError`。 |
| `P:web/src/pages/radar/radar.vue:128–138,145–148` | 未参与不发计数请求；参与后实际调用 `getSameTypeCount({type_code:typeCode.value,radius_m:radius.value})`。换半径再请求。计数失败被 catch 吞掉并设 null。 |
| `P:web/src/pages/radar/radar.vue:96–105` | 未参与展示 `—` / “先选择体验状态”；参与且 null 展示“人数较少” / “附近同型参与者较少”；数字展示人数，注释为“位同型参与者 · 模拟人数”。**无法区分数据缺失、网络错误、低样本。** |
| `P:web/src/pages/radar/radar.vue:151–180` | 点击体验 PUT `{enrolled:true}`，关闭或模拟拒绝均 PUT `{enrolled:false}`。代码 await 后自行改本地 boolean，没有采用 PUT 响应的 enrolled；没有写入中互斥或过期计数响应保护。 |
| `P:web/src/pages/radar/radar.vue:3–5,19–26,51–65,192–198` | 明示 Mock、虚构示例、未读取 GPS、模拟授权/拒绝；规则文案写“少于 10 人”。这些是演示描述，不能作为真实位置授权或正式小样本政策。 |
| `P:web/src/api/mock/radar.ts:3–24,27–43` | 参与状态只存在模块变量及本机 `mbti_mock_radar_v1` storage；默认 false。半径对应虚构固定人数，低于 10 返回 null；既非服务端持久化，也没有真实类型、位置、双向 block 过滤。 |
| `P:web/src/pages/index/index.vue:69–71,165–166`；`P:web/src/pages/discover/discover.vue:14–15,156–157`；`P:web/src/pages.json:136–138` | 首页和发现页跳转雷达页，pages.json 注册雷达路由；真正的三项 API 消费在上述雷达页。 |

**B 的集成差异**：本树中 `web/src/api/radar.ts`、`api/mock/radar.ts`、`pages/radar/radar.vue` 均不存在；`web/src/pages.json:2–105` 未注册雷达，`web/src/api/index.ts:1–11` 无雷达出口，首页/发现页也无雷达入口。F4 的 `web/src/api/types-social.ts:20–26` 已在 MyCard 上增加 `discoverable`；应沿此已集成类型扩展，不能整份覆盖为旧 P。当前 `web/src/api/cards.ts:13–18` 已是真实请求，不再按 Mock 短路。

## 3. F4 能复用什么，缺什么

本节来源均是 B 的仓内文件；没有读取运行库、已有联系人或凭证。

| 能力 | 来源与行为 | F6 约束 |
| --- | --- | --- |
| 本人身份 | `aij-foundation/apps/api/src/mbti/mbti.http.ts:6,13–23`：`MbtiGuestGuard` 验证 `X-Guest-Token` 的格式、哈希匹配和有效期，写入 `req.mbtiOwnerId`；错误 401 `GUEST_UNAUTHORIZED` | 复用 guard；HTTP body/query 不接受 owner/guest/card/buddy ID 来决定参与人。不能另造会话体系。 |
| 直接业务响应/错误 | `mbti.http.ts:7–10,26–51`；`mbti-social.controller.ts:6–22`：MBTI_RAW、过滤器、guard、no-store；`src/bootstrap.ts:66` 全局 `/api` | 候选沿现有 raw JSON、`{code,message}` 错误与 `Cache-Control:no-store`。 |
| 本人持久类型 | `mbti-social.service.ts:46–64`：首次 `/cards/me` 会创建名片，用本人最新结果的有效 typeCode 初始化；已有名片直接返回其 typeCode。`66–98` 允许本人更新合法类型；`mbti.types.ts:2–19` 有 16 型枚举 | “本人真实类型”在此指服务端本人名片的已存类型，包含允许的自选类型，不代表经独立测量认证。已有名片不会随新结果自动同步；不可把客户端 INFP fallback、query 或最新结果直接覆盖为现有名片类型。 |
| 同型校验先例 | `mbti-social.service.ts:144–158`：`mode=same` 要求存在本人名片类型，传入 type_code 必须与本人相同 | #46 也只查本人同型，不让 query 选择任意类型的人群。`myCard()` 会懒创建记录，不宜在雷达只读路径中当作纯读取 helper；实现时用本人名片只读查询/由该 owner 提供只读 helper。 |
| 双向 block | `mbti-social.service.ts:101–114` 的公开 `isBlocked(tx,a,b)` 查询任一方向 active；`156–159` 在 SQL 排序/分页之前过滤两方向；`178–191` 屏蔽/解除及关系收紧 | 将来聚合必须在计数和小样本抑制之前应用两方向 active block，不能只过滤本人拉黑列表或计数后扣减。可复用语义/服务，不能复制另一套 block 状态。 |
| 名片公开开关 | `schema.prisma:1885–1901`；`mbti-social.service.ts:79–81,110–124`：discoverable 默认 false；visibility 控制公开投影 | `discoverable` 不是雷达参与、位置授权或退出记录。#45 不能顺带改公开名片开关；加入搭子发现也不能自动加入雷达。雷达是否还要求 discoverable 见 U05。 |
| 实际模型 | `schema.prisma:1780–1793,1825–1839,1885–1933`：Guest、Result、Card、SocialBlock、CardExchange | 有 owner/type/双向屏蔽关联，但无雷达参与表、位置、位置来源/精度/时效、位置 consent、半径 cohort。F4 迁移 `20261109000100_mbti_f4_social_candidate/migration.sql:1–36` 也只创建名片/block/交换。 |
| 通用 consent 不能直接套用 | `schema.prisma:290–307` 的 `ClientConsentRecord` 属于 `MemberUser` 和 namespace；`src/client-auth/dto.ts:58–65` 只接受 `ai_assistance/marketing`；`client-auth.service.ts:543–578` 按 member 读写 | 并非 MbtiGuest 雷达位置同意；无已接通的 guest→member 雷达授权映射。不得当成用户已允许位置聚合。 |
| 现有 Web 请求层 | `web/src/api/client.ts:3–5,46–80,84–120,127–129`：按 baseURL 保存本人游客、并发初始化、带 token；401 留住失效身份且不自动换号重放写入 | 雷达沿 request 接线。后续实现不另写认证，不使用构建期全局凭证；此 Worker 不修改共享层。 |

`MbtiSocialService` 行号均指 `aij-foundation/apps/api/src/mbti/mbti-social.service.ts`，schema 指 `aij-foundation/apps/api/prisma/schema.prisma`。已集成宿主在 `src/app.module.ts:46` 按本项目和数据库能力装配 MBTI；`mbti.module.ts:35–45` 的现有 controller/provider 未含雷达。

## 4. 真实聚合输入审计

`not_available` 表示**已查范围内没有接通此能力**，不等于已证明某外部系统不存在数据；此 Worker 未访问外部供应商或运行库。

| 所需输入 | 查明结果 | 缺失内容/责任输入 |
| --- | --- | --- |
| 雷达自愿参与、退出事实 | **not_available**；P 只有本地 Mock，B 的 MBTI 模型/路由无 participation | 后续新增本人状态持久化；不能从名片 discoverable、联系人授权或测试样本推断参与。 |
| 自愿位置来源和取数入口 | **not_available**；B 的产品/API/schema/MBTI 脚本未发现定位采集、粗粒度位置或供应方读取路径；P 页面明确未读取 GPS | 总控/业务提供来源 owner、授权用途、数据接口/字段和身份关联、精度/坐标或网格定义、时效与撤回机制。不能自行 GPS、IP 定位或请求浏览器 geolocation。 |
| 位置授权/撤回数据 | **not_available**；上述通用 consent 不适用；P 的“模拟授权”仅 PUT boolean | 位置用途和文本版本、明确允许的粗粒度输入、同意状态及采集时间、撤回/到期语义；#44/#45 的 enrolled 不等于这些已就绪。 |
| 可用距离算法/索引 | **not_available**；检索产品源码、Prisma/迁移、packages、MBTI 脚本无 Haversine、PostGIS、ST_DWithin/ST_Distance 或 radius_m 实现 | 坐标系、距离单位、粗粒度误差/边界、可重复计算方法、执行/索引方案；仅城市/区域名称不足以承诺 500 米统计。 |
| 半径口径 | **仅 P UI 已知**：500/1000/3000 米，默认 500；**正式服务端定义 not_available** | 是否只支持这三档、中心取值、边界包含规则、定位陈旧/误差处理，需产品确认。 |
| 小样本阈值/抑制策略 | **仅 P UI/Mock 提及 10**；**已确认业务门槛 not_available** | 阈值 k、计入本人否、0 的处理、跨半径/重复查询的隐私边界。禁止把 Mock 的 `<10` 擅定为正式策略。 |
| 实际聚合数据模型/cohort | **not_available**；已有 Guest/Card/Block 只能支撑身份/type/block，不能形成有位置授权的人群 | 去重身份、参与/位置有效性与授权关联、同一时点一致性、退出/类型变更/block 生效规则；没有真实参与样本可证明半径聚合。 |

## 5. 最小候选请求、响应、校验与持久化

**本节全部为 candidate / needs_human_review。** `enrolled`、`count`、`type_code`、`radius_m` 来自 P；下面新增的 `status/reason`、枚举、错误 code、内部模型/字段及校验选择都是推断建议，未经 Remy 定稿。样例是形状示例，没有实际 HTTP 成功证据、token、个人数据或模拟人数。

### 5.1 共通规则

- 三项均复用 `MbtiGuestGuard`，只使用 `req.mbtiOwnerId`；成功业务对象直接返回，不加 Foundation 通用 envelope。成功与错误均 no-store。
- 严格白名单。#44 无 query；#45 无 query 且 body 只允许必填 `enrolled:boolean`；#46 query 只允许 `type_code/radius_m`。拒绝未知键、重复 query、数组/对象、空值或不符合约定的类型，不用 `Boolean(value)` 隐式转换。
- #45 `true` 建议先用 owner 读取本人名片并校验合法类型；未设置类型拒绝并提示先选择。`false` 始终可退出，不依赖名片、类型、位置供应或聚合成功。该加入前置条件是候选选择（U03）。#44 只读已存状态，不因缺类型重置状态。
- 雷达 GET 不懒创建名片或参与记录。没有已存本人名片/合法类型时，#46 返回 422 `RADAR_TYPE_REQUIRED`；不使用 P 的 INFP 示例或擅自改用最新测评。

### 5.2 #44 / #45：只存本人参与事实

```http
GET /api/v1/radar/participation
```

候选 200：新游客/无记录 `{ "enrolled": false }`；已存状态只可能为 `{ "enrolled": true }` 或 false。

```http
PUT /api/v1/radar/participation
Content-Type: application/json

{ "enrolled": true }
```

候选 200：事务提交后返回 `{ "enrolled": true }`。退出请求仅将 true 换成 false，返回 `{ "enrolled": false }`；重复相同 PUT 保持一个本人状态，不能翻转开关。响应采用已提交结果，不提前宣称成功。既不接受也不收集坐标、位置来源或 IP；body 带 `owner_id/guest_id/buddy_id/type_code/radius_m/location/latitude/longitude` 等额外键一律拒绝，不允许替他人参与。

候选内部存储 `MbtiRadarParticipation`（**新增模型名及全部内部字段均推断 / needs_human_review**）：`ownerId` 唯一主键并 FK 指向 MbtiGuest、`enrolled Boolean default false`、服务端 `createdAt/updatedAt`。不存位置，不在此复制类型/block/contact；读取缺行按 false 投影，PUT 按 guard 的 owner upsert。当前状态/时间只能证明最后的参与选择，不声称已具备位置用途授权记录或完整 consent 审计；是否需要版本化参与文案/历史见 U02。

后续由唯一后端 Writer 安排附加迁移和模块装配；本文件不附可执行迁移。并发 PUT 需按 owner 事务序列化，重复同值不产生多份记录，最后已提交的选择为准；Web 禁止并发点击。退出提交后新聚合不得再包含该 owner；不返回其他 owner、位置、名单或联系方式。当前 fallback 不计算聚合，因此退出后仍只能明确不可用，不能用计数变化作为退出持久化的证明。

### 5.3 #46：明确不可用，预留与低样本不同的结构

```http
GET /api/v1/radar/same-type?type_code=INFP&radius_m=500
```

其中 INFP 仅是形状示例，必须等于该请求身份在服务端名片上的已存合法类型；不是允许查询任意类型。`type_code` 可省略，省略时取本人名片；若提供，须是 16 型中的精确大写码且与本人相同，其他类型也应拒绝。无本人合法类型走上述 `RADAR_TYPE_REQUIRED`，不凭 query 补全。

`radius_m` 可省略。候选内部兼容范围为**仅三档 `{500,1000,3000}`、缺省 `500`**，来自 P 页面按钮/初始值；不是已定稿的连续数值范围或正式业务口径。建议只接受单个十进制整数字符串并精确匹配三档，拒绝 0、负数、小数、NaN、指数、越界、重复值；最终范围/中心/边界仍为 U04。即便都暂时 unavailable，也要先校验输入，不能悄悄忽略半径或改算全站。

建议判定顺序：guard → query 结构/半径/类型枚举 → 本人名片合法类型 → type_code 一致性 → 本人参与状态 → 已配置并授权的数据源/计算政策。数据源未配置时不进行计数查询。

合法本人已参与、位置来源未接通：候选 **200**（业务能力状态，不是精确人数）：

```json
{ "count": null, "status": "unavailable", "reason": "location_source_not_configured" }
```

合法本人未参与时，直连 #46 建议同为 200：

```json
{ "count": null, "status": "unavailable", "reason": "not_enrolled" }
```

`status/reason` 及以上枚举为新增推断字段，**needs_human_review**。两者均不得返回 `count:0` 或 `status:low_sample`；无位置不是已测得零人或人数较少。数据库/传输错误也不能伪装为该成功响应。

供后续确认的完整互斥状态候选：

| status（新增推断） | count | reason（新增推断） | 当前 fallback 是否允许产生 |
| --- | --- | --- | --- |
| `unavailable` | 必为 null | `not_enrolled` 或 `location_source_not_configured` | 是；不代表聚合运行过 |
| `low_sample` | 必为 null | `below_minimum_sample` | 否；必须先具备真实合法位置、计算口径、业务确认 k 并实际计算后才能用 |
| `available` | 非负整数且满足已确认披露门槛 | null | 否；不能复用 Mock 的常数或全站计数填充 |

将来配置部分就绪但本人位置授权/位置时效/计算政策仍缺失时也应 unavailable，并经评审扩展明确 reason；不能绕过缺项进入 available/low_sample。本轮不虚构供应商或位置字段。

### 5.4 候选拒绝与错误

| 条件 | HTTP / `{code,message}` 候选 | Web 应做什么 |
| --- | --- | --- |
| 缺失/格式错误/失效游客凭证 | 401 `GUEST_UNAUTHORIZED`，沿用现有 guard | 显示会话失效；不自动换号重放 PUT |
| 非法 JSON / 超大 body | 400 `INVALID_JSON` / 413 `BODY_TOO_LARGE`，沿用现有 parser 中间件 | 显示操作失败，不改 enrolled |
| 未知字段、非 boolean/缺 enrolled、非法 query/半径/类型枚举 | 422 `INVALID_RADAR_INPUT`，如“雷达请求参数无效”（新增候选 code） | 参数错误明确显示；不要转成“人数较少” |
| PUT true 或 #46 缺本人合法名片类型 | 422 `RADAR_TYPE_REQUIRED`，如“请先设置本人的 MBTI 类型”（新增候选 code） | 引导已集成名片类型设置；保留退出能力 |
| #46 提供合法但不等于本人的 type_code | 422 `RADAR_TYPE_MISMATCH`，如“查询类型与本人名片不一致”（新增候选 code） | 重读本人名片，提示类型变化；不自动尝试另一种类型 |
| DB/内部异常 | 500 `INTERNAL_ERROR`，沿用现有 filter，不回传 SQL 或内部记录 | 保留原参与状态并显示重试；计数为请求失败状态 |

新 code 均待评审；没有“对他人参与”成功分支：body/query 中的身份字段在白名单阶段拒绝，不能查出对方参与状态。对 #46 不可用采用 200 是为明确业务状态；基础设施失败仍是失败，不吞成 count:null。

## 6. Web 必要接线（候选清单，本轮没有改 Web）

1. 基于 B 的 F4 Web 接入，不整体合入 P。新增对应雷达封装/页面和 `pages.json` 注册、首页/发现入口；路由与请求层由总控安排单 Writer。使用当前 `request`、已集成 `MyCard`、`getMyCard`，真实联调须 `VITE_USE_MOCK=false`，在 Network 看到 #44、PUT #45 以及已参与后的 #46；本次未做此验证。
2. 将 `SameTypeCount` 改为上述明确状态联合，校验成功响应的互斥形状；仅 null 不足以决定展示。没有 status 或未知形状视为读取失败，不回退为低样本。未参与为“尚未参与雷达”；已参与但来源不可用为“同型统计暂不可用”并说明“尚未接入自愿位置来源”；低样本才显示“人数较少”。请求错误单列“统计读取失败，点击重试”，401 使用现有失效流程。未发布聚合政策前不要展示承诺“少于10人”的正式规则。
3. 去掉真实模式下 INFP 示例回退，缺类型提示“请先设置我的 MBTI 类型”。参与、位置授权、名片 discoverable 分开说明。加入按钮文案可为“参与雷达”，并在操作前说明“当前仅保存参与选择，位置统计暂不可用；不会读取定位”；成功为“已保存参与选择”，不能显示“已定位/已扫描到附近人数”。关闭为“退出雷达”。不请求浏览器 geolocation，不用 IP 推断位置。
4. 采用 GET/PUT 返回的 enrolled 更新状态；保存中禁用重复点击，失败保留已确认状态。页面刷新/onShow 重新读 #44，不用 Mock storage 假装服务端状态。退出成功立即清除旧 count，仍允许以后再显式参与；不因退出或请求失败自动撤销/修改名片公开状态。
5. 修复 P 的异步覆盖：切换半径、load、加入/退出都递增本地请求序号，计数响应只在仍参与且 type/radius/序号一致时采用；退出后晚到响应不能重新显示人数。count 请求失败不得覆盖 enrolled。保存状态失败可重读 #44 核实，不自动重放一次未知是否提交的写操作。
6. 当前真实模式删除/替换 P 的 Mock 条幅、虚构区域、模拟授权、模拟人数 toast 和说明；独立 Mock 若保留，必须明确演示且不可作为 API/位置/持久化验收证据。真实 fallback 的半径控件可禁用并说明尚未开放统计，不展示真实扫描效果；不要影响参与/退出操作。

## 7. 后续真实聚合启用条件与验收边界

真实聚合只可在授权来源、可用粗粒度位置、距离算法、半径定义、样本政策均明确后启用。候选计算顺序：同一一致性读取中选有效参与 owner → 位置授权/时效有效 → 本人已存类型相同 → 排除任一方向 active block → 实际按约定半径/粗粒度距离筛选 → 每个 owner 去重 → 应用已确认 k → 仅返回聚合状态/人数。是否排除本人建议与 F4 搭子一致先排除，但仍是 U05，不能把这个建议写为正式口径。

不要用列表 limit、只看发出的 block、全站同型量或“当前用户已参与”的 boolean 代替上述计算。退出、位置授权撤回、类型变更或 block 在提交后的新查询中必须重新生效；不得用过期缓存继续展示或计入，解除 block 不得自动恢复位置授权或参与状态。数据源只提供区域且无法支撑所选米级口径时保持 unavailable。任何返回都不带他人位置、个人名单、私密类型、联系方式或内部 owner ID。

下表是**后续执行计划，全部未运行**。只读准备成功不等于这些验收通过。实施 Worker 使用本项目获准的独立测试环境、新建 A/B 测试身份，不能触碰原有联系人/凭证；重启只由获派 runtime owner 执行。

| 后续验证 | 如何取得证据 | 当前状态 |
| --- | --- | --- |
| #44 默认退出 | 全新 A/B 各用本人身份 GET，均 200 false；服务端未创建参与选择或位置 | 未实现/未运行；不受位置缺口阻塞 |
| #45 本人显式开/关 | A 设置合法本人名片后 PUT true，再 GET true；B GET 仍 false；重复 PUT true 稳定；A PUT false 后 GET false，B 不变 | 未实现/未运行；不受真实位置缺口阻塞 |
| A/B 与输入拒绝 | 用新 B 的测试身份标记尝试 body/query 代 A 参与须 422，A 状态不变；测 string true、0、缺键、额外位置键、非法 query；缺/失效 token 401；无类型 true 拒绝但 false 成功 | 未实现/未运行；只记录用例标记、状态和结果，不记录 token/真实个人数据 |
| #44/#45 刷新与重启持久化 | A true / B false 后由 runtime owner 重启**同一测试 API、同一测试库**，复用各自原身份再读 A true/B false；A 退出后再重启，仍 false；Web 刷新与新 #44 响应一致 | 未实现/未运行；浏览器 storage、仅页面刷新或换成新游客均不能证明服务端持久化 |
| #46 fallback | A 本人合法类型且已参与，三档半径/省略参数均 200 null+unavailable+location_source_not_configured；直连未参与为 not_enrolled；错误类型/半径拒绝；Web 显示不可用而非低样本/0 | 未实现/未运行；此分支可以在位置缺口存在时交付 |
| 真实参与/退出影响人数 | 基于明确授权来源的固定可追踪测试参与者，参与/退出前后计数按已确认口径变化，不泄露小样本 | **blocked**：无合法位置 cohort、参与存储、确认口径 |
| 真实半径变化/边界 | 已知位置及误差口径的固定测试样本，在三档半径和约定边界验证实际筛选 | **blocked**：来源、距离算法、半径中心/边界未定 |
| 双向 block 在聚合生效 | 在有充分合法样本且可披露的测试条件下，分别 A→B 和 B→A block，验证计数前排除；解除不复活已退出者 | **blocked**：F4 模型可复用，但没有雷达聚合可验；F4 列表通过不代表雷达通过 |
| 小样本与位置授权撤回 | k−1/k/k+1 等受控样本验证抑制，撤回/过期后立即排除，UI 与 unavailable 分开 | **blocked**：k、计数主体/隐私政策、位置授权与实际数据均未闭合；禁止伪造 cohort 声称真实功能可用 |

## 8. unknowns / needs_human_review

| ID | 需要的输入/决定 | 本轮候选或保守处理 |
| --- | --- | --- |
| U01 | 自愿粗粒度位置由谁提供，来源/授权/精度/时效/撤回和身份关联，是否实际支持米级半径 | **not_available**；保持 #46 unavailable，不自行采集 GPS/IP，不调用外部供应商 |
| U02 | 参与文案与位置同意的边界、参与记录是否需版本/历史、失效游客和账户删除的留存/清理 | 当前建议仅存参与当前事实及服务器时间；不声称 enrolled 就是位置授权；留存不能自行定稿 |
| U03 | 加入是否必须已有本人类型、已有名片与新结果的类型同步/变更后的处理 | 建议 true 需合法已存名片类型，false 无条件可退；#46 只读当前本人名片；不静默同步/重设类型 |
| U04 | 正式半径范围/默认、中心/边界/误差、距离计算及可验证性 | 仅候选三档 500/1000/3000、默认500；无已确认距离算法，不宣称已能算 |
| U05 | k、0/本人是否计入、雷达参与与 discoverable 的关系、跨半径/差分查询边界、block/退出一致性 | P 的10不是定稿；建议先排除本人并应用双向 block，但实际聚合启用前须确认全部口径 |
| U06 | 新状态/原因/错误码、200业务不可用结构及 Web 文案 | `status/reason`、枚举、新 code 均为推断；需后端/Web 共同评审，再由 Remy 决定正式契约 |
| U07 | 实施 Writer 的 schema/迁移、模块路由、Web 请求层独占时段与验收环境 | 由总控安排，不能与 F5 同时改共享层或据本准备文档自动启停环境 |

## 9. 本轮实际核查命令与证据限制

以下均在本准备树执行；源文件只读。源文件读取使用 `nl -ba … | sed -n '…p'` 或 `cat`；搜索使用 rg；没有安装依赖、运行测试套件、curl/HTTP、迁移/seed、启动/重启 API/H5/数据库。文档提交及只针对本文件的静态检查另见提交回执，不代表运行验证。

| 实际命令/核查组 | 结果 |
| --- | --- |
| `pwd`；`git status --short --branch`；`git rev-parse HEAD`；`git log -1 --format='%H%n%s'`；`git merge-base --is-ancestor 3580e0fd902a57b5870c7e376b5d98fe916a0e3c HEAD`；`git diff --stat` | 起始干净，分支与 B 如第1节；ancestor 退出0；无起始改动 |
| `cat AGENTS.md web/AGENTS.md aij-foundation/AGENTS.md`；读取输入包 `RUNBOOK.md/API-REVIEW.md/cards/F6.md` | 退出0；已核对本轮只读准备与 fallback，不延用上游历史授权 |
| `git show a39d99cf8537a6e54c34e965b2c3ff6c2691a21f:web/src/api/radar.ts`（另读 `types-social.ts`、`pages/radar/radar.vue`、`api/mock/radar.ts`） | Python subprocess 单独核实各命令退出0；分别31/93/428/49行，不只依赖管道末尾退出码 |
| `git grep -n -E 'radar\|RadarParticipation\|SameTypeCount' a39d99cf8537a6e54c34e965b2c3ff6c2691a21f -- web/src`（实际以扩展正则的竖线分支执行）及 `git show` 首页/发现/pages.json | 已定位第2节的页面、注册和实际消费者；未运行 P 页面 |
| `nl -ba` 读取 `mbti.http.ts`、`mbti-social.controller.ts`、`mbti-social.service.ts`、`mbti.module.ts`、`mbti.types.ts`、schema 1780–1933/290–307、F4 migration、当前 Web client/cards/types/pages/index；读取 Foundation README/MBTI_INTEGRATION | 退出0；第3节给出路径及行号，README 的导入时“尚未实现”不能覆盖 B 的真实 F4 源码 |
| `rg -n -i 'navigator\.geolocation\|uni\.(getLocation\|chooseLocation)\|wx\.(getLocation\|chooseLocation)\|latitude\|longitude\|radius_m\|ST_DWithin\|ST_Distance\|haversine\|postgis\|location[_A-Z -]?consent\|位置授权\|自愿位置\|距离计算\|小样本' web/src admin aij-foundation/apps/api/src aij-foundation/apps/api/prisma aij-foundation/packages aij-foundation/scripts/mbti docs/api docs/integration`（以正则竖线分支执行） | 写本文件前仅命中既有 F4 候选文档149行，没有可用实现；不把此后本文件的命中算新能力 |
| `rg -n -i 'radar\|radius_m\|enrolled\|geolocation\|latitude\|longitude\|haversine\|ST_DWithin\|ST_Distance\|postgis' web/src admin aij-foundation/apps/api/src aij-foundation/apps/api/prisma aij-foundation/packages aij-foundation/scripts/mbti docs/api`（以正则竖线分支执行）；`rg -n 'goRadar\|雷达\|radar' web/src/pages/index/index.vue web/src/pages/discover/discover.vue web/src/pages.json web/src/api/index.ts` | 无匹配；rg 的退出1是没有匹配，不是接口通过或运行失败 |
| Python `Path.exists()` 检查 B 的 `web/src/api/radar.ts`、`api/mock/radar.ts`、`pages/radar/radar.vue` | 三者均 false；退出0 |
| Python 静态核对候选元数据、代码围栏、Markdown 表格列数；subprocess 独立重跑上述无匹配的源码/当前入口 rg | 元数据/围栏/表格退出0；两个 rg 分别退出1（无匹配），没有运行接口或业务测试 |

部分 Git 读取发出共享对象目录 `._pack-…idx` 的 `non-monotonic index` 警告，但上述固定快照四文件的读取独立返回0且正文完整。本 Worker 没有清理、修复或写共享 Git 对象索引；这不改变本轮源文件结论，也不是 API 运行故障证据。

后续接手人从本候选提交取文档即可；#44/#45、#46不可用分支与 Web 接线仍需正式实施和实测，真实聚合保持 blocked。不得把本次准备的 succeeded 回报解释为三项接口已交付或位置统计已开放。
