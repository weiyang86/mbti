# 独立 AI 本地集成环境

本环境用于本机试用现有底座。初始化复用原应用、认证、Workspace、插件生命周期和迁移清单，拥有独立数据库、存储、Cookie、issuer、密钥和构建目录。执行结果以 [AF-220 记录](../execution/AF-220.md) 中的正式门禁为准。

| 项目 | 配置 |
| --- | --- |
| 身份 | `aij-ai-local / development` |
| 管理员入口 | `http://127.0.0.1:3955/login` |
| 客户入口 | `http://127.0.0.1:3955/client/login` |
| API | `http://127.0.0.1:3956/api` |
| PostgreSQL | `127.0.0.1:55435 / aij_ai_local_development` |
| 私有状态 | `.local-data/ai-local-development/` |
| API / Web 输出 | `apps/api/.ai-local-dist/` / `apps/web/.next-ai-local/` |

在仓库原始工作区运行：

```sh
pnpm ai:local init
pnpm ai:local start
pnpm ai:local status
pnpm ai:local stop
# 源码变更后，先停止本环境，再重建启动：
pnpm ai:local start --build
```

首次 init 创建自有卷、独立随机凭据，部署已登记迁移并构建原应用，初始化管理员、AI 插件、五个测试客户及各自独立空间。再次 init 前须停止本环境服务；重复初始化保留现有密码、成员授权、菜单、配置与数据。stop 保留卷、存储和凭据。若记录、命名资源、目录权限、Docker context、PID 或端口不符，命令拒绝并保留现场；按实际拒绝原因检查，不删除状态文件或重建数据库兜底。

管理员用户名 `aij-admin`，随机初始密码保存在本机私有 `initial-admin.json`。五个客户为 `aij-local-1@example.test` 至 `aij-local-5@example.test`，独立随机初始密码保存在同目录 `initial-clients.json`。自行修改密码后，文件仍是初始交接记录。凭据文件不进入 Git、不复制到 Worker 或其他产品，也不要粘贴到聊天、执行记录和截图中。

人工检查可先使用两个不同账号：分别登录、查看自己的 Workspace；在第一个账号创建文本文件和文档、保存第二版、读取历史；切到第二个账号确认不能读取第一个账号的数据。停止并重新启动后，再确认文档版本和文件内容保留。页面的后端权限结果决定菜单和操作；服务启动成功不表示所有商业化目标已验收。

当前固定关闭付费模型执行和文档渲染开关，AI 配置与执行准备状态如实显示。短信、邮件、支付、真实厂商和外部存储联调待后续批次。root 的 `.env.local` 不合并进本环境；Web 构建/启动只接收公开变量，若 `apps/web` 内存在会被 Next 自动加载的环境文件则拒绝，不移动或删除用户文件。

地址只绑定本机回环。五人跨设备演示、远端域名、主机部署及商业发布需要另行完成对应交付；当前没有远端发布。原 Base 的 3855/3856/55434 和 host/test 的 3655/3656/55432/55433 仍由各自原 owner 管理。
