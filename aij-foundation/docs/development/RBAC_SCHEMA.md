# 管理员与RBAC Schema（AF-006）

AF-016已接收前序并接入角色/权限管理API，当前人工API3656/合成账号/忽略密码文件/停止命令以[角色权限指南](ROLE_PERMISSION_API.md)为准。本页旧任务范围/PID按历史阅读，不沿用旧PID；Schema/initial及既有接口契约保持。

AF-014当前增量：下文为Schema阶段历史，Schema/initial保持；现已消费唯一Prisma/JWT接入PermissionsGuard/Service及只读自查/目录，见[RBAC指南](RBAC_AUTHORIZATION.md)。权限只有status没有deletedAt，不宣称权限软删除；role.dataScope不提供客户租户/行级授权。

2026-10-19 AF-007增量：另增5个AIJ identity模型，原7个core模型定义保持不变。下文保留AF-006范围；此前“会员未迁入”仅属AF-006阶段。当前身份Schema边界见[CLIENT_IDENTITY_SCHEMA](CLIENT_IDENTITY_SCHEMA.md)，尚无注册/找回/导出/注销服务。核心回归按7项owner清单检查，全部Schema的业务关系禁入仍执行，完整12模型集合由AF-007目标测试断言。

唯一模型实现为 `apps/api/prisma/schema.prisma`，Prisma配置为 `apps/api/prisma.config.mjs`。来源与许可边界见 [SOURCE_PROVENANCE 第6节](../governance/SOURCE_PROVENANCE.md)，F00 owner原始记录保留于PRISMA_MODEL_OWNERSHIP.csv。本项只有Schema及客户端生成；没有在PostgreSQL建立以下表，也没有产品管理员账号。

| 模型 / 映射表 | 本库数据owner | 关系与约束 |
| --- | --- | --- |
| SysUser / sys_user | AIJ core 管理员身份 | username唯一；passwordHash必填、无默认密码；isSuperAdmin默认false；仅反向userRoles |
| SysRole / sys_role | AIJ core RBAC角色 | roleCode唯一；userRoles、permissions、menus均指向本表下面的显式关联模型 |
| SysPermission / sys_permission | AIJ core RBAC权限 | permissionCode唯一；ResourceType仅menu/button/api/data；roles指向SysRolePermission |
| SysMenu / sys_menu | AIJ core菜单 | path唯一；parentId/status索引；roles指向SysRoleMenu |
| SysUserRole / sys_user_role | AIJ core 身份角色关联 | [userId, roleId]复合唯一；分别引用SysUser.id、SysRole.id |
| SysRolePermission / sys_role_permission | AIJ core 角色权限关联 | [roleId, permissionId]复合唯一；分别引用SysRole.id、SysPermission.id |
| SysRoleMenu / sys_role_menu | AIJ core 角色菜单关联 | [roleId, menuId]复合唯一；分别引用SysRole.id、SysMenu.id |

七个模型均保留cuid主键和原列映射，UserStatus仅active/disabled。六条必需外键明确`onDelete: Restrict, onUpdate: Cascade`，与来源未显式声明时的Prisma6必需关系默认行为一致：仍有关联时拒绝硬删除父记录，须由未来服务明确解除关联；更新父键级联同步。不新增隐式Cascade删除，也不声称软删会自动解除关联。默认语义依据 [Prisma 6 referential actions](https://www.prisma.io/docs/orm/v6/prisma-schema/data-model/relations/referential-actions)。当前只证明Schema/DMMF声明，实际数据库约束行为待建表任务验证。

SysMenu.parentId、permissionCode、pluginCode保留来源的可空标量，不是新加的自关联或Permission/Plugin外键；菜单树、循环校验、插件权限过滤仍需服务任务实现。SysRole.dataScope/status及菜单status/type保持来源字符串，不擅自收紧枚举或默认值。SysUser的23条FDE/建站/订单等业务反向关系已删除，CompanyProfile、诊断、订单、会员、组织、配置、审计等其他模型未迁入。

本任务没有Controller、Service、DTO或Guard；未来管理员/RBAC运行时归AIJ core对应能力owner，必须消费此唯一Schema及生成客户端，不另复制模型。passwordHash字段不等于密码散列、登录、鉴权或数据隔离已实现，dataScope字符串也不提供授权执行。

在根目录执行实际命令：

```bash
pnpm --filter @aij/api prisma:validate
pnpm --filter @aij/api prisma:generate
pnpm run verify:task -- AF-006
pnpm run lint && pnpm run typecheck
```

`scripts/prisma-schema.mjs`只接受validate/generate（至多一个可选--），以参数数组调用本库精确6.19.0 CLI；拒绝迁移/建表等参数。配置不载入dotenv，也没有migration/seed/adapter钩子。编译命令剔除真实URL、PG凭据、NODE_OPTIONS及引擎覆盖变量，显式使用无密码的`postgresql://aij_schema_compile@127.0.0.1:1/aij_schema_compile`满足Schema环境变量语法；它不是实际数据库目标，不写入.env，也不作为dev/test fallback。未来数据库操作必须另接AF-004/005目标保护和独立凭据，不能复用本编译入口。

generate只写本库忽略的node_modules/.prisma/client及@prisma/client产物，不提交生成代码。实际测试读取生成DMMF与其Schema副本并比对当前Schema，断言所有owner闭合、唯一键/六外键动作、必要字段/默认值；在.artifacts中建立三份非法Schema交给真实Prisma validate，逐项断言P1012/exit1。生成类型fixture由API typecheck编译，包含业务关系/缺hash/非法枚举的反向类型断言。API构建不启动服务；effects.services=[]、testDatabase=false、uniqueWriter=false，校验不修改源文件。

AF-006没有浏览器页面、账号或准备钩子。完整人工检查、现有本地地址和保护状态见 [AF-006执行记录](../execution/AF-006.md)；Trea待复核、人工待验。首次安装依赖后先generate再typecheck；不以安装成功替代生成结果，不执行历史migration、db push、Seed或reset/drop。
