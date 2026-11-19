# MBTI Foundation 源码导入验证

验证日期：2026-11-09。Writer：Codex；这是实现者自查，不是独立复核或产品上线验收。

## 验证基线

- MBTI `dev`：`4ced57f7a92fc1b7dec67f88e0e68e4c64046a30`。
- 上游快照：`8ba3d30271db8862798665fd81480cc6f573e696`；包哈希及逐文件清单见 `UPSTREAM_IMPORT.json`。
- 在新的 MBTI 本地 checkout 安装依赖；未链接或复制上游 node_modules，未使用上游未提交文件。
- 环境：Node.js `24.21.0`，pnpm `10.0.0`；安全示例以 MBTI project profile、关闭能力开关运行。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| 压缩包 SHA-256、路径/文件类型、逐文件导入哈希 | PASS；1,811 个来源文件无缺失；1,802 个原样，9 个明确适配，原 README / AGENTS 另存保留 |
| 源文件忽略规则 | PASS；没有来源文件被目标 Git ignore 意外遗漏 |
| Git 暂存字节与空白检查 | 1,811 个来源文件暂存后无字节归一化；本次相对上游的适配增量及新说明文件通过空白检查。全量新增检查保留 5 个上游原样文件的 843 处既有空白警告，未为消除历史格式警告而改写源码快照 |
| 运行数据与凭据排除 | PASS；无 `.git`、依赖、构建、真实 `.env`、上传或数据库；密钥模式命中仅为三处测试文件中的合成拒绝样例 |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS；锁文件未改动 |
| `pnpm --filter @aij/api prisma:generate` | PASS；仅生成客户端，使用编译专用端口 1 占位，不连接数据库 |
| `pnpm -r --filter './packages/**' build` | PASS |
| `pnpm typecheck`、`pnpm lint` | PASS；API 装配测试适配后再次通过 API 类型及该文件 lint |
| `pnpm test` | PASS；97 项基础配置测试 + 79 项 API 测试，0 失败、0 跳过；最终在 MBTI `.env.example` 生成的关闭能力配置下通过 |
| `pnpm build` | PASS；所有工作区包、NestJS API 和 Next.js Web 完整构建成功 |
| MBTI 示例配置解析 | PASS；项目、issuer、Cookie、4055/4056 端口及默认关闭开关均通过校验 |
| 已构建 API 实际启动 / HTTP | PASS；`/api/health` 200，`projectId=mbti-foundation`；允许的 MBTI origin 正常，未批准 origin 未获 CORS 放行 |
| 未启用数据库的就绪检查 | `/api/ready` 503，符合关闭数据库时的预期；没有冒充业务就绪 |
| MBTI 草案业务路由 | `/api/v1/quiz/versions/current` 404，说明本次未实现测评业务，不误报为可调用 |
| 临时 API 清理 | PASS；只停止本次创建的 API，4056 监听已关闭 |

详细本地检查日志存于忽略目录 `.artifacts/mbti-import/`，不把日志、进程文件或测试环境提交进 Git。

## 影响和未执行项

源实现保持原有 owner；本次没有执行数据库创建、迁移或 Seed，没有调用真实模型、通知、支付或外部存储，没有部署或保持新服务常驻。仓根 UniApp、产品 HTML、业务后台和 API 草案均未作业务变更。

数据库目标保护及初始化适配、业务认证方案、MBTI 正式接口实现和业务联调属于后续工作，见 `MBTI_INTEGRATION.md`。上游 AF 队列和验收记录仍只是历史快照，不在 MBTI 中续跑或改写为通过。
