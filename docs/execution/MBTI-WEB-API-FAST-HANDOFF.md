# MBTI Web API Fastlane 联调交接

2026-11-09；Run `run_594d408d15de`。F1–F5 和 F6 参与开关已完成开发验收；#46 已提供明确不可用响应，真实位置人数统计仍缺外部数据和业务口径。全部为内部联调候选，不是生产发布；代码合入 `dev`，未合 `main`。

## 实习生使用

| 项目 | 实际地址/版本 |
| --- | --- |
| 完整 API 基址 | **https://mbti-dev.bestshizhongyu.com/api/v1** |
| H5 首页 | **https://mbti-dev.bestshizhongyu.com/#/** |
| HTML 接口文档 | **https://mbti-dev.bestshizhongyu.com/api-docs/**；[离线文件与构建说明](../api-reference/README.md) |
| 汇总 OpenAPI | https://mbti-dev.bestshizhongyu.com/api-docs/openapi.json；[仓内文件](../api-reference/openapi.json) |
| 业务探活 | https://mbti-dev.bestshizhongyu.com/api/v1/health |
| 宿主含数据库就绪 | https://mbti-dev.bestshizhongyu.com/api/ready |
| 题库 | `qb-v0.4-prototype-1`，12题、四维各3题；旧教学版本保留 |
| Web 配置 | `VITE_USE_MOCK=false`，`VITE_API_BASE_URL=https://mbti-dev.bestshizhongyu.com/api/v1`；同源可用 `/api/v1` |

联调统一使用上述HTTPS域名，公网服务器已部署本批API/H5；`/api-docs/`由Nginx直接提供，避免H5回退成首页。公网服务器与本机LAN使用独立数据库及游客身份，旧LAN凭证和结果ID不能混用；各浏览器在域名环境领取自己的凭证。域名专项实测见 [域名交付](MBTI-DOMAIN-ACCESS-DELIVERY.md)，实习生另一物理设备与微信端仍待实际反馈。此前LAN验收和原身份重启证据保留于各批回执，供历史复核。

首次调用 `POST /auth/guest`，201 返回 `{guest_token,expires_at}`；后续带 `X-Guest-Token`。每个浏览器独立持有并刷新复用，当前请求层会合并并发初始化；401 明确处理失效，不静默换号或重放写操作。响应为裸业务对象，错误为 `{code,message}`。当前 H5 可从首页直接完成测评、自选、历史/分享、订单、名片/交换、联系方式授权和参与选择。

HTML 文档覆盖下方41个操作，支持按模块/方法/可用状态筛选、字段搜索、逐状态响应、cURL/JavaScript示例和下载；其中40项可联调，#46仅有不可用分支。单文件可离线查看，不发起API请求。原始候选文件仍是各批次联调来源，汇总页不把未确认规则升级为正式契约；[文档交付检查](MBTI-API-REFERENCE-DELIVERY.md)。

供导入/复测的候选文件：

- [F1/F2 原始13项候选 OpenAPI](../integration/fastlane/MBTI-WebAPI-13.openapi.yaml)、[原始12题及计分fixture](../integration/fastlane/fixtures/quiz-candidate.json)、[smoke.py](../integration/fastlane/smoke.py)：从用户输入包逐字节复制，未改契约或测试口径。
- [F3 交易候选](../integration/MBTI-F3-candidate.openapi.yaml)。
- [F4 名片搭子交换候选](../integration/MBTI-F4-runtime-candidate.openapi.yaml)。
- [F5 联系方式授权候选](../integration/MBTI-F5-runtime-candidate.openapi.yaml)。
- [F6 参与及不可用候选](../integration/MBTI-F6-runtime-candidate.openapi.yaml)。

在仓根复测（专用开发库，脚本会新建合成游客/结果）：

```sh
python3 docs/integration/fastlane/smoke.py --base https://mbti-dev.bestshizhongyu.com/api/v1 --phase F1
python3 docs/integration/fastlane/smoke.py --base https://mbti-dev.bestshizhongyu.com/api/v1 --phase F2
```

F2 包含 F1。此前LAN实测的最终 F2 两结果为 `63b760eb-e3a4-4193-bfa2-678dc65a511f` / `3ff6ceca-d4c5-4a89-bf71-2a509c2e5743`，B列表为空、跨用户404、并发交卷201/409，真实分享图片和比较/删除通过。原LAN H5 两次 ESTJ/INFP 结果在历次 API 重启后仍可读，详见 F1/F6 回执；不把这些ID当作公网服务器的验收证据。

## 批次验收与边界

| 批次 | 序号 | 交付结果与证据 |
| --- | --- | --- |
| F1 | 1、2、4–9，8项 | [通过](MBTI-WEB-API-F1-DELIVERY.md)：独立游客、12题真实计分、两次不同结果、A/B隔离、并发201/409、原身份重启 |
| F2 | 10、11、12、14、17，5项 | [通过](MBTI-WEB-API-F2-DELIVERY.md)：本人删除/对比、自选、16型元数据、真实图片预览 |
| F3 | 47–50、53，5项 | [通过受控测试交付](MBTI-WEB-API-F3-DELIVERY.md)：服务端商品/下单幂等、本人订单/权益、真实运营认证同号查单；真实支付通道未配置 |
| F4 | 24–35，12项 | [通过](MBTI-WEB-API-F4-DELIVERY.md)：默认私密、字段投影、双向屏蔽、角色与并发状态、解除不复活 |
| F5 | 36–43，8项 | [通过](MBTI-WEB-API-F5-DELIVERY.md)：私密存储、明确单向渠道、接受前/第三人拒绝，撤回/清除/改值/屏蔽等永久失效 |
| F6 | 44、45，2项 | [通过](MBTI-WEB-API-F6-DELIVERY.md)：本人显式参与/退出、私密名片类型、原身份持久化，不收位置 |
| F6 | 46，1项 | 明确不可用分支通过；真实人数/半径/小样本/聚合屏蔽 **blocked_external**，缺自愿位置与授权、距离/半径口径、经确认披露政策 |

共40项业务操作通过本轮开发验收，另1项提供不可用分支；不能据此声称41项真实能力或真实支付/人数全部通过。`API-REVIEW.md` 所列其余12项有条件能力没有被本轮隐式启用。

最终开发集成检查包括 Foundation 完整 lint、API typecheck/build、83项后端测试、39项 Web 测试、Web type-check/build、官方smoke、LAN H5 多浏览器与重启复验。逐项成功、拒绝、命令退出码、原候选/实测源码SHA及未验项见各批回执；最终 `dev` 合入提交以 GitHub PR/仓库HEAD为准。

F3 同号测试订单 **`MBTI-8aa0b305-9c93-4dfb-9817-7f4a82c2a804`**：990 CNY分、pending、未解锁。运营通过现有 Foundation 登录/RBAC 读取 `/api/admin/mbti/orders/{id}` 为200；匿名/游客401、无权限管理员403、他人游客业务订单404，dev合成支付入口404。运营凭证只在开发主机忽略的私密配置，未放入仓库或交接包。

## 本机LAN保留环境和后续输入

当前源码/独立构建树：`/Users/lei/orca/workspaces/mbti/mbti-web-api-fast-integration`。专用 PG/秘密 owner：`/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation`；dev仅回环55436、test仅回环55437，容器/卷/角色/marker分别隔离。不要清理该owner及持久卷来重建环境。当前dev已有43个迁移。

API用项目 `scripts/mbti-local.mjs` 核验归属、迁移与启停；恢复使用 `MBTI_LOCAL_OWNER_ROOT` 指向上述owner，以及 `MBTI_PUBLIC_ORIGIN=http://192.168.0.200:4056`，保留现有开发认证/运营身份。H5由 Orca terminal `term_6388bf13-8f20-4664-9b49-c89813a516a5` 的 Python 静态服务提供 `/tmp/mbti-web-api-fast/h5-current`，监听0.0.0.0:5173；指向已验F6构建并保留旧哈希资源，未热挂未验候选。API日志/PID/配置和测试原值仅在忽略的私有目录。

尚缺的外部输入分别处理：真实支付供应方/商户/证书/SecretRef及正式收费交付策略；F6自愿粗粒度位置来源、合法用途授权和撤回、身份关联、精度/时效、距离算法、半径边界与小样本披露政策。私密旧对象GC/物理擦除、游客到期留存和候选正式发布仍待业务审核。没有用假支付、假人数或全站计数替代；这些缺口不阻塞已就绪接口使用。

所有原批次Worker、F6准备与实现Worker均以真实Task/Dispatch成功回执交付；Run可按 `run_594d408d15de` 追溯。保留测试服务/profile用于后续复验，未删除数据或对main发布。
