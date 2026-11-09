# MBTI 仓内 Foundation 接入边界

## 来源和归属

本目录由负责人指定的已验证源码包导入，来源提交为 `8ba3d30271db8862798665fd81480cc6f573e696`，压缩包 SHA-256 为 `75cef0929f4b702922406323d5ea563f50a9d5e6348909c451bdcb8a3bf97765`。导入前 MBTI `dev` 基线为 `4ced57f7a92fc1b7dec67f88e0e68e4c64046a30`。

代码受本仓版本控制，不含嵌套 `.git`、submodule 或对上游工作区的符号链接。后续上游更新必须通过显式比对、适配和本仓 PR 接收；`UPSTREAM_IMPORT.json` 记录导入时原始文件的字节数和 SHA-256，不代表后续文件禁止修改。

保留 `docs/governance/SOURCE_PROVENANCE.md`、字体 LICENSE 和包内既有许可声明。上游的 private / UNLICENSED 声明不因本次导入而改变。

## 当前能力与业务边界

| 范围 | 本次交付 / 后续归属 |
| --- | --- |
| 通用身份、认证、RBAC、配置、文件、审计 | 现有基础源码；在本产品完成独立环境和配置验收后启用 |
| 模型、Agent、运行时、预算与执行记录 | 复用现有能力 owner；真实模型调用默认关闭 |
| 通用管理 UI | `aij-foundation/apps/web/`；不替代仓根 UniApp `web/` 或业务 `admin/` |
| 测评题库、计分、不可变结果、分享、阶段记录 | MBTI 业务模块，尚未由本次源码复制实现 |
| 微信登录和会话映射 | 待业务认证方案定稿；不把草案 token 当成通用后台有效身份 |
| 业务订单、价格、权益 | 业务 owner；调用 AI 前由服务端校验，不让前端绕过权益直接执行 |

基础宿主路由前缀为 `/api`；MBTI 草案为 `/api/v1`。源码复制没有建立这两者之间的映射，也没有把草案接口变为正式契约。根 `docs/api/` 的 pending / needs_human_review 状态保持。

现有 `@aij/sdk` 对应已有通用 API，不是 MBTI 草案客户端。基础客户认证使用已实现的会话校验、Workspace 成员关系和权限；它不是供任意项目传入 API Key 即可调用的通用免适配入口。

AI 业务模块可在可信服务端组合已有 `AiCenterRunService`，先校验本业务身份、订单/权益、预算和幂等语义。客户端直执开关 `AI_CENTER_CLIENT_EXECUTION_ENABLED` 继续为 false；不得用启用此开关代替付费业务授权。

## 本仓局部适配

- 重写本目录 README / AGENTS，保留完整上游版本为 `*.upstream.md`。
- pnpm 工作区根名称改为 `mbti-foundation`；内部 `@aij/*` 名称、依赖、锁定版本和实现保留，以维持源码内部引用。
- `.env.example` 改为 MBTI project profile：Web/API `4055/4056`，独立 issuer、Cookie 和存储前缀；数据库地址仅为关闭状态下的占位，密码为空或模板值。
- 为上游 `PROJECT_BRIEF.md` 及 `docs/current/` 主要入口添加快照说明；保留历史执行记录和源码证据，不回填为 MBTI 验收。
- 基础 API 装配测试按实际运行配置检查项目身份和 CORS，消除对上游固定服务名、origin 的依赖，支持 MBTI 示例配置下的回归。
- 仓根 README / AGENTS 的目录说明更新为已导入源码层；UniApp、产品 HTML、业务后台占位和 API 草案不作业务改动。

## 下一开发批次

1. Remy 定稿 MBTI API 的认证和字段 unknowns，确定匿名体验与微信身份如何映射；保留契约版本。
2. 为 MBTI 创建独立开发/测试数据库和实例归属保护，适配迁移/Seed/启动工具；不得直接复用上游固定数据库命令或现有实例。
3. 实现 MBTI 测评 → 结果快照 → 分享预览 → 阶段记录的服务模块，消费通用认证、权限与审计；按正式契约联调 UniApp。
4. 配置业务后台入口及 AI 使用场景，需要时再启用受预算限制的模型调用；完成本仓真实成功/拒绝路径验收后安排部署。

这些事项不属于本次源码导入已完成的业务功能。复制、编译或健康检查均不等于商业化上线验收。
