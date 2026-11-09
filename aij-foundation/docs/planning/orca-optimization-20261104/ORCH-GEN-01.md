# ORCH-GEN-01 — 新增 base 与 ai-standard 配置契约

状态：PLANNED_NOT_DISPATCHED；尚未分配正式AF编号。该文件是派工模板，不是已开始任务。

角色：worker-P；预计4有效工程小时（含适用验证和集成预算）。涉及工作包：OPT-005。

## 目标与前置

仅交付以下子范围，不自动关闭工作包。实施前由总控登记正式AF编号、精确任务标题、被测基线与验证步骤；执行基线为本批已验证dev，起始值bb00ffd，后续卡以总控记录的集成SHA为准。 只有I-ORCH-GOV-01完成，且新工作区已确认环境准备好后，才可写入。

## 可写范围

- `scripts/project/cli.mjs`
- `scripts/project/editions.mjs`
- `scripts/test/project-configuration.test.mjs`
- `docs/development/PROJECT_EDITIONS.md`

受保护改动只能向总控提交精确建议/补丁请求，不能自行修改：`scripts/runtime-environment.cjs`, `scripts/database/seed.mjs`。除列出范围及本卡独立执行记录外，不改其他任务文件。

## 验收

1. base默认无插件；ai-standard显式声明可信AI依赖、允许转发的非秘密配置及SecretRef变量名，未知edition/插件拒绝。
2. create/show项目身份保持隔离，不能通过手改PROJECT_ID绕过约束，不复制真实.env或密钥。
3. 仅关闭配置子范围；独立项目Seed、正常管理安装与可运行的AI消费证明留给GEN-02/03，不能宣称OPT-005整体完成。

## 共用约束与交接

- 同卡仅一个Writer；不使用旧barracuda初始分支，不修改原轻企仓库。
- 自有worktree安装自己的依赖，不跨worktree链接node_modules或上传目录；不改锁文件，不关闭其他进程。
- 不能迁移/清理开发、共享或正式数据库；当前DB验收先由原dev总控串行运行，直至工作区目标保护已专卡验证。
- 只做批准范围内的代码/离线验证，不做真实收费AI、支付或部署；现有DeepSeek上游门禁不变。
- Worker不得push dev或修改main/tag；候选提交仅供总控精确集成。
- 候选成果和本地检查不标为DEV_INTEGRATED或负责人接收；总控按现有流程执行正式verify:task、记录和逐卡提交推送。
- 回报：基线SHA、可分离差异或候选SHA、实际命令/退出码/证据、未运行项、schema/API/权限影响、共享文件请求、预计剩余时间与阻塞。
- 非零退出默认失败；若本卡目标是差量审计，捕获失败可以是审计成果，但对应功能仍未通过，须拆修复卡。
- 通过Orca worker_done回报；问题用ask，总控按现有授权答复。不得写脚本轮询check、重复发起worker、或用终端控制另一个worker。
