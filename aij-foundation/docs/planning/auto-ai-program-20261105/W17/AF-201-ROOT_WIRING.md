# AF-201 ROOT_WIRING（候选，非 CODE_VERIFIED）

范围仅新 files/generated-file-assets.service.ts 与小测试；现有 FileAsset/LocalStorageAdapter/FileContentService/StorageReaderRouter 是唯一元数据、写入和完整性 owners。没有数据库/schema/迁移、HTTP、权限、审计、配置、菜单或页面改动，没有改旧 client/files 的 workspaceId=null/pluginCode=null 边界，没有把 DOCX 加入任意上传白名单。外部厂商固定 DEFERRED_NOT_PASSED，真实账号/密钥留空。

## root 最小接线

1. 在原 FilesModule 的 providers 和 exports 增加 GeneratedFileAssetsService；通过其显式 @Inject 使用原 PrismaService、LocalStorageAdapter、FileContentService。确认 FilesModule 所在模块上下文可见原 PrismaModule（不创建第二 PrismaClient）。AF202 导入原 FilesModule 并注入此服务，不新增上传/下载驱动。
2. 无 FileAsset 字段或 SQL 迁移请求。stage 固定 local/private，UUID assetId 与独立 UUID objectKey，随机路径由原 adapter.relativePath 产生。生成内容范围必须传可信 ProjectProfile.id/workspaceId/current memberId/pluginCode='aij-ai'；scope.projectId 是 PluginRuntimeAccessService.projectId(tx) 返回的核心profile ID（UUID/cuid等），绝不是环境 PROJECT_ID 或 LocalStorageAdapter 配置中的 aij-foundation slug。核心ID只接受1..128位 ASCII 字母/数字/下划线/连字符，保持原值精确比较，不改写为slug或路径。工作区/生命周期/文档/permission 的真实当前验证由 AF202 在同一事务执行。
3. 导出类型在同一文件：GeneratedFileScope、GeneratedFileSpec、GeneratedFileTicket、GeneratedFileMetadata、GeneratedFileError。metadata shape 为 `{assetId,originalName,mimeType,size,checksum,createdAt:Date}`，不含 path/objectKey/url。ticket 仅有可序列化 assetId，但使用 WeakMap 对象身份识别，序列化/展开/跨实例皆丢失能力；ticket 不进 HTTP、审计、数据库、队列或日志。
4. GeneratedFileError 固定 code INVALID_INPUT/INVALID_TICKET/NOT_FOUND/UNAVAILABLE，固定 message、不带 cause。AF202 映射为安全 400/404/503；INVALID_TICKET 为内部编程错误，外部通用 503，不透出内部票据或输入。FileContentError/Prisma/磁盘原始异常已收敛，不输出路径、正文或 stderr。

## 调用与未知结果恢复（必须按顺序）

- `stage(scope,{format,mimeType,bytes:Buffer,checksum:sha256 lower hex,originalName,downloadUrl})` 在短数据库事务外执行。输入 bytes 先复制，大小 1..5MiB；DOCX/PDF MIME、基本 envelope、扩展名及安全 NFC 文件名严格匹配。downloadUrl 只接受最长512的 canonical `/api/client/segment[/segment...]`，segment仅 ASCII 字母/数字/下划线/连字符；拒 origin、编码、点、控制符、反斜杠、query、fragment。建议 `/api/client/document-exports/<exportId>/content`，exportId 由可信 server 产生；不从 HTTP DTO 取值。文件名最长160、不含路径/Windows设备名/控制和双向覆盖字符。签名检查不是完整渲染验证。
- `await prisma.$transaction(async tx => { /* 重验当前文档范围/权限/revision */ const metadata = await files.commitInTransaction(tx,ticket); /* export关系 + 无正文audit */ })`。必须是真实 interactive transaction client，不能传全局 PrismaClient 或脱离事务的 delegate。每票 commit 最多尝试一次，create 成功不表示外层事务已提交；失败不自动删字节、不重试该 ticket。
- 外层事务成功返回后 `await files.confirm(ticket)`：使用原 Prisma 独立 ReadCommitted 事务取同一 advisory xact lock，再精确核对 stage 的所有持久字段后释放 RAM 能力。确认失败保留 ticket，不把“确认失败”视为生成失败重发 POST；读回原 export 关系恢复状态。若更新/删除已使元数据不同，confirm 安全拒绝，可调用 discard 判断保留。
- 外层事务失败/未知返回后 `await files.discard(ticket)`：原 Prisma 独立 ReadCommitted 事务先取相同锁，以 `id=assetId OR objectKey=自己key` 查任何已提交记录（不按active/scope过滤），有任意记录就 `{removed:false,retainedBecauseCommitted:true}`；确定无记录才删除自己 key 并返回 `{removed:true,retainedBecauseCommitted:false}`。数据库异常、锁超时、磁盘删除异常固定 UNAVAILABLE 且不释放 ticket；不清扫目录、不按 caller assetId 删除。retainedBecauseCommitted 不证明 export 关系存在或用户仍可下载，AF202仍须精确读回和当前鉴权。
- confirm/discard 绝不能在持有生成事务的 callback 里 await，否则等待自己持有的锁；必须在外层事务 settled 后调用。并发进行的 ticket 操作拒绝；在 commit 已返回但外层事务仍 pending 时，discard/confirm 会等待数据库锁，从而消除“查不到未提交行就误删”竞态。原 Prisma 独立清理事务显式 ReadCommitted，不能改成 RepeatableRead 的旧快照。
- 锁 SQL 是参数化 `SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1,0))`，参数为 `aij-generated-file:<owner UUID assetId>`；返回整数而非 Prisma 不支持的 void。不新增表/状态账本。生成事务/清理必须在同一原 PostgreSQL 数据库，不能用副本/其他连接目标绕过此锁。root 必须真实 PG 验证此语句与等待/回滚语义。
- `readInTransaction(tx,assetId,scope)` 精确限定 project/workspace/plugin/ownerType=user/ownerId=uploaderId=current member/status=active/deletedAt=null，再原 FileContentService.read。仅local、有效MIME/大小/hash/name/basic envelope；返回 `{bytes:Buffer,mimeType,originalName,size,checksum}`。既不改变旧读取范围，也不自行标记缺失/损坏状态或创建第二文件账本。AF202须在同事务先重验当前文档及read+export权限，删除文档后拒读，即使关系保留。

## root 必须运行的真实验收

- 注册 verify:task AF-201 并按队列原名做正式卡片提交；Worker候选不包含 registry/队列/状态改动。
- 原隔离 PG 127.0.0.1:55433 + 原 LocalStorageAdapter + 原 FileContentService：真实 stage/commit/confirm/read、外层 rollback 后 discard、create/audit/关系写入失败回滚；事务持锁时第二连接 discard 等待，commit后保留、rollback后删除；响应丢失后的精确读回；数据库断连/超时保留文件。
- 元数据 committed 即使 deleted/status非active或仅key匹配也不删除；票据伪造/跨实例/重放/并发拒绝；private scopes、大小/MIME/checksum/损坏/缺失/路径拒绝；旧 client/files null workspace上传/列举/下载回归，不能读新workspace附件。
- 真正模块DI、受保护API/二进制HTTP/权限审计/真实Linux渲染/packed SDK/生产Web/浏览器归root与后续I202/I203。小测试的事务协作者不是PG、Docker、HTTP或浏览器验收；本候选没有启动访问地址。

RAM能力不承诺进程崩溃后自动回收；崩溃时安全保留孤立字节，不引入持久stage/marker账本或盲清理器。若需要运营清理，另开独立审定任务。


## 原Writer修正（task_9add2817750d / ctx_b199a9ab34f5）

root真实PG检查发现初版scopeValid把核心ProjectProfile.id误当storage slug，导致7个生成文件子场景INVALID_INPUT；这是实际集成失败，不得以修改caller或PG fixture传slug掩盖。Worker没有复制root测试或私有artifacts，root告知失败证据 `.artifacts/auto-ai-program-20261105/W17/AF-201-debug-89c3a0d4-8f9c-4c18-8069-9679b90601c9` 保留；root同时报告legacy原上传/列举/下载/删除与不可信DOCX拒绝通过，但不能据此判AF201通过。

修正服务仅放宽核心opaque ID形状到上述有界安全字符，实际scope的精确数据库where未改变；文件系统仍使用独立运行时slug `aij-foundation`。测试明确以UUID scope与slug storage config分离，并验证UUID/cuid/安全大小写ID/128边界的stage→transaction commit→实际字节读取→confirm，slug及其他project ID读取原asset仍NOT_FOUND；非法类型、空、129位、路径/点/控制符/Unicode等在文件I/O前拒绝。保留9组原锁/未知/回滚测试，新增3组后12/12通过。unsafeName使用codepoint条件替代no-control-regex suppression，覆盖原控制符、DEL/C1、双向字符范围，不改变拒绝语义。

root须用真实核心profile ID重新运行原PG门禁；本修正仍不代表正式verify:task/PG通过，AF201仍NOT_CODE_VERIFIED。正式201在root的注册门禁完成前保持NOT_RUN，先前debug失败不得覆盖或隐藏。
