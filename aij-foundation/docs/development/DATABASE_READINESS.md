# Prisma与数据库Readiness（AF-011）

日期2026-10-19。唯一运行时实现是apps/api/src/prisma/PrismaService；PrismaModule导出，AppModule只消费。来源单例/disconnect结构经定向核验后适配，见[SOURCE_PROVENANCE](../governance/SOURCE_PROVENANCE.md)第11节。现有bootstrap的enableShutdownHooks复用，app.close与真实main SIGTERM均已验证关闭连接。

## 1. 配置与接口

DATABASE_ENABLED默认false。宿主开启时，readApplicationEnvironment按环境变量→本库根可选.env→所选dev/test本机忽略.env读取，test只取TEST_DATABASE_URL，不回退DATABASE_URL；目标策略仍只有runtime-environment.cjs一份，CLI connection重导出消费。DATABASE_ACCEPTANCE_ID须匹配本机记录的AF-010/011库名、task、环境、仓库与实例；项目模式继续显式使用自己的身份/URL/端口，不读宿主托管凭据。没有创建根.env或更改已有密码。

普通dev/test数据库尚未deploy：只开启DATABASE_ENABLED不能使它们ready。本轮使用独立新AF-011验收库；不得为得到200自动迁移原dev/test。Auth/storage继续拒绝启用，插件集合仍为空。宿主production数据库策略未开放，部署监听/最小权限应用角色由后续任务处理。

| 接口 | 实际行为 |
| --- | --- |
| GET /api/health | 进程可响应即200，scope=process、status=ok；database=configured只表示配置启用，不触发DB检查 |
| GET /api/ready | 单例Prisma真实事务检查database/current_user/session_user/内部端口5432、public._prisma_migrations的本地迁移名/checksum/finished_at且未rollback；全部符合200/READY，否则503 |

失败reason仅为固定代码：DATABASE_NOT_CONFIGURED、MIGRATION_METADATA_UNAVAILABLE、DATABASE_IDENTITY_MISMATCH、MIGRATIONS_MISSING、MIGRATIONS_INCOMPLETE、DATABASE_UNAVAILABLE、SHUTTING_DOWN。响应不返回数据库目标、凭据、URL、Prisma原始错误或堆栈；保留已有响应包装/关联ID。探针无入参、公开且不授权管理操作，无新增DTO/Guard。

Prisma延迟连接，数据库离线仍能启动并提供liveness；连接池当前上限1，连接/等待及事务采用有限超时，并发readiness共用正在执行的探针。关闭时先等待探针，再disconnect。readiness核对迁移账本而非逐表漂移/CRUD权限；不代替AF-010漂移检查、业务健康、Auth或生产数据库安全验收。

## 2. 实际自动校验

先释放3656的自有人工API，再在本库根目录运行：

```bash
node scripts/verification/readiness-manual.mjs stop
pnpm run verify:task -- AF-011
```

stop只用于已有AF-011准备记录；首次没有记录时不需运行。普通verify实际执行两个前置、Prisma validate/generate、91配置/目标/迁移回归、API构建、9项HTTP/DB和4项人工服务生命周期检查（计数含两个父用例），共104，无skip/todo。两个HTTP测试文件按注册顺序执行，共用3656，不能合并并发运行。testDatabase=true，声明新逻辑库/自有API；无源码探针或未声明服务。

故障路径是关闭自身池后，对本任务新建逻辑测试库执行ALLOW_CONNECTIONS=false，使新连接真实失败；ready503、health200，finally恢复true后ready200。**没有停止PostgreSQL容器或影响同实例其他数据库**。真实SET ROLE/RESET ROLE验证错误身份503；缺迁移503→实际deploy→200；随机错密码503且去敏；disabled503不建池；app.close与main SIGTERM后自有pg_stat_activity为零。全部临时池已关闭；失败诊断库保留、不清库。

## 3. 人工现场（待负责人验收）

本轮已经执行以下注册安全钩子exit0/PREPARED；Trea不执行准备模式，PREPARED不是人工验收完成：

```bash
pnpm run verify:task -- AF-011 --prepare-manual
```

当前实际health/ready地址为 `http://localhost:3656/api/health`、`http://localhost:3656/api/ready`，均已GET200；Web3655未运行。人工API PID39617、CWD为本库apps/api、命令为本库dist/main.js；PID可能随重启变化，以.artifacts/af-011/manual.json和现场归属核验为准。此服务保留一条自有池连接供观察。

| 连接字段 | 本轮实际值 |
| --- | --- |
| host/port | 127.0.0.1:55433 |
| database | aij_foundation_af011_test_ab0806358f7a251b |
| DB角色 | aij_foundation_test（既有本机bootstrap角色，非产品管理员/会员） |
| 密码获取 | 负责人在本机编辑器查看 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/postgres/test/postgres-password`，在客户端密码提示中输入；不回传、不打印 |
| 现场/日志 | .artifacts/af-011/manual.json及其logFile；不含密码 |

人工操作与预期：

1. 在浏览器或curl分别GET上述health/ready，预期200、scope分别process/database、ready.reason=READY；无需产品登录账号。关联ID可在请求头给x-correlation-id后检查响应同名头。
2. 用本机DB客户端按表中字段连接，执行 `SELECT current_database(), current_user, session_user;`，应为该验收库和aij_foundation_test；执行 `SELECT migration_name,finished_at,rolled_back_at FROM public._prisma_migrations;`，应有本库initial一行、已完成且未rollback。产品21表零数据，无Seed。
3. Trea逐条阅读注册命令、readiness.test.mjs/readiness-manual.test.mjs实际断言与report.json；检查缺迁移、错误身份/密码、真实断库/恢复及零临时池证据，不凭PASS字符串确认。
4. 如需亲自复跑故障场景，先按下一步停止人工API，再运行普通verify。预期104项通过、所有子命令exit0，故障/恢复证据在新run目录；普通verify结束释放3656。不要手工停共享test实例或修改其他库。
5. 停止及连接清理命令为 `node scripts/verification/readiness-manual.mjs stop`。它先核对记录PID及现场PID/PPID/CWD/完整命令/启动时间，再SIGTERM确切自有PID，等待进程退出及该库自有池零连接；不force kill。停止失败先检查归属/日志，不按端口kill。
6. 若负责人要重建观察现场，确认3656空闲后再执行上面的完整prepare命令。钩子复用记录库和已有账号/密码，不静默重置。它只准备已注册的自有库/API；不启动Web或产品服务。完整verify/prepare的端口前置会拒绝已经运行的3656。

停止命令就是本任务连接清理；数据库/卷/凭据/证据保留，不提供drop/reset/删卷命令。两本库实例55432/55433与原15435持续运行；未连接原数据库。无Schema/initial变更、Seed、业务记录、页面、RBAC/租户授权、文件或插件运行时交付。完整执行、失败修复和交接见[AF-011执行记录](../execution/AF-011.md)。**Trea待复核、人工待验**。
