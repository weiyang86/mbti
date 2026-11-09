# W23 文档章节与局部草稿编辑契约

当前负责人指令：“已经验收完成，请自动开启下一批，快速完成所有的开发工作”。只将上下文W22四卡AF219/220/221/191登记为负责人验收，保留旧失败及全40目标状态。负责人同时授权后续剩余本地开发自动按有限批次接续：每批<=4卡/12有效工程小时，每卡<=4h，原Writer交接、正式门禁、精确本地提交与实际I依赖继续；硬阻塞/到限保留拆卡，不因自动执行推定push/main/远端部署/真实模型、七牛、通知、支付权限。

本批4卡：AF222治理0.75h；AF223个人文档章节索引只读接口3.25h；AF224章节读取与局部草稿组合SDK3.5h；AF225章节导航及局部草稿预览页面4h。总11.5h含root集成/真实验证/修复/记录；Worker各<=1.5h，剩余归root。三个候选按冻结wire契约并行；正式I223→I224→I225串行。root独占dev、共享owner/module/公开index/parent/registry/队列/依赖、DB/heavyBuild/Linux/native各1。默认配置模型，不传model/effort。独立源码bootstrap由最新已验证origin/dev创建新子Worktree，按SOURCE_BOOTSTRAP逐blob恢复已验证本地5289bd1源码；精确hash与另立bootstrap提交；不复制live工作区、原型、凭据或node_modules。

## 产品出口

已保存文档可只读识别章节块、选择一块、编辑/比较，然后明确“应用到全文草稿（尚未保存）”；只有原文档编辑器的“明确保存”才调用原PATCH/expectedRevision并产生新版本。其余块精确保持；取消/noop零写。没有本卡新章节写API/数据库表/版本/审计/Run/费用owner。此为单章节AI生成的结构前置，本批没有生成模型调用、富文本、引用/公式、自动重写或全40商用完成承诺。

## 冻结 wire / parser

GET /client/documents/:id/sections?expectedRevision=N；N为canonical十进制1..200，唯一必填query，拒绝额外/重复/数组/prototype形状。Controller沿原Client/Workspace/PersonalDocumentNoStoreGuard、workspace.documents.read及private,no-store；Service只委托原PersonalDocumentsService.get(member,workspace,id)，精确revision不符409。解析只在已授权原当前文档的RAM副本进行，无Prisma/文件/模型/Job/审计写入。匿名401、无权限403、其他成员/删除404、插件/项目不可用及旧revision真实拒绝。

固定JSON keys：{format:'aij-plain-sections-v1',documentId,revision,bodySha256,bodyLength,bodyByteLength,sections}。bodySha256是原body未经正规化的UTF-8 SHA256小写64hex；bodyLength为JS UTF16 code units，bodyByteLength为UTF8字节。不得trim/NFC/更改行尾。原文档最大65536字节/200修订保持。

sections是1..128个{ id:'section-0'.., index:0.., title, level:0..6, start,end }；区间[start,end)按UTF16，平坦连续覆盖body，从0到body.length，不重叠不漏字。空正文为一个0..0、title='正文'/level0的块；有前言时第0块title='正文'/level0。只识别列0的1..6个#后至少一个空格或tab的ATX标题；title去首尾水平空白，1..256 Unicode codepoints，过长或超过128块明确400，不截断或暗降级。标题行本身包含在对应可编辑块中；不建树、不做Markdown渲染。LF/CRLF/单CR按原文精确定位。列0以>=3个同种反引号/波浪线打开围栏，直到列0同种>=开头长度且只余水平空白关闭，围栏中标题无效；未闭合围栏消费余文。引用/缩进标题不识别；BOM不删除；不解释HTML。id仅为本快照序号，不是权限凭证。

## SDK AF224

新增public createPersonalDocumentSectionsClient(api).get(workspaceId,documentId,expectedRevision,signal?)，一次显式GET，不retry/poll/cache/storage，无Node-only运行依赖。严格请求/响应形状、归属、revision/hash/大小、128上限、id/index/level/title、连续范围与UTF16边界；异常不泄漏正文。Response没有body，原body由原公开createPersonalDocumentsClient.get取得。

新增async composePersonalDocumentSectionDraft({document,index,sectionId,replacement}) -> {documentId,expectedRevision,sourceSha256,sectionId,body,changed}。document为原PersonalDocument；index为上述wire。验证id/revision/UTF16长度/UTF8字节和WebCrypto SHA256精确一致；拒绝非plain/getter/prototype/额外字段、错误scope/hash/range/控件/非合法Unicode/超原65536字节。只用源body.slice(0,start)+replacement+slice(end)，不复制历史id/code/owner。替换整块含标题，预览明确标识；若end<body.length且replacement非空，replacement须以LF或CR结尾，避免无提示拼接到下一标题。拒绝时不自动补换行。changed=false为纯no-op。函数不HTTP、不PATCH、不改输入对象、不存储。公开类型/导出由root在I224接线；Worker不改index/package/lock。

## UI AF225

仅NEW state/d.mts/panel +测试/接线文档，注入已解码sectionsApi与composeDraft函数及原guarded ClientApi，不直接导入尚不存在的SDK新导出。永远使用原AntD/adminTheme/PageHeading，无重新设计或依赖。Panel props {request,sectionsApi,composeDraft,scope,onDraftReady,onScopeRejected}；scope=null或{memberId,workspaceId,documentId,revision}；onDraftReady(proposal)同步返回boolean。root只在原已保存view、无编辑/未保存内容/忙/冲突/未知写入/恢复确认锁时给scope，永久挂载；root另加manager.applySectionDraft(proposal)同步再次校验精确id/revision、已保存态及canMutate，接受后仅转原全文编辑草稿，不提交网络。root不得覆盖已有未保存草稿。

UI显式读取章节目录、选择、显示选中原块和局部编辑、前后预览；明确确认应用到草稿，提示“尚未保存，请在全文编辑器明确保存”，成功后清panel私有副本；取消/noop零PATCH。每个读/预览/确认前后复检原/client/auth/me和/client/workspaces/context，完整member/workspace/role/permission/sessionGeneration64hex；读取需documents.read，应用草稿需read+manage。重新读取原当前文档核对scope/revision及index hash，版本变化拒绝、不得自动重基。每步使用epoch/abort拒绝旧回调；null/身份/空间/角色/会话/失焦/真hidden/pagehide/卸载清正文/候选/比较/确认；当前401/403/404回调清父子。纯本地草稿操作没有独立未知mutation锁；真正PATCH与不确定结果全留原manager的唯一恢复owner。没有localStorage/URL/private日志/unsafeHTML，不触碰script/restore/export其他owner。

## Root必验

I223：实际新保护租约、原API/current auth/Workspace/文档owner，当前/旧revision/删除/跨成员/撤权拒绝；只读索引与纯parser一致，document/version/Run/Job/Trace/exports数量和内容不变，Auth lastSeenAt依原owner。无新schema。
I224：依真实I223的HTTP，仓库外fresh实际私有包安装ESM/CJS/NodeNext types/浏览器；body hash与全部前后缀字节、CRLF/emoji/围栏/空块/noop/坏边界/65536上限，原SDK PATCH新版本CAS成功和409拒绝，旧历史/导出不变。没有双mutation owner。
I225：原生产页面桌面390与native实际操作完整“读→选→编辑→比较→确认到草稿→原明确保存”生成一版；取消/noop/有现存草稿不能覆盖、晚到响应/失权父子清除、真实blur/hidden/卸载、原保存丢回复一次PATCH及显式读取/ACK、旧导出/原历史保持。原文档/恢复/导出回归和适用types/build/lint/治理；正式verify:task后才原名精确提交与I完成。临时服务/安装/浏览器精确关闭，原3955本地持久环境保留；全部新实现未验前不更换其运行输出。
