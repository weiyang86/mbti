# MBTI Web API Fastlane F3 集成交付

2026-11-09，Run `run_594d408d15de`。F3 #47、48、49、50、53 已在项目开发环境集成，并完成真实LAN H5、同库运营同号与重启验收。内部契约仍为needs_human_review，根docs/api未定稿。

## 交接地址与同一笔订单

- API：`http://192.168.0.200:4056/api/v1`。
- H5：`http://192.168.0.200:5173/#/`；商品、确认订单、同号状态、本人订单/权益均有真实HTTP消费者，Mock=false。
- 本次开发库订单：`MBTI-8aa0b305-9c93-4dfb-9817-7f4a82c2a804`，990分CNY，pending、unlocked=false、payment_availability=unconfigured；没有pay_params/paid_at，权益为空。
- 同一号的受限运营入口：`GET http://192.168.0.200:4056/api/admin/mbti/orders/MBTI-8aa0b305-9c93-4dfb-9817-7f4a82c2a804`。原Foundation登录+持久会话+RBAC，唯一权限mbti:orders:read；运营界面不在本卡。
- 完整实际HTTP去敏证据：[MBTI-F3-DEV-SAME-ORDER-HTTP.json](MBTI-F3-DEV-SAME-ORDER-HTTP.json)。创建201和本人查询200来自LAN浏览器，运营响应200来自实际HTTP，未以SQL替代，也未把4156的测试单搬到dev。
- 本机LAN自测通过；实习生另一物理设备仍待验证。题库仍为qb-v0.4-prototype-1。

## 实测结果

| 检查 | 实际结果 |
| --- | --- |
| 最终LAN HTTP页面 | isSecureContext=false，randomUUID未提供、getRandomValues可用；从首页实际进入商品→确认→创建测试单201，目录金额来自服务器，tier2不可售 |
| 刷新后同意图再次点击创建 | 第二个POST仍201同单；页面本人订单恰1条，金额990CNY；权益200空列表；没有本地假支付或解锁 |
| Idempotency-Key跨源预检 | 实际OPTIONS204，ACAO为LAN5173，ACAH包含content-type/x-guest-token/idempotency-key；真实POST已到达服务器 |
| 开发运营同号 | 普通非超级管理员200，id/amount/currency完全一致；无凭证/有效游客401，无权限登录身份403，另一游客用户查单404 |
| 开发支付隔离 | 受控test-payment初始化与回调路由均404，未把MBTI_F3_TEST_FIXTURE或回调secret搬到dev；订单保持unconfigured |
| 开发API重启后 | 同配置stop/start READY；A原浏览器仍读同单、一条订单、无权益；运营再次登录查同号200，权限拒绝仍401/403/404 |
| F2 smoke回归（含F1） | `python3 .../MBTI-WebAPI-Fastlane/smoke.py --base http://192.168.0.200:4056/api/v1 --phase F2`退出0；结果8ec86d08-1d0a-44cb-b6c4-750691da53aa/db930b89-bf1b-47a1-848b-58f8ca7f103c；B404、交卷201+409、真实图片/比较/删除通过 |
| 集成Web | 22项test:api、type-check、最终LAN配置build:h5均0；对不可售商品显示用户可读说明，不在页面暴露内部错误标识 |
| 集成API/代码检查 | Prisma generate、API build、完整Foundation lint均0；修复F3候选两处未用import；新开发工具语法及定向lint均0 |
| 后端Worker专属test证据 | 121项HTTP、9项重启、F2 64项、F1 46项、79项API测试、typecheck/build均0；含并发幂等、签名/时间窗/差1分/币种拒绝、一次Foundation charge一次受控权益。属于明确test-only协议验证，不是外部沙箱收费 |
| WebWorker专属test证据 | 原Web单MBTI-3f4a78f2-1e80-4871-9ea4-478944f33df7在4156受限运营也200，同号990CNY；对应补证已集成，不能与本开发库订单混用 |

真实丢失响应及409/422/503的页面故障注入尚未在最终LAN页面强制执行，隔离测试覆盖对应拒绝与同键重试，二者分开记录。跨物理设备、微信端、真实商户支付、可找回账号绑定和正式定价/履约未验；真实渠道密钥证书/SecretRef与账号归属仍blocked_external或needs_human_review，不影响pending测试订单、运营只读及后续F4–F6。

## 开发认证已实际补齐

原补证记录中的NOT_PROVISIONED现已由总控本次执行解决：本项目专用 `scripts/mbti/provision-dev-ops.mjs` 先核对同仓、容器、实际开发数据库/角色/marker，再复用原SysUser/Role/Permission、bcrypt12和口令策略初始化。没有创建超级管理员、通用新认证或共享ops token。

工具创建一个普通运营身份，仅mbti:orders:read；另一个零角色身份只用于403验收。未知既有用户/角色/权限/口令变化会拒绝接管，不覆盖他人权限。重复执行两次均0，不重复建号或重置口令。开发JWT独立随机生成并保留，AUTH_ENABLED写入本机owner配置；test JWT/账号/回调secret/会话没有复制到dev。

秘密只在owner `.local-data/mbti-foundation/development/.env` 和 `operations-account.json`（0600），不进前端、Git或回执。普通运营账号的使用/口令交接在本机受控文件进行；报告不展示账号秘密。此工具是明确development-only的可信初始化，登录和会话校验仍由Foundation完成；没有依赖上游固定seed或未配置的初始超级管理员。

## 运行与恢复

owner仍为 `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`，不要删owner、配置或持久卷；开发55436与测试55437分离。当前API来自独立集成树。

```sh
cd /Users/lei/orca/workspaces/mbti/mbti-web-api-fast-integration/aij-foundation
export MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation
export MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4056
node scripts/mbti-local.mjs check dev
# 新开发环境在迁移后初始化；既有环境可安全核对，不重置口令：
node scripts/mbti/provision-dev-ops.mjs
node scripts/mbti-local.mjs stop dev
node scripts/mbti-local.mjs start dev
node scripts/mbti/verify-dev-ops.mjs MBTI-8aa0b305-9c93-4dfb-9817-7f4a82c2a804 990
```

新环境没有本笔开发测试单时，先从真实H5用自己的游客建单，再将实际单号/分金额传入verify工具。工具只向本机接口/网卡地址的开发端口发登录请求，禁止重定向，不输出凭证，并注销本次管理员会话。

H5稳定服务为Orca terminal `term_6388bf13-8f20-4664-9b49-c89813a516a5`：`python3 -m http.server 5173 --bind 0.0.0.0 --directory /tmp/mbti-web-api-fast/h5-current`。alias现在指向已验 `/tmp/mbti-web-api-fast/h5-f3`，保留前两轮哈希资产以兼容已打开页面；后续候选不热更新此产物。临时目录被清理后按web锁文件及上述Mock=false/LAN API参数重新build、复制产物并恢复同地址。

候选契约与实现来源：F3后端ccc82db/0747da4，Web5049150/cfb02d3，Web运营补证eaf42db；总控集成修正3172854、开发运营初始化与实际同单证据96b3a65。本记录与下一步合并commit共同定位交付SHA。另含F4候选准备文档，F4接口尚未实施/验收。
