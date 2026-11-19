# AF-220 Root wiring（候选，不是 CODE_VERIFIED）

依据负责人 W22 CONTRACT；Worker 只新增七个脚本模块、一个纯检查及本说明/候选记录。Root 在原 dev 独占接线、真实初始化、构建、DB/HTTP/浏览器及正式门禁。不要把 source-only bootstrap 提交集成回 dev；只精确集成它之后的 AF-220 候选 delta。

## 已固定的运行身份

| 项 | 唯一值 |
| --- | --- |
| project / APP_ENV | `aij-ai-local` / `development` |
| Web / API / PG | loopback `3955` / `3956` / `55435` |
| database / user | `aij_ai_local_development` |
| issuer / cookie | `urn:aij:aij-ai-local:development:api` / `aij_ai_local_development` |
| 私有目录 | `.local-data/ai-local-development` |
| storage | `.local-data/ai-local-development/aij-ai-local/development/storage` |
| 输出 | `apps/api/.ai-local-dist` / `apps/web/.next-ai-local` |
| Compose / container / volume | `aij-ai-local` / `aij-ai-local-postgres` / `aij-ai-local_postgres_data` |
| Compose 文件 | `ops/compose.ai-local-development.yml` |

API 固定 auth/clientAuth/database/storage/asyncRuntime=true、插件仅 aij-ai；三个 AI live/client execution 开关 false，导出 false。四类 auth secrets 与独立 DB password 初次 init 随机产生，由原 runtime project 配置及 assertProjectIsolation 检查互不复用。实际通知/支付、厂商、导出均未启用，不能写成“全部就绪”。

## 1. Root 共享入口与 ignore（已通过 Orca 问答确认）

- Root 为 `scripts/runtime-environment.cjs` 增加 `AIJ_RUNTIME_ENV_SOURCE=explicit` 的窄入口，仅 `aij-ai-local/project/development`、canonical 本库根与 3955/3956 允许；有该标志但身份不符必须拒绝，不回退到 `.env`。Next build/start 的 NODE_ENV=production，APP_ENV 仍 development。
- 在该入口直接返回传入的 env 对象，绝不读 `.env` / `.env.local`，也不合并 process env；Worker 的 `assertExplicitEnvironmentSupport` 用对象身份拒绝旧 reader。API launch 的完整 values、Web build/start 的 public allowlist 均固定该标志。旧 host/test/Base 分支语义不变。
- 精确 ignore `/apps/api/.ai-local-dist/` 与 `/apps/web/.next-ai-local/`；候选不会自行修改 `.gitignore`。CLI 在建造输出前用 git check-ignore 拒绝未忽略路径。
- Next 自己会在加载配置前读取 apps/web 下 `.env` / `.env.local` / `.env.production` / `.env.production.local`；本候选在 build/start 前拒绝这些现存文件，不读取、移动或删除。根目录 `.env` 可以保留，由共享 explicit 入口隔离。
- Root 已通知共享入口与精确 ignore 在其 Writer 范围实现，并称共享相关 67 项检查通过；Worker 没有复制 live root，也没有把该通知当作本卡正式验收。

## 2. Compose 必需契约

Root 从已接受 Base Compose 定向装配，不运行镜像下载；镜像必须逐字为：

`postgres:16-alpine@sha256:e013e867e712fec275706a6c51c966f0bb0c93cfa8f51000f85a15f9865a28cb`

仅一个 postgres service，network_mode=bridge、restart=unless-stopped、loopback 127.0.0.1:55435:5432，唯一 postgres_data 卷挂 /var/lib/postgresql/data，volume name=aij-ai-local_postgres_data，非 external/local driver 无额外 options。禁止额外 network/service/secret/config、entrypoint/command/privileged/bind/device 等扩展。

环境仅这五项：POSTGRES_DB/POSTGRES_USER=aij_ai_local_development，POSTGRES_PASSWORD 来自 `${AIJ_AI_LOCAL_DB_PASSWORD}`，POSTGRES_HOST_AUTH_METHOD=scram-sha-256，POSTGRES_INITDB_ARGS=`--auth-host=scram-sha-256 --auth-local=scram-sha-256`。

healthcheck.test 精确为 `["CMD","pg_isready","-h","127.0.0.1","-U","aij_ai_local_development","-d","aij_ai_local_development"]`；可沿用 Base interval/timeout/retries/start_period 与 stop_grace_period。CLI 使用 `--env-file /dev/null` 阻断 Compose 默认读取 root .env，启动仅 `--no-recreate --pull never`，失败留现场；现存容器的 Entrypoint/Cmd 也须保留官方默认 docker-entrypoint.sh / postgres。

**容器和卷均须有以下七项自有 labels**，Compose 还会增加自己的 project/service/working_dir/config_files labels：

```yaml
io.aij.owner: aij-foundation
io.aij.project: aij-ai-local
io.aij.environment: development
io.aij.instance: "${AIJ_AI_LOCAL_INSTANCE_ID:?Use ai-local init}"
io.aij.repository: "${AIJ_AI_LOCAL_REPOSITORY:?Use ai-local init}"
io.aij.uid: "${AIJ_AI_LOCAL_UID:?Use ai-local init}"
io.aij.machine: "${AIJ_AI_LOCAL_MACHINE:?Use ai-local init}"
```

CLI 仅为 Compose 子进程供应这五个 AIJ_AI_LOCAL_* 变量（instance/password/repository/uid/machine）及最小 OS env，不继承 Docker/厂商/root env。Docker context 和 canonical Unix socket 必须与 owner.json 完全一致；socket 路径不能遍历 symlink。已有命名资源或 project 成员而无完整私有 owner 记录一律拒绝。owner 含 repository/machine/uid/project/environment/instanceId/context/endpoint/createdAt/initialized；旧 Base 完全不变。

## 3. 唯一 root 初始化 hook

Root 新增 `scripts/ai-local-development/root-initialization.mjs`：

```js
export async function initializeAiLocal({ owner, values, runtime }) {
  // 在原 seed/ClientAuth/Workspace/插件/权限 owner 窄出口中完成真实幂等初始化。
  // 仅当所有所需初始化成功后 resolve；失败 throw，无独立账本或复制 seed。
}
```

此 hook 仅 init 阶段动态 import，缺模块/出口/导入失败在创建私有目录或 Docker/DB 操作前返回 REJECTED、exit 2、NOT_RUN。start/status/stop 不加载 seed hook。CLI 先启动经 owner 检查的 PG，再 migrate deploy，然后 await hook；只有成功后才把现存 owner 的 initialized 置 true。root hook 必须复核固定 identity，使用所传 values/runtime，不调用默认 host/test seed，不读 root 凭据作回填。

Root 负责原 seed 必需窄出口、真实五个合成客户与各自独立 Workspace、AI 安装/权限/菜单、调度 owner；重复 init 不重置密码/授权/菜单/配置，不创建原型订单/学生/工单/商品。初始管理员沿用 aij-admin，凭据路径由 `paths.credentials` 给出（私有 initial-admin.json）；客户初始凭据若需记录也只能在本卡私有目录，由 root owner 控制。不要把其内容写入执行记录或 stdout。

`initializeOwnedState` 的 injected collaborators 只供离线编排测试，测试没有模拟 DB 初始化，也不能替代本 hook 的真实成功/拒绝证据。hook 的正常 resolve 表示 root 初始化完成；CLI 不解析其返回业务数据，不输出原始结果。

## 4. 生命周期及故障保留

- 命令仅 `init | start | start --build | status | stop`。如需 package alias，由 root 接线，七模块不依赖 alias。
- 首次 start 自动构建；源码变化后 stop、start --build。已有输出必须有匹配 repository/instance 的私有 build owner 记录，READY 还匹配注册 migration 指纹；未知输出/符号链接/错 owner 直接拒绝。
- 复用 Base 的私有文件/canonical path、PID snapshot、注册 migration inventory 与原 migration ledger guard。数据库仅 exact 55435 目标、PG16、database/current_user/session_user/内部5432 身份校验后 deploy/status；无 reset/drop/repair。
- stop 先核验所有 service 的 PID/birth/CWD/command/OS user/instance，再向准确 supervisor PID 发 SIGTERM；supervisor 复核 child 的 parent/PID/birth/CWD/command。无按端口杀进程、无强杀，超时保留进程和 owner 记录。
- stop 保留凭据、存储及卷；操作锁异常时不自动移除未知锁。ExFAT 若无法证明现有私有权限则拒绝；不 chmod 用户目录兜底。
- 应用原始 stdout/stderr 被 drain，不转入日志；监督器仅写固定生命周期信息。CLI/DB/build 不抛出 raw child output、headers/body/provider payload。失败保持现场。
- status 的地址标注 configuredWeb/configuredApi、readiness=NOT_CHECKED；只有 start 通过 API ready+health 固定身份和 Web/login 的实际 HTTP 检查才输出 RUNNING。

## 5. Root 真实验证顺序建议（本 Worker 均 NOT_RUN）

1. 精确集成候选 delta，接上述共享入口/ignore/Compose/root hook/脚本及原 owner 窄出口；运行定向 ESLint、原 Base/runtime/project/DB target 纯检查及本卡纯检查。
2. 核对 root canonical repo、完整 owner、Unix context、PG16 digest 本地可用、3955/3956/55435 空闲、旧 Base/host 状态；单独串行占用 DB/heavybuild。禁止用 fixture 或借旧 Base/测试库。
3. 由 root 执行 `node scripts/ai-local-development/cli.mjs init`；核验真实 PG target/账本及原 owner 初始化结果，保存五身份/空间证据。重跑 init 比较密码/grants/菜单/配置字节和业务数据，证明无 reset。hook 故障路径也要实测。
4. root schema-only generate、必要小包 build、实际独立 API/Next build/start；证明 Web bundle/env 无 DB/auth/provider secrets，API 只 explicit env，不加载 root .env。测试 Next app env 文件拒绝只可用 root 自己创建的合成文件，不改用户文件。
5. 实际 Web/SDK/HTTP 登录、session、独立 workspace/成员拒绝、插件权限/菜单、创建任务及真实 runtime worker owner 调度、持久化与重复 init；验证 API/Web 当前可访问才交付地址。厂商/导出明确未配置。
6. 完整 owned start/status/stop/start；验证非自有端口/目录/容器/卷/labels/context/PID birth/CWD/command 拒绝与现场保留，旧 Base 3855/3856/55434 及 host/test 均保持。
7. 运行注册 verify:task 与适用门禁，root 执行记录/正式队列更新和原名本地提交，真实服务保留或停止结果如实登记；出口 OWNER_CHECK_PENDING，不 push/PR/发布。

Worker 没有启动地址、真实初始化/DB/厂商/业务/浏览器或重型 build 成功证据；候选不等于 CODE_VERIFIED 或负责人验收。
