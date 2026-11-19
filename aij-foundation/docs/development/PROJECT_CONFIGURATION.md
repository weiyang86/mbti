# 项目命名空间与隔离配置（AF-003）

契约版本 `aij.project-config/v1`。唯一实现为 scripts/runtime-environment.cjs，公开类型为同名 .d.cts；API/Web/启动器共用，不在包或应用中复制配置实现。AF-003 是新项目复用前置，没有生成器、下游新目录安装、数据库、Auth、Cookie会话或文件服务迁入。

## 1. 宿主与生成项目

默认 RUNTIME_PROFILE=host 仅代表本仓库已知的 aij-foundation 宿主，保留 Web3655/API3656。外来 PROJECT_ID 不会在host中静默生效。生成项目必须 RUNTIME_PROFILE=project，显式填写下表字段；也可直接调用 resolveProjectConfiguration(input, options)。所有配置均只监听127.0.0.1，当前URL只接受HTTP localhost/127.0.0.1，不能据此宣称支持生产公网部署。

| 对象字段 | 环境字段 | 生成项目要求 |
| --- | --- | --- |
| projectId | PROJECT_ID | 明确小写字母/数字/连字符，最多48字符；拒绝轻企身份和保留宿主身份 |
| environment | APP_ENV | development/test/production；项目业务环境，必须显式指定 |
| webPort / apiPort | WEB_PORT / API_PORT | 明确不同的1024–65535端口，拒绝旧产品端口及本库宿主/数据库保留端口；不自动分配固定值 |
| origin / apiUrl | WEB_URL / NEXT_PUBLIC_API_URL | 与各自端口一致；Web为origin，API为/api路径；拒绝外部地址、URL凭据、query、fragment、错误路径 |
| issuer | JWT_ISSUER | `urn:aij:<projectId>:<APP_ENV>:<用途>`；用途为小写字母/数字/连字符 |
| cookiePrefix | COOKIE_PREFIX | `<projectId下划线形式>_<APP_ENV>`，可加下划线后缀；拒绝跨项目/环境前缀 |
| storageRoot | LOCAL_STORAGE_ROOT | 本项目根内，路径含连续的projectId/APP_ENV及子目录；拒绝越界、旧项目根、祖先符号链接，不自动创建目录 |
| capabilities | AUTH_ENABLED / DATABASE_ENABLED / STORAGE_ENABLED | 显式true/false，默认false；只验证未来能力所需条件，不能使未迁实现变成可用 |
| enabledPlugins | ENABLED_PLUGINS | 显式插件代码集合；当前实际白名单为空，配置有效也不能启动未迁插件 |

NODE_ENV是Nest/Next的框架编译/运行模式，与APP_ENV分开；NODE_ENV=test会选test身份并拒绝显式APP_ENV=development错配，启动器把解析后的APP_ENV传给子进程；本地production build/start仍可属于APP_ENV=development。真实生产监听、TLS、代理和公网origin策略由部署任务决定，目前production环境标识也只允许loopback。

根 .env 仍只作为数据解析，进程环境优先，不source shell、不按应用cwd误读其他工程。默认读取本仓库根；生成后的项目须拥有自己的根与配置。直接契约的options.projectRoot必须存在，默认本库根；拒绝指向已知qingqi-ai-consultant目录。契约不复制或移动已有存储数据。

## 2. 两套合成配置与重复检查

本库根目录可运行以下只解析配置的命令，不启动服务、不创建存储文件、不读取真实凭据：

```bash
node --input-type=module <<'JS'
import environment from "./scripts/runtime-environment.cjs";
function input(id, port) {
  return {
    projectId: id, environment: "development", webPort: port, apiPort: port + 1,
    origin: "http://localhost:" + port, apiUrl: "http://localhost:" + (port + 1) + "/api",
    issuer: "urn:aij:" + id + ":development:api",
    cookiePrefix: id + "_development",
    storageRoot: ".artifacts/manual-projects/" + id + "/development/storage"
  };
}
const alpha = environment.resolveProjectConfiguration(input("alpha", 4655));
const beta = environment.resolveProjectConfiguration(input("beta", 4755), { peers: [alpha] });
environment.assertProjectIsolation([alpha, beta]);
console.log([alpha, beta].map(({ projectId, namespace, webPort, apiPort, issuer, cookiePrefix, storageRoot }) =>
  ({ projectId, namespace, webPort, apiPort, issuer, cookiePrefix, storageRoot })));
JS
```

结果应为不同的alpha/beta身份、4655/4656和4755/4756端口、issuer/Cookie前缀和存储路径。peers或assertProjectIsolation的集合中，重复namespace、issuer、Cookie、任一端口、数据库目标、已启用能力密钥以及重叠存储路径均拒绝。

这不是持久化全局命名空间注册库；生成器或组合宿主必须提交完整的同机配置集合。跨环境密钥重用检查需要在同一调用进程中提供已解析的peer对象；序列化副本不能冒充已验证对象。密钥指纹只留在私有WeakMap，不写入返回配置、日志或文档。

## 3. 能力启用与凭据边界

未启用auth/database的空值、模板值和未启用插件的凭据不会阻断工程骨架。AF-013启用管理员auth时只强制JWT_SECRET；三个CLIENT_*保留字段尚未消费，空值不强索取，显式提供时仍校验。启用字段必须至少32字符、足够字符种类、无常见模板/default/旧产品值，且彼此不复用。错误只显示字段名，不显示值；没有默认密钥或跨环境fallback。

插件只有在enabledPlugins中被选择时才核对其显式声明的options.pluginSecretRequirements键；AF-003只通过合成fixture-mail声明验证此协议，没有猜测或迁入真实Provider/通知/支付配置。真实插件的凭据声明由后续owner随实际manifest核验，未选择插件不能索取凭据。

database能力启用时必须提供自己的PostgreSQL URL，loopback、显式端口、独立项目/环境user和database，拒绝原库15435和其他环境目标；返回仅含去敏目标，不连接数据库。生成项目名称为projectId下划线形式加APP_ENV，例如alpha_development。宿主继续保留开发55432/aij_foundation_dev、测试55433/aij_foundation_test，拒绝端口互换；生成项目不得借用这两个宿主DB端口；test只读TEST_DATABASE_URL，绝不回退DATABASE_URL。

AF-011已迁入唯一Prisma服务及真实readiness；loadRuntimeEnvironment和启动器允许DATABASE_ENABLED=true，AF-013允许管理员AUTH_ENABLED=true，但必须同时DATABASE_ENABLED=true；文件仍拒绝启用。宿主只读所选dev/test本机忽略配置，显式环境变量优先；仅受记录保护的DATABASE_ACCEPTANCE_ID可选AF-010至AF-016新验收库，普通dev/test白名单不放宽。项目模式仍显式使用自己的URL/身份/端口，不读宿主托管凭据；本轮真实DB验证限宿主test。配置有效不代表已迁移，缺迁移ready503；操作见[Readiness指南](DATABASE_READINESS.md)。Cookie名和管理员storage key仍仅由前缀派生；AF-013真实Bearer JWT使用urn:aij:<projectId>:<APP_ENV>:admin audience与配置issuer，15分钟/HS256，见[管理员认证](ADMIN_AUTHENTICATION.md)。无Cookie会话或Web持久化。

AF-004复用同一databaseTarget解析与密钥校验，增加独立resolveDatabaseEnvironment和db:check dev/test；宿主端口、database、user均按精确白名单拒绝后缀或互换，宿主生产数据库暂不开放，返回host保留实际校验的localhost/127.0.0.1而不改写。生成项目仍按自己的projectId/APP_ENV/显式端口配置，不强绑宿主数据库。详细规则及配置通过与真实连接的区别见 [数据库目标校验](DATABASE_TARGET_CHECK.md)。

## 4. 实际消费与验收

启动器继续从唯一配置获得端口/地址并检查占用；API health的service由projectId派生，新增公开projectId与namespace；不输出issuer、密钥或存储路径。Web构建读取同一API URL和预期serviceId，生成项目需要按自己的环境重新构建，不能复用宿主已烘焙配置的Web产物。

运行 `pnpm run verify:task -- AF-003`：执行已注册端口/版本前置、38项配置测试、API build、Web build、2项真实HTTP测试。测试只在本库忽略.artifacts/下创建合成文件，声明的服务为宿主3655/3656与alpha4656/beta4756；停止前核对PID/PPID/CWD/命令，只结束自有启动器及其进程组，检查端口释放。

生产监听、真正生成/安装新项目、客户认证/存储/插件迁入、包发布与实际部署仍待后续明确指派。AF-003阶段的人工步骤和真实证据保留在[AF-003执行记录](../execution/AF-003.md)，当前数据库接入见AF-011；Trea待复核、人工待验。
