# W24 章节生成来源、原运行时与公共API契约

负责人：“已经验收完成，请自动开启下一批，快速完成所有的开发工作”。W22验收记录保持，W23仍OWNER_CHECK_PENDING；本批自动接续仅本地有限开发，未赋予未来人工验收、push/main、远端Issue/PR、发布部署、付费模型/存储/短信/支付调用权限。原40项总体目标与历史失败不改为通过。本批只做后端及公共SDK闭环，生成预览/确认写回页面另批。

## 边界与真实任务

AF226治理1.25h（含已完成只读规划0.5h、总控0.75h）；AF227文档事务源门3.25h、AF228原运行时绑定3.75h、AF229 API与SDK3.75h，共4卡12有效工程小时。三名候选Writer各<=1.5h，余量归各卡总控集成；有效工时包括失败修复。预测单卡>4h或总批>12h保留失败和成果拆卡，不伪造完成。真实Task/依赖见CARDS.json；C227/228/229互不等待候选文件，注入端口冻结；总控I227→I228→I229，只有正式PASS及原名本地提交才能完成I，下游引用真实I ID。模型沿用户当前默认，不指定或切换模型。

Worker从已核验origin/dev新注册Orca child创建，先报真实Task/Dispatch/Worktree/terminal/分支/初始HEAD/remote/status。源码来自SOURCE_BOOTSTRAP.json记录的1085个冻结Git blobs，起始SHA及清单hash见各spec。source-only bootstrap独立提交；仅自有allowPaths候选提交，无共享文件/registry/正式队列/依赖锁/实际schema/migration写入。独立node_modules，无凭据、上传目录或源产品复制。只允许离线单元、小包构建与类型检查；数据库、应用服务、Docker/Linux renderer、native、全API/Next构建由root独占，各并发1。候选完成需明确STOP ALL WRITING；非零默认失败，NOT_RUN不冒充通过。root须实际verify:task、当前成功与拒绝路径、适用质量门禁、来源diff审查、记录和精确本地提交。不同候选不能互相导入未来文件；相同结构类型可分别声明，root在最后接线验证兼容。

## 来源与原owner

文档唯一owner仍PersonalDocumentsService；章节唯一解析器buildPersonalDocumentSectionIndex（W23）。事务内必须按原project/plugin/current membership/permission→文档命名空间锁→原owner文档行FOR UPDATE→ClientAuthService当前session→Memory/Agent→原预算顺序。调用者传同一Prisma.TransactionClient；禁止先GET后另开事务、复刻授权SQL、复用带documents.export的withCurrentDocument，或使用客户端自报workspace/project/member。运行持有原Job→Run的顺序后，再取文档与Agent来源。原AiCenterRunService唯一Run/Job/Trace/reserve/settle/unknown及保留期owner，不新增执行器、成本/请求状态账本，不借用workflow publication。

所有新读需要workspace.documents.read、workspace.ai.read、workspace.ai.assets.read；新执行额外documents.manage、ai.execute。read不要求documents.export/manage，原Agent/model/Skill/Memory权限与当前发布检查保留。会话检查必须调用原ClientAuthService.assertSessionInTransaction(tx,claims)，真时钟与原锁；调度及IO前后验证原提交session，用户新读/查回验证此次请求的新session。

## 冻结结构

所有传输对象必须plain/null-prototype data object；拒绝getter/setter、符号/隐藏属性、额外键、数组冒充对象、污染键，勿回显原文/指令/密钥。引用返回新对象并冻结，输入不得变异。字符串UTF16长度/UTF8 SHA均不归一化、不截断。

DocumentSectionSelector精确4键：{documentId, expectedRevision, bodySha256, sectionId}。documentId沿原canonical UUID校验；expectedRevision整数1..200；bodySha256小写64hex；sectionId为section-0..section-127（无前导零）。
DocumentSectionRef精确9键：{format:'aij-document-section-source-v1',indexFormat:'aij-plain-sections-v1',documentId,revision,bodySha256,sectionId,start,end,sectionSha256}。start/end是原正文UTF16偏移，0<=start<end，<=65536，sectionSha256为完整slice的UTF8 SHA256。整个当前body/index由原解析器校验，当前原doc/revision/bodyhash/id/section一致；完整所选slice必须非空非blank且<=2000 UTF16（原Agent单字段上限），包括标题与换行，不可截断。超长/空来源400；有效selector与当前revision/bodyhash/section不一致409；不存在/外属/删除沿原owner404。权限/来源变化不能输出原文。

AF227纯文件导出parseDocumentSectionSelector(raw)、parseDocumentSectionRef(raw)、buildPersonalDocumentRunSource({id,revision,body},selector)，末者返回{ref:DocumentSectionRef,text:string}。允许无原型数据，返回脱离输入的冻结ref。解析ref只结构验证；完整body重算是builder职责，不能把客户端ref当可信。

DocumentGenerationRef精确12键：{format:'aij-document-generation-v1',document:DocumentSectionRef,agentId,agentVersionId,agentRevision,agentPublicationEpoch,catalogVersion,modelCode,modelRevision,instructionSha256,inputSha256,maximumEstimatedCostNanos}。agentId必须符合原PERSONAL_AGENT_NAMESPACE的canonical小写UUIDv4；agentVersionId是原owner opaque 1..128字符A-Za-z0-9_-。modelCode沿原DTO正则^[a-z][a-z0-9-]{1,62}$。catalogVersion/modelRevision/agentRevision/agentPublicationEpoch均整数1..2147483647。maximumEstimatedCostNanos canonical非负十进制字符串，<=9223372036854775807，费用估计为原预算owner上限，不是销售价格。instruction非blank且<=2000 UTF16（不trim改写）；instructionSha256对raw instruction UTF8。inputSha256对JSON.stringify([['instruction',redactAiExternalText(instruction)],['source',redactAiExternalText(sourceText)]]) UTF8 sha；redaction仅调用现有deepseek-provider owner函数，不复制策略。原Run.input仍由原submit路径存储redacted的恰好{source,instruction}，原source全文与raw instruction不另存。source/document hash引用真实未归一化文档。

makeDocumentGenerationOrigin(resolved:{ref,text},snapshot,instruction,maximumEstimatedCostNanos,catalogVersion:number)返回{ref:DocumentGenerationRef,input:{source:string,instruction:string}}；input保留raw两字段，供原owner一次redact。snapshot必须当前personal已发布、model.capability=text且agent.outputFormat=text的Agent，agent.inputFields集合恰为source/instruction（顺序不限、不能重复），禁止image/hybrid workflow来源。agentCode为personal:<agentId>；其实际source版本、revision/publicationVersion及catalog/model匹配，cost由调用者传原估计值。documentGenerationRequestHash(ref,rawInstruction)为SHA256(JSON.stringify(['personal-document-generation-v1',canonicalValidatedRef,rawInstruction]))；ref所有键按上述固定顺序重新创建，document也固定顺序。不同raw instruction即便redaction相同也不能重用同key。

## AF227 root接线（Worker不得写）

在原PersonalDocumentsService抽取内部scopeInTransaction复用原SQL和锁，旧CRUD行为不变；公开内部端口resolveGenerationSourceInTransaction(tx,scope,selector,purpose,authorize)和inspectGenerationSourceInTransaction(tx,scope,selector,authorize)。scope={projectId,workspaceId,memberId}由服务器构造；purpose只能read/execute；authorize为必需的(tx)=>Promise<void>并必须在同tx文档锁之后运行。resolve返回{projectId,ref,text}，inspect返回{projectId,documentCurrent:boolean}且不返回text；inspect需当前read权限/nondeleted原文档/新session，来源变更只返false（不对已经变更的新body先跑旧selector），失权仍拒绝。DocumentsModule仅向原AI组合导出此service，不能依赖AI产生循环。

root独写AiPersonalDocumentRunOrigin Prisma模型及一个additive迁移，候选只交DDL建议。表public.ai_personal_document_run_origin：run_id text PK，project_id/workspace_id/member_id text；document_id uuid、document_revision int1..200；agent_id/agent_version_id text、agent_revision int；ref jsonb（完整GenerationRef）；session_id text、token_version int>=0、created_at timestamptz。真实FK分别绑定原Run(id,projectId,workspaceId,memberId)、原Doc(id,workspaceId,memberId)、原DocVersion(documentId,revision)、AgentVersion(id,agentId,workspaceId,memberId,revision)、原ClientAuthSession(id,memberId)，RESTRICT，无另造账本。JSON身份列一致性CHECK、insert trigger检查已存在原Run.snapshot.source.documentOrigin与原personal Agent provenance/inputDigest精确一致，workflow混合拒绝。更新/删除/截断55000拒绝，跨scope/orphan插入拒绝；原7天purge input/output/snapshot后此元数据关系仍在，原Run不能被误认作无来源legacy。

root仅在受保护55433新逻辑验收库逐卡串行migrate/seed和真实测试。现有3955/3956/55435自有本地环境保留原数据；migration源文件会影响原readiness，root在已验证additive迁移之后，依原CLI对已核验本项目独占local profile受控维护，迁移前后核对原文档/版本/导出与行digest，不reset、不换库伪装保留。若原CLI拒绝既有profile迁移/授权边界无法落实，应记录阻塞并保持旧可用输出，不绕过保护、不动共享或正式库。本批无UI换版承诺。

## AF228 frozen injected ports与原owner接线

Worker仅新建ai-personal-document-run-origin.service.ts及单元。独立声明结构类型与以下abstract DI ports，不导入AF227未来文件：
- DocumentSourceRuntimePort.resolveInTransaction(tx,scope,selector,purpose:'read'|'execute',authorize:SessionGate) -> Promise<{projectId,ref:DocumentSectionRef,text}>。
- DocumentSourceRuntimePort.inspectInTransaction(tx,scope,selector,authorize:SessionGate) -> Promise<{projectId,documentCurrent:boolean}>。
- DocumentGenerationSessionPort.assertSessionInTransaction(tx,claims:ClientClaims) -> Promise<void>。
- PersonalDocumentRunOriginPort（由AiPersonalDocumentRunOriginService实现）：resolveSource(tx,scope,selector,claims,purpose)->Promise<{ref,text}>；recordOrigin(tx,run,ref,claims)->Promise<void>；relation(tx,run)->Promise<OriginRow|undefined>；assertOriginCurrent(tx,run,readClaims?:ClientClaims)->Promise<void>；inspectOrigin(tx,run,claims)->Promise<{origin:DocumentGenerationRef,documentCurrent:boolean}>。
run结构至少{id,projectId,workspaceId,memberId,snapshot:unknown,input:unknown,contentPurgedAt?:Date|null}。row SELECT byrunID first，任何scope mismatch拒绝；不让错scope关系看成legacy。
root用薄adapter将DocumentSourceRuntimePort绑定原AF227service，session port useExisting原ClientAuthService。缺port必须503，authorize回调必须在相同tx实际被调用；不得缺省成功。recordOrigin只用已在同TX源门验证的ref及Run，不重新按错误顺序锁Agent/document，仅INSERT+不含正文的小audit，验证snapshot marker、Agent/模型身份、原redacted inputDigest和ref身份。assertOriginCurrent：marker或关系任一存在必须两者齐全一致（无来源legacy可noop），解析row identity/ref/session并调用原doc源门及当前session；原execute使用row.session/token，readClaims存在时使用此次新session和read目的。重算raw source哈希/红action source与原run.input source/inputDigest，instruction只验证已存redacted输入的digest，不反推已清理raw instruction。Agent/Memory current检查由原runtime随后完成，此port不锁Agent。
inspectOrigin为metadata恢复：新session与当前原doc.read必需，documentCurrent仅来源是否还匹配；仍在保留期必须marker+row匹配。仅contentPurgedAt真实非空时，允许权威row在snapshot/input已清空后提供元数据；混合/不一致marker拒绝。inspect不输出模型结果或原文。

root独占修改原AiCenterRunService/provenance/module：在原PersonalAgentProvenance加入可选documentOrigin，constructor可选port加到末尾保持旧构造调用。新方法统一(memberId:string,workspaceId:string,bodyOrId:unknown,claims:ClientClaims,correlationId?:string)：previewDocumentGeneration、submitDocumentGeneration、readDocumentGeneration、recoverDocumentGeneration；body/readId/recoveryKey由C严格解析后传但原owner仍核验。preview返回下述安全wire字段，submit/read返回{run,origin}，recover返回{request,origin,documentCurrent}。

preview在原事务当前doc+session→当前Agent/Memory/model/catalog→原估计，不Run/Job/reserve/upstream写。提交仍只复用原submitSource reservation/enqueue/Runcreate一次；新doc输入在同一admission tx由owner取原body产生。重算完整GenerationRef与body.origin全等，包括max费用；preview不是授权凭证。幂等key域包含完整ref/raw指令，重试既有Run需来源及新session仍有效；冲突409且不二次reserve/enqueue。原Job→Run→Doc→Memory/Agent顺序、原凭据检查/nonce/原budget事务保留。

原validateSnapshot中doc来源先当前doc+原会话验证，再原Memory/Agent/catalog；验证后仅删除documentOrigin这一已知extension，其他未知字段必须继续deep comparison拒绝。原调度、IO前、IO后均经过原来源/会话/nonce；未尝试失效走原failed+release，已尝试变更走原unknown+reserved且不返回结果，禁止重放HTTP/provider。新read在原internal read/reconcile前后均当前fresh session/doc/ref/Agent/model/Memory；不能以terminal成功绕过当前来源。purged full read410，metadata recover仍可只读查原key，不自动重提；documentCurrent false不能理解为可读输出。原generic run/key/image接口按marker OR durable关系拒绝doc来源，即使marker被purge或新port不可用也不能回退legacy。

## AF229 transport与公共SDK

API独立新Controller+Service+DTO；C不实现runtime/Prisma/预算，不导入AF228未来文件，只声明abstract DocumentGenerationRunDriver，四方法签名与上述原owner一致；root useExisting原AiCenterRunService。Service调用driver一次并安全投影wire；不输出snapshot/session/input/trace/private字段。Controller沿WorkspaceContextGuard、原session和权限decorators、NoStoreGuard；workspace/project/member绝不从body取。root另接原bootstrap在auth/错误之前private noStore路由及严格JSON（含重复key/proto拒绝），不得仅成功响应带private header。

POST /client/ai/document-generations/preview，精确body={documentId,expectedRevision,bodySha256,sectionId,agentId,agentRevision,instruction}，返回{origin:GenerationRef,inputFields:['source','instruction'],modelExecutionConfigured:boolean}。preview是private POST，指令不得进入URL；modelExecutionConfigured仅配置事实，不执行供应商。
POST /client/ai/document-generations，精确body={origin:GenerationRef,instruction,idempotencyKey}，返回{run,origin}。
GET /client/ai/document-generation-runs/:id，无query，返回{run,origin}。
GET /client/ai/document-generation-requests/:key，无query，返回{request,origin,documentCurrent:boolean}，只恢复原key元数据，不含output、不自动重放。

run精确10字段：id,agentCode,status,output,failureCode,estimatedCostNanos,budgetStatus,imageAssetId,createdAt,expiresAt；沿原AiAgentRun状态与字段约束，imageAssetId固定null，succeeded output必须是原text输出字符串（原provider.invoke在outputFormat=text时直接返回redacted字符串），其余状态输出为null；text<=64000 UTF16。request精确7字段：id,agentCode,status,budgetStatus,createdAt,expiresAt,contentAvailable；匹配原恢复owner语义。wire日期canonical ISO；原driver内部Date允许由C明确转换，wire SDK只接受ISO。ref Agent与run.agentCode一致。idempotencyKey沿原opaque8..128 [A-Za-z0-9_-]，runId为opaque1..128。HTTP失败保留原状态和安全消息，schema/原型/额外字段拒绝无输入回显。

SDK新personal-document-generation.ts，导出createPersonalDocumentGenerationClient(api)和必要wire类型；.preview(workspaceId,body,signal?)、.submit(...)、.read(workspaceId,id,signal?)、.recover(workspaceId,key,signal?)。每个恰好原api一次请求，无retry/poll/cache/storage，signal传播；严格校验请求与wire完整结果，跨scope/header沿原api。复用现有api类型/错误语义，安全TypeError。root独占public index导出，不让worker改共享barrel。

## 真实验收与交付

AF227 root：当前原owner caller TX rollback、同tx session callback、read无export/manage可用、执行需manage、原project/plugin/role/grant/revision/删除并发拒绝、whole source边界、真实fresh PG additive/FK/immutability结构，原文档CRUD/history/export回归。此卡无Run执行完成承诺。
AF228 root：两实例/连接同key只一Run/Job/reserve，真实loopback original provider唯一Trace/cost与response；源门/入队/预留/插关系中途fault全回滚；queued来源/会话撤销无upstream并释放，IO后source/session/nonce变化unknown/reserved且结果拒绝；session fresh读/metadata查回、保留期legacy投影拒绝、真实Run的FK错scope与immutable拒绝；原workflow/Agent/text/image/runtime回归。模型只本地可计数loopback，不调用付费服务。
AF229 root：真实原HTTP/private noStore/严格JSON/Guard/PG/runtime及公共SDK提交/预览/读/丢回复查原key，preview零Run/Job/reserve/upstream；篡改/过期ref/费用/失权/外属拒绝；真实outside freshly packed ESM/CJS、NodeNext import/require与浏览器消费者，原通用运行未退化。UI/native生成预览另批，不伪称本批有页面。

所有真实证据与失败/NOT_RUN保留；report PASS才精确原标题本地提交，I Task回读实际SHA后完成；无push。不包含客户/论文原型材料或密钥。退出状态OWNER_CHECK_PENDING，后续自动续批遵负责人已授权范围，人工接收独立记录。
