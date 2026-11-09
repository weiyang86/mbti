# F6 后端候选交付：本人参与与明确不可用 #44–46

**#44/#45 与 #46 unavailable 分支已实现并通过真实 test HTTP；真实半径聚合 blocked_external / not_available。** 正式发布仍 `candidate / needs_human_review`，不代表三项真实人数功能通过。本回执只提供后端证据，Web GUI 由另一 Writer 交付。

- Run `run_594d408d15de`；Task `task_023e4e12d4ed`；Dispatch `ctx_f0ad890d1e30`。
- Orca 独立树 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f6`，分支 `weiyang86/mbti-web-api-f6`，baseRef 为已验收 F5 集成分支 `weiyang86/mbti-web-api-fast-integration`，起始 HEAD **`00d9199748f3c46f9bf21fcc5035280d90e2ac9b`**。
- 业务/契约实现 **`008455bbab20f85f6348cf54a40b7e23512eec90`**；HTTP 验证脚本修正 **`68b2eea712302776fee167fd06314983d8edb23d`**。后者只改验证脚本，不改变运行源码；实际 dist 来自前者。最后文档提交的精确 SHA 随 worker_done 提供。
- 实测 API **http://192.168.0.200:4156/api/v1**；仅 test PG55437 增加第43迁移 `20261109000300_mbti_f6_radar_candidate`。owner 为 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`，使用 `MBTI_LOCAL_OWNER_ROOT` 核验同仓 Git、容器、marker、database/user/port 后操作。
- 本树独立 pnpm 依赖、Prisma client、workspace 包、dist、随机 F3 test fixture；没有链接/复制另一树依赖或 fixture。只使用本轮新合成 cohort 写测试，未写原 F5 有效 grant、旧主体/渠道/关系、运营身份、Auth/RBAC 或账本实现。
- 没有改 `web/`、`UIhtml/`、权威 `docs/api/`，未 push/merge/main；4056、5173、dev迁移/运营初始化均未操作。F5 私密 namespace/epoch 授权与 F4 sender 隐私检查源码保持原样。

## 候选契约和实现

[运行 OpenAPI](../integration/MBTI-F6-runtime-candidate.openapi.yaml) 与 [无个人数据形状样例](../integration/MBTI-F6-runtime-candidate.examples.json) 已先交总控供 Web 核对。固定 PR20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f` 仅只读其 radar/types-social/雷达页面消费，未整合旧 PR；只读准备候选记录保留不改。

独立 `MbtiRadarController/Service` 注册到现有模块，复用 GuestGuard、MBTI_RAW、MbtiErrorFilter、Prisma、16型枚举及 `social.lockOwners`。新 `MbtiRadarParticipation` 仅 ownerId 唯一 FK、enrolled、createdAt/updatedAt，不复制 type/block/contact，不存位置。缺记录只投影 false；两个 GET 不懒建名片或参与行。

PUT 仅一个必填 boolean enrolled，无 query，未知身份/类型/位置/半径字段422。true 必须有本人已存合法名片类型，私密名片也可参与；false 不依赖类型/名片。与 F4 名片更新及 F5 共用 owner 事务锁，返回提交后的事实；同值保留原行和时间。不会更改公开状态、四 visibility、联系方式或历史结果，参与选择不等于位置授权。

#46 按 guard → wire query 白名单/重复/半径/类型枚举 → 本人已存合法名片类型 → query 一致 → 本人参与 → 能力的顺序。wire query 直接解析以拒绝 Express 可能丢弃的特殊键。type_code 可省略，否则精确大写且须等于本人；radius_m 仅单个精确字符串500/1000/3000，省略500。未参与为 `{count:null,status:"unavailable",reason:"not_enrolled"}`；已参与为同形状、reason=`location_source_not_configured`。没有 aggregate/COUNT/cohort 查询、数字、low_sample、available 或假数据源开关；不返回个人名单、位置、联系方式或其他 owner。基础设施异常继续失败，未吞为 unavailable；单元测试验证三个入口 DB/事务错误原样传播。

新 status/reason/错误码、三档半径、参与模型/留存策略均待人工审核。没有确认 k=10；未新增 GPS/IP 定位、坐标采集或供应商调用。

## 实际 HTTP 证据与逐项矩阵

本树 `aij-foundation/.artifacts/mbti-f6-prepare-evidence.json` 为最终 prepare 去敏证据，revision=`68b2eea712302776fee167fd06314983d8edb23d`；仅状态、路由模板、错误码、布尔断言，无凭证/owner ID/联系方式/内部存储值。原 token/同值比较样本只存在 ignored0600 `mbti-f6-http-state.json`。没有提交日志、依赖、构建、原始响应或临时产物。

最终 prepare **171真实HTTP / 451断言 / 退出0**：201×9、200×83、422×57、400×6、204×2、401×12、404×2。CORS 三个 OPTIONS 另计为布尔断言，不混入171。所有雷达成功和错误响应均 no-store，业务对象/错误精确字段白名单排除了个人数据。

| 项 | 状态 | 真实证据 |
| --- | --- | --- |
| #44 GET /radar/participation | 通过 | P001–006全新A/B/C独立身份默认200 false，DB辅助读证明没有卡/参与行；P024/037/038/169–171验证他人不受影响，缺行C始终不落库；P062/064/066/068/070/072未知/重复/特殊query422，P136/139/142/145缺失/随机/格式/过期凭证401 |
| #45 PUT /radar/participation | 通过 | P007/010无卡true422、P008/011 false200；P016空类型true422而P017 false200；P020/023合法私密名片true200，卡/visibility/历史/联系人元数据不变；P025–032八个并发同值200，一行且时间不变；P033–036有序false→并发true/false→GET false；P039–055未知/伪身份/位置/非boolean/缺键422；P056–061 strict JSON400；P063/065/067/069/071/073无query422；P137/140/143/146凭证401 |
| #46 GET /radar/same-type unavailable | 通过 | P014即使query/最新结果合法、无名片仍TYPE_REQUIRED且不懒建；P074–094 query/半径/数组/重复/类型枚举422先于缺类型；P095缺类型优先、P096本人不一致优先；P097–108省略/三档/本人类型均200 null+unavailable，A来源未配置/B未参与；P109–112本人type变更后旧query422，新type/省略正常；P138/141/144/147凭证401 |
| 参与/退出/两方向block/半径组合的不可用与隐私 | 通过（仅fallback） | P113–132本轮合成A→B、B→A block与解除、参与true/false及三档，全部仍只有null/unavailable和正确reason；没有把此证据称为真实聚合过滤通过 |
| F4/F5 注册与读取回归 | 通过 | P148–168独立新X/Y cohort建立真实F4 accepted和F5单向微信grant；X参与/退出后exact grant仍200，Y/C404，Y私密引用/epoch/时间不变，F4 accepted及F5列表仍可读；所有值仅私有状态内比较。另跑现有F4 sender隐私回归55HTTP/23断言通过，缺卡/空类型/私密发起404且无新pending |
| #44/#45 原身份重启持久化 | 通过 | 总控msg_39474dea63f7确认Web暂停、三profile in-flight=0后，owner check/stop/start均0，同008455bb dist READY；R001–003复用原A/B/C凭证读回true/false/false，A/B原卡/历史/联系人元数据同值，C仍无卡/无参与行；R004/005维持正确unavailable，R006–011本轮X/Y单向grant200、Y/C404、私密本人值同值，F4 accepted及F5 accepted列表保留；最终只读restart阶段11HTTP/30断言/退出0 |
| 真实参与/退出人数影响 | blocked_external / not_available | 缺自愿位置cohort、位置授权与实际计算政策；布尔持久化不是人数变化证据 |
| 真实半径/边界、双向block在聚合计数前过滤 | blocked_external / not_available | 缺位置来源、可用距离算法、中心/精度/时效/边界；F4 block回归与null响应不代替计数过滤 |
| 真实小样本/位置授权撤回 | blocked_external / not_available | 缺经确认k与隐私/差分口径、位置授权/撤回数据；low_sample/available分支未启用 |

## 命令与真实退出码

以下项目命令均在本树 `aij-foundation` 运行；所有 test DB 脚本带 `MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 0，800包，本树独立依赖；包原有deprecation/build-script提示未升级处理 |
| `pnpm --filter @aij/api prisma:generate` | 0，本树Prisma6.19.3 |
| `pnpm --filter @aij/contracts --filter @aij/core --filter @aij/runtime-contracts build` | 0 |
| `pnpm --filter @aij/api typecheck` | 0，源码及test tsc |
| `pnpm --filter @aij/api build` | 0，本树dist，业务源码008455b |
| `pnpm --filter @aij/api prisma:validate` | 0，不连库schema校验 |
| `pnpm lint` | 0，完整Foundation apps/scripts；脚本修正后也重跑0 |
| `pnpm --filter @aij/api test` | 0，83/83，含79既有测试和4个F6关键单元测试 |
| `node scripts/mbti-local.mjs check test` | 0，归属/55437核验 |
| `node scripts/mbti/seed-f3-test.mjs` | 0，本树新随机0600 fixture，未复制旧身份配置 |
| `node scripts/mbti-local.mjs migrate test` | 0，仅新增F6附加表，43总迁移 |
| `node scripts/mbti-local.mjs stop test` / `start test` | 各0，授权首接管窗口，READY4156；启动设置MBTI_F3_TEST_FIXTURE=1、LAN公共源及精确两4155 CORS源 |
| `node scripts/mbti/verify-f6.mjs prepare` | 最终0，171/451；见下述验证脚本初轮失败记录 |
| `node scripts/mbti-local.mjs check test` / `stop test` / `start test`（最终窗口） | 各0，同dist/test配置，READY4156，未操作Web主体 |
| `node scripts/mbti/verify-f6.mjs restart` | 0，最终只读11HTTP/30断言；R001–011，持久化参与/退出与F4/F5读取通过 |
| `node scripts/mbti/verify-f4-sender-visibility.mjs` | 0，55HTTP/23断言 |
| `python3 <输入包>/smoke.py --base http://192.168.0.200:4156/api/v1 --phase F2` | 0，含F1；qb-v0.4-prototype-1；A两结果ae9657e3-e2c7-4b2f-abf2-ba66d90386b3 / 82427834-a3ae-44e5-8e52-b3baa8ddd4c5，B404、submit201/409、分享/比较/删除通过 |
| Python去敏扫描、`git diff --check`、精确路径暂存检查 | 0；无token、owner ID、合成渠道值或私密引用输出/提交 |

初轮HTTP验证脚本两次退出1：测试持有外部owner锁后错误等待两个DB事务同时排队，但宿主Prisma固定connection_limit=1，第二请求实际排队于guard；过长持锁导致第一事务500（未被伪装unavailable）。已改为确认第一请求等待owner锁后发第二请求、释放外部锁，按单连接真实队列验证先true提交、后false提交及最终GET，保持所有业务代码不变；最终脚本提交后重新完整prepare通过。初轮失败状态/凭证只在ignored0600中，不把它计为通过。没有为故障重启服务或修改宿主连接池。

一次API测试日志重定向在`.artifacts`目录尚不存在时退出1（测试未启动），创建ignored目录后83项全过；一次脚本在仓根误调用退出1（未访问HTTP），纠正到Foundation目录后执行。Orca首次发候选消息使用不支持的type=message、一次check误用--from，均退出1；按本机帮助更正type=status/--terminal后成功。现有AppleDouble pack索引告警未修复/删除共享Git对象，所有固定引用、提交和路径核查退出0。

## test恢复和后续输入

首接管及最终重启均已READY通知总控（最终msg_d5a12cac1fe1）；最终窗口授权msg_39474dea63f7后只执行一次stop/start。最初只读restart阶段9HTTP/26断言通过，随后补两条F4/F5列表读取，最终11HTTP/30断言通过；期间未再重启、写cohort或操作Web主体。去敏重启证据在本树`aij-foundation/.artifacts/mbti-f6-restart-evidence.json`，原凭证仍ignored0600；正式运行dist与配置不变。服务最终保留4156，之后恢复仍须新明确窗口，只适用test，不适用4056/dev；不需要清库、改原值、重跑运营初始化或复制别树fixture。

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-f6/aij-foundation
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
export MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4156
export MBTI_H5_ORIGINS='["http://127.0.0.1:4155","http://192.168.0.200:4155"]'
export MBTI_F3_TEST_FIXTURE=1
node scripts/mbti-local.mjs check test
# 只在总控明确短窗口内，按顺序：
node scripts/mbti-local.mjs stop test
node scripts/mbti-local.mjs start test
node scripts/mbti/verify-f6.mjs restart
```

新checkout须先独立install、Prisma generate、workspace/API build，owner check后迁移test及生成自己的F3 fixture。旧F5私密namespace保持本轮兼容布局，不运行重复重填/清除或存储搬迁。

真实聚合恢复需要业务提供自愿位置来源owner/接口/合法授权、身份关联、粗粒度精度与时效/撤回、距离算法和半径中心/边界/误差、确认k与本人/零人/差分政策，再由后续评审设计和测试；没有当前可启用命令或假数据开关。未测真实人数、位置授权撤回、生产多实例压力、另一物理设备、微信浏览器；未重复无变化的完整F3支付或所有F4/F5大矩阵，新增模块注册与关键读取/隐私回归如上。本Worker未改Web或执行GUI，也不以Web独立GUI尚未报告为由推迟后端候选文档。
