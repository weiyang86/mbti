# 独立本地PostgreSQL（AF-005）

AF-016已接收前序并接入角色/权限管理API，当前人工API3656/合成账号/忽略密码文件/停止命令以[角色权限指南](ROLE_PERMISSION_API.md)为准。本页旧任务范围/PID按历史阅读，不沿用旧PID；Schema/initial及既有接口契约保持。

AF-015当前保留自有新逻辑合成库与人工API3656，原dev/test仍只有AF005哨兵；无Web页面。实际地址/账号/忽略密码文件及核验后停止步骤见[管理员管理指南](ADMIN_USERS_API.md)，以下旧任务服务状态按历史阅读。

仅适用本库开发/测试宿主。当前Docker Desktop本地Unix context=desktop-linux，PostgreSQL实际16.14；Compose锁定已核验的postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb。没有自动升级、pull、生产监听或共享库支持。

AF-010阶段补充：两实例/账户/卷保持，另在各实例新建空验收库应用本库initial；既有aij_foundation_dev/test未deploy，哨兵不变。db:migrate及显式验收ID、实际地址和边界见[Initial Migration](INITIAL_MIGRATION.md)，后文AF-005记录保留。

## 1. 实际运行入口与凭据

| 环境 | 实际无密码地址 | database/user | Compose project / 命名卷 |
| --- | --- | --- | --- |
| dev | postgresql://aij_foundation_dev@127.0.0.1:55432/aij_foundation_dev | aij_foundation_dev | aij-foundation-dev / aij-foundation-dev_postgres_data |
| test | postgresql://aij_foundation_test@127.0.0.1:55433/aij_foundation_test | aij_foundation_test | aij-foundation-test / aij-foundation-test_postgres_data |

两实例保持运行，角色仍为各自本机bootstrap superuser，非产品管理员/生产最小权限角色。AF-014当前保留自有API3656（Web未运行），三组合成账号与权限数据位于新AF-014逻辑库，步骤见[RBAC指南](RBAC_AUTHORIZATION.md)。原aij_foundation_dev/test仍未deploy/seed、哨兵保持；AF-012/013旧合成库保留；以下AF-005/010说明保留其阶段语义。

本轮分别生成新随机密码，仅在本库Git忽略文件：

- .local-data/postgres/dev/.env及.local-data/postgres/dev/postgres-password
- .local-data/postgres/test/.env及.local-data/postgres/test/postgres-password

负责人在本机编辑器查看所需文件，或在客户端密码提示中手工输入；不要打印、提交或回传内容。owner.json记录本库/环境/随机instanceId；已存在凭据不生成替代值，缺失/部分/冲突状态失败，不改密码或清库。目录0700/文件0600为请求值，ExFAT不作为POSIX权限隔离证明。

## 2. 本库命令

在本库根目录使用Node24、pnpm10和本地Docker引擎：

```bash
pnpm run db:up -- both
pnpm run db:check -- dev
pnpm run db:check -- test
pnpm run db:check -- test --config-only
pnpm run db:restart -- both
pnpm run db:stop -- both
pnpm run db:cleanup -- both
```

up/stop/restart/cleanup均可分别用dev或test替换both。up先检查所有请求目标，再启动；不会替换容器、采纳别的项目资源或重设账号。restart只对运行中的自有实例操作；停止后用up恢复。cleanup要求先stop，仅移除已停止自有容器及无端点的自有网络，始终保留数据卷/凭据，已实测重建后原哨兵仍存在；不提供删卷、reset、drop或全局down -v命令。

db:check默认在AF-004白名单通过后真实TCP认证，SQL核对current_database/current_user/session_user/内部端口5432，返回CONNECTED、connectionAttempted=true与安全身份字段。--config-only才返回CONFIG_VALID/false；错误配置exit2、真实认证/连接/身份失败exit3、启动端口占用exit4。具体底层Docker非零退出码和参数数组保存在去敏日志，不以打印成功代替结果。

读取优先级：进程环境（含空值）→本库根可选.env→所选环境本机.env。test只取TEST_DATABASE_URL，没有开发变量fallback。本轮没有创建根.env；不要为启动而复制.env.example中的模板覆写现有配置。托管up还要求显式/root URL与本机自有凭据一致，冲突只拒绝、不自动修复。

## 3. 资源与写入保护

唯一URL/密钥策略为scripts/runtime-environment.cjs。connection.mjs用pg8.16.3构造明确host/port/user/database/password，不使用隐式PG连接目标；managed.mjs拥有凭据与Compose生命周期，cli.mjs为薄入口，没有HTTP Controller/Service/DTO/Guard或应用数据owner新增。

工具只接受本地Unix-socket Docker context；Compose project、instance标签、工作目录/文件、镜像digest、127.0.0.1端口和命名卷均核对。路径不得越出本库或穿过符号链接；凭据写入前真实git check-ignore，参数数组无shell。已占用端口报告PID/PPID/CWD/命令并停止本次启动流程，不停止监听者；macOS lsof中文路径按实际UTF-8字节解码。

停止/重启前inspect验证自有ID，docker top取PID/PPID，以容器postgres用户读取/proc/1/cwd及cmdline，核对postgres进程与数据目录；再检查归属后操作该精确ID，不按端口kill。凭据丢失但资源还在时拒绝采纳，不通过初始化变量重置既有密码。操作锁存在时先核对其PID/PPID/CWD/命令，不自动移除锁或处理他人进程。

本机Docker Desktop无法绑定外置ExFAT上的secret文件，初次失败已留证；最终采用忽略文件→Compose子进程环境传入密码，无host bind挂载，数据只在各自命名卷。密码会存在于Docker运行配置，Docker管理权限仍能访问；本工具不读取完整Config.Env，只取安全inspect字段，Compose config日志先按当前本机密码去敏。不要手工打印完整Docker inspect/config。

## 4. 真实验收与人工操作

```bash
pnpm run verify:task -- AF-005
```

实际执行两项前置、94配置/执行器测试、11数据库测试。后者验证并存连接/不同cluster identifier、真实密码拒绝、旧/错目标连接前拒绝、55432真实占用归属与listener存活、两库合成哨兵不同、重复准备不变、重启保留、停止清理容器再同卷重建仍保留、凭据/源码摘要不变。测试会实际写库并重启两实例，保持其运行；应按负责人安排执行，避免与其他数据库Writer并行。

仅Codex/负责人显式准备人工现场，Trea不运行准备模式。本轮已经实际执行：

```bash
pnpm run verify:task -- AF-005 --prepare-manual
```

结果PREPARED不是验收PASS；只运行注册的目标前置和owned-local-database准备命令，不跑普通steps。已有角色/密码和哨兵不重置；只添加af005_verification.sentinel合成表/一条AF-005记录。实际无密码URL、角色、初始密码文件、停止与保留数据的清理命令在.artifacts/af-005/manual.json，任务报告在.artifacts/verification/AF-005/run-G1czPV/。

人工步骤：

1. 读注册表、配置/生命周期保护和具体SQL断言；Trea审查常规报告run-ellCZK的105项、所有退出码及operations/integration逐条证据，保留待复核状态直到实际检查。
2. 分别执行db:check dev和test，确认CONNECTED、正确database/user、55432/55433与真实serverPort5432。密码由本机忽略文件获取，不需要产品登录账号。
3. 可用DB客户端按表中host/port/database/user连接并输入本机密码，执行 `SELECT current_database(), current_user;` 和 `SELECT id,mode,marker,created_at FROM af005_verification.sentinel;`；两库mode/marker不同。若本机无psql，可在各自容器中用 `docker exec -it --user postgres aij-foundation-dev-postgres-1 psql -h 127.0.0.1 -U aij_foundation_dev -d aij_foundation_dev -W`，test替换相应名字；密码只在交互提示中输入。
4. 按负责人安排运行db:restart，再读哨兵，marker/created_at应保持。本轮自动测试已做真实重启/重建，不把人工观察勾为完成。结束可按上方stop、cleanup命令处理自有服务，卷/密码保留，up可恢复；不要操作15435原库。

以上AF-005交付当时仅有fixture schema和本地实例；后续Schema/initial/readiness见各指南。Seed、生产最小权限角色/备份恢复/部署仍为后续任务。
