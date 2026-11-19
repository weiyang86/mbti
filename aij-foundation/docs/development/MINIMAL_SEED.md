# 最小Seed与初始管理员（AF-012）

唯一实现scripts/database/seed.mjs，根db:seed为薄入口。只初始化本库host的合成组织/项目和管理员/RBAC；没有Prisma自动Seed钩子；AF-013接入登录/me，AF-014接入只读权限自查/目录；AF-015接入管理员基础API，页面仍未实现。源混合Seed的业务默认与恢复授权行为未迁入，来源/适配见[SOURCE_PROVENANCE](../governance/SOURCE_PROVENANCE.md)第12节。

## 1. 入口与目标保护

本库根目录，Node24/pnpm10；先有已运行的独立本机实例及已审定、已应用迁移。显式指定环境：

```bash
pnpm run db:seed -- dev --generate-credentials
pnpm run db:seed -- test --generate-credentials
```

这两个普通目标当前尚未deploy，直接运行会拒绝，不自动迁移。以上是接口用法，不能当作已对原dev/test执行的证据。AF-012实际仅在其新验收库运行；AF-013/014/015/016扩展同样归属校验至各自新库，显式 `--acceptance ID` 选择本机/环境/实例匹配的记录库；拒绝AF-010/011库充当本任务Seed目标，未知任务不能生成归属记录。普通dev=55432/aij_foundation_dev、test=55433/aij_foundation_test白名单不放宽；test不回退dev。生成项目仍使用自己的配置，本Seed当前只允许aij-foundation host。

每次Seed先解析目标/凭据，再复用migrate status真实身份/资源归属/本地迁移checksum及完成状态；缺迁移、错目标/环境/主机/凭据均非零退出。它只调用status，不deploy/reset/drop。写入通过既有受保护pg connection与参数化SQL，BEGIN/COMMIT/ROLLBACK及数据库advisory事务锁；没有第二份Prisma服务、源码探针或服务启动。

## 2. 生成、提供与保留密码

- 专用输入为 `AIJ_INITIAL_ADMIN_PASSWORD`，支持负责人在本机安全进程环境或本库忽略.env配置；旧INITIAL_ADMIN_PASSWORD不作为fallback。显式空值/模板也拒绝，不能回退本机文件。不要把密码写到命令参数或报告。
- 或显式 `--generate-credentials`：只有首次创建账号时，生成32随机字节加字符类别前缀，保存到本机忽略 `.local-data/seed/<mode>/<database>/initial-admin.json`。再次运行复用已有初始文件，不生成替代值。专用变量（含空值）与生成标志同时存在时拒绝，使用生成模式前应移除该变量。
- 无专用变量、无目标初始文件且未选择生成时，CREDENTIAL_MISSING；密码至少20字符、最多72 UTF-8字节、至少三类字符，无空白/控制字符或常见模板。超过bcrypt字节上限直接拒绝，不接受截断后的密码。
- bcryptjs固定经核验的来源版本3.0.3，cost12、随机salt；数据库只存bcrypt hash。stdout/stderr/报告不打印密码或hash；仅输出安全目标、用户名、创建/保留状态及初始文件路径。
- 初始文件绑定仓库、mode、database、instanceId及username；越界/符号链接/错归属/不可读/模板值拒绝，不覆盖。创建前真实git check-ignore，文件wx、请求0600/目录0700；ExFAT不作为POSIX权限隔离证明。

已有管理员（含停用、软删）不会改密码/状态/资料/超级管理员标识，不改角色或补回撤销的授权；没有初始文件时，生成模式也不能为已有账号创建“恢复密码”。显式提供的新初始密码只用于首次创建，不覆盖已有hash。已有角色/权限/项目资料不重写；全新管理员遇到保留角色或权限命名冲突时整笔回滚，不采纳未知角色。

初始文件仅记录首次密码，不保证人工改密后仍可登录。生成文件在账号事务提交前落盘；若后续事务失败，可保留该文件供检查/重试，文件存在本身不是账号创建成功证据。Seed不是改密/恢复/权限修复工具。

## 3. 最小数据与幂等语义

| 表/字段 | 本轮首次Seed |
| --- | --- |
| organization_profile / project_profile | 各1条AIJ合成记录；code含development或test，brand/meta不写业务载荷；归属不提供客户Workspace权限 |
| sys_user | aij-admin、active、isSuperAdmin=true；初始数据；AF-013登录服务消费同一hash |
| sys_role | aij_bootstrap_admin、AIJ初始管理员 |
| sys_permission | aij.bootstrap.admin，resourceType=data、module=core、action=bootstrap、apiPath=null；仅初始化权限标识，无API授权执行 |
| sys_user_role / sys_role_permission | 首次各1条；已有管理员不重建关联或恢复权限 |
| sys_menu / sys_role_menu及其余表 | 0；不挂不存在的页面、插件、会员、订单、Prompt或商户记录 |

相同目标两次Seed的行数、ID、时间、hash、初始文件字节已真实比较保持；人工改密/停用/项目资料/角色及撤销授权后再Seed也保持原样。Organization/Project为create-if-missing；不是项目资料协调器。当前最小Seed没有字典/配置默认、插件安装或其他完整Seed分层。

## 4. 本轮实际人工入口（待验）

本节保留AF-012交付时无Web/API的DB检查步骤；AF-013当前HTTP人工账号/服务另见[管理员认证](ADMIN_AUTHENTICATION.md)，不修改下述旧库/凭据。AF-012已保留的active合成账号：

| 用途 | 实际值/本机获取方式 |
| --- | --- |
| DB无密码地址 | postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af012_test_d3e338444141b441 |
| DB角色及密码 | aij_foundation_test；负责人本机查看 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/postgres/test/postgres-password`，在DB客户端提示中输入 |
| 合成管理员 | aij-admin（库内初始身份，不是DB连接角色） |
| 管理员初始密码 | 本机查看 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af012_test_d3e338444141b441/provided-initial.json`；由合成测试安全生成后通过专用变量输入，未打印 |
| 归属/证据 | acceptance ID d3e338444141b441；.artifacts/af-012/integration/run-KxpzQB/manual.json；最终普通报告run-N2SS8D |

负责人/Trea逐步操作与预期：

1. 只读检查注册表及seed.mjs/seed-cli.test.mjs/seed.test.mjs具体断言，核对最终report每条真实命令/退出码与114项；Trea复核不因本文件描述自动完成。
2. 用表中DB目标连接，输入DB密码，执行 `SELECT current_database(),current_user,session_user;`，预期目标库及aij_foundation_test。不要使用管理员密码连接PostgreSQL。
3. 执行 `SELECT username,status,is_super_admin FROM public.sys_user;`，预期唯一aij-admin/active/true；查询 `SELECT role_code,status FROM public.sys_role;`、`SELECT permission_code,resource_type,api_path FROM public.sys_permission;`，各1行、权限data且api_path为空。不要查询/导出password_hash。
4. 查询组织/项目code及两关联表行数，预期各1；sys_menu/sys_role_menu/member_user/scoped_config/secret_reference/file_asset/plugin_installation等为0，完整21表检查已在自动测试执行。
5. 如需亲自复跑，执行 `pnpm run verify:task -- AF-012`。预期新独立AF-012库真实迁移/Seed、114项通过、零fail/skip/todo；证据写新run目录、所有连接关闭，无HTTP/容器启停。它是有DB/文件写入的测试，不是只读Review；Trea按负责人安排执行。
6. 若只想重复当前active目标的Seed，由负责人在本机安全环境提供该provided-initial.json中的专用变量，然后执行 `pnpm run db:seed -- test --acceptance d3e338444141b441`。预期admin.action=preserved、rolesTouched=false、无记录变化，输入的密码不会覆盖。该目标没有自动生成initial-admin.json，不能用generate模式当作恢复；不把密码写入命令文本或回传。

最终改密/停用/角色保留探针在 `aij_foundation_af012_test_9143dbb4853c91d5`，账号刻意disabled、初始文件已不是当前密码；冲突回滚探针在 `aij_foundation_af012_test_0db4c9479806c0b2`，只有合成冲突角色。前几轮诊断库均保留，完整清单见handoff.json，不混作active人工账号。

本项所有Seed连接已关闭，无新常驻服务可停止；DB客户端检查后断开即可。数据卷/验收库/凭据/证据保留，不提供reset/drop/down -v或删卷命令。本库两实例和原15435运行元数据保持，未连接原数据库。完整实际结果见[AF-012执行记录](../execution/AF-012.md)。**Trea待复核、人工待验**。

AF-014未改本最小Seed七行/权限定义或协调规则；aij.bootstrap.admin当前仅显式绑定新只读权限目录。super/reader/no-access人工验证的两个额外账号由独立测试fixture在AF-014新库创建，密码在忽略rbac-accounts.json，不能当作生产Seed或管理CRUD；步骤见[RBAC](RBAC_AUTHORIZATION.md)。

## AF-015显式管理员权限扩展

`db:seed -- test --acceptance ID --admin-users` 仅在受保护已迁移目标注册admin.user.manage（api/core/manage-admin-users、apiPath=/api/admin/users）；不自动给bootstrap角色授权。默认七行Seed保持；新目标显式扩展后八行，原定义status和撤销的关联保留，元数据冲突整笔回滚。已有账号无改密/角色恢复；管理员API和Seed共用scripts/admin-policy.cjs的原安全规则及bcrypt12。真实重复/冲突回滚与完整旧Seed十项回归通过；当前账号/步骤见[管理员管理指南](ADMIN_USERS_API.md)，不沿用本页旧人工PID/库。

## AF-016角色权限定义扩展

`db:seed -- test --acceptance ID --rbac-management` 受原目标/迁移保护，只注册admin.role.manage、admin.permission.manage（api/core/manage-roles或manage-permissions）两定义，不给角色授权或修复停用/撤销。默认七行保持；首次显式rbac为九行，另加admin-users为十行。共享同一registerDefinition实现，第二个命名冲突也整笔回滚第一条及组织/账号，不生成初始密码文件。已有密码/角色/项目资料不重置；人工fixture仅自身合成库，当前账号/步骤见[角色权限指南](ROLE_PERMISSION_API.md)。
