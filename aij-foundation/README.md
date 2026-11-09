# MBTI 仓内 Foundation

本目录是 `weiyang86/mbti` 的总后台源码层，供本产品组合通用身份、权限、管理后台、AI 与异步运行能力。它随 **MBTI 仓库** 的分支、PR 和版本演进；独立仓 `weiyang86/aij-foundation` 是上游来源，二者没有自动同步或运行依赖。

## 本次导入

- 上游提交：`8ba3d30271db8862798665fd81480cc6f573e696`。
- 导入已提交源码快照：1,811 个文件，36,184,584 字节；包含源码、字体及许可证、配置和历史文档。
- 不包含上游未提交的 AF-233 前端、Git 历史、依赖目录、构建产物、真实环境文件、凭据、数据库、上传文件或运行数据。
- 逐文件来源哈希见 [UPSTREAM_IMPORT.json](UPSTREAM_IMPORT.json)，本仓接入边界见 [MBTI_INTEGRATION.md](MBTI_INTEGRATION.md)。来源声明和第三方许可证继续保留；导入不改变原有许可。

本次实际检查和未执行项见 [IMPORT_VALIDATION.md](IMPORT_VALIDATION.md)。

## 目录

| 路径 | 用途 |
| --- | --- |
| `apps/api/` | NestJS 通用 API 宿主、Prisma 模型和迁移 |
| `apps/web/` | Next.js / Ant Design 通用管理端与客户工作台 |
| `packages/` | 通用契约、SDK、核心、运行时契约和 UI 包 |
| `scripts/`、`ops/` | 工程、运行配置和上游验证工具 |
| `assets/` | 文档字体及其许可证 |
| `docs/` | 上游架构、能力说明、规划及历史验证记录 |

上游 `docs/current/`、AF 队列、Orca ID、服务地址和验收结果均属于**上游快照**，不代表 MBTI 当前计划、运行状态或验收结果。原入口保留为 [README.upstream.md](README.upstream.md) 和 [AGENTS.upstream.md](AGENTS.upstream.md)，当前协作规则以仓根及本目录的 `AGENTS.md` 为准。

## 本地准备

需要 Node.js 24、pnpm 10。此目录拥有独立的 pnpm 工作区；仓根 `web/` 的 UniApp 工程继续使用自己的依赖与锁文件。

```sh
cd aij-foundation
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @aij/api prisma:generate
pnpm typecheck
pnpm lint
pnpm test
```

`.env.example` 使用 `RUNTIME_PROFILE=project`、`PROJECT_ID=mbti-foundation`，Web/API 预设为 `4055/4056`，Cookie、issuer 和存储路径均使用 MBTI 身份。端口只是约定，启动前仍须检查占用。数据库、管理员/客户登录、存储、异步执行、插件、付费模型和文档渲染默认关闭。

配置检查通过后，可用 `pnpm dev:api` / `pnpm dev:web` 启动基础宿主；API 健康入口为 `http://localhost:4056/api/health`。依赖数据库的页面和接口须完成独立数据库、迁移、Seed 与认证配置后再联调；健康检查成功不代表业务可用。

**不要直接执行**上游 `db:*`、`base:dev`、`ai:local` 或历史 AF 数据库验收命令作为 MBTI 初始化流程。这些工具仍包含上游固定身份、端口或实例约束，须先完成 MBTI 专用数据库目标保护和运行配置适配。

## MBTI 接下来如何使用

当前交付是可继续开发的基础源码，尚未实现根目录 `docs/api/` 中的 MBTI 测评、结果快照、分享或微信登录接口。业务接口仍由 Remy 定稿，再在本仓增加业务模块和前端调用适配；通用能力不得绕过业务身份、权益和权限校验。具体分工与待办见 [MBTI_INTEGRATION.md](MBTI_INTEGRATION.md)。
