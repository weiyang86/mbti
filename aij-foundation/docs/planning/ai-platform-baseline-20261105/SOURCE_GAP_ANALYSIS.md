# AIJ 底座源码复用与缺口分析

对照 AIJ-REQ-20261105-R1，源码基线 `b8eb9c2ecc4cca749c5dd1d38dc43489cda3a01c`，本轮审查237个已跟踪源文件路径，逐项引用48个带SHA-256和行号的源码/历史记录锚点。本文为静态审查；历史PASS仅作为已有验证记录引用，未重跑DB、厂商、页面或构建，也未将未知功能当作已验收。完整结构化数据见[追溯表](traceability.json)。

## 一 结论与分类

保留现有模块化单体与唯一owner，逐能力升级，避免从零重建。当前可复用的工程资产明显多于持续Base的四个菜单；但源码出现类、manifest字段或接口枚举，不代表新目标已交付。

| 分类 | 含义 | 本轮需求行数 |
| --- | --- | --- |
| REUSE | 已有核心实现可作为该需求的基础，仍需按新制品回归，不等于负责人接收 | 2 |
| UPGRADE | 已有部分实现/接口/场景，需要扩展或重新产品化 | 24 |
| MISSING | 本次核验范围没有目标实现；相邻现有模块仍可复用 | 14 |

计数以40条需求为单位，不是完成率、工时或已完成卡数。MISSING由相邻实现的明确约束与有界检索支持，不能把未命中文本模式当作全库语义证明。

## 二 必须保留的实现与关键边界

- 管理员/客户Auth、RBAC、菜单、Workspace、SecretRef、FileAsset、AsyncRuntime及交易/投递owner继续复用。旧目标的客户认证已经有注册、邮件验证、改密、找回、退出和撤销，不能受历史F00文字影响而重做一套。
- 当前客户登录DTO是email/password；手机号验证码和客户端username目标需适配，而不是仅改字段label。
- 文件服务注入LocalStorageAdapter，客户上传限定workspaceId=null，5MiB及少量媒体类型。PDF能上传不等于知识解析；组织共享文件与七牛均需要新增适配和授权验证。
- 模型目录仅text/image；Skill是instructions，编译为系统提示词。真实Provider使用非流式chat/completions和单图生成，返回tool_calls会拒绝。模型目录可配置不同厂商不等于图片理解/编辑、向量、重排、工具Agent或真实阿里云已支持。
- Agent目录是项目ScopedConfig中的受控文档，版本号和变更审计可保留，但不是个人/组织可编辑资产库；Run有快照和unknown保护，不能为自动切换把它删除。
- 知识导入只接受UTF-8文本类，检索是词项匹配；不会执行PDF/Office/OCR/网页同步、向量或重排。
- Runtime的orchestrated job只是执行模式，不是可视化图引擎。已有Job/Event/Schedule/Webhook基础可承担新触发入口，不复制队列。
- PluginManifestV2具备声明校验；真实代码由静态可信注册提供。已有数据库启停/升级状态不等于在线下载第三方包、完整插件SDK或插件A升级时B不停服。
- 通知枚举有六类，但真实运行注册表为空，未含钉钉/公众号/小程序；支付非测试Provider也为空。已有回调/退款/合成对账不等于真实商户收款、订阅、分账或结算。
- create只写aij.project.json、.env.example、.gitignore、README；普通seed绑定host。私有pack和合成整库/文件恢复场景应复用，不能当作任意新项目已开箱或组织时间点恢复。
- @aij/core有实际导出，但范围有限；UNLICENSED及保留许可声明阻断未经授权的公开发布，不阻断继续在本仓库审定范围内核验。

## 三 逐需求差距与主验收阶段

每行的原有资产及目标约束以编号引用下一节。完整成功/拒绝场景见[阶段与验收](DELIVERY_AND_ACCEPTANCE.md)。

| 需求 | 能力 | 分类 | 源码依据 | 主验收阶段 | 确认依据 |
| --- | --- | --- | --- | --- | --- |
| REQ-001 | 独立部署 | UPGRADE | E37, E38, E39, E40 | M1 | D01, D07 |
| REQ-002 | 装配配置 | UPGRADE | E37, E38, E45 | M1 | D07 |
| REQ-003 | 工作台与SDK | UPGRADE | E04, E23, E44, E45 | M2 | D07 |
| REQ-004 | 管理员及系统管理 | REUSE | E01, E02, E03, E13, E47 | M1 | D01, D04 |
| REQ-005 | 客户端身份 | UPGRADE | E05, E06, E36 | M1 | D12 |
| REQ-006 | 个人与多组织 | UPGRADE | E07, E08, E09, E10 | M1 | D02, D12 |
| REQ-007 | 动作授权 | UPGRADE | E02, E07, E19, E26 | M3 | D04 |
| REQ-008 | 统一附件与七牛 | UPGRADE | E10, E11, E12 | M2 | D05, D14 |
| REQ-009 | 多源知识导入 | UPGRADE | E11, E24, E28 | M2 | D05 |
| REQ-010 | 检索与引用 | UPGRADE | E07, E24, E25 | M2 | D05, D08 |
| REQ-011 | 首批模型能力 | UPGRADE | E14, E15, E18 | M2 | D08, D14 |
| REQ-012 | 多级厂商配置 | UPGRADE | E13, E14, E20, E23 | M3 | D04 |
| REQ-013 | 受控切换 | UPGRADE | E18, E21, E22 | M3 | D08, D15 |
| REQ-014 | 计量与对客结算 | UPGRADE | E21, E22, E34 | M7 | D08, D15 |
| REQ-015 | 多级Agent资产 | UPGRADE | E16, E17, E20, E23 | M3 | D01, D03, D04 |
| REQ-016 | 可执行Skill包 | MISSING | E16, E17, E19 | M3 | D03, D04 |
| REQ-017 | 多Agent协作 | MISSING | E17, E19, E26 | M4 | D09 |
| REQ-018 | 长期记忆 | MISSING | E20, E21 | M3 | D09 |
| REQ-019 | 可视化与自主执行 | MISSING | E19, E26, E27 | M4 | D03 |
| REQ-020 | 五种触发入口 | UPGRADE | E23, E26, E28 | M4 | D09 |
| REQ-021 | 任务中心与可靠性 | UPGRADE | E21, E26, E27, E46, E48 | M1 | D09, D15 |
| REQ-022 | 在线文档与导出 | MISSING | E23, E24 | M5 | D05, D06 |
| REQ-023 | 图表编辑与生成 | MISSING | E18, E11 | M5 | D03, D06 |
| REQ-024 | 完整插件开发 | UPGRADE | E29, E30, E42, E43, E44 | M6 | D10 |
| REQ-025 | 生命周期与局部升级 | UPGRADE | E29, E30, E31, E41 | M6 | D11 |
| REQ-026 | 两层市场 | MISSING | E29, E30, E42 | M7 | D02, D06 |
| REQ-027 | 商业授权 | MISSING | E29, E32, E42 | M7 | D10 |
| REQ-028 | 真实支付渠道 | UPGRADE | E32, E33, E34 | M7 | D12, D14 |
| REQ-029 | 订阅续费 | MISSING | E32, E33 | M7 | D14, D15 |
| REQ-030 | 优惠券 | MISSING | E32, E34 | M7 | D14 |
| REQ-031 | 分账与结算 | MISSING | E32, E34 | M7 | D14 |
| REQ-032 | 任务退款与余额 | UPGRADE | E21, E22, E33, E34 | M7 | D15 |
| REQ-033 | 全部通知渠道 | UPGRADE | E26, E28, E35, E36 | M2 | D11 |
| REQ-034 | Linux私有化与升级 | UPGRADE | E38, E39, E40, E41 | M8 | D13 |
| REQ-035 | 整实例灾备 | UPGRADE | E41, E46 | M8 | D13, D15 |
| REQ-036 | 组织恢复与冲突 | MISSING | E07, E10, E41 | M8 | D13, D15 |
| REQ-037 | 资源版本恢复 | MISSING | E20, E24, E41 | M8 | D13, D15 |
| REQ-038 | 保留周期 | MISSING | E21, E41 | M8 | D15 |
| REQ-039 | 唯一真值与权限复检 | REUSE | E07, E10, E21, E26, E33, E36 | M1 | D01, D04, D15 |
| REQ-040 | 真实验收与运营状态 | UPGRADE | E27, E46, E47, E48 | M1 | D07, D11, D13, D16 |

## 四 源码锚点与复用限制

锚点的完整文件摘要与短摘录保存在traceability.json；所有路径都相对同一源码HEAD。后续源码修改后需重新生成/核验，不能拿此快照代表新制品。

| 锚点 | 源文件 | 本轮源码结论 |
| --- | --- | --- |
| E01 | [apps/api/src/auth/auth.service.ts:19](../../../apps/api/src/auth/auth.service.ts#L19) | 复用管理员认证 owner；不是客户端短信登录实现 |
| E02 | [apps/api/src/rbac/permissions.service.ts:8](../../../apps/api/src/rbac/permissions.service.ts#L8) | 复用服务端即时权限解析 |
| E03 | [apps/api/src/menus/menus.service.ts:17](../../../apps/api/src/menus/menus.service.ts#L17) | 复用后端菜单授权 owner |
| E04 | [apps/web/app/admin/page.tsx:2](../../../apps/web/app/admin/page.tsx#L2) | 通用工作台已移除bootstrap页面权限门槛 |
| E05 | [apps/api/src/client-auth/dto.ts:5](../../../apps/api/src/client-auth/dto.ts#L5) | 客户登录 DTO 使用 email/password，未实现本轮用户名及短信验证码登录目标 |
| E06 | [apps/api/src/client-auth/client-auth.controller.ts:18](../../../apps/api/src/client-auth/client-auth.controller.ts#L18) | 已有客户注册、邮件验证、找回及会话生命周期路由 |
| E07 | [apps/api/src/client-workspaces/workspace-context.service.ts:11](../../../apps/api/src/client-workspaces/workspace-context.service.ts#L11) | 服务端以真实 membership/role/permission 校验工作区 |
| E08 | [apps/api/src/client-workspaces/client-workspace-management.service.ts:167](../../../apps/api/src/client-workspaces/client-workspace-management.service.ts#L167) | 已有OWNER/MEMBER系统角色与成员治理，不等于完整自定义租户角色设计器 |
| E09 | [apps/api/prisma/schema.prisma:428](../../../apps/api/prisma/schema.prisma#L428) | 项目归属组织模型与ClientWorkspace分开 |
| E10 | [apps/api/src/files/client-files.service.ts:71](../../../apps/api/src/files/client-files.service.ts#L71) | 现有客户文件按成员归属并限定workspaceId=null，不能当作组织共享文件完备实现 |
| E11 | [apps/api/src/files/client-files.dto.ts:11](../../../apps/api/src/files/client-files.dto.ts#L11) | 客户附件当前5MiB，支持JPEG/PNG/WebP/PDF/text，上传PDF不等于解析PDF |
| E12 | [apps/api/src/files/local-storage.adapter.ts:19](../../../apps/api/src/files/local-storage.adapter.ts#L19) | 本地存储 owner 可复用；未提供七牛适配 |
| E13 | [apps/api/src/secret-center/secret-ref.ts:11](../../../apps/api/src/secret-center/secret-ref.ts#L11) | 复用受控密钥引用解析，不把厂商密钥交给脚本 |
| E14 | [apps/api/src/plugins/aij-ai/ai-center-policy.ts:58](../../../apps/api/src/plugins/aij-ai/ai-center-policy.ts#L58) | 模型目录是项目级受控配置，供应商为openai/deepseek/compatible |
| E15 | [apps/api/src/plugins/aij-ai/ai-center-policy.ts:74](../../../apps/api/src/plugins/aij-ai/ai-center-policy.ts#L74) | 目录能力仅text/image，向量/重排/图片编辑等需升级 |
| E16 | [apps/api/src/plugins/aij-ai/ai-center-policy.ts:93](../../../apps/api/src/plugins/aij-ai/ai-center-policy.ts#L93) | Skill配置项仅instructions等提示词字段，无可执行能力包契约 |
| E17 | [apps/api/src/plugins/aij-ai/ai-center-provider.ts:13](../../../apps/api/src/plugins/aij-ai/ai-center-provider.ts#L13) | Agent与Skill通过系统提示词拼接 |
| E18 | [apps/api/src/plugins/aij-ai/ai-center-provider.ts:42](../../../apps/api/src/plugins/aij-ai/ai-center-provider.ts#L42) | 实际协议是非流式chat/completions及单图images/generations |
| E19 | [apps/api/src/plugins/aij-ai/ai-center-provider.ts:81](../../../apps/api/src/plugins/aij-ai/ai-center-provider.ts#L81) | 文本返回工具调用被拒绝，不能宣称已有自主工具Agent |
| E20 | [apps/api/src/plugins/aij-ai/ai-center-configuration.service.ts:29](../../../apps/api/src/plugins/aij-ai/ai-center-configuration.service.ts#L29) | 目录存于项目ScopedConfig，版本号/变更审计可复用；不是个人/组织资产仓库 |
| E21 | [apps/api/src/plugins/aij-ai/ai-center-run.service.ts:110](../../../apps/api/src/plugins/aij-ai/ai-center-run.service.ts#L110) | 已有提交幂等、快照、unknown保留预留与Trace，不可盲目改为错误自动重试 |
| E22 | [apps/api/src/plugins/aij-ai/ai-center-budget.service.ts:17](../../../apps/api/src/plugins/aij-ai/ai-center-budget.service.ts#L17) | 已有内部预算预留与结算，不等于客户现金钱包或充值账本 |
| E23 | [apps/api/src/plugins/aij-ai/ai-center-client.controller.ts:32](../../../apps/api/src/plugins/aij-ai/ai-center-client.controller.ts#L32) | 客户直接执行默认受显式开关与Workspace权限约束 |
| E24 | [apps/api/src/plugins/aij-ai/ai-knowledge.service.ts:153](../../../apps/api/src/plugins/aij-ai/ai-knowledge.service.ts#L153) | 已有知识文档API，导入仅UTF-8文本类 |
| E25 | [apps/api/src/plugins/aij-ai/ai-knowledge-retrieval.ts:33](../../../apps/api/src/plugins/aij-ai/ai-knowledge-retrieval.ts#L33) | 检索使用词项匹配，无外部tokenizer或向量模型调用 |
| E26 | [apps/api/src/async-runtime/registry.ts:40](../../../apps/api/src/async-runtime/registry.ts#L40) | 复用Job/Event/Schedule注册和执行模式；名称orchestrated不是图编排引擎 |
| E27 | [apps/api/src/async-runtime/runtime-worker.service.ts:11](../../../apps/api/src/async-runtime/runtime-worker.service.ts#L11) | 复用队列/租约/心跳/取消基础；已知差量仍需关闭 |
| E28 | [apps/api/src/integration-center/connector-webhook.service.ts:42](../../../apps/api/src/integration-center/connector-webhook.service.ts#L42) | 已有签名及幂等入站Webhook；不是用户可编辑的工作流触发器 |
| E29 | [apps/api/src/plugin-runtime/plugin-manifest.ts:30](../../../apps/api/src/plugin-runtime/plugin-manifest.ts#L30) | manifest已有依赖/权限/菜单/迁移/jobs/events声明及校验基础 |
| E30 | [apps/api/src/plugin-runtime/trusted-plugins.ts:8](../../../apps/api/src/plugin-runtime/trusted-plugins.ts#L8) | 运行代码由宿主静态导入可信AI/通知/支付注册，不会下载任意第三方包 |
| E31 | [apps/api/src/plugin-runtime/plugin-lifecycle.service.ts:235](../../../apps/api/src/plugin-runtime/plugin-lifecycle.service.ts#L235) | 已有生命周期与事务状态，升级要求先停用；不能推定其他插件业务不停服已验 |
| E32 | [apps/api/src/plugins/aij-payment/payment-runtime.module.ts:43](../../../apps/api/src/plugins/aij-payment/payment-runtime.module.ts#L43) | 非测试运行Provider注册表为空，仅隔离测试注册synthetic |
| E33 | [apps/api/src/plugins/aij-payment/payment-callback.service.ts:16](../../../apps/api/src/plugins/aij-payment/payment-callback.service.ts#L16) | 回调验签/幂等和交易状态 owner 可复用 |
| E34 | [apps/api/src/plugins/aij-payment/payment-reconciliation.service.ts:36](../../../apps/api/src/plugins/aij-payment/payment-reconciliation.service.ts#L36) | 已有合成交易对账及差异审计 owner，不等于商户真实结算 |
| E35 | [apps/api/src/plugins/aij-notification/notification-provider.ts:4](../../../apps/api/src/plugins/aij-notification/notification-provider.ts#L4) | 声明in_app/email/sms/wecom/feishu/webhook；未含钉钉和微信公众号小程序 |
| E36 | [apps/api/src/plugins/aij-notification/notification-runtime.module.ts:10](../../../apps/api/src/plugins/aij-notification/notification-runtime.module.ts#L10) | 真实运行默认无投递Provider；枚举不等于真实渠道可用 |
| E37 | [scripts/project/editions.mjs:13](../../../scripts/project/editions.mjs#L13) | 现默认base而非新目标ai-standard；仅base/ai-standard两种固定组合 |
| E38 | [scripts/project/cli.mjs:217](../../../scripts/project/cli.mjs#L217) | 生成器明确只创建配置，不提供独立宿主安装 |
| E39 | [scripts/database/seed.mjs:156](../../../scripts/database/seed.mjs#L156) | 普通seed绑定host；专用Base开发入口不能代替任意项目初始化 |
| E40 | [scripts/distribution/pack-aij-base.mjs:1](../../../scripts/distribution/pack-aij-base.mjs#L1) | 已有私有源码制品pack入口，应复用并核验消费范围 |
| E41 | [scripts/verification/packed-consumer-upgrade.test.mjs:381](../../../scripts/verification/packed-consumer-upgrade.test.mjs#L381) | 已有合成整库/文件备份恢复与升级测试，可复用场景，不是组织PITR产品 |
| E42 | [packages/core/package.json:5](../../../packages/core/package.json#L5) | 实包未获公开分发授权；不能因第三方市场目标直接公开发布 |
| E43 | [packages/core/src/index.ts:14](../../../packages/core/src/index.ts#L14) | 当前core实包导出关联ID等有限能力，不是全部Nest服务产品化包 |
| E44 | [packages/sdk/src/index.ts:53](../../../packages/sdk/src/index.ts#L53) | 已有客户API及Agent提交/读取SDK，可扩展非重写 |
| E45 | [apps/web/app/components/admin-ai-center.tsx:21](../../../apps/web/app/components/admin-ai-center.tsx#L21) | 已有管理员AI目录配置UI，不是完整客户端AI工作台 |
| E46 | [scripts/verification/product/catalog.mjs:46](../../../scripts/verification/product/catalog.mjs#L46) | 产品校验只有有限checks/database组，完整矩阵尚待扩展 |
| E47 | [docs/execution/AF-130.md:3](../../../docs/execution/AF-130.md#L3) | AF130有真实验证记录，此次仅读历史，不重跑、不代负责人接收 |
| E48 | [docs/execution/optimization-delta/AF-126.md:3](../../../docs/execution/optimization-delta/AF-126.md#L3) | 已知心跳重入/文档生命周期竞争/readiness与fixture前置差量未被审计PASS关闭 |

## 五 已知未关闭问题

AF-126审计明确保留PARTIAL_NOT_CLOSED：重入poll刷新心跳、文档编辑/无证据拒答生命周期竞争、readiness成功/故障恢复矩阵、旧fixture缺安装前置等。后续优先采集新鲜状态并复现，再拆小卡修复；不把审计中“成功复现缺口”的测试当作产品通过。AF-124及AF-130历史真实验证仍有价值，不反填更大范围或最新SHA通过。

当前正式队列AF-130/134/135为CODE_VERIFIED、负责人接收PENDING；AF-131的必要AF-127/077..080子范围接收仍待确认。本轮需求基线不代签历史批次，也不通过改队列解除门禁。

## 六 有界检索范围

审查API src、Web app、packages源码及Prisma Schema/project CLI，共237个路径。traceability.json保留具体列表和Qiniu、阿里云、商户适配、图定义、记忆、沙箱名称的检索结果。未匹配项只支持“在此范围及模式下未找到”；当前明确受限的协议、目录与静态注册是判断缺口的主要依据。
