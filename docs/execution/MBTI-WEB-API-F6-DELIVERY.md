# F6 开发环境交付：参与开关与人数不可用

**#44/#45 可用，#46 的明确不可用分支可用；真实位置聚合仍 blocked_external / not_available。** 本轮没有将人数、半径、小样本或屏蔽过滤的实际统计计为通过。Run `run_594d408d15de`；后端 Task `task_023e4e12d4ed` / Dispatch `ctx_f0ad890d1e30`，Web Task `task_754fd82cfafd` / Dispatch `ctx_3c262267f1d4`。契约仍为内部 `candidate / needs_human_review`。

- API：**http://192.168.0.200:4056/api/v1**；H5：**http://192.168.0.200:5173/#/**，`VITE_USE_MOCK=false`。
- F5 dev 基线 `6d2aa98a90d47c8ff1e8ad5135ee0b0cb4367a9c`；F6 Worker 起始树 `00d9199748f3c46f9bf21fcc5035280d90e2ac9b` 另含已审核的只读准备文档。后端运行源码 `008455bbab20f85f6348cf54a40b7e23512eec90`、最终回执 `7490e8495dd16802ddfa33a8dcb437a2f9a022ef`；Web 源码 `515b3fb1b4d38aa6729129f2b273fdaa2531b17b`、最终回执 `87519bd7b9e0eb9e3d9e79d42be29ba1e900e08d`。总控实测集成树完整 SHA 在 [开发证据](MBTI-F6-DEV-H5-EVIDENCE.json)；后续交付文档不改变运行代码。
- 专用 dev55436 / test55437 分离，归属核验后 dev 仅增加第43迁移 `20261109000300_mbti_f6_radar_candidate`。未收位置、改 F5 私密对象/授权或重置开发认证。
- H5 静态产物 `/tmp/mbti-web-api-fast/h5-f6-7d2bf39`，`h5-current` 链接供5173服务；已保留前批哈希资源。

## 行为和证据

GET `/radar/participation` 仅返回本人已存选择，缺记录为 false，不懒建参与或名片。PUT 只接受必填 boolean enrolled，复用 F5 owner 事务锁，true 需本人合法已存名片类型，false 无条件可退出；不会更改名片公开范围、四 visibility、历史或联系授权。参与只是选择事实，不等于位置授权。

GET `/radar/same-type` 只查本人类型；可省略 type_code，传入则必须与服务端本人名片一致。radius_m 仅候选三档500/1000/3000，缺省500。当前合法响应严格为 `count:null,status:unavailable`，reason 分为 `not_enrolled` 与 `location_source_not_configured`。不会返回0、数字、low_sample、名单、坐标或其他 owner；基础设施/协议失败保持失败。未知字段、重复 query、伪 owner、非 boolean、错误类型和半径均422，缺凭证401，沿用 JSON400/no-store。

[后端交付矩阵](MBTI-WEB-API-F6-BACKEND-DELIVERY.md) 记录171次真实HTTP / 451断言、最终原身份重启11次 / 30断言、83项API测试及适用回归全部通过。包括默认退出、合法私密名片加入、同值幂等/有序提交、类型变更、严格原始query、原卡/历史/联系元数据不变、F4/F5新cohort授权保留。最初并发辅助脚本误判单连接队列导致超时，纠正测试后整轮通过，业务源码未变；真实聚合没有启用。

[Web最终报告](../../web/F6-INTEGRATION.md) 记录三个新profile的首页/发现入口、缺类型禁用、私密名片参与/退出、三半径不可用、刷新与一次协调重启后的原身份/卡/可见性持久化。额外HTTP拒绝与GUI证据分开，39项隔离测试覆盖错误分态、严格响应及迟到响应保护；真实人数、跨设备和故障页不计为通过。两位Worker均已停止写入，保留各自测试服务和profile。

总控在真实 **LAN H5 首页** 新建三个独立profile，默认false、无类型并禁用加入。A/B主动在本人名片选择ESTJ/ENFP，始终discoverable=false、四visibility=false。A明确加入后B仍false；A通过三个实际范围控件及重新读取，均显示“同型统计暂不可用/尚未接通自愿位置来源”，没有人数或“人数较少”。B加入后退出，C保持无类型默认false。额外真实HTTP确认无类型true、错本人类型、错误/重复半径、伪owner/位置字段及非法boolean422，匿名401，均no-store；这些拒绝不冒充GUI错误页面验收。

开发API同源码再stop/start后，原Atrue、B先true后false、Cfalse及各自card ID/类型/四visibility均保留，刷新没有重新领号。F5原三个开发profile的本人渠道同值，原有效单向微信授权仅A200、B/C404，旧撤回与反向pending仍404，基础交换accepted保留。原F1两结果 `8a3d4793-93ab-43e4-8988-d3b6962d4b32` / `4b177e28-89d8-410f-ad90-b111a9e66e83` 仍在原浏览器200；F3原订单 `MBTI-8aa0b305-9c93-4dfb-9817-7f4a82c2a804` 仍为990 CNY分、pending、未解锁。

## 检查与剩余边界

总控集成树 Prisma generate、API typecheck/build、Foundation完整lint、最终验证脚本eslint、Web39/39测试、type-check和LAN基址build:h5均退出0。开发迁移、两次READY、页面与重启验证脚本均0。现有UniApp/Sass提示未升级处理。

`smoke.py --base http://192.168.0.200:4056/api/v1 --phase F2`（含F1）退出0：两结果 `63b760eb-e3a4-4193-bfa2-678dc65a511f` / `3ff6ceca-d4c5-4a89-bf71-2a509c2e5743`，B跨用户404、交卷201/409、分享/比较/删除通过。开发 `verify-dev-ops.mjs` 同原测试订单200，匿名/游客401、无权限管理员403、他人订单404，dev合成支付入口404。

真实聚合缺少自愿位置来源及其授权/身份关联、精度/时效/撤回、距离算法、半径中心/边界/误差及经确认的小样本和差分政策。没有伪造数据、用全站人数替代，或将候选的三档范围/PR20的10人写成正式政策。未来须补齐这些输入再实现可用/低样本分支；当前不存在启用真实人数的命令或开关。

另一物理设备、微信浏览器、生产多实例压测和真实位置统计均未验；本机LAN地址实测通过。API/H5及专用PG保持运行，配置与秘密仍在F1 owner的ignored私有目录，沿现有开发恢复命令与 `MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4056` 使用。没有清除原主体或私密对象。
