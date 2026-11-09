# F3 Web 实单运营同号补证与 dev 准备

Run `run_594d408d15de`，补证 Task `task_5672a0c22747`，Dispatch `ctx_570f21fa3109`，2026-11-09。基于原完整后端候选 `0747da451be8f8009d13eea24f03c9489750f0e0`；本次只补同一笔 Web 单的后端运营 HTTP 证据、只读核查及准备说明，不重启、迁移或部署。

## Web 创建 / 本人读取 / 运营读取的同一业务号

Web 候选证据提交 `cfb02d32c089dbf3680cbf210b5e89e8149068a5` 的 `web/F3-INTEGRATION.md`「真实 HTTP 与页面证据」记载：A 页面两次 `POST /api/v1/orders` 均 201 原单、本人状态/列表 200，一单、990 分 CNY、pending/unlocked=false/unconfigured、无 pay_params/paid_at，B 跨人读取404。

本次复用现有 Foundation 非超级管理员 ops 角色，通过真实 LAN HTTP 读取这笔已存在的 Web 单，没有另建替代订单，也未通过 SQL 读取订单作为验收：

```text
GET http://192.168.0.200:4156/api/admin/mbti/orders/MBTI-3f4a78f2-1e80-4871-9ea4-478944f33df7
Authorization: [REDACTED Foundation persisted ops session]
HTTP 200 application/json; charset=utf-8
```

```json
{
  "id": "MBTI-3f4a78f2-1e80-4871-9ea4-478944f33df7",
  "result_id": "ef9d96f7-ea95-4b23-aefd-754155dfff55",
  "product_code": "studio_tier_1",
  "amount": 990,
  "currency": "CNY",
  "status": "pending",
  "unlocked": false,
  "created_at": "2026-11-09T03:35:12.292Z",
  "payment_availability": "unconfigured",
  "pricing_mode": "controlled_test_fixture"
}
```

权限仍为 `mbti:orders:read`，原 Foundation 登录/持久会话/JWT/RBAC guard 生效。同一 URL 的无凭证401、另一普通游客 X-Guest-Token 401、将游客当 Bearer 401、已登录无该权限角色403，另一个游客请求用户查单接口404，均有实际 HTTP 回执。前端未取得任何运营凭证；Web A/B 身份与购买意图未改动，没有支付初始化或账目变更。

去敏回执文件：[MBTI-F3-Web-order-ops-http.json](MBTI-F3-Web-order-ops-http.json)。其中保留 Web 原始 Network 捕获的两次下单201与本人同号 GET200方法/URL/状态/时间元数据，并引用 Web 已提交记录中的金额/状态；该 Web 元数据原本不含响应体，所以没有伪造或重建原始 POST 响应体。运营200则保存本次实际响应体，同号、同金额、同结果引用与 Web 记录一致。

复验命令（本树 Foundation 目录）：

```sh
MBTI_LOCAL_OWNER_ROOT=/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation \
  node scripts/mbti/verify-f3-ops-order.mjs MBTI-3f4a78f2-1e80-4871-9ea4-478944f33df7 990
```

实际退出0，9次真实HTTP，含现有 Foundation 两种测试身份登录、同号读取与允许/拒绝。认证材料仅从本树忽略的0600 test fixture读取，不输出、不提交、不传给Web。SQL仅用于原项目目标归属与确认该测试管理员非超级管理员，不查订单。`node --check scripts/mbti/verify-f3-ops-order.mjs` 退出0；本次没有改运行中业务实现，不重复全套构建/重启。

## dev4056 当前实际状态

2026-11-09 03:49:41 UTC，先运行 `MBTI_LOCAL_OWNER_ROOT=... node scripts/mbti-local.mjs check dev`，退出0；随后对经归属验证的 `127.0.0.1:55436/mbti_foundation_development` 使用 `BEGIN READ ONLY`，核对实际角色与项目/environment/root marker。只读结果保存在 [MBTI-F3-dev-ops-readiness.json](MBTI-F3-dev-ops-readiness.json)，无秘密或管理员身份信息：

| 项目 | 实际结果 |
| --- | --- |
| AUTH_ENABLED / JWT secret 是否配置 | false / false |
| issuer / cookie prefix | urn:aij:mbti-foundation:development:api / mbti_foundation_development |
| F3 附加迁移 | 尚未应用 |
| 当前活跃管理员 / 超级管理员数 | 0 / 0 |
| mbti:orders:read、admin.user.manage、admin.role.manage、admin.permission.manage 定义 | 均不存在 |
| HTTP GET /api/auth/session | 404（当前认证模块未启用） |
| HTTP GET /api/admin/mbti/orders/{测试号} | 404；不能据此声称 dev 运营入口通过，test单也不应复制到dev |
| HTTP GET /api/v1/health | 200，已交付 F2 持续可用 |

本次没有更新 dev `.env`、写入 dev 数据、迁移 dev schema、创建 dev 管理员或替换4056/5173。test 中的随机运营用户名、密码、JWT secret、回调 secret、角色和会话不能拿去 dev 使用。

## 总控后续准备方法与明确阻塞

1. 在已集成 F3 后端与Web消费者的 dev 树独立安装、生成 Prisma client、构建；由总控另择维护窗口，先用同项目 `mbti-local.mjs check dev` 验归属，再依项目流程迁移。`20261109120000_mbti_f3_orders` 会建立业务表和只读 `mbti:orders:read` 定义，但不会自动创建管理员或授予权限。此步骤本次 NOT_RUN，不绕过原“不动dev schema/4056”边界。

2. 管理认证配置位于既有 owner 的 `.local-data/mbti-foundation/development/.env`（忽略且0600）。应由受管配置流程写入 `AUTH_ENABLED=true` 与**独立新生成**、至少32字符且非模板/不与数据库或test复用的 `JWT_SECRET`；可在本机安全脚本中以 `randomBytes(48).toString('hex')` 生成并直接保存，不输出到终端/日志/命令行。保留 `RUNTIME_PROFILE=project`、`PROJECT_ID=mbti-foundation`、`APP_ENV=development`、原DATABASE_URL、4056/5173、现有项目issuer/cookie/storage归属；`CLIENT_AUTH_ENABLED` 可保持false。不要设置 `MBTI_F3_TEST_FIXTURE=1` 或 `MBTI_F3_TEST_PAYMENT_SECRET`。`mbti-local start` 以owner文件值覆盖普通shell环境，单独export AUTH_ENABLED/JWT_SECRET不会替代此配置。切换前须先协调已交付服务，不在本次补证中执行。

3. 运营身份必须落在 dev 本项目 Foundation `SysUser / SysRole / SysPermission / SysUserRole / SysRolePermission`，使用已有 `AuthService`、bcrypt成本12和`admin-policy.cjs`口令规则，最终是 `isSuperAdmin=false` 的独立运营账户，仅授予 `mbti:orders:read`。不授予 `mbti:payments:test`、支付写权限或无关后台权限，不创建通用新登录体系，不重置或接管既有用户。初始口令独立随机生成，交由安全渠道/受控秘密文件给指定运营人，不能放到前端构建变量或报告。

4. 若项目已有受控初始化管理员，可通过原 Foundation 管理HTTP准备普通运营账户：登录 `/api/auth/login`，以现有管理权限读取 `/api/admin/permissions/manage?q=mbti:orders:read` 取得只读permission id，`POST /api/admin/roles` 创建 `roleCode=mbti_order_ops`，`PUT /api/admin/roles/{roleId}/permissions` 仅给该permission id，再 `POST /api/admin/users` 提交独立username/realName/安全注入password/roleIds。最后两个授权步骤按现有实现要求可信超级管理员，不能由普通运营自赋权；既有角色或用户冲突应人工核对，不用PUT覆盖不明权限集合。普通运营的登录与查询仍用原Auth/JWT会话。

5. **当前具体内部准备阻塞（NOT_PROVISIONED，不伪称已通）：**dev目前零管理员，相关管理permission定义也没有初始化，所以第4步没有可用的初始安全操作者。`.env.example` 的 `AIJ_INITIAL_ADMIN_PASSWORD` 明确只是未来MBTI项目seed的保留输入；当前 `mbti-local seed` 仅题库，不会创建管理员。上游 `scripts/database/seed.mjs` 的 `seedDatabase` 明确只拥有host `aij-foundation`；不得运行固定 `db:*`、`base:dev`、`ai:local` 来解锁MBTI后台。需要总控通过本项目归属保护准备一次性初始Foundation管理员及代码拥有的管理权限定义，或另派MBTI专属初始化工具；复用原schema/bcrypt/guard，不能复制test凭证或绕过登录。此依赖目前尚未实施/验收，不能把test运营200写成dev运营200。

6. 配置/初始身份就绪并协调完成dev切换后，以**dev新建的受控测试订单**再次保存创建201、本人200、运营同号同金额200、无凭证/游客401与无权限角色403的HTTP回执，并回归F2及确认支付仍unconfigured。test55437订单与会话不向dev迁移；真实收费、可找回账号绑定和生产定价仍按原记录blocked_external/needs_human_review。

本补证满足Web实单到受限运营HTTP的同号读取；dev上线准备是明确未执行的后续依赖，不阻止总控集成候选、完成LAN H5验收或接续已就绪F4。本次补证结束时4156/4056/5173服务保持原进程运行。
