# AF-023 密钥引用与受控配置API

2026-10-28 AF-037增量：新增 `/auth/secrets` 管理页面，使用现有 SecretCenter API 和 `admin.secret.manage`，不新增服务端实现。页面列表只消费 API 安全投影；登记/轮换只提交引用字符串，检查/清除提交当前 `updatedAt`。页面不收集或展示密钥值，不回显 API 错误原文。configured 仅表示本机适配器状态。端到端集成与负责人浏览器验收以[AF-037执行记录](../execution/AF-037.md)为准；本地构建通过不代表 API/DB 测试通过。

2026-10-20 AF-024当前人工入口为审计API，AF-023已接收、其旧人工API已停止；当前地址/账号与受控启停见[审计指南](AUDIT_LOG_API.md)。本页原阶段地址与PID保留历史，不能据此假定旧验收服务运行。

F00 M06定向适配原Secret Center的引用/adapter/元数据/检查结构，唯一实现为API的SecretCenterModule。SecretRefPort通过useExisting公开同一个SecretCenterService，ConfigurationModule消费该端口；没有第二份Secret/审计/Prisma实现。Schema、两迁移、依赖和Web保持。

## 1. 引用和服务端解析

- env引用只允许`env://AIJ_SECRET_<PROJECT_ID_UPPER>_<ENVIRONMENT_UPPER>_<NAME>`，项目横线转下划线；宿主test例：`env://AIJ_SECRET_AIJ_FOUNDATION_TEST_DEMO_OLD`。NAME为3–64位大写字母开头的字母/数字/下划线。旧格式仍能通过配置的语法检查，但不在当前命名空间的旧引用不能被解析；不支持裸env变量名回退。
- 本地引用为`local://<projectId>/<environment>/<NAME>`，例如`local://aij-foundation/test/DEMO_OLD`。拒绝任意file/http URL、跨项目/环境、路径段、模板及inline值；不能探测DATABASE_URL/JWT_SECRET/SecretStore解密变量。
- 服务端读取本库根.env与进程环境，进程优先。只将引用对应的值交给受信后端消费者。值要求16–8192字符、无空白、非模板；未设置/不合规值失败闭合。不要求未使用的local适配器解密密钥，也不探测外部Provider。
- 每次解析重读当前active未删SecretReference、项目/组织状态和实际provider；不缓存值。ConfigurationService.resolveTrustedSecret只接受已登记secretRef配置key，按原三scope优先级取当前引用，再调用唯一端口。它没有HTTP值返回入口。
- 缺配置/未登记或已清除引用为404，缺值/错误密钥/损坏文件/数据库故障为503，项目组织停用或跨命名空间403。对应能力必须中止，不能用默认Key/旧引用/另一环境值兜底。已开始的请求不被追溯撤回；轮换完成后的新调用读取新引用。

## 2. 本地受保护SecretStore

默认文件为本仓库`.local-data/secrets/<projectId>/<environment>/store.json`。可用服务端`AIJ_SECRET_STORE_FILE`指定同一目录下的规范绝对路径（当前验收按库ID再分目录）。路径不得越界或含符号链接；检查所有私有目录/文件的owner与报告的组/其他用户权限、regular file、单硬链接、O_NOFOLLOW、最大65536字节；不读取原库目录。

文件为JSON：version=1、namespace=`<projectId>:<environment>`、algorithm=`aes-256-gcm`、iv=12字节hex、tag=16字节hex、ciphertext=hex。AES-256-GCM的AAD是namespace，明文是NAME→字符串值的JSON字典。服务端专用`AIJ_SECRET_STORE_KEY`必须64位小写hex，真实密钥由负责人另行安全配置，不能写进数据库/API/NEXT_PUBLIC或与真实文件一起公开。解密中间Buffer清零；不宣称能清除JS运行时所有字符串副本。

现场磁盘为ExFAT，实际chmod没有按请求改变模式，因此**不把POSIX权限位当作已证明的唯一保护**。文件必须加密，错误key/tag/namespace/格式真实测试均503/配置状态false。权限/symlink/hardlink检查是额外拒绝条件；本轮没有声称真实跨用户ACL、权限修改或symlink攻击实测通过。真实生产密钥托管、KMS/Keychain、证书/多行凭据、生产部署均未交付。

API不写入/接收密钥值，不创建真实SecretStore。prepare工具仅为本任务自己的合成库生成加密文件和独立合成key文件；已有文件缺一项或归属不符就拒绝，不能静默重置。合成解密key文件仅供本地测试，不是生产密钥托管方案。

## 3. 后台入口和原子操作

前缀`/api`，全局JWT+RBAC强制active `admin.secret.manage`；所有响应no-store。返回仅id/ref/provider/status/configured/updatedAt与列表分页，不返回值、description自由文本、hash或Adapter错误。configured表示本机解析可用，不证明外部服务live。

| 方法/路径 | 输入与行为 |
| --- | --- |
| GET /admin/secret-references | page 1–10000/pageSize 1–100，q/status可选；仅当前运行命名空间，顺序createdAt desc/id asc |
| GET /admin/secret-references/:id | 当前引用详情与实时configured；其他命名空间/未知ID404 |
| POST /admin/secret-references | 仅ref；成功201，可登记尚未提供值的引用，此时configured=false；重复409 |
| POST /admin/secret-references/:id/check | expectedUpdatedAt；仅本机适配器可用性检查，200并原子审计；不探测任意新ref/外部连接 |
| POST /admin/secret-references/:id/rotate | 新ref+expectedUpdatedAt；200并启用新引用、重绑已有secretRef配置、版本+1/审计/变更全部同事务；新值未提供则configured=false且后端消费503 |
| POST /admin/secret-references/:id/clear | expectedUpdatedAt；200将引用disabled，后续解析拒绝；保留配置绑定/历史，不删除env/文件/用户或清库 |

所有控制写共用已有写锁、事务内权限重查、乐观时间戳和安全审计；旧版本或并发冲突409，不覆盖另一笔。轮换/清除碰到当前global绑定额外要求DB超级；外项目/插件scope绑定存在则409，不跨域改写。没有新增任意配置key或插件安装能力。

`private.integrationRef`写入另需admin.config.manage+admin.secret.manage，global仍需DB超级。普通配置角色不能借“已登记？”结果探测引用；仅保存规范引用字符串，无真实值进入ScopedConfig。Seed --secrets只注册权限定义；--configuration也登记这个显式依赖，不修复已有状态/授权，不种配置值。当前读取配置API继续隐藏敏感引用；公开project/context仍只有品牌和实际能力白名单。

创建/轮换/清除/检查及每个配置重绑定的共享AuditLog与ConfigurationChange原子写入，仅资源ID/字段名/版本/操作者/关联ID和安全状态，不记录ref旧值/实际secret/request body。审计或变更插入失败整笔503回滚。权限撤销/角色停用对同JWT下一请求即时生效，菜单/CORS/自报permission/workspace不授予权限。

### AF-037 SecretRef 管理页面

页面位于 `http://localhost:3655/auth/secrets`，菜单与页面都使用 `admin.secret.manage`；API 仍独立执行认证、权限、项目环境命名空间、DTO 和版本检查。页面展示引用、provider、configured、状态和更新时间；详情不展示自由文本说明。新建只登记引用，轮换只提交新引用及当前 `expectedUpdatedAt`，检查与清除使用当前时间戳；不会向任何接口发送实际secret值。清除只禁用数据库引用，不删除env/local SecretStore内容。

页面把409显示为引用版本冲突并提示重新检查，不显示响应原文、堆栈或secret。创建、检查、轮换和清除后的反馈只显示安全configured状态；未配置时仍明确失败闭合。列表/详情只信任服务端返回的 `id/ref/provider/status/configured/updatedAt`，渲染和错误提示不使用浏览器console。实际路由、后端菜单目录、执行器及真实数据库/HTTP测试见[AF-037执行记录](../execution/AF-037.md)。

## 4. 当前实际人工入口（待负责人执行）

注册准备已实际exit0。API为`http://localhost:3656`，health/ready为`/api/health`、`/api/ready`；Web3655未启动，没有密钥Web页面。当前PID25301，birth `Mon Oct 19 23:43:27 2026`，CWD本库apps/api，仅127.0.0.1；数据库`aij_foundation_af023_test_f0420afe01875d5b`在127.0.0.1:55433，24个public表（含迁移账本），仅合成数据。PREPARED不代表人工通过。

| 角色用户名 | 当前管理读取预期 | 初始密码所在本机忽略文件 |
| --- | --- | --- |
| aij-admin（DB超级） | 200 | `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af023_test_f0420afe01875d5b/initial-admin.json` |
| af023-manager（已授权合成管理者） | 200 | `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af023_test_f0420afe01875d5b/rbac-management-accounts.json` 中对应username |
| af023-reader（普通角色） | 403 | 同一accounts文件中对应username |

合成加密文件：`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/secrets/aij-foundation/test/f0420afe01875d5b/store.json`。合成解密key路径：`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/auth/test/aij_foundation_af023_test_f0420afe01875d5b/secret-store-key.json`，API运行时已配置，不需要粘贴到API；报告不包含其值。密码/JWT/本机值文件重复准备均不重置；若负责人已改密码，应使用新密码，初始文件不是密码恢复器。

1. 本机HTTP客户端对POST /api/auth/login发送username/password，令牌只保留本机客户端内存，后续用Authorization: Bearer请求，不上传密码/Token到Review或聊天。
2. aij-admin和manager GET /api/admin/secret-references应200，初始items=[]；reader同一路径、POST创建和未知ID/check均403；匿名401。先看health/ready应200。
3. manager POST /api/admin/secret-references，body仅`{"ref":"local://aij-foundation/test/DEMO_OLD"}`，应201/configured=true，保存id和updatedAt。GET详情无密钥值；同ref再创建409。
4. 用manager PUT /api/admin/scoped-configs/private.integrationRef，scope=project、configValue=上述ref、valueType=secretRef、isPublic=false、status=active、expectedVersion=0，应200/version1且隐藏值。不要写真Key。
5. POST该ID/rotate：ref=`local://aij-foundation/test/DEMO_NEW`与刚保存expectedUpdatedAt，应200/configured=true；配置绑定变成新引用/version2，管理配置响应仍隐藏；变更列表可查configVersion/auditLogId。此处人工不通过API读取密钥，自动测试已用真实本地HTTP fixture验证新请求携带新值。
6. 用最新updatedAt POST该ID/clear，应200/statusdisabled/configured=false；详情仍只有引用，配置仍保留，服务端消费拒绝。旧时间戳再次修改409。可用新ref轮换重新启用；不删除本地文件或清库。
7. 另登记当前env命名空间的未配置NAME，应201/configured=false；任意env://DATABASE_URL、file路径/跨环境拒绝，extra value/password字段400；普通reader始终403。检查/api/project/context不出现任何引用/secret字段。
8. 对照配置变更与DB安全审计记录核对操作者/关联ID/版本；人工观察结果由负责人填写，本轮不代勾选。

服务停止仅交指定Writer执行`node scripts/verification/secrets-manual.mjs stop`，工具先核对PID/PPID/CWD/命令/birth再精确SIGTERM，检查零连接池。保留库/卷/凭据，不reset/drop/down -v。普通verify需要3656空闲，应先完成服务交接；恢复仅`pnpm run verify:task -- AF-023 --prepare-manual`，已有账号/文件不重置。Trea不运行prepare模式。

## 5. 验证和交接

`pnpm run verify:task -- AF-023`真实执行2前置+13step全部exit0，227结构化有效项+2宿主（继承AF-022206，新增16 HTTP/DB/文件与5 main生命周期）；Prisma validate/generate/API build、lint/typecheck均实际0。最终报告`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.artifacts/verification/AF-023/run-16DfZb/report.json`。env/local、加密失败、轮换重绑/清除、并发、401/403、普通配置角色探测拒绝、真实写锁等待撤权、两类账本失败回滚、断本任务逻辑库503/live200恢复、关闭零池均实跑，不改源码探针或启停DB容器。三次本地HTTP下游调用只证明合成协议，不是付费Provider/live证据。

早期ExFAT权限假设失败后改强制加密；首次注册校验AF-022建库UNAVAILABLE、单跑暴露Secret权限依赖漏登记、二次新增拒绝用例403/400期望错误均保留失败证据。修正未放宽权限/超时或跳过前置。未知AF-024和非法manual参数exit2。完整命令、diff、影响和保护见[AF-023执行记录](../execution/AF-023.md)。**Trea待复核、人工待验**；未提交/推送/发行/部署，Writer交付后停写，不接下一项。
