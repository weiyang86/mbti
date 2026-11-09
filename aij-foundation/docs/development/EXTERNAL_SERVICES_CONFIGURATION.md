# 外部服务配置草稿操作与验收说明

本说明对应 [W15 契约](../planning/auto-ai-program-20261105/W15/CONTRACT.md)。AF193 的 API/SDK 与 AF194 的管理页面已通过本地正式代码验证；本文的校核归 AF195。真实账号、密钥、商户资质和供应商调用保持 `DEFERRED_NOT_PASSED`，负责人验收待定。草稿能够保存不代表渠道已经接通。完整40项目标及 AF191 仍未完成。

## 入口与范围

配置管理员在 `/auth/configuration` 的“外部服务配置”中操作。读取目录、读取草稿和保存都需要当前有效的 `admin.config.manage`；改变或明确清除凭据引用还需要 `admin.secret.manage`。页面使用现有 Cookie、CSRF 与错误处理，以及公开 SDK 的 `createExternalServicesApi`，权限仍由服务端逐次确认。

服务端目录包含14项：deepseek、aliyun、qiniu、wechat-pay、alipay、douyin-pay、email、sms、wechat-official、wechat-miniapp、wecom、dingtalk、feishu、webhook。它们分别提供模型、对象存储、支付和通知的配置字段。本目录不含站内信，也不等于14种运行适配器已经实现。UI直接读取目录，没有另建厂商字段真值；厂商字段资料与未核实部分见 [AF193 接线记录](../planning/auto-ai-program-20261105/W15/AF-193-ROOT_WIRING.md)。

这些是当前部署项目的管理员草稿。服务端根据运行环境、当前 `ProjectProfile` 及关联组织状态确定作用域；不是客户端 Workspace 选择器，也不接受客户端指定 projectId、状态或启用标记。本批没有实现用户自带密钥切换与计费授权。

## 保存与冲突恢复

1. 选择服务，可将所有字段和凭据输入留空保存草稿。页面显示缺项及版本；不会创建假账号、假密钥或假引用。
2. 普通字段输入非秘密配置。凭据框仅接受未来通过受控入口建立、归属当前 namespace 且当前可用的已有 SecretRef；不要粘贴真实密钥或任意环境变量名。
3. 凭据框空白表示保留旧引用，不表示删除。UI省略空白键；API省略 `credentialRefs` 或其中某个键也保留旧引用。API空字符串不是清除指令。点击“明确清除”后发送该键的 `null`，仍需密钥管理权限；输入新引用或清空输入可撤销尚未提交的清除意图。
4. 保存提交 `expectedVersion` 做 CAS。遇到409，当前草稿和引用修改保留，保存锁定。依次点击“读取最新版本”→核对最新非秘密字段、引用可用布尔状态与保留草稿→“确认使用最新版本”→再次手动保存。确认只采用最新版本号，不自动覆盖草稿或提交。
5. 若保存失败或结果未知，禁止自动重发。使用同一显式读取、核对、确认流程判断服务端是否已经提交。真实页面验收用自有代理在实际提交后丢弃响应验证此行为，未伪造提交成功。
6. `credentials_ready` 仅表示保存字段完整且引用当前可用。返回仍固定 `runtimeEnabled:false`、`externalVerification:'not_run'`；它不是联调成功或运行授权。本批没有启用渠道的按钮。

## 接口与数据保护

API 均在 `/api/admin/external-services` 下：`GET /catalog`、`GET /`、`GET /:providerCode`、`PUT /:providerCode`。保存 DTO 仅包含 `expectedVersion`、`fields` 和可选 `credentialRefs`。未保存时版本为0；成功保存、并发冲突和无变化 no-op 以当前 API 返回为准。

数据复用原 `ScopedConfig` 与 `ConfigurationChange`，私有键为 `external.services.<providerCode>`，项目 scopeId 来自服务端，状态固定 disabled。草稿保存、CAS、变更记录和审计在同一事务中，失败回滚；普通配置 API 不能借此写入该专用键，公开投影不提供草稿。

GET会返回非秘密字段、`credentialStates` 布尔值和 `missingFields` 键名；不会回显原始引用字符串或真实密钥。审计记录字段名、版本等元数据。这里的“不解析密钥”仅指该配置服务不调用 `resolveTrusted` 取得密钥、不向客户端返回密钥；现有 `configuredTrusted → exists` 可用性检查内部可能读取或解密，不能声称底层从不读取。

草稿编辑状态由RAM控制器持有。切换服务、失焦、隐藏、卸载或身份/权限 key 变化会清除旧状态，epoch隔离晚到响应；当前401/403也会清除私有字段与引用。现有管理员请求适配器没有转发 AbortSignal，因此不能承诺已取消底层网络请求。真实页面仅验证了卸载晚到响应及当前403等子集；真正OS隐藏、全部会话/角色变换、全量 storage/日志审计未由本批证明。

## 证据与人工复验

分层结果见 [验收清单](../planning/auto-ai-program-20261105/W15/EXTERNAL_SERVICES_ACCEPTANCE.json)。API正式报告为 `.artifacts/verification/AF-193/run-OrObxQ/report.json`，页面正式报告为 `.artifacts/verification/AF-194/run-kTlPd3/report.json`；实际集成依赖分别为 `task_b3d70e6bb6cd`、`task_11b965155119`。文档校核不能新增运行能力或替代产品目标验收。

人工复验可依次操作空草稿、缺项显示、并发旧版本冲突、未知保存后的显式读回、当前权限拒绝与390px布局。已完成的是实际Orca内置浏览器的桌面和390px表单、方向键/Tab选服务及focus/Enter保存等有限键盘路径；不是所有指针、完整无障碍或真正OS原生隐藏场景通过。

合成验收后，自有页面、Next/HTTP/API和应用连接池已关闭，合成业务行与会话清除。受保护的隔离验收库、租约记录和私有失败/截图证据按既有策略保留；不承诺“完全无测试痕迹”，不做 reset/drop。它们不是生产备份。组织/资源恢复、真实渠道重试和支付退款不在本草稿功能范围；不得通过未授权数据库操作撤销业务。
