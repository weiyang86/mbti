# AF-153 候选交付：接入受信任七牛附件读取配置

状态：CANDIDATE_ONLY；非 CODE_VERIFIED，负责人接收待总控集成和正式验证。本 Writer 自查不代表独立 review。STOP ALL WRITING：本卡候选提交后停止全部写入，交回总控；最终候选 SHA 由 worker_done 回执报告。

## 实际派工与基线

- Issue：AF-153；唯一 Writer 位于 `/Users/lei/orca/workspaces/aij-foundation/AIJ-W05-AF153`。
- Orca Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W05-AF153`，instance `aac9dab4-ab2f-43da-a625-8aef1c688245`；由实际 `orca worktree current --json` 核对。
- Task `task_533e825b6985`；Dispatch `ctx_02b5092d4541`；Worker terminal `term_1f23aedb-2233-472c-8f2d-3d3f3d0e0201`；Coordinator terminal `term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支 `weiyang86/AIJ-W05-AF153`；写前 HEAD 与本地 `origin/dev` 均为 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`，工作树干净，无继承修改；没有 fetch/更改 remote，origin fetch/push 均 `git@github.com:weiyang86/aij-foundation.git`。
- 首次记录时间 `2026-11-05T04:05:58.997916+00:00`；机器证据 `.artifacts/af153/baseline.json` 包含实际身份、状态、remote 和 8 个源 blob 的提交/SHA256。

## 源 bootstrap（独立提交，总控不得重复集成）

`f5113588cb45e5a8e58c86f37a34bba10ae3f48a`，标题 `chore(AF-153): bootstrap verified storage reader sources`。仅从派工指定的本仓库 commit 用 git show 精确恢复 8 个 blob，先在内存核对全部 SHA256，再写入并单独提交；没有复制环境/凭据/依赖/数据。来源对应：adapter/policy `d23d096b` / `task_57b3d6b46f0e`，module/router/content/client-service/assembly `0c4828e4` / `task_940e84b0aa8a`，read-port `818ce54b` / `task_9b880cb5227c`。bootstrap 后仅 module 与 assembly（本卡 allowPaths）继续修改，其余恢复文件只读且保持原 blob。

总控只接收 bootstrap 之后的候选提交（parent 为上面的 bootstrap SHA），排除继承的源恢复差异；需要 upstream 的真实集成节点。

## 实际差异与影响

8 个允许路径：新增 `storage-read-profiles.ts` / `storage-read-profile.service.ts`、修改 FilesModule、新增 parser/factory 纯测试与 root-only live 验收、保留并扩展原 compiled Nest assembly 测试、开发说明与本记录。未修改队列/registry/AGENTS/Schema/migration、全局 manifest/lock、ai-runtime/permissions/SDK、通知模块或正式 dev。

实现 16 KiB / 8 项严格 JSON、精确版本 ID、所属 SecretRef-only 配置、固定官方 origin 与精确 hosts、重复 key/ID/host/未知字段/literal key/身份覆盖拒绝、启动不可变快照。每个 stat/sign 操作通过真实 SecretRefPort 新鲜解析引用，不缓存值。生产沿用原 QiniuStorageAdapter 和 DNS-pin/TLS/大小/etag 策略；唯一 FileContentService 保留长度/SHA256 真值。STORAGE_READER 仍绑定唯一 LocalStorageAdapter，只有服务端 FileAsset.storageType 决定路由，未知项没有 local fallback。云注册暴露的只有 read，删除沿用 unavailable/0补偿。

数据库无 Worker 连接/改动；无新 API/页面/权限/日志字段；无云上传/删除/签名链接公开接口。根工作区及轻企源码均未写；没有 DB/Docker/Seed/迁移、API/Web heavy build、服务监听、真实通知、厂商请求或 paid network。独立 frozen offline install、无 DB Prisma generate 和 3 个小包构建仅产生本 worktree 的忽略产物，无共享 node_modules 或符号链接伪装。

## 实际验证

| 命令 | 实际结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | exit 0，726 个依赖，本 worktree 独立安装；既有 lock 未改 |
| `pnpm --filter @aij/runtime-contracts --filter @aij/core --filter @aij/contracts build` | exit 0，仅 3 个小包 |
| `pnpm --filter @aij/api prisma:generate` | exit 0，6.19.0；脚本禁用 env 加载并指向 port 1，仅编译，无 DB |
| `AIJ_AF153_TEST_SOURCE=true node --test scripts/verification/storage-read-profiles.test.mjs scripts/verification/qiniu-storage-assembly.test.mjs` | 最终 exit 0，12/12，fail/skip/todo 均 0；真实源码 parser/Nest module/factory/port，非 compiled 运行 |
| `pnpm --filter @aij/api exec tsc --noEmit` | exit 0，完整 API noEmit；未执行 tsconfig.test noEmit |
| 3 个变更 TS 与 3 个变更测试 MJS 的 `pnpm exec eslint ... --max-warnings=0` | exit 0 |
| `node --check scripts/verification/storage-read-profiles-live.test.mjs` | exit 0，仅语法检查，未运行 live |
| `git diff --check` | exit 0 |

纯测试覆盖 parser 边界、转义重复 key、拒绝未知/明文/外部归属配置、不可变结构和运行快照、单 local owner、真实 FilesModule profile 路由、stat/sign 每次 resolve、值轮换/拒绝、未知版本 0 provider IO、无 SecretCenter 默认/声明 profile 均不触网、测试 DI 非 test 拒绝、native 传输错误和密钥不泄漏。用例数量按顶层 test 12 个计，不把表驱动断言重复计数。

失败轨迹保留：首次纯测试 7/8，通过 local 写入时遭 `STORAGE_ROOT_PERMISSIONS`；修复测试 fixture 为独立 0700 repository root，未削弱生产权限校验。第二轮 10/10，扩展后最终 12/12。证据：`.artifacts/af153/unit-first.log`、`unit-second.log`、`unit-final.log`、`noemit-final.log`、`lint-final.log`。没有把早期失败标为通过。

## 未运行、限制及总控接续

- Worker 未跑 compiled dist tests、实际 HTTP/DB live、正式 API/Web build、注册 `verify:task -- AF-153` 或负责人页面验收；不是失败的检查被隐去，是派工保留给总控的明确边界。没有可供访问的运行中地址。
- 总控须串行完成最新正式 API build，默认运行两份 parser/assembly 测试（不设源码模式），再运行 root-only `AIJ_AF153_ROOT_ACCEPTANCE=true node --test scripts/verification/storage-read-profiles-live.test.mjs`。
- root-only live 文件使用全新 protected AF-153 acceptance DB，无 Seed/既有数据采用，真实 SecretCenter/FilesModule/FileContentService/ClientFiles HTTP routes 与自己的签名校验 HTTP fixture；9 个子场景计划覆盖私有读取、跨会员、坏 SHA256、revoked/rotated/missing refs、foreign ref、项目/组织状态、未知版本与删除 0IO/0补偿、immutable/local、default actual app。**9 项均未在 Worker 运行，不能记为通过。**
- 总控需添加共享 `scripts/database/migration.mjs` createAcceptance / `scripts/runtime-environment.cjs` acceptanceRecord AF-153 白名单与 verify:task 注册；本 Worker 不写这些文件。live 不依赖 auth/client fixture 白名单或 Seed 白名单。local 路径沿用 0700 保护要求。
- 标准管理员宿主已有 SecretCenter；缺少 SecretCenter owner 的宿主非本地读取固定 unavailable。声明 profile 本身不等于引用已登记或服务 ready；配置/引用标识变更需新版本和刻意重启，实际引用值变更无需 key cache 刷新。
- 使用无厂商 fixture 不能证明真实七牛账户/bucket/DNS 可达；没有真实外网验收承诺。生产网络、etag、bytes/error owner 未修改。
- 总控精确集成、注册验证与适用质量门禁、执行/队列记录、正式原名提交及 SHA 回读后方可完成 I 节点，继而负责人统一检查；本候选不代表正式接收。未创建 dev/main 分支修改、push、merge、PR、tag、发布或部署。

Writer 交接：候选提交后 STOP ALL WRITING，等待新派工；不得据本候选继续修改同卡或后续卡。
