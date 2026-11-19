# 独立开发环境约定

2026-10-27 UI-1当前人工服务已准备，Web3655/API3656仅loopback，本库test实例55433内使用AF-029独立合成验收库。账号/忽略密码文件/精确停止和恢复见[管理员浏览器指南](ADMIN_BROWSER_AUTHENTICATION.md)和[AF-029](../execution/AF-029.md)。以下旧PID/范围按历史，不操作原库15435或旧验收库。

2026-10-20 AF-025-A当前人工API为客户登录/会话认证，PID70954在127.0.0.1:3656；Web未启动，旧AF-024人工STOPPED。实际客户邮箱、忽略密码路径、Origin与精确停止规则见[客户指南](CLIENT_AUTHENTICATION.md)。以下旧地址/PID保留历史，不视为仍运行。

2026-10-20 AF-024当前人工入口为审计API，AF-023已接收、其旧人工API已停止；当前地址/账号与受控启停见[审计指南](AUDIT_LOG_API.md)。本页原阶段地址与PID保留历史，不能据此假定旧验收服务运行。

AF-023当前增量：已接收AF-022；SecretRefPort及env/加密本地SecretStore已接入。敏感配置写额外要求admin.secret.manage，--configuration显式登记该权限依赖但不修复grant；local://引用可绑定，轮换时原子重绑/version+1，清除后消费拒绝。原阶段描述按历史保留，当前协议/实际地址与凭据路径见[密钥引用指南](SECRET_CENTER_API.md)。

AF-016已接收前序并接入角色/权限管理API，当前人工API3656/合成账号/忽略密码文件/停止命令以[角色权限指南](ROLE_PERMISSION_API.md)为准。本页旧任务范围/PID按历史阅读，不沿用旧PID；Schema/initial及既有接口契约保持。

AF-015当前保留自有新逻辑合成库与人工API3656，原dev/test仍只有AF005哨兵；无Web页面。实际地址/账号/忽略密码文件及核验后停止步骤见[管理员管理指南](ADMIN_USERS_API.md)，以下旧任务服务状态按历史阅读。

2026-10-19 AF-014：开始3655/3656无监听，AF-013前置真实回归通过；本轮复用唯一Prisma/JWT，新增当前DB权限Guard/两只读入口及合成super/reader/no-access账号。人工API3656及一条自有池保留，Web未启动；原dev/test与55432/55433及原15435保持。实际账号/忽略密码路径/步骤与核验后停止命令见[RBAC指南](RBAC_AUTHORIZATION.md)。以下AF-013及更早均为历史现场。

2026-10-19 AF-013：开始3655/3656无监听；当前保留仅本任务API3656及一条自有Prisma池，Web未启动。AUTH_ENABLED=true且DB enabled，issuer为urn:aij:aij-foundation:test:api；仅新AF-013合成库/账号，初始密码和JWT key只在忽略文件，已有凭据不重置。实际地址/路径/操作和归属核验后停止命令见[管理员认证](ADMIN_AUTHENTICATION.md)。原dev/test与55432/55433及原15435保持，以下均保留阶段事实。

2026-10-19 AF-012现场：开始和交付时3655/3656无监听，AF-011前置回归曾启动并关闭自有临时API；Seed不启动服务。55432/55433保持，本轮只在新AF-012逻辑测试库迁移/Seed合成组织/项目和初始管理员，原dev/test保持。管理员初始密码与DB密码分别在本机忽略目录，详见[最小Seed](MINIMAL_SEED.md)。下方AF-011及更早的保留服务/PID为历史现场。

2026-10-19 AF-011当前现场：API已接入唯一Prisma及真实readiness，人工准备保留3656（health/ready均200）及一条自有池连接，Web3655未运行；仅新AF-011逻辑测试验收库有本轮迁移，原dev/test及两实例/卷保持。环境优先级、地址/密码文件和归属核验后停止命令见[Readiness指南](DATABASE_READINESS.md)。以下AF-006/F01启动/PID/堆栈说明均保留当时事实；当前main启动失败只输出固定去敏消息。

2026-10-18 AF-006补充：管理员/RBAC七模型和两个枚举已迁入，本库Prisma6.19.0离线validate/generate通过；本轮没有迁移/建表/Seed或API数据库连接。编译URL与dev/test连接目标分离，命令与owner见 [RBAC_SCHEMA](RBAC_SCHEMA.md)。以下AF-005实例及早期说明保留对应阶段事实。

2026-10-18 AF-005当前：本库PostgreSQL16.14已在127.0.0.1:55432/55433同时运行，两个独立Compose项目、角色/database和命名卷；实际身份与持久化已测，人工准备已执行并保留服务。本机随机凭据只在忽略的.local-data/postgres/{dev,test}/，根.env未创建。db:check默认真实连接，--config-only才只检查配置；up/stop/restart/cleanup与人工SQL步骤见 [实例指南](DATABASE_INSTANCES.md)。以下AF-004/F01描述按其日期保留，不能当当前无数据库。

2026-10-18 AF-004当前增量：已有 `pnpm run db:check -- dev` / `pnpm run db:check -- test`，精确校验本库host白名单并去敏输出；不连接、启动或创建数据库。TEST_DATABASE_URL缺失不能回退开发变量；模板密码应失败。凭据只由负责人配置到本库忽略的.env，当前测试只使用.artifacts中的随机合成环境文件。规则和人工步骤见 [数据库目标校验](DATABASE_TARGET_CHECK.md)。以下AF-003/F01时点描述保留为历史，当前执行见AF-004。

2026-10-18 AF-003：宿主默认Web3655/API3656保留，生成项目可显式配置自己的身份、端口和隔离字段，详见 [项目配置契约](PROJECT_CONFIGURATION.md)。本轮已在测试生命周期内实测宿主与两个合成API并停止自有服务，当前未保留运行；未创建真实.env、Compose或数据库。55432/55433保留，数据库/Auth实现仍待后续迁入。F00/F01预检、PID与运行描述保留为历史，当前验证见AF-003执行记录。

## 1. 端口与数据库

| 资源 | AIJ 新库约定 | 原库证据 / 隔离要求 |
| --- | --- | --- |
| Web | `http://localhost:3655`（F01 已运行） | 新启动器已消费并校验 WEB_PORT=3655，绑定 127.0.0.1；原库 scripts 不改 |
| API | `http://localhost:3656/api`（F01 已运行） | 新启动器与 API 共用 API_PORT/WEB_URL/NEXT_PUBLIC_API_URL 校验；原库默认 3556 不改 |
| 开发 PostgreSQL | `127.0.0.1:55432`，DB/User `aij_foundation_dev` | 原 compose 默认 host 15435、DB qingqi_ai、container qingqi-consultant-postgres；真实环境覆盖值未读取 |
| 集成测试 PostgreSQL | `127.0.0.1:55433`，DB/User `aij_foundation_test` | 独立实例/数据库/账户/卷；不得 fallback 到开发或原库 DATABASE_URL |
| Compose project | `aij-foundation-dev`；测试另用 `aij-foundation-test` | 不复用 qingqi 容器名/项目名/volume；不要设置冲突的固定 container_name |
| 数据卷（目标） | `aij-foundation-dev_postgres_data`；测试 `aij-foundation-test_postgres_data` | 由各自 project 和 volume 定义生成；不声明 external 旧卷，不挂载原工程 data |
| 文件数据（契约；文件服务未迁入） | 新库 `.local-data/aij-foundation/development/storage`，其他项目按projectId/APP_ENV分开 | 不移动既有目录，不读取/复用旧uploads；测试仅在.artifacts/写合成文件 |

2026-10-12 本机 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 对上述四端口均无监听结果。此结论是当时预检，不是长期保留；下一启动前复检。没有读取原 `.env`，没有连接原 PostgreSQL，原环境实际 host/user/db 值未验证。

后续 Compose 的 PostgreSQL host 端口仅绑定 `127.0.0.1`。宿主运行 API 时用 `127.0.0.1:55432`；若 API 容器化，其容器内连接应使用新 Compose 网络的 `postgres:5432`，不能直接套宿主 URL。数据库密码由本地生成；模板占位符不应进入运行配置。

## 2. 配置与身份隔离

使用本库重新编写的 [.env.example](../../.env.example)，不能复制原库环境文件。F01 启动不需要创建 .env，默认使用本库的 3655/3656、loopback URL、TRUST_PROXY_HOPS=0 和空插件集合。若本地自行创建根 .env，Node parseEnv 只解析其数据，进程环境覆盖同名值；启动器和 API 只读取本库根文件，不 source shell，不按 cwd 寻找其他工程环境。

开发数据库密码、管理员初始密码和四类 JWT/认证 Secret 均为空，在后续启用数据库/认证任务时本地生成，不共享原值。对应能力启用后必须拒绝空值/模板值，不能使用源 auth 默认 secret。F01 没有这些模块，不能把其未消费的变量视为已经验证安全或配置完毕。

AF-003由唯一解析器校验宿主默认值与生成项目显式参数；旧项目、外部/带凭据URL、无效端口、未分环境的issuer/Cookie/存储路径拒绝。JWT_ISSUER、Cookie派生名和管理员storage key已形成配置契约，但尚无真实Token/Cookie或文件服务。LOCAL_STORAGE_ROOT基于项目根解析而不是应用cwd；宿主契约路径为 `.local-data/aij-foundation/development/storage`，不迁移既有数据。条件数据库URL只做合成目标校验，不建立连接。

### AF-073/G13-01：本地项目模板 CLI

本库的 `pnpm run aij:project -- create` 生成新的 `aij.project.json`、`.env.example`、`.gitignore` 和项目说明。必须显式提供 `--project-id`、`--environment`、`--dir`、`--web-port`、`--api-port`；可重复传入 `--peer <manifest-or-project-dir>` 检查已生成项目的身份及端口冲突。生成配置分别派生 Web/API loopback URL、issuer、Cookie 前缀和 `.local-data/<projectId>/<environment>/storage`。默认不启用插件，也不启用 Auth、数据库、文件存储或异步运行时；密钥只允许由负责人之后写入项目自己的忽略 `.env`，生成 CLI 不产生账号或秘密。

示例（端口和目录须由使用者先选定且不要与现有服务冲突）：

```sh
pnpm run aij:project -- create --project-id sample-one --environment development --dir /path/to/sample-one --web-port 46111 --api-port 46112
pnpm run aij:project -- show --dir /path/to/sample-one
pnpm run aij:project -- create --project-id sample-two --environment development --dir /path/to/sample-two --web-port 46121 --api-port 46122 --peer /path/to/sample-one/aij.project.json
pnpm run aij:project -- run --dir /path/to/sample-one --app api --mode dev
```

生成器拒绝重复 projectId/端口、底座宿主端口、非法/旧产品身份、已存在目录、不可安全解析的旧产品路径或符号链接，以及与生成身份不符的本地环境覆盖。CLI 的 `show` 输出不含秘密。当前 `run` 仍从本仓库 `apps/api` / `apps/web` 提供宿主源码；项目目录只拥有配置和数据根，因此这是项目隔离模板，不是已独立安装的可发行产品。宿主 `aij-foundation` 仍默认使用 3655/3656；真实下游独立安装、服务并行/数据库与文件隔离由 AF-074 及后续发行门禁验证。生产公网监听和部署策略仍留给部署任务。

| 关切 | 源库实际值 | 新库要求 |
| --- | --- | --- |
| JWT issuer | `qingqi-api`，admin/client audience 分开 | 当前开发契约 `urn:aij:aij-foundation:development:api`；真实Token校验/跨产品拒绝待Auth迁入 |
| 客户会话 Cookie | `qingqi_client_session` | `aij_foundation_development_client_session`（test前缀按环境派生）；AF-025-A启用时实际签发，HttpOnly/SameSite=Strict/Path=/api/client，生产增加Secure |
| Workspace Cookie | `qingqi_workspace_context` | 派生 `aij_foundation_development_workspace_context`；服务端成员关系验证待组织任务 |
| 管理端 localStorage | `accessToken` | 派生 `aij_foundation_development_admin_access_token`；实际登录未迁入 |
| API fallback | 多数 3556，AiSidecar 仍有 3101 | 统一 3656/api，禁止页面悄悄访问原库 |
| 恢复/验证链接 | 认证机制生成链接，具体 URL 配置需定向核对 | 只指向新库 Web；安全 token 不记日志、不进入清单和数据 dump |

localhost 的 Cookie 不按端口隔离；原库和新库并行运行时不能仅靠换端口。若未来选择不同本地域名，也需重新验证 CORS、Cookie 和认证回调。

## 3. 数据库执行门禁（本地实例/工具连接已建立，产品迁移待后续任务）

1. AF-005已建立本库自己的两份Compose与af005_verification.sentinel合成fixture；用明确project/连接参数运行，不共享卷。后续独立库initial migration仍须由目标Schema生成，不复制89份源迁移或旧 `_prisma_migrations`。
2. AF-004已建立URL host/port/db/user精确白名单及db:check。后续migrate/seed/connector必须在同一进程对实际使用的目标调用公开校验，不能仅凭之前一次CLI通过或testDatabase标签作为写库授权；尚未建立这些执行脚本。测试禁止开发或原库URL。
3. 先跑目标 Schema Validate/Generate，再对新库空数据库执行审定 migration；重复 Seed 两次证明幂等。不执行 reset/drop 来处理共享环境。
4. Seed 只写最小 Sys 管理员、角色、权限、菜单、字典、AIJ 项目组织和可选系统插件 fixture。首次管理员密码来自新环境；不写轻企客户、CompanyProfile、诊断、订单、真实商户、业务 Prompt 或业务模板。
5. 原库无迁移、无 seed、无连接替换；后续原产品包消费改造单独立项。

F01已有真实工程门禁；AF-005的db:up/check/stop/restart/cleanup已存在并实测。产品migration/seed脚本仍不存在，不以本任务哨兵SQL冒充它们，后续需单独实现与验收。

## 4. 独立启动验收

新 Web/API 的页面、网络请求、健康检查必须确实来自新目录；可只读检查端口/PID/CWD，不能停止旧工程进程。新数据库中只存在白名单模型与合成 seed，拒绝业务表和跨库凭据。新库停止后原产品进程仍存在；本任务不得为验证而启动/停止原库。若原库没有运行，由负责人按原流程验收其可启动性，F00 不作推定。

本地禁止复用旧 .env、证书、支付/AI/provider key、数据库备份、客户文件、日志、队列和任务数据；这些内容也不能提交到新库。

## 5. F01 收尾后的运行与诊断（历史快照）

本机 Node24.21.0 / pnpm10.0.0，卷为 ExFAT。`.npmrc` 使用 hoisted/copy，依赖是本库真实文件副本；公共 pnpm 缓存不是原应用源码。首次安装的 worker uv_cwd/registry 超时与 postinstall 忽略属于历史记录；当前构建/测试说明 F01 所用能力可用，不为后续 native/图像功能背书。

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

当前保留普通 `pnpm dev`；本轮复核 Web PID85285、API PID85924，CWD 为本库 apps/web、apps/api。旧74878/74851已经失效。操作前用 `lsof -nP -iTCP:3655 -iTCP:3656 -sTCP:LISTEN` 和 `lsof -a -p <PID> -d cwd` 复核，不能只按PID或端口猜归属。`pnpm dev:api` / `pnpm dev:web` 可分开启动；`pnpm start:api` / `pnpm start:web` 消费构建产物，不能同时占用dev端口。build 会改 dist/.next，重建前停止自己启动的dev，完成后再启动。

API 使用 Nest CLI → TypeScript watch → fs.watch（含 watchFile fallback）；Web 使用 Next webpack / bundled Watchpack → fs.watch。本轮原生 watcher 普通保存、原子rename保存及还原均取得 HTTP200 证据。当前不强制 polling。历史scandir ENOENT、mkdir EACCES 与API TS5083没有本轮复现，根因仍未确认；R/W挂载、owner/模式、访问检查没有发现异常，未改系统权限或复制工程试错。完整诊断边界见 CURRENT_STATE第7节。

启动器保留实际socket错误cause，只有EADDRINUSE提示占用；API启动失败保留堆栈。Unix下CLI/子进程属于每次启动独立的进程组，Ctrl+C/SIGTERM只停止该组。本轮实际验证API SIGINT与Web SIGTERM之后无端口残留，原库PG进程保持；不按端口批量kill，也不停止其他工程。Windows只保留直接child停止逻辑，本轮未做Windows验证。

独占Writer、两个dev已运行时可执行：

```bash
pnpm verify:dev
```

该命令先断言3655/3656监听PID/CWD及dev祖先命令，再临时保存API/Web探针、读取真实HTTP、还原并校验SHA-256；会短暂重启API。检测到并发改动拒绝覆盖，原子临时文件只清理自己创建的文件。只读Review不能直接运行，应先交接Writer。输出为本库忽略的 `.artifacts/f01-closeout/dev-reload.json`；运行日志不提交。HTTP重载证据不代替浏览器Fast Refresh验收。

## 6. 安全范围与人工验收

F01只实现loopback/端口/URL/proxy边界、固定CORS来源、空插件拒绝与health关联ID；health公开，scope=process、database=not-configured。不批准Origin仍可能HTTP200，allow-origin不匹配才体现浏览器读取限制；CORS不是管理员授权。登录/JWT/RBAC/管理员页面/业务审计与独立Cookie尚未实现，不填“管理员安全验收通过”。Browser Use的admin-enforced policy是工具环境，本轮仍因核验不可用拒绝localhost访问，未改策略或绕过。

人工步骤：

1. 打开 `http://localhost:3655`，确认AIJ入口、实时“已连接 AIJ API”、时间/空插件；检查窄屏和Console，无轻企导航或虚构登录。
2. 打开 `http://localhost:3656/api/health` 核对真实service/process/not-configured/空插件。55432/55433仍无本次数据库；不建库、不迁移、不连接原PG15435。
3. Web Console运行 `fetch('http://localhost:3656/api/health').then(r => r.json()).then(console.log)`，检查Network/CORS及无3556/3101请求。页面本身SSR从API读取，Network没有API请求不能证明未连接。非批准来源的浏览器读取行为留给人工另行确认。
4. 保存修改/Fast Refresh浏览器表现需人工观察，保存源码或运行verify:dev前先指定唯一Writer。登录/管理员接口404只代表未实现，不验证不存在的账号与权限。
5. 负责人记录浏览器与长驻观察结果、接收结论并决定Git节点。真实检查、原始日志与剩余限制见CURRENT_STATE第7节；本轮不启动F02。

## 7. AF-003 当前配置验收

执行 `pnpm run verify:task -- AF-003` 前确认本机3655/3656/4656/4756空闲；占用时失败退出，不停止其他进程。命令会实际构建API/Web，运行38配置测试及2 HTTP测试，临时启动声明的宿主/合成API并核对归属后停止；不是零写入或仅文件存在检查。完整命令、退出码与人工步骤见 [AF-003](../execution/AF-003.md)。

宿主框架build/start使用NODE_ENV=production不改变默认APP_ENV=development；真实生产环境必须独立指定APP_ENV与隔离字段，公网监听/代理/TLS由部署任务另定。目前所有环境都只允许loopback。NODE_ENV=test自动选test身份并拒绝APP_ENV开发错配，启动器保持子进程APP_ENV；测试APP_ENV=test只取TEST_DATABASE_URL，能力未启用时不索取其凭据；未来数据库执行仍必须通过真实目标门禁，本轮没有建库/迁移/Seed。
