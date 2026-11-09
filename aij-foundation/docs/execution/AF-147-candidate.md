# AF-147 候选交付：实现七牛云私有对象存储适配器

状态：CANDIDATE_VERIFIED / ROOT_INTEGRATION_PENDING，非正式 CODE_VERIFIED，非负责人接收。2026-11-05 同一 Writer 完成实现和自查，无独立 Review 冒充。本文所在提交是本卡候选提交；完整 SHA 由最终 `worker_done` 回执交给总控，避免在提交内自引用 SHA。

## 派工与基线

- Task：`task_c08076a9afdb`；Dispatch：`ctx_ee79258f05ca`。
- Worker terminal：`term_ceea3cbe-3c8f-4c6e-9b5a-ae71e85d28a2`；Coordinator：`term_a1b633bc-6ace-4602-868a-dc2c12c5849e`。
- 实际 Orca Worktree ID：`ab33c63f-00b7-40ab-a5de-fa58b189046d::/Users/lei/orca/workspaces/aij-foundation/AIJ-W03-AF147`；instance `753376a3-58f6-4a9a-95c6-16d215e102ff`。
- 工作目录：`/Users/lei/orca/workspaces/aij-foundation/AIJ-W03-AF147`；branch：`weiyang86/AIJ-W03-AF147`。
- 初始 `git status --short --branch` 仅分支行，无已修改/未跟踪文件；HEAD 与 `origin/dev` 都是 `94b0236f775fa40a07944c5e0545ac6ce0e123f3`。
- Remote fetch/push：`origin git@github.com:weiyang86/aij-foundation.git`。本卡无 checkout、merge、push、远端 Issue/PR、tag、部署或发布。
- Source bootstrap：**NONE**；五个允许路径在起始 HEAD 均不存在，因此候选只含本卡新增差异。未触碰其他 Worker、正式队列、registry、Schema、依赖清单、锁文件或 AGENTS。
- 主工作区仅用于只读规范读取；未访问/修改轻企源仓库。单独执行冻结 pnpm 安装，未复制 env、凭据、node_modules 或上传数据。
- 开始核验时间：2026-11-05 01:52 UTC（09:52 CST）；Worker 用时约 0.35 有效工程小时，保留总控约 1h 验证额度，总预测约 1.35h，低于 4h 卡片上限。

读取主工作区当前正式需求基线、差距分析、交付验收、PROGRAM、WAVE-03 与 AF-147；历史未授权文字按当前派工覆盖，历史负责人验收状态不回填。SHA-256：

| 只读依据 | SHA-256 |
| --- | --- |
| AF-147.md | c3c21a02a8196f71c5dece76a59fe020ec25def450276fe86d03cb4f29fc5c7c |
| PROGRAM.md | d46ee9ecb56f61eed04af7585a3803fade73fd5475459379a4e6b49f60a9ccca |
| WAVE-03.md | e37f6e11222a289853a869094fa249aff215944e8715502de75b1e1cdb4c983c |
| REQUIREMENTS_BASELINE.md | 3b26744c0c4dab476c8e10ac66f6cf57b14a42aa5b069d05d86791508b08296a |
| SOURCE_GAP_ANALYSIS.md | 60929edb7bddb97a86bfda7edd2ff36daf303afbf54c5cbc20bb33a11b155f4a |
| DELIVERY_AND_ACCEPTANCE.md | b3c1f93d168d5b66a72abf9ec4b5488ab73fecf3d3190e83db7257ab513b7c3f |
| 原 LocalStorageAdapter | 456ba5a29d256f5c4b3b26d00b2d2590cceaf234804643e1a339c48fbd20d246 |
| 原 runtime-contracts/src/index.ts | b4caef0b7b6f10dcd7e0310806c11eb1aa04fa0262b22b2277dddc32284fa78b |

## 实际差异与协议依据

新增 `QiniuStorageAdapter implements StorageAdapter`，使用现有 `@aij/runtime-contracts` 的契约和 `LocalStorageError` owner；子类仅增加安全的 operation/outcome，不复制共享错误码。`relativePath/write/read/remove/exists` 可调用，另提供精确 UUID 的 `signedGetUrl`。上传字段为 key/token/file，新增语义由精确 bucket:key scope 和 insertOnly=1 约束；回执必须为 JSON、完全一致的 key 和实际字节计算的七牛 etag。读取先 stat，再带短期签名 GET，核对实际大小/etag，复制返回字节。

2026-11-05 使用 web 浏览官方资料，依据如下；未调用厂商业务接口：

| 内容 | 官方链接及采用范围 |
| --- | --- |
| 上传策略 | [上传策略](https://developer-doc.qiniu.com/products/kodo/development-guidelines/security/1-put-policy)：精确 scope、insertOnly、deadline、fsizeLimit、自定义回执；原入口 [put-policy](https://developer.qiniu.com/kodo/1206/put-policy) 浏览超时后采用官方新文档站 |
| 上传凭证 | [upload-token](https://developer.qiniu.com/kodo/1208/upload-token)：JSON → 带 padding 的 URL-safe Base64 → HMAC-SHA1 → AK:签名:策略 |
| 表单协议 | [直传文件](https://developer.qiniu.com/kodo/1312/upload)：一次 HTTP multipart/form-data 上传及 key/hash 回执；不是分片续传协议 |
| 私有下载 | [download-token](https://developer.qiniu.com/kodo/1202/download-token)：对精确下载 URL 与 e 参数签名，token 放最后；实现仅 ASCII 命名空间，无用户 query |
| 管理签名 | [access-token](https://developer.qiniu.com/kodo/1201/access-token)：Qiniu v2，签 Method、Path、Host、Content-Type、X-Qiniu-Date 与空 Body；[官方 SDK 签名源码](https://raw.githubusercontent.com/qiniu/nodejs-sdk/master/qiniu/util.js) 用于交叉核对格式，未安装/复制 SDK |
| stat/delete | [资源元信息查询](https://developer.qiniu.com/kodo/1308/stat)、[资源删除](https://developer.qiniu.com/kodo/1257/delete)：EncodedEntryURI、stat fsize/hash、delete 空成功回执 |
| 错误语义 | [错误响应](https://developer.qiniu.com/kodo/3928/error-responses)：612 明确对象缺失、614 已存在，5xx 保留故障/未知；管理 404 可能是 bucket/route 问题，不能变成 exists=false |
| etag | [七牛官方 qetag 算法](https://github.com/qiniu/qetag)、[参考源码](https://raw.githubusercontent.com/qiniu/qetag/master/qetag.js)：4MiB 块 SHA1 与 0x16/0x96 前缀；自主实现，并用独立 Python hashlib 计算固定测试向量 |
| 区域 | [存储区域与端点](https://developer.qiniu.com/kodo/1671/region-endpoint-fq)：只采用下列显式源站上传/对象管理端点 |

## 运行契约和限制

构造参数来自可信宿主：productId、environment、bucket、privateBucket=true、region、三个 origin、精确 allowedHosts 和可信凭据 resolver。resolver 收到只读产品/环境/bucket/operation 边界，每次操作解析，不缓存 AK/SK；仅支持 8..128 字符 ASCII URL-safe AK/SK。该 resolver 的权限与 SecretRef 配置接入属于后续卡，不可用对象 metadata 或客户端数据实现 resolver。适配器不写日志、不附加原始异常/响应/URL/凭据到错误或元数据。

| region | 上传 | stat/delete |
| --- | --- | --- |
| z0 | https://up-z0.qiniup.com | https://rs-z0.qiniuapi.com |
| cn-east-2 | https://up-cn-east-2.qiniup.com | https://rs-cn-east-2.qiniuapi.com |
| z1 | https://up-z1.qiniup.com | https://rs-z1.qiniuapi.com |
| z2 | https://up-z2.qiniup.com | https://rs-z2.qiniuapi.com |
| na0 | https://up-na0.qiniup.com | https://rs-na0.qiniuapi.com |
| as0 | https://up-as0.qiniup.com | https://rs-as0.qiniuapi.com |
| ap-southeast-2 | https://up-ap-southeast-2.qiniup.com | https://rs-ap-southeast-2.qiniuapi.com |
| ap-southeast-3 | https://up-ap-southeast-3.qiniup.com | https://rs-ap-southeast-3.qiniuapi.com |

downloadOrigin 必须是运营方已绑定该私有 bucket、证书有效的 HTTPS 下载域名，并逐字列入 allowedHosts。无自动区域发现、后缀通配或备用端点；当前没有真实 bucket ACL/绑定/证书的现场验收，privateBucket=true 是可信运营声明，不能证明真实厂商已配置。

默认并硬限制单对象 ≤5MiB（可缩小），允许空对象；multipart 总请求 ≤5MiB+16KiB；JSON 响应 ≤16KiB、下载 ≤配置大小、响应头 ≤8KiB。默认网络总期限 10s，可设 10ms..30s，覆盖 DNS/TCP/TLS/响应全程。私有 GET 默认 TTL 60s、允许 1..300s；上传 token TTL 300s，不对客户端暴露。稳定逻辑路径仅 `productId/environment/objects/UUID`，返回路径不含 bucket、凭据或临时 URL。

生产传输直接使用 node:https，不使用 fetch 或全局代理；实现 redirect:error 等价语义，所有 3xx 立即销毁连接且不访问 Location。仅 HTTPS 默认 443、无 origin path/query/用户名/密码/fragment、无 IP 字面量、精确主机允许名单。DNS 仅 IPv4，所有 A 结果都须公网；私网/回环/链路本地/共享地址/保留/文档/IPv4-mapped 等拒绝。校验后自定义 lookup 只返回已核验的同一 IPv4，不再次解析、不池化、不回退；保留原 hostname 的 SNI、TLS 信任链与 checkServerIdentity。超时后的 DNS 结果不会开启迟到连接。

IPv6、分片/续传、流式/范围读、>5MiB、覆写、列表/批量、公开链接、自动重试、bucket 创建/ACL/生命周期、图像处理、回调均不支持。没有选择 FileAsset provider、FilesModule DI、全 API 接线、可信配置管理或管理 UI；现有 LocalStorageAdapter、旧对象与 FileContentService 没有切换。七牛 etag 不是另建的 FileAsset SHA256 真值。

## 未知结果与补偿

共享错误码保持兼容；QiniuStorageError 额外提供 `operation` 和 `outcome=not_attempted|rejected|unknown`。凭据/输入校验失败不发请求；传输异常、超时、5xx/408、非预期成功状态、200 错 key/hash/缺回执的上传，以及异常/非空成功回执的删除，保守保留 unknown。所有网络动作单次，不做自动重试，也不因上传回执不确定自动删除；生产网络前的某些拒绝也可能被保守标为 unknown，不表示已证明厂商接收。

后续调用者需持久化 pending/unknown 和相同逻辑 key，通过获授权的 stat/read 比对预期字节/业务 SHA256 后协调恢复；不能直接新建 key 重发、不能把 exists 故障当 false，也不能仅因“本次无成功返回”就删对象。delete 超时可能已删除，是否恢复需由文件状态 owner 决定。当前 ClientFilesService 的本地上传/删除补偿不能直接套到云适配器；后续接线卡必须处理这些差异。本卡没有修改既有补偿或数据状态。

## 可重跑证据

以下命令均在本 child 执行，退出码分别为 0：

```sh
pnpm install --frozen-lockfile
pnpm --filter @aij/runtime-contracts build
pnpm --filter @aij/api exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module commonjs --moduleResolution node src/files/qiniu-storage.adapter.ts src/files/qiniu-storage-policy.ts
pnpm exec eslint apps/api/src/files/qiniu-storage.adapter.ts apps/api/src/files/qiniu-storage-policy.ts scripts/verification/qiniu-storage.test.mjs scripts/verification/qiniu-storage-protocol.test.mjs --max-warnings=0
pnpm --filter @aij/api exec tsc --strict --skipLibCheck --target ES2022 --module commonjs --moduleResolution node --experimentalDecorators --emitDecoratorMetadata --esModuleInterop --rootDir src --outDir dist src/files/qiniu-storage.adapter.ts src/files/qiniu-storage-policy.ts src/files/local-storage.adapter.ts
node --test scripts/verification/qiniu-storage.test.mjs scripts/verification/qiniu-storage-protocol.test.mjs scripts/verification/file-storage-adapter.test.mjs
git diff --check
```

最终 56 tests / 56 pass / 0 fail、skip、todo、cancel：七牛逻辑 31，七牛临时 HTTPS 协议 18，既有本地存储回归 7。另用 Node 直接 require 编译后的 `apps/api/dist/files/qiniu-storage.adapter.js`，构造默认生产传输实例，确认六个方法可调用、命名空间正确、错误继承共享 LocalStorageError；未发网络请求，exit 0。

逻辑测试运行真实类而非源文本断言；协议测试运行真实 adapter + 真实生产 HTTPS 消费/限额/超时/重定向拒绝逻辑，唯一测试 IO 在构造器内把已验证的合成公网目标映射到自己的 127.0.0.1:临时端口。运行时 openssl 生成测试证书/密钥，仅对该实例信任其证书，原 SNI/主机名校验仍开启；测试错误证书确实在 HTTP 之前失败。证书/随机 AK/SK 从不跟踪，临时目录测试后清理，生产无环境变量开启 localhost 的路径。此为合成协议验收，不是厂商/DB/应用 HTTP/浏览器验收。

覆盖：实际空/hello/4MiB/4MiB+1/5MiB 向量、multipart 原字节及 view 复制、精确 scope/insertOnly/签名、错签/错 scope 拒绝、错 key/hash/空回执、私有 GET 验签、stat/delete、612/下载404/管理404/故障/损坏区分、非公网与混合 DNS、跨请求 rebinding 与单次 lookup 固定、迟到 DNS、错误 TLS 主机、3xx、Content-Length 和 chunked 超限、压缩响应拒绝、上传已接收超时和删除已执行超时均仅一次且无自动清理。

开发中的真实失败及修复：

- 首次目标 tsc 报 RequestOptions 类型不接受 autoSelectFamily（exit 1）；删除该非必要属性，保留 family=4 和只返回单个已核验地址的 lookup，最终目标 tsc exit 0。
- 首次协议运行 7/18 pass（exit 1）：测试 connector 改临时端口后 Node 自动 Host 带端口，合成路由未匹配。测试 connector 显式保留原 Host，生产传输未弱化，最终 18/18。
- 首次组合回归 51/56 pass（exit 1）：本测试初次创建 .artifacts 为 0755，既有本地适配器拒绝。改为新建 0700，并仅把本 Writer 创建的临时父目录改 0700，最终 56/56；既有产品源码/测试未改。
- 冻结安装提示依赖 build scripts 未自动执行，按现有 pnpm 策略保留；本卡仅编译纯 runtime-contracts 与目标 TS，未依赖 Prisma 引擎。

NOT_RUN：正式 `verify:task AF-147`（旧基线 registry 无该卡，总控独占注册）；全 API/Web build、全 API typecheck、FileStorage Nest 模块门禁、DB/Docker/seed/migrate、真实七牛/商户/通知、浏览器/页面及真实付费验收。无厂商业务请求、无全应用进程，也无可访问的产品新页面/API 地址。

## 影响与总控接收请求

数据库/Schema/接口路由/页面/菜单/RBAC/运行日志均无变化。云端操作能力只在显式实例调用时存在，运行期仍需宿主先授权文件访问并提供可信 resolver；仅 UUID 不授予业务权限。凭据与签名只在内存和正确的 HTTPS 请求里使用；返回 signed URL 是短期 bearer 能力，调用者不得入日志或持久元数据。

总控应在收到停写回执后仅精确接收以下五个路径，注册正式 verify:task，执行上述两个七牛测试和既有存储回归，再按总控节奏执行适用 API 类型/构建/模块门禁，更新正式执行记录/队列并按原标题提交。不要基于本候选宣称七牛已在 FileAsset 产品流程启用或真实厂商验收通过。下游 provider 选择、配置/SecretRef、API 补偿状态和厂商验收应分别显式指派，并引用总控真实 I-* 集成 Task。

| 候选代码/测试路径 | SHA-256 |
| --- | --- |
| apps/api/src/files/qiniu-storage.adapter.ts | 04dce045abe28acfc3ca252813052917d81742714156bfd74fb4b5b61ed7dd58 |
| apps/api/src/files/qiniu-storage-policy.ts | ab22fcbcbed71097a813b80bb2b3a965a2a69c5be68865fa78cffe9bbef8c289 |
| scripts/verification/qiniu-storage.test.mjs | a8868c3e99fd86c745677ee5006d8876bd32094dec4f0dad38d015bc3d6b5f14 |
| scripts/verification/qiniu-storage-protocol.test.mjs | 6bc1fcfdb3e9eb644dff991366d8f08837ad60ca9b8597600241a7db14fe76ce |

第五路径即本文 `docs/execution/AF-147-candidate.md`。Writer 在候选本地提交及交接后明确停止写入；不自行注册正式门禁，不继续接线、不跨卡续跑，不代签负责人接收。
