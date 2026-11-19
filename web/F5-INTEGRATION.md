# F5 Web 联系方式与单向授权候选

状态：`candidate / needs_human_review`，本说明不发布正式业务契约。Run `run_594d408d15de`；Task `task_c62021f68ae6`；Dispatch `ctx_e8fa22a93bf0`；2026-11-09。

## 基线与范围

- 工作树 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f5-web`；分支 `weiyang86/mbti-web-api-f5-web`；实际基线 `3580e0fd902a57b5870c7e376b5d98fe916a0e3c`，已集成 F1–F4 与 F4 发起方公开性修复。
- Web 实现代码 SHA `ea12901f997f721b6b4966bb635fb3ed54920c5c`。后续本说明提交只补实际证据；实测后端候选 `a8d458e11bdc9cdf6b487b84bc5b2fbe605cc36a`（业务实现 `05687a5`，总控转发），两次协调重启后均用原身份复验。
- 固定只读参考 PR20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f` 的 contacts.ts、types-social 及 contacts/contact-request/buddies/detail/exchanges 消费。保留三渠道字段、八项路径和验证格式，替换其本机 Mock、模拟对方操作与相互授权推断，没有整体合入 PR20。
- 已读根/web/aij-foundation AGENTS、输入 RUNBOOK/API-REVIEW/cards/F5、F4 开发交付和 `web/F4-INTEGRATION.md`；已逐字段核对后端树 `docs/integration/MBTI-F5-runtime-candidate.openapi.yaml` 和 examples（`f5-candidate-1`）。路径、裸对象、direction、buddy_id、状态/角色、全量 PUT、固定渠道顺序、重复渠道 422 及成功码均一致。
- 范围仅 `web/`。没有修改后端、Prisma、正式 docs/api、UIhtml、F1 题库恢复、F3 交易意图或 F4 四 visibility 独立局部 PUT/私密发起守卫；没有操作开发 4056/5173、数据库或运营初始化。
- H5 `http://127.0.0.1:4155/#/`；API `http://127.0.0.1:4156/api/v1`；`VITE_USE_MOCK=false`。原 F4 的 4155 由总控关闭，本树构建后再次扫描确认 4155 无监听才启动。

## 页面与隐私处理

沿用共享基础样式，新增本人渠道、请求列表/按搭子申请和当前授权读取三个页面，首页、本人名片、搭子详情与名片夹有入口。八项复用现有 guest/request/error，不增加身份系统、Mock 分支、模拟同意、成功缓存或授权 localStorage。

本人整份 PUT，留空删除；实际改值/清除使旧请求失效。请求不读取自己的私密渠道来推断对方渠道；使用者明确选择非空集合，只请求对方渠道。incoming pending 本人可批准完整集合或拒绝，不假装支持部分批准；双方 pending/accepted 可撤回，declined 无撤回控件。incoming accepted 不展示对方值，也不声称自动互授。仅 outgoing 有实时读取入口，未批准、第三人或已失效返回明确不可读。名片交换成功仅确认基础关系。

本人输入与 granted 值只存在当前页内存，读取/刷新先清空，失败清空，onHide/onUnload 清空并使慢响应失效，回页重取服务端。错误提示不插入服务端私密响应或原输入。没有复制按钮、持久化原值或把原值放 URL/console；撤回提示明确不能收回已经复制或截图的内容。列表 accepted 只作候选状态，真正读取以 granted 响应为准。

## 检查命令

| 实际命令 | 退出码/结果 |
| --- | --- |
| `cd web && npm ci` | 0；本树独立 969 packages，未链接其他树依赖；锁文件不变；npm 报告现有 75 项漏洞，未升级依赖 |
| `npm run test:api` | 0，30/30；原 25 项保持，新增八路径共享身份/私密值不落存储、失败不回退或重放、按钮角色、离页/刷新慢响应失效、错误脱敏与候选格式 |
| `npm run type-check` | 0 |
| `VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run build:h5` | 0；只有既有 UniApp/Sass deprecation 提示 |
| `git diff --cached --check` | 0（代码提交前；最终文档提交前再次核对） |
| `python3 /tmp/mbti-f5-ui.py` | 0，新三 profile、名片、主动公开 |
| `python3 /tmp/mbti-f5-flows.py` / `/tmp/mbti-f5-stage1-resume.py` | 各 1；辅助导航未触发重读/onLoad，见下方，不计未执行项通过 |
| `python3 /tmp/mbti-f5-after-restart.py` | 0；namespace 切换后原身份/同值/旧状态只读复验 |
| `python3 /tmp/mbti-f5-stage2.py` | 0；从已完成的 A 撤回之后接续，完成其余真实控件操作 |
| `python3 /tmp/mbti-f5-final-read.py` | 1；核心持久化和隐私扫描已通过，辅助 fetch 从存储包装取错凭证导致响应头断言失败 |
| `python3 /tmp/mbti-f5-final-read-resume.py` | 0；从失败处接续，以共享 client 取现有凭证，三读取 200/no-store、身份未变、F1/F3 回归完成 |

Git 访问共享对象库时反复提示既有 `._pack-*.idx` non-monotonic index，但上述 diff/提交均退出 0；本 Worker 未改共享 Git 对象库。

## 真实 GUI 与额外 HTTP

本轮新建三隔离 profile，未操作旧 F1–F4 profile。A/B 均通过页面保存三个合成渠道，C 本人为空；原值不进入本说明、截图或 Network 回执。

| 主体 | profile | page | 公开 card ID |
| --- | --- | --- | --- |
| A | `1e578a7b-f181-4c5c-92e0-19cbdd874d19` | `800ea49e-ea8c-4b5b-abf0-c9d6376db5fb` | `card_b0gGff1rj_51mK4LNEVAlvzfwktpST7R` |
| B | `f0c4cca0-36e9-4f16-ae3b-f58b6a63ca3b` | `eeb79ba3-c7df-470e-babf-eabb69f2e672` | `card_yt6ckIVc0B5XtJuteiKRL1AasJAny_iR` |
| C | `226708ee-cf39-467d-8e82-f87d779029a1` | `bb6b249b-f3e1-49c4-ad59-d672617f64d3` | `card_3j9IY2UJXVIhj0eqb4J5xR-ncwCH1g1Y` |

A=ESTJ、B=INFP、C=ESTJ，三个凭证与卡各自不同，主动公开通过真实名片控件完成。A 真实发起 F4 交换、B 真实接受，基础交换 `exchange_hNap0_Z8FVWui3BWvVlx3ronzFvCw0lI`；此时联系请求列表仍空。第一条联系申请 `contact_J5N3bU26N5KBG27xX-15Y9Vp_oTpCumT` 仅微信；批准前 A 不可读，B 本人批准后 A 页面仅微信，C 和接收方 B 直访均明确不可读。A 在授权页撤回并立即清空，重新读取不可读。

额外 HTTP 通过同 profile 原 client，单独记为 HTTP：同向相同 pending 重试同 ID、不同集合 409、发送方冒充接收方回应 409、重复渠道 422、本人 PUT 未知字段 422；缺凭证 fetch 401 且 no-store。这些不冒充 GUI 错误页面验收。

辅助脚本曾因同 URL/同页面 query 导航不触发 onLoad，等待旧页面状态失败；已改为显式重新加载、点击当前可见控件并按需刷新，已落库的保存/接受/撤回未重放。最后只读阶段的辅助 fetch 起初直接读取 UniApp localStorage 包装，缺少实际凭证而真实返回 401/no-store；改用共享 `ensureGuestSession()` 获取原凭证后，三读取均 200/no-store，凭证未替换。失败不作为业务成功证据，失败输出只有步骤/错误类别，不含私密值。

### 八项实际 Network 与可见消费

下表省略 API 基址，`R` 为本轮真实请求 ID、`B` 为上列公开 card ID。成功主路径均为真实 H5 输入/按钮；额外 HTTP 单列，不混称 GUI。Network 仅保存方法、URL、状态和时间。

| # | 方法/路径与实际状态 | GUI 消费与拒绝证据 |
| --- | --- | --- |
| 36 | `GET /contacts/me` 200；无凭证额外 HTTP 401 | A/B 本人表单三渠道、C 空；刷新及两次 API 重启同值；401 不称错误页已验 |
| 37 | `PUT /contacts/me` 200；额外 HTTP 未知 owner 字段 422 | A/B 实际输入并保存整份表单，B 清除后重新输入保存；422 是同 profile client HTTP |
| 38 | `DELETE /contacts/me` 204 | B 本人确认清除，表单和服务端为空；A 重新读取旧 grant 404、旧值清空；重填不恢复 |
| 39 | `GET /contact-requests` / `?buddy_id=B` 200 | 本人列表及详情入口过滤；direction 正确、buddy_id 总为对方公开卡；C 列表空；无原渠道值 |
| 40 | `POST /contact-requests` 201；同 pending 同集合额外 HTTP 200 同 ID；不同集合/accepted 重复 409；重复渠道 422 | A 明确仅选微信并提交；B 反向仅选手机仍需另行批准，不自动互授；409/422 为额外 HTTP |
| 41 | `POST /contact-requests/R/respond` 200 accept/decline；A 冒充接收方额外 HTTP 409 | B 在收到列表本人批准或拒绝；A 也实际拒绝反向申请；没有模拟对方/部分批准 |
| 42 | `DELETE /contact-requests/R` 204；declined 额外 HTTP 409 | A/B 均实际撤回 pending 和 accepted；授权页 A 撤回立即清空，B 撤回后 A 实时重读清空；declined 无控件 |
| 43 | `GET /contact-requests/R/granted` 200/404 | A 批准前 404，批准后仅微信；B 接收方/C 第三人 404；拒绝/双方撤回/屏蔽解除/清除重填/退出公开恢复/基础交换撤回及重建后旧 ID 均 404；页面不保留旧值 |

三项额外读取 `contacts/me`、`contact-requests`、有效 granted 实际均 200 且 `Cache-Control: no-store`；缺凭证读取 401 也为 no-store。全部八项 no-store 是候选约定，Web 未单独读取所有写操作的响应头，后端专属 HTTP 不冒充本 Web 验收。

### 失效、方向与隐私扫描

后续真实 GUI 在 UTC `05:31:09–05:32:00` 完成 B 拒绝、双方 pending/accepted 撤回、B 屏蔽 A/解除、清除/重填、关闭公开/恢复、A 撤回基础交换/重新建立。每次失效后均实际重新读取旧 ID 为 404，并确认授权 DOM 为空；不会只靠列表状态或本机缓存演示。B 清除后新填值，旧授权仍不可读。最终反向申请 `contact_BuIePs-dGofWWERjXOuW4iA1j1eZvUPV` 由 A 本人拒绝，不影响正向有效微信授权。

全部 F4 公开 card、推荐搭子、详情、交换内嵌投影及 F5 请求列表经三身份扫描无本轮渠道值；公开名片/发现/搭子详情/名片夹 DOM 同样无值，进入这些 F4 页面没有自动请求 contacts/contact-requests。三 profile 的 persistent storage、console 与 Network 日志扫描未检出原测试渠道值。只输出渠道名/布尔，保存的 Network 无 headers/token/响应体；没有保存含原值的截图。读到值后通过真实返回按钮离页，保留 DOM 的私密值节点/本人输入均为空。慢响应离页失效由隔离测试验证。

去敏本机证据 `/tmp/mbti-f5-web-evidence.json`（0600）只保留公开测试 ID、状态、方法/路径、布尔与内部比较摘要，不提交。最终 API Network（含 OPTIONS）A=410、B=210、C=125 条，UTC `05:22:40.770–05:36:38.596`；开始捕获后 `POST /auth/guest` 均为 0，没有静默换号。390×844 首页与桌面不可读授权页面已实看，其他移动页面逐页未验。

## 重启与保留服务

两次重启均先由总控要求暂停，Web 完成已发请求、确认无 in-flight 后才开放窗口；新的 READY 前没有继续 API 验收。第一次 namespace 切换后 UTC `05:30:44–48` 原 A/B 三渠道同值、C 空、凭证/卡不变、原 F4 accepted 保留，第一条 revoked 联系请求仍 404；没有为掩盖丢数据重填或换号。

最终写操作阶段结束于 UTC `05:32:00`，此后无业务写请求。最后同源码 stop/start READY 后，UTC `05:35–05:36:39` 原 A/B/C 的凭证、card ID、公开状态、本人渠道和空屏蔽列表均保留；最终基础交换 `exchange_Yyqelpqm41aGYjAioM3TzuIpJWnMfCp-` 仍 accepted。有效单向请求 `contact_2iE4k6S-IdCbXP06gxC4hDZYL1RrZ6Zy` 仍 outgoing accepted、仅微信，A 真实页面读取成功，B/C 真实页面 404；前九个失效/拒绝请求全部仍不可读，反向 declined 保留。F1 当前题库仍 `qb-v0.4-prototype-1`/12 题；C 本人结果/订单/权益仍空，商品页真实消费服务端价格，没有创建订单或解锁。

最终保留：A/B 本人均有三个合成渠道，C 无渠道；正向微信授权有效、反向已拒绝、旧请求失效、双向屏蔽空，三个页面都回到首页，不显示私密值。原合成渠道保留供总控复验，本 Worker 没有在最终重启后清除或重填。

本树保留 H5 terminal `term_9cb86812-55c3-46dc-9b56-712d22b79fd2`。恢复：

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-f5-web/web
npm ci
VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run dev:h5 -- --host 127.0.0.1 --port 4155 --strictPort
```

4156 启停与数据归后端/总控独占；本 Worker 没有停止未知监听者。完成一次 worker_done 后停止写入，保留 4155/profile。

## 未验与审阅边界

- 微信端、另一物理设备、全移动页面逐页视觉、浏览器真实断网/私密 IO 503 页面、真实 401 client 故障注入不换号：NOT_RUN；401 保号/不重放及错误无本地回退由隔离测试覆盖，真实无凭证 HTTP 401 单列。
- 本轮 GUI 已覆盖清除后重填的版本失效；直接在有效授权期间修改一个非空值、同值幂等保持，以及并发/私密对象 namespace/存储故障/后端日志属于后端专项，本 Web 未把后端 HTTP 结果写成本人 GUI 通过。
- F4 十二路径共享身份和角色原测试保持，本轮真实名片/公开/发现/屏蔽/交换前提及失效链回归；没有重新完整执行 F1/F2 交卷/对比/分享或 F3 下单流程，也没有修改其实现。
- 当前已读状态不实时推送远端撤回：离页清空，回页/主动刷新重新校验，读取失败立即清空。无法收回用户已复制或截图的内容。
- candidate 的格式限制、正式策略、保留期/GC 等仍 needs_human_review，不能视为发布。
