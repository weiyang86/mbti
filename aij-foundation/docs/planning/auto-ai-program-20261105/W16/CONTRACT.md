# W16 共同契约

本波是三项底层实现，不是Word/PDF用户链路或AF191完整目标验收。负责人持续授权自动有限批次、外部账号密钥留空。原40目标、AF191严格14案例、失败与继承差异保留；root独占dev/共享依赖/DB/重构建/GUI。最多4卡11.75h含root，超单卡预算保留/拆卡，不降低门禁。

## 文档生成与执行接口

AF197导出 types DocumentRenderInput={format:'docx'|'pdf',name:string,body:string}, DocumentRenderOptions={fontPath:string,fontSha256:string}, DocumentRenderResult={format,mimeType,bytes:Buffer,size:number,sha256:string,pageCount:number|null,rendererVersion:'aij-plain-document-v1'}；函数 renderPlainDocument(input:unknown,options:DocumentRenderOptions):Promise<DocumentRenderResult>。只处理已有纯文本快照，无HTML/外链/宏/脚本/正文替换/AI调用，不连接DB或附件，也不声称固定修订/当前权限已接线。名称/正文沿原personal-documents.dto约束（名称1..160码点，正文UTF8<=65536允许TAB/LF/CR），另设有限段落总量<=2048；过量/不支持字形明确拒绝，不静默截断。输出<=5MiB、PDF实际页数<=100，DOCX pageCount=null不声称跨阅读器固定分页。A4正常页边距、标题/正文清晰、空行/TAB/XML字符/长无空格中文可读。PDF必须嵌入固定font并验证覆盖；DOCX EastAsia字体名Noto Sans CJK SC，外部阅读器字体差异如实记录。字体缺失/哈希不符/缺字、页数或输出超限拒绝，不回显正文/绝对路径/堆栈。

命令入口document-renderer-cli.js：从stdin读取单个UTF8 JSON {input:DocumentRenderInput}（总输入<=80KiB），固定从 /aij/assets/document-fonts/NotoSansCJKsc-Regular.otf 读取校验过的font，输出单行JSON {schemaVersion:1,format,mimeType,size,sha256,pageCount,rendererVersion,base64}；成功exit0，无正文/错误堆栈日志，失败只固定错误码且exit非0。JSON/base64上限独立计数，不能只看扩展名或PK/%PDF签名。固定字体SHA 2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b。

AF197还提供脚本级 buildRuntimeBundle({destination,repositoryRoot}):Promise<{directory,fontSha256,rendererVersion}> 于 scripts/document-export/runtime-bundle.mjs，仅打包实际已编译renderer与CLI、docx/pdfkit已解析真实传递依赖及固定font/license，禁止copy整个repo/node_modules/env/上传/其他项目，校验目标fresh/受控标记、符号链接边界与版本；不执行Docker/安装/网络，不作为新独立包发布。调用方root/运维在明确受控目录构建。清除只删除自己的标记目录。精确依赖计划见RENDERER_DEPENDENCY_PLAN，root AF197集成时才改全局manifest/锁/assets/SOURCE_PROVENANCE；Worker可在自己私有临时依赖目录安装这些精确版本测试，不改共享manifest或锁、不复制依赖或字体到root。

AF199使用以上CLI协议与bundle接口，候选可基于固定协议编写；真实根集成必须依赖I197的真实ID/CODE_VERIFIED，而非候选。导出受控执行器默认disabled，无环境变量/服务端入口暗中启用。只允许管理员构造的不可变本地Docker image ID sha256:64hex 和绝对Docker CLI；客户端不得指定image/命令/font/host路径。生产容器network none/read-only/user65534/capdropALL/no-new-privileges/pids<=64/CPU<=1/memory+swap512MiB/有界tmpfs，不挂host、不传hostenv、不开放端口，stdin JSON和有界stdout。单API进程并发1、无无界队列；最长15s/取消必须处理；stdout控制<=8MiB、文件<=5MiB/正确base64/类型/校验和和元数据一致才返回。只有确认容器按nonce/name/image/ID是自有才rm；close后以inspect ID/name确实不存在取证，unknown liveness不冒充已清理。缺Docker/image、超时/OOM/取消/超输出/清理未确认均固定安全结果；不接运行账本/附件/用户接口。ops镜像只用精确Node digest和已批准bundle，无运行时下载或安装，镜像构建/真实Linux/资源/取消/OOM验收root独占。

## 同任务运行夹具

AF198建立 startWorkbenchTargetRuntime({task:'AF-198'|'AF-191',transport:'AiCenterHttpTransport:owned-loopback',concurrency:1,freshLease:true}) 的root-only真实App/PG/任务夹具，仅暴露能力/私有RAM测试句柄，不实现native十四案例、不关闭AF191。返回 task/approvedLeaseTask/acceptanceId/projectId/workspaceId/memberId/agentCode='general-text'/apiBaseUrl/artifactDirectory，及 counters()->{runs,jobs,traces,upstream,submits}, databaseSnapshot(runId)->窄run/job/trace投影, request({actor,method,path,workspaceId,body})->{status,body}, fetchAsActor(actor,url,init,capturedFetch), pumpJobs()->真实执行job数组, close()->实际applicationPools0/ownedSockets0和私有关闭证据。后续root adapter负责sdkTgz/contractsTgz、Next同origin代理/丢首次POST回执/延迟GET、mountConsumer/native/evidence，不由本卡填假成功。夹具如需扩展辅助方法/actor登录信息只RAM，文档明确。

真实独立新AF198租约、现有用户/Workspace/Plugin/Run/Job/Trace owner与current权限围栏；0→1 Run/Job/Trace/upstream/唯一POST，general-text合成结果严格 Synthetic goal completed.，预算settled/costSource unreported/cost null，claim执行一次、第二pump为空。owner/匿名401/无权限403/他成员404，owner第二合法空间/当前role/session拒绝由原owner验证。不得覆盖transport.request；允许此root-only fixture在隔离进程注册全局fetch转发，仅精确原厂商HTTPS URL转到自有loopback并调用捕获的真正fetch，保留原AiCenterHttpTransport.request/URL/redirect/大小/nonce检查并计数，其他外网一律拒绝，不合成/修改Response。必须断言原方法身份未变且实际调用与非法endpoint无新增上游；若该边界不足原严格目标，记录真实缺口，不改为stub或提前通过。所有失败创建/启动阶段用finally关闭已创建自有资源并恢复env/fetch/logger；DB失败场景单独新lease，不污染未来AF191最终唯一Run。

允许的共享改动请求仅由root在STOP后处理：migration/runtime两层精确AF198任务准入；client-auth/remaining fixture精确准入及初始化失败清理/测池，不能放开未知task。schema/migration/生产App/SDK/工作台无需Worker改动；若真的需要提交最小root请求，不跨卡动手。完整AF191另分原生闭环卡，必须真正OS hidden===true、延迟响应前后、同Run14实际路径和最终零资源，当前未实现不标PASS。

## 接收

所有Worker独立已注册Orca Worktree从origin/dev创建，按SOURCE_BOOTSTRAP逐blob恢复最新已验证source，独立bootstrap提交；root只接之后allowPaths候选。绝不复制env、migration历史、node_modules、上传或root未提交AF191。通用下游代码引用实际I ID。CODE_VERIFIED!=owner接受；外部厂商DEFERRED_NOT_PASSED，全40NOT_RUN_TARGET_ACCEPTANCE，无push/PR/main/部署/发布。
