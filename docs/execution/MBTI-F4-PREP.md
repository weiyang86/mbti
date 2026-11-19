# F4 候选契约准备回执

2026-11-09。Run `run_594d408d15de`；Task `task_58bbb815c52e`；Dispatch `ctx_49feab013109`。本次交付是 F4 的文档准备任务，不是原始 F4 卡的运行实现/真实联调验收。

## 基线与精确范围

- Orca 工作树 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f4-prep`；分支 `weiyang86/mbti-web-api-f4-prep`，非主工作树。
- 实际基线 `777a5ea1c4229f6540582345827a316d90afd6fe`，与读取时本地 `dev` 一致；`git merge-base --is-ancestor ecd65aedecb4fc804070484e56c251ed1c1a6df9 HEAD` 退出 0，确认包含已交付 F2。
- 固定研究前端 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f`（PR20），没有 fetch、切换 PR 分支或合入演示源码。
- 输入包绝对路径 `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti/orca-inputs/MBTI-WebAPI-Fastlane`。已读根/web/aij-foundation 的 AGENTS.md、输入 RUNBOOK/API-REVIEW、F4/F5/F6 卡与现有 F2 交付记录。
- 仅新增 [内部候选](../integration/MBTI-F4-candidate.md) 与本回执；运行源码、Prisma/schema/迁移、路由、请求层、已交付文件与权威 `docs/api/` 均不在修改范围。
- 这两份文档使用一个独立候选提交；准确候选 SHA 由本次 `worker_done` 及 `git log -1 --format=%H -- docs/integration/MBTI-F4-candidate.md docs/execution/MBTI-F4-PREP.md` 定位，避免在同一个提交中自指其 SHA。

## 已完成研究与实现交接

候选逐项映射 #24–35 的 12 个方法/路径、原始请求字段、完整响应字段、实际页面入口、可消费 HTTP 状态及本人/公共数据范围；显式要求 me/blocked 静态优先，区分 PR20 明示 E、任务/评审要求 R 与准备建议 P。候选给出双向屏蔽统一判定、私密/公开投影、交换角色和状态转移、无序 pair 唯一待办及事务并发建议、第三人拒绝、联系方式单独授权边界，并附 A/B/C 逐路由真实验收计划。

实际读取了 PR20 `cards.ts`、`buddies.ts`、`card-exchanges.ts`、`types-social.ts` 以及 card/public/discover/buddies-detail/exchanges/account 页面；跨全部pages检索调用者后补读 history/detail 主动选旧类型更新名片和 compat 取本人类型的消费段；同时读取 `client.ts`、`contacts.ts`、`radar.ts`、F5 申请页、F6 雷达页、manual/studio/profile 和 pages.json，核对消费链而非只看请求封装。读取当前 MbtiGuest/MbtiResult/ShareAsset 模型、GuestGuard、结果删除/排序及16型元数据，形成供 F3/F4/F5/F6 Writer 协调的依赖清单；没有落 schema 建议。

可直接使用的确定边界是身份必须来自服务端、名片/搭子/交换共用当前可见性和双向屏蔽、最多一个并发有效待办、只有接收者回应、有权发起者撤回、第三人不可操作，以及互换名片不授权任何联系渠道。精确默认值和未约定业务决定仍不能被当成“已确认契约”。

## unknowns 与接线缺口

完整登记见候选 U01–U12，均为 `needs_human_review`：

| 项 | 下一轮需明确 |
| --- | --- |
| U01/U02 | card/buddy/guest ID映射、PC硬编码card_me、新号缺省、整体公开/发现同意与匿名访问；PR20没有整体私密开关，不能擅自默认全站可发现 |
| U03/U04 | 可写type_code与最新quiz/self_select结果的优先级、历史页选旧类型仅传type_code/declaration却不传result_id、删除最近结果后的行为；推荐/same/query语义、排序/limit与隐藏兴趣参与规则 |
| U05/U06 | 校验限额/转换/未知字段策略、单子键并发更新；公开空值/匿名化、头像/文案/manual/visual来源；本机studio会补回隐藏介绍/形象状态 |
| U07 | API-REVIEW要求收发方向，但PR20 CardExchange没有direction；建议补充仅为候选。当前“模拟对方回应”不适用于真实接收方鉴权 |
| U08/U09 | accepted撤回权限、幂等/反向并发的状态码、终态再申请/冷却、历史列表与当前状态的优先级 |
| U10 | 屏蔽后已有交换是否落revoked、屏蔽列表安全例外投影、解封与独立联系方式授权的恢复/撤回联动 |
| U11/U12 | 游客关系留存、F6自愿位置/阈值/不可用表示；精确HTTP/错误code/ID/时间格式。F4源码只承诺2xx解析，未确认200/201/204/404/409/422 |

F5 的具体依赖已核查：名片夹 `Promise.all` 同时请求 F4 交换列表和未就绪 F5 `listContactRequests`，后者失败会使整个页面失败；下一轮 Web 应审核独立加载/能力提示方案，不伪造 F5 成功。F6 复用本人类型和屏蔽关系，但当前模型没有位置/参与同意，页面又把失败当 null/“人数较少”，需要按 F6 卡独立处理，不在本准备实现。

## 实际检查与退出码

本任务只做静态研究与文档核验，没有安装依赖、编译、镜像测试、数据库/Prisma操作、HTTP探测或浏览器操作。以下是本轮实际执行的检查，不借用 F1/F2 通过数冒充 F4。

| 命令/检查 | 实际结果 |
| --- | --- |
| `orca skills get orca-cli --json`、`orca skills get orchestration`、`orca worktree current --json` | 各退出 0；读本机版本技能，确认独立工作树/实际branch/head |
| `git rev-parse HEAD`、`git branch --show-current`、`git log -1 --format='%H %s' dev` | 各退出 0；起点/本地dev为777a5ea1，分支为本准备树 |
| `git merge-base --is-ancestor ecd65aedecb4fc804070484e56c251ed1c1a6df9 HEAD` | 0；F2后端实现已在基线历史内 |
| `git ls-tree -r --name-only a39d99cf8537a6e54c34e965b2c3ff6c2691a21f web/src`，随后逐文件 `git show <固定SHA>:<路径>` | 0；4个必读API/类型、实际消费页与后续依赖源码均读取；最终成功读取器对每次git show断言退出0 |
| `git grep -n -E '<12个F4函数名>' <固定SHA> -- web/src/pages` | 0；跨页面确认调用者，补齐history/detail与compat消费，不把封装字段误称都有页面保存入口 |
| `rg -n ... aij-foundation/apps/api/prisma/schema.prisma` 与 MBTI HTTP/service/controller/types 静态读取 | 0；得到现有身份、结果、删除与类型来源，未执行代码或连接数据库 |
| 初次路径发现中 `git show <固定SHA>:web/src/api/request.ts` | 子命令128（该文件不存在；外层探查器0）；随后按tree找到真实client.ts并读取成功，未将失败项当通过 |
| 初次 `rg --files` 含尚不存在的 docs/integration 与误猜 aij-foundation/prisma | 2；随后使用实际 apps/api/prisma 路径并明确新建integration目录，仅新增获准文档 |
| `printenv ORCA_CLI_COMMAND ORCA_DEV_REPO_ROOT` | 1，两变量未设置；按技能在当前macOS Orca环境固定使用orca，可运行且未切换其他二进制 |
| 文档静态完整性检查（Python标准库，内联执行；固定源码签名/12路由/12 unknowns/验收行/仅两文件） | 0；21份固定PR20源码可读，12函数/路由、各interface全部字段、M24–35、U01–12齐备；Markdown表格列数/相对链接通过，仅两份获准新文档，无已跟踪源码修改 |
| `git diff --check`、精确暂存后 `git diff --cached --check` 和暂存文件白名单 | 均0；仅A docs/integration/MBTI-F4-candidate.md与A docs/execution/MBTI-F4-PREP.md。暂存审查无运行源码、schema、docs/api、秘密、真实用户数据、产物或AppleDouble文件 |

共享 Git 对象库已有 `._pack-*.idx` 的 `non-monotonic index` stderr 警告，读取及核验实际退出0；未修改共享对象库或删除AppleDouble文件。不提交任何 `._*`、.env、秘密、日志、构建、依赖或用户数据。

## 真实成功/拒绝状态及未验项

| 范围 | 本轮事实 |
| --- | --- |
| #24–35 真实 HTTP 成功 | 未请求；无真实成功状态码，不声称实现或交付F4 |
| A/B/C 隔离、双向屏蔽、第三人拒绝、交换并发/撤回 | 未请求；候选已列逐项顺序和预期，真实拒绝状态码待下一轮记录 |
| F4 H5关Mock页面、刷新、重启及跨设备 | 未运行；已标card_me、模拟对方、F5并发依赖与缓存补值缺口 |
| F5授权与F6聚合 | 仅核对依赖，不实现；F5独立授权、撤回/清除/屏蔽和F6位置/小样本等联动均未验 |
| 数据库和服务 | 无连接/迁移/seed/启停；未触碰owner配置或dev55436/test55437，未替换4056/5173，也未接管4156/4155；本轮F3保留共享迁移/路由Writer |
| 集成 | 只提交两文档候选供总控审阅；未push/merge，不操作main。下一轮按最新已集成dev和F3最终结果实施 |

交付完成后仅向 `run:run_594d408d15de` 的总控发送一次真实 Task/Dispatch 的 worker_done，携候选 SHA、精确文件范围、实际检查退出码与 unknowns；不向已结束 Worker 发送跟进，随后停止写入。
