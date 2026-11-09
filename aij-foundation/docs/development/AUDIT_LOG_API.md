# AF-024 审计日志查询与脱敏API

2026-10-28 AF-038增量：新增 `/auth/audit-logs` 管理查询页，复用本文件定义的 `/admin/logs` 与 `admin.log.read`。不增加审计查询/写入 owner、字段或原始日志导出。页面只呈现模块化安全投影；操作者姓名、IP、User-Agent、关联ID原值、前后快照、未知值始终隐藏，服务端 API 继续负责真正的授权与脱敏。

2026-10-20，AF-023已由负责人接收。AuditQueryModule是查询的唯一实现，复用Prisma、JWT、RBAC、ManagementAccessService的数据库错误边界和既有AuditLog记录；AppModule只在AUTH_ENABLED时装配。未增加第二份写入Service、全局审计Interceptor或日志表。原登录、管理事务、权限拒绝写入owner保持，Schema/两迁移/依赖/Web不变。

## 1. 查询契约

| 方法/路径（前缀/api） | 结果与权限 |
| --- | --- |
| GET /admin/logs | active admin.log.read；分页items/total/page/pageSize，仅脱敏投影 |
| GET /admin/logs/:id | 同一权限，返回同一投影；不存在/非本查询范围404 |

未登录/跨产品issuer/伪造Token为401，无权限403；真正DB超级也必须存在active权限定义。源入口的admin.log.read与/admin/logs保留，Controller负责入口，DTO严格校验，Service查询，既有Guard负责JWT/RBAC；Service还在同一RepeatableRead事务内复查当前权限，count与rows使用同一快照。撤权/停用角色/停用定义对同JWT下一请求即时生效。按钮、CORS、客户端permission/workspaceId不能授予权限。

当前范围是本库独立数据库的core审计（workspaceId为null），不返回带Workspace快照的记录，包括DB超级；不把项目Organization当客户租户权限。query workspaceId不支持并400，未实现Workspace/Membership授权，不宣称跨租户查询。查询无需AI/Secret解析/外部服务。

| 参数 | 规则 |
| --- | --- |
| page/pageSize | 默认1/20；整数1–10000 / 1–100；越界/NaN/数组无效400 |
| module/action/status | 精确匹配；module/action最长64受控字符；status仅success/failed/error（兼容旧error记录） |
| userId/resourceType/resourceId | 精确匹配，不通过显示名模糊查个人信息 |
| correlationId | 8–128规范关联ID，精确匹配requestSummary.correlationId；原值不回显 |
| startAt/endAt | 可选ISO8601，必须带Z或UTC偏移；闭区间，start>end/非法日历日期400；不接受无时区日期 |

排序固定createdAt desc、id asc，同时间也稳定。分页采用offset；每个请求内部快照一致，跨请求有新日志时不承诺游标式冻结。未知参数（raw/includeSensitive/export/orderBy/operatorName等）400；无任意JSON载荷搜索、导出、删除/修改、保留清理或修复历史API。POST/PATCH/DELETE无路由404，不把它们当成可写接口。

## 2. 响应脱敏边界

列表和详情共用projectAudit，所有响应no-store、统一安全错误。不是仅用正则替换常见Token后返回其余原始JSON；历史未知载荷和不带敏感字段名的值也会隐藏。查询不重写/清洗数据库原记录，不声称原始存储已经脱敏或加密。

| 字段 | 对外策略 |
| --- | --- |
| id/userId/resourceId | 只保留规范UUID/cuid，其他值[REDACTED]；不联查用户姓名/资料 |
| module/action/resourceType/status | 当前core受控目录白名单；未知模块/操作/资源或状态隐藏，新增插件将来须由owner显式扩展 |
| userName/ip/userAgent | 非空一律[REDACTED]；无需为审计读角色开放PII |
| path/method | path只保留白名单集合路由，去query/fragment；未知动态/外部路径隐藏；method只保留HTTP方法 |
| errorMessage | 仅invalid_credentials/permission_denied安全代码，其他非空内容隐藏 |
| requestSummary | 只给白名单字段名/当前core所需权限码/规范权限ID数组，数组最多100项；未知key、深层对象、字符串、数字/OTP等载荷不回显；原correlationId始终隐藏但可精确过滤 |
| beforeData/afterData | 非空原快照整体[REDACTED]，包括嵌套数组/未标注secret/PEM/个人资料；空值仍null |
| createdAt/redacted | 保留时间并标明redacted=true；不输出workspaceId |

源redactText的Bearer/Key/凭据赋值/多行PEM规则定向适配，另加正向字段/值投影。它不承诺识别任意自然语言中的秘密；保守策略直接隐藏自由文本和原快照。API可追溯操作者ID、资源ID、动作、时间和安全字段名/权限ID，不提供业务载荷全文或未脱敏通道。

成功GET本身不递归追加query审计；无权限拒绝仍由已验收RBAC写permission_denied，不因本项关闭既有审计。实际登录失败/管理员创建和修改的记录已通过本接口查询；没有迁入原日志数据或业务Interceptor分支。

## 3. Seed、人工准备与当前地址

Seed需显式--audit-logs注册admin.log.read定义，重复不改已有grant/状态/密码；默认最小Seed不扩大权限。没有在原dev/test deploy/seed。人工prepare只在本任务目标保护的新合成库准备3账号和一条明确合成的脱敏样例，既有账号/凭据/样例不重置，保留历史。

当前实际API：`http://localhost:3656/api/admin/logs`，health/ready均200；PID42911，birth `Tue Oct 20 04:53:23 2026`，CWD本库apps/api，仅127.0.0.1:3656。Web3655没有监听，本项没有日志页面。库`aij_foundation_af024_test_67f70c8b587d29ff`在127.0.0.1:55433，仅合成数据；23模型/24个public表（含迁移账本）。PREPARED不是人工通过。

| 角色用户名 | 日志读取预期 | 初始密码本机忽略文件 |
| --- | --- | --- |
| aij-admin（DB超级） | 200 | `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af024_test_67f70c8b587d29ff/initial-admin.json` |
| af024-auditor（只授予admin.log.read） | 200；管理用户写403 | `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af024_test_67f70c8b587d29ff/audit-accounts.json` 中对应username |
| af024-reader（无审计读权限） | 403 | 同一accounts文件中对应username |

密码/Token/hash不写报告或回显。若负责人已改密码，用当前密码，初始文件不是恢复器。样例ID为`3f26a4a0-c106-4cfb-b99f-6686bf5e3dd3`；它包含明确的非真实凭据标记，API详情应隐藏这些标记和原始快照。实际完整准备状态见.artifacts/af-024/manual.json。

1. 本机HTTP客户端POST /api/auth/login，按本机文件取username/password。令牌只在本机客户端内存使用，不发到聊天或Review。
2. aij-admin、af024-auditor分别GET /api/admin/logs?page=1&pageSize=2，应200并有安全记录/总数；af024-reader同入口和详情403，匿名401。
3. 用审计员GET /api/admin/logs/3f26a4a0-c106-4cfb-b99f-6686bf5e3dd3，应200；beforeData/afterData/errorMessage/correlationId等为[REDACTED]，看不到样例密码/Key/深层标记，module=auth/action=login_failed/status=failed保留。
4. GET /api/admin/logs?module=auth&action=login_failed&status=failed&correlationId=af024-observation，应包含同一条样例（初始化时total=1），关联ID原值不回显。再过滤不存在module，应items=[]/total=0；页码10000可空而非返回全量。
5. 以返回的createdAt为startAt/endAt并正确URL编码，闭区间应含该条；用等价UTC偏移应一致。page=0/pageSize=101、倒置时间段、无时区日期、raw=true/export=true/workspaceId=foreign应400，错误不回显原输入。
6. 用af024-auditor直调POST /api/admin/users应403。同JWT撤权/角色停用即时失效已经自动验证；人工若观察授权变化，须负责人通过已授权角色管理入口操作当前合成账号，不在共享/正式库改授权。
7. 再查日志，reader拒绝等记录可见；成功GET没有递归日志。没有修改/删除/原始全文接口；不直接导出原始AuditLog或复制原产品日志。
8. health/ready应200。负责人记录观察结果，**人工验收仍待执行**；自动观察不能替代人工。

停止仅交指定Writer运行`node scripts/verification/audit-logs-manual.mjs stop`，先PID/PPID/CWD/命令/birth核验，精确SIGTERM并检查零池。保留库/卷/凭据，不reset/drop/down -v。普通verify需先由Writer交接释放3656；恢复用`pnpm run verify:task -- AF-024 --prepare-manual`。Trea不运行prepare，重复准备不重置密码/角色/审计样例。

## 4. 自动校验与交接

`pnpm run verify:task -- AF-024`首次整套exit0，246结构化有效项+2宿主；2前置+15step全0，无fail/skip/todo。继承AF-023227项，新增14 HTTP/DB项（含父项）和5 main项；Prisma validate/generate/API build、lint/typecheck均实际0。最终报告`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.artifacts/verification/AF-024/run-a89Yzq/report.json`。独立node --test审计14项也exit0；未知AF-025及非法manual参数均2。

真实分页/时间/筛选、登录及管理审计落库、401/403/跨issuer/伪造Token、恶意原始历史载荷与未知元数据脱敏、外Workspace排除、不重写历史、同JWT撤权和DB故障503/live200恢复/关闭零池均运行。不是打印成功/仅查文件存在/修改源码探针；不启停DB容器、不发外部真实消息/支付/模型请求。受管凭据及日志去敏检查、差异与所有命令见[AF-024执行记录](../execution/AF-024.md)。**Trea待复核、人工待验**；未提交/推送/发行/部署，Writer交付后停止，不接下一项。

## 5. AF-038 审计日志页面契约

页面路由为 `/auth/audit-logs`，菜单与页面声明 `admin.log.read`；API 仍独立检查 JWT、权限和本项目 core 范围。筛选字段直接映射现有 DTO：`module/action/status/resourceType/userId/resourceId/correlationId/startAt/endAt`，并使用服务端分页。时间必须是带时区的 ISO 8601。页面不新增自由文本全文搜索、原始载荷查询、导出、修改或删除操作。

列表和详情只使用 `projectAudit` 当前投影；前端再次 allowlist module/action/status/method/path/ID 与 requestSummary 的字段名/权限码，不展示 `userName/ip/userAgent`、关联ID原值、before/after 原始快照或未知字段。unknown `workspaceId` 等参数仍由严格 DTO 400 拒绝；菜单隐藏和页面 `AdminShell` 不替代 API 403。目标 UI/API 地址、合成审计样例、验证状态和当前阻塞以 [AF-038 执行记录](../execution/AF-038.md) 为准。
