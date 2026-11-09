# W18 负责人待审交付

状态：CODE_VERIFIED / OWNER_CHECK_PENDING。本波完成个人 start→一个已发布私有 Agent→end 的发布、手动执行、HTTP 与公共 SDK 闭环。原草稿历史、Run/Job/Trace/预算/文件与认证 owner 继续复用。不是完整编排或底座目标验收。

| 卡片 | 实际改动与验证 | 本地提交 |
| --- | --- | --- |
| AF204 | 固定合同、实际依赖、注册与源码边界；run-vpzK6G PASS1+3 | 54dda0f205c8e2cadd4972e1f73180019a4cf16c |
| AF205 | 不可变发布、CAS/epoch/ABA、原 Agent pin、范围权限、原会话与事务审计；run-kdGEIz PASS2+10 | 28e1f19a0a7dfc757ef3d2ce628d495fe1512bc6 |
| AF206 | 统一原运行账本与不可变来源，IO/lease/nonce/会话前后复检；run-ZW8dw3 PASS2+11 | f7177233dbef31d81e32b23b2f22a7c6ca684925 |
| AF207 | 七个 HTTP/SDK 方法、严格 JSON/UTF8/媒体类型、实包恢复、旧公共接口来源隔离；run-JRsbQy PASS2+12 | 包含本文件和 AF-207 执行记录的原名提交 |

AF207 最终验证：56 单元、61 目标保护、12 个真实 Cookie/PG/HTTP/runtime 场景（13 TAP）、仓库外安装 ESM/CJS/NodeNext 实包的 80 文件字节核对、4 消费者检查，原发布/目录文本与图片及附件/私有 Agent 回归 34 TAP 严格串行通过。并发同 key 仅一 Run/Job/reserve/origin/Trace/实际合成上游；真实服务端已提交但响应丢失仅一次 POST 后显式 GET 恢复；只读权限不隐含执行，晚撤权/晚撤会话拒绝释放输出。所有自有 API/proxy/provider/peer/数据库池/socket 关闭，测试库保留且未 reset/drop。

独立 Astra 只读复核 task_2db3b73cccfd 发现旧 client/ai 查询仅 aiRead，可绕过新工作流检查的 P1。root 修复后 task_10d17f403b02 / msg_a546b644ad96 确认关闭，无直接引入的新阻塞。旧读/恢复/图片入口拒绝 marker 或持久 origin（含 snapshot 保留期清除）；内部共享 driver 保持原实现。旧失败 run-TJ4iBl 与修复前 PASS2DpU26 原样保留，不以新结果回填历史。

数据库影响：205/206 为原 head 发布字段及不可变 publication/origin 关系、范围 FK/触发器和 active 系统 OWNER 增量权限。207 不新增数据库结构或账本。API 新 prefix `/api/client/workflow-executions`，菜单/页面未新增；日志仅有界无正文审计，不输出会话/凭据。实际差异及命令见各执行记录和登记 registry；本次已运行 `AIJ_VERIFY_WRITER=AF-207 pnpm verify:task -- AF-207`。

人工验收：按本地环境说明启动独立 API/Web，使用个人空间创建 Skill/Agent 并发布，保存三节点工作流，以公共 SDK 发布/预览/提交，查询同 key 恢复及原任务结果；撤销发布/任一读取权限后确认新接口拒绝，旧 AI 读/恢复/图片对该工作流始终 404；复杂草稿可保存但发布拒绝。当前没有常驻访问地址；真实渠道密钥空，执行使用自有合成上游证据，厂商仍 DEFERRED_NOT_PASSED。

未完成：多步骤/条件/并行/循环/人工审批/自主任务、多 Agent、可执行 Skill 产品链路、执行 UI 及其他完整需求。AF191、AF203 原生辅助功能环境与原失败仍待处理；其现存差异未纳入本波提交，后续必须按新已验证依赖重新冻结并完成原门禁。完整 40 条仍 NOT_RUN_TARGET_ACCEPTANCE，Owner 接收 PENDING。下一有限批次建议可执行私有 Python Skill（source/version→Job/sandbox→结果附件/API/SDK）；只读规划 task_818505247af3 不是产品交付。无 push、远端 Issue/PR、main 合并、部署、发包。
