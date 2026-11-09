# W17 统一附件与个人文档导出链路

外部厂商验收状态固定为 DEFERRED_NOT_PASSED，真实账号、密钥和商户资质留空，不用合成结果替代。

用户持续授权按有限批次自动继续，真实账号/密钥留空。W16四卡CODE_VERIFIED/OWNER_CHECK_PENDING，I197和I199实际完成；本波不改完整40/历史验收，也不关闭AF191原生14。4卡11.75h含root：AF200治理.75，AF201统一生成附件3.5/Sol high，AF202文档导出API与SDK4/Astra high，AF203导出面板3.5/Terra high。最多root+3Writer，数据库/重构建/Linux/GUI各1且仅root。Worker不改共享依赖/schema/module/SDK index/registry/队列，不运行DB、Docker、App/Next重构建。独立候选按固定接口并行，root必须I201→I202→I203串行验证；候选不是依赖完成。

## AF201：统一文件owner中的生成附件

新增 files/generated-file-assets.service.ts，使用原Prisma FileAsset、LocalStorageAdapter和FileContentService；不另建文件表、读写驱动/账本，不扩大旧client/files的workspace=null上传/下载范围，也不把DOCX加入不可信任意上传白名单。生成文件首版local私有，Qiniu等真实配置仍空。

导出 GeneratedFileScope={projectId,workspaceId,memberId,pluginCode:'aij-ai'}，GeneratedFileSpec={format:'docx'|'pdf',mimeType,bytes:Buffer,checksum,originalName,downloadUrl}；仅可信server调用。GeneratedFileAssetsService提供：stage(scope,spec):Promise<GeneratedFileTicket>（公开assetId，仅同实例可识别的opaque capability）；commitInTransaction(tx,ticket):Promise<GeneratedFileMetadata>；confirm(ticket):Promise<void>（事务确认提交后才释放能力）；discard(ticket):Promise<{removed:boolean,retainedBecauseCommitted:boolean}>；readInTransaction(tx,assetId,scope):Promise<{bytes:Buffer,mimeType,originalName,size,checksum}>。这些是能力契约，必要实现类型在本文件内导出，禁止另起文件owner。metadata不暴露objectKey/path，assetId由owner随机生成。downloadUrl只允许有界同源/api/client/私有相对路径，无origin/反斜杠/遍历/控制符；不来自客户DTO。format/MIME/大小1..5MiB/真实Buffer/sha256/文件基本结构与安全文件名都验证；固定ownerType=user、ownerId/uploaderId=当前member、project/workspace/plugin取可信scope。渲染结构真值仍归AF197/199，签名检查不是完整文件验证。

stage只写自己随机key，不接受host路径。ticket不能伪造/跨实例/重复使用；事务内只保存原FileAsset元数据，事务rollback不被误当commit。discard必须先在原Prisma确认该key/asset无已提交metadata；未知DB状态不删除字节，不能因响应丢失删掉已提交文件。确认已提交则保留并返回retainedBecauseCommitted；仅自己的未提交stage可删，不凭磁盘marker或caller的assetId授权。失败与清理失败保留，固定安全错误不含正文/host路径。read精确project/workspace/plugin/member/status/deletedAt，再复用原FileContentService完整性与storage router，错空间/其他member/已删或坏asset拒绝。生命周期/文档权限由调用AF202在同一当前事务验证；核心文件service不相信HTTP自报scope。opaque handle留在RAM，不进API/审计。

Worker做真实自有临时FS+小Prisma协作者测试（说明不是PG证据），覆盖成功/rollback、伪造/重用/跨实例ticket、已提交/未知DB保留、校验与跨scope/损坏读取。root做原FileAsset真实PG+真实LocalStorage/完整性/回滚与旧上传scope回归，module接线归root。

## AF202：文档与导出记录、API、公共SDK

只用原PersonalDocumentsService/WorkspaceContextService/PluginRuntimeAccessService验证当前member、Workspace、role/grants、project/org/aij-ai生命周期。可在PersonalDocumentsService新增server内部withCurrentDocument(member,workspace,id,permission,expectedRevision,callback)等窄方法，复用原scope/owned，不降低旧API拒绝；具体签名在ROOT_WIRING解释。渲染在两次短事务之间，绝不持有文档/成员/角色锁跑Docker。第一次读当前已保存expectedRevision纯文本快照，调用原DocumentExportExecutor；第二次在同事务重验当前身份/权限/生命周期/文档未删且revision仍等于expectedRevision后，commit FileAsset+导出关系+无正文审计。期间改版409、撤权/停用/切空间拒绝，丢弃未提交stage；取消应传给executor，HTTP正常request.close不能误作取消，响应提前断开才abort。无伪造renderer/host Python。生产defaultoff，模型/密钥无关。

新增personal_document_export关系（由Worker在ROOT_WIRING给精确SQL/Prisma建议，root写实际迁移）：id UUID、document_id/workspace_id/member_id/project_id、revision1..200、file_asset_id、format、renderer_version、page_count、created_at，唯一(document_id,revision,format,renderer_version)。FK关联原document复合scope、原version(document_id,revision)唯一约束及FileAsset(id,workspaceId)；约束/不可变关系/格式与页数合理值，文件元数据真值仍归FileAsset。无新Run/Job/Trace/成本表、无独立执行状态账本/后台队列。同步有界生成，只有成功artifact关系持久化；同版本/格式/renderer重复明确请求复用已存在完整性通过的artifact，2API并发最多只持久一个，loser清理自己stage。允许并发CPU重复生成但不得重复文件记录/审计或隐式付费调用；不承诺渲染恰好一次。metadata写入与审计失败原子rollback，未知commit用精确读回恢复，不盲删已提交字节/重试POST。删除文档后导出关系保留但内容下载404；旧revision已生成文件可在当前完整文档权限下读，不改变历史。

独立权限workspace.documents.export，生成/列举/下载同时需要read+export；manage不是隐式export。root登记权限、增量现有系统OWNER授权，不复活禁用权限/角色。所有成功/错误/private binary都private,no-store+nosniff，变更需原Origin/CSRF规则。部署启用只经可信server配置（建议严格AIJ_DOCUMENT_EXPORT_ENABLED=false、IMAGE_ID/DOCKER_CLI空，root在原runtime loader校验并映射，不从client/environment暗中默认打开），DI默认new DocumentExportExecutor()关闭；测试仅root显式提供实际已验证image/CLI。无Docker/配置或运行故障安全503，BUSY409/503择一固定文档化，不回显stderr/body/path。

路由统一在/client/document-exports，避开旧documents/:id静态路由竞争：GET /capability → {configured:boolean,canExport:boolean,reason:'ready'|'not_configured'|'not_permitted'}（需当前read，不泄CLI/image/secret）；POST / body精确{documentId,expectedRevision,format} → ExportMeta；GET /?documentId=uuid&revision=1..200 → {items:ExportMeta[]}（每版本最多2格式，拒未知query）；GET /:id → ExportMeta；GET /:id/content → 实际私有binary。ExportMeta精确{id,documentId,revision,format,mimeType,size,checksum,rendererVersion,pageCount,createdAt}，不回传主机/对象key或客户ownerId。content header: X-AIJ-Document-Id/Document-Revision/Export-Id/Checksum-Sha256/Renderer-Version，以及Content-Length/MIME/安全Content-Disposition，匹配实际字节；errors不含这些私有meta。

公共新增SDK personal-document-exports.ts，工厂createPersonalDocumentExportsClient(api:ClientApi)，方法capability(workspaceId),create(workspaceId,input,options?),list(workspaceId,{documentId,revision},options?),get(workspaceId,id,options?),download(workspaceId,expected:ExportMeta,options?)。返回精确验证shape/identity/revision/hash/format；未知success/网络/5xx为未知，不自动重试POST。download返回{bytes:Uint8Array,filename:string,mimeType:string,checksum:string}，必须实际fetch流有界<=5MiB、Content-Length/headers/expected metadata/全字节WebCrypto SHA256核对，失败清理reader/缓冲；不要JSON包装base64或fetch第二套凭据策略。为此Worker另给 client-binary-response.ts 有界Response读取helper，ROOT_WIRING请求root最小扩展原ClientApiOptions responseKind:'binary'/maxResponseBytes与原createClientApi内单一fetch transport分支，绝不copy成另一套transport，也不使旧JSON消费者失效。原index共享导出及类型由root接线；普通guarded ClientApi能透传这些options并在前后重验身份。生成可传有界较长signal（<=120秒含cleanup），不因原默认8秒假成功。小SDK ESM/CJS/strict types可自测，完整实包/API/HTTP/DB/Linux为root。

## AF203：当前文档的导出面板

新建ClientDocumentExportPanel与纯状态文件，复用现有AntD/adminTheme，注入API而不import未交付AF202源码。props固定scope（原DocumentScope）、document:{id,revision,name}|null、hasUnsavedChanges:boolean、api（上述structural interface）、onAccessFailure?；具体type从面板导出。root后续在原ClientDocumentManager当前文档详情中插入，传已保存revision并正确计算未保存草稿；root接actual publicSDK与原createDocumentAccess的当前范围前后验证。Worker只写新面板/状态/测试/ROOT_WIRING与candidate，不碰旧manager/library/access，避免共享Writer。

中文按钮“生成 Word”“生成 PDF”“读取已有导出”“下载”；配置空明确“待配置”，无export权限明确禁用；未保存修改提示先保存，不默默导出旧正文。生成只由显式动作触发、不自动POST，busy锁；网络/5xx/坏success/中途失焦结果未知时禁新生成，必须显式读取当前版本已有导出并单独确认后恢复，不能把尚未返回当失败重发。409保留当前界面并要求重读/合并，不覆盖草稿。读取/下载都经当前scope+document/revision+generation fencing，晚到旧返回丢弃；401/403/404清空本面板数据并交父级失效回调。Workspace/role/session/permission/document/revision变化、blur/真实hidden/unmount清空敏感RAM与objectURL并abort，下载返回后须仍属于当前范围才可发起浏览器下载，所有ObjectURL明确revoke。不将正文/filename/bytes写storage/URL/query/console/log。组件不获取/显示Docker路径/image/secrets等实现详情。

测试纯状态实际异步/未知结果/并发按钮/迟到跨scope/未保存/disabled/URL清理；默认DOM小测试不是浏览器。root正式接线生产Next、真实登录/CSRF/PG、当前文档导出与实际二进制/安装实包SDK、桌面/390/键盘/撤权/旧scope与清理。未实测OS保存对话框不声称已通过；UI按钮与API权限一致。当前附件/API链路验收不替代全40/AI章节生成/图表编辑/AF191原生14/负责人接收。
