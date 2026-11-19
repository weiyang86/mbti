# F5 后端候选交付：联系方式与单向授权 #36–43

**八项内部候选已实现，真实 test HTTP 与原主体重启回归通过；正式发布仍 `candidate / needs_human_review`。** 本回执仅为后端证据，不代替 Web GUI 或总控集成验收。

- Run `run_594d408d15de`；Task `task_f052f3029698`；Dispatch `ctx_f8b03d32796c`。
- 独立 Orca 树 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f5`；分支 `weiyang86/mbti-web-api-f5`。
- 实际基线 `3580e0fd902a57b5870c7e376b5d98fe916a0e3c`，从已集成 F4 的 `weiyang86/mbti-web-api-fast-integration` 建立，含 `74c546c` 发起方可见性修复。
- 实现提交 `05687a5`；实际运行/验收候选 **`a8d458e11bdc9cdf6b487b84bc5b2fbe605cc36a`**，补充受保护 test 旧布局兼容。最终文档提交不改变运行代码；最终回执提供整树 SHA。
- test API **http://192.168.0.200:4156/api/v1**，本树独立依赖、Prisma client、dist、0600 F3 test fixture；owner 仍为 F1 树，test PG55437。只迁移 test，第 42 个迁移 `20261109000200_mbti_f5_contacts_candidate`。
- 没有改 `web`、dev schema、4056、5173、开发运营身份或秘密；没有 push、merge、main、清库、清除旧 F4/Web 主体或复用其他树的依赖/fixture。

## 候选约定与复用

[运行 OpenAPI](../integration/MBTI-F5-runtime-candidate.openapi.yaml)、[脱敏形状样例](../integration/MBTI-F5-runtime-candidate.examples.json)、[PR20 逐项消费与存储边界](../integration/MBTI-F5-candidate.md) 已先于实现交总控供 Web 对齐。固定 PR20 `a39d99cf8537a6e54c34e965b2c3ff6c2691a21f` 只读参考，没有整体合并或更改权威 `docs/api`。

MyContacts 仅 wechat?/qq?/phone?；PUT 全量替换并 trim，缺省/空串删除，空对象表示无渠道。未知键、null 字段、非字符串、数组与非法格式 422；顶层 null/primitive 和坏 JSON 沿用 strict parser 400。格式范围沿 PR20，仍待正式审核。GET/PUT 只给当前凭证本人；DELETE 幂等 204。

ContactRequest 保留 PR20 字段，新增 direction，buddy_id 恒为观察者对方的公开 card ID，simulated=false。列表只双方、按 createdAt/id 稳定倒序，可按 buddy_id 过滤；对方当前不可见/双方任向屏蔽即不列。channels 为明确非空、不重复的 1–3 项，重复 422，固定 wechat/qq/phone 顺序；不能借 create 披露接收方未请求渠道。缺请求渠道统一 409。首次 201，同方向同集合 pending 重试 200 同 ID，不同 pending 集合或 accepted 重复 409；反向独立，不互授。

仅 incoming pending 的接收方可 accept/decline，批准确切请求集合，未增加部分授权字段。发送方回应 409，第三方 404；双方均可 DELETE pending/accepted，revoked 双方幂等 204，declined 撤回 409。granted 仅原发送方 accepted 且所有事实当前有效，返回 `{channels:[{channel,value}]}`；接收方应读 `/contacts/me`。pending/declined/revoked、版本不符、基础交换失效、私密/屏蔽、第三方均 404。

复用 GuestGuard、裸业务对象、`{code,message}`、现有 JSON400 与所有成功/错误 no-store。没有引入另一套身份、权限、block 判断或存储实现。

私密对象经原 `LocalStorageAdapter` 写入 MBTI owner 专用 namespace，目录0700、文件0600；无 FileAsset、公开 URL 或 AI plugin 假 scope。DB 只含引用、epoch、checksum、大小和必要时间。每次读重新核对引用、checksum 和确切集合，无旧值缓存；读/写故障统一503。写成功后才提交引用，事务失败不在线补偿删除，避免误删已提交或在途引用对象。替换/清除只撤销 live 引用和授权；旧私密对象与孤立对象离线 GC/物理擦除策略保留待审。

实际替换/清除单调增加 epoch，同值规范化 PUT 不变；旧 pending/accepted 永久失效。申请绑定确切仍 accepted 的 F4 exchange ID、接收方 epoch，双方须有合法公开名片、共享实时 isBlocked=false。F4 canonical pair 事务锁和 owner 锁串行化，数据库部分唯一索引兜底有向活动唯一；block、基础交换撤回和私密 opt-out 同事务撤销关联授权。解除、重新填写、重新公开或新 F4 交换均不复活旧授权。F4 原 sender 公开前置检查保留。

## 实际八项成功/拒绝矩阵

[脱敏 HTTP 证据汇总](MBTI-F5-HTTP-EVIDENCE.json) 来自实际请求，只保留路由模板、状态、渠道名称与布尔断言，不含请求/响应原文、原联系方式、凭证、内部 owner/key 或运行日志。P 是 prepare，R 是 restart；257 次含身份、F4 前置、CORS 与公开路由拒绝，不把请求数当作八项业务操作数。

| # | 方法/路径（省略 /api/v1） | 成功及语义证据 | 拒绝及边界证据 |
| --- | --- | --- | --- |
| 36 | GET /contacts/me | P002/006/010 新主体200空对象；R原A/B/C同值200 | P029 owner query422、P215缺凭证401、P223随机凭证401、P195私密读故障503 |
| 37 | PUT /contacts/me | P004/008/012本人三渠道200；P016 trim/字段顺序变更同epoch；P046省略字段删除；P120同值保留授权 | P017–025白名单/类型/格式422；P026–028顶层400；P216缺凭证401；P197旧对象读故障503、P201实际私密写故障503，引用/epoch未提交 |
| 38 | DELETE /contacts/me | P122/123重复204；P124空对象，P125清除后grant404；P126重填仍P127旧grant404 | P015 owner selector422、P217无身份401；不影响他人本人渠道 |
| 39 | GET /contact-requests | P055/056 observer incoming/outgoing与对方card ID；P058过滤；P057 C列表无该请求；P139/152 block后隐藏 | P030重复query422、P218无身份401；元数据无原渠道值/内部owner；失效请求投影revoked |
| 40 | POST /contact-requests | P049首建201，P053同ID200；P071反向独立201；P096–103并发同向同ID一201七200，固定渠道顺序 | P014无卡发起404；P031基础未接受409；P037–043非法/重复/空渠道422；P044自己/P045伪sender422；P047缺渠道409；P054不同集合409；P069 accepted重复409；P136/149屏蔽404、P169/176私密404；P219无身份401 |
| 41 | POST /contact-requests/{id}/respond | P065接收方accept200，P089 decline200；P073反向由A独立接受 | P059发起方409；P060/062第三方404且先归属；P063非法action/P064扩授权字段422；P070已接受重放409；P116版本变更409；P137/150屏蔽404；P220无身份401；P224未知404 |
| 42 | DELETE /contact-requests/{id} | P075/076接收方撤销accepted后双方重试204；P081/082发送方取消pending；P085/086接收方撤回pending且幂等；P094发送方撤销accepted204 | P061第三方404；P091 declined冲突409；P138/151屏蔽404；P221无身份401；P225未知404 |
| 43 | GET /contact-requests/{id}/granted | P066 A只得到B确切wechat，QQ/phone不出现；P074 B反向只得到A的QQ；P078撤回AB不影响反向授权；P205全三渠道批准集合与固定顺序；R有效wechat持久化200 | P050 pending404；P051/067接收方404；P052/068 C404；P090 declined404；P077/083/087/095撤回404；P117/125/127/131版本/清除/重填404；P135/148 block404，P141/154 unblock仍404；P144/157/161/164旧/新基础交换404；P168/171/175/178私密与重新公开404；P196私密IO503；P222无身份401；P226未知404 |

prepare 实际状态分布：200×96、201×33、204×24、400×4、401×9、404×53、409×11、422×23、503×4；**257 HTTP / 639 断言 / 退出0**。全部八项及所有错误 no-store；匿名公开路由404另依宿主路由形状，不伪称业务对象。

## 并发、隐私、IO 与重启

- P096–103 八个并发 HTTP：一201七200、同 ID，DB 辅助检查每 directed pair 活动≤1。P106/107 accept/decline 为200/409；P110–112 revoke204、accept409、decline409，之后grant404。合法串行状态变化与无重复接受分别验证。
- P181/182 block/granted 竞争结果200/404，之后P183为404；P189/190 clear/granted 为204/404，之后P191为404。没有用 SQL 替代状态转换或 HTTP 拒绝；SQL仅查引用、epoch、内部唯一性和元数据无值断言。
- P195–198 仅将本轮合成 B 的单个私密对象权限置为不合规后恢复：本人GET、granted、尝试PUT均503，引用/epoch保留，恢复后原grant200。P200–202先清空本轮 B，再仅使其 owner namespace 权限不合规，实际 adapter.write 返回503；无新引用/epoch提交，恢复后PUT200。没有改共享根、Web主体或 F4 存储。
- 实际私密文件0600；用真实内部key请求匿名 `/api/v1/files/{key}`、`/api/v1/objects/{key}`、分享资产路由、`/api/client/files/{key}` 与 `/api/admin/files/{key}` 全404，无私密值。提交证据替换为路由模板，不记录key。
- 扫描本人名片、公开名片、搭子列表/详情、屏蔽管理、基础交换嵌入、联系请求列表、错误与 API 日志：本轮所有合成渠道 canary 均不存在。扫描数据库仅证明引用/元数据表无渠道值；原值只在私密对象与合法本人/granted响应。打印只给布尔结果。
- 两个来源 `http://127.0.0.1:4155`、`http://192.168.0.200:4155` OPTIONS204并精确 ACAO；evil 来源204无 ACAO。游客401保持明确失效，无静默新号/重放。
- 首次 preview READY 后 Web 已写入两份合成渠道；在总控明确无in-flight窗口，test owner/container/marker核验后运行布局兼容脚本，经原适配器校验 size/checksum/权限/无symlink，复制2份至owner namespace；引用/epoch/时间不变、原对象保留、不覆盖已存在目标。总控随后确认 Web 原 A/B 同值200三渠道、C空、旧grant404与F4 accepted保留，无重填/换号。此处是总控回信的Web前置复核，非本Worker GUI证据。
- 最后再收到明确窗口后同树dist stop/start且READY，原 token 只从本树 ignored0600 状态重用；**F5 restart 48 HTTP / 131断言 / 退出0**。原A/B/C card ID与本人渠道同值；有效wechat exact grant200；pending仍404；10个旧失效授权（declined、主动撤回、pending旧epoch、清除重填、换值、两向屏蔽、旧基础交换、双方分别opt-out）全部404；接收方/C也404。重启后再次扫描日志/投影/DB通过。
- 同次重启 F4 原 cohort **17 HTTP / 8断言 / 退出0**；原接受、屏蔽、解除后旧revoked及原身份均保留。未操作 Web 当前有效单向授权，已及时READY通知其原profile只读复验。

## 实际命令与退出码

以下均在本树 `aij-foundation` 中执行；所有 test 脚本使用 `MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`，未读写 dev 配置/口令。

| 命令 | 实际退出码/结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 0，800包，仅本树依赖 |
| `pnpm --filter @aij/api prisma:generate` | 0，本树Prisma6.19.3 |
| `pnpm --filter @aij/contracts --filter @aij/core --filter @aij/runtime-contracts build` | 0，workspace包产物 |
| `pnpm --filter @aij/api typecheck` | 0，源码及test tsc |
| `pnpm --filter @aij/api build` | 0，本树dist |
| `pnpm --filter @aij/api prisma:validate` | 0，schema合法，不连库 |
| `pnpm lint` | 0，完整Foundation apps/scripts |
| `pnpm --filter @aij/api test` | 0，79/79既有API测试 |
| `node scripts/mbti-local.mjs check test` | 0，owner/container/marker/db/user/55437核验 |
| `node scripts/mbti-local.mjs migrate test` | 0，只新增F5迁移，42总迁移；无dev操作 |
| `node scripts/mbti/seed-f3-test.mjs` | 0，本树独立私有fixture，未复制另一树 |
| `node scripts/mbti/migrate-f5-test-storage.mjs` | 0，copied2，引用完整性true，原对象保留；只test兼容 |
| `node scripts/mbti/verify-f5.mjs prepare` | 0，257真实HTTP/639断言 |
| `node scripts/mbti/verify-f5.mjs restart` | 0，同源码重启后48/131 |
| `node scripts/mbti/verify-f2.mjs` | 0，64项，真实SVG/归属/删除/存储失败重试 |
| `node scripts/mbti/verify-f3.mjs` | 0，121项，原底座Auth/RBAC/签名回调/唯一账本/运营同号；非真实外部支付 |
| `node scripts/mbti/verify-f4.mjs prepare` | 0，212真实HTTP/73断言 |
| `node scripts/mbti/verify-f4-sender-visibility.mjs` | 0，55/23，缺卡/空类型/私密sender404且不产生隐藏pending |
| `node scripts/mbti/verify-f4.mjs restart` | 0，17/8 |
| `python3 <指定输入包>/smoke.py --base http://192.168.0.200:4156/api/v1 --phase F2` | 0，含F1，qb-v0.4-prototype-1；A两结果 c7fd0a18-b232-49bf-93be-0fb11ec7ed23 / 7520daeb-9d4f-401f-8d85-76367bc2ab5d，B404、submit201/409、真实预览图片/比较/删除通过 |
| `git diff --check` / `git diff --cached --check` | 0，精确路径暂存，敏感扫描无值/凭证/内部owner |

首次在仓根调用 `pnpm lint` 退出254（脚本位于Foundation）；已在正确目录运行完整lint且退出0。两次编辑命令路径误带重复Foundation前缀，未改文件，已纠正；没有把这些命令计为通过。HTTP矩阵首轮及重启均一次通过。Git已有AppleDouble pack index告警，未操作 `.git`、未提交 `._*`；真实基线/提交可读。

## test 恢复

服务最终保留4156，不再写入或重启。恢复必须先协调正在使用Web的写入窗口；这组命令只适用于test，不能用于dev切换。现有本树fixture/state/数据库均保留，不需清库或重建主体。

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-f5/aij-foundation
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
export MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4156
export MBTI_H5_ORIGINS='["http://127.0.0.1:4155","http://192.168.0.200:4155"]'
export MBTI_F3_TEST_FIXTURE=1
node scripts/mbti-local.mjs check test
# 仅在总控明确的短重启窗口内：
node scripts/mbti-local.mjs stop test
node scripts/mbti-local.mjs start test
node scripts/mbti/verify-f5.mjs restart
```

新 checkout 先独立 install、Prisma generate、workspace包及API build，只在owner check后 migrate test，并用自己的 seed-f3-test.mjs 生成fixture。旧flat预览引用才需受保护layout兼容脚本；已兼容目标只校验不覆盖。不得跑上游db:*、base:dev、ai:local或开发运营初始化。dev迁移/部署/集成由总控另行处理。

## 未验项

正式渠道格式/授权策略发布、guest到期资料留存、私密旧对象GC/物理擦除待审核。未做真实用户渠道、物理跨设备、微信浏览器、生产多实例负载/故障持久性测试；单实例同时发出的真实HTTP及数据库锁/索引代码已验证，不能称为生产压测。

本Worker未改web或执行GUI；另一Writer负责真实页面消费、缓存清除和原profile重启复验。本后端交付不等待Web报告，不把HTTP写成GUI。F6未实施，真实外部支付配置仍属既有独立条件依赖。
