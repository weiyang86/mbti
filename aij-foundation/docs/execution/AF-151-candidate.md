# AF-151 候选执行记录

任务：按附件存储类型安全路由读取内容。候选交付不代表正式集成或负责人验收。

## 初始身份（先于源码引入记录）

- 时间：2026-11-05T02:57:34Z。
- Worktree：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W04-AF151`。
- Instance：`9b2aa2f8-0603-4ffd-8653-3d164222cd65`；host：`local`。
- Task：`task_7274db19e830`；Dispatch：`ctx_8ba80b8239a9`。
- Writer terminal：`term_22b49a2b-50e8-4819-88d3-2d0ac3b4b3f1`；总控：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 分支：`weiyang86/AIJ-W04-AF151`；初始 `git status --short --branch` 无修改。
- 初始 HEAD = origin/dev = `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- origin fetch/push：`git@github.com:weiyang86/aij-foundation.git`。
- 只在本注册子工作区写入；根 dev 与轻企库只读；无子 Agent。

## 源码引入

仅按派工执行以下精确 blob 引入；逐项 SHA256 校验后单独提交，后续候选差异从该提交之后计算。

| 路径 | 来源 commit / integration task | SHA256 |
| --- | --- | --- |
| `apps/api/src/files/qiniu-storage.adapter.ts` | `d23d096bbbe3a424608e800099642b57e4817725` / `task_57b3d6b46f0e` | `04dce045abe28acfc3ca252813052917d81742714156bfd74fb4b5b61ed7dd58` |
| `apps/api/src/files/qiniu-storage-policy.ts` | `d23d096bbbe3a424608e800099642b57e4817725` / `task_57b3d6b46f0e` | `ab22fcbcbed71097a813b80bb2b3a965a2a69c5be68865fa78cffe9bbef8c289` |
| `scripts/verification/qiniu-storage-assembly.test.mjs` | `d23d096bbbe3a424608e800099642b57e4817725` / `task_57b3d6b46f0e` | `64bb3406e1ef7b8626a6b747068f0cd5141b6b9bde7e6f4b278e793cef322f5f` |
| `apps/api/src/files/storage-reader.port.ts` | `818ce54b989ce27ed6bd853ac8200c885b17a75a` / `task_9b880cb5227c` | `45230a9228af497bacf9b41bd5942d24432353d7d52691db52767bfbdcb2fe12` |
| `apps/api/src/files/file-content.service.ts` | `818ce54b989ce27ed6bd853ac8200c885b17a75a` / `task_9b880cb5227c` | `3d2ff4cd499f4563d8496d1b7917ddbc471ee00bed856d27e4a941a3362a65c2` |
| `apps/api/src/files/files.module.ts` | `818ce54b989ce27ed6bd853ac8200c885b17a75a` / `task_9b880cb5227c` | `2da53d36fb7e73835ccca558196541223e163eb4415276eaefc15fe1cf42b60e` |
| `scripts/verification/file-storage-reader.test.mjs` | `818ce54b989ce27ed6bd853ac8200c885b17a75a` / `task_9b880cb5227c` | `10e848a978101567cd95610681ff3b34cf6658dcb24f587cda9cec21c07894fb` |


源码引入提交：`7e3caaa483a83ae1c926cfd622153df1fcffe627`。本卡候选 delta 只取该提交之后的变更；总控已有 AF-143/145 的真实集成来源，不应把 bootstrap 再次作为 AF-151 功能差异接收。

## 候选实现与边界

- 新增 `StorageReaderRouter`：构造时仅接受可信宿主提供的只读 tuple 列表，复制为私有 Map，冻结实例，无注册/更新接口、请求/env/DB 配置入口。映射不可变但不冻结 adapter，以保持唯一 LocalStorageAdapter 实例及其原有生命周期。
- 标识只接受精确 `local` 或 `qiniu:<profile-code>:v<positive-version>`；code 为 1–64 位小写字母开头、字母数字及单个分隔连字符；version 为不带前导零的正安全整数（最大 9007199254740991）。空、未知、格式错误或未注册标识均不能命中。
- `FileContentService.read` 在边界要求 `storageType: string`，只按服务端 FileAsset 字段选择读取器；不读取 path/url/provider hint，不从 objectKey 推断 provider。未知类型优先报原有 `FileContentError("unavailable")`，adapter 零 I/O；size/SHA256、返回 Buffer 快照、missing/corrupt/unavailable 仍由原有 FileContentService 一处负责。
- 生产 `FilesModule` 只注册 `local`，且指向同一 LocalStorageAdapter。保留 `STORAGE_READER` symbol、原 `useExisting: LocalStorageAdapter` 绑定与导出；增加 router provider/export，读取只用原 StorageReaderPort 的 read 能力。
- Qiniu 仅在显式测试宿主构造真实 QiniuStorageAdapter 并注册两个独立 profile/version。未启用生产云配置、上传、删除或公共链接；不新增 byte/error/ledger owner。
- `ClientFilesService.delete` 在本地 read/remove/exists/write、metadata claim 或补偿之前拒绝所有非精确 `local` 类型，返回现有安全 503；不伪造 missing/deleted 状态。现有本地删除补偿分支保持原样，上传仍写 local。
- 实际差异仅为 4 个 API 文件、4 个 verification 文件、本执行记录；无 Schema、manifest/lock、registry、正式队列、AGENTS 或其他 Worker 文件修改。

## Worker 验证

环境：Node v24.21.0 / pnpm 10.0.0；本子目录独立 `pnpm install --frozen-lockfile` 成功（726 packages，锁文件未变）。未复制 env、凭据、node_modules、上传目录，也未使用来源目录软链接。

| 命令 / 检查 | 实际结果 |
| --- | --- |
| 精确 7 blob 的 SHA256 校验 | 7/7 PASS，校验值见上表 |
| `pnpm --filter @aij/api prisma:generate` | PASS；仓库脚本仅 compile，禁用 env 加载，虚拟 port 1，不连接数据库 |
| `node --test scripts/verification/file-storage-reader.test.mjs scripts/verification/storage-reader-routing.test.mjs scripts/verification/qiniu-storage-assembly.test.mjs` | 73/73 PASS，0 skipped/todo；原有 reader 36 用例全部保留并适配真实 router |
| API 全源码 TypeScript noEmit（下面命令） | PASS，无诊断；workspace package source 映射，不做 app build |
| `pnpm exec eslint apps/api/src/files/storage-reader-router.ts apps/api/src/files/file-content.service.ts apps/api/src/files/files.module.ts apps/api/src/files/client-files.service.ts scripts/verification/file-storage-reader.test.mjs scripts/verification/storage-reader-routing.test.mjs scripts/verification/storage-reader-routing-live.test.mjs scripts/verification/qiniu-storage-assembly.test.mjs --max-warnings=0` | PASS |
| `node --check scripts/verification/storage-reader-routing-live.test.mjs` | PASS；仅语法检查 |
| `git diff --check` | PASS |
| `node --test scripts/verification/storage-reader-routing-live.test.mjs` | **NOT_RUN Worker；ROOT ONLY** |
| `pnpm verify:task AF-151` / DB / heavy API/Web build | **NOT_RUN Worker**；本起始基线 AF-151 尚未注册，总控负责正式验证 |

TypeScript noEmit 实际执行（全 API 源码，不输出产物）：

```sh
node --input-type=module <<'JS'
import ts from 'typescript';
import {resolve} from 'node:path';
const config=ts.readConfigFile('apps/api/tsconfig.json',ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve('apps/api'));
const options={...parsed.options,noEmit:true,rootDir:resolve('.'),baseUrl:resolve('.'),paths:{'@aij/core':['packages/core/src/index.ts'],'@aij/contracts':['packages/contracts/src/index.ts'],'@aij/runtime-contracts':['packages/runtime-contracts/src/index.ts']}};
const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames,options));
if(diagnostics.length){console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));process.exitCode=1;}else console.log('API TypeScript noEmit PASS');
JS
```

编译后 Qiniu Nest 测试使用真实编译类：仅把 `storage-reader.port/router`、`file-content.service`、`qiniu-storage.adapter/policy` 五个 API 源文件与 runtime-contracts 单文件实现定向 transpile 到本子目录 ignored dist；未执行全 API/Web build，未启动服务或连接供应商。总控正常 API build 后可直接重跑 assembly 测试。

新增测试具体证明：26 种未知/空/非法类型在缺失 integrity metadata 时仍优先 unavailable、零 I/O；输入映射变更不影响注册；重复/非法注册拒绝；真实 Nest 中两个实际 QiniuAdapter 对同 key 走各自 bucket/host/profile version；错误与 checksum 映射、未知类型不回退；非本地删除零本地操作与 metadata 写入；显式注册的 Qiniu 也不能进入本地删除；本地删除失败仍走原补偿顺序。

## ROOT ONLY live 与集成前置

`storage-reader-routing-live.test.mjs` 需要**全新 AF-151 专属受保护 acceptance lease**，不得复用 AF-047/048 lease。它先真实登录、local multipart upload、client/admin 200 精确 bytes、跨用户 404，再仅改本卡上传资产的 storageType 为 `qiniu:af151-unregistered:v1`；监测同一 LocalStorageAdapter 的 read/write/remove/exists 和所有 FileAsset mutator，证明 client/admin read 503、delete 503、跨用户 404、零 I/O、零写入且整条 metadata 不变；恢复 local 后两端恢复真实 bytes200，再正常 DELETE 清理并核验 pool 关闭。测试只允许恢复/清理自己创建的 synthetic row/key，结果写入本 lease 的 ignored evidence。

受 allowPaths 限制，以下总控所属共享注册文件**本 Worker 未修改**；总控在根 dev 按 AF-151 新卡注册：

- `scripts/database/migration.mjs` 的 createAcceptance task allowlist。
- `scripts/runtime-environment.cjs` 的 acceptanceRecord task allowlist。
- `scripts/database/seed.mjs` 的 seed acceptance allowlist。
- `scripts/verification/client-auth-fixture.mjs` 的 clientFixtureTasks。
- `scripts/verification/auth-support.mjs` 的 authKeys/authEnvironment task allowlists。
- `scripts/verification/readiness-support.mjs` 的 applicationSessions task allowlist。
- 正式 `registry.mjs` / queue / execution evidence：根验证应注册 source reader + routing + compiled Qiniu Nest 测试，以及 ROOT ONLY live 测试和适用门禁；遵守 DB 与重型 build concurrency=1。

另发现既有 `scripts/verification/packed-consumer-upgrade.test.mjs:492` 与 `:530` 直接 `new FileContentService(storage)` 且缺 storageType。本任务明确要求新的 read 边界不能推断 local，因此**不能为了这些旧调用加隐式 fallback**；总控需在其所属范围把 fixture 显式构造成 `new FileContentService(new StorageReaderRouter([["local", storage]]))`，并使用真实 server-owned FileAsset.storageType（恢复查询也选取 storage_type）传入 read。此共享打包测试不在 allowPaths，Worker 未修改，也未运行 Docker 验收。

## 影响、验收与交接

- DB：无 Schema/迁移/配置/状态机新增；未知读取与非本地删除不写 FileAsset 状态。
- 接口：现有 client/admin 文件读取可按可信已注册类型路由；默认 local 行为与 checksum 不变；非本地 delete 安全 503。无新 endpoint。
- 页面/权限/审计：无页面、菜单、权限码或日志格式变更；原有 owner/project/RBAC 入口保持；错误继续使用已有安全消息。
- 访问地址：Worker 未启动 API/Web，**没有已运行访问地址**。未运行 DB/Docker/seed/migrate/vendor/payment/notification。
- 人工验收：总控在已核验隔离库运行上述 live，核对 lease evidence 的 localIO=[]、fileAssetWritesDuringRefusal=[]、503/404/恢复200/normal cleanup；默认 FilesModule 不存在 Qiniu profile。
- 未实现（后续独立卡）：可信 profile factory/SecretRef 授权、未知云写入状态持久化与 reconcile、生产云 API/config wiring、云上传/删除。
- 依赖：源码 bootstrap 对应实际集成 `task_57b3d6b46f0e` 与 `task_9b880cb5227c`；正式下游依赖必须由总控引用本卡未来 I-* 的真实 Task ID，不得引用当前候选 Task 代替已集成状态。
- 预算：Worker 于约 02:57–03:08 UTC 完成，实现与验证远低于 2.5h 上限；总控仍保留至少 1h 正式验收预算。
- 状态：`CANDIDATE_READY`，ROOT live 与正式 verify:task 尚待运行，不标记 CODE_VERIFIED 或负责人已接收；批次出口由总控维持 OWNER_CHECK_PENDING。
- 交接：交回候选提交后 Writer 明确停止写入；不 push、不改正式队列/registry、不写根工作区。总控只接收 bootstrap 之后本卡 delta，失败修正请按同一 Writer 明确交回。
