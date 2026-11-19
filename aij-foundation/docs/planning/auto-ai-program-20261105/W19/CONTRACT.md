# W19 私有 Python Skill API 执行闭环

本波是个人私有单 Python 源文件的版本→原 Job→既有隔离容器→统一 JSON 附件→API/SDK 闭环。对应 executable Skill 的有限切片；不把提示词 Skill 当可执行包，不声称已交付 Agent 自动选工具、Agent 可执行绑定、通用工具权限/人工审批、多文件依赖、文件输入、图表/Word生成、公共/收费市场、组织共享、执行 UI 或完整编排。后续另卡保留，不删减完整40目标。用户允许普通用户上传脚本，公共/收费发布将来需审核；本波不开放发布。真实密钥/账号留空，厂商 DEFERRED_NOT_PASSED。

源唯一：已正式验证的 dev 4cfb95436d894f9145662ecbd79c2ea1075c417c；新注册 Orca WT 从 origin/dev 94b0236f775fa40a07944c5e0545ac6ce0e123f3 起步，再按 SOURCE_BOOTSTRAP 每 blob核对并单独 source-only 提交。不能复制 root 未提交 AF191/203/UI/playbook、env、node_modules、上传/数据、构建产物、migrations 或字体资源。root 独占共享 owner/schema/migrations/权限/module/配置/SDK index/registry/队列/状态及 DB/heavyBuild/Linux/GUI，各并发1；最多 root+3 Worker。候选按固定结构端口并行，正式接收 I209→I210→I211，代码依赖用真实已完成 I IDs；候选完成不等于 CODE_VERIFIED。

预算 AF208治理.75h，AF209 Sol high3.25h（Worker≤2/root1.25），AF210 Astra high4h（Worker≤2.5/root1.5），AF211 Sol high3.5h（Worker≤2/root1.5），共11.5h含验证/修复。单卡预测超4h先保留拆卡；禁止用略去拒绝路径凑通过。Worker只各自 allowPaths，小包/定向TS/单元/独立 frozen install/schema-only generate可做，不跑DB/seed/migrate/Docker/服务/GUI/全量API或Next构建/根 verify:task。没有 host Python 执行退路。

## 固定结构与安全规则

Scope={memberId,workspaceId} 从原 Guard，projectId 必须原实际 ProjectProfile.id；Claims=原 ClientClaims{sub,sessionId,tokenVersion} 只取原认证 Guard、不接收 DTO 自报；SessionGate=(tx:Prisma.TransactionClient)=>Promise<void> 由原 ClientAuthService.assertSessionInTransaction 关闭当前会话窗口。

ScriptRef 精确字段：{scriptVersionId:新UUID,skillId:原opaqueID,skillVersionId:原opaqueID,revision:1..2147483647,scriptDigest:lowerhex64,policyDigest:lowerhex64}。摘要 sha256 UTF8源码原字节；不 trim源码，不重新编码等价化改变摘要，不含 source/name/instructions/session。源码非空严格UTF8、无NUL，≤65536字节；一份Python文本，无zip/requirements/依赖安装。name/instructions沿原 Skill DTO边界，但严格拒getter/原型/未知/非有限字段。原 Skill始终唯一head/version/CAS/audit owner。

冻结策略的规范字节是 JSON.stringify({version:'aij-private-python-json-v1',language:'python',sourceBytes:65536,inputBytes:16384,outputBytes:65536,depth:16,entries:2048,timeoutMs:30000,network:'none',tools:[],attachments:[]})，字段顺序如上，无空白；policyDigest=其sha256。输入是有界严格 JSON 值，不是 JSON 文本字段，包含原始值 null/boolean/string/finite number/plain object/array；≤16384 UTF8字节、depth≤16（根depth0）、总对象键与数组元素≤2048。拒原型/getter/符号/undefined/BigInt/循环/危险键__proto__/constructor/prototype/孤立代理字符。对象排序 canonical（数组保持顺序），新请求 hash域 ['personal-script-v1',ScriptRef全部原始字段,inputCanonical]；原 Run等幂等域不改。输出 stdout 必须是恰好一个符合相同 JSON strict规则的完整文档（允许外层空白但无第二文档/非JSON前后缀），≤65536字节/depth16/entries2048；拒重复键/坏UTF8/非有限/危险键。stderr不交付、不落库/审计。允许源代码执行stdout仅通过原PythonSandboxRunner；源/input及内部Docker错误不进错误消息/日志/公开元数据。

ScriptArtifact 精确字段：{assetId:UUID,mimeType:'application/json',originalName:'script-'+runId+'.json',size:1..65536,checksum:lowerhex64,createdAt:ISO}。文件字节是严格验证后输出 JSON 的 UTF8 原始字节（允许原stdout外围空白），不得隐式另存正文。ScriptRun精确字段：{id:UUID,script:ScriptRef,jobId:UUID,jobStatus:原RuntimeJob.status字符串,outcome:null|ScriptOutcome,attempted:boolean,result:ScriptArtifact|null,createdAt:ISO,expiresAt:ISO}。ScriptOutcome是原runner有界outcome并扩展'DENIED'|'UNKNOWN'|'INVALID_OUTPUT'，SUCCESS只在cleanupConfirmed+当前lease/权限/source/session成立且附件同事务提交后写入。jobStatus只投影原Job，不再存/复制调度状态、队列、AI Trace/Run/费用账本；脚本不调用模型/secret/provider。GET不重新执行/入队/自动重试。内容保留7天，到期410/清除私有输入但保留幂等来源关系；恢复原key不能重做任务。

## AF209 版本owner组合

新 AiPersonalScriptSkillService（名字固定）及 dto/contract 文件；声明抽象 PersonalScriptSkillAccess：
- withCurrent<T>(scope,skillId,permissions:readonly string[],authorize:SessionGate|undefined,operation:(tx,current:ScriptSkillCurrent)=>Promise<T>):Promise<T>
- currentInTransaction(tx,scope,skillId,permissions,authorize?):Promise<ScriptSkillCurrent>
- appendVersionInTransaction(tx,current,content:{name,instructions,expectedRevision}):Promise<ScriptSkillCurrent>
ScriptSkillCurrent={projectId,skillId,skillVersionId,revision,name,instructions}。root在原 AiPersonalSkillsService 提供窄adapter，复用原scope、owned、snapshot、audit；append必须产生真实新head revision和真实新SkillVersion（即使name/instructions未变化），绝不后补代码到旧不可变版本。新Snapshot返回真实versionId。原snapshot/代码复用，不复制第二套head/version。所有权限为实际P.workspace代码，无伪alias。

公开固定：createVersion(member,workspace,raw:{skillId,expectedRevision,name,instructions,scriptSource},authorize?)→ScriptRef；readVersion(member,workspace,scriptVersionId,authorize?)→{ref:ScriptRef,scriptSource:string}；resolveInTransaction(tx,scope,scriptVersionId,authorize?)→{projectId,ref,scriptSource}用于执行；resolveForReadInTransaction同签名但只读权限。

create需 workspace.ai.assets.manage + 新workspace.ai.scripts.manage；readVersion需assets.read+scripts.manage（源码敏感）；运行resolve需assets.read+ai.execute+scripts.execute；结果read resolve需assets.read+ai.read+scripts.execute，不额外ai.execute。缺失DI安全503，不由客户端选read/execute mode，不能catch403降级。每个方法均验证生命周期/真实成员/owner/activeSkill/当前head revision与不可变SkillVersion/源码摘要/固定策略/原SessionGate；调用时head已修改或删则409/404，不偷偷取新源码。readVersion本波同样要求当前head，不宣称可回读全部历史源码。

createVersion先 CAS核对current.revision，再由原appendVersion生成新revision/version，然后新增 immutable public.ai_personal_script_version(id,project_id,workspace_id,member_id,skill_id,skill_version_id,revision,script_source,script_digest,policy_digest,created_at)。scopedFK精确原SkillVersion及实际project，unique(skill_version_id)、(id,project,workspace,member)；摘要/UTF8字节/计数检查，拒UPDATE/DELETE/TRUNCATE；append/version/extension/body-freeaudit同事务，审计失败回滚无孤儿。Worker raw SQL实现这张新增关系是 executable extension owner，root独占实际schema/迁移。root原Agent绑定/发布/preview/dispatch Skill resolver检测script-bearing版本并明确拒绝（本波未实现执行绑定），老prompt-only版本和旧Agentpin不变；不能把脚本忽略后当提示词执行成功。

锁序由root原owner保持：生命周期project/org/plugin→成员/grants→原Skill作用域advisory→Skill head/version→原SessionGate。运行期在成员/grants后原Job→scriptRun→原Skill同一锁序→session；发布附件最后，不持DB锁跨Docker/storageIO。

## AF210 原Job与sandbox执行

新增 AiPersonalScriptRunsService 与 AiPersonalScriptExecutionService、profile；可声明结构匹配的抽象 ScriptSkillRuntimePort 和 ScriptExecutionAuthPort，不能导入未完成A。root用useExisting原A/ClientAuthService或窄adapter。Skill端口匹配A.resolveInTransaction/resolveForReadInTransaction；认证端口匹配assertSessionInTransaction。只有受信任配置构造一个原 PythonSandboxRunner（默认disabled、CLI绝对固定、官方digest固定、maxConcurrency1每OS进程）；worker不改runner，不调用host Python。固定policyDigest由B自行按同一字节计算并核对，不信客户端策略；tools/attachments固定[]，network none。

Runs公开固定：submit(member,workspace,raw:{scriptVersionId,input,idempotencyKey},claims,correlationId?)→ScriptRun；read(member,workspace,runId,claims)→ScriptRun；recover(member,workspace,key,claims)→ScriptRun；content(member,workspace,runId,claims)→{meta:ScriptArtifact,bytes:Buffer}；capability(member,workspace,claims)→{configured:boolean,canExecute:boolean,reason:'ready'|'not_configured'|'not_permitted'}，只做就绪检查，不跑Docker/脚本/secret。新配置不从DTO接收，execution服务constructor选DI配置/runner；root提供生产默认off与测试真实固定CLI/image配置，不在worker访问真实env。

最小 public.ai_personal_script_run 存{id,project_id,workspace_id,member_id,script_version_id,skill_ref JSONB,request_key,request_hash,input JSONB,session_id,token_version,job_id,attempted_at,outcome nullable,output_asset_id nullable,created_at,expires_at,content_purged_at}。job_id unique+scopedFK原RuntimeJob、原session/member、script版本/ref及原FileAsset范围引用，requestKey在project/workspace/member域唯一。该关系仅脚本输入/来源/结果，无job调度状态、model费用等副本；worker给root精确SQL/Prisma建议，raw SQL实现新关系，schema/migrationroot接。source version/ref/member/workspace/job/session/request identity不可变，允许受限attempt/outcome/result/expiry保留期更新；不把script执行创建成AiAgentRun。入队type固定'aij-ai.personal-script-execute' version1、payload仅{runId}、scope原plugin/project+workspace、maxAttempts1、timeout不小于container30s+固定control/cleanup余量（例如120s）。注册使用原 registerOrchestratedJob，不新造调度器。不要在constructor自动注册root模块将注册两次；execution服务onModuleInit可唯一register。

submit同TX生命周期/成员/执行权限→幂等advisory→A当前Skill/ref/session→同hashreplay原run（不重做）或create一关系+原jobs.enqueueInTransaction+无正文audit，任一步失败全rollback。输入/版本不同同key409，作用域隔离。disabled不能创建Job（预先检查配置且事务内不依赖caller），configured不等于账户额度或script成功。

execute接受原JobHandler job（原id/leaseOwner/leaseNonce/attempt/signal），原Job持有新鲜nonce与clock_timestamp实际租约锁，在Job→scriptRun锁下核对关联scope/payload/type/deleted/attempt、当前A+原启动session/权限。实际调用runner前同TX持久attempted_at；一旦存在，即使手动把原Job重排/同owner新nonce，也禁止第二次调用容器。未知/cleanupUnconfirmed永不自动再执行；有效当前lease可记录UNKNOWN且无输出，stale lease不能改结果/audit。原调度器renewal/aborts继续用原signal，不自己造lease判定。锁以clock_timestamp实时时间核验，不用进程时间代替SQL租约真值。

没有DB锁跨Docker或附件IO。执行前短事务→runner.run({script,inputJson:canonical,timeoutMs:30000,signal})→无锁严格检查stdout/cleanup→短事务再检查当前lease/原启动session/head/ref/生命周期/权限→stage原附件（无锁）→最终短事务再核验全部并commitFile+关系outcome/asset+audit同TX→confirm。如果stage前后失效不发布结果，安全discard；提交返回未知先精确readback/原ticket discard保留已提交，不能盲删已提交FileAsset、重跑或谎称无任务。错误只固定有界code；不得把stderr/source/input或Docker路径进resultReference/audit/Job error。

统一附件必须原GeneratedFileAssetsService.stage/commitInTransaction/confirm/discard/readInTransaction（当前仅PDF/DOCX），root明确新增严格JSON format/mime/name/byte/depth/finite/duplicate校验并保持原PDF/DOCX验证，不绕过或复制storage owner。B可用结构匹配的抽象 ScriptGeneratedFilesPort，ticket只内部opaque，禁止序列化/跨实例伪造。API结果下载对用户只release metadata和有界bytes，前后短事务校验当前读取session/权限/head/ref，允许新的同owner查询会话，运行必须原启动session。File readInTransaction当前内部storageIO行为要给出精确root请求，使调用不持授权锁跨IO；不能用一个长事务包container/storage。安全清理不因源/会话已撤销而跳过，仍按原所有权保护。

真实root验收必须原JobService.claim/execute + fresh PG + 已批准固定官方Python镜像Linux内核容器，真实输出附件下载sha256；两连接同key一Job，source/owner/grants/session/nonce/实际过期/IO间变化/auditrollback/attemptedAt未知不重跑与附件提交未知readback。复用原AF175真实 noNetwork/noMount/noCredentials/资源/OOM/PIDs/timeout/output/abort/ownedcleanup断言，记录Linux内核/arch/UID/cgroup限制；容器不等于整机Linux部署已验收。VM/资源不可用就失败/拆卡，不改成spawn mock PASS。

## AF211 HTTP和公共SDK

独立prefix /client/script-executions，原WorkspaceContextGuard/ClientAuthGuard，元数据统一响应包装；七方法（含capability）固定：
- POST /versions body精确{skillId,expectedRevision,name,instructions,scriptSource}→ScriptRef，201；assets.manage+scripts.manage
- GET /versions/:id→{ref,scriptSource}；assets.read+scripts.manage
- GET /capability→B capability；assets.read（无ai.execute时configured照实canExecutefalse，不错误引导配置）
- POST /runs body精确{scriptVersionId,input,idempotencyKey}→ScriptRun，201；assets.read+ai.execute+scripts.execute，disabled503
- GET /requests/:key、GET /runs/:id→ScriptRun；assets.read+ai.read+scripts.execute
- GET /runs/:id/content→JSON原始字节附件；同读取权限，Content-Type application/json，Content-Length、Content-Disposition attachment; filename="script-UUID.json"、X-AIJ-Script-Run-Id、X-AIJ-Script-Version-Id、X-AIJ-Asset-Id、X-AIJ-Checksum-SHA256，private,no-store+nosniff。

服务端只认固定真实Guard会话与scope并前后验证，不接受calleractor/workspace/session/工具/secretref。所有GET空body/query；JSON-only UTF8 POST严拒重复键/危险键/getter/坏Unicode/非有限/超限，错误头也private/no-store/nosniff，不回显源码输入，保留原bootstrap其他prefix/rawBody/CORS/限制；root新增本prefix的早期hook/媒体验证，不把multipart或原生选文件声称已完成。最大含source body允许原100kb限界并测Unicode膨胀413。版本源码后端保存及SDK传输是file-content upload API，不是原生picker UI。

Worker新controller声明 ScriptExecutionAssetsPort（A.createVersion/readVersion）与 ScriptExecutionRunsPort（B.submit/read/recover/content/capability），签名按上文；rootuseExisting绑定真实owner。原config注入/ClientAuthService.sessionGate可照现有workflow controller，不导入未集成candidate。失DI安全503，不伪造描述符成功。

SDK createPersonalScriptExecutionClient(api:ClientApi)，七方法 createVersion(workspace,input,options?)、version(workspace,id,options?)、capability(workspace,options?)、submit(workspace,input,options?)、recover(workspace,key,options?)、read(workspace,id,options?)、download(workspace,expectedRun:ScriptRun,options?)。options仅{signal?:AbortSignal}。全部用原ClientApi单次fetch/credentials include/no-store/workspace，binary用原responseKind:'binary'/maxResponseBytes65536，不另建fetch；JSON metadata/source/ref/provenance/counter/digest/ISO/jobStatus/outcome/result consistency严格验证。download必须比对run/version/asset/header/name/长度/mime/checksum、成功cleanup/outcome和source对应；失败、取消或哈希不一致将临时bytes清零，不落storage/log、不createObjectURL。未知提交不自动重试，显式GET原key恢复；导出源码方法明确私有，不放URL/log/source编码，只有ID到URL。

root正式验收必须仓库外APFS实际tarball安装ESM/CJS/strictMTS+CTS，真实原ClientApi七方法+校验下载；server实际已提交响应丢失只有一POST+GET恢复，同key并发唯一Job；allprivacy/parser/作用域/会话/晚撤权/retention/disabled拒绝；原prompt Skill/Agent/Job/File/doc-export回归、API/SDK build/types/lint/精确guard/verify:task。本波无执行网页，无AF191/203环境需求；它们后续按新依赖重新冻结重跑，原失败与用户改动保留。每worker原名candidate commit、STOP ALL WRITING和实际IDs/测试exit/用时/ROOT_WIRING交接。root验收、本地原名提交读回后才完成I，无push/PR/main/deploy/publish。
