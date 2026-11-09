# F4 开发环境交付：名片、搭子、交换 #24–35

12 项已集成并在实际开发 H5 验收。Run `run_594d408d15de`；后端 Task `task_ee60b8ce8251` / Dispatch `ctx_04d1f774b1ea`，Web Task `task_304e425f3c01` / Dispatch `ctx_d8e6c1640dba`，均已成功回执。正式业务契约仍为内部 `candidate / needs_human_review`，未修改权威 `docs/api/`。

- API：**http://192.168.0.200:4056/api/v1**；H5：**http://192.168.0.200:5173/#/**。
- `VITE_USE_MOCK=false`，H5 构建 API 基址即上述 LAN 地址。5173 提供通过构建的静态产物，保留上批哈希资源；候选工作树不热更新交付入口。
- 基线 `42dc92b6bbbdda716c980b3f0ed0a6a3067a01ff`；总控实测源码树 `3d1e0725430377322cee5a6be882e4d37d4b9644`。后端运行源码 `74c546cc4e1de602eaf26a0421729808399c653d`，最终回执 `7c672bcd5c0d19d3c737a7e63c93ad1d9e290356`；Web 源码 `5d3037828d3b1710ba731fc254181fe039f7374a`，最终回执 `327f7b1ea804ac18d3b3b82de4bdc12e6efec054`。后续本交付提交只补证据。
- 题库仍为 `qb-v0.4-prototype-1`，12 题；原教学版本和历史结果保留。
- 专用 dev PostgreSQL 55436 / test 55437 分开。归属检查后开发库应用第 41 个迁移 `20261109000100_mbti_f4_social_candidate`。既有开发 Auth/RBAC 与运营只读身份保留；未引入迟到的另一套运营工具。

## 实测结果

后端 [完整矩阵与恢复](MBTI-WEB-API-F4-BACKEND-DELIVERY.md) 记录 212 次真实 HTTP / 73 断言，另有发起方可见性 55 次 / 23 断言、重启 17 次 / 8 断言，全部通过；79 项既有 API 测试及 F2/F3 回归通过。Web [候选报告](../../web/F4-INTEGRATION.md) 记录三隔离浏览器、全部 12 操作的页面消费、隐私拒绝和原身份重启证据。

总控发现原候选允许私密且无类型的游客建立接收方不可见 pending；修复已集成。总控再次针对 test4156 执行 `verify-f4-sender-visibility.mjs`，55 HTTP / 23 断言通过，并在 dev4056 真实 H5 身份上核对未选类型、已有类型但私密两种发起都返回 404，接收方列表不增加。主动公开后首建 201、同向重试 200 同 ID，接收方可见并可回应。

总控另用三个新隔离 profile 从 **LAN H5 首页**进入本人名片，主动保存类型、公开并维护字段，实际操作申请、接受、已接受撤回、重新申请后拒绝、再次接受、屏蔽和解除。A 为 ESTJ，B 为 INFP，C 为 ESTJ，公开 ID 各异。四项字段关闭后，公开卡、搭子详情及交换内嵌投影都不包含 B 的合成私密标记。发起方冒充接收方回应 409；C 持 ID 回应 404。屏蔽后双方公开读取、新申请、旧回应均为 404；解除后旧关系仍 revoked，旧回应 409。没有 F5 占位调用或假授权。

开发 API 再次 stop/start，原三 profile 刷新后凭证未重领，card ID、字段可见性、declined/revoked 终态及空屏蔽列表均保留。原 F1 A 的 `8a3d4793-93ab-43e4-8988-d3b6962d4b32` / `4b177e28-89d8-410f-ad90-b111a9e66e83` 仍返回 200；原 F3 `MBTI-8aa0b305-9c93-4dfb-9817-7f4a82c2a804` 在原浏览器状态、列表及真实运营只读入口仍一致：990 CNY 分、pending、未解锁、支付通道未配置。匿名/游客运营读 401，无权限管理员 403，外部游客读订单 404，dev 合成支付入口 404。

去敏的总控实际界面、状态与重启证据见 [MBTI-F4-DEV-H5-EVIDENCE.json](MBTI-F4-DEV-H5-EVIDENCE.json)，仅含本轮合成数据、公开 ID 和方法/状态，不含凭证或请求头。

## 总控检查

在集成树执行 Prisma generate、API typecheck/build、Foundation 完整 lint、Web `test:api` 25/25、Web type-check、LAN 参数 build:h5、diff check，均退出 0。`smoke.py --base http://192.168.0.200:4056/api/v1 --phase F2` 退出 0（包含 F1）：A 两结果 `b564ffa3-3e17-43a6-b11a-8b35a73c0033` / `ccdc4dc7-31de-405d-93a8-622a1ad20615`，B 跨用户 404，交卷 201/409，真实分享图片和比较/删除通过。开发迁移、两次 API READY、既有 `verify-dev-ops.mjs` 均退出 0。

浏览器验收临时脚本有四次检查辅助代码失败：accepted 的中文状态误写为“已接受”、同 URL 未触发刷新、刷新后 Network 捕获中误期望初次发行、误在订单状态响应读取金额。已按实际 UI 文案、显式刷新、刷新不重领号及订单列表金额字段纠正，从已落库步骤继续验证，没有重放已完成写操作或把失败计为通过。最终完成脚本和去敏证据均通过；金额在订单列表及运营响应核对。

## 可用性与后续

API/H5 均监听 `0.0.0.0`，本机通过 LAN 地址实测通过。**实习生另一物理设备和微信浏览器尚未实测**；不要把主机自测写成跨设备通过。主机、Orca 静态 H5 terminal 和专用 PostgreSQL 需要保持在线。恢复沿用 F3 交付的 owner 与开发命令；当前源码来自集成树，H5 静态目录 `/tmp/mbti-web-api-fast/h5-current`，API 配置与秘密仍只在 F1 owner 的 ignored 私有目录。

继续 F5 联系方式授权八项，再做 F6。真实外部支付供应配置仍单列阻塞；F6 尚缺自愿位置来源、距离口径与小样本门槛，可先交参与开关并明确人数不可用。F4 本轮没有收集位置、真实联系渠道或替代统计。
