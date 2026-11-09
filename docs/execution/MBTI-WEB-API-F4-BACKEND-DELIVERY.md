# F4 后端候选交付：#24–35

状态：**12 项内部候选已实现并通过真实 test HTTP；正式发布仍 `needs_human_review`**。这是后端 Worker 回执，不替代总控集成验收或 Web Worker 页面证据。

- Run：`run_594d408d15de`；Task：`task_ee60b8ce8251`；Dispatch：`ctx_04d1f774b1ea`。
- 独立树：`/Users/lei/orca/workspaces/mbti/mbti-web-api-f4`；分支：`weiyang86/mbti-web-api-f4`。
- 实际基线：`42dc92b6bbbdda716c980b3f0ed0a6a3067a01ff`，Orca 创建时 baseRef 为已集成 F2/F3 的 `weiyang86/mbti-web-api-fast-integration`。
- 运行源码候选：`d0bdaa94130f590089617ccf2b6e48dac288085e`。后续交付提交仅完善候选 HTTP 400 描述与本回执/最小化证据；Worker 完成消息给出完整树最终 SHA 和范围。
- 固定 PR20：`a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`，已通过 `git show` 读取 cards/buddies/card-exchanges/types-social/manual；消费者逐字段依据沿用 [准备记录](../integration/MBTI-F4-candidate.md)。已读根/web/foundation AGENTS 及指定输入包 RUNBOOK/API-REVIEW/cards/F4。
- 本轮 test API：`http://192.168.0.200:4156/api/v1`。原交付 dev `4056`、H5 `5173`、dev55436、开发运营初始化均未操作，未 push/merge/main。

## 范围与候选口径

先写入 [运行候选 OpenAPI](../integration/MBTI-F4-runtime-candidate.openapi.yaml) 和 [合成样例](../integration/MBTI-F4-runtime-candidate.examples.json)，再实现。OpenAPI 使用 JSON 编码（有效 YAML），含 12 操作、PR20 完整字段及本轮 U01–U12 选择；没有改 `docs/api` 正式文档。OpenAPI/样例不是 HTTP 证据。

新增 `MbtiCard`、`MbtiSocialBlock`、`MbtiCardExchange` 和一份附加迁移，复用 MbtiGuest/GuestGuard/Prisma/16 型元数据。独立 social controller/service 是公开投影、双向 block 和关系转换的共同 owner；没有复制认证/权限/账本，也没有直接序列化 Prisma 记录。

- `card.id` 是独立 192 位随机公开 ID，`buddy.id/buddy_id` 使用同一 ID；内部 guest/owner/sender/recipient 不进响应。所有 12 操作仍需游客凭证，`card_me` 不存在。
- 新卡懒创建，`discoverable=false`、四 visibility=false、昵称/宣言/兴趣空、illustration；类型仅初次从本人最新合法结果初始化，否则空。空类型不能公开。保存类型不会被新测评/GET 改写；latest_result_id 仅当前最新本人结果与卡类型相同才返回，删除结果不改历史或卡类型。无真实视觉交付事实时 has_visual_set=false。
- `discoverable` 控制整个公开/发现；私密本人只走 `/cards/me`。公开类型只随明确 opt-in 开放；其余四字段按 visibility 投影。隐藏 nickname/declaration 为空串，interests/shared_interests 为空数组，manual 省略。avatar/tagline/hint 仅公开类型或中性静态文案；manual 为 PR20 按类型静态文案。真实 is_demo/simulated 均 false。
- PUT 顶层及 visibility 子键白名单；按子字段合并并持有 owner 事务锁。候选限额按 Unicode codepoint：昵称 40、宣言 160、兴趣最多 10、每项 24，trim/去重/移除空兴趣。字段 null/错误类型/未知键 422；顶层 null 被现有 strict JSON parser 拒绝为 400，畸形 JSON 也是 400，未改全局 parser。
- recommend 默认 updatedAt/id 稳定倒序；合法 type_code 只过滤公开类型。same 使用服务端本人卡类型，无类型或与 query 冲突 422。limit 默认 20，1–100；SQL 可见性/双向 block 过滤在 take 前执行。静态 cards/me、buddies/blocked 先注册。
- exchange.direction 相对于当前观察者；buddy 总是对方。接收方 pending accept/decline；发起方 pending/accepted revoke；第三人 404，合法当事人角色/状态冲突 409。同向 pending 重试 200 同 ID，反向 pending 或已有 accepted 409，首建 201；declined/revoked 后创建新 ID，旧 ID 不复活。回应重放 409，原发起方重复撤回 revoked 204。
- create/respond/revoke/block/unblock 共用 canonical pair 的 PostgreSQL advisory transaction lock，数据库部分唯一索引兜底每 pair 最多一条 pending/accepted。summary 优先当前有效关系，否则最近 createdAt/id；列表按 createdAt/id 倒序。并发 discovery opt-out 导致投影失效时回滚写入并 404，避免 null 成功体。
- 任一方向 active block 即时隐藏公开页/详情/发现/交换列表并拒绝新交换/回应；block 同事务将 pending/accepted 置 revoked。unblock 只改自己方向、保留 lastBlockedAt、不复活旧关系。已知公开 ID 的 block/unblock 管理操作可在对方私密/反向 block 后继续执行；只返回管理布尔或 204，不返回私密投影。自己 active blocked 列表仅保留公开 ID、匿名标签及空敏感字段。
- 200 GET/PUT/block/respond，201 首次 exchange/200 同向 pending 重试，204 两种 DELETE；缺/无效身份 401，未知/不可见/被屏蔽/第三人 404，角色状态 409，输入 422。裸业务对象及既有 `{code,message}`，全部 F4 响应 no-store。

## 实际成功与拒绝矩阵

最终完整 HTTP 验证在运行候选 d0bdaa9 上执行：**212 次真实 HTTP（含前置游客/结果及预检），73 项语义/隐私断言，退出 0**。P 编号链接 [prepare 请求证据](MBTI-F4-prepare.http.json)。完整响应先在测试中校验，提交的列表样例只保留本轮合成 cohort，并保留 observed_item_count；没有提交凭证、其他记录的资料或原始运行日志。

| # | 方法/路径（省略 /api/v1） | 实际成功证据 | 实际拒绝与边界证据 |
| --- | --- | --- | --- |
| 24 | GET /cards/me | P003：200，A/B/C/D 独立公开 ID；安全缺省及最新类型；R001–003 原游客持久化 | P185 缺凭证 401；P203 随机无效凭证 401；仅凭证本人，无 owner 参数旁路 |
| 25 | PUT /cards/me | P018：200 明确加入发现；P053–055 并发 visibility 子键不丢；P056–060 显示允许字段后再次隐藏；P065–074 新结果/选型/删除/历史语义 | P013 空类型公开 422；P030–049 白名单/字段类型/限额 422；40/41 Unicode codepoint 为 200/422；P029 顶层 null、P209 坏 JSON 400；P186 缺凭证 401 |
| 26 | GET /cards/{card_id} | P021/P103：200 公共类型，其余隐藏值安全，manual 省略；P056 手动允许 name/manual 才出现 | P014–016 私密对象（包括本人）404；P017 card_me 404；P139–140 双向 block 后旧 ID 404；P166 自己 opt-out 公共路由 404；P187 缺凭证 401 |
| 27 | GET /buddies | P075 same、P085 recommend 类型过滤 200；P169 limit=1 在屏蔽过滤后仍返回可见项；推荐无伪造算法 | P012 无本人类型 422；P076–084 mode/错型/limit/重复 query/未知 query 422；P188 无身份 401；所有列表排除本人、私密及双方 block |
| 28 | GET /buddies/blocked | P149 静态路由 200，公开 ID + 匿名管理投影；P150 只列自己发起；R006 重启保留 | P189 缺凭证 401；反向关系不披露，类型/昵称/兴趣 canary 均无泄漏 |
| 29 | GET /buddies/{id} | P022/P104/P159 200；隐藏 nickname/interests/shared，avatar 从公开类型推导 | P141 被对方 block 后旧 ID 404；P163 opt-out 404；P198 未知 404；P190 无身份 401 |
| 30 | POST /buddies/{id}/block | P137/P148：200 blocked=true，重复幂等；P178 将 accepted 撤回；R017 重启后管理正常 | P199 未知 404，P204 自己 422，P191 无身份 401；双向读/新交换/旧回应均被收紧 |
| 31 | DELETE /buddies/{id}/block | P152/P153 重复 204；P155 另一方解除后可读；R009 重启后解除 204 | P154 仅解除己方仍因反向 block 404；P200 未知 404，P205 自己 422，P192 无身份 401；旧申请仍 revoked |
| 32 | GET /card-exchanges | P089 A→B 在 B 视图 incoming/buddy=A；P090 C 无该记录；P106 accepted 后嵌入投影仍无 canary | P146–147 block 后双方隐藏对方；P165 opt-out 隐藏旧嵌入；P193 无身份 401；内部身份和联系方式均未出响应 |
| 33 | POST /card-exchanges | P088 首建 201；P097 同向 pending 重试 200 同 ID；P114–121 并发同向一 201 + 七 200；终态后新 ID | P086 自己/P087 sender 注入 422；P098 反向 pending 409；P101–102 accepted 409；P142–143 block 404；P164 私密 404；P194 无身份 401 |
| 34 | POST /card-exchanges/{id}/respond | P099 接收方 accept 200；P111 decline 200；P127–128 竞争一个 200、一个 409 | P091/P096 第三人 404（先归属再 body）；P093 发起方 409；P095 action 422；P100/P113 终态重放 409；P144 屏蔽后旧 ID 404；P195 无身份 401 |
| 35 | DELETE /card-exchanges/{id} | P107 accepted→revoked 204，P108 原发起方重试 204；P122 pending 撤回 204；R012 重启后重试 204 | P092 第三人 404、P094 接收方 409、P112 declined 冲突 409；P145 block 后旧 ID 404；P196 缺身份 401；旧记录不可回应/复活 |

完整状态分布为 200×87、201×17、204×15、400×2、401×13、404×27、409×14、422×37，包含前置 F2 结果调用与 CORS OPTIONS；并非把这些数量当作 12 个业务接口的数量。

## 并发、隐私与重启实际证据

- 同向 create P114–121：一个 201、七个 200、同一个 ID；反向 create P123–124：201/409，不自动接受。DB 只辅助核对活动 pair 唯一，所有状态转换与最终结果通过 HTTP 完成。
- accept/decline P127–128：200/409；三方 accept/decline/revoke P132–134：revoke 204，两个回应 409，终态 revoked。允许合法串行的 accepted→revoked，不能把它误报为两个 pending 回应同时成功。
- block/respond P137–138：block 200、respond 404；block/create P171–172：block 200、create 404；之后所有相关旧 ID/新申请受拒绝，解除后旧 revoked 仍 409。交换接受不会生成联系方式授权，全部 F4 对象扫描无渠道值/内部 owner/历史结果/答案/阶段/凭证。
- canary 在公开 card、buddy、discovery、exchange 嵌入和 blocked 管理中扫描；name/interests/declaration/manual 分别 opt-in 可显示、关闭立即隐藏。tagline 不复用私密 declaration，avatar 不从隐藏 nickname 派生。
- 两个实际来源 `http://127.0.0.1:4155`、`http://192.168.0.200:4155` OPTIONS 204 且 ACAO 精确匹配；evil 来源 204 无 ACAO（P206–208），真实带 guest 请求同时已到后端。
- 在总控明确“现在可短重启4156”窗口后 stop/start，同库不清数据；[restart 请求证据](MBTI-F4-restart.http.json) **17 次请求、8 项断言、退出 0**。原 A/B/C card ID/字段一致，原 AC accepted 仍可读；A→B block 仍生效，旧 card/buddy 404，解除后旧 AB 为 revoked、回应 409、原发起方重撤 204，随后恢复合成 A→B block 状态。重启 cohort 来自第一轮 prepared；最终 212 请求使用新 cohort 在同一候选二进制再验证，二者不会混称同一批 ID。

## 实际命令与退出码

以下后端命令均在本树 `aij-foundation` 内运行；每树独立 node_modules/Prisma 生成，没有链接其他树或独立底座依赖。

| 命令 | 最终退出码/实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 0，800 packages；仅本树依赖 |
| `pnpm --filter @aij/api prisma:generate` | 0，Prisma 6.19.3，本树 client |
| `pnpm --filter @aij/contracts --filter @aij/core --filter @aij/runtime-contracts build` | 0，补齐本树 workspace 编译产物 |
| `pnpm --filter @aij/api typecheck` | 0，源码和测试 tsc 均通过 |
| `pnpm --filter @aij/api build` | 0，运行 dist 来自本树 |
| `pnpm --filter @aij/api prisma:validate` | 0，编译验证，不连库 |
| `pnpm lint` | 0，完整 Foundation apps/scripts |
| `pnpm --filter @aij/api test` | 0，79/79 通过 |
| `MBTI_LOCAL_OWNER_ROOT=... node scripts/mbti-local.mjs check test` | 0，container/marker/db/user/55437/同仓 owner 验证 |
| `MBTI_LOCAL_OWNER_ROOT=... node scripts/mbti-local.mjs migrate test` | 0，41 migrations，只新增 `20261109000100_mbti_f4_social_candidate` |
| `MBTI_LOCAL_OWNER_ROOT=... node scripts/mbti/seed-f3-test.mjs` | 0，本树独立 0600 test fixture；不搬到 dev |
| `MBTI_LOCAL_OWNER_ROOT=... node scripts/mbti/verify-f4.mjs prepare` | 0，212 HTTP / 73 断言；原 token 只保留 ignored 0600 状态 |
| `MBTI_LOCAL_OWNER_ROOT=... node scripts/mbti/verify-f4.mjs restart` | 0，明确窗口重启后 17 HTTP / 8 断言 |
| `MBTI_LOCAL_OWNER_ROOT=... node scripts/mbti/verify-f2.mjs` | 0，64 检查，包含归属/比较/删除/真实 SVG 和存储失败重试 |
| `MBTI_LOCAL_OWNER_ROOT=... node scripts/mbti/verify-f3.mjs` | 0，121 检查；本树 Auth/RBAC 同测试订单及受控协议回归，非真实外部支付 |
| `python3 /Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane/smoke.py --base http://192.168.0.200:4156/api/v1 --phase F2` | 0，含 F1，题库 qb-v0.4-prototype-1；结果 6b15f719-01a7-4bd7-b4e4-6a4f75b6f043 / f00730ef-ce2c-48e7-8d52-67c4492fd7bb，B 404、submit 201/409、F2 图片/比较/删除通过 |
| `git diff --check` / `git diff --cached --check` | 0；精确暂存显式路径 |

首次本树 typecheck 退出 2、API test 退出 1：workspace 包未构建，另有 F4 helper 类型收窄错误；补齐本树包构建并修正后最终均通过。首次 F4 HTTP 脚本对顶层 null 误期望 422 导致退出 1，实际是既有 parser 400；已纠正候选说明/测试并整轮通过，不把失败隐藏为通过。Git 读取时存在仓库既有 AppleDouble `._pack*.idx` 警告，真实 pack/基线/提交可用；未改 `.git` 元数据或提交 `._*`。

## 运行与恢复

PG/秘密 owner 仍为 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`，test55437 与 dev55436 分离，不删 owner/配置/持久卷。4156 当前进程 entry 是本树 dist。总控负责 dev 切换；以下只针对已核准的 test，重启应协调正在联调的 Web 写入窗口。

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-f4/aij-foundation
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
export MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4156
export MBTI_H5_ORIGINS='["http://127.0.0.1:4155","http://192.168.0.200:4155"]'
export MBTI_F3_TEST_FIXTURE=1
node scripts/mbti-local.mjs check test
# 新 checkout：独立安装/生成/构建；迁移只允许 test，同一时刻一个后端 Writer。
pnpm install --frozen-lockfile
pnpm --filter @aij/api prisma:generate
pnpm --filter @aij/contracts --filter @aij/core --filter @aij/runtime-contracts build
pnpm --filter @aij/api build
node scripts/mbti-local.mjs migrate test
node scripts/mbti/seed-f3-test.mjs
# prepare 只创建新合成 cohort，不清除 Web 或其他人的数据；秘密保留 ignored 0600 状态。
node scripts/mbti/verify-f4.mjs prepare
# 收到明确短重启窗口后：
node scripts/mbti-local.mjs stop test
node scripts/mbti-local.mjs start test
node scripts/mbti/verify-f4.mjs restart
```

新 checkout 没有该树自己的 fixture 时先 seed 再带 `MBTI_F3_TEST_FIXTURE=1` start，不能复用另一树 fixture。若只恢复已验本树，现有 fixture/state/数据库都保留，check 后 stop/start 即可；没有必要重复 seed 或 prepare。没有跑上游固定 db:*、base:dev、ai:local，没有改 F3 账本/运营权限或开发认证。

## 未验项与后续依赖

U01–U12 对正式发布的业务审核仍保留；本轮总控选择只作为内部候选口径，不反复阻塞内部验证。游客过期后资料留存、正式发现策略/限额、公开身份及最终 HTTP/字段发布仍需业务定稿。

本 Worker 未改 web、未做 GUI 页面验收；Web Writer 的 A/B/C 页面与原三 profile 刷新/重启复验由总控单独收集。后端已及时发契约路径与 READY，并在总控明确窗口内切换；没有声称浏览器证据属于本 Worker。跨物理设备、微信、生产负载/多实例长时间压测未验。

F5 联系渠道/请求/授权读取未实施，accepted 不授权任何真实渠道；这里只交公开 ID→owner 映射、实时双向 block 判断和保留 lastBlockedAt 的模型依赖。F4 名片夹不应因尚未就绪的 F5 Promise.all 失败或假成功；这是 Web 接线责任。F6 只记录依赖，不收位置、不伪造计数。真实支付供应方仍 blocked_external，不影响本轮 12 项内部能力均已验证。
