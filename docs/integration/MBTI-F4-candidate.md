# F4 内部候选：名片、搭子与名片交换 #24–35

状态：`candidate / needs_human_review`。这是下一位后端/Web Writer 的实现准备材料，不是已定稿或已发布的 API 契约，也不是 F4 接口通过回执。12 项均未在本准备任务中发送 HTTP 请求。

## 依据与标记

- Run `run_594d408d15de`；Task `task_58bbb815c52e`；Dispatch `ctx_49feab013109`。
- 工作树基线 `777a5ea1c4229f6540582345827a316d90afd6fe`，核验时与本地 `dev` 相同，已含 F2 实现 `ecd65aedecb4fc804070484e56c251ed1c1a6df9`。交付证据见 [F2 集成记录](../execution/MBTI-WEB-API-F2-DELIVERY.md)。
- 固定前端参考为 PR20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`，不是浮动 PR 分支。源码以下列 `git show` 读取，不依赖网络。
- 输入包：`/Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane`；已读 `RUNBOOK.md`、`API-REVIEW.md`、`cards/F4.md`，并核对 F5/F6 卡。
- **E**：固定 PR20 的请求封装、TypeScript 类型或页面明确消费；它们自己带“待 Remy 确认”的 TODO，不代表业务确认。
- **R**：本轮任务、API-REVIEW 或 F4/F5/F6 卡明确要求的边界。
- **P**：本准备提出的实现/兼容建议，均为 `needs_human_review`。P 不得被当成已确认字段、默认值、状态码或迁移决定；未定项集中在 U01–U12。

源文件索引（行号均属于固定 PR20）：

| 代号 | 源文件与核对范围 |
| --- | --- |
| C | [cards.ts](https://github.com/weiyang86/mbti/blob/a39d99cf8537a6e54c34e965b2c3ff6c2691a21f/web/src/api/cards.ts#L6)：6–27，更新体与 3 调用 |
| B | [buddies.ts](https://github.com/weiyang86/mbti/blob/a39d99cf8537a6e54c34e965b2c3ff6c2691a21f/web/src/api/buddies.ts#L6)：6–39，查询参数与 5 调用 |
| X | [card-exchanges.ts](https://github.com/weiyang86/mbti/blob/a39d99cf8537a6e54c34e965b2c3ff6c2691a21f/web/src/api/card-exchanges.ts#L6)：6–28，4 调用 |
| T | [types-social.ts](https://github.com/weiyang86/mbti/blob/a39d99cf8537a6e54c34e965b2c3ff6c2691a21f/web/src/api/types-social.ts#L1)：1–70，F4 类型；72–93，F5 类型 |
| MC | `web/src/pages/card/card.vue`：8–19 无类型态；183–307 读写、开关与导航；49–67 兴趣与隐私说明 |
| PC | `web/src/pages/card/public.vue`：34–67 展示；91–109 公共投影读取与失败态 |
| D | `web/src/pages/discover/discover.vue`：53–65 展示；90–149 列表参数、状态与详情入口 |
| BD | `web/src/pages/buddies/detail.vue`：41–68 交换状态 UI；118–188 调用与撤回；211–225 屏蔽 |
| W | `web/src/pages/exchanges/exchanges.vue`：28–34 展示；58–98 列表、F5 并发依赖与跳转 |
| A | `web/src/pages/account/account.vue`：147–176 公开开关与加载；241–248 保存；267–285 屏蔽列表/解除 |
| H | `web/src/pages/history/detail.vue`：222–241，“用这次类型更新名片”确认后写 type_code/declaration |
| CP | `web/src/pages/compat/compat.vue`：141–149，getMyCard 取本人类型，失败/缺类型回退示例 INFP |

复核单个文件：`git show a39d99cf8537a6e54c34e965b2c3ff6c2691a21f:web/src/api/cards.ts`，页面与其他文件替换路径即可。上述完整页面已读取；以下只引用与接口有关的部分。

## 共同 HTTP 与身份边界

全部路径带 `/api/v1` 前缀。E：PR20 `api/client.ts:40–46` 接受所有 2xx，直接将 JSON 当成业务对象，非 2xx 抛 `HttpError`；这些 F4 页面没有按某个具体错误码分支。GET/PUT/POST 的类型化业务对象必须实际返回，不能用空 204 代替对象；两个 DELETE 的 `void` 不消费响应体。**PR20 没有为 F4 确认精确成功或拒绝状态码。**下表中的 200/201/204/404/409/422 都是 P，供实现者与审核者选择可复验的一致口径。

R：使用 F1/F2 每浏览器独立游客，服务端操作人来自凭证，不能信任 body/query 中的 owner、sender、recipient、direction 或状态。现有 `MbtiGuestGuard` 从 `X-Guest-Token` 摘要查找未过期 `MbtiGuest`，写入 `req.mbtiOwnerId`；缺失/无效/过期为既有 401 `{code:"GUEST_UNAUTHORIZED",message}`。沿用裸业务对象和 `{code,message,details?}` 错误，不回退 Mock，不自动换号重放写操作。

P：为 F4 响应统一 `Cache-Control: no-store`；不可见、被任一方向屏蔽、不存在或第三人交换 ID 使用同形 404，不通过差异信息帮助枚举。只在当事人权限检查后返回状态冲突 409；合法 JSON 的字段/枚举错误用 422，JSON 解析错误沿用现有 400。新业务错误 code 名称尚未约定（U12）。

## 12 路由逐项映射

响应别名的所有字段见下一节。表内请求/响应形状为 E，数据范围为 R；精确状态码标 P。路径中的 `id`/`card_id`/`buddy_id` 不能未经 U01 审核就互相等同。

| # | 方法与路径 / PR20 函数 | 请求（E） | 响应（E）与候选状态（P） | 实际页面入口 / 可见范围 |
| --- | --- | --- | --- | --- |
| 24 | `GET /cards/me` / `getMyCard`，C15–17 | 无 body/query | `MyCard`，200；新号的缺省形状 U02 | MC224–234；D94；BD132；A173；CP143及F6；仅本人完整可编辑名片与 visibility，不能借此读他人 |
| 25 | `PUT /cards/me` / `updateMyCard`，C6–12、20–22 | 全部可选：`nickname:string`、`type_code:string`、`declaration:string`、`interests:string[]`、`style:CardStyle`、`visibility:Partial<CardVisibility>` | 完整 `MyCard`，200；非法值 422 | MC241–250、A241–248 发单个 visibility 键；H231–234 发所选历史的 type_code 与类型宣言（无 result_id）；仅凭证本人，字段白名单，不接受联系方式或身份注入 |
| 26 | `GET /cards/{card_id}` / `getPublicCard`，C25–27 | 路径 `card_id:string`，编码后传输 | `PublicCard`，200；不可见/屏蔽 404 | MC265–267 → PC103；PC 写死 `card_me` 是演示缺口 U01；自己预览也必须是公开投影，他人只看允许字段 |
| 27 | `GET /buddies` / `listBuddies`，B6–17 | 可选 query：`mode:'recommend'\|'same'`、`type_code:string`、`limit:number`；封装只传 truthy 值 | `{items:BuddySummary[]}`，200，空为 `items:[]`；非法 query 422 | D90–125 实发 `mode`、本人类型或示例 INFP、`limit:20`；过滤本人、双向屏蔽、不可见者；排序/默认/上限 U04 |
| 28 | `GET /buddies/blocked` / `listBlockedBuddies`，B37–39 | 无 | `{items:BuddySummary[]}`，200；无屏蔽为空数组 | A173–176 计数、269–279 解除 action sheet；只含本人发起的屏蔽关系，例外投影见下文，不泄露对方反向屏蔽关系 |
| 29 | `GET /buddies/{id}` / `getBuddy`，B20–22 | 路径 `id:string` | `BuddyDetail`，200；不可见/屏蔽 404 | D148–149/W96–97 → BD100–130；F5 也读取；与列表/公开名片使用同一可见性守卫，拿旧 ID 直访不能绕过 |
| 30 | `POST /buddies/{id}/block` / `blockBuddy`，B25–29 | 路径 ID，无 body | `{blocked:boolean}`，P 成功 200、`blocked:true`；可重试 | BD211–225；只新增本人→目标屏蔽，不替他人操作；即时收紧双向展示、交换与后续授权读取 |
| 31 | `DELETE /buddies/{id}/block` / `unblockBuddy`，B32–34 | 路径 ID，无 body | `void`，P 成功/重复解除 204 | A267–285；只移除本人→目标关系，不能移除反向屏蔽；不自动复活已撤回授权 |
| 32 | `GET /card-exchanges` / `listCardExchanges`，X6–8 | 无 body/query（不能虚构 buddy_id/cursor 过滤已存在） | `{items:CardExchange[]}`，200 | MC227–229 计已接受；D101–104 计待办；BD125–130 找首个 buddy_id；W58–66 列表；只当事双方、过滤屏蔽/不可见对方；方向缺口 U07、排序 U09 |
| 33 | `POST /card-exchanges` / `createCardExchange`，X11–13 | `{buddy_id:string}`；不收发起者 ID、状态或联系方式 | `CardExchange`，P 首次 201；同向重试 200 同记录、反向已待办 409，均待 U09 | BD144–155；不能自己或被屏蔽/不可见对象；一对主体并发最多一条有效待办，不自动接受反向申请 |
| 34 | `POST /card-exchanges/{id}/respond` / `respondCardExchange`，X16–21 | 路径交换 ID；`{action:'accept'\|'decline'}` | `CardExchange`，P 200；第三人 404、发起人 409、终态竞争 409、非法 action 422 | BD158–168；仅服务端确定的接收方可回应；PR20“模拟对方”不能作为真实授权 |
| 35 | `DELETE /card-exchanges/{id}` / `revokeCardExchange`，X24–28 | 路径交换 ID，无 body | `void`，P 成功/已撤回的本人重试 204；第三人 404，非发起方/不允许状态 409 | BD171–188，pending 与 accepted 均显示撤销；R 仅有权发起方，accepted 是否可撤回仍是 U08 |

R：注册顺序明确为 `GET cards/me` 在 `GET cards/:card_id` 前，`GET buddies/blocked` 在 `GET buddies/:id` 前；不能只依赖方法名或字符串注释。`PUT cards/me` 也保持本人专用入口。验收要实际调用 `/cards/me` 与 `/buddies/blocked`，不能把 `me`、`blocked` 当动态 ID 后“碰巧 404”。

## 响应字段与写入边界

以下是 E 的 TypeScript 形状，不新增已确认字段。`?` 表示 PR20 可选；未标 `?` 的数组应有数组值，页面直接读取 `.length`/迭代。时间字符串的格式由 P 建议 ISO 8601，时区和精度尚待 U12。

| 类型 | PR20 明示的完整字段（T 行号） | 具体消费 / 来源未定项 |
| --- | --- | --- |
| `CardStyle` | `'illustration'\|'editorial'\|'game'`（1） | MC/PC `styleAsset(card.style)`；默认 style 未约定，不等于已购买/已生成 |
| `CardVisibility` | `name:boolean`、`interests:boolean`、`declaration:boolean`、`manual:boolean`（3–8） | MC213–217 四开关，A147–151 只显示其中三项；无 type/整体公开/discoverable 开关 |
| `CardManual` | `recharge:string`、`communication:string`、`care:string`（10–14） | PC55–67；PR20 `constants/manual.ts:14–29` 有按类型生成模板，是否作为服务端来源待 U06 |
| `MyCard` | `id:string`、`nickname:string`、`type_code:string`、`type_name:string`、`declaration:string`、`interests:string[]`、`style:CardStyle`、`visibility:CardVisibility`、`has_visual_set:boolean`、`latest_result_id?:string`、`updated_at:string`（16–28） | MC/A/D/BD 多处使用；`latest_result_id` MC269–278 用于分享，A175/198 用于本人结果；id/type_name/has_visual_set/latest_result_id/updated_at 不在 update body，visibility 可局部写 |
| `PublicCard` | `id:string`、`nickname:string`、`type_code:string`、`type_name:string`、`declaration:string`、`interests:string[]`、`style:CardStyle`、`manual?:CardManual`（30–39） | PC34–67、92–93；不含 visibility、latest_result_id、has_visual_set、updated_at，也不含联系方式 |
| `ExchangeStatus` | `'none'\|'pending'\|'accepted'\|'declined'\|'revoked'`（41） | BD108、D142–145；`none` 是无交换时的搭子视图状态，不是 `CardExchange.status` 合法值 |
| `BuddySummary` | `id:string`、`nickname:string`、`type_code:string`、`type_name:string`、`avatar_text:string`、`avatar_color:string`、`tagline:string`、`interests:string[]`、`same_type:boolean`、`shared_interests:string[]`、`exchange_status:ExchangeStatus`、`is_demo:boolean`（43–56） | D53–65、134–145；A 用 id/nickname；avatar、tagline、same_type/共同兴趣的推导未约定，不可从私密字段推导泄露；真实记录不可冒充虚构示例 |
| `BuddyDetail` | 全部 `BuddySummary` + `compatibility_hint:string`（58–60） | BD16–35、110–115；相处提示算法/文案待 U06，不承诺匹配准确度 |
| `CardExchange` | `id:string`、`buddy_id:string`、`buddy:BuddySummary`、`status:'pending'\|'accepted'\|'declined'\|'revoked'`、`created_at:string`、`responded_at?:string`、`simulated:boolean`（62–70） | W30–34、BD130，MC/D 计数；`buddy_id`/`buddy` 必须按当前观察者指向对方；**没有收发方向或 actor 字段**，不能从 buddy_id 推出谁可回应 |

E：`UpdateCardBody` 只允许 12 路由表 #25 的六类字段，所有顶层属性可选；没有 `manual`、`type_name`、`id`、`has_visual_set`、`latest_result_id`、`updated_at`、`owner_id`、`wechat/qq/phone`。P：服务端显式白名单并拒绝额外字段 422；限长、空串/null、去重、trim、大小写转换及未知 visibility 键规则均待 U05，不从演示缓存臆测。`type_code` 是 E 可写，不等于“可覆盖历史结果”的授权（U03）。

E→必要兼容约束：MC246/A245 每次只提交一个 visibility 键，所以 `PUT /cards/me` 必须支持这类局部输入且保留其他字段；不能按全量替换把未传设置重置。P：在事务中按字段/visibility 子键合并，更新本人可编辑名片，返回完整 MyCard；不同开关并发不得互相丢写。同一字段并发次序/版本冲突机制尚未确定（U05）。

E：H222–241 还支持主动选用任意一条本人历史类型，提交 `{type_code: result.type_code, declaration: DECLARATIONS[result.type_code]}`，**没有 result_id**，并明确不会公开历史/阶段/近期状态/答案。这与 MC71 的“名片依据：最近一次结果”文案存在语义张力；不能简单在每次 GET 用最新结果覆盖掉显式更新，也不能仅凭 type_code 反推出唯一历史 result_id。该决策列 U03；昵称/兴趣等字段虽在封装中可写，本次跨页面检索未发现真实页面调用它们的保存入口，不应声称已具备完整编辑接线。

## 本人、他人公开投影与双向屏蔽

R：`/cards/me` 是私密本人编辑视图；公开页、搭子列表/详情、交换内嵌 buddy 只使用当前允许公开的投影。交换接受不扩大字段可见范围，不附带任意联系方式、历史结果、答题、阶段状态、凭证或 owner 标识。不能直接序列化 Prisma 记录再让页面隐藏。

| 场景 | 必须守住的边界（R） | 与现有类型兼容的建议（P，U02/U06/U10 待审） |
| --- | --- | --- |
| 本人 `/cards/me` | 自己可取编辑值及四个 visibility 布尔；不是通用私有资料/联系方式接口 | 新号返回安全的无类型态，具体字段默认未定；不要伪造 INFP、昵称、付费或生成状态 |
| 对方关闭 `visibility.name` | 名字在各公开投影和派生头像中均不可泄露 | 公共 nickname 用空串，PC92 会展示“匿名搭子”；或服务端直接给匿名文案，二者待定；avatar_text 不得保留真昵称首字 |
| 关闭 `interests` | PublicCard/Buddy/交换内嵌 buddy 不返回原兴趣；shared_interests 也不能泄露隐藏兴趣 | `interests:[]`、`shared_interests:[]`，不保留历史内嵌副本；推荐内部是否仍可使用隐藏兴趣 U04/U06 |
| 关闭 `declaration` | 不返回原自我介绍，也不能借 tagline 绕过 | `declaration:""`，安全 tagline 来源待定；PC93 的本机 currentQuote 回退必须单独处理 |
| 关闭 `manual` | 不返回相处说明字段 | PublicCard 省略 `manual`，与可选类型/PC55 匹配；不要仅发送原值让客户端隐藏 |
| 整张卡私密/未满足公开条件 | 推荐、动态详情及交换创建共享不可见判定，不可枚举 | **当前无整体公开字段/同意动作，不能把四个 false 擅自解释为整卡私密，也不能默认所有游客可发现**（U02） |
| 任一方向已屏蔽 | 列表双向移除，旧 card/buddy ID 直访和新交换/回应不能绕过，旧交换不泄露对方资料 | 公共详情/交换操作同形 404；交换列表过滤；既有关系如何落状态 U10 |
| 本人的屏蔽管理 | `/buddies/blocked` 只列自己主动屏蔽的目标，使本人能解除；不能列“谁屏蔽了我” | 例外投影只保留管理必要 ID 与安全展示值，昵称仍受目标可见性限制；T 要求完整 BuddySummary，因此其余字段的安全缺省/专用新类型需审核，不能为兼容返原资料 |
| 解除本人屏蔽 | 不删除对方反向关系，不复活撤回的交换/联系方式授权 | 若对方未反向屏蔽且本来可见，再允许新读取；已撤回关系仍撤回；解除与交换状态的具体恢复政策 U10 |

P：由同一个业务判定入口统一检查 observer/target 身份、当前公开条件与 `block(A,B) OR block(B,A)`；过滤在 limit/排序取样前执行，避免列表空洞或数量泄露。交换读与写重新检查关系，不用缓存/创建时快照替代。屏蔽重试、解除必须能按本人已知 ID 执行，不能因为普通详情已不可见就把解除入口锁死。

E：PC91 用本机 `studio.hasCard`，MC201 用 API 或本机状态；PC93 在 declaration 为空时调用 `currentQuote`，而 `store/studio.ts` 的该函数优先返回本机 `customQuote`/`quote`。因此服务端正确隐藏也不代表页面已通过隐私验收；下一轮 Web 必须核对展示不被旧缓存补回，不把观看者文案当成对方文案。此准备不改 UI 或接线。

## 交换角色、状态转移与并发

R：持久化/权限至少能区分发起方与接收方；actor 由服务端当前游客决定。A 发给 B 后，A 的 `buddy_id`/`buddy` 为 B，B 看到的为 A；C 的列表不能包含这条申请，C 猜到 ID 不能回应/撤回。B 才能 accept/decline，A 不能用 PR20“模拟对方同意”越权。

E/R 缺口：API-REVIEW #32 要区分方向，但 T62–70 没有方向。**P（U07）**：最小候选扩展 `direction:'incoming'|'outgoing'`，由服务端按 observer 计算；它尚未属于 PR20 响应形状，不能宣称已约定。也可由审核者选择其他角色表达，但必须给 Web 足够信息显示接收/撤回入口，不能要求 Web 信任传入的 sender ID。现有 BD48–57 同时显示“模拟对方”与取消按钮，必须由后续 Web Writer 接成两个独立身份的真实流程。

| 原状态 | 动作 / 服务端角色 | 结果 | 来源与未定点 |
| --- | --- | --- | --- |
| 无有效申请（搭子视图 `none`） | create / 发起人，目标非自己且双方可见、无双向屏蔽 | `pending` | E 有请求/枚举；R 发起与并发约束；首建 201 为 P |
| `pending` | respond accept / 接收人 | `accepted` | R；P 200，并写 responded_at；不产生任何 contact grant |
| `pending` | respond decline / 接收人 | `declined` | R；P 200，并写 responded_at |
| `pending` | revoke / 有权发起人 | `revoked` | R；P 204；撤回时间是否另存字段未约定，不能硬塞 responded_at |
| `accepted` | revoke / 发起人 | P 建议 `revoked` | E 的 BD41–44 显示此入口，但卡只说“按约定状态转移”；U08 必须确认。接收方主动撤销并未获 R 授权 |
| `accepted`/`declined`/`revoked` | respond / 任意人 | 不变 | R 竞争只能产生一个有效结果；P 对已鉴权当事人返回 409；同 action 幂等返回 200 还是 409 待 U09 |
| `revoked` | revoke / 原发起人重试 | 不变 | P 204；是否与不存在 404 区分、终态保留规则 U09/U12 |
| `declined`/`revoked` | 再次 create | P 建议新申请 ID 的 `pending` | E BD62–66 允许拒绝后重试，R 未约定冷却/历史；U09 确认后才实现；旧 ID 永不复活 |
| 任意状态 | 第三人、伪造角色、自己申请或被屏蔽后操作 | 拒绝，无状态改变 | R；P 第三人/屏蔽 404，自己申请 422，已鉴权角色冲突 409 |

并发实现建议（P，仅文档，不写 schema）：

1. 将双方**内部主体 ID**规范化为无序 pair，参与者有序字段另外保留；不能只给 `(sender,recipient)` 加唯一约束而遗漏反向 B→A。
2. 数据库约束保证每 pair 最多一个 `pending`；事务/同 pair 锁串行化 create、respond、revoke 与 block 的检查和写入。具体用部分唯一索引、pair 行还是别的机制由后续单一后端 owner 决定。仅靠进程内锁、先查询后插入或客户端 busy 不成立。
3. 同向重复 create 建议返回已有 pending（200，同 ID）；反向已有 pending 建议 409，不能自动 accepted，不能改变原发起方；竞争最终只落一条 pending。唯一冲突须转为确定业务响应，不能泄露原始 SQL/500。accepted 后重复申请策略 U09。
4. 状态更新以 `id + expected pending + server recipient/sender` 作条件；accept/decline/revoke 竞争只一个生效。两步可串行的 accepted→revoked 若经 U08 批准，应与“pending 的一次竞争结果”区分记录。
5. 屏蔽先提交后开始的新展示/交换操作必须失败；与其并发的动作按同 pair 串行次序判定。已屏蔽时不返回旧 embedded buddy。是否将已有 pending/accepted 写为 revoked 是 U10，不得擅自用自动恢复制造授权。
6. 列表至少有稳定顺序；BD130 用 `.find(buddy_id)`，F5 也如此，必须让它拿到当前有效关系。P 建议同一对当前记录优先，再按 created_at/ID 稳定排序；是否保留全部历史、如何算 accepted 数量和 `BuddySummary.exchange_status` 待 U09。不得让旧 accepted 覆盖新 revoked。

## 共享模型与后续卡依赖（仅建议清单）

当前基线源码：[schema.prisma](../../aij-foundation/apps/api/prisma/schema.prisma) 的 `MbtiGuest` 1779–1786、`MbtiResult` 1818–1833；[mbti.http.ts](../../aij-foundation/apps/api/src/mbti/mbti.http.ts) 的 guard；[mbti.service.ts](../../aij-foundation/apps/api/src/mbti/mbti.service.ts) 的结果读写/删除；[mbti.types.ts](../../aij-foundation/apps/api/src/mbti/mbti.types.ts) 的 16 型元数据。以下均只静态读取，未连接数据库。

| 现有事实 | F4 / F5 / F6 可共享依赖与限制 |
| --- | --- |
| `MbtiGuest`: id、tokenHash(unique)、expiresAt、createdAt、sessions/results | 复用 guard 给出的 guest.id 作内部 owner，不另建认证、不暴露 tokenHash/凭证。没有昵称、名片、block、contacts、radar 或位置字段。游客失效后的关系保留/清理为 U11 |
| `MbtiResult`: id、ownerId、sessionId?(unique)、source、typeCode、bankVersion、dimensionCounts?、lifeStage?、recentStatus?、submittedAt | F2 quiz 与 self_select 都存在；可作为本人类型候选来源，但“最近一次”优先级、手工 card.type_code 与结果的关系待 U03。阶段、近期状态、分数、题目/会话不进入公开名片 |
| 结果列表按 submittedAt desc / id desc；本人结果可真实删除 | P 可复用该稳定排序提取候选 latest_result_id，但“删除最近结果后选前一条/清空/保留名片快照”是业务决定 U03；若加 FK 要协调删除动作，不能破坏 F2 delete；不得修改历史结果来配合名片 |
| TYPE_METAS 为 16 个 type_code/name_zh/tagline | 可复用合法类型校验与中文名称来源；`type_name ← name_zh`、tagline 是否使用模板属于 P/U06 的明确转换建议，不是现成契约 |
| `MbtiShareAsset` 是主动分享图片的持久资产 | 不等于“视觉套装已生成”；F3 权益/订单也不等于 `has_visual_set`，不得由本机 studio.hasCard 或付费状态伪造此布尔（U06） |
| 尚无 F4 社交持久模型 | 后续 owner 需评估每 owner 名片唯一、公开 ID 映射、定向 block 唯一、exchange 双参与方/状态/时间、无序 pair 待办唯一与索引；均非已选表名/schema，不在此准备落迁移 |

**F5 依赖已核对**：PR20 `api/contacts.ts:26–59`、`types-social.ts:72–93`、`pages/contact-request/contact-request.vue:157–185`。F5 使用 `buddy_id`、F4 的 `getBuddy`、交换列表首个相同 buddy_id 的 accepted 记录，另走自己渠道、contact-request 与 granted 接口。channels 明示 wechat/qq/phone；接受 F4 仅放开页面申请入口，绝不生成渠道授权或返回原值。R：F5 每次授权读取重验确切请求方/批准渠道/撤回/清除/双向屏蔽；F4 需交稳定身份映射和可复用的实时屏蔽判定。名片撤回是否连带撤销既有独立联系方式授权还未约定（U10），不能宣称已自动处理。

**F5 阻塞对 F4 页面影响**：W62 `Promise.all([listCardExchanges(),listContactRequests()])` 会因 F5 未就绪而把整个名片夹显示失败。后续 Web 可审核将独立状态分开加载并明确联系方式未开放；这是 P，不能给 F5 伪造成功空列表。本准备不实现 F5、不修改页面。BD 的 accepted 后申请入口也应准确提示能力状态。

**F6 依赖已核对**：PR20 `api/radar.ts:5–30`、`pages/radar/radar.vue:84–138`，调用 `getMyCard` 获取 type_code，参与状态 `{enrolled:boolean}`，计数 `{count:number|null}`，query 为 type_code/radius_m。R：默认退出，显式加入/退出；按实际自愿参与、本人类型、粗粒度位置与半径统计，并应用屏蔽；缺数据不可用，低样本隐藏，不返回人员列表/私密类型。E 页面半径 500/1000/3000、文案提“少于 10 人”，不等于 F6 阈值/位置策略已获业务确认。当前 MbtiGuest/Result 无位置/同意数据；F4 不补位置或整站人数假计数。E `refreshCount` 吞错后设 null，将不可用误显示为“人数较少”，F6 必须单独对齐（U11）。

**Writer 边界**：本轮共享 Prisma/迁移/路由由 F3 独占；本准备只交两份文档。下一轮后端从总控指定的已集成最新 dev 核对 F3 最终模型、迁移及注册方式，复用共享 owner，不把这里的 schema 建议直接抢写。未来 test 变更仍须 `MBTI_LOCAL_OWNER_ROOT` 归属保护、`scripts/mbti-local.mjs` 与单后端 owner；本任务未调用这些命令，也未接触 dev55436/test55437 或 4056/5173/4156/4155 服务。

## unknowns / needs_human_review

| ID | 未确认决定 | 可供审核的候选 / 影响 |
| --- | --- | --- |
| U01 | card.id、buddy.id、guest.id 的映射；公开 ID 是否独立；PC 的 `card_me` 是否保留别名 | P：Web 先取 MyCard.id，再调公开投影，去掉硬编码；ID 映射由服务端维护。不能擅自公开内部 guest.id，不能把“me”别名变成私密投影旁路；影响 #26/#29/所有 buddy_id 与 F5 |
| U02 | 新游客名片是否懒创建、完整缺省值；何时可发现/整体私密；公开页是否允许匿名无凭证访问 | R 有本人/他人和隐私约束，E 无整体开关也无默认授权。P：本轮先沿用游客鉴权；无类型空态而非伪造类型；确切初始化、公开条件须审核。不能以“所有 visibility=false”代替整体隐私政策 |
| U03 | type_code 可写与“最近结果”关系、历史页主动选旧类型却不传result_id、自选是否算最近、覆盖优先级、删除回退、latest_result_id 语义 | E 历史页确实发type_code/declaration，不能仅按最新结果静默覆盖或反推来源ID。P：重用合法 16 型及本人结果；不改历史；审核最终来源与删除策略后供 F6 共用 |
| U04 | recommend 算法；same/type_code 是过滤条件还是本人声明；limit 默认/上限/排序；隐藏兴趣是否参与推荐 | E 页面会把缺类型替成 INFP，不能把 query 当真实身份类型。P：显式验证枚举、数字与授权后再过滤；不得输出隐藏兴趣推导结果；不把 E 的20当服务端默认 |
| U05 | 字符/数组限额、trim/null/空值/大小写/去重/未知键；并发同字段覆盖规则 | 必须兼容单个 visibility 子键更新；P 拒绝越权额外字段 422。局部合并不授权任意业务字段；无依据不填长度常量 |
| U06 | nickname 隐藏表示、type_name/manual/avatar/tagline/hint 推导；visual 状态来源；时间字段格式 | P 隐藏用空串/空数组/省略可选 manual；真实数据 `is_demo:false`、`simulated:false`（只能如实，不能伪造模拟数据）；具体缺省及转换待审，展示不能取私密缓存补回 |
| U07 | #32 的收/发方向和 Web 操作权限表达 | P 新增 observer-relative direction；该字段不是 PR20 已明示。服务端仍以持久角色鉴权，Web 需两身份实测替代模拟对方 |
| U08 | accepted 是否允许发起方撤回；接收方是否可独立撤销已接受关系 | 页面仅提供意图；R 明确仅有权发起方。P 先只支持发起方 pending/accepted→revoked 的候选，accepted 部分待确认；不扩权接收方 |
| U09 | 重复/反向 create、同 action 重放、终态再申请、冷却期、已接受时重复申请、列表历史/当前状态/排序 | P 同向 pending 200原 ID，反向409，新建201，终态竞争409，原发起人重复撤回204；拒绝/撤回后新ID，不复活旧记录；均待审核，唯一 pending 与单有效转换的 R 不变 |
| U10 | 屏蔽时已有 pending/accepted 的存储状态；屏蔽列表例外字段；解封后交换和独立 contact 授权恢复政策 | R 即时收紧双向读取/交换、解除不复活撤回授权。P 先隐藏旧关系且即时重验；是否自动 revoked、F4 revoke 是否使 F5 grant 失效须明确，不能靠返回旧快照 |
| U11 | 失效游客/删除账户的关系留存；F6 类型更新、位置来源、授权、计数阈值/半径与不可用表示 | 此准备只列依赖；不实现 F5/F6，不擅设位置/留存/统计策略；F6 可在位置外部阻塞时按其卡先做#44/45 |
| U12 | F4 精确成功/拒绝状态码、错误 code、ID格式、时间时区/精度、无记录与权限拒绝反馈 | PR20 仅2xx/非2xx；本表 HTTP 口径都是 P。沿用现有401与裸业务对象；审核后把唯一选择写入后端候选并实测，不宣称此文档发布 |

## A/B/C 真实验收矩阵（供下一轮执行，当前全部未执行）

这是一份**未来真实 HTTP/H5 验收计划**，不是 Mock、缓存或 SQL 结果。本轮实际成功数/拒绝数均为“未发送、无状态码”；不得将下表的 P 期望值抄成通过。

前置：总控批准的候选 test API；不替换稳定 4056/5173。A/B/C 三个新独立浏览器或独立 token，通过真实 `POST /auth/guest` 建立；只用专用合成昵称/字段 canary。可用 F2 真实 `POST /results` 建 A=ESTJ、B=INFP、C=ESTJ 的自选结果，再按 U03 最终方案准备名片。token 只保存在本机权限受限状态，不写证据。`VITE_USE_MOCK=false`，H5 API_BASE 与被测提交一致；不能用 PR20 的 INFP 回退代表真实类型。

下表状态码沿用本文 P；U 项审核改变时先更新执行候选期望，再留实际状态。公共可见字段允许 C 读取，**C 被拒绝的是私密字段/本人视图/非当事交换和授权**，不能把“公共卡必须对第三人404”当隐私要求。

| 用例 / 覆盖 | 真实请求顺序（主体明确） | 期望成功、拒绝与隐私断言（未执行） |
| --- | --- | --- |
| M24 #24 | A/B/C 分别 GET cards/me；无效/缺token再GET | 200 本人各自 MyCard；新号正确缺省态，A无法指定owner读B；缺/失效401；身份/结果不串号 |
| M25 #25 | A PUT 一个 visibility 键；再GET；并发不同键；从本人旧历史显式更新type_code/declaration；尝试注入owner/type_name/contacts | 200 完整自身响应且其他值不丢；主动更新与U03最终决定一致，刷新不被静默覆盖；B不变；额外字段按最终规则拒绝/不落库；非法值422；不改历史结果 |
| M26 #26 | A取自身真实card.id；A/B/C分别GET该公开ID；依次关闭四字段后重取；不可见/未知ID直取 | 200只含公开投影；C可见公开部分但看不到隐藏 canary/私有结果ID/联系方式；私密或屏蔽404；MyCard字段不混入；实际 /cards/me 命中静态路由 |
| M27 #27 | A/B/C GET buddies 两模式，真实类型query与limit；另做无推荐集合 | 200，排除本人、不可见者、双向屏蔽；空items而非假推荐；隐藏兴趣不出现在shared_interests/tagline/avatar；非法query422 |
| M28 #28 | A屏蔽B后，A/B/C分别GET buddies/blocked | A200可管理自己关系；B/C不获知A屏蔽谁，不返回反向关系列表；目标原私密字段无canary；实际命中blocked静态路由 |
| M29 #29 | 未屏蔽时A与C读B buddy.id；B隐藏字段后重读；屏蔽后双方持旧ID直取 | 200仅公共BuddyDetail；C无本人/私密数据；隐藏字段及派生值同步收紧；屏蔽双方404；错误态不从缓存补资料 |
| M30 #30 | A POST B/block，重复；B用旧card/buddy ID直访A，并尝试交换A；A直访B | A200 blocked=true且重复不多写；双向动态访问/交换拒绝，无旧资料；请求人字段注入不改变主体；列表和旧名片夹同步隐藏 |
| M31 #31 | A DELETE B/block，重复；若B也屏蔽A，先只解除A；再由B解除；随后重测列表/详情/交换 | 原发起者204可重试；单向解除仍因反向屏蔽拒绝；双方解除且允许公开后读取成功；旧revoked不复活，必要时新申请 |
| M32 #32 | A→B申请前后，A/B/C GET card-exchanges；接受/拒绝/撤回后重复列表 | A/B200且各自buddy为对方、方向正确，C空/无该条；当前状态排序与summary一致；无联系方式；屏蔽后双方列表隐藏对方 |
| M33 #33 | A→B正常POST；A→A；另批无pending的A/B同时同向/反向POST，重试；C不能指定sender=A | 首建201；同向重试200同ID/反向409为P；每pair只一待办，角色不翻转、不自动接受；自己422、屏蔽/不可见404；C请求至多以C本人创建且不可冒名 |
| M34 #34 | A发给B后，A/C分别respond；B accept；另次B decline；并发B accept/decline与A revoke | B正常200；A409、C404；一条pending只一次有效转换，无后写覆盖；失效token401；accepted前后都不返联系方式；重复/终态按审核状态码 |
| M35 #35 | A发给B后A DELETE；A重放；B/C删除同ID；若U08批准，再测accepted后A撤回 | A204并不可再当有效关系；B409、C404；重放按审核值；旧ID不能回应/复活；接受后撤回与F5联动仅按已审核决定 |
| P1 跨路由可见性 | A隐藏昵称/兴趣/介绍/manual，以B/C读#26/27/29/32；变更后立即再读；对比无效ID响应 | 响应白名单与隐藏canary一致，内嵌buddy/派生字段无旁路；公共类型是否可见遵循U02；记录404同形，无owner/token/历史字段 |
| P2 交换≠联系方式 | A/B互换前后遍历所有F4响应；C猜exchange ID；F5就绪时A按单独渠道申请/接受/读取，再撤回/清除/屏蔽 | 12路由无原渠道值；仅F4 accepted不授权任何granted读取；C始终拒绝。F5未就绪则只记该联动未验，不能以404占位算授权校验通过 |
| P3 并发屏蔽与恢复 | 无pending时并发block/create；另轮已有pending时并发block/respond，按提交次序复查；再重启候选API并用原token读关系 | 屏蔽先于新操作时拒绝，屏蔽生效后无资料/授权可读；重启仍保持原状态/隔离，解除不复活已撤回项；不能以SQL记录代替HTTP读回 |
| P4 H5真实入口 | 三浏览器走我的名片→亮名片、发现→详情→申请、接收方回应、名片夹、账号屏蔽管理；刷新再读 | Network对应12项真实状态/业务体，去除card_me/模拟对方接线依赖；F5不可用不伪造成功；隐藏字段不被studio缓存补回。布局不属本准备范围 |

执行证据每项记录：UTC/本地时间、候选 SHA、完整 API 基址、编号、主体代号、HTTP method/path（只用合成资源ID）、脱敏请求/响应白名单、实际 status、预期/实际差异、H5入口及是否刷新/重启验证。并发用例记录所有请求返回和最终 HTTP 列表/详情，内部 SQL 至多辅助计数，不能代替 API 成功证据。缺业务决定的用例标 `needs_human_review / 未验`；单项外部阻塞只阻塞相关联动，不阻断其余就绪 F4 项。
