# F5 开发环境交付：联系方式与授权 #36–43

八项已集成并在实际开发 H5 验收。Run `run_594d408d15de`；后端 Task `task_f052f3029698` / Dispatch `ctx_f8b03d32796c`，Web Task `task_c62021f68ae6` / Dispatch `ctx_e8fa22a93bf0`，均已成功回执。仍为内部 `candidate / needs_human_review`，未修改权威 `docs/api/`。

- API：**http://192.168.0.200:4056/api/v1**；H5：**http://192.168.0.200:5173/#/**，`VITE_USE_MOCK=false`。
- 基线 `3580e0fd902a57b5870c7e376b5d98fe916a0e3c`；集成实测源码树 `2b79dca`（完整 SHA 在去敏证据）。后端运行候选 `a8d458e11bdc9cdf6b487b84bc5b2fbe605cc36a`、最终回执 `0e1465e41717dd0ba06d3e3fc97b8d3dacd83eec`；Web 源码 `ea12901f997f721b6b4966bb635fb3ed54920c5c`、最终回执 `f14377fa2437bca5bf07b7f69953a383a5f1b3bf`。后续本交付提交仅补证据。
- 本项目 dev PostgreSQL 55436 / test 55437 分离。归属检查后 dev 应用第 42 个迁移 `20261109000200_mbti_f5_contacts_candidate`。没有重建身份、重置运营口令、复制 test fixture 到 dev 或开启 dev 合成支付。
- 5173 仍提供通过构建的静态 H5，保留前批哈希资源；当前产物 `/tmp/mbti-web-api-fast/h5-f5-d5a37a6`，由 `h5-current` 链接供服务。

## 实现与实测

复用 GuestGuard、F4 canonical pair/owner 事务锁及实时可见性/屏蔽事实。本人渠道使用底座 LocalStorageAdapter 的每 owner 私密目录，DB 只留引用与 epoch 等元数据，无公开 FileAsset/URL。全量替换与清除使旧请求失效；授权绑定确切基础交换及联系版本，解除屏蔽、重填、重新公开或新基础交换均不复活旧授权。granted 只给已批准请求的原发送方和确切渠道，反向申请独立；双方可撤回 pending/accepted。

[后端完整矩阵](MBTI-WEB-API-F5-BACKEND-DELIVERY.md)：257 次真实 HTTP / 639 断言，原主体重启 48 次 / 131 断言全部通过；覆盖三主体隔离、并发、私密 IO 故障、版本/关系失效、猜测公共文件路径拒绝、公开投影/DB 元数据/API 日志无渠道值。F2/F3/F4 回归及 79 项既有 API 测试通过。此前 test namespace 切换已在协调暂停期间兼容两份旧对象，引用/epoch/时间不变，Web 原身份同值复验通过，未清数据或重填掩盖损失；dev 首次安装 F5 无旧 flat 引用，不运行 test 专用兼容脚本。

[Web 实际页面报告](../../web/F5-INTEGRATION.md)：三隔离 profile 完成八操作控件消费，以及拒绝、双方 pending/accepted 撤回、屏蔽解除、清除重填、退出公开与基础交换重建后的旧 grant 404。两次协调重启后原渠道同值，最终单向微信授权仅 A 可读、B/C 404。离页、重新读取和失败清空私密值，迟到响应不会回填隐藏页面；无静默换号、失败重放、本机授权缓存或模拟同意。

总控在 **LAN 开发 H5** 使用原 F4 的三个隔离 profile，从首页进入本人渠道并实际保存、确认清除、重填；C 始终空。A/B 通过真实 F4 申请/接受后，A 仅选择微信请求 B，批准前 404，B 本人批准后 A 页面只显示该微信，接收方 B 与 C 额外 HTTP 均 404。A 在授权页撤回后立即清空，重读 404。再建有效单向请求和独立反向 pending，后者不自动获得授权。刷新仍为原卡/原身份，没有重新领号，公开投影、localStorage、console 均无测试渠道值。

开发 API 同源码再 stop/start，原 A/B 本人三渠道同值、C 空、card ID 和空屏蔽列表均保留。有效请求 **`contact_SBWDg40PUSmp9mAVZ_dJXdLl_8VcOIhr`** 仍仅 A 读微信 200，B/C 404；旧撤回请求与反向 pending 仍 404，绑定基础交换 accepted 保留。API 日志扫描无本轮合成渠道值。原 F1 两结果 `8a3d4793-93ab-43e4-8988-d3b6962d4b32` / `4b177e28-89d8-410f-ad90-b111a9e66e83` 在原浏览器仍 200；原 F3 订单 `MBTI-8aa0b305-9c93-4dfb-9817-7f4a82c2a804` 仍为 990 CNY 分、pending、未解锁。

总控仅提交 [去敏开发 H5 证据](MBTI-F5-DEV-H5-EVIDENCE.json)：公开合成 ID、状态、渠道名和布尔，没有原联系方式、请求头、凭证或内部存储引用。原值仅在 ignored/0600 的临时测试状态和私密对象中供同值比较。

## 检查与交接

总控在集成树完成 Prisma generate、API typecheck/build、Foundation 完整 lint、Web 30/30 测试、type-check、LAN API 基址 build:h5，均退出 0；开发迁移与两次 API READY、两段开发页面/重启脚本、证据脱敏扫描也均退出 0。原依赖的 UniApp/Sass deprecation 提示未升级处理。

`smoke.py --base http://192.168.0.200:4056/api/v1 --phase F2`（含 F1）退出 0：A 两结果 `77fe6ba1-1910-4d90-b2e2-edce495762de` / `3226be1c-475e-45e2-a0ef-f9fd42e18a2e`，B 跨用户 404、交卷 201/409、分享图片/比较/删除通过。现有 `verify-dev-ops.mjs` 退出 0，同一原测试订单在普通运营只读入口 200，匿名/游客 401、无权限管理员 403、他人订单 404、dev 合成支付入口 404。

API/H5 监听 `0.0.0.0`，本机 LAN 地址实测通过；**另一物理设备和微信浏览器仍未实测**。主机、专用 PostgreSQL 和 H5 静态服务保持在线。API 恢复继续使用 F1 owner 私有配置、当前集成树构建和 `MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4056`，不复制 test 配置。无需重建主体或重跑私密兼容。

正式格式/策略、guest 到期留存及旧私密对象离线 GC/物理擦除仍待审核；本轮清除撤销 live 引用与授权，未声称删除已复制/截图内容。未做生产多实例压测或 dev 私密故障注入。继续 F6，缺少自愿位置来源和距离/小样本口径时按卡先交参与开关，人数明确不可用。
