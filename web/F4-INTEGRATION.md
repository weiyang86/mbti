# F4 Web 候选接线与真实页面验收

状态：`candidate / needs_human_review`，不作为正式接口发布或产品规则定稿。Run `run_594d408d15de`，Task `task_304e425f3c01`，Dispatch `ctx_d8e6c1640dba`；2026-11-09。

## 范围与基线

- 本树 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f4-web`，分支 `weiyang86/mbti-web-api-f4-web`，基线 `42dc92b6bbbdda716c980b3f0ed0a6a3067a01ff`，已含总控验收的 F1/F2/F3 与开发运营初始化。
- Web 实现提交 `5d3037828d3b1710ba731fc254181fe039f7374a`；后端重启后只读复验候选 `d0bdaa94130f590089617ccf2b6e48dac288085e`。本说明补证提交作为 Web 最终候选，范围仍仅 `web/` 17 文件。
- 固定参考 PR20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`：读取 cards/buddies/card-exchanges/types-social，核对 card/public/discover/buddies detail/exchanges/account 的真实消费；没有整体合入 PR20。
- 读过根、web、aij-foundation AGENTS，输入 RUNBOOK/API-REVIEW/cards/F4，内部准备 [MBTI-F4-candidate.md](../docs/integration/MBTI-F4-candidate.md) 与 F3 交付说明。
- 后端 runtime candidate 来自后端树 `docs/integration/MBTI-F4-runtime-candidate.openapi.yaml` 与 examples；已逐字段核对，本树仅修改 Web 与本说明，不修改后端、Prisma 或 `docs/api/`。
- 测试 H5 **`http://127.0.0.1:4155/#/`**；API **`http://127.0.0.1:4156/api/v1`**。全程 `VITE_USE_MOCK=false`，没有切换 base 或混用稳定开发 4056/5173。

## 实现与候选选择

首页增加我的名片、发现搭子、名片夹、屏蔽管理入口；沿用 dev 的基础样式，新增六个最小页面。名片支持昵称、介绍、兴趣、16 型元数据选择、风格、明确公开/发现开关及四个可见字段开关。公开页只接受真实公开 card ID；四可见字段每次 PUT 仅发该子键，保存资料不携带 visibility/discoverable，避免意外扩大公开范围。

公开页、发现、详情和交换内嵌 buddy 均只展示当前响应，没有 studio/customQuote/示例类型/本机私密资料回填。读取前清空旧投影；失败显示错误，避免 404 后继续展示上次资料。名片夹只依赖 F4，不请求 contacts/contact-requests。接收 pending 的 incoming 才显示接受/拒绝，发出的 outgoing pending/accepted 才显示撤回；失败重新读取服务端关系，404/409/422 有可读提示。真实交换不授予联系方式。

F4 复用原 `request`/共享初始化游客 client，未改游客、交易意图或原题库恢复实现；没有失败后换号/重放写操作或 Mock 成功占位。新 F4 封装没有 Mock 分支。

以下均为总控本轮选定、供验证的候选，U 项仍 `needs_human_review`：

| U 项 | 本轮采用的范围 |
| --- | --- |
| U01 | 公开 card.id 同用于 buddy.id/buddy_id；不向 Web 提供内部 owner，删除 card_me 演示别名 |
| U02 | 新卡私密、discoverable=false；空类型显式提示，保存合法类型后才可主动开启；公开路由仍需游客 |
| U03 | 只主动 PUT 合法类型，不修改历史或按新结果静默覆盖；不从 type_code 反推 result_id |
| U04 | recommend 按服务端稳定排序；same 依服务端本人类型，页面不发送伪造类型；每次 limit=20 |
| U05 | 候选限额 40/160 字符、10 项兴趣/每项 24；trim/去重；服务器白名单与 422 权威；四 visibility 子键分别保存 |
| U06 | 隐藏昵称展示匿名，隐藏介绍/兴趣不补回；manual 仅响应存在时显示类型模板；没有视觉套装不宣称已有 |
| U07 | direction 由服务端给出；Web 按 incoming/outgoing 显示可执行入口 |
| U08 | 仅发起人可撤回 pending/accepted；接收方没有撤回入口 |
| U09 | 同向 pending 重试同 ID，反向冲突；拒绝/撤回后新 ID，不复活旧记录；最新关系由列表顺序决定 |
| U10 | block 即时收紧，已接受关系变 revoked；管理页只用公开 card ID 与匿名序号，不显示私密类型/昵称/兴趣；解除不恢复旧关系 |
| U11 | F5/F6 仅记录依赖；不调用未就绪联系方式接口，不伪造渠道、位置、计数或授权 |
| U12 | 裸对象、GET/PUT/block/respond 200，首建 exchange 201/同向重试 200，DELETE 204；错误 401/404/409/422 仍由服务器决定；不发布正式契约 |

## 实际命令与退出码

本树独立安装，未链接其他工作树 node_modules。

| 命令 | 实际结果 |
| --- | --- |
| `cd web && npm ci` | 0；969 packages，锁文件未变；npm 报告现有依赖 75 项漏洞，本轮未升级依赖 |
| `npm run test:api` | 0，25/25；原 F1/F2/F3 加 F4 全路由共享身份、部分 visibility、失败不回退/换号及角色按钮条件 |
| `npm run type-check` | 0 |
| `VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run build:h5` | 0；沿用 UniApp/Sass 的现有 deprecation 警告，无编译失败 |
| `git diff --check` | 0 |
| `/tmp/mbti-f4-browser.py`、`/tmp/mbti-f4-stage2.py`、`/tmp/mbti-f4-stage3a.py`、`/tmp/mbti-f4-stage3b.py`（`python3` 执行） | 各 0；通过 Orca CLI 驱动实际浏览器 UI，并用同浏览器 client 做越权/非法输入请求；不是 Mock 服务 |
| `python3 /tmp/mbti-f4-restart-read.py` | 0；原 A/B/C 重启后保号、保卡、隐私与关系持久化、F1/F3 只读回归、401 与 no-store 实测 |

## A/B/C 真实 Network 与界面证据

三个新隔离 Orca profile：A `4f5ee7ee-d710-4013-96a5-a900a86dafca`，B `c615487a-9ec7-47f8-b7d3-2ee4ec9709fb`，C `e5b0a0b9-e53e-40c1-b9d5-33028c75a2ca`。分别通过本人页面维护并主动公开 A=ESTJ、B=INFP、C=ESTJ，绝非回退示例类型。三个凭证摘要与 card ID 各自不同，刷新后均保持同一摘要与本人卡。凭证只在浏览器存储，未输出或提交。

仅含本次合成测试资源：

- A：`card_yMsTvVdUGbxOQ37MPYLpXcHspHyzJu9T`
- B：`card_4XizpGpBdElYHdRng0KznT2iqbX77kyR`
- C：`card_jzkgpIFAevCooWmsIC-pqkBou1XgtOd5`

下表请求基址均为上述 4156；`B`/`X` 为上列 card ID/下列真实 exchange ID 的简写。正常操作均由可见页面控件触发；越权与非法输入额外使用同 profile 的原 client 发真实 HTTP，单独说明。

| # | 实际请求、主体与状态 | 可见消费/实际断言 |
| --- | --- | --- |
| 24 | A/B/C `GET /cards/me` 200 | 我的名片：新号空类型、四 false、未公开；三个主体编辑视图隔离，刷新卡 ID 不变 |
| 25 | A/B/C `PUT /cards/me` 200；A 非法 type/owner_id 422 | 编辑字段/类型/风格、主动开启公开、四开关分别写单个子键；B 逐项隐藏后其他设置保留；无默认公开 |
| 26 | A/B/C `GET /cards/{card_id}` 200；B 整卡私密后 C 与 B 自己直读 404；屏蔽后 B 读 A 404 | 从“查看服务端公开投影”及搭子详情进入；隐藏时匿名、无介绍/兴趣/manual；404 旧资料清空 |
| 27 | A `GET /buddies?mode=recommend&limit=20` 200；same 同路径 mode=same 200 | 推荐有 B/C、排除 A；同型只见 C；B 隐藏字段后发现页同步匿名；block 后排除 B |
| 28 | A/B `GET /buddies/blocked` 200 | A 仅自己发起的 B 管理条目；B 为空，不暴露反向关系；安全响应 type/name/interest 无私密值 |
| 29 | A `GET /buddies/B` 200，block 后 404，解除后 200 | 真实详情入口；隐藏字段后无 B canary、旧内容不保留；解除可读且关系仍 revoked |
| 30 | A `POST /buddies/B/block` 200 | 详情确认屏蔽后进入管理页；双方旧公开直访、创建和回应交换 404；双方名片夹隐藏对方 |
| 31 | A `DELETE /buddies/B/block` 204 | 管理页“解除此项屏蔽”，列表清空；旧 accepted 对应 ID 仍 revoked |
| 32 | A/B/C `GET /card-exchanges` 200 | A 为 outgoing、buddy=B；B 为 incoming、buddy=A；C 不含该关系；没有 F5 请求，隐藏 B 后内嵌 buddy 同步收紧 |
| 33 | A `POST /card-exchanges` 201；A 同向重试 200 同 ID；B 反向 pending 409；block 后双方创建 404 | 详情真实申请，A 只有等待/撤回；终态后 UI 再申请新 ID，无模拟对方同意 |
| 34 | B `POST /card-exchanges/X/respond` accept/decline 均 200；A 发起人 409，C 第三人 404，block 后 B 404 | B 本人名片夹接受/拒绝；A 刷新见真实状态；B 在 A 已撤回的旧 UI 点击接受，真实 409 显示中文冲突并刷新 revoked |
| 35 | A `DELETE /card-exchanges/X` pending/accepted 均 204；B 接收方 409，C 第三人 404 | A 在详情撤回 pending、名片夹撤回 accepted；B 没有撤回控件；撤回后均不显示成功授权 |

关系序列：`exchange_QxRevZklRo57AbIhUcteD-5qbNVfc0tY` 首建→B 接受→A 撤回；`exchange_VFSNIrp_0pgNiUlDFZDXNLQE13IfAgOz` 新建→B 拒绝；`exchange__3MSJR9AdUDv16AC3mXcJ_Z6MwBAikaN` 新建→A 撤回。后续 `exchange_4m_kkC9pXCPi8ka8CBB_T2TK8DupwDuj` 接受后因屏蔽 revoked，解除后原 ID 仍 revoked。

写操作结束时去敏 Network 捕获 A=141、B=86、C=45 条 API 请求（包含 OPTIONS），实际状态集合有 200/201/204/404/409/422；contacts/contact-requests 请求数均 0。只记录方法、URL、状态、时间及合成对象/UI 文本，未保存 header/token。原始工具输出、截图与临时验收脚本留在本机临时目录，不提交日志或构建产物。390×844 手机宽度实看公开页及桌面截图无溢出；全页面移动端逐页视觉检查未执行。

实际 UTC 界面/响应检查时点：三卡保存/主动公开分别 `04:22:18`、`04:22:24`、`04:22:30`；发起 `04:48:12`、收到 `04:48:13`、接受 `04:48:15`；隐藏后详情/公开/内嵌收紧 `04:48:17–18`；已接受撤回 `04:48:19`、拒绝 `04:48:21`；屏蔽管理 `04:49:40`、解除 `04:49:44`、原 ID revoked 读回 `04:49:45`；原三身份刷新 `04:49:46–48`。对应日期均为 2026-11-09，实际 Network 时间范围 `04:18:47–04:49:48`，状态/方法/路径来自浏览器捕获而非预期值。

重启只读复验完成于 UTC `04:54:59`；最终捕获 A=150、B=95、C=73 条 API 请求，新增实际 401 证据；捕获期间三 profile 的 auth/guest 发行请求均为 0，使用已有身份。后续没有 Web 写请求。

## 重启、回归与未验

- **总控追加发现，F4 最终验收暂缓**：`d0bdaa9` 的私密且无类型游客可通过直接 HTTP 创建 201 隐藏 pending，接收方不能列出或回应。后端 Writer 正增加发起方合法类型 + discoverable 检查与拒绝不落 pending 的验收；新候选 READY/SHA 后原三 profile 复验 `NOT_RUN`。上面的成功证据是实际已执行范围，不代表此缺陷通过或 F4 最终放行。Web 的 [detail.vue:29](src/pages/buddies/detail.vue#L29) 提示先公开，第 30 行禁用未公开本人的申请按钮，第 78 行 create 函数再次检查 discoverable，未公开本人不会从页面发送申请；服务端仍必须兜底拒绝。
- 总控最新派工明确：本轮交可审查 **Web 候选**，由总控接续后端修复用例及新 fix SHA 下原 profile 的只读复验；不把 `d0bdaa9` 称为最终后端通过。Web Writer 完成本轮一次 worker_done 后停止写入，保留 4155、三 profile 与现有数据，未重开任务或触碰 4056/5173。
- 已按总控指定窗口停止 Web 写请求；收到后端 stop/start 后 READY 与候选 SHA 后，用原三 profile 刷新并只读复验通过。没有重新领号或清记录：A/B/C 的凭证摘要、card ID、类型、公开状态不变，B 四项隐藏保留，A/B 五条关系（四 revoked、一 declined）方向/对方和终态保留，C 无私密关系；三人的本人 blocked 列表仍空。公开页与内嵌 buddy 仍匿名且无 B canary；已接受后 block 的原 ID 仍 revoked。
- F1/F3 真实只读回归通过：C 原身份 GET 当前题库 200，`qb-v0.4-prototype-1`、12 题；本人结果 200 空列表；商品 200 与页面一致（990 分可售、1990 分未开放），本人订单/权益均 200 空列表，页面没有假购买/解锁。没有创建新订单或测试会话；交易意图与原题库恢复代码未改，原有 22 项隔离测试仍通过。
- 浏览器实际缺 token `GET /cards/me` 401 `GUEST_UNAUTHORIZED`；有 token `GET /card-exchanges` 200，实际 `Cache-Control: no-store`。并发 pair 锁/唯一约束、双向同时 block/respond 由后端 Writer 主验，本 Web 未把后端专属测试计为自身通过。
- 真实浏览器 401 不换号/重放故障注入、422 输入失败页面、微信端、另一物理设备、全移动布局：`NOT_RUN`；25 项隔离测试覆盖 client 的 401 保号、404/409/422 不回退与按钮角色。真实 404/409 页面已测，422 真实 HTTP 已测，二者不混称页面通过。
- F5 授权链、真实联系方式、F6 位置/计数均 `NOT_RUN`，没有调用占位接口或显示假授权。
- 正式发布仍需审阅 U01–U12 与本轮候选；本说明不消除 `needs_human_review`。

## 运行与恢复

4155 开始前已核对无监听，当前本树 Orca H5 terminal：`term_9e4a03d3-5aa6-46b6-8ae6-c834458e7202`，保留运行；没有操作旧 H5 句柄、4056 或 5173。恢复命令：

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-f4-web/web
npm ci
VITE_USE_MOCK=false VITE_API_BASE_URL=http://127.0.0.1:4156/api/v1 npm run dev:h5 -- --host 127.0.0.1 --port 4155 --strictPort
```

API/数据库恢复交总控与后端 Writer，owner 仍是 F1 的 aij-foundation，测试 55437 与开发 55436 分开；本树未执行迁移或运营初始化。三个浏览器页面 A `92bc839e-77b2-4283-bf03-5fbf71a80d44`、B `ecd6f026-15d0-4be8-9ef3-24df73d82a58`、C `24707ecb-da64-4746-a930-011fe28dd3fa` 可在上述 profile 继续只读复验。

最终精确核对：`git diff 42dc92b6bbbdda716c980b3f0ed0a6a3067a01ff HEAD --check` 退出 0，范围仅 `web/` 17 文件；逐名核对无 `.env`、密钥、日志、构建、真实用户数据、`._*`、后端/Prisma/权威 `docs/api` 或 `UIhtml`。本地仅文档补证有后续提交，已通过的实现代码与 25 项测试/构建/三身份 12 操作时保持一致；没有因后端发现而重写或掩盖既有证据。
