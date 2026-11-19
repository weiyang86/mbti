# MBTI Ops V1 — 最终链路对账与遗留清单

2026-11-10（北京时间）。**本次对账与文档交付完成；V1 全量端到端验收未通过，状态 BLOCKED / NOT_RUN。** 本地候选可编译和组件/隔离 HTTP 验证已通过；真实四角色、同一公网开发库订单、三消费者跨浏览器生效及重启/历史数据验收仍缺证据。未更改应用/API、匿名硬闸、真实 DB/用户/订单、部署或 main。

## 1. 现场基线与证据口径

| 项目 | 本次实际值 |
| --- | --- |
| 工作目录 / 分支 | `/Volumes/Lexar/日常工作/2026/mbti/demo/mbti` / `dev`；未切分支/工作树 |
| 开工及代码核验完整 HEAD | `e3ffe8dea72b68e8cb6b436f047943e7ea1e9ef4`（C2） |
| 已包含祖先 | `dfc0cbe07a9e7a136d6b9ce110b7940ca4d5ada3`（关系白名单修正）、`8b582f8a1b497fc088483eb0f92654459110d7fc`（C1）；两次 merge-base 检查 exit 0 |
| Run / Task / Dispatch | `run_801f9322af2e` / `task_467fd6a4e5cc` / `ctx_ebd5badc6334` |
| Worker / coordinator | `term_8d5dadfc-4554-4af8-8264-6a7ceab0e438` / `term_0b8ce4f4-cc76-4fb0-aa3d-4b572eea6de1` |
| 输入 | [V1 卡](../../orca-inputs/MBTI-Orca-20261109/cards/V1.md)、[RUNBOOK](../../orca-inputs/MBTI-Orca-20261109/RUNBOOK.md)、[原53项](../../orca-inputs/MBTI-WebAPI-Fastlane/API-REVIEW.md)、[原14页42组](../../orca-inputs/MBTI-Orca-20261109/ADMIN-COVERAGE.md)；输入包未跟踪，接手时需保留 |
| 本次提交范围 | 本文及 [覆盖表](MBTI-ADMIN-COVERAGE.md) 的现状/路径纠错；文档提交完整 SHA 由 worker_done 回报，亦可 `git log -1 --format=%H -- docs/execution/MBTI-OPS-V1-DELIVERY.md` 取得 |

`ready` 是公共参考的可联调标签；“既有开发验收已验”只引用原 F1–F6 的真实授权开发环境回执，不表示本次重跑或当前公网全量通过。`LOCAL_UI_TESTED` 是本机组件/纯函数/合成响应；`API_CONSUMER_TESTED` 是客户端接线加本机配置 owner/HTTP fixture，不能升格为真实账号、数据库或公开部署验收。`UI_CONTRACT` 为尚缺业务接线；`BLOCKED / NOT_RUN` 为现场依赖不足且没有执行；`needs_human_review` 为待导师定稿。

真实 HTTP fixture 确实经过本机 Nest 路由及生产权限/配置/lifecycle owner，但认证 transport、ProjectProfile/权限数据及事务存储为替身。它与合成 fetch、Guard 源元数据、隔离截图和构建分别记录；这些不能证明真实 JWT/Cookie/CSRF 或 PostgreSQL 行锁。连接失败 HTTP 000、缺路由404、SPA首页200也不算401/403授权证据。

## 2. 公共41项、原53项与旧37项的独立对账

已读取 [参考说明](../api-reference/README.md)、[操作生成器](../api-reference/reference.mjs)、[构建器](../api-reference/build.mjs)、[汇总 JSON](../api-reference/openapi.json)、五份候选来源和 [当前 Fast Handoff](MBTI-WEB-API-FAST-HANDOFF.md)。独立 Python 检查按原表数字 ID、operationId、方法+参数名归一化路径逐项比较：原表1–53无缺号；参考41个唯一 ID/operationId/方法路径完全匹配；差集恰为下列12项，无额外端点。生成器/产物 check 同时通过，不能只从页面“41”文案推断。

| 计数 | 实际对账 |
| --- | --- |
| F1/F2/F3/F4/F5/F6 | 8 + 5 + 5 + 12 + 8 + 3 = **41** |
| 状态 | **40 ready / 既有开发验收已验 + 1 unavailable（#46，仅不可用分支已验）** |
| 原始53 | **40 + 1 + 12 deferred = 53** |
| V1旧12+25口径 | W01–W12 + X01–X25 = 37，其中含 #46；另补 #2、#47、#49、#53 四项后才是41。旧37不是本次分母 |
| 契约层级 | 全部仍 candidate / needs_human_review；不修改根 `docs/api/` 权威草案，不将配置/lifecycle或资产附属路由计入41 |

下表前缀统一为 `/api/v1`；每行状态有对应批次证据。**本次仅做只读对账，未新建游客、订单或重跑 smoke。**

| 原序号 | 旧消费编号 | operationId | 方法/路径 | 原实测证据 | 公共参考状态 / 可证明范围 |
| --- | --- | --- | --- | --- | --- |
| 1 | W01 | `mbti_1_get` | `GET /health` | [F1](MBTI-WEB-API-F1-DELIVERY.md) | ready；既有开发验收已验 |
| 2 | 新增 | `mbti_2_post` | `POST /auth/guest` | [F1](MBTI-WEB-API-F1-DELIVERY.md) | ready；既有开发验收已验 |
| 4 | W02 | `mbti_4_get` | `GET /quiz/versions/current` | [F1](MBTI-WEB-API-F1-DELIVERY.md) | ready；既有开发验收已验 |
| 5 | W03 | `mbti_5_post` | `POST /quiz/sessions` | [F1](MBTI-WEB-API-F1-DELIVERY.md) | ready；既有开发验收已验 |
| 6 | W04 | `mbti_6_put` | `PUT /quiz/sessions/{session_id}/answers` | [F1](MBTI-WEB-API-F1-DELIVERY.md) | ready；既有开发验收已验 |
| 7 | W05 | `mbti_7_post` | `POST /quiz/sessions/{session_id}/submit` | [F1](MBTI-WEB-API-F1-DELIVERY.md) | ready；既有开发验收已验 |
| 8 | W06 | `mbti_8_get` | `GET /results` | [F1](MBTI-WEB-API-F1-DELIVERY.md) | ready；既有开发验收已验 |
| 9 | W09 | `mbti_9_get` | `GET /results/{id}` | [F1](MBTI-WEB-API-F1-DELIVERY.md) | ready；既有开发验收已验 |
| 10 | W10 | `mbti_10_delete` | `DELETE /results/{id}` | [F2](MBTI-WEB-API-F2-DELIVERY.md) | ready；既有开发验收已验 |
| 11 | W08 | `mbti_11_get` | `GET /results/compare` | [F2](MBTI-WEB-API-F2-DELIVERY.md) | ready；既有开发验收已验 |
| 12 | W07 | `mbti_12_post` | `POST /results` | [F2](MBTI-WEB-API-F2-DELIVERY.md) | ready；既有开发验收已验 |
| 14 | W11 | `mbti_14_get` | `GET /types` | [F2](MBTI-WEB-API-F2-DELIVERY.md) | ready；既有开发验收已验 |
| 17 | W12 | `mbti_17_post` | `POST /share/preview` | [F2](MBTI-WEB-API-F2-DELIVERY.md) | ready；既有开发验收已验 |
| 24 | X01 | `mbti_24_get` | `GET /cards/me` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 25 | X02 | `mbti_25_put` | `PUT /cards/me` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 26 | X03 | `mbti_26_get` | `GET /cards/{card_id}` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 27 | X04 | `mbti_27_get` | `GET /buddies` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 28 | X08 | `mbti_28_get` | `GET /buddies/blocked` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 29 | X05 | `mbti_29_get` | `GET /buddies/{id}` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 30 | X06 | `mbti_30_post` | `POST /buddies/{id}/block` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 31 | X07 | `mbti_31_delete` | `DELETE /buddies/{id}/block` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 32 | X09 | `mbti_32_get` | `GET /card-exchanges` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 33 | X10 | `mbti_33_post` | `POST /card-exchanges` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 34 | X11 | `mbti_34_post` | `POST /card-exchanges/{id}/respond` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 35 | X12 | `mbti_35_delete` | `DELETE /card-exchanges/{id}` | [F4](MBTI-WEB-API-F4-DELIVERY.md) | ready；既有开发验收已验 |
| 36 | X13 | `mbti_36_get` | `GET /contacts/me` | [F5](MBTI-WEB-API-F5-DELIVERY.md) | ready；既有开发验收已验 |
| 37 | X14 | `mbti_37_put` | `PUT /contacts/me` | [F5](MBTI-WEB-API-F5-DELIVERY.md) | ready；既有开发验收已验 |
| 38 | X15 | `mbti_38_delete` | `DELETE /contacts/me` | [F5](MBTI-WEB-API-F5-DELIVERY.md) | ready；既有开发验收已验 |
| 39 | X16 | `mbti_39_get` | `GET /contact-requests` | [F5](MBTI-WEB-API-F5-DELIVERY.md) | ready；既有开发验收已验 |
| 40 | X17 | `mbti_40_post` | `POST /contact-requests` | [F5](MBTI-WEB-API-F5-DELIVERY.md) | ready；既有开发验收已验 |
| 41 | X18 | `mbti_41_post` | `POST /contact-requests/{id}/respond` | [F5](MBTI-WEB-API-F5-DELIVERY.md) | ready；既有开发验收已验 |
| 42 | X19 | `mbti_42_delete` | `DELETE /contact-requests/{id}` | [F5](MBTI-WEB-API-F5-DELIVERY.md) | ready；既有开发验收已验 |
| 43 | X20 | `mbti_43_get` | `GET /contact-requests/{id}/granted` | [F5](MBTI-WEB-API-F5-DELIVERY.md) | ready；既有开发验收已验 |
| 44 | X21 | `mbti_44_get` | `GET /radar/participation` | [F6](MBTI-WEB-API-F6-DELIVERY.md) | ready；既有开发验收已验 |
| 45 | X22 | `mbti_45_put` | `PUT /radar/participation` | [F6](MBTI-WEB-API-F6-DELIVERY.md) | ready；既有开发验收已验 |
| 46 | X23 | `mbti_46_get` | `GET /radar/same-type` | [F6](MBTI-WEB-API-F6-DELIVERY.md) | unavailable；仅不可用分支已验 |
| 47 | 新增 | `mbti_47_get` | `GET /products` | [F3](MBTI-WEB-API-F3-DELIVERY.md) | ready；既有开发验收已验 |
| 48 | X24 | `mbti_48_post` | `POST /orders` | [F3](MBTI-WEB-API-F3-DELIVERY.md) | ready；既有开发验收已验 |
| 49 | 新增 | `mbti_49_get` | `GET /orders` | [F3](MBTI-WEB-API-F3-DELIVERY.md) | ready；既有开发验收已验 |
| 50 | X25 | `mbti_50_get` | `GET /orders/{id}` | [F3](MBTI-WEB-API-F3-DELIVERY.md) | ready；既有开发验收已验 |
| 53 | 新增 | `mbti_53_get` | `GET /entitlements/me` | [F3](MBTI-WEB-API-F3-DELIVERY.md) | ready；既有开发验收已验 |

12项条件延期逐号保留；未纳入公共参考，也没有因通用 Foundation 能力、B4离线合成或B5回调模拟而自动实现。

| 原序号 | 原提议方法/路径（同前缀） | 状态 | 依赖与下一动作 / owner |
| --- | --- | --- | --- |
| 3 | `POST /auth/wechat` | deferred / NOT_RUN | Remy+微信接入 owner 确认小程序 code2session、H5网页授权、游客绑定/订单归属、平台配置与真实设备；游客不是可找回账号 |
| 13 | `GET /results/{id}/answers` | deferred / needs_human_review | Remy 确认跨设备回放需求、本人读取、删除与留存；本机作答缓存不能当服务器回放 |
| 15 | `GET /profile/me` | deferred / needs_human_review | Remy 确认私密资料与公开名片 owner/投影；现有名片不等于通用 profile |
| 16 | `PUT /profile/me` | deferred / needs_human_review | 与15成对；明确当前资料修改不回写历史阶段/结果、不扩大公开范围 |
| 18 | `GET /share/jobs/{job_id}` | deferred / NOT_RUN | 仅分享需要异步时由后端接任务设施/本人权限；当前17同步真实图片，不需要假轮询 |
| 19 | `POST /visual/tasks` | deferred / BLOCKED | 产品/后端先定 SKU、权益、真实供应方、创建幂等与费用；B4本机合成不算真实任务 |
| 20 | `GET /visual/tasks/{task_id}` | deferred / BLOCKED | 与19成对，定义排队/运行/失败/产物与重试；缺持久任务/真实交付 |
| 21 | `POST /uploads` | deferred / BLOCKED | 照片形象需私有上传、类型大小/所有权/保留删除；本机 File/画布没有上传 |
| 22 | `POST /video/storyboards` | deferred / needs_human_review | Remy 先定15秒分镜卖点、结构/时长/真实生成；不承诺视频 |
| 23 | `GET /video/storyboards/{id}` | deferred / NOT_RUN | 与22成对，明确同步/异步、内容就绪/失败、本人重读；无任务不造状态 |
| 51 | `POST /orders/{id}/refund` | deferred / BLOCKED | 支付/售后 owner 定可退条件、身份、人工处理/回调和到账事实；申请不等于退款到账 |
| 52 | `POST /redeem-codes` | deferred / needs_human_review | Remy 区分用户核销与后台制码、次数/并发占用/权益种类；B2a制码入口仍禁用 |

### 既有 F1–F6 证据保留范围

| 已验范围 | 可复核路径与限制 |
| --- | --- |
| F1 八项 | [F1交付](MBTI-WEB-API-F1-DELIVERY.md)、[QA](MBTI-WEB-API-F1-QA.md)：独立游客、冻结12题、两次结果、A/B隔离、并发201/409、原身份草稿/结果跨API重启；这是旧LAN环境 |
| F2 五项 | [F2交付](MBTI-WEB-API-F2-DELIVERY.md)、[后端](MBTI-WEB-API-F2-BACKEND-DELIVERY.md)：本人对比/不可比422、自选、删除204与失效、真实安全图片；公网F1/F2专项另见[域名交付](MBTI-DOMAIN-ACCESS-DELIVERY.md) |
| F3 五项 | [F3交付](MBTI-WEB-API-F3-DELIVERY.md)、[同库同单HTTP](MBTI-F3-DEV-SAME-ORDER-HTTP.json)：旧LAN H5两次201同单、本人200、真实运营同号200/匿名游客401/无权限管理员403/他人订单404及重启；受控test回调另在test-only环境，dev保持支付unconfigured |
| F4 十二项 | [F4交付](MBTI-WEB-API-F4-DELIVERY.md)、[开发H5证据](MBTI-F4-DEV-H5-EVIDENCE.json)：三独立profile的公开字段/屏蔽/交换与原身份重启；JSON outcome=passed、17步、dev_reboot_passed=true |
| F5 八项 | [F5交付](MBTI-WEB-API-F5-DELIVERY.md)、[开发H5证据](MBTI-F5-DEV-H5-EVIDENCE.json)、[后端HTTP证据](MBTI-F5-HTTP-EVIDENCE.json)：明确单向渠道、批准前/第三人/撤回后404、清除重填/屏蔽不复活及原值重启；JSON outcome=passed、15步，不复制任何私密原值 |
| F6 两项+不可用分支 | [F6交付](MBTI-WEB-API-F6-DELIVERY.md)、[开发H5证据](MBTI-F6-DEV-H5-EVIDENCE.json)：显式加入退出、三半径仍count:null/unavailable、严格422/401和原身份重启；JSON outcome=passed、18步，真实聚合blocked_external |

只引用这些已有 verified 范围，不重复设计/扩展业务。旧 F3 的真实运营 HTTP 成功不等于 B2a 当前运营 Vue 页面或公网同单验收；[迟到工具核对](MBTI-F3-LATE-TOOLING-RECONCILIATION.md) 已说明保留唯一原工具入口，不采纳另一套初始化。

## 3. 14页 / 42动作组逐行对账

[原覆盖表](../../orca-inputs/MBTI-Orca-20261109/ADMIN-COVERAGE.md)与[当前覆盖表](MBTI-ADMIN-COVERAGE.md)的 ID 集合一致：14页按01–14原序，分组数 **4/3/5/2/4/3/2/3/2/2/2/4/2/4 = 42**。没有把页面标题、按钮存在或截图当成整组业务通过。

19组涉及 C2 上方候选面板（11个真正类别，含复用类别与4组release生命周期视图）；其余23组仍为本地交互/未接业务范围，含旧预览与B2a部分详情。19不是19个完整业务验收通过。**本轮 B1–C2 当前真实授权服务的整组验收为0/42；42组现场均 BLOCKED / NOT_RUN**。表中本地列是已测子集，不表示复合组所有按钮都已实现。

证据：B1 [会话/角色外壳](MBTI-ADMIN-B1-DELIVERY.md)；B2a [订单13项阶段测试](MBTI-ADMIN-B2-ORDERS-DELIVERY.md)；B2b [三页5项新增测试](MBTI-ADMIN-B2-WORKSPACE-DELIVERY.md)；B3 [13项新增](MBTI-ADMIN-B3-DELIVERY.md)；B4 [15项新增](MBTI-ADMIN-B4-DELIVERY.md)；B5 [11项新增](MBTI-ADMIN-B5-DELIVERY.md)；C2 [5项新增](MBTI-ADMIN-C2-DELIVERY.md)，当前累计admin62项。本地列均为 `LOCAL_UI_TESTED`；C2列为 `API_CONSUMER_TESTED` 的限定范围。

“C2 本地 owner/HTTP 套件”指真实生产 schema/service/lifecycle + 事务存储替身。HTTP套件实际主要覆盖content读写/发布、trade越权、历史/回滚/停用/公开拒绝，**并非每一行全部类别/按钮都发过 HTTP**；11类shape通过另由直接owner测试覆盖。admin面板的组件/API adapter测试本身使用合成响应，不是浏览器连到Nest fixture的端到端测试。

| 组 | 页面与原型动作 | 本地已测子集（LOCAL_UI_TESTED） | API / HTTP 的实际等级 | 真实授权服务/浏览器 | 尚缺的精确动作/来源 |
| --- | --- | --- | --- | --- | --- |
| UI-01.1 | `#/overview` · 日期/渠道/周期 | B2b 日期与筛选组件 | UI_CONTRACT：无统计查询 | BLOCKED / NOT_RUN | 聚合/渠道来源与日期口径 |
| UI-01.2 | `#/overview` · 趋势指标/口径 | B2b 选项/抽屉，值为 — | UI_CONTRACT：无经营聚合 | BLOCKED / NOT_RUN | 净实收/退款/访问事实与复算 |
| UI-01.3 | `#/overview` · 待办/队列/模板跳转 | B2b 导航及禁用 | UI_CONTRACT：无队列/模板排名 | BLOCKED / NOT_RUN | 真实异常/举报/配置待办来源 |
| UI-01.4 | `#/overview` · CSV 导出 | B2b 能力 true/false 均禁用 | UI_CONTRACT：无导出请求 | BLOCKED / NOT_RUN | 同筛选导出与服务端 export 权限 |
| UI-02.1 | `#/growth` · 渠道/测评/传播 | B2b 分区/渠道过滤/局部横滚 | UI_CONTRACT：无报表查询 | BLOCKED / NOT_RUN | 持久事件/渠道归因/完成队列 |
| UI-02.2 | `#/growth` · 7日付费率/口径 | B2b 成熟窗说明 | UI_CONTRACT：无 cohort 查询 | BLOCKED / NOT_RUN | 首看去重/支付关联/成熟截止 |
| UI-02.3 | `#/growth` · 导出渠道表 | B2b 导出禁用 | UI_CONTRACT：无 CSV | BLOCKED / NOT_RUN | 同筛选查询/导出与真实拒绝 |
| UI-03.1 | `#/orders` · 交易订单/搜索/筛选/分页/导出/详情 | B2a 按号、投影、迟到/错误清除；其他禁用 | 按号 GET 客户端；合成 HTTP+Guard 元数据；旧 F3 有真实运营 HTTP，非此 UI | BLOCKED / NOT_RUN | 当前公网同 H5 单/四角色未完成；列表/分页/导出 UI_CONTRACT |
| UI-03.2 | `#/orders` · 生成任务/异常/重试/恢复 | B2a 标签/禁用 | UI_CONTRACT：无任务/重试 | BLOCKED / NOT_RUN | 持久任务/幂等/审计/恢复范围 |
| UI-03.3 | `#/orders` · 退款原因/确认 | B2a 详情退款禁用 | UI_CONTRACT：无退款写入 | BLOCKED / NOT_RUN | 退款条件/处理方/到账/审计 |
| UI-03.4 | `#/orders` · 体验码批次/套装/停用 | B2a 标签/禁用 | UI_CONTRACT：无制码/停用 | BLOCKED / NOT_RUN | 来源隔离账本/并发核销/权限 |
| UI-03.5 | `#/orders` · 本机前台订单/刷新/处理 | B2a 入口/禁用 | UI_CONTRACT：无本机测试账本 | BLOCKED / NOT_RUN | 不得以独立公网 guest/库替代本机来源 |
| UI-04.1 | `#/moderation` · 互换/联系授权/待处理统计 | B2b 空态/筛选 | UI_CONTRACT：无管理汇总 | BLOCKED / NOT_RUN | 匿名汇总/工单模型/只读权限 |
| UI-04.2 | `#/moderation` · 查看处理/记录/驳回限制 | B2b 说明抽屉/焦点/处置禁用 | UI_CONTRACT：无处置 API | BLOCKED / NOT_RUN | 原子处置/重复幂等/审计/权限 |
| UI-05.1 | `#/ai` · 两图/人格配方/明确同意 | B4 两槽/清理/过期屏障；仅本机 | UI_CONTRACT：无真实上传 HTTP | BLOCKED / NOT_RUN | 上传所有权/保留删除/真实试跑权限 |
| UI-05.2 | `#/ai` · 离线试片/失败/网关/保存 | B4 core+画布、第二图因果、重试；真实保存禁用 | UI_CONTRACT：进程内 Response 非 HTTP | BLOCKED / NOT_RUN | 真实模型 health/generate/费用/资产/持久幂等 |
| UI-05.3 | `#/ai` · 配方编辑/参考/恢复/带入 | B4 内存；C2 通用面板组件 | C2 imageRecipes（仅 recipe）；本地 owner/HTTP 套件 | BLOCKED / NOT_RUN | 图片/参考资产/试片保存仍 UI_CONTRACT |
| UI-05.4 | `#/ai` · 调用记录/手机效果 | B4 白名单内存记录/离页清理 | UI_CONTRACT：无服务端模型记录 | BLOCKED / NOT_RUN | 真实任务审计/资产；无原图/提示词记录 |
| UI-06.1 | `#/content` · 首页/场景编辑 | B3 内存预览；C2 通用面板 | C2 content；本地 owner/HTTP 套件 | BLOCKED / NOT_RUN | 安全用户投影审批与实际生效 |
| UI-06.2 | `#/content` · 四渠道入口/模拟进入 | B3 渠道隔离；C2 通用面板 | C2 channels；本地 owner/HTTP 套件 | BLOCKED / NOT_RUN | 四正式渠道归属/投影审批 |
| UI-06.3 | `#/content` · 手机/付费预览 | B3 草稿/参考/不可得线上分离 | 原型预览仍 unavailable；上方 C2 有 published read | BLOCKED / NOT_RUN | 不将参考/内存图当线上；匿名硬关闭 |
| UI-07.1 | `#/catalog` · 套装改名/价格/权益/上下架/预览 | B3 价格/最后上架等本地约束；C2 面板 | C2 catalog 完整类别含 shop+styles；非 PATCH shop | BLOCKED / NOT_RUN | 真实商品 ID/结算/权益/快照映射待人审 |
| UI-07.2 | `#/catalog` · 模板素材/启停/排序/预览 | B3 内置素材/排序；C2 面板 | C2 catalog 完整类别；非 PATCH styles | BLOCKED / NOT_RUN | 真实资产上传与授权仍 UI_CONTRACT |
| UI-08.1 | `#/assessment` · 题库过滤/题干选项/方向 | B3 12题/映射校验；C2 面板 | C2 assessment；不写业务题库 | BLOCKED / NOT_RUN | 不可变题库 owner/配置到 bankVersion 映射 |
| UI-08.2 | `#/assessment` · 12题试算 | B3 golden ESTJ/INFP、反向/非法答案 | 纯函数，无 session/result/HTTP | BLOCKED / NOT_RUN | 仅本地试算；不声明用户历史已验 |
| UI-08.3 | `#/assessment` · 人格筛选/编辑/手机预览 | B3 16型/编辑预览；C2 面板 | C2 personas；本地 owner/HTTP 套件 | BLOCKED / NOT_RUN | 历史结果/正式 ID 映射待审 |
| UI-09.1 | `#/retention` · 阶段标签/快捷天数/预览 | B4 tags/days 校验；C2 面板 | C2 retention；不创建提醒/阶段记录 | BLOCKED / NOT_RUN | 用户选择/提醒渠道/消息执行仍 UI_CONTRACT |
| UI-09.2 | `#/retention` · 成熟队列/同版复测/对比 | B4 44/45/51/52边界，指标 — | UI_CONTRACT：无 cohort/事件 | BLOCKED / NOT_RUN | 同版关联/成熟分母/时间渠道/对比事件 |
| UI-10.1 | `#/social` · 推荐/申请上限/预览 | B4 匿名占位与范围；C2 面板 | C2 discovery；不改变真实推荐/限额 | BLOCKED / NOT_RUN | 服务端排序/每日限额/申请执行 |
| UI-10.2 | `#/social` · 雷达开关/半径/阈值/预览 | B4 条件样例；C2 面板 | C2 discovery；真实 #46 仍 unavailable | BLOCKED / NOT_RUN | 自愿位置/撤回/阈值披露/服务端聚合 |
| UI-11.1 | `#/ai-settings` · 模式/模型/网关/画幅/超时/指令 | B5 本地参数/真实字段禁用；C2 面板 | C2 aiRuntime 仅 UNCONFIGURED/size/timeout；引用不返回 | BLOCKED / NOT_RUN | 真实 provider/model/gateway/prompt 未获批；系统类禁止公开 |
| UI-11.2 | `#/ai-settings` · 连接检查/保存/双图/说明 | B5 格式检查/说明导航；C2 面板 | C2 aiRuntime 候选保存；真实连接/下载未接 | BLOCKED / NOT_RUN | 实际网关 health/权限/费用未验 |
| UI-12.1 | `#/payment-settings` · 四通道/未保存/草稿 | B5 渠道切换保护；C2 面板 | C2 payments 仅 enabled=false/mode=UNCONFIGURED/展示名 | BLOCKED / NOT_RUN | 真实收款不能启用；系统类禁止公开 |
| UI-12.2 | `#/payment-settings` · 商户/回调/凭据引用 | B5 禁用字段族/无引用输入 | UI_CONTRACT：未读真实商户/凭据 | BLOCKED / NOT_RUN | 获批渠道凭据族/安全领取/受限投影 |
| UI-12.3 | `#/payment-settings` · 检查参数/收银预览/状态 | B5 格式/匿名排版；真实保存禁用 | UI_CONTRACT：无商户/沙箱连接 | BLOCKED / NOT_RUN | 格式通过不代表商户/回调就绪 |
| UI-12.4 | `#/payment-settings` · 成功/重复/少1分/验签失败演练 | B5 纯内存 1/1/0/0；副作用为0 | UI_CONTRACT：未验真实签名或发权益 | BLOCKED / NOT_RUN | 真实商户 webhook/对账/幂等/费用 |
| UI-13.1 | `#/trade-settings` · 付款时限/兑换 | B5 本地约束；C2 面板 | C2 trade；不执行订单 ttl/redeem | BLOCKED / NOT_RUN | 业务成交规则/兑换端点/系统类禁止公开 |
| UI-13.2 | `#/trade-settings` · 售后方式/期限/生效规则 | B5 本地约束；C2 面板 | C2 trade；不执行退款或改旧快照 | BLOCKED / NOT_RUN | 退款 owner/新旧订单兼容待审 |
| UI-14.1 | `#/release` · 发布记录/详情/说明/确认 | B5 占位；C2 历史与发布面板 | C2 GET versions/detail、POST publish；无 release 类别 | BLOCKED / NOT_RUN | 无自由发布说明字段；真实角色/DB/CAS待验 |
| UI-14.2 | `#/release` · 草稿差异/草稿线上预览 | B5 原型分离；C2 draft/published diff | C2 GET draft/published；无 diff 类别 | BLOCKED / NOT_RUN | 类别级 diff 非逐字段获批契约；两浏览器未验 |
| UI-14.3 | `#/release` · 回滚新版本/保留草稿 | B5 禁用演练；C2 回滚面板 | C2 POST versions/:version/rollback；无 rollback 类别 | BLOCKED / NOT_RUN | 真实 DB 新版本/原草稿/审计原子性待验 |
| UI-14.4 | `#/release` · 操作日志 | B5 占位；C2 audit 抽屉 | C2 GET audit；真实 owner+事务替身，无 audit 类别 | BLOCKED / NOT_RUN | 真实 AuditLog/历史/角色拒绝/重启待验 |

B1全局会话/侧栏14路由、搜索/快捷键、加载/错误/退出/未保存/响应式外壳有实现及选定本地测试；四真实角色的登录、刷新、注销、直接改角色仍遭拒、完整键盘/触控与原稿同页面对照均未现场完成。B2b桌面实测实际宽911而非期望1440；B3–B5的1440/390检查为匿名隔离组件，不能转作已登录截图、微信真机或跨浏览器通过。

**B2a 同公网 H5 单要求仍未完成。** root没有同一公共开发DB中“H5页面建/读单 + 当前ops页面按号读取”的成对回执。旧LAN同库证据存在，但公网服务器与LAN库及游客不同；本轮没有订单写入/账号读取或复制旧单。总控须取得同一公共dev库归属、浏览器guest与运营/reader的有效身份后，协调选择一单，原样核对号、分金额、币种、状态、解锁，再验真实无权限403、无/失效会话401与授权查缺失号404。不得用缺路由404替代权限拒绝。

## 4. B3/B4/B5 → C1/C2 与三个消费者

| 消费者/流 | 当前本地事实 | 现场/公网状态 |
| --- | --- | --- |
| 根admin十个配置路由 | `config-server.vue` + `config-api.ts` 已接候选draft/published、完整单类别保存、CAS、发布/回滚、历史/审计；原typed表单仍在折叠本机演练区，旧unavailable consumer与原型预览没有被宣称持久化 | 组件/adapter通过；没有真实登录/DB，公网 `/ops/` 当前只是H5回退 |
| Foundation超管 | `/plugins/mbti-config/settings` 复用AdminShell、平台超管、`admin.plugin.manage`；目录/安装启停/版本与类别状态客户端存在；注册/lifecycle owner经本地测试 | Foundation页面在C2保留build中通过；未实测登录浏览器/真实安装行；公网同路径只是H5回退 |
| 用户H5 | 首页与商品目录预留匿名只读展示adapter；四原型名称精确映射wechat/mp/douyin/xhs；展示裁剪/拒绝draft/system/wrong-channel/旧响应/无缓存在42项中验证 | **HARD_DISABLED / PENDING_HUMAN_APPROVAL**；始终沿原页面回退；不改结算、题库、历史结果/订单；无真实两浏览器配置消费成功 |

唯一配置owner是现有 `ScopedConfig`（draft/active/immutable version）+ `ConfigurationChange` + `AuditLog`，项目/环境从可信运行配置与active ProjectProfile派生。没有第二套配置表/迁移/自动原型Seed；每类null表示UNCONFIGURED。catalog整体包含shop与styles；release/diff/rollback/audit是视图/生命周期，绝非可PATCH类别。[C1](MBTI-ADMIN-C1-DELIVERY.md)、[C2](MBTI-ADMIN-C2-DELIVERY.md)与[唯一词表](../../aij-foundation/apps/api/src/plugins/mbti-config/mbti-config.categories.ts)可复核。

管理API前缀 `/api/plugins/mbti-config`：

| 实际候选操作 | 输入/权限与本轮证据 |
| --- | --- |
| GET `/draft`、`/published` | 当前DB有效`admin.config.manage`；普通config只见前八类；返回revision/source/authorization/unknowns；本机HTTP读200 |
| PATCH `/draft/:category` | 恰好 `{value,expectedDraftVersion}`，保存11类之一完整对象；系统aiRuntime/payments/trade另需平台超管+`admin.secret.manage`；HTTP content200、额外字段400、trade低权403 |
| POST `/publish` | `{expectedVersion,expectedDraftVersion}`，平台超管+config+secret；本机HTTP同旧版本并发[200,409]，空差异/旧版本拒绝有owner测试 |
| POST `/versions/:version/rollback` | `{expectedVersion}`、更早有效历史；本机HTTP新v3且草稿修订保留；真PG原子性未验 |
| GET `/versions`、`/versions/:version`、`/audit` | C2要求平台超管+config+secret；本机HTTP允许200，普通config及非超管仅持secret均403；无自由发布说明或伪造日志 |
| 平台GET `/api/admin/plugins`，POST `/api/admin/plugins/mbti-config/{install,enable,disable}` | 既有`admin.plugin.manage`生命周期；本地真实owner+事务替身的重复/停用隔离已测；不是在真库启停 |

**匿名硬闸不变。** [public controller](../../aij-foundation/apps/api/src/plugins/mbti-config/mbti-config.public.controller.ts)没有配置service依赖；[public projector](../../aij-foundation/apps/api/src/plugins/mbti-config/mbti-config.public.ts)中`MBTI_PUBLIC_APPROVED=false`为源码常量，且有第二道拒绝。装配且enabled的本地fixture中有效单channel固定404无配置值，缺/重复/额外query400；禁用/无安装404，归属不可用503。公网本轮“Cannot GET”404是旧服务没有此路由，不能当作这个硬闸/PluginRoute验证。

待审八类为content/channels/catalog/assessment/personas/imageRecipes/retention/discovery。内部`publicCandidate()`只从active发布快照取值，身份为(project,channel,publishedVersion)，每次重读；它没有匿名HTTP消费者。系统三类、商户/凭据/SecretRef/provider/model/prompt/私密记录不进入候选公开投影。Remy异步审批问题仍待答，本次不代答、不移闸；批准后仍须正式映射/接线审查和授权开发环境复验。

`MbtiOrder`现有amount/currency/status/pricingMode和`MbtiQuizSession.bankVersion`/`MbtiResult.bankVersion`不含配置publishedVersion稳定快照字段。业务商品ID、不可变题库payload/scoring owner和新配置消费语义尚待审；不能把配置版本塞入bankVersion/pricingMode或回写历史。C2没让新订单/quiz采用候选价格/题目。现有业务单元测试及源码只证明调用边界，**新旧真实订单/会话/结果的持久化兼容 NOT_VERIFIED**。

## 5. 本次本地命令与保留验证

Node `v24.21.0`，pnpm `10.0.0`。以下为本轮在根checkout实际执行，原始无秘密日志保留于本机`/tmp/mbti-v1-*.txt`，未提交。测试/build只操作本机替身/忽略产物，无DB命令。Foundation构建不与其测试并发，本轮没有重跑Foundation全构建或DB集成。

| 实际命令 | exit | 结果 / 本机日志 |
| --- | ---: | --- |
| `pnpm --dir admin test` | 0 | 62/62，0失败/跳过；`/tmp/mbti-v1-admin-test.txt` |
| `pnpm --dir admin lint` | 0 | `/tmp/mbti-v1-admin-lint.txt` |
| `pnpm --dir admin typecheck` | 0 | `/tmp/mbti-v1-admin-typecheck.txt` |
| `pnpm --dir admin build` | 0 | 47 modules、`/ops/` base；`/tmp/mbti-v1-admin-build.txt` |
| `pnpm --dir aij-foundation/apps/api exec node --test -r ts-node/register test/mbti-config.test.ts` | 0 | 12/12；含真实本机Nest HTTP fixture，关闭临时端口；`/tmp/mbti-v1-foundation-config.txt` |
| `pnpm --dir aij-foundation exec node --test scripts/verification/plugin-manifest.test.mjs scripts/verification/configuration-schema.test.mjs` | 0 | 39/39；`/tmp/mbti-v1-foundation-manifest-schema.txt` |
| `npm --prefix web run test:api` | 0 | 42/42；`/tmp/mbti-v1-web-test.txt`；“browser”帮助器为VM/uni.request替身 |
| `npm --prefix web run type-check` | 0 | `/tmp/mbti-v1-web-typecheck.txt` |
| `VITE_USE_MOCK=false VITE_API_BASE_URL=/api/v1 npm --prefix web run build:h5` | 0 | `web/dist/build/h5`；`/tmp/mbti-v1-web-h5.txt` |
| `VITE_USE_MOCK=false VITE_API_BASE_URL=/api/v1 npm --prefix web run build:mp-weixin` | 0 | `web/dist/build/mp-weixin`；`/tmp/mbti-v1-web-mp.txt`；仅编译，不代表已配置真机HTTPS/平台域名/AppID/会话 |
| `npm --prefix docs/api-reference ci --ignore-scripts` | 0 | 按原lock恢复yaml依赖；`/tmp/mbti-v1-reference-ci.txt`；未改依赖版本 |
| `npm --prefix docs/api-reference test` | 0 | 8/8；`/tmp/mbti-v1-reference-test.txt` |
| `npm --prefix docs/api-reference run check` | 0 | 41/40/1、生成物与来源一致；`/tmp/mbti-v1-reference-check.txt` |
| `python3 /tmp/mbti-v1-validate-docs.py`（独立只读对账） | 0 | 原53/参考41/延期12；41方法路径/operationId唯一匹配；14页42组；公/本地产物摘要相同 |
| `orca ports --json` | 0 | 当前workspace端口列表空（不代表其他主机或工作树全部停服） |
| owner/凭据路径只读`Path.exists()` | 0 | 原F1owner不存在，四角色文件不存在，旧integration树仍存在；未读取秘密 |
| `git diff --check`、精确路径暂存后的`git diff --cached --check` | 0 | 本文与覆盖表；无应用/API变更 |

本轮合计 **163项本地测试通过**（62+12+39+42+8），这不是163个端点/动作验收。首次文档test/check各exit1，原因yaml未安装；按原lock `npm ci --ignore-scripts` 后8/8及check通过。H5/小程序编译有既有Sass弃用提示，未升级依赖。旧AppleDouble `._*`、输入包和Git `._pack-…idx non-monotonic index`噪声保留，未修复共享对象库或纳入提交。

C2在同代码源上的完整Foundation/三端验证由[结构化checks](MBTI-ADMIN-C2-CHECKS.json)保留：`pnpm --dir aij-foundation test` exit0（scripts97+API95，其中配置12；勿与本轮12重复累加）；Foundation `lint/typecheck/build`各exit0；admin `test/lint/typecheck/build`各0（62）；web `test:api/type-check/build:h5`各0（42）。本轮从checks读取相应`/tmp/mbti-c2-final-*.txt`保留日志路径并核实部分文件仍在，引用该次结果，不冒称重新跑过完整Foundation、旧AF数据库或真实restart验收。

## 6. 公开地址、版本与第一个可用入口

**最后只读核验：2026-11-10 09:14 北京时间（01:14 UTC）**。从本机`curl --noproxy '*' --max-time 12 --silent --show-error --output <临时文件> --write-out '%{http_code} %{content_type}' <URL>`逐项GET，8个curl均exit0；未带身份/秘密、未POST、未启动smoke。本机去敏摘要`/tmp/mbti-v1-public-checks.json`；网页取数工具对该域不可访问，未据此判断站点失效，实际结果以下列curl为准。

| URL | 实得状态 / 当前可证明的版本与用途 |
| --- | --- |
| https://mbti-dev.bestshizhongyu.com/#/ | GET根200 text/html，827 bytes；仅公网旧H5入口探活，本轮未操作用户流程 |
| https://mbti-dev.bestshizhongyu.com/api/v1/health | 200 JSON，status=ok，version=`0.4.0-fastlane-candidate.1`；**本轮第一个可用API**，不含当前源码SHA |
| https://mbti-dev.bestshizhongyu.com/api/ready | 200 JSON；只表明就绪响应，不代表读取了任何当前业务数据/角色/数量 |
| https://mbti-dev.bestshizhongyu.com/api-docs/ | 200 text/html；131933 bytes；SHA256 `8babcf95570cd2040ab1e6c37f2f95b5c3025a54d20b2b98754e4846b5e39623`，与本地/域名交付相同 |
| https://mbti-dev.bestshizhongyu.com/api-docs/openapi.json | 200 application/json；143007 bytes；SHA256 `53cc1cf32649980078160e03c2c9e4b5506835878bab06c72f0899ed7f820949`；实际41项/40 ready/1 unavailable，声明验收源 `81279efd6f4c085060b7ab237236c16ec5a700ba` |
| https://mbti-dev.bestshizhongyu.com/ops/ | 200但与根H5内容逐字相同，SHA256 `52fcd96bde4e7b9dc33601efbed3d867c2ed719e191af8e3e0ad594bec5c352f`；**不是当前运营应用可访问证明** |
| https://mbti-dev.bestshizhongyu.com/plugins/mbti-config/settings | 200但同一827-byte H5；**不是Foundation超管配置页已部署/登录通过** |
| https://mbti-dev.bestshizhongyu.com/api/v1/config/published?channel=mp | 404 JSON，消息`Cannot GET /api/v1/config/published?channel=mp`；这是公网缺此路由，不是本地C2硬闸或授权拒绝证据 |

[域名交付](MBTI-DOMAIN-ACCESS-DELIVERY.md)最后记录API部署源码81279ef，公网文档本轮仍精确匹配该批次产物。health仅报告候选版本，未查询服务器Git/容器，所以**当前公网API/H5完整运行SHA未知**，沿用“较旧公开源，未证明C1/C2已部署”的边界；不能把root `dev@e3ffe8d`标作公网可访问。

本地admin第一个业务详情候选为`/ops/#/orders`，依赖`GET /api/admin/mbti/orders/:id`；无运行API/真实会话及四角色文件，当前不能交付可登录页面。配置面板第一个read为`GET /api/plugins/mbti-config/draft`，还需正确project/environment、显式加载插件、同库安装enabled与有效config权限；现场全部未核验。Foundation入口为`/plugins/mbti-config/settings`，需平台超管及plugin权限；当前无可领取账号。测试的回环临时HTTP端口结束即关闭，不是常驻服务URL。

### 凭据位置与恢复说明（仅路径，无值）

| 用途 | 已有文档记录的位置 / 本轮事实 |
| --- | --- |
| B1四角色 | 根`admin/.local-data/test-operations-accounts.json`；**不存在**，没有密码可交付 |
| 原专用dev/test owner | `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`；**不存在**，禁止重建/猜配置/重置身份 |
| 原dev配置/只读运营账号 | 上述owner下`.local-data/mbti-foundation/development/.env`、`operations-account.json`（原记录0600）；owner缺失故当前不可领取；它也不是B1四角色或平台超管 |
| 公网角色/凭据 | 没有可核验的当前私密文件路径/领取人；由总控/环境owner安全交付，不能拿LAN凭据或ID替代 |
| 旧独立集成树 | `/Users/lei/orca/workspaces/mbti/mbti-web-api-fast-integration`仍存在；其存在不证明服务/库可用，未改/启动 |

下列仅复述已存在的[admin说明](../../admin/README.md)、[RUNBOOK](../../orca-inputs/MBTI-Orca-20261109/RUNBOOK.md)、[F3恢复](MBTI-WEB-API-F3-DELIVERY.md)、[Fast Handoff](MBTI-WEB-API-FAST-HANDOFF.md)及[静态文档发布说明](../api-reference/README.md)，**本轮未执行启动/重启/发布**：

- admin：`pnpm --dir admin dev`（本机4255、base `/ops/`）；`MBTI_ADMIN_API_ORIGIN`只有取得已核验API目标才设置，原默认4256不能视为有服务。
- Foundation：在`aij-foundation/`按pnpm锁安装/生成client/构建；已有`pnpm dev:api`、`pnpm dev:web`。项目模式必须`RUNTIME_PROFILE=project`、`PROJECT_ID=mbti-foundation`、显式`ENABLED_PLUGINS`含mbti-config、管理员认证与数据库能力开启，且同项目安装enabled。未有当前可用运行配置，不给猜测的启动env。
- 旧LAN恢复：先恢复可信owner与原私密配置，再在原integration树用`MBTI_LOCAL_OWNER_ROOT=<已核验原owner>`执行`node scripts/mbti-local.mjs check dev`，经总控协调才`stop dev`/`start dev`；旧文档的原LAN public origin应从owner核对，不能复制到公网。**这些是DB/服务操作，本轮全部NOT_RUN。** 不运行固定上游`db:*`、`base:dev`、`ai:local`，也不运行provision/seed/迁移脚本。
- web：`VITE_USE_MOCK=false VITE_API_BASE_URL=/api/v1 npm --prefix web run build:h5`；本机开发用`npm run dev:h5`并配置同源代理。旧稳定产物由`python3 -m http.server 5173 --bind 0.0.0.0 --directory /tmp/mbti-web-api-fast/h5-current`提供是历史说明，不是当前运行事实。小程序真机须另定可访问HTTPS测试域名/独立会话。
- 公网静态文档旧流程：只上传HTML/JSON到`/www/wwwroot/mbti-dev-szy/api-docs-releases/<已验版本>`、校验摘要、切换`api-docs`链接；首次location变更须`nginx -t`后reload。本轮未上传、切链或reload。当前C1/C2的公网发布流程/维护窗口没有新获授权，不补造部署命令。

## 7. 真实集成状态与下一步 owner/action

| 未完成项 | 精确状态 / 已有证据边界 | 下一步owner与动作 |
| --- | --- | --- |
| 环境/浏览器/数据库身份 | BLOCKED；当前workspace无端口，原test55437/dev55436 owner缺失；公网与旧LAN DB/guest不同。旧F4–F6独立profile/原身份重启已记录，当前真实角色、DB marker、当前业务行/数量/版本未知；没有把旧profile搬到当前库 | 总控+环境owner提供同MBTI实例的代码SHA、host/端口/project/environment/DB marker、原存储与私密领取路径，不重置或新造身份掩盖缺失 |
| B1四角色 / JWT / CSRF | BLOCKED/NOT_RUN；四角色文件不存在。合成auth/元数据与C2测试头不能证明登录Cookie/JWT签发刷新/吊销、CSRF正确/缺失/错误拒绝；B1 owner非平台超管 | 总控恢复已核验身份；Remy定类别读/写/发布权限；在真实server以owner/editor/support/reader+独立平台超管逐一登录/刷新/注销/直接低权请求并留实际200/401/403及无私密字段证据 |
| 同公网H5订单 | BLOCKED/NOT_RUN；仅旧LAN端到真实运营HTTP成对证据；当前B2aUI与公共DB成对回执不存在 | 总控协调同一public dev库的H5 guest及有订单读权限的运营/reader，选择同一单核对号/分金额/币种/状态/解锁及实际拒绝，禁止复制test单 |
| 两浏览器 draft→publish→rollback | BLOCKED/NOT_RUN + PENDING_HUMAN_APPROVAL；本机HTTP [200,409]/回滚200与内部投影测试不是真浏览器 | Remy答复八类匿名投影审批/正式字段；总控提供同库A运营、B用户浏览器：读同旧版本→A存草稿B不变→授权发布B新版本→回滚新版本B旧内容且草稿保留；同步核Foundation状态/审计，未批准前保持硬闸 |
| 停用/重启/缓存/持久性 | BLOCKED/NOT_RUN；fixture再init不造数据不等于真进程/PG重启 | 同环境owner在授权窗口记录启用/禁用/缺安装、跨项目/渠道拒绝；实际API重启后原身份/配置/草稿/发布历史/审计均保留；旧响应不恢复，B重读来源身份一致 |
| 历史订单/在答quiz/结果 | NOT_VERIFIED；C2无config快照字段/不可变业务映射；旧F1/F3跨旧API重启记录可引用但不证明C2配置变更兼容 | Remy+业务owner定新旧版本/ID/快照方案；获批后在隔离真实同库对比旧金额币种状态、旧题目答案语义与结果，存/发/回滚/重启均不回写旧行；再验新订单/新quiz采用新版本 |
| 真实支付/商户/webhook | UNCONFIGURED / blocked_external；F3只测试单pending、test-only协议；B5 1/1/0/0纯内存，未验商户验签或资金 | 商务/支付owner提供获批渠道商户/证书/SecretRef与正式SKU/收费交付/售后策略；授权沙箱后实验签/重复/少1分/币种/到账退款与权益幂等，不在此轮开启 |
| 账号恢复/设备绑定 | needs_human_review / NOT_RUN；当前guest到期不静默换号，无法据此承诺跨设备恢复已购权益 | Remy+认证owner定微信/可找回账号/游客迁移与订单归属、到期留存；以真实身份验证，见延期#3及已交付#49的恢复前提 |
| 外部模型/双图/资产 | UNCONFIGURED / UI_CONTRACT；B4只本机core+画布，不是模型输出；C1系统参数仍UNCONFIGURED | 模型/资产owner提供精确health/generate/上传所有权、预算费用、幂等任务/超时重试、私有资产保留删除与审计；明确授权后再接真实供应方 |
| 位置/人数/隐私阈值 | #46 unavailable / blocked_external；参与不是位置授权；B4条件桶不是人数；没有真实counts | Remy+隐私/位置owner定自愿粗位置/合法用途/身份关联/精度时效/退出撤回、距离算法/中心半径边界误差、小样本/差分披露政策；后端据获批规则实现，不能用全站人数或10人原型门槛代定稿；旧私密对象GC/物理擦除与guest到期留存也仍待审 |
| 小程序/微信/H5手机反馈 | 本轮mp-weixin只编译0；微信DevTools/真机/平台提审/域名白名单/真实微信登录支付NOT_RUN；实习生另一物理手机及微信浏览器回复未留存 | 实习生+微信owner在指定HTTPS域/独立身份跑核心闭环并交真实设备/版本/网络回执；模拟390px和旧多个profile不等于跨浏览器内核/物理设备成功 |
| 运营聚合/治理/导出/提醒/退款/兑换/生成交付 | UI_CONTRACT；数据未知显示 —，不是零；对应42组依赖未关闭 | Remy定口径/字段/权限，后端owner补持久事实与原子操作，再逐组接线/真实拒绝/幂等/审计；不重做设计或把guest API当运营查询 |
| 字段/角色/公开投影/历史语义 | needs_human_review；[MBTI_UNKNOWN](../../aij-foundation/apps/api/src/plugins/mbti-config/mbti-config.schema.ts)四项保留，候选adapter实现不构成批准 | Remy逐项确认prototype→storage/业务ID与revision、每类角色/plugin权限名称、商户凭据族/安全投影、业务消费/历史兼容；异步问题待答，不能以时间过去推定同意 |

交接完成条件尚未达到：当前可交付的是公共旧H5/API/文档入口与本地C1/C2候选代码及上述证据，不能交付当前root已上线的三端配置闭环。V1后续必须在同一已授权环境补齐阻塞项后再判全量通过；本次仅精确文档提交到dev，不push/部署，回报完整提交SHA后停止写入。
