# 配置、密钥引用与审计Schema（AF-008）

AF-023当前增量：已接收AF-022；SecretRefPort及env/加密本地SecretStore已接入。敏感配置写额外要求admin.secret.manage，--configuration显式登记该权限依赖但不修复grant；local://引用可绑定，轮换时原子重绑/version+1，清除后消费拒绝。原阶段描述按历史保留，当前协议/实际地址与凭据路径见[密钥引用指南](SECRET_CENTER_API.md)。

AF-022当前服务/优先级/版本/公开过滤与实际人工API见[配置指南](CONFIGURATION_API.md)；本文原阶段模型数、旧PID与未实现状态按历史保留，不作当前进程归属或完整功能结论。

日期2026-10-19。唯一实现仍为`apps/api/prisma/schema.prisma`，沿用Prisma/client6.19.0。新增六模型，原十二模型/两枚举定义不变，当前共18模型/2枚举；本项不迁SysConfig或其他未指派模型。

AF-009阶段补充：当前共21模型/4枚举，新增范围见[文件插件Schema](FILE_PLUGIN_SCHEMA.md)。本文18模型/2枚举及68项是AF-008阶段快照；本套回归现在按原18模型/2枚举owner子集检查，全局业务禁入保留，完整当前模型/枚举由AF-009测试约束。

| 实际模型 / 映射表 | F00数据owner | 定义与约束 |
| --- | --- | --- |
| OrganizationProfile / organization_profile | AIJ configuration | 项目归属组织；code唯一、name必填、legalEntity/meta可空；projects仅指向ProjectProfile |
| ProjectProfile / project_profile | AIJ configuration | code唯一，organizationId必需FK；保留通用时区/币种/语言/环境默认值；brand为无默认载荷的可空JSON |
| ScopedConfig / scoped_config | AIJ configuration | scope/scopeId/pluginCode/configKey四元唯一；pluginCode默认空；configValue无默认载荷、isPublic默认false；新增version默认1及changes反向关系 |
| ConfigurationChange / configuration_change | AIJ configuration | 保留scope/key/操作者快照/元数据/事件字段；新增configId/configVersion/auditLogId及config/auditLog关系；configId+configVersion复合唯一、auditLogId索引 |
| SecretReference / secret_reference | AIJ secret-center | 唯一ref、provider、描述/状态/检查元数据；没有secretValue/apiKey/privateKey/商户凭据列，没有默认引用绑定 |
| AuditLog / audit_log | AIJ core | 操作者/资源/请求/前后快照/状态/时间字段；新增configurationChanges反向关系；workspaceId保留可空标量上下文，非授权关系 |

源Schema没有显式配置版本或变更到审计的外键。本次最小适配明确增加4个标量字段（version、configId、configVersion、auditLogId）、4个关系字段、1个复合唯一约束及1个索引；其余源字段/映射/默认/唯一键及13个索引保留，当前六模型共14个普通索引。ProjectProfile.organization的必需关系显式Restrict/Cascade，与来源Prisma6默认动作一致。两条新增可空变更外键也明确Restrict/Cascade，避免已关联配置/审计被硬删除后悄然丢失关联；这是本次设计适配，不冒充源库已有外键。

`ScopedConfig.version`是当前版本；`ConfigurationChange.configVersion`是历史捕获值，仅configId外键指向稳定id，**不**把历史版本外键连到可变的当前version，避免更新当前版本时连带改写历史。来源变更还覆盖项目资料/密钥引用事件，故三个关联标量及两条变更外键允许空；复合唯一在两个值均非空时约束同配置同版本重复。Schema没有实现正数CHECK、configId/version成对必填、scope/key与被关联配置一致、版本自动递增/并发冲突拒绝或审计必填策略，这些须由后续审定迁移/DTO/Service完成，不能据本项宣称事务审计已生效。

项目归属OrganizationProfile/ProjectProfile和未来客户Workspace/Membership是两套模型。本项无成员/角色/权限/会话关系，不用organizationId/projectId或AuditLog.workspaceId作客户租户授权判断。scope/scopeId保持来源通用字符串；未来服务须校验配置层级与可信上下文。管理员/客户身份十二模型没有因此增加项目组织依赖。

只迁定义，没有复制业务品牌、商户凭据、真实用户、默认业务Prompt、Seed、配置载荷或原环境。公开类型夹具的引用为合成`env://AIJ_SYNTHETIC_REFERENCE_ONLY`，匹配来源引用格式，但本项未迁解析器/adapter、未读取该环境变量。SecretReference只有引用元数据；ScopedConfig.configValue以及审计/元数据的String/JSON是通用容器，Prisma Schema本身不能阻止未来写入真密钥/PII/Prompt。密钥引用校验、敏感值拒绝、脱敏和安全公开过滤均待服务任务，当前不宣称它们已实施。

在根目录执行：

```bash
pnpm --filter @aij/api prisma:validate
pnpm --filter @aij/api prisma:generate
pnpm run verify:task -- AF-008
pnpm run lint && pnpm run typecheck
```

复用AF-006离线编译入口，不加载真实.env/DB凭据，不连接数据库、不执行migration/db push/Seed。validate/generate实际执行，客户端仅写本库忽略的node_modules。AF-008注册24配置/审计+21身份+23核心共68项真实断言，检查完整18模型集合、owner、层级唯一、版本/审计FK/删除策略、默认/索引和4种真实Prisma P1012失败；公开生成类型有5条反向编译断言。原身份测试按其十二模型子集检查，业务禁入仍覆盖全部模型，新增范围由当前任务测试约束，不提供全局空PASS。

Controller/Service/DTO/Guard、配置解析优先级/版本更新、Secret adapter、审计写入/脱敏及API/页面均未迁入；没有产品表、账号或记录创建操作。来源与精确适配见[SOURCE_PROVENANCE第8节](../governance/SOURCE_PROVENANCE.md)，实际命令/退出码、证据、地址与人工步骤见[AF-008执行记录](../execution/AF-008.md)。**Trea待复核、人工待验**，无产品账号或prepare-manual钩子。
