# W24 章节生成后端与 SDK 交付

当前出口：四卡 CODE_VERIFIED / OWNER_CHECK_PENDING。后续本地开发按负责人已经授权的有限批次自动接续，人工验收、远端推送、供应商联调和发布各自独立记录。原 40 个目标与历史失败保持。

| 卡片 | 已交付 | 正式报告目录 | 本地提交 | 保守有效小时 |
|---|---|---|---|---:|
| AF226 | 来源、端口、7 个实际 Task 和并行边界 | AF-226/run-nmAOLR | e82166e070927db487d6128265e40f0673f3b2e0 | 1.15 |
| AF227 | 原文档同事务来源与会话门、持久来源结构 | AF-227/run-FDVjBr，104 项检查 | ead7ad105c2731bf1b436854fd07da1bd99e7fbb | 1.55 |
| AF228 | 原运行时、会话、费用和跨保留期来源绑定 | AF-228/run-u6VF5y，139 项检查 | 9dd90ef12c467ffdabf4d757b89fd43316db81b2 | 1.80 |
| AF229 | 私有生成 API、公共 SDK、仓库外和浏览器消费者 | AF-229/run-TvOwlQ，127 项检查及实包矩阵 | 本记录所在原标题提交；实际 SHA 在 I229 结果与卡片 receipt 回读 | 2.25 |

报告前缀为 `.artifacts/verification/`，最终报告全部 PASS，零跳过。各卡含重复回归。批次上限 4 卡 / 12 有效工程小时，保守合计 6.75 小时，含只读规划 0.5、治理 root 0.65、三 Worker 0.3/0.3/0.5，以及产品卡 root 1.25/1.5/1.75 小时和全部失败修复、验证、本地维护。

实际 DAG：GOV `task_934be74b6ad9`；I227 `task_2e4970206b58` → I228 `task_30adea22acfe` → I229 `task_4d76852ccaad`。三个注册 child 从已核验 origin/dev 创建，按冻结 165338 的 1085 个 Git blobs 独立 bootstrap、候选提交并 STOP；总控精确接收、串行共享接线与真实验收。Worker terminal 已释放，Worktree 与输出档案保留。

## 当前功能

- 在原文档 owner 内复用 project/plugin、当前成员角色权限、命名空间、文档行锁及原 session 校验，所有检查进入调用者的原事务。读取不要求导出权限；执行额外要求管理与执行权限。
- 选取完整当前章节，保留 Unicode、原始换行与 UTF8 hash。所选 slice 上限为 2000 UTF16 单元，包含标题与换行；原文档 65536 UTF8 bytes / 200 版本规则保持。
- 已发布的 text Agent 以 `source` / `instruction` 两个输入生成。预览绑定文档、Agent 版本与发布 epoch、catalog/model、原指令 hash、原模型成本估算上限。提交继续使用唯一原 Run/Job/reserve/Trace/settle owner。
- dispatch、credential IO 后及 provider IO 后复检当前来源、会话和 lease。未尝试失效释放预留；已尝试不确定保持 unknown/reserved，不返回结果、不自动重放。nonce 丢失后由原 reaper/reconciliation 处理。
- 新请求会话读取当前授权结果；按原请求键仅查回状态与来源是否仍当前。原内容 purge 后持久来源关系保留，旧 run/key/image 接口仍拒绝绕过。

四个接口均在 `/api` 下：

| 方法 | 路径 |
|---|---|
| POST | `/client/ai/document-generations/preview` |
| POST | `/client/ai/document-generations` |
| GET | `/client/ai/document-generation-runs/:id` |
| GET | `/client/ai/document-generation-requests/:key` |

公共 SDK `createPersonalDocumentGenerationClient` 对应 preview / submit / read / recover，每次显式操作一个原 ClientApi 请求，无自动 retry、poll、私有缓存或保存。生成不自动修改原文档。

## 实际证据

原 API、fresh PG、原权限/会话/文档/Agent/Job/Run/Trace/预算和计数本地 HTTP 上游真实运行；供应商回包为合成测试内容。完成两 App 同键一次提交、真实 reserve/enqueue/audit rollback、已存在原 Run 的 scoped FK/digest/immutable 拒绝、晚到失权、IO 前后来源和会话变化、nonce、purge 与旧接口回归。

新 SDK 经仓库外 fresh 安装的 ESM/CJS、NodeNext import/require 声明及实际 Orca browser/WebCrypto 验证。HTTP 在 POST 已落库后故意断开，只有一次 POST，显式原 key GET 查回。成功和 400/401/403/404/409/410/413/415/503 均检查 private/no-store、nosniff 和关联 ID；严格 JSON 包含重复/转义同名键、proto、非法 UTF8、非有限数、GET body、query、大小和媒体类型拒绝。未调用付费模型。

## 本地环境与人工检查

访问 http://127.0.0.1:3955/client/login ，API 为 http://127.0.0.1:3956/api ，自有 PostgreSQL 55435。正式 PASS 后原 CLI 受控升级并刷新；原 15 张表、初始凭据、环境与 owner 文件摘要保持，3 份原文档仍在。health/ready/登录/原章节读取正常；新 preview 空体 400、submit 默认关闭 503 且 private/no-store 已在此环境实测。原账号密码保持。

可先查看原文档、历史和手工章节草稿。章节生成预览、确认、结果应用与原保存页面进入下一批。长期环境模型、供应商存储、通知、支付及文档导出保持原关闭或延期策略；本次未向长期环境提交有效生成任务。临时 App、tab、relay、provider、consumer 和连接均关闭，测试库按原保护保留。

## 保留的失败与后续

AF227 首次正式失败与定向失败保留：原固定字体拒绝 emoji 导出；先建立支持字符的旧导出基准，再保存 Unicode 来源，并保留 emoji 导出 503 的真实拒绝测试。rollback 测试样例漏填必需资源字段已补齐。没有更改 renderer/font。

AF228 类型替换与旧离线 fixture 未声明新来源表导致的拒绝保留；精确修正后原 workflow/text/image 回归通过。AF229 `run-4BH2DZ` 的 Web target / BigInt literal 编译失败保留；改为同值 BigInt 构造形式，保持原 Web target 与栈版本，正式门禁和实包/浏览器重新通过。

下一批优先完成生成前端闭环：复用原任务恢复与 unknown 确认，明确预览来源/费用后提交，当前范围读取结果，交给原章节组合与原文档保存 owner；同步处理 scope/session/role/source 变化、blur/hidden/卸载及 restore/export 锁。复杂工作流、全 40 目标整体验收、真实供应商、容量和商业发布继续单独跟踪。

继承 WIP、AF208、用户 JSON/HTML/原型均受 hash 保护，未纳入卡片提交；无 push/main、远端 Issue/PR、包发布或部署。负责人对本批的人工接收仍 PENDING。
