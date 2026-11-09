# 项目 Edition 配置契约（AF-127 / ORCH-GEN-01）

本卡只交付配置子范围。`create` 生成配置文件，`show` 验证配置；返回 `CREATED` / `VALID` 不表示数据库已初始化、管理员已授权、插件已安装或 AI 可以消费。OPT-005 尚未整体完成；独立项目 Seed、正常管理安装与可运行 AI 消费证明属于 GEN-02/03。

## 选择 Edition

```sh
pnpm run aij:project -- create --project-id demo-base --environment development \
  --dir .artifacts/manual/demo-base --web-port 14655 --api-port 14656

pnpm run aij:project -- create --edition ai-standard --project-id demo-ai --environment test \
  --dir .artifacts/manual/demo-ai --web-port 14755 --api-port 14756 \
  --peer .artifacts/manual/demo-base

pnpm run aij:project -- show --dir .artifacts/manual/demo-ai
```

命令只生成 `aij.project.json`、`.env.example`、`.gitignore`、`README.md` 四个文件；不生成真实 `.env`、密钥、数据库或存储数据，不安装软件包。目标目录必须不存在。`--peer` 可以重复，使用既有命名空间、端口和存储路径隔离检查；它不是全机自动发现或持久注册服务，应列出所有相关 peer。

| Edition | Profile | 启动加载列表 | 后续装配要求 |
| --- | --- | --- | --- |
| `base`（默认） | `aij-base` | 空 | 无插件依赖 |
| `ai-standard` | `aij-ai-standard` | 仅 `aij-ai` | auth、clientAuth、database；异步运行时；生图按需开启 storage |

不存在自由插件输入选项；未知 edition、未知命令参数、清单或本地环境中的未知插件、重复插件、删掉 AI 必需插件均拒绝。既有不含 `edition` 的 `aij-base` v1 清单继续按 base 读取。base 清单保持不含凭据字段；AI 清单增加 `editionContract`，`show` 对两种 edition 都返回派生契约。

`ai-standard` 的可信声明指向现有 `apps/api/src/plugins/aij-ai/ai-plugin.ts`，实现 owner 为 `@aij/api`。依赖复用现有 AsyncRuntime、SecretCenter、RBAC、ClientAuth、ClientWorkspaces 和 Files；未创建第二套队列、凭据存储或成本账本。配置声明不能导入任意路径、替换可信 owner 或授予权限，运行时静态注册表和持久插件生命周期仍由现有 owner 控制。

## 非秘密配置与 SecretRef

生成时所有 capability、`ASYNC_RUNTIME_ENABLED` 均为 false。AI 清单声明的 requiredCapabilities / requiredRuntime 是后续装配要求；当前不会自动启用这些能力或执行 Seed。只声明 `ENABLED_PLUGINS=aij-ai` 也不会创建或启用数据库中的插件安装。

AI Edition 允许从本项目本地环境转发以下非秘密配置：

| 变量 | 默认值 | 校验 |
| --- | --- | --- |
| `AI_CENTER_LIVE_ENABLED` | `false` | true/false |
| `AI_CENTER_CLIENT_EXECUTION_ENABLED` | `false` | true/false |
| `AI_CENTER_ALLOWED_BASE_URLS` | `[]` | 最多32个 HTTPS base URL 的 JSON 数组；拒绝 URL 凭据、query 和 fragment |
| `AI_DEEPSEEK_LIVE_ENABLED` | `false` | true/false |
| `AI_DEEPSEEK_UPSTREAM_CONFIRMED` | `false` | true/false |
| `AI_DEEPSEEK_DATA_CLASS` | 空 | 空或显式 `synthetic-or-deidentified` |

启动器继续允许原有项目 capability、独立认证凭据、数据库 URL 与 `TRUST_PROXY_HOPS` 配置。调用者进程里的 AI 配置与凭据不继承；不转发任意 API Key、`NODE_OPTIONS`、其他项目的 SecretRef 变量或测试 Provider 开关。这里的白名单约束生成器传给子进程的环境；应用后续还会通过唯一 runtime-environment owner 读取本项目 `.env`，该文件必须只由本项目可信操作者维护。`show` 只返回声明与去敏运行配置，不返回本地环境值。

AI SecretRef 变量名按现有 SecretCenter 命名空间派生：

```text
AIJ_SECRET_<PROJECT_ID转大写且连字符转下划线>_<APP_ENV大写>_AI_PROVIDER
```

例如 `demo-ai` / `test` 对应 `AIJ_SECRET_DEMO_AI_TEST_AI_PROVIDER`，引用为 `env://AIJ_SECRET_DEMO_AI_TEST_AI_PROVIDER`。清单只存该变量名，示例环境只含注释，没有生成的值。需要使用时在本项目忽略的 `.env` 独立配置，后续通过既有 SecretCenter / AI 管理接口创建与绑定引用；配置生成不创建 SecretReference、ScopedConfig 或插件安装记录。未提供变量不阻断离线 `show`，也不代表凭据可用或 Provider 已连通。

不复制宿主、其他项目或轻企的 `.env` 和真实密钥。DeepSeek 的 LIVE_ENABLED、UPSTREAM_CONFIRMED 与 DATA_CLASS 三项门禁全部保留；开启某一项不会绕过其他门禁或 AI 中心现有服务端策略。允许 HTTPS URL 也不是上游用途确认、发布授权或真实付费调用证明。

## 身份隔离与拒绝

项目身份、环境、端口、Origin/API URL、JWT issuer、Cookie 前缀、存储根及 `RUNTIME_PROFILE` 都由清单派生。`show` 和 `run` 启动前检查 `.env.example` 与存在的 `.env`；仅手改 `.env` 的 `PROJECT_ID` 或其他身份字段会拒绝，不会切换到宿主。环境文件与清单不得为符号链接。清单的 AI 契约必须与 edition、项目和环境完全一致，不能通过改 SecretRef 变量名转向其他项目。

这是配置一致性检查，不是对本地可写清单的密码学签名。需要新身份应重新生成配置，并为新项目独立准备数据库、凭据与存储。未知字段、非法 URL 或损坏 JSON 的拒绝信息不输出配置内容。

## 离线验证与剩余工作

```sh
node --test scripts/test/runtime-environment.test.mjs \
  scripts/test/project-configuration.test.mjs \
  scripts/verification/project-generator.test.mjs
pnpm exec eslint scripts/project/cli.mjs scripts/project/editions.mjs \
  scripts/test/project-configuration.test.mjs --max-warnings=0
```

新增测试覆盖实际 create/show 文件往返、两种 edition 与 peer 隔离、未知插件/契约篡改拒绝、全部身份覆写在启动前拒绝、配置转发与秘密不回显。测试只写本工作区忽略的 `.artifacts`，使用合成值，不连接数据库、不开 HTTP 服务、不运行 Next 构建、不调用上游 AI。

AF-127 的正式 `verify:task` 注册与执行由总控负责。GEN-02/03 必须在 I-ORCH-GEN-01 真实集成完成后继续；不能把 Worker 候选完成或本地离线测试当作已集成、负责人验收或完整 AI 产品矩阵通过。
