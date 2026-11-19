# W22 已批准开发与集成契约

负责人指令：“按照以上规划开始进行开发”。范围严格对应2026-11-08 NEXT_WORK_PLAN：AF219治理1h、AF220独立AI本地集成4h、AF221个人文档历史恢复3.5h、AF191续验新增2.5h；本批新增总上限11h。AF191累计已耗1.5h原样保留、累计上限由3h调整为4h。预算含总控集成、真实验证、修复、记录和本地提交；不自动续批、不push/PR/main/tag/部署/包发布。不等待Trea；CODE_VERIFIED与OWNER_CHECK_PENDING分别记录。

总控独占dev、正式队列/registry/执行记录、共享文件/契约/Schema/依赖，以及DB、heavybuild、Linux、native各并发1。两名Worker只写各自NEW allowPaths，候选积压2张先集成。使用当前默认模型，不传model/effort、不改CLI设置。Worker每卡最多1.5有效工程小时，剩余额度保留给root；预计超限先保留成果/拆分，不降低门禁。

冻结已验证源码dc13430835ae89b58ae18577be12643224c9c55e；最新只读回查origin/dev为94b0236f775fa40a07944c5e0545ac6ce0e123f3。Worker由Orca new-child从该origin/dev创建，登记实际Worktree/Task/Dispatch/起始SHA，逐blob应用本批SOURCE_BOOTSTRAP清单并hash校核，作独立source-only bootstrap提交。只读参考根目录本契约与清单，不复制live root、脏AF191/208/用户资料、原型、真实.env、凭据、node_modules或上传数据。清单中的迁移只来自本库该提交的已注册SQL，允许静态读取，禁止Worker执行任何迁移。

Worker独立pnpm install --frozen-lockfile和允许的schema-only generate/小包build/typecheck/lint/纯单元；不连接DB，不执行seed/migrate/Docker/服务/HTTP/浏览器/full API或Next build/root verify/厂商调用。所有DB与真实环境交总控。遇契约缺失用Orca ask并结束当轮，不自行发明当前权限、结果未知或owner语义。初始发送身份和基线消息后继续开发，以便唤醒root调度AF191；完成提供确切delta、初始/bootstrap/候选SHA、命令/退出码/未运行项/工时，按队列原标题候选提交，明确STOP ALL WRITING后worker_done；Candidate not CODE_VERIFIED。

## AF220：独立AI本地集成

唯一固定身份：project=aij-ai-local，APP_ENV=development，Web3955/API3956/PG55435，loopback；数据库与用户aij_ai_local_development；Cookie前缀aij_ai_local_development；issuer urn:aij:aij-ai-local:development:api。目录.local-data/ai-local-development，真实存储必须位于其内的aij-ai-local/development/storage；隔离API输出apps/api/.ai-local-dist、Web输出apps/web/.next-ai-local。Compose project=aij-ai-local，container=aij-ai-local-postgres，volume=aij-ai-local_postgres_data，配置ops/compose.ai-local-development.yml。沿用Base已冻结的PostgreSQL16镜像digest，不升级依赖或镜像。

CLI仅init/start/status/stop，start可--build。无reset/cleanup/adopt/任意参数覆盖/真实厂商启用功能。所有路径canonical、无symlink，owner核对repo/OS用户/hostname/instance/docker context与Unix端点、资源labels/镜像/卷/端口。已有目录/容器/卷若无完整本卡owner记录则拒绝接管。不得停止旧Base3855/3856/55434、host3655/3656/55432/55433或其他项目。ExFAT权限按已有工程实际可验证边界处理，不chmod用户文件来绕过owner检查。

复用原runtime-environment project配置与assertProjectIsolation，不放宽原host/test target保护。API显式AUTH_ENABLED/CLIENT_AUTH_ENABLED/DATABASE_ENABLED/STORAGE_ENABLED/ASYNC_RUNTIME_ENABLED=true、ENABLED_PLUGINS=aij-ai；AI_DEEPSEEK_LIVE_ENABLED/AI_CENTER_LIVE_ENABLED/AI_CENTER_CLIENT_EXECUTION_ENABLED=false。真实通知/支付不启用。默认文档导出保持未配置（AIJ_DOCUMENT_EXPORT_ENABLED=false），不能借用测试镜像或未经批准的依赖下载；如root核实已有正式可用镜像后启用，必须另作安全配置记录。网页显示原真实能力，不额外伪造“全部就绪”。所有缺功能保留未交付。

init首次在忽略私有目录生成独立DB密码及四类独立auth secrets，不复用.env.local。Web build/start只拿public allowlist，无DB/JWT/provider secrets；API显式配置并清除继承root模型/短信/支付/外部环境，不能依readRepositoryEnvironment回填root真实值。后台外部配置仍走原API owner，本卡不解析真实凭据。

Worker提供config/CLI/build/processes/service/docker/database模块及纯检查；沿用现有Base的受保护生命周期思路，抽取可用公共函数，不更改旧Base契约或实现第二套产品服务。database模块校验固定新目标与实际PG身份/版本、迁移账本，再通过原Prisma当前schema部署，只允许新目标deploy/status，不允许reset/drop。实际初始化种子统一调用root专有模块scripts/ai-local-development/root-initialization.mjs的initializeAiLocal({owner,values,runtime})。该模块由root集成原seed/ClientAuth/Workspace/插件/权限owner，不由Worker复制seed逻辑；CLI只在init阶段动态加载该hook，缺少时明确失败、不得标INITIALIZED。纯检查可注入明示的离线测试collaborator，但不作为root真实初始化证据。

root拥有Compose、新seed hook、package脚本、原seed必要窄出口、数据库目标门禁、真实5个合成客户身份/独立空间、AI插件安装/权限/菜单、运行任务worker调度与真实浏览器验证。重复init不能重置密码/改grant/覆盖菜单或配置；不创建原型业务订单/学生/工单/商品。新进程持久start仅在root实际验收后提供地址；准确区分Web/API已运行与AI厂商/导出未配置，不能用fixture替代商用装配证据。

纯检查须证明：严格固定环境、拒绝旧库/其他主机/端口/秘密复用/未知变量；无资源接管/宽泛kill；Web无秘密；PID birth/CWD/command/owner精确停止；CLI反复调用的非破坏约定；受影响Base原检查仍通过。root执行真实初始化、会话/空间隔离、数据持久化/重复init与owned lifecycle、实际Web/SDK/HTTP成功拒绝路径、正式verify与清理/保留服务的owner记录。Worker不宣称这些已通过。

## AF221：文档历史恢复为新版本

导出ClientDocumentVersionRestorePanel({request,scope,onDocumentChanged,onScopeRejected})，scope=null或{memberId,workspaceId,documentId,revision}。root在原ClientDocumentManager永久挂载一个实例；编辑/忙/历史预览/无已保存详情时scope=null，不以key/unmount丢弃未知写入锁。原ClientDocumentLibrary提供经真实当前权限围栏的ClientApi；root若需额外只读revalidation callback，必须保持原会话/父页面owner。

只用原createPersonalDocumentsClient：get、versions、getVersion、update。实际update是PATCH，不是规划文档中误写的PUT；这是按现有接口纠正，不增加API、SDK导出、Schema、权限、版本或审计owner。需要workspace.documents.read读历史，read+workspace.documents.manage才可恢复。

每个动作前后通过原/client/auth/me和/client/workspaces/context验证member、workspace、role、permissions和精确64hex sessionGeneration；再核对当前文档id/revision与props scope。严格按当前SDK响应验证形状和归属，无任意object spread写入。历史版本只有documentId/revision/name/body/createdAt，不是Agent version ID。分页使用beforeRevision原游标。选定较旧版本显示当前-vs-历史名称/正文差异、明确说明将成为新版本，单独确认后仅update({expectedRevision:current,name:historical.name,body:historical.body})。不复制id/code/owner/权限/引用/时间/历史revision；相同name/body为no-op零PATCH，取消零写。

PATCH后读原get证明新head；旧v1/v2及导出引用不变，成功通知父页重读，不直接向父页注入未经围栏数据。当前权限拒绝时同步清父页和子面板私有正文，包含401/403/404能力不可用；回调不重复变更权限，不自动刷新其他资源。CAS409保留原当前人工编辑，不覆盖；允许显式重新读取后重新比较，不能自动采用新revision重放。

所有尝试PATCH后的错误均保留RAM中的opaque原owner/document/expectedRevision恢复锁，包括服务端已提交后丢回复表现4xx的情况。原范围GET核对结果后，另一次新鲜当前授权的明确确认才能清锁；绝不自动PATCH、换键/重复提交、轮询或虚构mutation恢复endpoint。scope=null/换账号/空间/角色/会话/头版本、失焦/真正hidden/卸载清private正文/历史/名称/确认并阻止迟到回调，仅保留无法确定的opaque归属标识。不能把任意新owner的读结果用于解除旧锁。

Worker只提供新state/d.mts/panel、状态回归测试、root接线说明和候选记录；用现有AntD/adminTheme/PageHeading，应用frontend-design-review，无重做UI/依赖/全局规则屏蔽。测试使用实际编译公开SDK，覆盖分页/形状/归属/当前权限/sessionGeneration/no-op/取消/一PATCH/CAS/未知跨null与新鲜ACK/late/hidden/unmount；注明仅合成单元，root负责真实原接口PG/导出引用、父清理和桌面390原生，不以合成浏览器事件冒充native。

## AF191续验与出口

root依真实I215=task_383cde85f7a3以及本批I219，保留原task_1f770e22492a和原候选STOP。新增2.5h，原已耗1.5h不清零；严格完成原14项actual native同Run、installedSDK/PG/API/Job/Trace与真实hidden，或到限保留未通过并停止。原生环境/浏览器工具保持原typed CLI与只读观察，不DOM/方法/事件注入。

全部40目标状态保持NOT_RUN_TARGET_ACCEPTANCE，除非逐项目标的全部真实成功/拒绝验收确实执行。模型/七牛有效期与可外发范围未补，不作真实调用；通知/交易/退款明确暂缓。保留原型、交接JSON与全部继承WIP。批末如实列diff、DB/API/页面/权限/日志影响、命令结果/失败、真实可访问地址、未实现项、人工步骤和后续真实依赖，出口OWNER_CHECK_PENDING，不自动继续。
