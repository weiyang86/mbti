# 本机 Base 开发后台

AF-134/AF-135/AF-130，2026-11-05。此实例独立于 AF-029 登录验收环境，使用持久数据库，当前 Web/API 已实际启动。四入口、管理员页面建号/角色授权、普通账号工作台与字典只读、服务端拒写及目标审计均已真实验证；本批负责人接收待执行。

- 登录：<http://127.0.0.1:3855/login>，账号 `aij-admin`。
- 初始密码：本机仓库 `.local-data/base-development/initial-admin.json` 的 `password` 字段。它仅保存首次初始化密码，后续手工改密不会改写此文件。不要粘贴到聊天、日志或 Git。
- API：`http://127.0.0.1:3856/api`；项目 `aij-base-dev`，环境 `development`。
- PostgreSQL 独立监听 `127.0.0.1:55434`，专属容器/持久卷；不复用 AF-029、宿主 dev/test 或其他项目。

从 `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation` 执行：

```sh
# 下次开机：先启动本机 Docker，再执行。已实测 stop 后 start。
pnpm base:dev start
pnpm base:dev status

# 仅停止本实例，保留数据库、卷与凭据。
pnpm base:dev stop

# 本实例源码有变更时：
pnpm base:dev stop
pnpm base:dev start --build

# 首次部署或明确复验初始化时；已实测幂等，不重置密码/授权。
pnpm base:dev init
```

命令参数不加额外 `--` 分隔符。首次启动缺少产物会构建；正常重启直接复用已构建产物。API/Web 由持久 supervisor 运行，命令退出后继续服务；不依赖终端一直打开。资源归属或端口冲突时命令拒绝操作，先检查报错所指实例，不能按端口杀进程或删除卷。

以管理员登录后，首页应显示 4 个可用管理入口，左侧逐项点击：

| 菜单 | 页面 | 已实测业务 API |
| --- | --- | --- |
| 管理员用户 | `/auth/admin-users` | `GET /api/admin/users` 200 |
| 角色与权限 | `/auth/roles` | `GET /api/admin/roles`、`/api/admin/permissions/manage` 200 |
| 字典 | `/auth/dictionaries` | `GET /api/admin/dicts` 200 |
| 审计日志 | `/auth/audit-logs` | `GET /api/admin/logs` 200 |

四页已实际浏览器点击，使用同一管理员会话；`menus/my` 返回四条正式初始化的后端菜单，无硬编码侧栏。字典初始可为空，审计包含本机测试登录/操作；`AF-134 初始化保留校验` 角色和字典为幂等检查经正式 API 创建的合成数据，不授予任何用户超级权限。

自动报告：`.artifacts/verification/AF-134/run-c1Q1Zx/report.json`。复验：`pnpm run verify:task -- AF-134`，需要该 Base 已初始化且运行；只操作自己的持久开发库并保留服务。该命令会追加合成校验角色、授权、字典和审计数据，不应指向业务/生产环境。

字典只读角色只需 `admin.dict.read`，六类管理写入仍要求 `admin.dict.manage`；原manage角色通过明确的字典能力规则保留读取能力，原始角色授权不变。AF-135报告 `.artifacts/verification/AF-135/run-WDjoeb/report.json`，包含真实同会话/正确CSRF拒写与数据不变、管理员兼容和撤权验证。AF-130已修复通用工作台落点，只有字典read的普通账号登录后也能正常进入/admin；不要给普通账号增加bootstrap/manage/super。

## AF-130 账号、只读与审计验收

正式可复用只读账号在 `.local-data/base-development/af130-reader.json`，只读取其中username/password，不复制到日志/聊天；真实权限仅 `admin.dict.read`、非超级管理员。`node scripts/verification/product-readiness/base-admin.mjs prepare` 可重复核对和复用，遇到账号/授权漂移会拒绝，不自动恢复或改密。另一个经浏览器表单新建并授权的账号在 `.local-data/base-development/af130-browser-account.json`，也只拥有read。

1. 以管理员登录，四入口应可用。管理员用户→新增管理员，用独立随机密码新建一个普通账号；角色与权限→新建角色→配置权限，仅勾选“AIJ 字典查询 · admin.dict.read”并确认保存；回管理员用户给新账号分配该角色。不要改验收脚本已登记的账号/角色来演示。
2. 退出并用普通账号登录，应直接进入正常工作台，仅有字典入口。字典→“AF-130 只读验收分类”→查看条目，应看到“AF-130 只读可见条目”，新建/编辑/停用/删除禁用。刷新、退出重登后结果保持。
3. 合法Cookie/实际CSRF的六类字典直接写403及数据不变，证据见正式报告；页面禁用不单独作为API拒写证据。复验命令 `pnpm run verify:task -- AF-130`，只针对该持久Base；会追加正常会话/审计，不重建/清空库。
4. 管理员→审计日志，按资源ID筛选。正式准备账号用户ID `cmw24wthl0001nfxfkunvb3rz` 可查admin-users的created/updated，详情操作字段分别为identity/roleIds；角色ID `cmw24wts30006nfxflxzbw5e7` 查rbac-management/role_permissions_assigned，字段permissionIds。操作者均为初始管理员ID `be18765d-e679-4e22-a102-19c37871cd0c`。浏览器新建用户/角色ID分别为 `cmw2bjc5i001hnf6m9udic1a5` / `cmw2bmh57001jnf6m1425ikg4`，相同路径已实际点击安全详情。

本卡最终正式报告 `.artifacts/verification/AF-130/AF-130-final.json`；浏览器汇总 `.artifacts/orca-b02/AF-130/resume-20261105/browser-observations.json`。服务保持运行。完整范围、失败保留和提交索引见[AF-130执行记录](../execution/AF-130.md)。

这是本机开发后台的交付；仓库外制品、第二项目、业务扩展和备份恢复仍需后续独立验收。AF-131 本轮未启动，其必要配置/分发前置接收状态仍待负责人处理。
