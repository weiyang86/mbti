# AF-134 候选交付记录

日期：2026-11-04。任务名称：正式初始化并启动持续可用的 Base 开发后台。

## 派工与 Writer 边界

- Run：`run_d4eae5ba3a3b`；Task：`task_fc8f25244b67`；Dispatch：`ctx_471e6d87dc3e`。
- Writer terminal：`term_3dbf7f78-8360-4287-a47a-295e396fc5a9`；总控 terminal：`term_bc55f07a-bdd7-4207-8cce-91eb1f03863d`。
- 实际目录：`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation`；分支 `dev`；起始 `a19995a446abbce49101a091ecdce46973c544aa`；remote `origin` 为既有 AIJ Foundation 仓库。
- 本候选为当前目录唯一代码 Writer，无子 agent、无子 Worktree、无 Git 操作或本地提交。总控已有队列、AF-130/134、未跟踪执行手册修改原样保留；总控同期新增的 root script、ignore 与 eslint 变更不属于本 Writer 差异。
- 仅交候选代码和纯检查证据；未执行 Docker 命令、数据库连接/迁移/seed、重型构建、服务启停或浏览器验收。没有任何访问地址已运行的声明。

## 实际改动与使用契约

新增 `scripts/base-development/{cli,config,docker,database,build,processes,service}.mjs` 与 `ops/compose.base-development.yml`。CLI 只支持 `init`、`start`、`start --build`、`status`、`stop` 和帮助；帮助不依赖 Docker。总控注册 root script 后命令为：

```sh
pnpm base:dev init
pnpm base:dev start
pnpm base:dev status
pnpm base:dev stop
pnpm base:dev start
# 源码变化且需重建时：先 stop，再执行
pnpm base:dev start --build
```

- project runtime 固定 `aij-base-dev` / `development`；Web `127.0.0.1:3855`、API `127.0.0.1:3856`、PG `127.0.0.1:55434`。API `NODE_ENV=development`；Next 使用 production build/start 和既有 project runtime 公共配置。
- 专属 DB/role 为 `aij_base_dev_development`，容器 `aij-base-dev-postgres`，持久卷 `aij-base-dev_postgres_data`。PostgreSQL16 digest 与 `ops/compose.test.yml` 相同；固定默认 bridge，不创建/删除网络，不自动拉取镜像。
- 本机 hostname、uid、canonical repository、owner UUID、Docker Unix socket/context、项目与环境写入 `.local-data/base-development/owner.json` 并交叉验证。命名冲突且无本地记录时拒绝接管；owner 已初始化但持久卷消失时拒绝新建空库；所有生命周期先核验容器 labels、镜像、端口和卷归属。
- `.local-data/base-development/` 内的 `runtime.env`、`postgres-password`、`initial-admin.json` 与状态文件要求 owner-only，申请目录 0700/文件 0600。Lexar 当前为 ExFAT，chmod 不呈现 POSIX 模式变化，实际 stat 为 owner-only；实现检查有效 uid 与 group/world 权限位，拒绝不受限状态，不放松该保护。
- API 只编译到 `apps/api/.base-dev-dist`，保持与原 dist 相同深度；Next 只写 `apps/web/.next-base-dev`。构建在 finally 中恢复原 `tsconfig.json` 与 `next-env.d.ts` 字节；构建状态先标记 BUILDING，失败输出不得当成已就绪构建复用。Web 子进程只接系统白名单和公共 project 配置，无 DB/JWT 密钥、fixture、测试 API 覆盖或代理。
- API/Web 通过持久 supervisor 运行，CLI 返回后继续；记录 PID、birth、CWD、command 和 owner UUID。停止先核验全部记录，再向自身 supervisor 发送 SIGTERM；supervisor 再核验自身 child 的 birth/PPID/uid/CWD/command 后转发，拒绝强杀或按端口杀。DB stop 只针对再次核验后的精确容器 ID；保留卷、数据库与凭据。
- 启动会检查端口、真实迁移状态、API ready/health 的项目身份及 Web 登录页 HTTP200；已运行的同 owner 服务可接续。首次缺少构建时自动构建；源码变化用 `stop` 后 `start --build`。

修改 `scripts/database/seed.mjs`，保留 host dev/test 目标、参数与 `--dictionaries` 原语义。host 与 Base 共用密码验证/生成、bcrypt、bootstrap 管理员、权限登记与事务代码；Base 入口只能从已核验本机 owner/运行中专属容器读取目标，再认证数据库名、角色、server port 与 PG16。迁移使用现有 Prisma schema/migrations、既有迁移账本兼容保护及 advisory lock；只允许 deploy/status，无 SQL 另建 initializer、reset/drop 或自动修复账本。

新增 `scripts/base-policy.cjs`/声明，四菜单由正式 seed 事务插入，path 唯一冲突只读核验 type/plugin/permission，不修改已有标题、顺序、状态、父级或其他定制；异 owner 命名空间拒绝并回滚。组织/项目 code 按既有服务消费约定登记 `aij-base-dev-development-org`、`aij-base-dev-development`，均包含 environment 后缀。

| 页面 | 菜单权限 | 列表 API |
| --- | --- | --- |
| `/auth/admin-users` | `admin.user.manage` | `/api/admin/users` |
| `/auth/roles` | `admin.role.manage` | `/api/admin/roles`，并登记 `admin.permission.manage` |
| `/auth/dictionaries` | `admin.dict.read` | `/api/admin/dicts` |
| `/auth/audit-logs` | `admin.log.read` | `/api/admin/logs` |

字典 read 仅在唯一 owner `scripts/dictionary-policy.cjs`/`.d.cts` 新增 `DICTIONARY_READ_PERMISSION/DEFINITION`；Base 登记 read/manage。Controller/Guard/UI 权限语义完全不变，普通只读用户的后续语义由 AF-135 消费此定义；本卡初始 super-admin 可沿既有授权路径访问。既有密码 hash、角色关联/授权、自定义 scoped configuration 均没有更新 SQL；生成密码文件仅用于首次初始化，不保证管理员手工改密后仍为当前密码。

## 已运行检查

- `node --test scripts/verification/base-development.test.mjs scripts/verification/seed-cli.test.mjs scripts/test/runtime-environment.test.mjs scripts/test/database-target.test.mjs scripts/test/project-configuration.test.mjs`：118/118 通过，零失败、零跳过，纯配置/文件/拒绝检查，不连接数据库或创建 Docker 资源。
- 定向 eslint（上述候选脚本、policy、seed、测试）：退出 0。
- `pnpm lint`：退出 0；既有 Next pages 路径提示仍输出，不是测试失败。
- 候选 `.mjs`、`.cjs` 的 `node --check`：通过。
- `git diff --check`：通过。

覆盖范围包含：严格 CLI 参数/帮助、project 精确目标及 host 保护、跨机器/用户/项目 owner 拒绝、私有文件/符号链接拒绝、Docker 无记录接管拒绝、容器/卷/Compose 配置拒绝、缺失持久卷拒绝、独立输出与 Web 密钥排除、真实自身进程快照、进程身份变更拒绝、四菜单重复登记及定制保留/命名空间拒绝、现有 seed 密码与 host 目标拒绝回归。菜单纯测试使用内存 query adapter 验证插入策略，不是数据库集成或现场菜单验收证据。以上是同一 Writer 自查，不冒充独立 Review。

## 总控剩余真实门禁及人工验收

1. 注册/检查 `base:dev` root script、API/Web 隔离输出的 Git/eslint ignore，以及正式 `verify:task AF-134`；复检 3855/3856/55434 与 Docker 名称/labels/卷，串行执行 init/start（首启含独立构建）。依赖包和 Prisma Client 若尚未生成，由总控既有质量门禁准备；候选不更新依赖或锁文件。
2. 真实地址应为 `http://127.0.0.1:3855/login`；管理员 `aij-admin` 的初始密码只在受限 `.local-data/base-development/initial-admin.json`。用浏览器正式登录，看到并点开四菜单，核实实际页及四列表 API200；浏览器会话应可在 HTTP 开发环境保持，不使用 production Secure 策略。
3. 记录菜单 ID/数量、initial-admin 文件与数据库 password hash 的摘要，做一次可分离的自定义授权/配置后再次 init；比较原值不变且无重复菜单。不要把密码、hash 或秘密写进执行记录/日志。
4. 真实 stop/start，确认库、卷、凭据保留，重新登录并验证下一次启动命令；成功后立即按负责人格式交付地址并保持运行。
5. 总控执行正式 task 门禁、适用 build/Git 检查、更新记录/队列，按原标题仅本地提交并回读 SHA，完成真实集成 Task。候选未改 registry/队列、未提交/推送，未标记 CODE_VERIFIED 或 OWNER_ACCEPTED；AF-135/AF-130 仍未启动。

Writer 交接：候选完成后停止写入，代码与此记录交总控串行集成；不声称现场已运行。若真实归属/数据冲突需放松保护，或同根因两轮仍失败，保留现场、给出复现与唯一下一步，不自动重置资源。
