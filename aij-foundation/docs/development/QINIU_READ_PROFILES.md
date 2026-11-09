# 受信任七牛附件读取配置（AF-153）

FilesModule 在启动时读取服务端 `AIJ_STORAGE_READ_PROFILES`，构建不可变的 StorageReaderRouter 快照。配置来自 ConfigService 的服务端配置/进程环境；未提供时读取宿主 `.env` 同名值（与现有 runtime environment 读取器一致）。进程环境优先。缺失或 `[]` 仅保留原始 local；空字符串、非法 JSON 或非法条目使启动失败，错误固定为 `Invalid storage read profiles configuration`，不附原始值、URL、密钥或 cause。

安全 `.env` 示例仅含引用，无实际 AK/SK：

```dotenv
AIJ_STORAGE_READ_PROFILES='[{"id":"qiniu:private-docs:v1","bucket":"private-docs-bucket","privateBucket":true,"region":"z0","uploadOrigin":"https://up-z0.qiniup.com","managementOrigin":"https://rs-z0.qiniuapi.com","downloadOrigin":"https://files.example.com","allowedHosts":["up-z0.qiniup.com","rs-z0.qiniuapi.com","files.example.com"],"accessKeyRef":"env://AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK","secretKeyRef":"env://AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK"}]'
```

这是 `aij-foundation/test` 的结构示例。部署方须设置自己的私有 bucket 和下载域名，并按实际已验证的 ConfigService `projectId` / `environment` 使用所属引用；JSON 不能指定或覆盖这两个身份。`files.example.com` 不代表可用域名，不会在配置解析/构造时解析 DNS 或联系七牛。可采用既有 `local://<project>/<environment>/QINIU_AK` / `QINIU_SK` 引用；其加密文件保护仍由 SecretCenter 执行。不要把实际 key、带 token 的 URL、`.env` 或密钥文件提交到 Git。

每次读取由已有 SecretRefPort.resolveTrusted 分别解析 AK 和 SK：stat 前一组，签名下载前再一组，不缓存值。SecretCenter 必须由宿主组合提供（标准管理员宿主通过 ConfigurationModule/SecretCenterModule 提供），并具备当前项目/组织均 active、所属 active 引用登记和真实 provider 值。只有客户认证而没有 SecretCenter 的宿主可声明 profile，但非本地读取不可用。文件 core 不引入 aij-ai，也不复制 SecretCenter 的归属/状态/密钥实现。

登记成功和实际配置可用性是两件事。引用缺失、禁用、改名轮换、provider 不符、值缺失、项目/组织停用，都会使后续读取 unavailable；没有 local fallback，也不承诺 readiness。轮换原引用的实际值在后续操作即时生效；若引用标识变化，旧快照仍指向旧引用并拒绝读取，部署方须修改 profile 并重启。bucket、域名等配置变化须刻意启用新版本 ID 并重启，已有 FileAsset 的 storageType 应由所属服务端流程管理。

配置限制：

- 完整 JSON UTF-8 最大 16 KiB，数组最多 8 项；每项必须且只能包含示例的 10 个字段。重复 JSON key（含转义拼写）、重复 ID、每项重复 host、literal AK/SK、身份/limits/transport 等额外字段均拒绝。
- ID 为 `qiniu:<safe-code>:v<positive-safe-int>`；code 为小写字母起始的安全连字符编码，最长 64 字符，版本无前导零且是正安全整数。`local` 不可覆盖。
- 私有 bucket 与已支持 region 固定；upload / management origin 必须分别是 `https://up-<region>.qiniup.com` 与 `https://rs-<region>.qiniuapi.com`。下载 origin 必须是精确 HTTPS host；禁止路径、端口、凭据、query、fragment、IP、通配符、内网 host、大小写变体等。allowedHosts 恰好覆盖三个 origin 所需的 host，无多余 host；不同版本可以共用官方域名。
- 固定沿用现有 QiniuStorageAdapter / QiniuHttpsTransport 的 5 MiB 对象、16 KiB 元数据、默认 10 秒期限、短时私有签名、拒绝重定向、公共 IPv4 DNS 校验与连接 pin、TLS 主机验证及字节上限。适配器校验七牛 etag；唯一 FileContentService 再校验 FileAsset 长度与 SHA256。

请求不能创建/更新 profile，也不能选择凭据或 URL。读取仅按服务端 FileAsset.storageType 路由，未知 profile/version 在凭据或存储 IO 前 unavailable。STORAGE_READER 仍 useExisting 同一个 LocalStorageAdapter，上传仍为 local；暴露给 router 的云能力只有 read。云删除保持 503，元数据不进入 deleting，不触发本地补偿；本卡不含云上传/删除、管理 UI、公开签名链接、Schema/migration 或新依赖。

## 验证与总控接收

Worker 可独立安装 frozen 依赖，执行无 DB Prisma generate、小包构建、定向 lint/noEmit 与纯测试。源码模式：

```sh
AIJ_AF153_TEST_SOURCE=true node --test scripts/verification/storage-read-profiles.test.mjs scripts/verification/qiniu-storage-assembly.test.mjs
```

默认测试加载 `apps/api/dist`，保留 compiled Nest assembly 覆盖；总控在自己串行的正式 API build 后运行同一命令且不设置 `AIJ_AF153_TEST_SOURCE`。withTestTransport 仅为测试宿主的构造期 DI，要求 nodeEnv/environment 同时 test；每个 Nest 应用独立，生产静态 FilesModule 始终使用原 QiniuHttpsTransport，无全局 fetch/原型 patch、TLS 降级、生产 loopback 例外或客户端开关。

真实验收文件为 `scripts/verification/storage-read-profiles-live.test.mjs`，Worker 不运行。总控需先在共享 `scripts/database/migration.mjs` createAcceptance 与 `scripts/runtime-environment.cjs` acceptanceRecord 的任务白名单、verify:task registry 注册 AF-153，然后使用已核验独立测试实例及最新 API build：

```sh
AIJ_AF153_ROOT_ACCEPTANCE=true node --test scripts/verification/storage-read-profiles-live.test.mjs
```

该文件自己创建全新受保护 AF-153 验收库、部署审定链，并创建全新合成组织/项目/客户/引用/附件；不调用 Seed、不采用已有数据。使用真实 SecretCenter、FilesModule、ClientFilesController/Service、FileContentService、客户 HTTP 登录与会话，自己的短时 loopback HTTP fixture 仅映射精确官方管理/下载 origin 并验证真实签名。它不访问厂商；生产传输策略不变。fixture 只接受 GET，校验字节/SHA256、跨会员拒绝、错误 hash、禁用/轮换/缺失/foreign 引用、组织/项目停用、未知版本 0IO、local 不受影响、云删除 0IO/0补偿及快照不变。所有服务在 finally 退出，合成验收库/证据保留归总控管理。local 存储沿用宿主私有目录要求，根 `.artifacts` 及其被 local adapter 遍历的目录须已符合 0700 保护。

人工检查：由总控运行上述真实验收后检查 `.artifacts/af153/live/<lease>/result.json`，确认所有子场景通过、所有 provider 请求均 GET、外网调用为 0；再运行注册 verify:task 和适用门禁。当前 Worker 没有运行中的 API 地址或人工页面；候选提交不代表 CODE_VERIFIED 或负责人接收。
