# MBTI Foundation 协作规则

先遵守仓根 `../AGENTS.md`。本目录属于 `weiyang86/mbti`；独立仓 `weiyang86/aij-foundation` 仅为上游来源。

- 当前导入来源、适配差异和接入边界以 `README.md`、`MBTI_INTEGRATION.md`、`UPSTREAM_IMPORT.json` 为准。
- `AGENTS.upstream.md`、`README.upstream.md`、`docs/current/`、AF 队列及 Orca 派工记录都是上游历史材料。其原工作区、Task/Dispatch ID、授权、Git 节点、服务地址和通过记录不作用于本仓，不自动启动或续跑上游任务。
- 本仓日常开发以 `dev` 为集成分支。一次变更一个 Writer，保留其他人的修改。当前负责人已授权本次导入创建 PR 并合并到 `dev`；不得由此推导后续合并 `main`、部署或发布授权。
- 保留 `web/`（UniApp）、`admin/`（业务后台）和本目录通用宿主之间的职责；不得未经指派重构业务端或定稿根 `docs/api/` 契约。
- 通用能力复用本目录已有 owner，不复制多套认证、权限或 AI/通知/支付账本。业务身份、测试结果、订单及权益由 MBTI 业务模块负责；业务 API 缺字段时记录 unknowns / needs_human_review。
- 运行时使用 `RUNTIME_PROFILE=project`、`PROJECT_ID=mbti-foundation`；独立配置数据库、Cookie、issuer、密钥及存储，不连接上游或其他项目的数据库和运行目录，不链接其 node_modules。
- 不直接运行仍带上游固定目标的 `db:*`、`base:dev`、`ai:local` 或 AF 数据库验收工具。任何数据库操作先核验本仓独立目标与适用保护。
- 不提交真实 `.env`、密钥、用户数据、上传、日志、构建或依赖。模型、通知、支付等真实外部调用必须有对应业务配置和执行授权。
- 在本目录安装依赖和运行适用 lint / typecheck / test；上游 AF 验证依赖原仓环境，不能作为本仓自动通过或业务验收。交付写清实际结果、未运行项和剩余适配。
- 保留来源与第三方许可；不得将本次源码导入解释为新增开源许可证或包发布授权。
