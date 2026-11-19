# W18 私有工作流发布与原运行账本执行

本波只交付个人 start→一个已发布私有Agent→end 的发布与API/SDK手动执行闭环。不是多Agent调度、参数映射、分支/并行/循环/审批、脚本或五类触发完成。复杂旧草稿原样保留，发布拒绝400，不能删节点降级。全40保持NOT_RUN_TARGET_ACCEPTANCE，厂商DEFERRED_NOT_PASSED，真实账号/密钥空，Owner接收独立。下游LINEAR-MULTI、SCRIPT-PRIVATE及执行页面另卡。

来源唯一已验证commit 2ee9172a30be7694dc2cb097a43fbce1f0a14e65；origin/dev 94b0236f775fa40a07944c5e0545ac6ce0e123f3。AF203未验收原生UI及AF191原样保留，不进bootstrap，不作为CODE依赖。实际CODE依赖I161 task_5731129d1d35、I170 task_5943982f67fa、I189 task_47a05b50c759均completed。候选按下面固定接口并行，root实际I205→I206→I207串行集成。Root独占schema/migrations、既有owner窄接线、权限、模块、SDK index、registry、DB/build。若此时AF203仍待原生环境，共享变更须保留其全部差异；未来AF203需按已验证新依赖重新冻结并重跑，绝不复写失败历史或默认通过。

预算：AF204治理.75h；AF205 Sol high 3.25h（Worker≤2h/root预留1.25）；AF206 Astra high 4h（Worker≤2.5/root1.5）；AF207 Sol high 3.75h（Worker≤2.25/root1.5），共11.75h含修复/验证，单卡超4h保留拆卡。最多root+3Agent，DB/heavyBuild/Linux/nativeGUI各1。Worker不跑DB/Docker/server/全量API或Next构建；各自独立deps，允许frozen install/schema-only generate/小包build/定向TS与小协作者测试。普通用户未获授权不得借工作流抬高Agent/模型/工具权限。

## 固定数据与端口

Scope={memberId,workspaceId}只取Guard/currentserver，projectId取实际ProjectProfile.id，不用runtime配置slug。Claims=原ClientClaims{sub,sessionId,tokenVersion}仅原Guard验证后传服务，不在DTO，namespace由原认证owner配置。SessionGate=(tx:Prisma.TransactionClient)=>Promise<void>，C每次HTTP操作都供原ClientAuthService.assertSessionInTransaction(tx,claims)闭包；运行期用原认证owner复检已记录的原会话。无嵌套事务跑授权，无锁跨secret/provider/storage IO。

WorkflowRef精确公开字段：{id:publication UUID,workflowId,workflowVersionId,revision:1..2147483647,graphDigest:lowerhex64,publicationEpoch:1..2147483647,nodeId,agentId,agentVersionId,agentRevision:1..2147483647,agentPublicationEpoch:1..2147483647}。既有资产ID遵原验证器（不要臆定cuid/UUID列类型），publicationId为新UUID；ref不含graph正文、instructions/Skill/Memory、session、主机/凭据。Ref全部原始值的只读副本，不用caller snapshot。JSON DTO拒未知key/原型/getter/重复键/非有限与越界数，错误固定不回显入参。

PublicationMetadata={workflowId,revision,publishedRevision:number|null,publicationEpoch:0..2147483647,publication:WorkflowRef|null,dependencyReadiness:{ready:boolean,reason:'ready'|'not_published'|'revision_changed'|'dependencies_unavailable'|'validator_unavailable'}}。未发布publication=null；已发布但head/Agent依赖变更显示不ready，不写历史或换pin。A可按实际边界返回对应精确shape，须自测与本文一致。

RunEnvelope={run:原AiAgentRunResult的JSON投影,origin:WorkflowRef}。RecoveryEnvelope={request:{id,agentCode,status,budgetStatus,createdAt,expiresAt,contentAvailable},origin:WorkflowRef}；日期HTTP为ISO。不复制Run/Job/Trace/cost/status到workflow表。GET不enqueue/reserve/调用provider；原read原有reconcile语义保留且当前范围前后重验。

Preview={publication:WorkflowRef,inputFields:string[],maximumEstimatedCostNanos:decimalString,modelExecutionConfigured:boolean}，复用原AiPersonalAgentRunPreviewsService（只读，无reserve/secret resolution/transport），前后复检workflow及session。configured不是可获准执行/余额承诺，凭据缺失仍待配置，不伪造成功。

A、B、C各自定义匹配上述结构的类型/abstract DI port即可，不能import未完成的其他候选；root用useExisting/真实adapter接同一个owner，类型结构重复不等于新真值。

## AF205：严格单Agent发布快照

新增ai-personal-workflow-linear-contract.ts，调用原validateWorkflowGraph，要求恰好3nodes/2edges，唯一start、agent、end，连接start next→agent in、agent next→end in；无参数变换；graph.inputKeys与该Agent当前已发布版本inputFields集合相同。原graph canonical/digest/绑定约束继续有效。返回有界只读编译计划，顺序/无关对象key变化不改变原canonical truth。

新增AiPersonalWorkflowPublicationService（class名字固定）及DTO，实际实现publish/unpublish/read/resolveInTransaction，原图/版本owner不迁移。使用本文件定义的abstract PersonalWorkflowPublicationAccess（定义在新service文件内）：
- withCurrent<T>(scope:Scope,workflowId:string,permissions:readonly string[],authorize:SessionGate|undefined,operation:(tx,current:WorkflowPublicationCurrent)=>Promise<T>):Promise<T>
- currentInTransaction(tx,scope,workflowId,permissions,authorize?):Promise<WorkflowPublicationCurrent>
current精确语义={projectId,workflowId,revision,workflowVersionId,graphDigest,graph:unknown,agentBindings:{nodeId,agentId,revision,agentVersionId}[],catalog:{version,catalog:AiCenterCatalog}}，root在原AiPersonalWorkflowsService上加窄内部方法/adapter，复用scope/owned/version/pin真实性；对草稿CRUD不增加AI配置前提。publication调用的catalog配置共享锁在workflow锁之前；runtime已持有该配置锁，重复读取不得重排新锁。原项目/组织/插件/成员/授权已验证且相关锁直到事务结束。

service公开方法固定：read(member,workspace,workflowId,authorize?)→Metadata；publish(member,workspace,raw:{workflowId,expectedRevision,expectedPublicationEpoch},authorize?)→Metadata；unpublish(member,workspace,workflowId,raw:{expectedRevision,expectedPublicationEpoch},authorize?)→Metadata；resolveInTransaction(tx,scope,publicationId,authorize?)→{projectId,ref:WorkflowRef,inputFields:string[]}。read需ai.assets.read；publish/unpublish需ai.assets.manage+新workspace.ai.workflows.publish；运行resolve需ai.assets.read+ai.execute+新workspace.ai.workflows.execute。root注册精确定义、仅active系统OWNER增量授权，不复活禁用定义/软删grant。

发布用原AiPersonalAgentSnapshotsService.resolve(tx,current,member,workspace,pinnedAgentId,pinnedRevision)核验当前发布Agent/模型/Skill依赖。旧历史pin不等于当前已发布版本时409，不替换pin。新pub包含精确workflow version/graphDigest/node/Agent version与Agent publication epoch。相同当前epoch+同一ref发布为no-op，复用同pubId不重复audit。真实变更发布/撤销用head revision+publication epoch CAS并advance epoch；maxInt拒绝；撤销后同revision再发布产生新epoch，防ABA。草稿更新使旧pub与head revision不等而不可执行，旧定义/版本不改。相同CAS旧参数重放不自动视为新发布。

root新增原workflow head published_revision nullable/publication_epoch default0及immutable ai_personal_workflow_publication关系。publication不是运行表：只有ref、project/workspace/member、createdAt；scoped FK至原Workflow/Version/AgentVersion/binding，unique(workflowId,epoch)、UUID与计数/摘要约束，拒UPDATE/DELETE/TRUNCATE。publish/head/audit同事务，audit失败全部rollback，不留成功pub。Worker在ROOT_WIRING给精确SQL/Prisma建议，不写schema/migration。

重要：resolveInTransaction用于运行，只锁/验证当前workflow publication/version/binding，并返回冻结ref；不要在这个runtime前置方法提前锁Agent/Memory或调用snapshot resolver。Agent当前性由原Run owner在其既有Memory→Agent顺序解析，B核对ref与解析快照。read/publish可以验证Agent但不拿Memory锁。新abstract port缺失安全503，不用mock descriptor充当实现。

## AF206：来源关系与原Run owner组合

新增AiPersonalWorkflowRunOriginService及AiPersonalWorkflowRunsService，端口/必要类型在各自文件声明，Worker不改ai-center-run.service.ts。Root精确接入：
1 原AiCenterRunService新增server内部submitWorkflow(member,workspace,raw:{publicationId,input,idempotencyKey},claims:ClientClaims,correlationId?)；保留submit/submitPersonal旧requestHash与结果格式逐字行为。新入口在原submitSource事务中通过origin port.resolveOrigin加载当前pub；input按原规则验证，所有graph keys等于原Agent inputFields，无transform。
2 新hash域['personal-workflow-v1',publicationId,workflowVersionId,publicationEpoch,graphDigest,nodeId,agentId,agentVersionId,agentRevision,agentPublicationEpoch,sortedInput]；原project/workspace/member/idempotencyKey唯一域不变，不alias旧catalog/personal或其他workflow。先当前权限/session/pub，再幂等锁/ref，existing只在同hash返回原Run，冲突409；不自动POST重试。
3 原snapshot.source增加且仅增加已知workflowOrigin:WorkflowRef标记（session信息不在marker）；原source type仍personal。snapshot中原Memory/Skill来源不变。新Run、原budget.reserve、原Job enqueue maxAttempts1、immutable origin relation+无正文audit在同一事务。B.recordOrigin核对实际解析snapshot.source.version/revision/publicationVersion与Ref一致，不许仅相信caller Ref。
4 Root在原执行三阶段（dispatch首次Trace/凭据前，credential IO后/provider入口前，provider/storage IO后/settlement前）调用assertOriginCurrent(tx,run)，在原Job/Run租约锁之后、原Memory/Agent锁之前；之后原validateSnapshot继续检查Agent/Skill/Memory。只有验证known workflowOrigin成功后，原deep-equality比较才去掉这一已知扩展；未知扩展仍拒绝。标记存在但port/row缺失或任何来源不一致均fail closed，不能降级直接Agent执行。legacy无标记+无origin关系的路径/旧hash/费用和Job/Trace规则保持不变。

B固定runtime port（可在run-origin文件定义abstract PersonalWorkflowRunOriginPort，root original owner注入同一个service）：
resolveOrigin(tx,scope:{projectId,memberId,workspaceId},publicationId,claims:ClientClaims):Promise<{ref:WorkflowRef,inputFields:string[]}>；recordOrigin(tx,run:{id,projectId,workspaceId,memberId,snapshot:unknown},origin:{ref:WorkflowRef,inputFields:string[]},claims):Promise<void>；assertOriginCurrent(tx,run:{id,projectId,workspaceId,memberId,snapshot:unknown}):Promise<void>。原AiCenterRunService root接线adapter只调用真实实现，不能回调submit再开嵌套事务。

run-origin通过自己定义abstract WorkflowPublicationRuntimePort别名注入A.resolveInTransaction；通过原ClientAuthService.assertSessionInTransaction验证claims/currentstoredsession。新immutable ai_personal_workflow_run_origin只存runId/publicationId+scope/ref+server-derived sessionId/tokenVersion（server-only），FK精确原Run/publication/currentowner关系，runId唯一，拒UPDATE/DELETE/TRUNCATE，无status/cost/output/payload/另一个job。原会话引用仅用于dispatch复检，不是token/secret，不进输出/日志。marker/ref与relation/原Run scope不符拒绝；原会话失效后不得继续provider或结算，仍由原Run失败/unknown与budget规则处理，不能因撤权跳过原安全清理。GET用户可在新的合法同owner会话查询，不能强制要求查询会话等于原启动会话；运行期仍验证原会话。

锁序：plugin生命周期/project/org→成员/grants→scoped catalog config→idempotency advisory(仅admission) 或Job→Run(仅dispatch)→workflow advisory/head/publication→原session(仅workflow)→原Memory/grants→Agent/Skill→原结算。新origin runtime resolver不得先锁Agent再等workflow。原失效job/nonce不能通过origin重验制造Trace/settlement；原unknown预留/attemptedAt/maxAttempts1不改变。不能持锁跑IO。root必须实际并发/撤销/ABA/lease-loss/前后IO/审计回滚/唯一reserve与Trace等检验。

RunsService通过自己声明abstract WorkflowRunDriver（root useExisting AiCenterRunService窄adapter）委托submitWorkflow/read/recoverRequest，另注入原preview owner；对外固定submit(member,workspace,raw,claims,correlationId?)→RunEnvelope；read(member,workspace,runId,claims)→RunEnvelope；recover(member,workspace,key,claims)→RecoveryEnvelope；preview(member,workspace,publicationId,claims)→Preview。查询用own relation定位，当前workflow/scope/新会话短事务在原owner调用前后复验，无caller snapshot，不新增queue/计费；过期410/不可见404/当前撤权403/会话401，unknown/network503不猜未执行。原owner public result输出经当前授权后才释放；保持原可观察状态，不把RuntimeJob.completed写作succeeded。Root在ROOT_WIRING落实际adapter/module/hooks，不由Worker复制Run执行器。

## AF207：独立入口与原公共SDK

新增ai-personal-workflow-execution.controller.ts/DTO和packages/sdk/src/personal-workflow-execution.ts，各自structural ports。controller导出abstract WorkflowExecutionPublicationsPort（A的read/publish/unpublish签名）、WorkflowExecutionRunsPort（B固定方法），root useExisting真实owner；不得import其他候选。claims必须取原Guard并绑定当前member，所有路由早期private,no-store+nosniff，原Origin/CSRF规则，duplicate JSON与UTF8在root bootstrap同前缀严格解析。

/client/workflow-executions 路由：
- GET /publications/:workflowId→PublicationMetadata（ai.assets.read）
- POST /publications body精确{workflowId,expectedRevision,expectedPublicationEpoch}→Metadata（ai.assets.manage+workflow.publish），201
- POST /publications/:workflowId/unpublish body{expectedRevision,expectedPublicationEpoch}→Metadata，同权限，200
- GET /capability?publicationId=UUID→Preview（ai.assets.read+ai.execute+workflow.execute），无其他query/body
- POST /runs body{publicationId,input,idempotencyKey}→RunEnvelope（同执行权限），201
- GET /requests/:key→RecoveryEnvelope；GET /runs/:id→RunEnvelope（ai.assets.read+ai.read+workflow.execute），严格空query/body

SDK createPersonalWorkflowExecutionClient(api:ClientApi)固定方法：publication(workspaceId,workflowId,options?)；publish(workspaceId,input,options?)；unpublish(workspaceId,workflowId,input,options?)；preview(workspaceId,publicationId,options?)；submit(workspaceId,input,options?)；recover(workspaceId,key,options?)；read(workspaceId,runId,options?)；options={signal?:AbortSignal}。用原ClientApi一个fetch/credentials/no-store/scope策略，不另fetch。严格验证上述真实shape、ID/正整数/epoch/digest/成本decimal/日期/原Run状态及请求身份对应；类型metadata/RunEnvelope/Recovery/Preview从新文件导出，index只root加export。一次显式变更一次请求，未知success/network/5xx不能自动重发；显式GET恢复原key，不把body/runtime凭据写storage/URL/log。普通纯JS/strict ESM/CJS tests不是已安装实包或真实HTTP证据，root正式测试必须用外部实际tarball安装消费者。

## 接收与边界

每卡Worker只小真实实现/严格验证与有意义协作者成功拒绝测试；ROOT_WIRING精确请求共享接线，candidate commit原标题且STOP ALL WRITING。Root核对source bootstrap所有字节/exact allowPaths delta/明确STOP后串行接收，注册verify:task与实际新PG/原runtime/provider传输/SDK/并发拒绝恢复/全lint等门禁、记录和原名local commit后，才可完成I-*。Linux部署/真实vendor/nativeUI/全40不从本波推定通过；不skip required gates，不新建远端Issue/PR、不push/main/tag/deploy/publish。

## R1：结果查询权限勘误（2026-11-07，root代码初审）

原约定A.resolveInTransaction强制ai.execute，而B GET调用同一resolver，与本契约明确GET只需ai.assets.read+ai.read+workspace.ai.workflows.execute冲突。此为root契约缺陷，不能把附加ai.execute称为预期行为。原治理报告/候选历史保留；R1优先于上述冲突句。

A新增resolveForReadInTransaction(tx,scope,publicationId,authorize?)，签名/返回值及workflow/version/publication/currentepoch/immutablebinding/原SessionGate/锁序检查与resolveInTransaction完全相同；仅permissions明确为ai.assets.read+ai.read+workspace.ai.workflows.execute。可共享私有helper，不复制真值。resolveInTransaction默认执行路径及runtime三阶段仍强制ai.execute+workflow.execute，不能由caller DTO选择读取模式。两个方法均不提前锁Agent/Memory。发布metadata.read仍只遵原ai.assets.read。

B的WorkflowPublicationRuntimePort新增同名resolveForReadInTransaction；Origin服务新增resolveReadOrigin，与resolveOrigin共享ref/project/input/session真实性检查，但仅调用A读取resolver。RunsService.read/recover的短事务locate用resolveReadOrigin并保持READ权限与新查询会话检查；submit前后、preview、runtime admission/dispatch/recordOrigin/assertOriginCurrent只能用原resolveOrigin执行检查。原启动会话仍由运行期复检，GET新合法同owner会话不要求与原会话相同。不得以catch403重试另一resolver、任意client模式或弱化Guard实现。

协作者测试必须证明GET有ai.read但无ai.execute仍走读resolver，缺ai.read拒绝且provider/入队/预占0；submit/preview及运行期即使读权限可用也不能降级读取resolver，缺执行权限拒绝。root实际PG/HTTP还需验证该矩阵。C公共路由/SDK形状无变化，GET Guard不额外加入ai.execute；所有其他R0边界不变。
