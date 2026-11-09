# F6 Web 本人参与与统计不可用候选

状态：`candidate / needs_human_review`，不发布正式 API 契约。Run `run_594d408d15de`；Task `task_754fd82cfafd`；Dispatch `ctx_3c262267f1d4`；2026-11-09。

## 基线与范围

- 工作树 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f6-web`；分支 `weiyang86/mbti-web-api-f6-web`；实际起始基线 `00d9199748f3c46f9bf21fcc5035280d90e2ac9b`，已含验收 F5 和 F6 准备文档（原准备 `42d0f98` 的集成内容）。
- Web 实现代码 `515b3fb1b4d38aa6729129f2b273fdaa2531b17b`，仅八个 Web 文件。后续本说明提交记录真实联调证据。
- 实测后端源码 `008455bbab20f85f6348cf54a40b7e23512eec90`（总控转发 READY），最终同源码、同 dist、同 test4156 重启后再次 READY。已逐字段读取并核对后端树 `docs/integration/MBTI-F6-runtime-candidate.openapi.yaml` 和 `MBTI-F6-runtime-candidate.examples.json`：三方法/路径、裸对象、严格必填/白名单、boolean、两种原因、16型和三档半径、三种422 code、401/no-store 均与本 Web 一致；`additionalProperties:false` 与客户端严格解析一致。
- 已读根/web/aij-foundation AGENTS、输入 RUNBOOK/API-REVIEW/cards/F6、F5 开发交付、`web/F5-INTEGRATION.md` 和 `docs/integration/MBTI-F6-candidate.md`。固定 PR20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f` 仅核对 radar.ts、types-social 和雷达页面消费，没有整体合入旧 PR。
- 仅修改 `web/`，沿用 social.scss、本人名片与共享 guest/client。没有修改后端、Prisma、正式 docs/api、UIhtml、数据库或运营身份，没有 push/merge/main；4056/5173 不属于本 Worker 的操作范围。
- H5 `http://127.0.0.1:4155/#/` → API `http://127.0.0.1:4156/api/v1`，`VITE_USE_MOCK=false`。总控确认旧 F5 4155 已关闭后启动本树，保留 terminal `term_e7751970-2393-4c73-a6d8-51c1e347092f`。4156 只由后端/总控启停。

## 页面和协议分态

新增首页/发现入口、pages.json 注册和雷达页。参与仅为本人显式选择，不等于位置授权，不更改名片公开状态、四项 visibility 或联系方式授权；私密名片也可参与。类型只来自已集成 `getMyCard()` 的已存本人名片，不从最近结果或示例补全。缺类型禁用加入并引导本人名片；已有参与时允许退出。

当前只接受 `{enrolled:boolean}` 及 `{count:null,status:'unavailable',reason:'not_enrolled'|'location_source_not_configured'}`。缺字段、未知字段/原因、旧式 count:null、数字或 low_sample 均视为响应错误。未参与、缺类型、正在读取、统计暂不可用和 HTTP/协议失败分别呈现；不请求定位、不显示虚构区域/人数/扫描动画或承诺少于10人的规则。三档范围可触发真实请求核查不可用，不代表实际半径聚合。

参与状态由 GET/PUT 响应确认；保存中阻止重复，失败保留最后确认状态，先 GET 核实再允许下一次明确操作，不自动重放未知提交结果的 PUT。load、类型重新读取、范围切换、参与改变和离页使旧统计响应失效；退出成功立即清除旧统计。离页期间 PUT 完成只在回页后 GET 核实，不能用旧写响应恢复页面。没有参与缓存、另造身份层或 Mock 分支。

## 已执行本树检查

| 命令 | 退出码 / 结果 |
| --- | --- |
| `cd web && npm ci` | 0；独立 969 packages，未链接别树依赖；锁文件未改；现有75项依赖漏洞未升级处理 |
| `npm run test:api`（web 内最终执行） | 0，39/39；保留原30项，新增9项 F6 |
| `npm run type-check`（web 内） | 0 |
| `VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run build:h5` | 0；既有 UniApp/Sass deprecation 提示 |
| `git diff --cached --check` / 实现提交 | 0 |

隔离测试覆盖共享游客、三路径和请求字段、旧本机 Mock 无效、严格成功形状、401/404/422/503 明确失败且不换号/重放、缺类型禁用但允许退出、PUT 响应事实、保存锁及未知结果先重读、退出后的慢响应、范围/类型/load/离页失效、回页后的未完成写核实。隔离测试不是实际人数或后端持久化证据。

初次测试退出1：新增测试的局部变量遮蔽 API 基址及跨 VM Promise 未完成就断言；已修正测试等待与变量，最终39项通过。一次修正脚本误在 web 内使用 web 前缀，退出1且未修改文件；随后在正确目录修改。最初在仓根运行 `npm run type-check` 退出1（根无该脚本），随后 web 内退出0。一次 terminal read 使用不支持的 `--max-lines` 退出1，按帮助改用 `--limit` 成功。Git 共享对象库现有 `._pack-*.idx non-monotonic index` 警告持续存在，相关命令实际退出0，未清理共享对象库。

## 实际命令与辅助验收

| 命令 | 退出码 / 实际覆盖 |
| --- | --- |
| `python3 /tmp/mbti-f6-stage1.py` | 1；三首页→雷达默认false/缺类型禁用、A无类型true422/false200、A/B真实保存私密类型已通过；语义文字定位“参与雷达”误中其他文字，没有发 PUT，后续等待超时，不计加入通过 |
| 当前快照控件引用点击 A 加入；`python3 -u /tmp/mbti-f6-stage1-resume.py` | 0；从失败点接续，不重放已完成名片/退出写入；A加入/B仍false，三半径、重读、B加入再退出、三profile刷新保号和隐私不变 |
| `python3 -u /tmp/mbti-f6-extra.py` | 0；同profile额外HTTP拒绝、两种unavailable、no-store/匿名401、发现入口、写结束状态及三方in-flight0 |
| `python3 -u /tmp/mbti-f6-after-restart.py` | 1；原三身份/卡/隐私/参与与A三档范围复验已通过；后续不存在的F5 grant确实404，脚本误断言旧code `CONTACT_REQUEST_NOT_FOUND`，实际为现有`NOT_FOUND`；不是授权可读或业务成功回退 |
| `python3 -u /tmp/mbti-f6-after-restart-resume.py` | 0；只读接续，三身份F1/F3/F4/F5空列表/空渠道及不存在grant404、当前12题题库和服务端两商品通过 |
| `orca screenshot`；`orca set device --name 'iPhone 12' --page A` | 0；本轮三profile截图与390×844仿真，视觉限制见下方 |

最初 `orca find` 缺 `--action` 退出1；按帮助补齐后命令成功，但语义匹配产生上述不触发PUT的超时。后续每次先 snapshot，再用当前 clickable 控件引用点击，Network 确认真正方法和状态；不把“点击命令返回成功”当 API 已调用。

## 三个新隔离主体与实际控件

未操作旧 F1–F5 profile、原渠道或凭证。A/B 主动在本人名片选择类型并点“保存名片资料”，没有开启公开或任何四 visibility。C 保持无类型默认退出，没有参与 PUT。

| 主体 | 新 profile / page | 本轮 card ID | 最终状态 |
| --- | --- | --- | --- |
| A | `660d4aea-892c-46b9-afcb-3225283d7e9c` / `6cc8e711-6d8f-4738-95bf-8da8451f815d` | `card_pOFHaoWpg-AbSBv-XcAyfAcrbY0H1QOE` | ESTJ，真实加入true |
| B | `66dfd922-4757-41df-b3f2-c656764f4c49` / `272bee9c-2b77-48b7-82f2-45b551ff4fca` | `card_avjKyERpy-qyKZZYxl7Do02zm4b81uFS` | ENFP，真实加入true后退出false |
| C | `7f775d12-3cf1-46f8-a7bb-284e3df0f279` / `9f37e9e9-157f-44bd-9c69-eba7de5763c5` | `card_Uh06t79nk--GBL15SEvNY_j5BY4ikmj6` | 未设类型，默认false |

三者 `discoverable=false`，`name/interests/declaration/manual=false`，与各自初始值一致。A/B 类型只改变本人主动保存的名片字段，历史结果仍为空。三个游客凭证各自不同，以凭证摘要仅在本机比较刷新/重启前后是否同一，正文不含凭证。

| # / 方法路径（省略/api/v1） | 真实成功 / 拒绝 | 可见消费和边界 |
| --- | --- | --- |
| #44 `GET /radar/participation` | 三新号200 false；A加入后true、B当时仍false；B退出后false；刷新及API重启后Atrue/Bfalse/Cfalse | 三者从首页实际进入；A已参与、B未参与、C缺类型提示，采用服务端响应；匿名额外HTTP401，伪owner query422 |
| #45 `PUT /radar/participation` | A真实控件true200；B真实控件true200、false200；A无类型时额外HTTPtrue422 `RADAR_TYPE_REQUIRED`、false200；额外伪owner/字符串boolean422 `INVALID_RADAR_INPUT` | 无类型真实加入按钮disabled并引导本人名片；私密也能显式参与；退出后统计立即清空；保存失败/未知提交结果和防重复由隔离测试验证，未伪造真实失败页面 |
| #46 `GET /radar/same-type?type_code=ESTJ&radius_m=500/1000/3000` | A三档实际控件均200 `{count:null,status:'unavailable',reason:'location_source_not_configured'}`；重读及重启后同样 | 可见“同型统计暂不可用／尚未接通自愿位置来源”，不显示0、人数较少或请求失败。此项仅不可用分支通过，真实聚合blocked |
| #46 额外同profile HTTP | A省略query200 location_source_not_configured；B省略query200 not_enrolled；C无类型422 RADAR_TYPE_REQUIRED；A错类型422 RADAR_TYPE_MISMATCH、非法半径422 INVALID_RADAR_INPUT | HTTP单列，不冒充错误页面控件验收；不拿C缺类型响应误报未参与可查询成功 |

此外 A 从雷达点“发现搭子”再点“同型雷达”，实际进入并读取不可用状态。只消费公开发现列表，没有对旧对象写入或取其联系值。无凭证额外 fetch 返回401 `{code:'GUEST_UNAUTHORIZED',message:…}`；本人participation/same-type成功及该401实际均 `Cache-Control:no-store`。Web未单独读取全部写响应头，不把候选文档约定或后端专项冒充全部Web响应头实测。

## 刷新、一次最终重启与只读回归

UTC `06:00–06:02` 已完成刷新保号及额外拒绝检查。写阶段结束于 `06:02:26`，已向总控确认全部三profile XHR in-flight=0和Atrue/Bfalse/Cfalse，随后停止API请求；总控明确开放一次同源码重启，Web没有启停4156或4056/5173。新READY消息后 UTC `06:06:14–06:06:39` 原profile刷新及只读复验，未再执行参与/名片/其它业务写操作。

原 A/B/C 凭证摘要、card ID、类型、私密公开状态和四visibility完全相同；实际读回Atrue、Bfalse、Cfalse。刷新页资源记录均没有新 `/auth/guest` 请求，没有换号、重建数据或重放已完成写操作。A三档范围与重读仍明确不可用，B显示未参与，C显示缺类型且加入禁用。三方最终in-flight=0。

F1当前 `qb-v0.4-prototype-1` / 12题不变；三方本人结果仍空。F3真实商品目录有两项且金额整数/币种CNY，三方订单和权益仍空，没有下单/解锁。F4三方原私密名片、空本人交换和空屏蔽列表保持。F5三方本人渠道 `{}`、申请列表空、不存在grant读取404 `NOT_FOUND`，没有给新主体写联系方式或读取旧F5私密值。这里是新三主体的必要只读HTTP回归，没有重跑原F1交卷、F3运营/支付、F4交换或F5有效单向授权全链路；后端独立cohort的既有授权重启证据不计为本Web验收。

去敏本机证据 `/tmp/mbti-f6-web-evidence.json`（0600）保留本轮公开合成ID、方法/URL/状态/UTC、布尔及比较摘要，没有token/请求头/渠道原值。去重XHR追踪 A69/B36/C25条，UTC `05:57:53.909–06:06:38.891`；原生fetch的3项响应头检查单独记录，初次领号和刷新早期请求不冒充完整Network捕获。重启期间没有运行脚本或轮询API。

实际查看的三张桌面截图只含本轮新主体状态，无原F5私密值：`/tmp/mbti-f6-A-unavailable-desktop.png`、`/tmp/mbti-f6-B-exited-desktop.png`、`/tmp/mbti-f6-C-missing-type-desktop.png`。A的390×844仿真截图 `/tmp/mbti-f6-A-mobile-capture-limit.png` 底部有浏览器捕获重复；DOM核查只有一个uni-page，不能据该图宣称全移动视觉通过，未因捕获现象修改业务页面。截图不提交Git。

## 交付状态、恢复与未验

| 范围 | 本轮结论 |
| --- | --- |
| #44 本人参与状态 | **通过**：新号false、本人隔离、刷新及同API原身份重启读取 |
| #45 本人显式参与/退出 | **通过**：合法私密类型可加入、B退出、A/B不互改、无类型拒绝/退出允许、原身份持久化；控件和额外HTTP分别记录 |
| #46 明确不可用分支 | **通过**：已参与位置来源缺失／合法未参与两种原因；页面不把null当低样本，协议/HTTP失败隔离测试单列 |
| #46 真实人数及半径/边界 | **blocked / not_available**：缺自愿位置来源、位置授权、距离算法和确认半径口径；没有真实聚合可验证 |
| 小样本、双向block对聚合、退出影响人数 | **blocked**：没有合法位置cohort和经确认的披露阈值；F4空屏蔽读取不代表雷达屏蔽过滤通过 |
| 微信、另一物理设备、全移动逐页、真实HTTP故障页 | **NOT_RUN**：真实401/422额外HTTP与隔离失败测试不能替代页面断网/401/503控件验收 |

不重放未知结果PUT、不换号及慢响应保护有隔离测试；没有故意破坏真实会话或后端存储注入失败。候选字段/错误码、半径策略、类型政策、留存和未来统计披露政策均保留 `needs_human_review`。

保留4155和三个profile供复验。恢复只需在本树独立安装并启动H5，4156运行与重启归后端/总控协调：

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-f6-web/web
npm ci
VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run dev:h5 -- --host 127.0.0.1 --port 4155 --strictPort
```

现有监听未停止时不要重复启动；本轮terminal为 `term_e7751970-2393-4c73-a6d8-51c1e347092f`。最后仅提交本文补证据，不改实现；一次真实Task/Dispatch/outcome worker_done确认后停止写入。
