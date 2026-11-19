# 独立Initial Migration（AF-010）

日期2026-10-19。唯一目标定义为apps/api/prisma/schema.prisma，保持已接收21模型/4枚举。新迁移为`apps/api/prisma/migrations/20261019000000_initial/migration.sql`及PostgreSQL migration_lock.toml，使用本库Prisma6.19的`migrate diff --from-empty --to-schema-datamodel <目标Schema> --script --config <本库配置>`生成，未读取/复制旧89份SQL或旧_prisma_migrations。

迁移包含21产品表/243列、4枚举、73产品索引（含21主键）和13条Restrict/Cascade外键；deploy另建本库自己的_prisma_migrations及其主键，实际合计22表/74索引。未包含INSERT/Seed/真实记录、任务/支付/AI模型或业务FK。各模型数据owner保持F00/AF-006至AF-009核定范围：AIJ core、identity、configuration、secret-center，没有新增或镜像服务。

`scripts/database/migration.mjs`为唯一迁移owner，`scripts/db-migrate.mjs`是薄CLI，根脚本`db:migrate`仅接受：

```bash
pnpm run db:migrate -- dev deploy
pnpm run db:migrate -- test status
pnpm run db:migrate -- test deploy --acceptance <本机记录ID>
pnpm run db:check -- test --acceptance <本机记录ID>
```

普通dev/test仍是AF-004的精确host/port/db/user白名单，test没有dev fallback、NODE_ENV=test不能选dev。本轮没有对普通aij_foundation_dev/test执行deploy。可选acceptance不接受任意dbname或URL：先验证原模式URL，再把数据库名派生为本机记录的`aij_foundation_af010_<mode>_<16位hexID>`，检查记录的仓库/环境/实例ID/ready和精确库名，其他host/user/port/secret/query策略仍复用runtime-environment。归属文件位于忽略的`.local-data/postgres/acceptance/<ID>.json`，不存密码；模式串用/缺失/路径穿越拒绝。

迁移前复用db:check的真实身份核对，检查本机Docker容器/卷/凭据归属，不启动缺失服务；验收Schema快照必须匹配。持有目标库advisory lock，首次deploy要求public无表/枚举；已有账本的成功状态/校验和必须属于本地链，拒绝失败/未知历史，不提供reset/dev/push/resolve或修复捷径。Prisma子进程只用参数数组及受控环境，凭据只传env；原始URL/密码不入参数、报告或错误。真实子进程退出码保留，空库status未应用时返回1，deploy/status成功为0。

本次保留的实际人工地址：

| 环境 / ID | 无密码地址 | 角色与本机密码位置 |
| --- | --- | --- |
| dev / eafb6fac5a4ab45b | postgresql://aij_foundation_dev@127.0.0.1:55432/aij_foundation_af010_dev_eafb6fac5a4ab45b | aij_foundation_dev；.local-data/postgres/dev/postgres-password |
| test / 304ba399d30106d1 | postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_af010_test_304ba399d30106d1 | aij_foundation_test；.local-data/postgres/test/postgres-password |

沿用AF-005各实例独立bootstrap角色和本机忽略凭据，无账号/密码生成或重置，不是产品管理员/会员，也不宣称应用最小权限角色完成。负责人仅在本机安全客户端密码提示中获取/输入，不把密码填入命令历史或报告。两个原库的表/哨兵保持；新验收库全部产品表零记录，仅独立账本一行；合成约束事务已ROLLBACK，没有reset/drop/删卷或停止服务。本任务不提供删除库操作，保留人工检查现场。

自动入口`pnpm run verify:task -- AF-010`先检查真实前置，运行validate/generate、53 CLI/目标回归和两个实例各9项=71项；普通verify**会新建两个随机空验收库并写DDL/账本和回滚合成探针**，不修改源码或启动服务，不是只读审计。真实表/列/空值、枚举、全部索引与外键动作按生成DMMF/SQL白名单比较，再实际migrate diff=0；唯一/enum/FK/Restrict负例得到23505/22P02/23503/23503。每次创建新ID，绝不采用或清空已有验收库；无prepare-manual钩子。

人工按负责人安排先运行`pnpm run db:check -- dev --acceptance eafb6fac5a4ab45b`和test对应ID，预期CONNECTED且database/user匹配；再用相同mode/ID运行`db:migrate ... status`，预期UP_TO_DATE/0。客户端检查22表（含账本）、4枚举、74索引、13外键；账本仅20261019000000_initial一条、校验和匹配，21产品表无数据。可重复deploy，预期无新增迁移/账本不变；交叉mode/ID预期2。完整实际命令/退出码与证据见[AF-010记录](../execution/AF-010.md)。

本项没有PrismaService、API数据库readiness、Seed/产品账号、Auth/权限/API/页面或文件/插件生命周期运行时。Web3655/API3656未启动，枚举和迁移不是运行时验收。**Trea待复核、人工待验**；正式底座/完整F02未完成。
