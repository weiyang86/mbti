# 任务校验入口（AF-002建立，AF-003至AF-022扩展）

2026-10-27 UI-1新增AF-026–029显式注册。AF-029包含真实管理员会话/权限/客户隔离回归、API/Web构建及自有服务生命周期；Chrome交互证据独立保存，不冒充Node测试。人工服务运行时先按`docs/development/ADMIN_BROWSER_AUTHENTICATION.md`核验停止再verify；仅Writer运行AF-029 --prepare-manual，PREPARED不等于验收。未知AF-030仍拒绝，不自动接续。

在仓库根目录用 Node24 / pnpm10 执行：

```bash
node --test scripts/verification/runner.test.mjs
pnpm run verify:task -- AF-002
pnpm run verify:task -- AF-004
pnpm run verify:task -- AF-005
pnpm run verify:task -- AF-006
pnpm run verify:task -- AF-007
pnpm run verify:task -- AF-008
pnpm run verify:task -- AF-009
pnpm run verify:task -- AF-010
pnpm run verify:task -- AF-011
pnpm run verify:task -- AF-012
pnpm run verify:task -- AF-013
pnpm run verify:task -- AF-014
pnpm run verify:task -- AF-015
pnpm run verify:task -- AF-016
pnpm run verify:task -- AF-017
pnpm run verify:task -- AF-018
pnpm run verify:task -- AF-019
pnpm run verify:task -- AF-020
pnpm run verify:task -- AF-021
pnpm run verify:task -- AF-022
pnpm run verify:task -- AF-022 --prepare-manual
pnpm run verify:task -- AF-015 --prepare-manual
pnpm run verify:task -- AF-014 --prepare-manual
pnpm run verify:task -- AF-013 --prepare-manual
pnpm run verify:task -- AF-011 --prepare-manual
pnpm run verify:task -- AF-002 --prepare-manual
```

当前注册AF-002至AF-022。AF-003含构建/HTTP；AF-004显式config-only无DB连接；AF-005有真实PostgreSQL/自有服务启停和合成哨兵写入，非只读校验。AF-009执行Prisma编译/85项Schema断言及公开类型检查，完整21模型/4枚举，无服务启动或DB连接，不是运行时验收。前序按owner子集保留断言，完整集合由其owner任务约束。CLI仅接受一个AF编号、至多一个可选--及--prepare-manual；当前未知AF-023实测exit2（早期未知AF-017等记录均按阶段保留），旧未知编号证据保留。

AF-010普通verify实际新建两个随机空验收库/归属文件、应用initial及账本，执行回滚的合成约束事务；53 CLI/目标+两组各9项=71项，非只读校验。testDatabase=true且test-database-target前置已声明；原dev/test不deploy，不改源码/启停服务，无prepare-manual。实际记录与人工步骤见[AF-010](../../docs/execution/AF-010.md)。

AF-011普通verify前置实际核对3656空闲、AF-010迁移文件及test实例/凭据/卷；执行Prisma validate/generate、91配置/目标/迁移CLI回归、API构建，再顺序运行readiness.test.mjs（9项，含父用例）与readiness-manual.test.mjs（4项，含父用例），共104有效用例。两文件共享声明的API3656，不能合并并发运行。实际新建AF-011逻辑测试库、应用initial/账本，用自身池断开+ALLOW_CONNECTIONS=false模拟仅该库不可用并finally恢复；不停止PostgreSQL实例。测试真实HTTP、缺迁移/身份错误/错密码/disabled503、故障health200、恢复ready200、app.close及main SIGTERM后pg_stat_activity零自有池；不修改源码。testDatabase=true、uniqueWriter=false，不运行源码探针。

AF-011准备已执行exit0/PREPARED：只运行同样前置与注册命令 `node scripts/verification/readiness-manual.mjs prepare`；保留实际3656人工API及一条池连接。沿用已有本机bootstrap角色/密码，不创建产品账号或重置凭据；实际URL、密码文件路径与核验后停止命令在.artifacts/af-011/manual.json。**Trea不运行准备模式**。普通verify或完整准备命令再次执行前，需要负责人先运行 `node scripts/verification/readiness-manual.mjs stop` 释放3656；该命令核对PID/PPID/CWD/命令/启动时间，只停记录的自有API并核验零池，保留库/卷/密码。指南见[Readiness](../../docs/development/DATABASE_READINESS.md)，不把PREPARED作为人工验收。

## 注册表与审查

唯一注册owner为本目录registry.mjs；runner.mjs是唯一执行实现，reporter.mjs接收Node24实际测试事件。各任务自行声明Schema/服务/数据等影响，执行器本身只编排已注册命令。新任务由其唯一Writer定向注册，Trea必须审查具体断言和命令语义；字符串声明、文件存在或PASS输出本身不能证明产品能力。

每项任务必须有非空 prerequisites 和 steps；每个条目必须提供唯一 id、command 参数数组、files 文件清单、非空 verification 明确验证项和 effects。files 只允许仓库内可读普通文件；缺失、越界或符号链接拒绝。重复 id、缺项、skip/optional 前置均拒绝，预检失败不会启动子命令。全部前置按注册顺序实际执行，任一失败立即停止，保留该子进程退出码，不执行后续步骤。

steps 的 kind：

- node-test：testFiles 指向真实 .test/.spec 的 mjs/cjs/js 文件，命令必须精确为 `[process.execPath, "--test", "--test-reporter=" + reporterPath, ...testFiles]`。使用结构化事件的总计及逐文件计数，要求每个文件至少一个通过用例、无失败/取消/skip/todo。零用例、只打印成功、缺文件、命令与文件不一致均非零；子进程本身还必须 exit0。
- check：真实命令及明确验证项，例如版本断言或实际质量门禁；进程退出码是执行结果。执行器不凭日志中的 PASS 判断。注册者对验证项与真实命令对应负责，人工审查不能省略。

effects显式列出writes、services、testDatabase、uniqueWriter；标签不是实际安全证明。AF-005的test-database-target已真实执行本地Docker context、双URL、凭据/资源归属和Compose白名单，后续每次写库/生命周期仍重复保护。其两服务和合成数据写入明确声明testDatabase=true，无源码探针。uniqueWriter=true仍需 `AIJ_VERIFY_WRITER=AF-NNN` 确认，不能用DB标签替代源码Writer交接。

子进程使用spawn(shell:false)参数数组，执行器自身不读.env；仅继承PATH/HOME/临时/系统/CI/语言/时区，不转发业务凭据、NODE_OPTIONS或父测试上下文。AF-005注册命令自行只读本库受保护的本机数据库文件，test不以dev URL兜底；Docker子进程只获明确本地context及当前自有密码参数，日志去敏，未读取旧环境。默认单命令60秒/4MiB，超时停止该次子进程组；Docker资源仍属持久本地服务，锁/状态需检查，不自动清库。Windows未验收。

注册表和钩子是受审查的仓库代码，并非任意代码沙箱；effects 不是系统权限隔离。Trea 应确认实际命令没有未声明的源码修改、服务或数据写入，不能只审查字段标签。

## 证据与结果

每次调用生成独立忽略目录 `.artifacts/verification/<AF-ID>/run-<随机值>/`，拒绝证据父目录符号链接。每条实际命令输出参数数组、前置/验证项、effects 和退出码，保存 `<id>.stdout.log`、`<id>.stderr.log` 及 report.json。保留原始 child exitCode/signal 和 effectiveExitCode；缺可执行文件为127，超时124，配置错误2，有效测试校验失败1，日志/报告保存失败非零。故意 child exit7 即使保存日志失败仍传回7，无 tee 管道掩盖。

报告按字段脱敏后再序列化。父环境中的敏感值、常见密码/Token/授权头/带凭据 URL/私钥格式，以及结构化敏感字段被过滤；不复制原环境内容到报告。证据是本机忽略文件，不自动提交或上传，也不宣称文件系统零写入。

## 显式人工准备

只有--prepare-manual调用注册prepareManual，要求safe=true、真实files/verification/effects、全部前置通过和完整普通steps；结果PREPARED，不执行普通steps或产生PASS。原函数型钩子仍限.artifacts/，不得声明服务/DB/源码写入。

AF-005按负责人本轮明确授权新增command型准备路径：scope必须owned-local-database，提供参数数组，无run函数混用；testDatabase=true、test-database-target前置、非空服务且全在正常steps声明中；写目录只准.artifacts/与.local-data/postgres/，禁止源码探针。实际命令经runEntry捕获退出码/日志，失败不PREPARED；缺范围/前置、额外服务、越界写入或混用run均有真实拒绝测试。注册代码是受Review的实现，不是通用命令沙箱；DB资源归属由AF-005工具再次实测保护。

AF-002 的钩子只生成 manual.json Review 指引，AF-002当时Auth/Seed未迁入，不能生成或宣称产品账号。合成账号夹具协议由 writeCredentials helper 支持并通过真实文件测试：密码仅写 Git check-ignore 确认忽略的本机 credentials.json，不回显；后续错误与日志也过滤该值。普通 note 的敏感字段被去敏，不能当作凭据交付文件。真实产品账号准备和数据库写入须由对应任务另行实现目标保护与安全钩子。

AF-003/AF-004仍无准备钩子；AF-005已由Codex执行准备，实际URL、DB角色、初始密码所在忽略文件、停止/保留卷清理命令在.artifacts/af-005/manual.json及任务准备报告，密码不输出、已有记录不重置。Trea不执行准备模式，人工步骤见 [AF-005记录](../../docs/execution/AF-005.md)。

文件创建请求 mode0600/目录0700，但实际权限受文件系统影响，本机 ExFAT 不作为 POSIX 权限支持证明。真实凭据仍由负责人安全配置，报告中不得存放。

AF-002初始48项自身测试保留；AF-005新增3项，目前51项。AF-006至AF-009均无准备钩子、产品账号或新服务；人工检查见[AF-009记录](../../docs/execution/AF-009.md)。AF-010已有新库initial证据，但部分Schema/客户端不代表Auth、配置/密钥/审计运行时或正式底座完成，也不提供账号导出/注销能力。

AF-012最终114项：91目标/配置/迁移回归、13项真实Seed CLI拒绝/零连接探针、10项真实数据库/文件检查（含父用例）；另有实际Prisma validate/generate/API build，两前置均执行。testDatabase=true、uniqueWriter=false，无服务启停/源码探针/prepare-manual；普通verify只写新AF-012验收库和忽略凭据/证据，不对原dev/test deploy/seed。持久化测试实际调用根pnpm db:seed，覆盖两次稳定、bcrypt验证、改密/角色/撤销授权保留、缺输入/模板/缺迁移拒绝、冲突回滚、凭据归属保护、零池及去敏。完整路径/断言/退出码见[AF-012](../../docs/execution/AF-012.md)，人工DB观察步骤见[最小Seed](../../docs/development/MINIMAL_SEED.md)。

AF-013普通verify：104配置/目标/迁移/Seed CLI、53执行器、3认证配置、13真实认证HTTP/DB、4人工服务生命周期，共177结构化有效用例；另有2个原宿主HTTP用例和Prisma validate/generate/API build。auth-http与auth-manual两个文件顺序执行3656；真实新AF-013库/Seed/bcrypt/JWT/最小审计、断库恢复/缺迁移、关闭池都运行，不启动未声明服务或修改源码。原dev/test不deploy/seed。前置AF-012的114项亦已实跑。

本任务准备钩子显式扩展仅AF-013的写目录白名单为.artifacts/、.local-data/postgres/、.local-data/seed/、.local-data/auth/，其余任务不继承新增目录；仍需test目标前置、已声明服务、唯一参数数组与safe/scope，无源码探针。新增两项执行器测试实际证明本任务允许与其他任务/越界目录拒绝。当前执行器53项，历史51项结果保留。

已执行AF-013 --prepare-manual=0/PREPARED，实际合成管理员aij-admin/API3656和一条池保留；初始密码/JWT key只在本机忽略文件，重复不重置。Trea不运行准备；复跑普通verify或完整准备前先运行 `node scripts/verification/auth-manual.mjs stop`，核验记录的PID/PPID/CWD/完整命令/birth再SIGTERM并检查零池，保留数据/卷/凭据。人工步骤见[管理员认证](../../docs/development/ADMIN_AUTHENTICATION.md)，PREPARED不等于人工验收。AF-011保留服务的描述是历史，本轮以AF-013状态为准。

AF-014当前注册复用AF-013真实177项，并增加rbac-metadata.test.mjs 5项、rbac-http.test.mjs 15项、rbac-manual.test.mjs 5项（后两组含父用例），合计202；另有2个既有宿主HTTP用例及Prisma validate/generate/API build。元数据用例只证明Reflector/完整委派/错误传播，真实RBAC证据来自新库/登录/JWT/HTTP及同一Service的DB事务AND测试，不以stub替代数据库判权。

普通校验有AF-013认证回归和AF-014合成库/文件/服务写入，所有HTTP文件按顺序使用3656；testDatabase=true、uniqueWriter=false，无源码探针。拒绝成功边界覆盖401/403/503、普通授权与DB超级管理员、角色/权限停用和撤销即时生效、伪造角色/workspace无提权、Seed/fixture不重置、断库恢复/零池。AF-014阶段未知AF-015非零的历史证据保留；AF-016阶段未知AF-017拒绝的证据保留，AF-017阶段已注册AF-017并拒绝AF-018的证据保留；AF-018阶段AF-019拒绝证据保留；现AF-019已注册、AF-020拒绝。

AF-014准备仅显式注册rbac-manual.mjs薄入口，复用auth-manual.mjs同一生命周期，当时参数只允许AF-013/014并核对归属记录，AF-015显式新增自身归属；任务各自目录/锁/库不混用。prepare命令新增AF-014可用既有忽略seed/auth写目录；不能扩展到源码、整个.local-data或其他任务。合成reader/no-access账号只在AF-014新库创建，已有密码/角色不覆盖。错任务记录在复用进程前拒绝且健康进程保留，真实测试已覆盖。

Trea不运行--prepare-manual。AF-014交付时保留的人工API/PID/实际URL、角色用户名与本机忽略密码路径在.artifacts/af-014/manual.json；复跑之前 `node scripts/verification/rbac-manual.mjs stop` 核验PID/PPID/CWD/完整命令/birth再SIGTERM并检查零池，不按端口kill。保留库/卷/凭据，PREPARED不等于人工验收。说明见[RBAC指南](../../docs/development/RBAC_AUTHORIZATION.md)，AF-013旧运行描述仅是历史。

## AF-015管理员基础管理

当前注册AF-015继承AF-014真实202项及2宿主，并加入已接收Seed真实持久化10项、admin-users.test.mjs 22项、admin-users-manual.test.mjs 5项，共239结构化有效用例+2宿主；父用例按真实事件计数。全部前置/Prisma validate/generate/API build实际执行。七路由CRUD成功、每路由401/403、角色/超字段/密码拒绝、并发409及保留活跃超级管理员、实际断自身逻辑库503/live200/恢复、软删即时失效与事务最小审计均真实HTTP/DB运行。改密不撤销既有15分钟JWT，有明确断言与限制。AF-015阶段未知AF-016退出2的证据保留；当时AF-017无注册的历史拒绝保留，现有注册见下节。

准备钩子仅AF-015显式加入seed/auth目录白名单；复用唯一auth-manual生命周期/合成fixture，不复制服务实现。不更改源码、不启停PostgreSQL、不部署或seed原dev/test；测试顺序使用3656，各任务归属新库，testDatabase=true/uniqueWriter=false。允许本项.artifacts/缓存/忽略凭据及合成库写入，不称零写入。

仅指定Writer在3656空闲时执行 `pnpm run verify:task -- AF-015 --prepare-manual`；Trea不运行准备。现有人工服务先用 `node scripts/verification/admin-users-manual.mjs stop` 核验PID/PPID/CWD/完整命令/birth后停止并确认零池，保留数据/卷/凭据。PREPARED不替人工；三账号管理200/200/403，初始密码不回显、不静默重置，当前步骤见[管理员管理指南](../../docs/development/ADMIN_USERS_API.md)及[执行记录](../../docs/execution/AF-015.md)。旧AF-013/014人工状态已停止或由当前任务替代，不能沿用旧PID。

## AF-016角色与权限管理

显式继承AF-015原注册命令并增加rbac-management.test.mjs 19项和rbac-management-manual.test.mjs 5项（含父用例），所有HTTP文件顺序使用3656；实际总数/退出码/前置超时与最终结果见[执行记录](../../docs/execution/AF-016.md)。真实13入口401/403、角色/custom权限CRUD、核心不可改、普通不提权、非法集合不部分成功、同JWT授权/撤销/状态、引用删除409/软删清权限、并发唯一、最小审计、第二Seed定义冲突全回滚、断自身库503/live200/恢复及零池均有实际断言。临时菜单引用是本库合成测试数据并按精确ID清除，不宣称菜单API；不改源码或启停未声明服务。

准备模式仅AF-016显式扩展既有seed/auth写目录白名单，复用同一生命周期/fixture；Trea不执行准备。已有账号/密码/角色不重置；AF-016当时人工API先用 `node scripts/verification/rbac-management-manual.mjs stop` 核对PID/PPID/CWD/完整命令/birth再停止自身main并确认零池，保留库/卷/凭据；3656释放后才普通verify或prepare。PREPARED不替人工，三账号角色/权限列表200/200/403；密码路径/步骤见[角色权限指南](../../docs/development/ROLE_PERMISSION_API.md)。AF-013/014/015/016旧PID按历史阅读；AF-016阶段未知AF-017非零，不替代当前注册。

## AF-017 阶段注册与人工入口（历史）

AF-017继承AF-016实际前置/回归，增加rbac-enforcement.test.mjs（13项真实HTTP/DB，含父用例），总276项+2宿主；生产host与测试进程的实际APP_GUARD组合均执行。testDatabase=true、uniqueWriter=false；只写新任务库/忽略证据和凭据，不修改源码，不启动未声明服务。17个step与2个前置参数数组/断言/退出码见registry和run-jplFX8/report.json。

AF-017 prepare只调用已注册rbac-enforcement-manual.mjs，复用唯一auth-manual生命周期/fixture；用户名/随机初始密码位置和步骤见docs/development/RBAC_AUTHORIZATION.md当前节。普通verify前需核验后停止保留的AF-017 API：node scripts/verification/rbac-enforcement-manual.mjs stop；不按端口kill、不清库。准备输出PREPARED，Trea不运行prepare。当时未知AF-018退出2的证据保留；当前范围以下节为准。

## AF-018 阶段注册与人工入口（历史）

复用已验收唯一管理员Controller/Service/DTO/Prisma/JWT/RBAC，AF-017全部276项+2宿主（含真实管理员22项和5项main生命周期）按实际路径执行，另加admin-users-integrity.test.mjs的8项，总284+2。不是复制另一套管理员实现或仅检查文件存在。

新测试真实分页/CRUD/5写入口401/403、bcrypt与停用旧JWT401、自我和最后超级保护/审计落库；只在AF-018新验收库安装/移除自身审计失败trigger/function，5种写入全回滚；观察真实DB锁等待后撤权，等待写403且无修改/成功审计。testDatabase=true、uniqueWriter=false，不改源码、不启停DB容器，不把AI作为依赖。

准备只调用已注册admin-users-manual.mjs prepare --task AF-018，复用唯一生命周期/fixture、随机忽略凭据；当前三账号列表200/200/403。停止必须node scripts/verification/admin-users-manual.mjs stop --task AF-018，核验PID/PPID/CWD/命令/birth和零池后再普通verify，保留库/卷/凭据；不带task仍是历史AF-015。实际prepare/stop/恢复/重复不重置均已运行，PREPARED非人工通过，Trea不运行prepare。当时未知AF-019退出2证据保留；完整命令/断言/退出码见docs/execution/AF-018.md及.artifacts/af-018/command-ledger.json。

## AF-019 当前注册与人工入口

继承AF-018真实284项+2宿主，新增role-assignment.test.mjs的10项，总294+2，2前置+19 step参数数组与实际断言见registry和执行记录。新测试真实后端目录ID/status、分页编辑、授撤权同JWT Guard变化、ID前后审计、匿名/越权/伪造超级/自赋权拒绝；非法选择/停用定义400、停用目标409和绑定400；观察锁等待后停用目标，事务内拒绝；自己新库合成audit失败trigger/function创建并移除，授权/审计回滚；软删保留用户/历史链接并关闭零池。testDatabase=true、uniqueWriter=false，不改源码、不启停DB容器或未声明服务。

注册准备仅rbac-management-manual.mjs prepare --task AF-019，复用唯一生命周期/fixture，已有账号/密码/角色不重置。当前三账号角色和后端目录200/200/403，停止必须node scripts/verification/rbac-management-manual.mjs stop --task AF-019；不带task仍是历史AF-016。实际准备/重复/停止零池/恢复凭据保持均已验证，PREPARED不替人工，Trea不运行prepare。普通verify先交指定Writer核验后释放3656，不按端口kill/清库。未知AF-020退出2；当前指南docs/development/ROLE_PERMISSION_API.md和记录docs/execution/AF-019.md。

## AF-020 当前菜单任务

注册继承AF-019真实294项+2宿主，新增menus.test.mjs的13项和menus-manual.test.mjs的5项：共312+2，23条前置/执行命令全部exit0。实际报告.artifacts/verification/AF-020/run-I1zPsI/report.json。各testFiles为真实HTTP/数据库断言；菜单树/角色权限/可用页面/循环/锁等待撤权/audit真实失败回滚，非仅检查文件存在或PASS字符串。

只写声明合成库/忽略凭据和产物；testDatabase=true，uniqueWriter=false，不改源码/verify:dev探针，不启停PostgreSQL。审计失败trigger/function仅自身新AF-020库创建并移除。当前复核前先Writer运行node scripts/verification/menus-manual.mjs stop，检查确切PID/PPID/CWD/命令/birth与零池；恢复通过注册prepare，只准备三合成账号/原库/自有API，不重置密码/角色或清菜单。Trea不运行准备；PREPARED非人工通过。当前地址与步骤见[菜单指南](../../docs/development/MENU_API.md)。

## AF-021 当前字典任务与Schema版本

新Schema增加两core字典表，注册只复用104配置/目标/迁移/Seed CLI、56执行器/认证配置、5metadata及2宿主，再于新AF-021库执行15字典HTTP/DB和5main生命周期：共185+2，2前置+9step均0，报告/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.artifacts/verification/AF-021/run-9ULbxQ/report.json。不对旧Schema验收库deploy/seed、不改其快照归属；未运行需要复用旧库的历史全量测试，不冒用AF-020的312项为新Schema通过。实际initial+增量两次deploy/status、公开过滤、真实外键引用/软删、六写审计回滚、锁等待撤权、断自身库503/live200恢复均运行。

只写声明AF-021合成库/忽略凭据证据；testDatabase=true、uniqueWriter=false，不改源码或启停DB容器。af021_verification.reference为自身新库的实际合成FK fixture，保留供复核；失败trigger/function移除，不DROP表/库或reset。当前ordinary verify前Writer运行node scripts/verification/dictionaries-manual.mjs stop，核对PID/PPID/CWD/命令/birth/零池；恢复走注册prepare，不重置账号/密码/角色或字典。Trea不运行prepare，PREPARED不替人工。见[字典指南](../../docs/development/DICTIONARY_API.md)。

## AF-022 当前分层配置任务

复用AF-021185+2，追加configuration.test.mjs16项及configuration-manual.test.mjs5项，共206+2；报告/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.artifacts/verification/AF-022/run-yvLLG7/report.json，2前置+11step全部exit0。真实scope/版本/关联审计、私有高层遮蔽、公开白名单、项目停用、两个插入失败回滚、锁等待撤权和断自身逻辑库恢复/零池均执行。Schema保持，不改前序快照归属；只写已声明AF-021回归合成库和AF-022库/本机忽略产物，testDatabase=true/uniqueWriter=false，无源码探针或未声明服务。

早期失败与最终整套通过分开留证据，不拼接PASS或放宽超时。普通verify前Writer用node scripts/verification/configuration-manual.mjs stop核对PID/PPID/CWD/命令/birth和零池；恢复走注册prepare，不重置密码/角色/配置，不清库。Trea不运行准备，PREPARED不替人工；[配置指南](../../docs/development/CONFIGURATION_API.md)。

## AF-023 密钥引用校验与人工准备

继承AF-022206项+2宿主，增加secrets.test.mjs16项和secrets-manual.test.mjs5项：227结构化有效项+2宿主，2前置+13step均0，报告`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.artifacts/verification/AF-023/run-16DfZb/report.json`。注册testFiles指向真实断言；env/local实际解析、加密篡改/错误key闭合、六入口401/403、配置角色探测拒绝、原子引用轮换与三次真实本地HTTP下游请求、清除、并发/旧时间戳、global/foreign边界、同JWT撤权及真正advisory等待、audit/change双失败全回滚/移除自身trigger/function、断自身逻辑库恢复/零池均实跑。离线fixture只证明协议，不冒充外部live；Schema快照和两迁移不变。

本项声明testDatabase=true、uniqueWriter=false，不改源码探针或启停DB容器；只写合成库和忽略凭据/加密SecretStore/证据。runner只为AF-023显式允许prepare写.local-data/secrets，不给未知任务全局空PASS。prepare只执行secrets-manual.mjs prepare，已有PID/库/账号/本机值文件不重置；Trea不运行。复核前交指定Writer执行node scripts/verification/secrets-manual.mjs stop，核验PID/PPID/CWD/命令/birth及零池后普通verify；恢复用注册prepare。当前账号/真实地址/文件路径见[密钥指南](../../docs/development/SECRET_CENTER_API.md)。未知AF-024/非法manual均2；早期失败及修正保留，不把跳过当前置通过。

## AF-024 审计查询注册与人工准备

注册继承AF-023227项+2宿主，新增audit-logs.test.mjs14项和audit-logs-manual.test.mjs5项，共246结构化有效项+2宿主，2前置+15step全部exit0，报告`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.artifacts/verification/AF-024/run-a89Yzq/report.json`。真实登录失败与管理员创建/修改落库后查询、分页/时间/filter、两入口401/403与跨issuer、scope/未知参数拒绝、嵌套/数组/未知字段/无标签值及PII安全投影、原始历史不变、成功GET不重复审计、同JWT撤权/Service事务内重查、断自身逻辑库503/live200恢复/零池均运行；不改源码探针/启停DB容器。testDatabase=true、uniqueWriter=false，旧任务回归只用已声明合成库，不把未知AF-025当PASS。

prepare只运行注册audit-logs-manual.mjs prepare，复用唯一生命周期/三合成账号和自有API3656，幂等保留一条明确合成原始审计样例供真实详情脱敏观察，已有密码/角色/样例不重置。Trea不运行prepare。普通verify前交指定Writer用node scripts/verification/audit-logs-manual.mjs stop核验PID/PPID/CWD/命令/birth和零池；恢复走注册prepare，不清库。账号/实际地址/步骤见[审计指南](../../docs/development/AUDIT_LOG_API.md)。未知AF-025/非法manual均2；没有把文件存在或打印成功当断言。

## AF-025-A 客户认证前置注册

负责人仅指派AF-025-A，runner接受AF编号可选单字母子卡后缀，注册只添加A；父AF-025、B和未知任务仍实际非零。运行`pnpm run verify:task -- AF-025-A`，最终226结构化有效项+2宿主，2前置+12step全0，报告.artifacts/verification/AF-025-A/run-ktULKn/report.json。104配置/目标/Seed、56执行器/管理员配置、13管理员HTTP、15 RBAC、14审计、3客户配置、16客户HTTP/DB、5新main都指向实际test文件，用结构化计数与子进程退出码判定，不解析PASS字符串。

测试真实登录/数据库会话/Cookie、Origin/DTO/凭据/跨产品与身份/claims/时效/算法拒绝，当前成员/会话状态及归属/version、并发停用与5/30限流、同事务审计失败回滚、审计查询去敏、断自身逻辑库503/live200恢复、缺迁移/独立启停、生产Secure头和关闭零池。失败约束探针只在新AF-025-A自有库临时添加af025a_reject_login并finally移除；testDatabase=true、uniqueWriter=false，无源码探针。源库/原dev/test不写、不清库、不启停DB容器。

旧AF-013人工库的Schema快照已过期，初次继承其manual测试被目标保护明确拒绝；不改写旧lease或凭据。最终登记保留新库管理员HTTP/RBAC，并在AF-025-A当前Schema合成main中实测客户/管理员两条认证链，不宣称旧人工库已恢复。原失败证据留存。准备只运行已注册client-auth-manual.mjs prepare，复用唯一生命周期与合成fixture，已有PID/客户/密码/key不重置；Trea不运行prepare。普通verify先交Writer核验归属并精确stop释放3656，恢复走`pnpm run verify:task -- AF-025-A --prepare-manual`。PREPARED不等于人工通过，实际账号、密码文件与步骤见[客户认证指南](../../docs/development/CLIENT_AUTHENTICATION.md)。A不实现或验收B的生命周期接口。
