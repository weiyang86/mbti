# 文件与插件状态最小Schema（AF-009）

日期2026-10-19。唯一实现为`apps/api/prisma/schema.prisma`，沿用Prisma/client6.19.0；本项追加3模型/2枚举，原18模型/2枚举逐块不变，当前21模型/4枚举。F00的FileAsset、Plugin、PluginInstallLog均为platform/core→AIJ core；后两者按本项要求适配命名，不声称来源已有同名模型或状态枚举。

| 模型 / 表 | 最小字段与约束 | 实现边界 |
| --- | --- | --- |
| FileAsset / file_asset | 原名/文件名、MIME/size、path/url、storageType/objectKey/checksum、projectId/workspaceId/pluginCode、ownerType/ownerId/uploaderId、状态与时间；objectKey唯一、id/workspaceId复合唯一、5查询索引 | 保留20来源标量，删除bizType/bizId及四条SiteMedia/Deployment业务反向关系；无关系字段、文件字节或存储服务 |
| PluginInstallation / plugin_installation | projectId/pluginCode复合唯一；必需version/owner；状态默认uninstalled；安装/启用/停用/卸载时间、可空failureReason；创建/更新时间、状态索引 | projectId为本项目身份标量，owner为实现包/模块标识，均不授予客户租户权限；无插件菜单/权限复制 |
| PluginOperation / plugin_operation | 必需installationId/action/version/owner；状态默认pending；可空failureReason/operatorId/开始结束时间、创建时间；安装+时间、状态+时间索引 | 版本/owner是操作时快照；必需installation FK指向稳定id，Restrict删除/Cascade更新保留历史；无业务FK或任务/支付/AI执行载荷 |

FileAsset保留来源列映射、默认值、唯一键和索引；没有复制源文件内容、真实记录或原路径默认值。`path/url/objectKey`无环境默认，类型夹具仅使用合成相对路径/URL，没有实际上传。Schema的String不能验证路径穿越、绝对路径、大小正数、授权或存储根，后续StorageAdapter/DTO/Service须按AF-003项目配置实现并真实测试。workspaceId、ownerId、uploaderId都是可空标量上下文，不能替代服务端Membership/权限验证。

| 枚举 | 可表达状态 | 仅定义的含义 |
| --- | --- | --- |
| PluginInstallationStatus | uninstalled / installed / enabled / failed | 未安装、已安装未启用、启用、失败；默认未安装，不自动启用系统插件 |
| PluginOperationStatus | pending / running / succeeded / failed | 操作排队、运行、成功、失败；默认pending，不自动执行操作 |

安装version是请求或最后已知版本，未安装行也须显式提供；操作version/owner是历史快照，不通过FK绑定可变的当前版本/owner。disabledAt可承载后续停用时间，但Schema未实现转换规则。源Plugin.code全局唯一改为项目+插件唯一，删除name/description/deletedAt和menus/permissions，只保留状态行与历史。源PluginInstallLog去掉pluginCode/operatorName；关系改为必需安装id，message适配为failureReason，补版本/owner/运行时间与受控状态。精确来源差异见[SOURCE_PROVENANCE第9节](../governance/SOURCE_PROVENANCE.md)。

action仍是必需String，非空、动作白名单/版本语义、owner注册核对、状态迁移、失败时原因必填、时间配对/顺序、项目一致性、并发/幂等/锁、审计事务、失败恢复/卸载保留策略尚未实现。failureReason仅可空文字元数据，未来执行器须写去敏摘要，Schema本身不能阻止写入敏感内容。本项没有生命周期执行器、存储驱动、Controller/Service/DTO/Guard、API/页面、迁移/Seed或真实运行记录；枚举/字段存在不是运行时成功证据。

在仓库根目录执行：

```bash
pnpm --filter @aij/api prisma:validate
pnpm --filter @aij/api prisma:generate
pnpm run verify:task -- AF-009
pnpm run lint && pnpm run typecheck
```

复用AF-006离线编译包装器，仅validate/generate，剥离真实环境与数据库凭据，使用无密码127.0.0.1:1编译URL，不连接数据库或执行建表。AF-009注册真实17文件插件+24配置审计+21身份+23核心共85项，零fail/skip/todo；完整21模型/4枚举、owner、默认/唯一/FK/删除策略/索引和四种真实P1012拒绝均已验证，公开类型有6条反向编译断言。前序按owner子集回归、业务禁入仍全局，未知AF-010非零。客户端/测试证据只写忽略产物，无未声明服务或源码探针。

本项没有产品账号、页面或prepare-manual钩子；本机地址/凭据位置、完整命令/退出码、人工步骤及保护证据见[AF-009执行记录](../execution/AF-009.md)。没有预迁96候选或224旧模型，也没有RuntimeJob/支付/AI等数据表。**Trea待复核、人工待验**，正式底座及文件/插件生命周期未宣称完成。
