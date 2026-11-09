# MBTI 项目通用 AI 支撑交付计划

基线：dev / d8847d2。当前版本是模块化 Alpha，不能直接承诺完整支持 MBTI 上线。已有认证、Workspace、SecretRef、文件、队列、Trace 和支付轨道；缺少通用 AI 配置/执行闭环及真实支付 Provider。

本批 4 节点，Codex 唯一 Writer，预计每卡 3 有效工程小时；逐卡注册 verify:task、通过后按原标题提交并快进推送，最终统一 review。保留历史 ownerAcceptanceRecords。所有真实厂商请求默认关闭，隔离数据库与 loopback HTTP 验证。DeepSeek 上游用途/区域/删除确认条件继续生效。

| 任务 | 范围 | 验收 |
| --- | --- | --- |
| AF-121 异步任务租约围栏与 AI 插件生命周期修复 | 旧租约/重复 admission、worker 心跳、AI 管理目录与停用门禁 | 隔离 PostgreSQL 复现与拒绝路径；恢复后可执行 |
| AF-122 通用 AI 厂商模型与 Agent Skill 配置中心 | 多连接/模型、可版本化 prompt Skill、Agent 绑定、价格与预算配置、管理权限 | 配置校验、跨项目拒绝、版本冲突、禁用状态 |
| AF-123 通用 Agent 文本生图执行与预算计量 | Workspace 客户调用、现有队列与 Trace、内部预算账本复用、持久运行、图片文件 | 幂等/预算并发/租户隔离、文本与生图 HTTP、未知结果保守保留预算 |
| AF-124 AI 中心后台与 MBTI 接入统一交付 | 沿用 AntD 后台，配置与用量，接入材料、集成回归 | production build、接口/SDK消费、统一 review |

MBTI 题库、评分、搭子关系、订单与付费权益由业务项目持有。底座提供通用 Agent，首版 Skill 为可复用提示词指令；不引入任意代码、MCP 工具执行。首批采用已核对的 Chat Completions / Images HTTP 协议，模型 ID 与价格由管理员配置，不承诺任意厂商协议直接兼容。真实商户支付接入待用户确定渠道后独立实现；本批不虚构商户可用。
