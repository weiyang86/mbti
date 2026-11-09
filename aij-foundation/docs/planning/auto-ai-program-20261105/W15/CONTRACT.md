# W15 外部服务配置草稿：共同契约

本批交付项目管理员可持久保存/读取/修改的外部配置草稿。负责人2026-11-06明确：模型、七牛云、支付、通知先做表单和代码，真实账号/密钥留空，外部资质与真实调用暂缓。不得把外部未验证改成通过，原40目标和AF191严格场景保留。

服务端唯一目录提供 deepseek、aliyun、qiniu、wechat-pay、alipay、douyin-pay、email、sms、wechat-official、wechat-miniapp、wecom、dingtalk、feishu、webhook 14个固定providerCode。前三者category分别model/model/storage，支付3个payment，其余notification。字段定义由API目录单一owner返回，UI不复制目录；具体厂商字段须查官方文档，记录来源，未实现适配器不得标可运行。

使用现有 ScopedConfig + ConfigurationChange + ManagementAccessService，配置目录之外的专用私有键 external.services.<providerCode>、scope=project、scopeId为当前服务端解析ProjectProfile.id、pluginCode空字符串、valueType=string、sensitive=true、isPublic=false、status=disabled。不新增Schema/账本，不从OrganizationProfile推导客户端Workspace。所有管理入口权限admin.config.manage，凭据引用修改额外admin.secret.manage；事务内重新验证管理员、项目/组织当前状态与环境。读权限也真实验证，不能仅UI隐藏。普通配置API未知键保持不可写，其安全投影不得暴露本专用JSON/引用。

API路径均在实际 /api 下：GET /admin/external-services/catalog -> {schemaVersion:1,providers:Provider[]}; GET /admin/external-services -> {projectId:string,items:View[]}; GET /admin/external-services/:providerCode -> View（未存储为version0默认View）; PUT /admin/external-services/:providerCode -> View。DTO仅 {expectedVersion:number,fields:Record<string,string>,credentialRefs?:Record<string,string|null>}。不接收projectId/scope/status/enabled/原始密钥。credentialRefs缺省或某key缺省保留已有引用；null显式清除；非空string只接受当前namespace的已有有效SecretRef，不能原始密钥或任意环境变量。无凭据引用时允许全部fields为空保存草稿，不自动创建假引用。

Provider={code,label,category,fields:Field[],credentials:Credential[]}; Field={key,label,kind:'text'|'url'|'number'|'select',required:boolean,maxLength:number,options?:{value,label}[]}; Credential={key,label,required:boolean}。后端严格白名单、字段总量/字节/长度/CRLF/URL scheme及认证部分校验；不能注入rawSecret/JS原型键/任意未知字段。供应商URL只做配置校验，本批不访问网络。

View={providerCode:string,version:number,fields:Record<string,string>,credentialStates:Record<string,boolean>,missingFields:string[],configurationStatus:'not_configured'|'draft'|'credentials_ready',runtimeEnabled:false,externalVerification:'not_run'}。未保存version0为空；missingFields使用字段key和credential key，不含任何输入值/引用内容。credentials_ready只指保存字段完整及引用可用，界面仍明确真实渠道未验证且没有运行入口。所有原始引用只在服务端内部存储，无GET/日志/审计/错误响应回显，绝不resolveTrusted取真实值。保存+CAS+配置变更+审计同一事务，无变化可no-op；创建竞争/旧version409，失败全部回滚。

SDK新增 createExternalServicesApi(api:ClientApi)，方法 catalog(signal?),list(signal?),get(providerCode,signal?),save(providerCode,dto,signal?)，严格校验DTO及安全响应。root独占sdk index导出。UI组件 AdminExternalServices({api,identityKey,canManageSecrets})，api结构相同；不导入源码运行时。root在原AdminConfiguration页面组合，使用useAdmin().request真实CSRF受保护适配器。

UI默认不填账号/密钥，展示待配置、草稿与缺项；只输入SecretRef引用，不收集密钥明文，空白保留旧引用，清除需明确动作。保存失败/409保留用户草稿，要求显式重新读取和确认版本；结果未知不自动重发，先重新读取核对。旧identity/角色/会话、失焦/隐藏/unmount晚到响应必须隔离，私有编辑内容仅RAM，无storage/URL/日志。原AntD/PageHeading/adminTheme样式，390px可用及键盘操作。

root负责模块注册/原页面组合/SDK导出/数据库授权/正式门禁，原配置和SecretRef回归。Worker提供真实编译/严格DTO/SDK/UI-state可运行检查和root-only PG测试代码，未运行的PG/浏览器/渠道如实NOT_RUN。AF191仍独立待验，禁止将此配置草稿解释成完整厂商接入完成。
