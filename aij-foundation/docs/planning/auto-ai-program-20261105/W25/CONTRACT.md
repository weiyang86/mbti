# W25 文档章节生成前端与原请求恢复契约

负责人已授权“已经验收完成，请自动开启下一批，快速完成所有的开发工作”。本批自动接续仅有限本地开发；W23/W24人工验收保持PENDING，40项目标和历史失败不改为通过。无push/main/PR/远端Issue/tag/部署发布、真实供应商付费调用或通知支付权限。默认模型继承，不切模型。三个只读审计分别0.25/0.20/0.20h，全部零文件并STOP，见GOVERNANCE_INPUTS和真实Task记录。

## 本批出口和预算

AF230治理1.25h（只读预算0.75h，root<=0.5h）；AF231共享原日志端口3.5h（Worker<=1.25h）；AF232纯生成控制器3.5h（Worker<=1.5h）；AF233面板与真实接线3.75h（Worker<=1h）。4卡12h，每卡<=4h，工时包括失败修复、root和规划。到上限保留成果/失败/NOT_RUN拆卡。最大4活跃Agent含root；DB、重型构建、Linux和native各1，均由root独占。

本批实现：原已保存章节选择→当前自有已发布且兼容Agent→预览→来源/内部估算确认→提交一次→原key元数据恢复→当前授权结果读取。仅generation submit恰一次POST；preview本来就是独立POST。没有轮询、自动重试、focus/mount自动请求、自动创建/发布Agent、自动PATCH、生成结果应用或复制到文档草稿入口。原手工章节编辑/比较/明确保存继续由原owner处理；生成结果接原比较与写回下一批。原SDK composer足够，该审计建议的额外公共纯helper本批不增加。

候选均由最新已核验origin/dev新Orca child创建；实际Task/Dispatch/Worktree/terminal/branch/initialSHA与bootstrap/candidateSHA必须交回。源码冻结46079d20b55b4c581cc5cd0a8464ad2e0dd55326，1112个精确Git blobs，清单及hash见SOURCE_BOOTSTRAP.json/spec；不复制root live/真实env/用户资料/原型。独立node_modules，无凭据上传共享。候选只新增allowPaths；旧owner、barrel、依赖、正式队列、registry、manager接线只归root。C231/C232/C233并行，不导入未来兄弟；I231→I232→I233依赖真实I ID，只有root正式verify/PASS+适用门禁+原名本地隔离提交后完成I。Candidate not CODE_VERIFIED，须STOP ALL WRITING再交接。

## 冻结共享类型（各候选结构声明，不能导入未来兄弟）

沿W24已公开SDK的DocumentGenerationRef、DocumentGenerationPreview、DocumentGenerationRunEnvelope、DocumentGenerationRecovery，不重新定义quote协议。所有来源/quote比较按字段规范化，不能依赖对象插入顺序。成本保留maximumEstimatedCostNanos原字符串，为模型内部估计，不是销售报价或实际扣费。

```ts
type Owner = Readonly<{memberId:string;workspaceId:string}>;
type AuthPin = Owner & Readonly<{roleId:string;roleCode:string;sessionGeneration:string;permissions:readonly string[];validationKey:string}>;
type SourcePin = AuthPin & Readonly<{documentId:string;revision:number;bodySha256:string;sectionId:string;start:number;end:number;sectionSha256:string}>;
type VerifiedSource = Readonly<{pin:SourcePin;document:PersonalDocument;index:PersonalDocumentSectionIndex}>;
type GenerationEntry = Readonly<{memberId:string;workspaceId:string;agentId:string;revision:number;key:string;digest:string;runId:string|null;status:'unconfirmed'|'queued'|'running'|'succeeded'|'failed'|'unknown';family:'document-generation';origin:DocumentGenerationRef;attempted:true}>;
type JournalPort = Readonly<{
 getSnapshot(owner:Owner):GenerationEntry|null;
 subscribe(notify:()=>void):()=>void;
 load(owner:Owner,signal:AbortSignal):Promise<GenerationEntry|null>;
 submitOnce(intent:Readonly<{owner:Owner;origin:DocumentGenerationRef;digest:string}>,send:(key:string)=>Promise<DocumentGenerationRunEnvelope>,signal:AbortSignal):Promise<DocumentGenerationRunEnvelope|null>;
 bind(expected:GenerationEntry,metadata:Readonly<{runId:string;status:GenerationEntry['status'];origin:DocumentGenerationRef}>,signal:AbortSignal):Promise<GenerationEntry>;
 acknowledgeTerminal(expected:GenerationEntry,verify:()=>Promise<DocumentGenerationRecovery>,signal:AbortSignal):Promise<boolean>;
 suspend():void;
}>;
type ScopePort = Readonly<{
 active():boolean;
 peekAuth():AuthPin|null;
 peekSaved():VerifiedSource|null;
 verifySource(expected:SourcePin,mode:'preview'|'execute'|'read',signal:AbortSignal):Promise<VerifiedSource>;
 verifyRecovery(owner:Owner,signal:AbortSignal):Promise<AuthPin>;
 onScopeRejected(status:401|403|404):void;
}>;
type AgentChoice = Readonly<{id:string;revision:number;name:string}>;
type Availability = 'unchecked'|'ready'|'unpublished'|'incompatible'|'not_configured'|'unavailable';
type AssetsPort = Readonly<{
 list(owner:Owner,afterId:string|null,signal:AbortSignal):Promise<Readonly<{items:readonly AgentChoice[];nextCursor:string|null}>>;
 inspect(owner:Owner,id:string,signal:AbortSignal):Promise<Readonly<{agent:AgentChoice;availability:Availability}>>;
}>;
type GenerationApi = ReturnType<typeof createPersonalDocumentGenerationClient>;
type GenerationAction = 'agents'|'nextAgents'|'agent'|'instruction'|'preview'|'confirm'|'submit'|'recover'|'acknowledge'|'read';
type GenerationPanelState = Readonly<{
 contextKey:string|null;busy:boolean;allowed:readonly GenerationAction[];
 source:Readonly<{documentId:string;revision:number;bodySha256:string;sectionId:string;sectionTitle:string;start:number;end:number;text:string}>|null;
 agents:readonly AgentChoice[];hasNextAgents:boolean;agentId:string;instruction:string;availability:Availability;
 preview:DocumentGenerationPreview|null;confirmation:boolean;acknowledged:boolean;
 run:DocumentGenerationRunEnvelope|null;recovery:DocumentGenerationRecovery|null;recoveryPending:boolean;issue:string;notice:string;
}>;
type GenerationPanelView = Readonly<{
 getSnapshot():GenerationPanelState;subscribe(notify:()=>void):()=>void;
 loadAgents(next:boolean):Promise<void>;selectAgent(id:string):Promise<void>;setInstruction(value:string):void;
 preview():Promise<void>;requestConfirmation():Promise<void>;setAcknowledged(value:boolean):void;cancelConfirmation():void;
 confirmSubmit():Promise<void>;recover():Promise<void>;acknowledgeRecovery():Promise<void>;readResult():Promise<void>;suspend():void;
}>;
```

Generation controller另返回setContext(contextKey:string|null):void、dispose():void、setBindings({scope,assets,api,journal}):void。factory导出createDocumentGenerationController({scope,assets,api,journal,timeoutMs?:number,now?:()=>number})。setContext只同步清理/发布，不自动读存储或请求；非null key须与root当前peek pin一致，不能当授权。无scope的null状态连错误/Modal也不得泄漏。scope可有当前auth而没有saved source，此时可显式recover原key元数据，不能preview/submit/read。AuthPin将原DocumentScope.sessionKey映射sessionGeneration；排序权限和validationKey精确保留。contextKey由root基于完整AuthPin和可用SourcePin或null生成，不能只拼docId。

## AF231：一个原日志owner、一个bucket和Web Lock

新增client-personal-agent-request-journal.mjs及.d.mts只作为原personal-agent日志的提取/扩展实现；原文件由root改为导入它，不能成为第二个日志。保留原personalJournalKey(memberId)的aij.client.personal-agent.pending.v1:前缀、version=1、上限16384字符/32entry。旧8键entry形状、parsePersonalJournal(raw,memberId)与旧controller公开方法保持。旧entry隐式personal-agent；新entry精确旧8键+family/origin/attempted。不存正文、instruction、output、session/token；新entry每member/workspace至多一个，无论doc/section/Agent变化都不能换key绕过。唯一性按family分流，旧pair(workspace,agent)，新workspace。旧代码对document entry不得调用旧generic API，也不得CAS移除/丢弃它。

冻结导出PersonalRequestJournalError、personalJournalKey、parsePersonalJournal、samePersonalJournalEntry(a,b)、findPersonalJournalEntry(entries,selector)、createPersonalRequestJournalStorage({journalStorage:()=>StorageLike,withRecoveryLock?:(name,fn)=>Promise<unknown>})。StorageLike仅getItem/setItem。selector结构为{family:'personal-agent',workspaceId,agentId}或{family:'document-generation',workspaceId}。storage返回read(memberId,guard), locked(memberId,guard,fn), compareExchange(memberId,selector,expected,replacement,guard)；guard:()=>boolean在每次读写前后/锁入口检查。CAS只改被选entry，精确验证expected与origin/完整metadata，保留同bucket其他family/空间，写后原字符串读回不一致即拒绝；锁缺失/存储损坏/超限/写失败阻止新submit，不能删除兜底。JSON parse后依严格描述符/原型/精确键和W24完整ref校验，不执行getter。

另导出createDocumentGenerationJournal({journalStorage,withRecoveryLock,makeKey?:()=>string})实现上述JournalPort，内部复用同storage原语，无独立key。submitOnce在同Web Lock里检查原未决entry，生成opaque key，先持久化attempted:true并读回，再在同锁/当前signal下至多调用一次send；任何异常/abort/超时/晚到成功仍保留原entry，永不重发。成功仅bind同origin/run状态。suspend只清RAM/取消当前epoch，不能清持久entry，之后显式load可恢复；外部storage事件root同步suspend/controller清私有内容。bind/ACK必须完整CAS和当前signal。ACK每次verify重新原GET key元数据，匹配origin/run，且succeeded/settled或failed/released才可删此entry；unknown/reserved、404/410、失败或不匹配不删。documentCurrent=false仅在真实安全终态可结束journal，永远不授权正文读取。发送前abort可保守保留unconfirmed，不能当作服务端未执行证明。storage facade在旧controller的locked/read/cas中被root实际使用，不能只导出未使用实现。

## AF232：纯控制器，当前来源与单次提交

候选仅依赖注入端口，不能建storage/定时poll/HTTP fetch/预算账本/文档写入。SDK四方法各显式一次，传signal。source private副本RAM，strict descriptor snapshot先于await；来源须原已保存完整章节，含标题/换行，slice非blank且<=2000UTF16，instruction非blank<=2000UTF16且raw不trim/hash normalization。document/index/ref全字段、完整body UTF8 SHA与slice SHA/range/连续索引由原SDK索引与rootverify共同保证；controller仍核对source/id/rev/hash/范围和quote来源与选Agent/revision/rawinstruction SHA。生成输入值由服务端原owner抽取，不传客户端正文替代来源。

loadAgents每次一个有界分页（limit50，显式下一页，严格游标有序无重复，最多20页）；selectAgent后才inspect，root用原个人Agent list/get、publications.get、runPreviews.preview核实当前自有enabled、已发布、dependencies ready、text/text、恰source/instruction两字段。不全列表N+1、不自动创建/发布。SDK asset方法无signal时root在本次ClientApi闭包传播signal并校验epoch。只读3权限documents.read+ai.read+ai.assets.read，执行另加documents.manage+ai.execute；modelExecutionConfigured仅配置事实，无配置仍可read/recover已存在任务。

preview需verifySource(preview)前后当前pin/Agent与来源；引用SDK preview并冻结全ref。原Agent/instruction/source/context/绑定变化立即清quote/consent/confirmation/result。requestConfirmation与confirmSubmit均重新verifySource(execute)、inspect当前Agent、调用preview对照全部原ref与modelExecutionConfigured；任何价格、版本、epoch/catalog/model/input/source变化拒绝并要求重新明确预览确认，不能默用新报价。勾选后confirmSubmit经JournalPort.submitOnce一次；digest=SHA256(JSON.stringify(['personal-document-generation-v1',canonicalRef,rawInstruction]))，canonicalRef按W24十二字段/document九字段固定顺序，不trim。提交结果只绑定id/status，不能显示其output为当前可用结果；展示必须用户主动readResult当前原document-generation read。generation.submit是唯一执行POST，不因错误重试或新key掩盖已有entry。

recover显式journal.load+verifyRecovery当前owner（允许新session且不预要求旧doc revision）+原SDK recover元数据；前后verifyRecovery，同origin/key/run后bind。documentCurrent=false显示元数据但禁read/output；410/404不清锁。readResult要求当前saved source和原origin一致、verifySource(read)前后与当前原SDK.read结果一致、未过expiresAt且succeeded/settled才显示string<=64000输出；其它状态仅metadata，unknown/reserved仅原key查回。ACK通过journal.acknowledgeTerminal回调重新当前verifyRecovery/SDKrecover，成功后清私有结果，不能通过“知道了”解未知锁。

每个await、WebCrypto和父清除前后检查epoch+source/auth完整pin+active；ignored abort用有界race，finally旧ticket不改新state。当前401/403/404须onScopeRejected实际status→root同步清父+子；旧ticket拒绝静默，不清新scope。blur、真实hidden、pagehide、unmount、storageevent、source/role/session/permissions/context变化同步suspend清source/instruction/output/confirmation，保留持久锁。取消确认需撤销勾选；不会自动恢复输入或读取。expire显示前/方法前按now复检，root若需到期清空timer只允许清RAM、不轮询。

## AF233：注入view的真实面板及root接线

面板导出ClientDocumentGenerationPanel({contextKey,view})；结构类型本文件GenerationPanelView/State完全一致，本地可export types。只React/AntD/adminTheme/已公开SDK type，不import未来state/journal，不fetch/storage/timer/SDK工厂/保存/compose。useSyncExternalStore；render先遮props.contextKey=null或与snapshot不等的全部私有内容、issue/notice/Modal；卸载幂等suspend。mount/focus/render不触发请求。

展示完整已保存source含标题/UTF16长度/版本/hash，Agent选择与显式分页、原指令、origin Agent版本/发布epoch/catalog/model、maximumEstimatedCostNanos原字符串。固定文案“原模型执行内部估算上限：… nanos；非销售报价，非实际扣费；预览不预留、不执行，提交时重新核验”。确认Modal显示原来源/费用并勾选核对，“确认并提交一次”；取消零submit。unknown提示结果未知费用仍可能预留，仅按原标识查回；无应用/保存/新key按钮。documentCurrent=false/过期不得展示旧输出。按钮全遵allowed，view方法本身仍强制门禁；正常表单/Modal焦点和390px可用性沿现有设计，不重做UI。

root独占manager/library/access、原personal-agent-run-state及.d.mts、export panel的同store注入/声明、正式registry/队列等。createDocumentComposition永久只创建一个generation controller+journal和一个原export store，export panel接同store；同步订阅原restore/export/manager/sections，peekSaved排除编辑/unsaved/忙/未知save/conflict/history/delete、restore busy/confirmation/locked、export busy/unknown/conflict、sections手工replacement/comparison/confirmation。原export store reset/suspend的未知锁保持，不以key/remount重建；只读recover可不依赖saved source。生成busy时屏蔽冲突本地mutation，但不能误清自己的操作pin或改变原保存锁。Conceal/dispose覆盖全部私有store，parent current status经原handleAccessFailure处理。scope核验通过原guarded request每次真实me/context/doc/index，role/session/sortedpermissions/validationKey前后一致。

## root必须交付的证据（候选不代称完成）

AF231：真实storage/Web Locks语义的双实例竞争单次send，旧8键/journal/controller全部回归，不匹配CAS/损坏/缺锁/写后读回失败零POST；断联/晚到/abort保留，其他family/空间不丢；ACK仅二次真实安全状态。root原controller实际导入新owner，原方法行为不变，无新bucket。

AF232：端口单元真实WebCrypto/snapshot/延迟promise、当前/旧拒绝、双击/两实例、quote每字段/source/instruction/Agent/角色变更、unknown/expired/currentfalse/410拒绝和无poll/autoPOST。root原公开SDK+原Auth/PG/runtime/本地可计数loopback验证preview零Run/Job/reserve/upstream、submit一次Run/Job/reserve/Trace、真正落库后丢响应只GET原key、当前read、source/Agent/会话/权限拒绝和原doc无新版本；默认执行关闭保持。必要fixture只精确登记本卡，不冒用旧task。

AF233：真实React/AntD render行为单元，不以grep代行为。生产Next+原API/隔离PG+本地upstream桌面与390x844完整路径；丢提交回复后刷新/重挂/回焦零自动submit/poll、显式recover/read；真实撤权/角色session/source/Agent变化、heldresponse、原blur(hasFocus=false hidden=false)/hidden=true/页面内真实链接卸载，父子同步清空，无DOM伪事件属性override。沿自有w21/w22浏览器和native helper，root独占。原save/restore/export未知锁、历史与旧导出字节回归，字体不支持glyph继续真实拒绝，不改renderer。重型build/DB/native预算不足即拆卡，不能隐去NOT_RUN。

每卡注册verify:task适用单元、类型、lint、SDK/API/Web必要构建和真实拒绝路径；原40/历史/验收不改写。失败记录保留，STOP后root精确接收，安全隔离原名本地提交。执行记录写真实diff/接口页面权限日志DB影响、命令exit、地址是否实际运行、未实现/下一依赖/人工步骤/Writer交接；3955原凭据及3文档保留，未经原CLI受保护刷新不得称新UI已运行。
