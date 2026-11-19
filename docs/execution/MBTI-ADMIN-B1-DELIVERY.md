# MBTI 运营工作台 B1 交付记录

## 范围和版本

- Task: `task_8d60ea28dd88`；Dispatch: `ctx_5c56bcad4898`。
- 工作树：`/Users/lei/orca/workspaces/mbti/mbti-admin-b1`。
- 已核对起点 HEAD：`80386d668bb79b196192c59eb83c6ce79e200dd9`。原型 HTML SHA-256：`fb7607763dbc41472bccda10fc24f9241ec4d306d3b745eaabdb7be4a94248a6`。
- 本卡已精确路径提交；最终提交 SHA 以 Orca `worker_done` 回执为准。
- 仅本工作树修改；未 push/merge/deploy，未启动业务 API、数据库、公网服务或收费能力。

## 角色与权限

Foundation 继续持有 `SysUser`、`SysRole`、`SysPermission`、`AdminAuthSession`、JWT cookie、CSRF、`PermissionsGuard` 和权限拒绝审计。新增的 `/api/admin/mbti/ops/session` 根据当前 DB 有效权限投影页面能力；不会读取浏览器自报 `role`、`can` 或 localStorage。支付配置读取状态响应只表达接口是否连接，不携带商户字段或凭据。

| 角色 | B1 页面能力权限 | 运营边界 |
|---|---|---|
| owner | 项目业务读、订单读、草稿、系统读取/写入、发布、履约、治理、导出、兑换码 | 普通 MBTI 项目运营管理员；账号 `isSuperAdmin=false` |
| editor | 项目业务读、订单读、草稿、系统只读、治理、导出 | 不含系统写入、发布、履约退款、兑换码 |
| support | 项目业务读、订单读、系统只读、履约、治理、导出 | 不含配置草稿/系统写入/发布/兑换码 |
| reader | 项目业务读、订单读、系统只读 | 只读；不含导出和业务写入 |
| AIJ 平台超管 | 由现有 Foundation 超管机制单独标记 | 不作为四个测试角色之一；工作树中没有测试账号冒用超管 |

以上业务动作仅是 RBAC 权限种子与 UI 显隐映射。对应 B2–B5/C2 的 API 尚未接入，不能据此宣称它们已实现 HTTP 拒绝。唯一已存在的 B1 可接 API 为 `GET /api/admin/mbti/orders/{订单号}`，权限码严格保留 `mbti:orders:read`。

## 应用与全局交互

根 `admin/` 是 Vue 3 + Vite + TypeScript 独立运营应用，部署 base 为 `/ops/`，开发 UI 端口固定为 4255，API 同源代理默认指向本机 4256。它不替代 Foundation 的 `/admin`、`/login` 或用户端 `/`。

已实现原型次序的14个 hash 路由和三组侧栏、会话核验 spinner、登录错误态、页面空态/未接通态、401/403/500/网络超时文案、Cookie credentials、CSRF 请求头、安全注销、会话恢复重读、功能搜索、日期/渠道控件、自定义日期、列表搜索/状态/分页控件、返回、预览抽屉、未保存提示、移动导航折叠、可见键盘焦点和 reduced-motion 样式。控制项因业务服务缺失不能声称已联动真实数据。订单页按订单号请求现有详情路由，未新增列表/退款/重试接口。支付、联系方式、答案等私密字段没有在 UI 填充或模拟。

原型 `ADMIN-COVERAGE.md` 的42组已逐项登记在 [`MBTI-ADMIN-COVERAGE.md`](MBTI-ADMIN-COVERAGE.md)，每组注明路由、动作控件、预期权限、API/unknowns、适用后续卡、拒绝证据和状态。42组均未勾为业务通过；以 `UI_CONTRACT` / `NOT_RUN` 标注。B1全局外壳标 `UI_SHELL`。

## 运行与验证记录

UI（Node `v24.21.0`，pnpm `10.0.0`）：

- `pnpm install --no-frozen-lockfile`：exit 0；生成并固定 admin 锁文件。
- `pnpm install --frozen-lockfile`：exit 0。
- `pnpm test`：exit 0，2项通过（RBAC矩阵、14页顺序/无浏览器角色存储）。
- `pnpm lint`：exit 0。
- `pnpm typecheck`：exit 0。
- `pnpm build`：exit 0，生成 `/ops/` base 静态资源。

Foundation 定向验证：

- `pnpm install --frozen-lockfile`：exit 0。
- `pnpm --filter @aij/api^... build`：exit 0，构建 API workspace package 依赖。
- `pnpm --filter @aij/api typecheck`：依赖构建后 exit 0，含 API 与测试 TypeScript。
- `pnpm --filter @aij/api build`：exit 0。
- `pnpm exec eslint apps/api/src/mbti/mbti-ops.controller.ts apps/api/src/mbti/mbti.module.ts scripts/mbti/provision-ops-test.mjs scripts/mbti/ops-policy.cjs`：exit 0。
- 首次未构建依赖时 API typecheck exit 2，原因为 workspace packages 尚无 dist；构建依赖后同命令通过。

## 未完成与阻塞

- 四真实账号未初始化，登录、刷新、注销、浏览器改角色仍遭服务端拒绝、字段投影、订单读授权 200/403 均未做真实 HTTP/browser 验证。账号私密文件预计位置 `admin/.local-data/test-operations-accounts.json`；当前尚不存在，也没有密码可领取。
- 指定 PG owner `/Users/lei/orca/workspaces/mbti/mbti-web-api-f1/aij-foundation` 在当前主机不存在。尝试 `MBTI_LOCAL_OWNER_ROOT=… node scripts/mbti-local.mjs check test` 得 ENOENT，exit 1，未连接数据库。总控确认现有其他 worktree 不是 test55437 owner，明确禁止重建、猜配置、重置数据库或身份。必须先取得真实同仓 owner 路径以及该 test 环境的 database/user/port/project marker 核验，之后才能运行 `MBTI_LOCAL_OWNER_ROOT=<verified-owner> node scripts/mbti/provision-ops-test.mjs`。
- `/ops/` 在本机 4255 通过 Orca 浏览器打开，登录视图截图/可访问性树正常；同次读取原型 dashboard 截图。因没有已认证 UI 和 API，不能用原型本地演示身份替代真实会话，所以两张图的页面状态不同，未完成同视口同页面布局差异验收。UI 尝试同源连接 4256 时得到 `ECONNREFUSED`，随后停止 Vite；没有 API 服务保持运行。四角色桌面/移动触控实测等待真实环境。
- 业务接口未接通动作交 B2–B5/C2。真实支付、真实位置聚合、模型供应商、微信真机均未宣称通过；已知边界继续按 API Fast Handoff 保持。

## 可供 B2 接续

订单页和 API 客户端已有同源 Cookie 会话与权限映射，可从 `admin/src/ops.vue` 的按号查询接线。现存后端仅支持按号详情读取；订单列表、导出、退款、交付重试、兑换码接口是否存在需下一卡按实现核实。订单读取始终使用 `mbti:orders:read`。
