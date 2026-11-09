# 数据库目标校验（AF-004）

这是AF-004建立的连接前配置保护，唯一策略owner仍为scripts/runtime-environment.cjs。AF-005已增加pg连接与SQL身份核对，默认db:check真实连接；本指南命令显式--config-only才只运行下述策略。实例生命周期、真实连接结果及凭据路径见 [DATABASE_INSTANCES](DATABASE_INSTANCES.md)。没有产品Prisma Schema/迁移/Seed。

## 1. 明确选择环境

在本库根目录、Node24/pnpm10执行：

```bash
pnpm run db:check -- dev --config-only
pnpm run db:check -- test --config-only
```

模式必须显式为dev或test，至多忽略一个可选--，未知/缺失/多模式退出2。模式独立于APP_ENV：本库.env默认APP_ENV=development不会让显式test改读开发URL；NODE_ENV=test反而禁止显式dev。RUNTIME_PROFILE如有配置必须host，PROJECT_ID如有配置必须aij-foundation。生成项目应继续使用自己的AF-003项目契约和环境，不能套用本库固定白名单。

| 模式 | 唯一读取变量 | host白名单 | port | database及user（均精确） |
| --- | --- | --- | --- | --- |
| dev | DATABASE_URL | localhost或127.0.0.1 | 55432 | aij_foundation_dev |
| test | TEST_DATABASE_URL | localhost或127.0.0.1 | 55433 | aij_foundation_test |

每次只验证所选变量，不用另一个变量、POSTGRES_PASSWORD、模板值或默认URL兜底。未选变量格式错误不会妨碍当前模式；所选变量即使在DATABASE_ENABLED=false时仍须通过。APP_ENV/NODE_ENV不能替代显式CLI模式。宿主生产数据库、容器网络主机及生产监听策略由后续任务定义。

## 2. URL和凭据

- 协议仅postgres或postgresql，明确端口，user/database满足上表。拒绝原库15435、外部主机、0.0.0.0、开发/测试互换、库名后缀、其他用户。
- query仅允许省略或恰好schema=public；拒绝host/options/其他query、重复参数、fragment、空query、非法编码及URL空白/控制字符。不会做DNS解析或端口探测；localhost仍原样返回，不偷偷改写主机。
- 密码先URL解码，再复用AF-003密钥策略：32–4096字符、至少10种字符，拒绝常见replace/change-me/template/example/default/password/secret/local-only/test-only/qingqi模板及空白/控制字符。密码须独立生成，特殊字符URL编码；不在源码、命令行、报告或聊天中提供真实值。
- AF-005按进程环境→本库根可选.env→所选环境的.local-data/postgres/<mode>/.env加载；同名空值也覆盖。只选本环境URL，不执行shell或读取原库.env；本次新生成凭据已在忽略的本机文件，无需复制.env.example或覆写现有环境。不要打印环境内容。

显式--config-only成功exit0，JSON为status=CONFIG_VALID、connectionAttempted=false及mode/variable/host/port/database/user；不含密码、完整URL或密钥指纹。策略拒绝exit2；真实连接成功为CONNECTED，认证/连接/身份失败exit3。错误只给固定策略与安全code，不输出Node URL/driver cause。stdout用于成功，stderr用于拒绝。

## 3. 实测与人工验收

```bash
pnpm run verify:task -- AF-004
```

注册前置实际核对Node24、AF-003文件和Git忽略目标；三份注册测试文件共81用例，数据库文件含43用例，既有配置回归38。实际读取/读回忽略的随机合成.env，运行Node CLI和根pnpm两模式，核对成功/拒绝退出码、源文件摘要不变、不创建应用存储及原始/编码密码不出日志。网络拦截探针先用自检证明有效，再拦截任何CLI网络尝试；不监听或连接15435，不需要真实数据库。注册effects只允许.artifacts，无服务、testDatabase写入或唯一Writer源码探针；没有prepare-manual钩子。

负责人逐步人工检查：

1. 阅读脚本、注册命令和具体断言，运行上述verify命令，核对report.json、各命令exitCode和81个有效用例；每条实际CLI参数数组和退出码另存.artifacts/af-004/database-tests/run-*/的去敏.json。
2. 检查本机既有独立配置时分别运行db:check dev和test并加--config-only；确认正确host/port/database/user、CONFIG_VALID和connectionAttempted=false。去掉该参数才做AF-005真实连接。不要覆写现有凭据或把密码放进shell命令。
3. 使用独立合成.env副本分别留空TEST_DATABASE_URL、改为开发目标、15435、模板密码或外部主机。用 `node --env-file=<合成文件路径> scripts/db-check.mjs test --config-only` 检查exit2且不含密码；不修改现有环境或连接原库。
4. AF-004没有Web或账号创建；AF-005现在已创建本地DB角色/实例并提供单独指南，人工结果需分别记录，不能继续套用AF-004无数据库结论。

CONFIG_VALID只证明这份输入符合当前保护规则。后续connector/migrate/seed必须在同一进程对实际使用的环境再次校验，保持test与dev凭据独立；真实连接、readiness、空库迁移和写库证据须在其任务实际运行，不能用本项代替。
